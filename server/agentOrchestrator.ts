import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  ApiContract,
  ArchitectOutput,
  QaCriticOutput,
  QaSpecOutput,
} from '../src/types/autodev';
import { resolveEffectiveTechStack } from '../src/lib/workflowBuilder';
import { formatRsiPromptBlock } from '../src/lib/rsiEngine';
import { listAllRsiRules, recordRulesAppliedForStage } from './rsiStore';

export const GEMINI_AGENT_MODEL = 'gemini-4-hydrogen';
const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function createGeminiClient(): GoogleGenAI {
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

function formatGeminiError(rawMessage: string): string {
  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('403')
  ) {
    return 'Gemini API 鉴权失败（PERMISSION_DENIED / API_KEY_INVALID），请在 Settings > Secrets 面板检查 GEMINI_API_KEY。';
  }
  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return 'Gemini API 请求频率或配额超限（429 RESOURCE_EXHAUSTED），请稍后重试或在 Settings > Secrets 中配置更高配额的 API Key。';
  }
  if (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')) {
    return 'Gemini 上游推理节点当前处于高负载（503 UNAVAILABLE），请稍后点击重试。';
  }
  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed?.error?.message) {
      return `Gemini API 返回异常：${parsed.error.message}`;
    }
  } catch {
    // not JSON
  }
  return rawMessage;
}

async function generateStructuredJson<T>(params: {
  systemInstruction: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  onChunk?: (chunkText: string) => void;
}): Promise<T> {
  const ai = createGeminiClient();
  const attemptPlan: Array<{ model: string; thinkingLevel?: ThinkingLevel; delayBeforeMs: number }> = [
    { model: GEMINI_AGENT_MODEL, thinkingLevel: ThinkingLevel.MEDIUM, delayBeforeMs: 0 },
    { model: GEMINI_AGENT_MODEL, thinkingLevel: ThinkingLevel.MEDIUM, delayBeforeMs: 2500 },
    { model: GEMINI_FALLBACK_MODEL, delayBeforeMs: 1000 },
    { model: 'gemini-2.5-flash', delayBeforeMs: 1500 },
  ];

  let lastError: unknown;

  for (const step of attemptPlan) {
    if (step.delayBeforeMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.delayBeforeMs));
    }
    try {
      const stream = await ai.models.generateContentStream({
        model: step.model,
        contents: params.prompt,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
          ...(step.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: step.thinkingLevel } }
            : {}),
        },
      });

      let fullText = '';
      for await (const chunk of stream) {
        const piece = chunk.text ?? '';
        if (piece) {
          fullText += piece;
          params.onChunk?.(piece);
        }
      }

      const rawText = fullText.trim();
      if (!rawText) {
        throw new Error('Gemini 模型返回空响应，请稍后重试。');
      }
      return JSON.parse(rawText) as T;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('ECONNRESET') ||
        msg.includes('fetch failed');

      if (!isTransient) {
        throw new Error(formatGeminiError(msg));
      }
    }
  }

  const finalMsg = lastError instanceof Error ? lastError.message : 'Gemini API 调用失败';
  throw new Error(formatGeminiError(finalMsg));
}

export interface AgentRunInput {
  repoFullName: string;
  defaultBranch: string;
  prdTitle: string;
  prdContent: string;
  techStackHint?: string;
  repoContext?: import('../src/types/autodev').RepoContextSnapshot;
}

const ARCHITECT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: [
    'ambiguities',
    'architectureSummary',
    'techDecisions',
    'apiContracts',
    'tasks',
  ],
  properties: {
    ambiguities: {
      type: Type.ARRAY,
      description: 'Detected logical gaps, ambiguities, or undefined edge cases in the PRD.',
      items: {
        type: Type.OBJECT,
        required: ['id', 'severity', 'title', 'detail', 'clarificationSuggestion'],
        properties: {
          id: { type: Type.STRING, description: 'Unique identifier like AMB-01' },
          severity: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          clarificationSuggestion: { type: Type.STRING },
        },
      },
    },
    architectureSummary: {
      type: Type.STRING,
      description: 'Concise engineering architecture design covering data model, boundaries, and reliability.',
    },
    techDecisions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3 to 6 concrete technical design decisions.',
    },
    apiContracts: {
      type: Type.ARRAY,
      description: 'Explicit HTTP/RPC interface contracts derived from the PRD.',
      items: {
        type: Type.OBJECT,
        required: [
          'id',
          'method',
          'path',
          'summary',
          'requestSchema',
          'responseSchema',
          'errorCodes',
        ],
        properties: {
          id: { type: Type.STRING, description: 'Unique identifier like API-01' },
          method: {
            type: Type.STRING,
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          },
          path: { type: Type.STRING },
          summary: { type: Type.STRING },
          requestSchema: { type: Type.STRING },
          responseSchema: { type: Type.STRING },
          errorCodes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
    tasks: {
      type: Type.ARRAY,
      description: 'Atomic engineering tasks forming a valid DAG (no cycles).',
      items: {
        type: Type.OBJECT,
        required: [
          'id',
          'title',
          'module',
          'description',
          'dependsOn',
          'acceptanceCriteria',
          'estimatedComplexity',
        ],
        properties: {
          id: { type: Type.STRING, description: 'Unique identifier like T-01' },
          title: { type: Type.STRING },
          module: { type: Type.STRING },
          description: { type: Type.STRING },
          dependsOn: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          acceptanceCriteria: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          estimatedComplexity: {
            type: Type.STRING,
            enum: ['S', 'M', 'L'],
          },
        },
      },
    },
  },
};

const QA_SPEC_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['apiTestChecklist', 'e2eTestCode', 'coverageNotes'],
  properties: {
    apiTestChecklist: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['id', 'endpoint', 'method', 'scenario', 'expectedStatus', 'assertion'],
        properties: {
          id: { type: Type.STRING, description: 'Identifier like TC-API-01' },
          endpoint: { type: Type.STRING },
          method: { type: Type.STRING },
          scenario: { type: Type.STRING },
          expectedStatus: { type: Type.INTEGER },
          assertion: { type: Type.STRING },
        },
      },
    },
    e2eTestCode: {
      type: Type.STRING,
      description:
        'Directly runnable TypeScript Playwright E2E test file content importing { test, expect } from "@playwright/test".',
    },
    coverageNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
};

const QA_CRITIC_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['reviewSummary', 'findings', 'finalApiTestChecklist', 'finalE2eTestCode'],
  properties: {
    reviewSummary: {
      type: Type.STRING,
      description: 'Strict quality audit summary comparing initial vs hardened test suite.',
    },
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['id', 'category', 'severity', 'issue', 'recommendation'],
        properties: {
          id: { type: Type.STRING, description: 'Identifier like CRIT-01' },
          category: {
            type: Type.STRING,
            enum: ['boundary', 'invalid_input', 'ui_interaction', 'security', 'concurrency'],
          },
          severity: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
          issue: { type: Type.STRING },
          recommendation: { type: Type.STRING },
        },
      },
    },
    finalApiTestChecklist: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['id', 'endpoint', 'method', 'scenario', 'expectedStatus', 'assertion'],
        properties: {
          id: { type: Type.STRING },
          endpoint: { type: Type.STRING },
          method: { type: Type.STRING },
          scenario: { type: Type.STRING },
          expectedStatus: { type: Type.INTEGER },
          assertion: { type: Type.STRING },
        },
      },
    },
    finalE2eTestCode: {
      type: Type.STRING,
      description:
        'Revised, hardened, directly runnable Playwright TypeScript test suite incorporating all critic findings.',
    },
  },
};

export async function runArchitectAgent(
  input: AgentRunInput,
  onChunk?: (chunkText: string) => void
): Promise<ArchitectOutput> {
  const { formatRepoContextForPrompt } = await import('../src/lib/iterationContext');
  const { stack: effectiveStack, isDefaultCloudflare } = resolveEffectiveTechStack(
    input.techStackHint
  );

  const cloudflareConstraint = isDefaultCloudflare
    ? [
        '3) 默认部署架构强约束（Cloudflare 免费版全栈一键上线）：',
        '   - 除非 PRD 明确要求其他运行时，严禁选择 Go / Java / Python 或需要自建运维的独立 PostgreSQL / Redis 服务器；',
        '   - 统一采用 TypeScript 全栈架构：前端 React + Vite（通过 Cloudflare Workers Static Assets 托管），后端 API 使用 Hono 运行在 Cloudflare Workers，关系型持久化使用 Cloudflare D1 (SQLite) + SQL migrations，缓存/会话/频控使用 Cloudflare KV；',
        '   - 架构决策与原子任务清单中必须包含 `wrangler.toml` / `wrangler.jsonc` 配置、D1 表结构迁移脚本与 `npm run build` / `wrangler deploy` 验证标准，确保合并后可通过单个 `wrangler deploy` 一键上线。',
      ]
    : [
        `3) 技术栈约束：严格遵循用户指定的技术栈上下文（${effectiveStack}）进行架构设计与任务拆解。`,
      ];

  const rsiBlock = formatRsiPromptBlock(listAllRsiRules(), 'architect');
  if (rsiBlock) recordRulesAppliedForStage('architect');

  const systemInstruction = [
    '你是 AutoDev Studio 的首席系统架构师 (Architect Agent)。',
    '语言要求（必须严格遵守）：除代码标识符、包名、HTTP Method（GET/POST 等）、URL 路径、错误码及技术专有名词（如 Cloudflare Workers/D1/KV/Hono/React）外，所有文字字段（ambiguities.title/detail/clarificationSuggestion、architectureSummary、techDecisions、apiContracts.summary、tasks.title/module/description/acceptanceCriteria）必须全部使用自然流畅的简体中文编写，禁止输出大段英文描述！',
    '增量迭代强约束（若目标仓库已有代码）：',
    '- 必须充分尊重当前 main 分支已有的目录结构、技术栈配置、既有 API 路由与已应用的 D1 迁移脚本；',
    '- 严禁规划覆盖旧迁移文件（如已有 0001_init.sql 则新迁移必须从 0002_ 开始递增）；',
    '- 明确标注哪些接口/模块是增量新增、哪些需要兼容既有功能，严禁破坏已有功能或历史回归测试。',
    '你的职责分为严格的步骤：',
    '1) 先审查 PRD 是否存在明显逻辑漏洞、状态机缺失、边界未定义或业务歧义，列出具体澄清建议 (ambiguities，至少列出 2-5 条高质量洞察)；',
    '2) 基于目标仓库最新代码上下文与技术栈输出清晰可落地的技术架构方案 (architectureSummary, techDecisions)、明确的接口契约 (apiContracts) 以及带依赖关系的有向无环原子开发任务清单 (tasks，5-8 个原子任务，每个任务包含可验证的中文 acceptanceCriteria，dependsOn 必须引用已存在的任务 ID 且严禁出现环依赖)；',
    ...cloudflareConstraint,
    ...(rsiBlock ? ['', rsiBlock] : []),
  ].join('\n');

  const repoContextBlock = input.repoContext
    ? formatRepoContextForPrompt(input.repoContext, 'architect')
    : '';

  const prompt = [
    `目标仓库: ${input.repoFullName} (默认分支: ${input.defaultBranch})`,
    `目标技术栈与部署运行时: ${effectiveStack}`,
    `需求标题: ${input.prdTitle}`,
    ...(repoContextBlock ? ['', repoContextBlock] : []),
    '',
    '=== 本轮 PRD 需求正文 ===',
    input.prdContent,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return generateStructuredJson<ArchitectOutput>({
    systemInstruction,
    prompt,
    responseSchema: ARCHITECT_RESPONSE_SCHEMA,
    onChunk,
  });
}

export async function runQaSpecAgent(
  input: AgentRunInput,
  apiContracts: ApiContract[],
  onChunk?: (chunkText: string) => void
): Promise<QaSpecOutput> {
  const { formatRepoContextForPrompt } = await import('../src/lib/iterationContext');
  const rsiBlock = formatRsiPromptBlock(listAllRsiRules(), 'qa_spec');
  if (rsiBlock) recordRulesAppliedForStage('qa_spec');

  // Strictly isolated from Architect implementation details and internal task breakdown!
  const systemInstruction = [
    '你是 AutoDev Studio 的独立测试规格专家 (QA Spec Agent)。',
    '语言要求（必须严格遵守）：apiTestChecklist 的 scenario 与 assertion、coverageNotes 以及 Playwright 测试代码中的 test.describe / test 用例名和注释均使用简体中文。',
    '你遵循严格的“测试左移 + 实现细节隔离”原则：你只能看到原始 PRD、公开的接口契约 (apiContracts) 及公开的仓库契约上下文，看不到内部代码结构或研发任务拆解。',
    '本轮产出的测试脚本将保存在独立文件 `tests/e2e/<runId>.spec.ts` 中，与历次回归测试共存。',
    '请输出：',
    '1) 清晰的接口测试清单 (apiTestChecklist，覆盖正常流与基础异常码)；',
    '2) 可直接放入 `tests/e2e/<runId>.spec.ts` 运行的 Playwright TypeScript E2E 测试代码 (e2eTestCode)，使用 `import { test, expect } from "@playwright/test";`，优先使用语义化 locator（getByRole / getByLabel / getByTestId）与 Playwright request fixture；',
    '3) 测试覆盖说明 (coverageNotes)。',
    'Playwright 测试代码必须语法合法、结构完整、无省略号占位符。',
    ...(rsiBlock ? ['', rsiBlock] : []),
  ].join('\n');

  const repoContextBlock = input.repoContext
    ? formatRepoContextForPrompt(input.repoContext, 'qa')
    : '';

  const prompt = [
    `需求标题: ${input.prdTitle}`,
    ...(repoContextBlock ? ['', repoContextBlock] : []),
    '',
    '=== 原始 PRD ===',
    input.prdContent,
    '',
    '=== 公开接口契约 (API Contracts) ===',
    JSON.stringify(apiContracts, null, 2),
  ].join('\n');

  return generateStructuredJson<QaSpecOutput>({
    systemInstruction,
    prompt,
    responseSchema: QA_SPEC_RESPONSE_SCHEMA,
    onChunk,
  });
}

export async function runQaCriticAgent(
  input: AgentRunInput,
  apiContracts: ApiContract[],
  qaSpec: QaSpecOutput,
  onChunk?: (chunkText: string) => void
): Promise<QaCriticOutput> {
  const { formatRepoContextForPrompt } = await import('../src/lib/iterationContext');
  const rsiBlock = formatRsiPromptBlock(listAllRsiRules(), 'qa_critic');
  if (rsiBlock) recordRulesAppliedForStage('qa_critic');

  const systemInstruction = [
    '你是 AutoDev Studio 的独立测试评审官 (QA Critic Agent)。',
    '语言要求（必须严格遵守）：reviewSummary、findings.issue/recommendation、finalApiTestChecklist.scenario/assertion 以及 finalE2eTestCode 中的测试描述/注释全部使用简体中文！',
    '你的唯一目标是严格挑刺并加固上一步 QA Spec Agent 产出的测试用例，找出遗漏的边界条件 (boundary)、异常/恶意输入 (invalid_input)、UI 交互死角 (ui_interaction，例如双击防重、加载态、空状态、错误恢复、键盘提交)、并发竞态 (concurrency) 和权限/安全校验 (security)。',
    '同时注意：本轮测试文件归档为独立文件 `tests/e2e/<runId>.spec.ts`，与已有回归测试并行共存，确保测试数据隔离（使用唯一标识或清理），不污染历史回归测试。',
    '请输出：',
    '1) reviewSummary：客观指出初版测试集的核心盲区及本次加固后的提升；',
    '2) findings：列出 4-6 条高价值评审意见；',
    '3) finalApiTestChecklist：在初版基础上补全异常码与边界断言后的完整接口测试清单；',
    '4) finalE2eTestCode：在保留初版核心路径的基础上，将所有 findings 转化为真实可执行的 Playwright TypeScript 断言与边界测试用例，产出最终版只读 Playwright 完整代码（严禁使用 `// ... 省略`）。',
    ...(rsiBlock ? ['', rsiBlock] : []),
  ].join('\n');

  const repoContextBlock = input.repoContext
    ? formatRepoContextForPrompt(input.repoContext, 'qa')
    : '';

  const prompt = [
    `需求标题: ${input.prdTitle}`,
    ...(repoContextBlock ? ['', repoContextBlock] : []),
    '',
    '=== 原始 PRD ===',
    input.prdContent,
    '',
    '=== 接口契约 ===',
    JSON.stringify(apiContracts, null, 2),
    '',
    '=== QA Spec 初版接口测试清单 ===',
    JSON.stringify(qaSpec.apiTestChecklist, null, 2),
    '',
    '=== QA Spec 初版 Playwright E2E 脚本 ===',
    qaSpec.e2eTestCode,
  ].join('\n');

  return generateStructuredJson<QaCriticOutput>({
    systemInstruction,
    prompt,
    responseSchema: QA_CRITIC_RESPONSE_SCHEMA,
    onChunk,
  });
}

