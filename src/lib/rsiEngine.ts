import type { TokenUsageSummary } from '../types/autodev';

export type RsiRootCauseCategory =
  | 'test_assertion'
  | 'env_infra'
  | 'contract_mismatch'
  | 'ui_ux_acceptance'
  | 'build_typecheck'
  | 'ci_workflow';

export type RsiTargetStage = 'architect' | 'qa_spec' | 'qa_critic' | 'coding' | 'all';

export type RsiRuleStatus = 'active' | 'candidate' | 'paused' | 'archived';

export type RsiRuleSeverity = 'critical' | 'recommended';

export type RsiDecisionAction =
  | 'discard_edge_case'
  | 'merge_existing'
  | 'create_candidate'
  | 'create_critical_active';

export interface RsiDecisionGateResult {
  model: string; // e.g. 'gemini-decision-1'
  generalizableProb: number; // noul P(generalizable) 0.01..0.99
  duplicateProb: number; // noul P(duplicate) 0.01..0.99
  generalityScore: number; // score 0..3
  chosenAction: RsiDecisionAction;
  actionConfidence: number; // 0..1
  matchedRuleId?: string;
  matchedRuleConfidence?: number;
  evaluatedAt: string;
}

export const RSI_BUDGET_LIMITS = {
  maxDirectiveChars: 140,
  planningMaxRules: 8,
  planningMaxChars: 1200,
  codingMaxRules: 10,
  codingMaxChars: 1800,
  maxActiveRulesPool: 20,
  staleArchiveDays: 30,
} as const;

export interface RsiPromptBudgetUsage {
  activeRulesCount: number;
  candidateRulesCount: number;
  pausedRulesCount: number;
  archivedRulesCount: number;
  activePoolLimit: number;
  codingInjectedRules: number;
  codingRulesLimit: number;
  codingCharsUsed: number;
  codingCharsLimit: number;
  planningRulesLimit: number;
  planningCharsLimit: number;
}

export type FailureIncidentSource =
  | 'test_failure'
  | 'ci_env_error'
  | 'plan_error'
  | 'deploy_error'
  | 'manual_acceptance'
  | 'manual_report';

export type IncidentAnalysisStatus = 'pending' | 'analyzing' | 'analyzed' | 'error';

export interface TestCaseResult {
  id: string;
  title: string;
  file?: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface TestExecutionReport {
  id: string;
  repoFullName: string;
  actionsRunId?: number;
  actionsUrl?: string;
  workflowName: string;
  branch: string;
  pipelineRunId?: string;
  prNumber?: number;
  kind: 'e2e' | 'unit' | 'build_check';
  status: 'passed' | 'failed' | 'partial' | 'skipped';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number | null;
  durationMs: number;
  executedAt: string;
  summary: string;
  cases: TestCaseResult[];
  rawLogExcerpt?: string;
  agySessionId?: string;
  agySessionReused?: boolean;
  agyExitCode?: number;
  codingFinalOutput?: string;
  repairRounds?: number;
  tokenUsage?: TokenUsageSummary;
}

export interface RsiAttributionDecision {
  rootCauseCategory: RsiRootCauseCategory;
  rootCauseSummary: string;
  shouldCodifyAsRule: boolean;
  decisionRationale: string;
  confidence: number; // 0..1
  suggestedRule?: {
    title: string;
    targetStage: RsiTargetStage;
    severity: RsiRuleSeverity;
    promptDirective: string;
    dedupeKey: string;
  };
  decisionGate?: RsiDecisionGateResult;
  appliedOutcome?: 'discarded' | 'merged' | 'candidate_created' | 'active_created';
  mergedIntoRuleId?: string;
  generatedRuleId?: string;
  analyzedAt: string;
  model: string;
}

export interface FailureIncident {
  id: string;
  sourceRefKey: string; // deduplication key (e.g. "actions:445004" or "review:run-123:timestamp")
  source: FailureIncidentSource;
  repoFullName: string;
  title: string;
  errorSummary: string;
  rawEvidence: string;
  relatedRunId?: string;
  relatedActionsRunId?: number;
  relatedActionsUrl?: string;
  branch?: string;
  occurredAt: string;
  analysisStatus: IncidentAnalysisStatus;
  analysisError?: string;
  attribution?: RsiAttributionDecision;
}

export interface RsiSystemRule {
  id: string;
  dedupeKey: string;
  title: string;
  targetStage: RsiTargetStage;
  severity: RsiRuleSeverity;
  status: RsiRuleStatus;
  promptDirective: string;
  rootCauseCategory: RsiRootCauseCategory;
  sourceIncidentIds: string[];
  hitCount: number;
  appliedCount: number;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
}

export interface RsiPersistedState {
  testReports: TestExecutionReport[];
  incidents: FailureIncident[];
  rules: RsiSystemRule[];
  lastSyncedAt?: string;
}

export interface QualityTrendPoint {
  id: string;
  label: string;
  dateKey: string;
  workflowName: string;
  branch: string;
  kind: 'e2e' | 'unit' | 'build_check';
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  passRate: number | null;
  durationSec: number;
}

export interface RsiEvolutionTrendPoint {
  id: string;
  dateKey: string;
  label: string;
  timestamp: string;
  passRatePct: number | null;
  rollingSuccessRatePct: number | null;
  adoptedPromptsCumulative: number;
  newlyAdoptedPrompts: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  branch?: string;
  workflowName?: string;
}

export interface RootCauseDistributionItem {
  category: RsiRootCauseCategory;
  label: string;
  count: number;
  codifiedCount: number;
}

export interface QualityRsiSummary {
  totalReports: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  overallTestPassRate: number | null;
  totalIncidents: number;
  analyzedIncidents: number;
  codifiedIncidents: number;
  ignoredTransientIncidents: number;
  activeRulesCount: number;
  candidateRulesCount: number;
  archivedRulesCount: number;
  totalRulesCount: number;
  totalRuleApplications: number;
}

export const ROOT_CAUSE_LABELS: Record<RsiRootCauseCategory, string> = {
  test_assertion: '测试断言失败',
  env_infra: '环境与网络异常',
  contract_mismatch: '接口/规格偏差',
  ui_ux_acceptance: '人工验收退回',
  build_typecheck: '编译/类型错误',
  ci_workflow: '流水线与权限',
};

export const TARGET_STAGE_LABELS: Record<RsiTargetStage, string> = {
  all: '全链路通用',
  architect: 'Architect 架构规划',
  qa_spec: 'QA Spec 测试规格',
  qa_critic: 'QA Critic 边界评审',
  coding: 'VPS AGY 编码实现',
};

function clampInt(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function computePassRate(passed: number, failed: number): number | null {
  const executed = passed + failed;
  if (executed <= 0) return null;
  return Math.round((passed / executed) * 100);
}

/**
 * Deterministic parser that extracts real test execution statistics & failing cases
 * from Playwright / node:test / Vitest / TypeScript CI logs or step summaries.
 */
export function parseTestMetricsFromLog(params: {
  logText: string;
  workflowName: string;
  conclusion: string | null;
  steps?: Array<{ name: string; status: string; conclusion: string | null }>;
}): {
  kind: 'e2e' | 'unit' | 'build_check';
  status: 'passed' | 'failed' | 'partial' | 'skipped';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: TestCaseResult[];
  summary: string;
} {
  const cleanLog = (params.logText || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // 1. Try Playwright summary patterns: "12 passed", "2 failed", "1 skipped"
  const pwPassed = cleanLog.match(/(\d+)\s+passed\b/i);
  const pwFailed = cleanLog.match(/(\d+)\s+failed\b/i);
  const pwSkipped = cleanLog.match(/(\d+)\s+skipped\b/i);
  const hasPlaywrightSignal =
    /playwright|\.spec\.ts|Running \d+ tests? using/i.test(cleanLog) &&
    Boolean(pwPassed || pwFailed);

  // 2. Try node:test TAP summary: "# tests 13", "# pass 12", "# fail 1"
  const tapTests = cleanLog.match(/#\s*tests\s+(\d+)/i);
  const tapPass = cleanLog.match(/#\s*pass\s+(\d+)/i);
  const tapFail = cleanLog.match(/#\s*fail\s+(\d+)/i);
  const tapSkip = cleanLog.match(/#\s*skipped\s+(\d+)/i);

  const cases: TestCaseResult[] = [];

  if (hasPlaywrightSignal) {
    const passed = clampInt(Number(pwPassed?.[1] ?? 0));
    const failed = clampInt(Number(pwFailed?.[1] ?? 0));
    const skipped = clampInt(Number(pwSkipped?.[1] ?? 0));
    const total = passed + failed + skipped;

    // Extract individual playwright failure lines (e.g. "1) [chromium] › tests/e2e/run.spec.ts:12:5 › title")
    const failRegex = /^\s*\d+\)\s+(.+?\.(?:spec|test)\.[jt]sx?:\d+:\d+\s+[›>]\s+.+)$/gm;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = failRegex.exec(cleanLog)) !== null && idx < 20) {
      idx += 1;
      cases.push({
        id: `pw-fail-${idx}`,
        title: match[1].trim(),
        status: 'failed',
        durationMs: 0,
      });
    }

    const status =
      failed > 0 && passed > 0
        ? 'partial'
        : failed > 0
          ? 'failed'
          : passed > 0
            ? 'passed'
            : 'skipped';

    return {
      kind: 'e2e',
      status,
      total,
      passed,
      failed,
      skipped,
      cases,
      summary: `Playwright E2E：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`,
    };
  }

  if (tapTests && (tapPass || tapFail)) {
    const passed = clampInt(Number(tapPass?.[1] ?? 0));
    const failed = clampInt(Number(tapFail?.[1] ?? 0));
    const skipped = clampInt(Number(tapSkip?.[1] ?? 0));
    const total = Math.max(clampInt(Number(tapTests[1])), passed + failed + skipped);

    const status =
      failed > 0 && passed > 0
        ? 'partial'
        : failed > 0
          ? 'failed'
          : passed > 0
            ? 'passed'
            : 'skipped';

    return {
      kind: 'unit',
      status,
      total,
      passed,
      failed,
      skipped,
      cases,
      summary: `自动化测试：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`,
    };
  }

  // 3. Fallback to real GitHub Actions workflow step verification outcomes (zero fabrication!)
  const meaningfulSteps = (params.steps || []).filter(
    (s) =>
      s.name &&
      !/^Set up job$|^Complete job$|^Post /i.test(s.name) &&
      s.status === 'completed'
  );

  if (meaningfulSteps.length > 0) {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const [idx, step] of meaningfulSteps.entries()) {
      if (step.conclusion === 'success') {
        passed += 1;
        cases.push({
          id: `step-${idx + 1}`,
          title: step.name,
          status: 'passed',
          durationMs: 0,
        });
      } else if (step.conclusion === 'skipped') {
        skipped += 1;
        cases.push({
          id: `step-${idx + 1}`,
          title: step.name,
          status: 'skipped',
          durationMs: 0,
        });
      } else {
        failed += 1;
        cases.push({
          id: `step-${idx + 1}`,
          title: step.name,
          status: 'failed',
          durationMs: 0,
          error: `Step conclusion: ${step.conclusion || 'failure'}`,
        });
      }
    }
    const total = passed + failed + skipped;
    const status =
      failed > 0 && passed > 0
        ? 'partial'
        : failed > 0
          ? 'failed'
          : passed > 0
            ? 'passed'
            : 'skipped';

    return {
      kind: 'build_check',
      status,
      total,
      passed,
      failed,
      skipped,
      cases,
      summary: `流水线步骤校验：${passed}/${total} 步通过${failed > 0 ? `，${failed} 步失败` : ''}`,
    };
  }

  const succeeded = params.conclusion === 'success';
  return {
    kind: 'build_check',
    status: succeeded ? 'passed' : 'failed',
    total: 1,
    passed: succeeded ? 1 : 0,
    failed: succeeded ? 0 : 1,
    skipped: 0,
    cases: [
      {
        id: 'workflow-overall',
        title: params.workflowName || 'Workflow Execution',
        status: succeeded ? 'passed' : 'failed',
        durationMs: 0,
        error: succeeded ? undefined : `Workflow conclusion: ${params.conclusion || 'failure'}`,
      },
    ],
    summary: succeeded ? '流水线整体执行通过' : `流水线执行异常 (${params.conclusion || 'failure'})`,
  };
}

/**
 * Normalizes a rule dedupeKey to lowercase kebab-case for reliable duplicate suppression.
 */
export function normalizeRuleDedupeKey(raw: string, fallbackTitle: string): string {
  const base = (raw || fallbackTitle || 'rule')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'rsi-rule';
}

export function clampDirectiveLength(directive: string): string {
  const cleaned = directive.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= RSI_BUDGET_LIMITS.maxDirectiveChars) return cleaned;
  return `${cleaned.slice(0, RSI_BUDGET_LIMITS.maxDirectiveChars - 1).trimEnd()}…`;
}

/**
 * Pure deterministic policy mapper that turns calibrated `gemini-decision-1`
 * outputs (`noul`, `choice`, `score`) into the final RSI governance action:
 * discard one-off edge cases, merge semantic duplicates, store moderate rules
 * as `candidate` (requiring >= 2 hits or manual promotion), or activate high-impact
 * guardrails immediately.
 */
export function evaluateRsiDecisionOutcome(gate: RsiDecisionGateResult): {
  shouldCodifyAsRule: boolean;
  outcome: 'discarded' | 'merged' | 'candidate_created' | 'active_created';
  initialStatus?: 'active' | 'candidate';
  mergeTargetRuleId?: string;
  policySummary: string;
} {
  const genPct = Math.round(gate.generalizableProb * 100);
  const dupPct = Math.round(gate.duplicateProb * 100);
  const scoreStr = gate.generalityScore.toFixed(2);

  // 1. Strict gate against one-off edge cases / transient noise
  if (
    gate.chosenAction === 'discard_edge_case' ||
    gate.generalizableProb < 0.62 ||
    gate.generalityScore < 1.25
  ) {
    return {
      shouldCodifyAsRule: false,
      outcome: 'discarded',
      policySummary: `Decision 门控拦截（通用性 ${genPct}% · 泛化评分 ${scoreStr}/3.0）：判定为偶发/单需求特例，不写入 System Prompt 防止规则膨胀。`,
    };
  }

  // 2. Semantic duplicate -> merge into existing rule instead of creating a new one
  if (
    gate.matchedRuleId &&
    (gate.chosenAction === 'merge_existing' ||
      (gate.duplicateProb >= 0.68 && (gate.matchedRuleConfidence ?? 0) >= 0.5))
  ) {
    return {
      shouldCodifyAsRule: true,
      outcome: 'merged',
      mergeTargetRuleId: gate.matchedRuleId,
      policySummary: `Decision 门控判定与现有规则语义重叠（重复度 ${dupPct}%），执行合并强化而非新增条目。`,
    };
  }

  // 3. High-impact systemic guardrail -> activate immediately
  if (
    gate.chosenAction === 'create_critical_active' &&
    gate.generalizableProb >= 0.78 &&
    gate.generalityScore >= 2.2
  ) {
    return {
      shouldCodifyAsRule: true,
      outcome: 'active_created',
      initialStatus: 'active',
      policySummary: `Decision 门控放行立即生效（通用性 ${genPct}% · 泛化评分 ${scoreStr}/3.0）：高危系统性工程防线，直接注入下游 Prompt。`,
    };
  }

  // 4. Moderate reusable lesson -> enter candidate observation pool (auto-promotes on 2nd hit)
  return {
    shouldCodifyAsRule: true,
    outcome: 'candidate_created',
    initialStatus: 'candidate',
    policySummary: `Decision 门控收入「待观察候选池」（通用性 ${genPct}% · 泛化评分 ${scoreStr}/3.0）：暂不占用注入预算，同类问题复发 ≥ 2 次或人工转正后自动生效。`,
  };
}

/**
 * Deduplicates or merges an incoming RSI rule candidate against existing rules.
 * - Matches by explicit semantic `explicitMergeRuleId` (from gemini-decision-1), `dedupeKey`, or title.
 * - Reinforces existing rules and auto-promotes `candidate` -> `active` once `hitCount >= 2`.
 */
export function mergeOrCreateRsiRule(params: {
  existingRules: RsiSystemRule[];
  candidate: {
    title: string;
    targetStage: RsiTargetStage;
    severity: RsiRuleSeverity;
    promptDirective: string;
    dedupeKey: string;
    rootCauseCategory: RsiRootCauseCategory;
  };
  incidentId: string;
  nowIso?: string;
  newId: string;
  initialStatus?: 'active' | 'candidate';
  explicitMergeRuleId?: string;
}): {
  action: 'merged' | 'created';
  promotedFromCandidate?: boolean;
  rule: RsiSystemRule;
  nextRules: RsiSystemRule[];
} {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const normalizedKey = normalizeRuleDedupeKey(params.candidate.dedupeKey, params.candidate.title);
  const cleanTitle = params.candidate.title.trim().slice(0, 60);
  const clampedDirective = clampDirectiveLength(params.candidate.promptDirective);

  let existingIdx = -1;
  if (params.explicitMergeRuleId) {
    existingIdx = params.existingRules.findIndex((r) => r.id === params.explicitMergeRuleId);
  }
  if (existingIdx === -1) {
    existingIdx = params.existingRules.findIndex(
      (r) =>
        r.dedupeKey === normalizedKey ||
        (r.targetStage === params.candidate.targetStage &&
          r.title.trim().toLowerCase() === cleanTitle.toLowerCase())
    );
  }

  if (existingIdx !== -1) {
    const prev = params.existingRules[existingIdx];
    const sourceIncidentIds = Array.from(new Set([...prev.sourceIncidentIds, params.incidentId]));
    const nextHitCount = prev.hitCount + 1;
    const promotedFromCandidate = prev.status === 'candidate' && nextHitCount >= 2;
    const nextStatus: RsiRuleStatus =
      prev.status === 'paused'
        ? 'paused'
        : prev.status === 'candidate'
          ? nextHitCount >= 2
            ? 'active'
            : 'candidate'
          : 'active';

    const updated: RsiSystemRule = {
      ...prev,
      severity:
        prev.severity === 'critical' || params.candidate.severity === 'critical'
          ? 'critical'
          : 'recommended',
      status: nextStatus,
      promptDirective:
        clampedDirective.length >= prev.promptDirective.length
          ? clampedDirective
          : clampDirectiveLength(prev.promptDirective),
      sourceIncidentIds,
      hitCount: nextHitCount,
      updatedAt: nowIso,
    };
    const nextRules = [...params.existingRules];
    nextRules[existingIdx] = updated;
    return {
      action: 'merged',
      promotedFromCandidate,
      rule: updated,
      nextRules: applyRsiLifecycleHygiene(nextRules, nowIso),
    };
  }

  const created: RsiSystemRule = {
    id: params.newId,
    dedupeKey: normalizedKey,
    title: cleanTitle,
    targetStage: params.candidate.targetStage,
    severity: params.candidate.severity,
    status: params.initialStatus ?? 'active',
    promptDirective: clampedDirective,
    rootCauseCategory: params.candidate.rootCauseCategory,
    sourceIncidentIds: [params.incidentId],
    hitCount: 1,
    appliedCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    action: 'created',
    rule: created,
    nextRules: applyRsiLifecycleHygiene([created, ...params.existingRules], nowIso),
  };
}

/**
 * Enforces anti-bloat lifecycle hygiene on the RSI rule pool:
 * 1. Auto-archives stale non-critical rules untouched for > 30 days with hitCount <= 1.
 * 2. Caps active pool at RSI_BUDGET_LIMITS.maxActiveRulesPool (20) by archiving the lowest-priority overflow.
 */
export function applyRsiLifecycleHygiene(
  rules: RsiSystemRule[],
  nowIso = new Date().toISOString()
): RsiSystemRule[] {
  const nowMs = Date.parse(nowIso) || Date.now();
  const staleCutoffMs = RSI_BUDGET_LIMITS.staleArchiveDays * 24 * 60 * 60 * 1000;

  const afterDecay = rules.map((r) => {
    if (r.status !== 'active') return r;
    const ageMs = nowMs - (Date.parse(r.updatedAt) || nowMs);
    if (r.severity !== 'critical' && r.hitCount <= 1 && ageMs > staleCutoffMs) {
      return { ...r, status: 'archived' as const };
    }
    return r;
  });

  const activeRanked = afterDecay
    .filter((r) => r.status === 'active')
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      if (a.hitCount !== b.hitCount) return b.hitCount - a.hitCount;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });

  if (activeRanked.length <= RSI_BUDGET_LIMITS.maxActiveRulesPool) {
    return afterDecay;
  }

  const keepIds = new Set(
    activeRanked.slice(0, RSI_BUDGET_LIMITS.maxActiveRulesPool).map((r) => r.id)
  );
  return afterDecay.map((r) =>
    r.status === 'active' && !keepIds.has(r.id) ? { ...r, status: 'archived' as const } : r
  );
}

/**
 * Selects active RSI System Prompt rules for a specific pipeline stage under strict
 * rule count AND total character budgets so prompts never bloat unboundedly.
 */
export function selectActiveRsiRulesForStage(
  rules: RsiSystemRule[],
  stage: Exclude<RsiTargetStage, 'all'>,
  maxRules = stage === 'coding' ? RSI_BUDGET_LIMITS.codingMaxRules : RSI_BUDGET_LIMITS.planningMaxRules,
  maxChars = stage === 'coding' ? RSI_BUDGET_LIMITS.codingMaxChars : RSI_BUDGET_LIMITS.planningMaxChars
): RsiSystemRule[] {
  const ranked = rules
    .filter((r) => r.status === 'active' && (r.targetStage === 'all' || r.targetStage === stage))
    .sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === 'critical' ? -1 : 1;
      }
      if (a.hitCount !== b.hitCount) {
        return b.hitCount - a.hitCount;
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });

  const chosen: RsiSystemRule[] = [];
  let charBudget = 0;

  for (const rule of ranked) {
    if (chosen.length >= maxRules) break;
    const ruleCost = rule.title.length + rule.promptDirective.length + 24;
    if (chosen.length > 0 && charBudget + ruleCost > maxChars) {
      continue;
    }
    chosen.push(rule);
    charBudget += ruleCost;
  }

  return chosen;
}

export function computeRsiPromptBudgetUsage(rules: RsiSystemRule[]): RsiPromptBudgetUsage {
  const activeRulesCount = rules.filter((r) => r.status === 'active').length;
  const candidateRulesCount = rules.filter((r) => r.status === 'candidate').length;
  const pausedRulesCount = rules.filter((r) => r.status === 'paused').length;
  const archivedRulesCount = rules.filter((r) => r.status === 'archived').length;

  const codingSelected = selectActiveRsiRulesForStage(rules, 'coding');
  const codingCharsUsed = codingSelected.reduce(
    (sum, r) => sum + r.title.length + r.promptDirective.length,
    0
  );

  return {
    activeRulesCount,
    candidateRulesCount,
    pausedRulesCount,
    archivedRulesCount,
    activePoolLimit: RSI_BUDGET_LIMITS.maxActiveRulesPool,
    codingInjectedRules: codingSelected.length,
    codingRulesLimit: RSI_BUDGET_LIMITS.codingMaxRules,
    codingCharsUsed,
    codingCharsLimit: RSI_BUDGET_LIMITS.codingMaxChars,
    planningRulesLimit: RSI_BUDGET_LIMITS.planningMaxRules,
    planningCharsLimit: RSI_BUDGET_LIMITS.planningMaxChars,
  };
}

/**
 * Formats active RSI rules into a deterministic System Prompt block injected into
 * Architect / QA Spec / QA Critic / Coding prompts.
 */
export function formatRsiPromptBlock(
  rules: RsiSystemRule[],
  stage: Exclude<RsiTargetStage, 'all'>
): string {
  const selected = selectActiveRsiRulesForStage(rules, stage);
  if (selected.length === 0) return '';

  const lines = selected.map((rule, idx) => {
    const tag = rule.severity === 'critical' ? '[CRITICAL]' : '[RECOMMENDED]';
    const cat = ROOT_CAUSE_LABELS[rule.rootCauseCategory] || rule.rootCauseCategory;
    return `${idx + 1}. ${tag} (${cat} · 触发 ${rule.hitCount} 次) ${rule.title}：${clampDirectiveLength(rule.promptDirective)}`;
  });

  return [
    `=== RSI 系统自进化强约束规则 (${TARGET_STAGE_LABELS[stage]} · 已自动注入 ${selected.length} 条历史经验) ===`,
    '以下规则均由系统经 Decision 门控筛选并从历史真实故障中提炼，本轮必须严格遵守以避免重复踩坑：',
    ...lines,
  ].join('\n');
}

/**
 * Generates docs/rsi-guidelines.md committed to feature branches so VPS AGY Coding Runner
 * automatically inherits all active coding & cross-cutting RSI system rules (within strict char & rule budgets).
 */
export function buildRsiGuidelinesMarkdown(rules: RsiSystemRule[]): string {
  const selected = selectActiveRsiRulesForStage(rules, 'coding');
  if (selected.length === 0) return '';

  const rows = selected.map((rule, idx) => {
    const sev = rule.severity === 'critical' ? 'CRITICAL' : 'RECOMMENDED';
    return [
      `### ${idx + 1}. [${sev}] ${rule.title}`,
      `- **分类**: ${ROOT_CAUSE_LABELS[rule.rootCauseCategory] || rule.rootCauseCategory} · **命中次数**: ${rule.hitCount}`,
      `- **强制指令**: ${clampDirectiveLength(rule.promptDirective)}`,
      '',
    ].join('\n');
  });

  return [
    '# AutoDev RSI Engineering Guardrails (Auto-Generated)',
    '',
    '> 本文档由 AutoDev Studio RSI 自进化闭环（经 gemini-decision-1 门控筛选）自动生成，严格受限于 Prompt 预算护栏。编码阶段必须严格遵守。',
    '',
    ...rows,
  ].join('\n');
}

/**
 * Builds chronological RSI self-evolution series pairing test success-rate progression
 * (individual run + 3-run rolling average) against cumulative & newly adopted active System Prompts.
 */
export function buildRsiEvolutionTrend(
  testReports: TestExecutionReport[],
  rules: RsiSystemRule[]
): RsiEvolutionTrendPoint[] {
  const adoptedRules = rules
    .filter((r) => r.status === 'active')
    .map((r) => ({
      ...r,
      adoptedAtMs: Date.parse(r.createdAt || r.updatedAt) || 0,
    }))
    .sort((a, b) => a.adoptedAtMs - b.adoptedAtMs);

  const sortedReports = [...testReports]
    .filter((r) => !Number.isNaN(Date.parse(r.executedAt)))
    .sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));

  const formatShortDate = (iso: string, fallback: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { dateKey: fallback, label: fallback };
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return { dateKey: `${mm}-${dd} ${hh}:${mi}`, label: `${mm}-${dd}` };
  };

  if (sortedReports.length === 0) {
    if (adoptedRules.length === 0) return [];
    // Group adopted rules by day when no test reports exist yet so prompt adoption still visualizes cleanly
    const byDay = new Map<string, { timestamp: string; count: number }>();
    for (const rule of adoptedRules) {
      const iso = rule.createdAt || rule.updatedAt;
      const d = new Date(iso);
      const dayKey = Number.isNaN(d.getTime())
        ? '规则'
        : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const existing = byDay.get(dayKey);
      if (existing) {
        existing.count += 1;
        existing.timestamp = iso;
      } else {
        byDay.set(dayKey, { timestamp: iso, count: 1 });
      }
    }
    let cumulative = 0;
    return Array.from(byDay.entries()).map(([dayKey, info], idx) => {
      cumulative += info.count;
      return {
        id: `evo-rule-${idx}`,
        dateKey: dayKey,
        label: dayKey,
        timestamp: info.timestamp,
        passRatePct: null,
        rollingSuccessRatePct: null,
        adoptedPromptsCumulative: cumulative,
        newlyAdoptedPrompts: info.count,
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
      };
    });
  }

  const recentReports = sortedReports.slice(-20);
  const points: RsiEvolutionTrendPoint[] = [];
  const rollingWindowRates: number[] = [];
  let prevCumulative = 0;

  for (let i = 0; i < recentReports.length; i++) {
    const r = recentReports[i];
    const tsMs = Date.parse(r.executedAt);
    const { dateKey, label } = formatShortDate(r.executedAt, `R${i + 1}`);
    const computedRate =
      typeof r.passRate === 'number' ? r.passRate : computePassRate(r.passed, r.failed);

    if (typeof computedRate === 'number') {
      rollingWindowRates.push(computedRate);
      if (rollingWindowRates.length > 3) {
        rollingWindowRates.shift();
      }
    }

    const rollingSuccessRatePct =
      rollingWindowRates.length > 0
        ? Math.round(
            rollingWindowRates.reduce((acc, v) => acc + v, 0) / rollingWindowRates.length
          )
        : null;

    const cumulativeAtRun = adoptedRules.filter((rule) => rule.adoptedAtMs <= tsMs).length;
    const newlyAdopted = Math.max(0, cumulativeAtRun - prevCumulative);
    prevCumulative = cumulativeAtRun;

    points.push({
      id: r.id,
      dateKey,
      label: r.actionsRunId ? `${label} #${String(r.actionsRunId).slice(-3)}` : label,
      timestamp: r.executedAt,
      passRatePct: computedRate,
      rollingSuccessRatePct,
      adoptedPromptsCumulative: cumulativeAtRun,
      newlyAdoptedPrompts: newlyAdopted,
      totalCases: r.total,
      passedCases: r.passed,
      failedCases: r.failed,
      branch: r.branch,
      workflowName: r.workflowName,
    });
  }

  // If newer active prompts were adopted AFTER the last test report, append a latest milestone point
  const totalAdoptedNow = adoptedRules.length;
  if (points.length > 0 && totalAdoptedNow > prevCumulative) {
    const latestRule = adoptedRules[adoptedRules.length - 1];
    const latestIso = latestRule.createdAt || latestRule.updatedAt;
    const { dateKey, label } = formatShortDate(latestIso, '最新');
    const lastPt = points[points.length - 1];
    points.push({
      id: `evo-latest-prompts`,
      dateKey,
      label: `${label} 进化`,
      timestamp: latestIso,
      passRatePct: lastPt.passRatePct,
      rollingSuccessRatePct: lastPt.rollingSuccessRatePct,
      adoptedPromptsCumulative: totalAdoptedNow,
      newlyAdoptedPrompts: totalAdoptedNow - prevCumulative,
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
    });
  }

  return points;
}

/**
 * Aggregates real test execution reports, failure incidents, and RSI rules into chart-ready data.
 */
export function aggregateQualityAndRsiMetrics(params: {
  testReports: TestExecutionReport[];
  incidents: FailureIncident[];
  rules: RsiSystemRule[];
}): {
  summary: QualityRsiSummary;
  testTrend: QualityTrendPoint[];
  evolutionTrend: RsiEvolutionTrendPoint[];
  rootCauseDistribution: RootCauseDistributionItem[];
} {
  const sortedReportsAsc = [...params.testReports].sort(
    (a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt)
  );

  let totalCases = 0;
  let passedCases = 0;
  let failedCases = 0;
  let skippedCases = 0;

  const testTrend: QualityTrendPoint[] = sortedReportsAsc.slice(-14).map((r, idx) => {
    const d = new Date(r.executedAt);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const dateKey = Number.isNaN(d.getTime()) ? `#${idx + 1}` : `${mm}-${dd} ${hh}:${mi}`;
    const shortLabel = r.actionsRunId
      ? `#${String(r.actionsRunId).slice(-4)}`
      : Number.isNaN(d.getTime())
        ? `R${idx + 1}`
        : `${mm}-${dd}`;

    return {
      id: r.id,
      label: shortLabel,
      dateKey,
      workflowName: r.workflowName,
      branch: r.branch,
      kind: r.kind,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      total: r.total,
      passRate: r.passRate,
      durationSec: Math.round((r.durationMs || 0) / 1000),
    };
  });

  for (const r of params.testReports) {
    totalCases += r.total;
    passedCases += r.passed;
    failedCases += r.failed;
    skippedCases += r.skipped;
  }

  const allCategories: RsiRootCauseCategory[] = [
    'test_assertion',
    'env_infra',
    'contract_mismatch',
    'ui_ux_acceptance',
    'build_typecheck',
    'ci_workflow',
  ];

  const countMap = new Map<RsiRootCauseCategory, { count: number; codified: number }>();
  for (const c of allCategories) {
    countMap.set(c, { count: 0, codified: 0 });
  }

  let analyzedIncidents = 0;
  let codifiedIncidents = 0;
  let ignoredTransientIncidents = 0;

  for (const inc of params.incidents) {
    if (inc.analysisStatus === 'analyzed' && inc.attribution) {
      analyzedIncidents += 1;
      if (inc.attribution.shouldCodifyAsRule) {
        codifiedIncidents += 1;
      } else {
        ignoredTransientIncidents += 1;
      }
      const slot = countMap.get(inc.attribution.rootCauseCategory);
      if (slot) {
        slot.count += 1;
        if (inc.attribution.shouldCodifyAsRule) slot.codified += 1;
      }
    }
  }

  const rootCauseDistribution: RootCauseDistributionItem[] = allCategories.map((cat) => {
    const slot = countMap.get(cat)!;
    return {
      category: cat,
      label: ROOT_CAUSE_LABELS[cat],
      count: slot.count,
      codifiedCount: slot.codified,
    };
  });

  const activeRules = params.rules.filter((r) => r.status === 'active');
  const candidateRules = params.rules.filter((r) => r.status === 'candidate');
  const archivedRules = params.rules.filter((r) => r.status === 'archived');
  const totalRuleApplications = params.rules.reduce((sum, r) => sum + (r.appliedCount || 0), 0);

  return {
    summary: {
      totalReports: params.testReports.length,
      totalCases,
      passedCases,
      failedCases,
      skippedCases,
      overallTestPassRate: computePassRate(passedCases, failedCases),
      totalIncidents: params.incidents.length,
      analyzedIncidents,
      codifiedIncidents,
      ignoredTransientIncidents,
      activeRulesCount: activeRules.length,
      candidateRulesCount: candidateRules.length,
      archivedRulesCount: archivedRules.length,
      totalRulesCount: params.rules.length,
      totalRuleApplications,
    },
    testTrend,
    evolutionTrend: buildRsiEvolutionTrend(params.testReports, params.rules),
    rootCauseDistribution,
  };
}
