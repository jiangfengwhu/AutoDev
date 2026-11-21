import type {
  AgentStepId,
  AgentStepStatus,
  ArchitectOutput,
  QaCriticOutput,
  QaSpecOutput,
  TokenUsageSummary,
} from '../types/autodev';

export const AUTODEV_PLAN_WORKFLOW_PATH = '.github/workflows/autodev-plan.yml';
export const AUTODEV_PLAN_CHANNEL_BRANCH = 'autodev-plan-channel';
export const AUTODEV_PLAN_ISSUE_TITLE = '[AutoDev] AGY Plan Artifacts';

export type PlanArtifactFile = 'input.json' | 'state.json' | 'architect.json' | 'qa_spec.json' | 'qa_critic.json';

export function getPlanArtifactPath(jobId: string, file: PlanArtifactFile): string {
  const safeJobId = jobId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `.autodev-plans/${safeJobId}/${file}`;
}

export interface PlanInputPayload {
  jobId: string;
  repoFullName: string;
  baseBranch: string;
  prdTitle: string;
  prdContent: string;
  techStackHint?: string;
  effectiveTechStack: string;
  isDefaultCloudflare: boolean;
  agyModel: string;
  createdAt: string;
  rsiSystemPrompts?: {
    architect: string;
    qa_spec: string;
    qa_critic: string;
  };
}

export interface PlanRemoteStepState {
  status: AgentStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
}

export interface PlanRemoteState {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  updatedAt: string;
  headSha?: string;
  actionsRunId?: number;
  actionsUrl?: string;
  model?: string;
  mode?: 'unified_single_turn' | 'three_stage';
  tokenUsage?: TokenUsageSummary;
  error?: string;
  steps: Record<AgentStepId, PlanRemoteStepState>;
  outputFiles?: Partial<Record<AgentStepId, string>>;
  outputCommentIds?: Partial<Record<AgentStepId, number>>;
}

function sanitizeFenceContent(text: string): string {
  return text.replace(/~~~~/g, '----');
}

function extractFencedJson(body: string): string | null {
  const tildeMatch = body.match(/~~~~json\s*\n([\s\S]*?)\n~~~~/);
  if (tildeMatch) return tildeMatch[1].trim();
  const backtickMatch = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (backtickMatch) return backtickMatch[1].trim();
  return null;
}

export function formatPlanInputComment(payload: PlanInputPayload): string {
  const marker = `<!-- AUTODEV-PLAN-INPUT:${payload.jobId} -->`;
  const json = sanitizeFenceContent(JSON.stringify(payload, null, 2));
  return [
    marker,
    `### AutoDev Plan Input (${payload.jobId})`,
    `- 需求标题: ${payload.prdTitle}`,
    `- 模型: \`${payload.agyModel}\``,
    '',
    '~~~~json',
    json,
    '~~~~',
  ].join('\n');
}

export function parsePlanInputComment(body: string): PlanInputPayload | null {
  const raw = extractFencedJson(body);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlanInputPayload;
    if (!parsed || typeof parsed.jobId !== 'string' || typeof parsed.prdTitle !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatPlanStateComment(state: PlanRemoteState): string {
  const marker = `<!-- AUTODEV-PLAN-STATE:${state.jobId} -->`;
  const json = sanitizeFenceContent(JSON.stringify(state, null, 2));
  return [
    marker,
    `### AutoDev AGY Plan State (${state.jobId})`,
    `- Status: \`${state.status}\``,
    `- Updated: ${state.updatedAt}`,
    '',
    '~~~~json',
    json,
    '~~~~',
  ].join('\n');
}

export function parsePlanStateComment(body: string): PlanRemoteState | null {
  const raw = extractFencedJson(body);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlanRemoteState;
    if (!parsed || typeof parsed.jobId !== 'string' || !parsed.steps) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatPlanStageOutputComment(
  jobId: string,
  stage: AgentStepId,
  data: ArchitectOutput | QaSpecOutput | QaCriticOutput
): string {
  const marker = `<!-- AUTODEV-PLAN-OUTPUT:${jobId}:${stage} -->`;
  const json = sanitizeFenceContent(JSON.stringify(data));
  return [
    marker,
    `### AutoDev Plan Stage Output: ${stage} (${jobId})`,
    '',
    '~~~~json',
    json,
    '~~~~',
  ].join('\n');
}

export function parsePlanStageOutputComment<T>(body: string): T | null {
  const raw = extractFencedJson(body);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty output');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try fenced code block
    const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
    if (fenced) {
      return JSON.parse(fenced[1].trim());
    }
    // Try outermost braces
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error('No valid JSON object found in output');
  }
}

export function validateArchitectOutput(
  raw: unknown
): { ok: true; data: ArchitectOutput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Root output must be a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.architectureSummary !== 'string' || !obj.architectureSummary.trim()) {
    return { ok: false, error: 'Missing non-empty string "architectureSummary".' };
  }
  if (!Array.isArray(obj.ambiguities)) {
    return { ok: false, error: '"ambiguities" must be an array.' };
  }
  if (!Array.isArray(obj.techDecisions)) {
    return { ok: false, error: '"techDecisions" must be an array of strings.' };
  }
  if (!Array.isArray(obj.apiContracts)) {
    return { ok: false, error: '"apiContracts" must be an array.' };
  }
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) {
    return { ok: false, error: '"tasks" must be a non-empty array of atomic tasks.' };
  }

  const validMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const validSeverities = new Set(['high', 'medium', 'low']);
  const validComplexity = new Set(['S', 'M', 'L']);

  const ambiguities = obj.ambiguities.map((a, idx) => {
    const item = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    const sev = typeof item.severity === 'string' && validSeverities.has(item.severity)
      ? (item.severity as 'high' | 'medium' | 'low')
      : 'medium';
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `AMB-${idx + 1}`,
      severity: sev,
      title: typeof item.title === 'string' ? item.title : '需求待澄清项',
      detail: typeof item.detail === 'string' ? item.detail : '',
      clarificationSuggestion:
        typeof item.clarificationSuggestion === 'string' ? item.clarificationSuggestion : '',
    };
  });

  const apiContracts = obj.apiContracts.map((c, idx) => {
    const item = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const methodRaw = typeof item.method === 'string' ? item.method.toUpperCase() : 'GET';
    const method = (validMethods.has(methodRaw) ? methodRaw : 'GET') as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'PATCH'
      | 'DELETE';
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `API-${idx + 1}`,
      method,
      path: typeof item.path === 'string' ? item.path : '/api/unknown',
      summary: typeof item.summary === 'string' ? item.summary : '',
      requestSchema: typeof item.requestSchema === 'string' ? item.requestSchema : '{}',
      responseSchema: typeof item.responseSchema === 'string' ? item.responseSchema : '{}',
      errorCodes: Array.isArray(item.errorCodes)
        ? item.errorCodes.map((e) => String(e))
        : ['400', '500'],
    };
  });

  const tasks = obj.tasks.map((t, idx) => {
    const item = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const compRaw =
      typeof item.estimatedComplexity === 'string' ? item.estimatedComplexity.toUpperCase() : 'M';
    const estimatedComplexity = (validComplexity.has(compRaw) ? compRaw : 'M') as 'S' | 'M' | 'L';
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `T-${idx + 1}`,
      title: typeof item.title === 'string' ? item.title : `任务 ${idx + 1}`,
      module: typeof item.module === 'string' ? item.module : 'app',
      description: typeof item.description === 'string' ? item.description : '',
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map((d) => String(d)) : [],
      acceptanceCriteria: Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length > 0
        ? item.acceptanceCriteria.map((ac) => String(ac))
        : ['功能按需求正常工作并通过自动化测试'],
      estimatedComplexity,
    };
  });

  return {
    ok: true,
    data: {
      ambiguities,
      architectureSummary: obj.architectureSummary.trim(),
      techDecisions: obj.techDecisions.map((d) => String(d)),
      apiContracts,
      tasks,
    },
  };
}

export function validateQaSpecOutput(
  raw: unknown
): { ok: true; data: QaSpecOutput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Root output must be a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.e2eTestCode !== 'string' || !obj.e2eTestCode.trim()) {
    return { ok: false, error: 'Missing non-empty string "e2eTestCode".' };
  }
  if (!Array.isArray(obj.apiTestChecklist)) {
    return { ok: false, error: '"apiTestChecklist" must be an array.' };
  }

  const apiTestChecklist = obj.apiTestChecklist.map((tc, idx) => {
    const item = (tc && typeof tc === 'object' ? tc : {}) as Record<string, unknown>;
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `TC-${idx + 1}`,
      endpoint: typeof item.endpoint === 'string' ? item.endpoint : '/api',
      method: typeof item.method === 'string' ? item.method.toUpperCase() : 'GET',
      scenario: typeof item.scenario === 'string' ? item.scenario : '',
      expectedStatus: Number.isFinite(Number(item.expectedStatus))
        ? Number(item.expectedStatus)
        : 200,
      assertion: typeof item.assertion === 'string' ? item.assertion : '',
    };
  });

  const coverageNotes = Array.isArray(obj.coverageNotes)
    ? obj.coverageNotes.map((n) => String(n))
    : [];

  return {
    ok: true,
    data: {
      apiTestChecklist,
      e2eTestCode: obj.e2eTestCode,
      coverageNotes,
    },
  };
}

export function validateQaCriticOutput(
  raw: unknown
): { ok: true; data: QaCriticOutput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Root output must be a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.reviewSummary !== 'string' || !obj.reviewSummary.trim()) {
    return { ok: false, error: 'Missing non-empty string "reviewSummary".' };
  }
  if (typeof obj.finalE2eTestCode !== 'string' || !obj.finalE2eTestCode.trim()) {
    return { ok: false, error: 'Missing non-empty string "finalE2eTestCode".' };
  }
  if (!Array.isArray(obj.findings)) {
    return { ok: false, error: '"findings" must be an array.' };
  }
  if (!Array.isArray(obj.finalApiTestChecklist)) {
    return { ok: false, error: '"finalApiTestChecklist" must be an array.' };
  }

  const validCats = new Set(['boundary', 'invalid_input', 'ui_interaction', 'security', 'concurrency']);
  const validSeverities = new Set(['high', 'medium', 'low']);

  const findings = obj.findings.map((f, idx) => {
    const item = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const cat = typeof item.category === 'string' && validCats.has(item.category)
      ? (item.category as 'boundary' | 'invalid_input' | 'ui_interaction' | 'security' | 'concurrency')
      : 'boundary';
    const sev = typeof item.severity === 'string' && validSeverities.has(item.severity)
      ? (item.severity as 'high' | 'medium' | 'low')
      : 'medium';
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `CRIT-${idx + 1}`,
      category: cat,
      severity: sev,
      issue: typeof item.issue === 'string' ? item.issue : '',
      recommendation: typeof item.recommendation === 'string' ? item.recommendation : '',
    };
  });

  const finalApiTestChecklist = obj.finalApiTestChecklist.map((tc, idx) => {
    const item = (tc && typeof tc === 'object' ? tc : {}) as Record<string, unknown>;
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `TC-${idx + 1}`,
      endpoint: typeof item.endpoint === 'string' ? item.endpoint : '/api',
      method: typeof item.method === 'string' ? item.method.toUpperCase() : 'GET',
      scenario: typeof item.scenario === 'string' ? item.scenario : '',
      expectedStatus: Number.isFinite(Number(item.expectedStatus))
        ? Number(item.expectedStatus)
        : 200,
      assertion: typeof item.assertion === 'string' ? item.assertion : '',
    };
  });

  return {
    ok: true,
    data: {
      reviewSummary: obj.reviewSummary.trim(),
      findings,
      finalApiTestChecklist,
      finalE2eTestCode: obj.finalE2eTestCode,
    },
  };
}
