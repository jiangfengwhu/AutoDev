import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  FailureIncident,
  FailureIncidentSource,
  RsiAttributionDecision,
  RsiDecisionAction,
  RsiDecisionGateResult,
  RsiRootCauseCategory,
  RsiRuleSeverity,
  RsiSystemRule,
  RsiTargetStage,
  TestExecutionReport,
} from '../src/lib/rsiEngine.ts';
import {
  clampDirectiveLength,
  computePassRate,
  evaluateRsiDecisionOutcome,
  parseTestMetricsFromLog,
  RSI_BUDGET_LIMITS,
} from '../src/lib/rsiEngine.ts';
import {
  applyIncidentAttribution,
  getIncidentById,
  getRsiState,
  listAllRsiRules,
  markIncidentAnalysisError,
  markIncidentAnalyzing,
  recordIncident,
  replaceConsolidatedRsiRules,
  setRsiLastSyncedAt,
  upsertTestReport,
} from './rsiStore.ts';
import type { TokenUsageSummary } from '../src/types/autodev.ts';
import { attachAgySessionToRun, attachCodingOutputToRun } from './runStore.ts';
import {
  getGitHubActionRunDetail,
  listGitHubActionRuns,
  readPlanChannelJson,
} from './githubService.ts';
import { AUTODEV_PLAN_CHANNEL_BRANCH } from '../src/lib/planProtocol.ts';

const RSI_ANALYZER_MODEL = 'gemini-4-hydrogen';
const RSI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const RSI_DECISION_MODEL = 'gemini-decision-1';

function createRsiGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      '服务端未配置 GEMINI_API_KEY，请在 AI Studio Settings > Secrets 面板检查您的 API Key 配置。'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Dedicated v1beta client strictly required for `ai.decisions.create` (`gemini-decision-1`).
 */
function createRsiDecisionsClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      '服务端未配置 GEMINI_API_KEY，无法调用 gemini-decision-1 决策门控模型。'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const RSI_ATTRIBUTION_SCHEMA = {
  type: Type.OBJECT,
  required: [
    'rootCauseCategory',
    'rootCauseSummary',
    'shouldCodifyAsRule',
    'decisionRationale',
    'confidence',
  ],
  properties: {
    rootCauseCategory: {
      type: Type.STRING,
      enum: [
        'test_assertion',
        'env_infra',
        'contract_mismatch',
        'ui_ux_acceptance',
        'build_typecheck',
        'ci_workflow',
      ],
    },
    rootCauseSummary: {
      type: Type.STRING,
      description: 'Concise Simplified Chinese root-cause diagnosis explaining why the failure occurred.',
    },
    shouldCodifyAsRule: {
      type: Type.BOOLEAN,
      description:
        'True ONLY if this failure reveals a reusable, generalizable engineering/testing/environment lesson that should be permanently injected into future System Prompts. False for one-off network blips, user cancellations, or single-PRD business typos.',
    },
    decisionRationale: {
      type: Type.STRING,
      description:
        'Simplified Chinese explanation of why this failure SHOULD or SHOULD NOT be codified into the permanent System Prompt library.',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Confidence score between 0 and 1.',
    },
    suggestedRule: {
      type: Type.OBJECT,
      description: 'Required when shouldCodifyAsRule is true.',
      required: ['title', 'targetStage', 'severity', 'promptDirective', 'dedupeKey'],
      properties: {
        title: {
          type: Type.STRING,
          description: 'Short Chinese rule title (<= 24 chars).',
        },
        targetStage: {
          type: Type.STRING,
          enum: ['architect', 'qa_spec', 'qa_critic', 'coding', 'all'],
        },
        severity: {
          type: Type.STRING,
          enum: ['critical', 'recommended'],
        },
        promptDirective: {
          type: Type.STRING,
          description:
            'Concrete, actionable imperative instruction in Simplified Chinese to inject into future System Prompts so this class of bug never repeats.',
        },
        dedupeKey: {
          type: Type.STRING,
          description:
            'Short lowercase kebab-case semantic fingerprint (e.g. "cloudflare-d1-idempotent-migrations"). Reuse an existing rule dedupeKey if this failure reinforces an existing lesson!',
        },
      },
    },
  },
};

interface RawAttributionPayload {
  rootCauseCategory: RsiRootCauseCategory;
  rootCauseSummary: string;
  shouldCodifyAsRule: boolean;
  decisionRationale: string;
  confidence: number;
  suggestedRule?: {
    title: string;
    targetStage: RsiTargetStage;
    severity: RsiRuleSeverity;
    promptDirective: string;
    dedupeKey: string;
  };
}

/**
 * Stage 2 Calibrated Decision Gate via Google `gemini-decision-1` (`ai.decisions.create`, v1beta).
 * Evaluates in one batched zero-output-token call whether a candidate RSI rule is:
 * 1) a genuinely generalizable engineering/testing/infra principle vs. a one-off edge case,
 * 2) semantically duplicating an existing active/candidate rule (and which exact rule ID),
 * 3) discard / merge / candidate / critical-active, and
 * 4) generality rubric score (0..3).
 */
export async function evaluateCandidateWithDecisionModel(params: {
  incident: FailureIncident;
  rootCauseCategory: RsiRootCauseCategory;
  rootCauseSummary: string;
  candidateRule: {
    title: string;
    targetStage: RsiTargetStage;
    severity: RsiRuleSeverity;
    promptDirective: string;
    dedupeKey: string;
  };
  existingRules: RsiSystemRule[];
}): Promise<RsiDecisionGateResult> {
  const decisionsAi = createRsiDecisionsClient();
  const activeAndCandidate = params.existingRules
    .filter((r) => r.status === 'active' || r.status === 'candidate')
    .slice(0, 30);

  const ruleKeyToId = new Map<string, string>();
  const mergeCriteria: Record<string, string> = {};
  activeAndCandidate.forEach((rule, idx) => {
    const key = `rule_${String(idx).padStart(2, '0')}`;
    ruleKeyToId.set(key, rule.id);
    mergeCriteria[key] = `[${rule.targetStage}/${rule.severity}] ${rule.title}: ${rule.promptDirective}`;
  });
  mergeCriteria.z_no_match =
    'The candidate rule covers a genuinely distinct engineering topic not already represented by any existing rule above.';

  const payload = {
    incident: {
      source: params.incident.source,
      title: params.incident.title,
      branch: params.incident.branch || 'main',
      errorSummary: params.incident.errorSummary,
      rootCauseCategory: params.rootCauseCategory,
      rootCauseSummary: params.rootCauseSummary,
    },
    candidateRule: {
      title: params.candidateRule.title,
      targetStage: params.candidateRule.targetStage,
      severity: params.candidateRule.severity,
      promptDirective: clampDirectiveLength(params.candidateRule.promptDirective),
      dedupeKey: params.candidateRule.dedupeKey,
    },
    existingRules: activeAndCandidate.map((r, idx) => ({
      optionKey: `rule_${String(idx).padStart(2, '0')}`,
      stage: r.targetStage,
      severity: r.severity,
      status: r.status,
      title: r.title,
      directive: r.promptDirective,
    })),
  };

  const questions: Record<string, any> = {
    is_generalizable: {
      type: 'noul',
      instructions:
        'Does `candidateRule` capture a reusable, generalizable engineering, testing, architecture, or CI/environment principle that prevents recurring failures across future PRDs (as opposed to a one-off edge case, transient network blip, manual cancellation, or single-PRD visual/copy tweak)?',
      criteria: {
        true_description:
          'A reusable cross-feature engineering guardrail (e.g., Playwright strict-mode locator hygiene, Cloudflare D1 migration safety, foreground test execution without hanging daemons, dark/light theme variable discipline, API contract integrity).',
        false_description:
          'A one-off business wording request, single-PRD cosmetic tweak, transient network/403/rate-limit glitch, user cancellation, or narrow edge case that would only bloat future System Prompts.',
      },
    },
    is_duplicate_of_existing: {
      type: 'noul',
      instructions:
        'Does `candidateRule` semantically overlap with, restate, or address the same underlying engineering failure mode as any rule in `existingRules`?',
      criteria: {
        true_description:
          'An existing rule already covers this failure mode or topic; creating a separate rule would cause prompt bloat and should instead merge/reinforce the existing rule.',
        false_description:
          'This rule introduces a genuinely new engineering constraint not covered by `existingRules` (or `existingRules` is empty).',
      },
    },
    rule_action: {
      type: 'choice',
      instructions:
        'To keep the RSI System Prompt concise and prevent prompt bloat, which governance action should the system take for `candidateRule` given `incident` and `existingRules`?',
      criteria: {
        discard_edge_case:
          'Do NOT add to the RSI library. The incident is a one-off edge case, transient glitch, manual cancellation, or narrow single-PRD detail.',
        merge_existing:
          'Semantically overlaps an existing rule in `existingRules`. Merge and reinforce the existing rule rather than adding a new entry.',
        create_candidate:
          'Reusable and distinct moderate engineering lesson. Store in the observation candidate pool (only auto-promoted to active System Prompt after recurring >= 2 times or human approval).',
        create_critical_active:
          'High-impact, distinct, cross-cutting engineering/testing/infra guardrail that prevents severe build, E2E, timeout, data, or security failures. Activate immediately in System Prompt.',
      },
    },
    generality_score: {
      type: 'score',
      instructions:
        'Rate how generalizable and high-leverage `candidateRule` is for future autonomous engineering runs.',
      criteria: [
        'One-off incident, transient network/permission glitch, or single-PRD business copy detail',
        'Narrow edge case specific to one screen or isolated implementation detail',
        'Reusable engineering best practice worth observing before permanent prompt injection',
        'Critical cross-cutting engineering/testing/CI guardrail preventing severe recurring failures',
      ],
    },
  };

  if (activeAndCandidate.length > 0) {
    questions.merge_target = {
      type: 'choice',
      instructions:
        'If `candidateRule` semantically overlaps with an existing rule in `existingRules`, which existing rule is the closest match? Select `z_no_match` if none overlap.',
      criteria: mergeCriteria,
    };
  }

  const result = await decisionsAi.decisions.create({
    model: RSI_DECISION_MODEL,
    input: [{ type: 'text', text: JSON.stringify(payload) }],
    questions,
  });

  if (!result.answers) {
    throw new Error('gemini-decision-1 未返回有效的决策结果（输入可能被安全策略拦截）。');
  }

  const genAns = result.answers.is_generalizable;
  const dupAns = result.answers.is_duplicate_of_existing;
  const actAns = result.answers.rule_action;
  const scoreAns = result.answers.generality_score;
  const mergeAns = result.answers.merge_target;

  if (
    genAns?.type !== 'noul' ||
    dupAns?.type !== 'noul' ||
    actAns?.type !== 'choice' ||
    scoreAns?.type !== 'score'
  ) {
    throw new Error('gemini-decision-1 返回结构异常，缺少必需的校准概率字段。');
  }

  let matchedRuleId: string | undefined;
  let matchedRuleConfidence: number | undefined;
  if (mergeAns?.type === 'choice' && mergeAns.choice !== 'z_no_match') {
    matchedRuleId = ruleKeyToId.get(mergeAns.choice);
    matchedRuleConfidence = mergeAns.confidence;
  }

  return {
    model: RSI_DECISION_MODEL,
    generalizableProb: Number(genAns.noul.toFixed(4)),
    duplicateProb: Number(dupAns.noul.toFixed(4)),
    generalityScore: Number(scoreAns.score.toFixed(3)),
    chosenAction: actAns.choice as RsiDecisionAction,
    actionConfidence: Number(actAns.confidence.toFixed(4)),
    matchedRuleId,
    matchedRuleConfidence:
      matchedRuleConfidence !== undefined ? Number(matchedRuleConfidence.toFixed(4)) : undefined,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function analyzeIncidentWithGemini(
  incident: FailureIncident,
  existingRules: RsiSystemRule[]
): Promise<RsiAttributionDecision> {
  const ai = createRsiGeminiClient();

  const existingSummary =
    existingRules.length > 0
      ? existingRules
          .filter((r) => r.status === 'active' || r.status === 'candidate')
          .slice(0, 30)
          .map(
            (r) =>
              `- dedupeKey="${r.dedupeKey}" | stage=${r.targetStage} | status=${r.status} | title="${r.title}" | directive="${r.promptDirective.slice(0, 140)}"`
          )
          .join('\n')
      : '（当前尚无已沉淀的 RSI System Prompt 规则）';

  const systemInstruction = [
    '你是 AutoDev Studio 的 RSI（Recursive Self-Improvement，递归自进化）故障归因引擎。',
    '每次自动化测试失败、环境/流水线异常、需求规划报错、部署失败或人工验收退回发生时，你负责：',
    '1. 精准定位根本原因分类（rootCauseCategory）并用简体中文给出简明根因诊断（rootCauseSummary）；',
    '2. 初步判断该问题是否包含可复用的工程规律（shouldCodifyAsRule），后续还将交由专门的 gemini-decision-1 决策模型做严格的通用性/去重门控；',
    `3. 若存在可复用工程规律，请提炼一条高度凝练、不超过 ${RSI_BUDGET_LIMITS.maxDirectiveChars} 字的可执行指令（suggestedRule.promptDirective），避免冗长与口水话；`,
    '4. 避免规则膨胀：若现有规则库中已有同主题规则，请复用该规则的 `dedupeKey`。',
    '所有文字描述必须使用专业、简洁的简体中文。',
  ].join('\n');

  const prompt = [
    `事件来源: ${incident.source}`,
    `目标仓库: ${incident.repoFullName}`,
    `分支: ${incident.branch || 'main'}`,
    `事件标题: ${incident.title}`,
    `错误摘要: ${incident.errorSummary}`,
    '',
    '=== 现有 RSI 规则库（若主题相同请复用 dedupeKey） ===',
    existingSummary,
    '',
    '=== 原始日志 / 验收退回证据 ===',
    (incident.rawEvidence || incident.errorSummary).slice(0, 8000),
  ].join('\n');

  const attempts: Array<{ model: string; thinkingLevel?: ThinkingLevel }> = [
    { model: RSI_ANALYZER_MODEL, thinkingLevel: ThinkingLevel.MEDIUM },
    { model: RSI_FALLBACK_MODEL },
  ];

  let parsed: RawAttributionPayload | null = null;
  let usedModel = RSI_ANALYZER_MODEL;
  let lastErr: unknown;

  for (const step of attempts) {
    try {
      const response = await ai.models.generateContent({
        model: step.model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: RSI_ATTRIBUTION_SCHEMA,
          ...(step.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: step.thinkingLevel } }
            : {}),
        },
      });
      const rawText = (response.text ?? '').trim();
      if (!rawText) throw new Error('Gemini RSI 归因引擎返回空响应');
      parsed = JSON.parse(rawText) as RawAttributionPayload;
      usedModel = step.model;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!parsed) {
    throw lastErr instanceof Error ? lastErr : new Error('RSI AI 归因分析失败');
  }

  const rootCauseSummary = (parsed.rootCauseSummary || '').trim() || incident.errorSummary;
  const candidateRule = parsed.suggestedRule?.promptDirective?.trim()
    ? {
        title: parsed.suggestedRule.title.trim().slice(0, 60),
        targetStage: parsed.suggestedRule.targetStage,
        severity: parsed.suggestedRule.severity,
        promptDirective: clampDirectiveLength(parsed.suggestedRule.promptDirective),
        dedupeKey: parsed.suggestedRule.dedupeKey.trim(),
      }
    : undefined;

  // Stage 2: Calibrated `gemini-decision-1` Gatekeeper!
  // Always invoke Decisions API when a candidate rule is drafted so the calibrated decision model
  // makes the authoritative call on generalizable vs. edge case, semantic merge, candidate vs. active.
  if (parsed.shouldCodifyAsRule && candidateRule) {
    const decisionGate = await evaluateCandidateWithDecisionModel({
      incident,
      rootCauseCategory: parsed.rootCauseCategory,
      rootCauseSummary,
      candidateRule,
      existingRules,
    });
    const policy = evaluateRsiDecisionOutcome(decisionGate);

    return {
      rootCauseCategory: parsed.rootCauseCategory,
      rootCauseSummary,
      shouldCodifyAsRule: policy.shouldCodifyAsRule,
      decisionRationale: `${policy.policySummary} ${parsed.decisionRationale?.trim() || ''}`.trim(),
      confidence: Number(
        Math.max(
          decisionGate.actionConfidence,
          decisionGate.generalizableProb,
          1 - decisionGate.generalizableProb
        ).toFixed(2)
      ),
      suggestedRule: policy.shouldCodifyAsRule ? candidateRule : undefined,
      decisionGate,
      appliedOutcome: policy.outcome,
      mergedIntoRuleId: policy.mergeTargetRuleId,
      analyzedAt: new Date().toISOString(),
      model: `${usedModel} + ${decisionGate.model}`,
    };
  }

  return {
    rootCauseCategory: parsed.rootCauseCategory,
    rootCauseSummary,
    shouldCodifyAsRule: false,
    decisionRationale: (parsed.decisionRationale || '').trim() || '判定为偶发或非通用问题，无需沉淀。',
    confidence:
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, Number(parsed.confidence.toFixed(2))))
        : 0.78,
    appliedOutcome: 'discarded',
    analyzedAt: new Date().toISOString(),
    model: usedModel,
  };
}

const RSI_CONSOLIDATION_SCHEMA = {
  type: Type.OBJECT,
  required: ['summary', 'rules'],
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Concise Simplified Chinese summary of what was merged or compressed.',
    },
    rules: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: [
          'title',
          'targetStage',
          'severity',
          'promptDirective',
          'rootCauseCategory',
          'dedupeKey',
          'sourceRuleIds',
        ],
        properties: {
          title: { type: Type.STRING },
          targetStage: {
            type: Type.STRING,
            enum: ['architect', 'qa_spec', 'qa_critic', 'coding', 'all'],
          },
          severity: {
            type: Type.STRING,
            enum: ['critical', 'recommended'],
          },
          promptDirective: {
            type: Type.STRING,
            description: `Concise imperative directive in Simplified Chinese, strictly <= ${RSI_BUDGET_LIMITS.maxDirectiveChars} characters.`,
          },
          rootCauseCategory: {
            type: Type.STRING,
            enum: [
              'test_assertion',
              'env_infra',
              'contract_mismatch',
              'ui_ux_acceptance',
              'build_typecheck',
              'ci_workflow',
            ],
          },
          dedupeKey: { type: Type.STRING },
          sourceRuleIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
  },
};

/**
 * AI Prompt Compaction / Distillation: merges semantically overlapping active/candidate rules
 * and compresses directives to stay strictly within the RSI Prompt budget.
 */
export async function consolidateRsiRulesWithGemini(): Promise<{
  summary: string;
  beforeCount: number;
  afterCount: number;
  rules: RsiSystemRule[];
}> {
  const existing = listAllRsiRules().filter(
    (r) => r.status === 'active' || r.status === 'candidate'
  );
  if (existing.length < 2) {
    return {
      summary: '当前活跃/候选规则少于 2 条，无需蒸馏压缩。',
      beforeCount: existing.length,
      afterCount: existing.length,
      rules: listAllRsiRules(),
    };
  }

  const ai = createRsiGeminiClient();
  const response = await ai.models.generateContent({
    model: RSI_ANALYZER_MODEL,
    contents: JSON.stringify(
      existing.map((r) => ({
        id: r.id,
        title: r.title,
        targetStage: r.targetStage,
        severity: r.severity,
        status: r.status,
        rootCauseCategory: r.rootCauseCategory,
        hitCount: r.hitCount,
        dedupeKey: r.dedupeKey,
        promptDirective: r.promptDirective,
      })),
      null,
      2
    ),
    config: {
      systemInstruction: [
        '你是 AutoDev Studio 的 RSI Prompt 蒸馏压缩引擎。',
        '你的职责是把当前活跃和候选规则库进行精简与去重合并，防止 System Prompt 膨胀：',
        '1. 合并所有语义相近、主题重叠的规则，保留其核心硬性约束，并在 sourceRuleIds 中列出被合并的原规则 ID；',
        `2. 每条提炼后的 promptDirective 必须高度凝练且严格不超过 ${RSI_BUDGET_LIMITS.maxDirectiveChars} 个汉字/字符；`,
        `3. 蒸馏后的规则总数不得超过原数量，且不超过 ${RSI_BUDGET_LIMITS.codingMaxRules} 条黄金准则；`,
        '4. 绝不丢失 Critical 级别的系统性防线（如 E2E 只读契约、防后台挂起、亮暗色变量、D1 迁移幂等）。',
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: RSI_CONSOLIDATION_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('RSI 蒸馏压缩返回空响应');
  }
  const parsed = JSON.parse(rawText) as {
    summary: string;
    rules: Array<{
      title: string;
      targetStage: RsiTargetStage;
      severity: RsiRuleSeverity;
      promptDirective: string;
      rootCauseCategory: RsiRootCauseCategory;
      dedupeKey: string;
      sourceRuleIds: string[];
    }>;
  };

  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error('RSI 蒸馏结果为空，已中止写入以保护现有规则库。');
  }

  const replaced = replaceConsolidatedRsiRules(parsed.rules);
  return {
    summary: parsed.summary?.trim() || `已将 ${replaced.beforeCount} 条规则蒸馏压缩为 ${replaced.afterCount} 条。`,
    beforeCount: replaced.beforeCount,
    afterCount: replaced.afterCount,
    rules: replaced.rules,
  };
}

export async function runAttributionForIncident(incidentId: string): Promise<{
  incident: FailureIncident;
  rule?: RsiSystemRule;
  ruleAction?: 'created' | 'merged';
  promotedFromCandidate?: boolean;
}> {
  const incident = getIncidentById(incidentId);
  if (!incident) {
    throw new Error('未找到对应的失败归因事件');
  }

  markIncidentAnalyzing(incidentId);
  try {
    const decision = await analyzeIncidentWithGemini(incident, listAllRsiRules());
    const result = applyIncidentAttribution(incidentId, decision);
    if (!result.incident) {
      throw new Error('保存 RSI 归因结果失败');
    }
    return {
      incident: result.incident,
      rule: result.rule,
      ruleAction: result.ruleAction,
      promotedFromCandidate: result.promotedFromCandidate,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'RSI 归因执行异常';
    markIncidentAnalysisError(incidentId, msg);
    throw new Error(msg);
  }
}

export async function captureAndReflectIncident(input: {
  sourceRefKey: string;
  source: FailureIncidentSource;
  repoFullName: string;
  title: string;
  errorSummary: string;
  rawEvidence: string;
  relatedRunId?: string;
  relatedActionsRunId?: number;
  relatedActionsUrl?: string;
  branch?: string;
  occurredAt?: string;
  waitForAnalysis?: boolean;
}): Promise<{
  incident: FailureIncident;
  created: boolean;
  rule?: RsiSystemRule;
  ruleAction?: 'created' | 'merged';
}> {
  const { incident, created } = recordIncident(input);

  if (!created && incident.analysisStatus === 'analyzed') {
    return { incident, created: false };
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return { incident, created };
  }

  if (input.waitForAnalysis) {
    try {
      const analyzed = await runAttributionForIncident(incident.id);
      return {
        incident: analyzed.incident,
        created,
        rule: analyzed.rule,
        ruleAction: analyzed.ruleAction,
      };
    } catch {
      return { incident: getIncidentById(incident.id) ?? incident, created };
    }
  }

  // Non-blocking background RSI reflection so API responses remain snappy
  void runAttributionForIncident(incident.id).catch((err) => {
    console.warn('[AutoDev RSI] Background reflection failed:', err?.message || err);
  });

  return { incident, created };
}

interface RemoteChannelTestReport {
  runId?: string;
  actionsRunId?: number;
  actionsUrl?: string;
  workflowName?: string;
  branch?: string;
  prNumber?: number;
  kind?: 'e2e' | 'unit' | 'build_check';
  status?: 'passed' | 'failed' | 'partial' | 'skipped';
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  durationMs?: number;
  executedAt?: string;
  summary?: string;
  cases?: Array<{
    id?: string;
    title: string;
    file?: string;
    status: 'passed' | 'failed' | 'skipped';
    durationMs?: number;
    error?: string;
  }>;
  rawLogExcerpt?: string;
  agySessionId?: string;
  agySessionReused?: boolean;
  agyExitCode?: number;
  repairRounds?: number;
  commitSha?: string;
  model?: string;
  codingFinalOutput?: string;
  tokenUsage?: TokenUsageSummary;
}

/**
 * Syncs real completed GitHub Actions runs + structured channel test reports from target repo,
 * creates real TestExecutionReport entries, captures failed runs/tests as FailureIncidents,
 * and optionally triggers Gemini RSI reflection on newly discovered incidents.
 */
export async function syncRepoTestReportsAndFailures(
  owner: string,
  repo: string,
  options?: { autoAnalyzeLimit?: number }
): Promise<{
  syncedReportsCount: number;
  newIncidentsCount: number;
  analyzedCount: number;
}> {
  const repoFullName = `${owner}/${repo}`;
  const actionsRes = await listGitHubActionRuns(owner, repo, 20);
  if (!actionsRes.connected) {
    throw new Error(actionsRes.error || 'GitHub 未连接，无法同步测试与故障记录');
  }

  const existingState = getRsiState();
  const knownReportRunIds = new Set(
    existingState.testReports.map((r) => r.actionsRunId).filter((id): id is number => Boolean(id))
  );

  const completedRuns = actionsRes.runs.filter((r) => r.status === 'completed').slice(0, 15);
  let syncedReportsCount = 0;
  let newIncidentsCount = 0;
  const newlyCreatedIncidentIds: string[] = [];

  for (const run of completedRuns) {
    // Check if we already synced a rich report for this run
    const alreadyHasReport = knownReportRunIds.has(run.id);

    // 1. Try reading structured JSON report uploaded by autodev-agy.yml on autodev-plan-channel
    let structuredReport: TestExecutionReport | null = null;
    if (!alreadyHasReport) {
      const remoteJson = await readPlanChannelJson<RemoteChannelTestReport>(
        owner,
        repo,
        `.autodev-test-reports/${run.id}.json`,
        AUTODEV_PLAN_CHANNEL_BRANCH
      ).catch(() => null);

      if (remoteJson && typeof remoteJson.total === 'number') {
        const passed = Number(remoteJson.passed || 0);
        const failed = Number(remoteJson.failed || 0);
        const skipped = Number(remoteJson.skipped || 0);
        structuredReport = {
          id: `tr-gh-${run.id}`,
          repoFullName,
          actionsRunId: run.id,
          actionsUrl: remoteJson.actionsUrl || run.htmlUrl,
          workflowName: remoteJson.workflowName || run.name,
          branch: remoteJson.branch || run.headBranch,
          pipelineRunId: remoteJson.runId || undefined,
          prNumber: remoteJson.prNumber,
          kind: remoteJson.kind || 'e2e',
          status:
            remoteJson.status ||
            (failed > 0 && passed > 0 ? 'partial' : failed > 0 ? 'failed' : 'passed'),
          total: remoteJson.total,
          passed,
          failed,
          skipped,
          passRate: computePassRate(passed, failed),
          durationMs: Number(remoteJson.durationMs || 0),
          executedAt: remoteJson.executedAt || run.updatedAt || run.createdAt,
          summary:
            remoteJson.summary ||
            `自动化测试：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`,
          cases: (remoteJson.cases || []).map((c, idx) => ({
            id: c.id || `tc-${idx + 1}`,
            title: c.title,
            file: c.file,
            status: c.status,
            durationMs: Number(c.durationMs || 0),
            error: c.error,
          })),
          rawLogExcerpt: remoteJson.rawLogExcerpt,
          agySessionId: remoteJson.agySessionId,
          agySessionReused: remoteJson.agySessionReused,
          agyExitCode: remoteJson.agyExitCode,
          codingFinalOutput: remoteJson.codingFinalOutput,
          repairRounds: remoteJson.repairRounds,
          tokenUsage: remoteJson.tokenUsage,
        };

        if (remoteJson.agyExitCode !== undefined || remoteJson.agySessionId) {
          attachAgySessionToRun(
            {
              runId: remoteJson.runId || undefined,
              branchName: remoteJson.branch || run.headBranch,
            },
            {
              sessionId: remoteJson.agySessionId || undefined,
              branchName: remoteJson.branch || run.headBranch,
              actionsRunId: run.id,
              exitCode:
                typeof remoteJson.agyExitCode === 'number'
                  ? remoteJson.agyExitCode
                  : run.conclusion === 'success'
                    ? 0
                    : 1,
              reused: Boolean(remoteJson.agySessionReused),
              consecutiveReuseCount: 0,
              updatedAt: remoteJson.executedAt || run.updatedAt || run.createdAt,
            }
          );
        }

        if (remoteJson.codingFinalOutput && remoteJson.codingFinalOutput.trim()) {
          attachCodingOutputToRun(
            {
              runId: remoteJson.runId || undefined,
              branchName: remoteJson.branch || run.headBranch,
            },
            {
              content: remoteJson.codingFinalOutput.trim(),
              commitSha: remoteJson.commitSha,
              model: remoteJson.model,
              actionsRunId: run.id,
              actionsUrl: remoteJson.actionsUrl || run.htmlUrl,
              repairRounds: remoteJson.repairRounds,
              capturedAt: remoteJson.executedAt || run.updatedAt || run.createdAt,
              tokenUsage: remoteJson.tokenUsage,
            }
          );
        }
      }
    }

    // 2. Otherwise inspect real GitHub Actions job steps & log tail
    if (!alreadyHasReport && !structuredReport) {
      let detail: Awaited<ReturnType<typeof getGitHubActionRunDetail>> | null = null;
      try {
        detail = await getGitHubActionRunDetail(owner, repo, run.id);
      } catch {
        detail = null;
      }

      const allSteps = (detail?.jobs || []).flatMap((j) => j.steps || []);
      const combinedLogs = (detail?.jobs || [])
        .map((j) => j.logTail || '')
        .filter(Boolean)
        .join('\n\n');

      const parsed = parseTestMetricsFromLog({
        logText: combinedLogs,
        workflowName: run.name,
        conclusion: run.conclusion,
        steps: allSteps,
      });

      const startMs = Date.parse(run.createdAt);
      const endMs = Date.parse(run.updatedAt || run.createdAt);
      const durationMs =
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
          ? Math.min(120 * 60_000, endMs - startMs)
          : 0;

      structuredReport = {
        id: `tr-gh-${run.id}`,
        repoFullName,
        actionsRunId: run.id,
        actionsUrl: run.htmlUrl,
        workflowName: run.name,
        branch: run.headBranch,
        kind: parsed.kind,
        status: parsed.status,
        total: parsed.total,
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        passRate: computePassRate(parsed.passed, parsed.failed),
        durationMs,
        executedAt: run.updatedAt || run.createdAt,
        summary: parsed.summary,
        cases: parsed.cases,
        rawLogExcerpt: combinedLogs ? combinedLogs.slice(-3000) : undefined,
      };
    }

    if (structuredReport) {
      upsertTestReport(structuredReport);
      syncedReportsCount += 1;

      // Auto-capture real failures (excluding pure user cancellations unless there are failing tests)
      const isFailure =
        run.conclusion === 'failure' ||
        run.conclusion === 'timed_out' ||
        structuredReport.failed > 0;
      if (isFailure) {
        const failedStepTitles = structuredReport.cases
          .filter((c) => c.status === 'failed')
          .map((c) => `${c.title}${c.error ? ` (${c.error})` : ''}`)
          .join('; ');

        const source: FailureIncidentSource =
          structuredReport.kind === 'e2e' || structuredReport.kind === 'unit'
            ? 'test_failure'
            : run.name.toLowerCase().includes('plan')
              ? 'plan_error'
              : run.name.toLowerCase().includes('deploy')
                ? 'deploy_error'
                : 'ci_env_error';

        const recorded = recordIncident({
          sourceRefKey: `actions:${run.id}`,
          source,
          repoFullName,
          title: `${run.name} #${run.id} 异常（${run.conclusion || 'failed'}）`,
          errorSummary:
            failedStepTitles ||
            `${run.name} 在分支 ${run.headBranch} 执行失败（${structuredReport.summary}）`,
          rawEvidence:
            structuredReport.rawLogExcerpt ||
            `Workflow: ${run.name}\nBranch: ${run.headBranch}\nConclusion: ${run.conclusion}\nFailed steps/cases:\n${failedStepTitles}`,
          relatedActionsRunId: run.id,
          relatedActionsUrl: run.htmlUrl,
          branch: run.headBranch,
          occurredAt: run.updatedAt || run.createdAt,
        });

        if (recorded.created) {
          newIncidentsCount += 1;
          newlyCreatedIncidentIds.push(recorded.incident.id);
        }
      }
    }
  }

  // Auto-analyze up to autoAnalyzeLimit pending incidents (newest first)
  const limit = options?.autoAnalyzeLimit ?? 3;
  let analyzedCount = 0;
  if (limit > 0 && process.env.GEMINI_API_KEY?.trim()) {
    const latestState = getRsiState();
    const pendingIds = Array.from(
      new Set([
        ...newlyCreatedIncidentIds,
        ...latestState.incidents
          .filter((i) => i.analysisStatus === 'pending')
          .map((i) => i.id),
      ])
    ).slice(0, limit);

    for (const id of pendingIds) {
      try {
        await runAttributionForIncident(id);
        analyzedCount += 1;
      } catch {
        // non-fatal, error persisted on incident
      }
    }
  }

  setRsiLastSyncedAt(new Date().toISOString());

  return {
    syncedReportsCount,
    newIncidentsCount,
    analyzedCount,
  };
}
