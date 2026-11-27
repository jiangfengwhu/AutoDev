import crypto from 'crypto';
import type { PipelineRun, PipelineRunOrigin } from '../types/autodev.ts';
import { buildPrArtifacts, type PrArtifacts } from './specBuilder.ts';

export type FeedbackStatus =
  | 'pending'
  | 'accepted_queued'
  | 'dispatched'
  | 'rejected_malicious'
  | 'rejected_invalid'
  | 'needs_manual_prd'
  | 'ignored';

export type FeedbackScopeChoice =
  | 'micro_tweak'
  | 'bug_report'
  | 'needs_full_prd'
  | 'reject_noise';

export interface FeedbackDecisionScores {
  injectionProb: number;
  maliciousProb: number;
  actionableProb: number;
  scopeChoice: FeedbackScopeChoice;
  scopeConfidence: number;
  priorityScore: number; // 0..3
  evaluatedAt: string;
}

export interface FeedbackRecord {
  id: string;
  createdAt: string;
  repoFullName: string;
  content: string;
  categoryHint?: string;
  pageRoute?: string;
  appVersion?: string;
  userAgent?: string;
  reporterHash?: string;
  metadata?: Record<string, string>;
  status: FeedbackStatus;
  decisionScores?: FeedbackDecisionScores;
  triageReason?: string;
  triageBatchId?: string;
  linkedIssueNumber?: number;
  linkedIssueUrl?: string;
  linkedRunId?: string;
  linkedPrNumber?: number;
  linkedPrUrl?: string;
  updatedAt: string;
}

export interface FeedbackTriageBatch {
  id: string;
  createdAt: string;
  trigger: 'cron' | 'manual';
  scannedCount: number;
  acceptedCount: number;
  rejectedMaliciousCount: number;
  rejectedInvalidCount: number;
  needsManualPrdCount: number;
  summary: string;
  feedbackIds: string[];
  status: 'completed_empty' | 'queued_for_agy' | 'dispatched' | 'failed';
  linkedIssueNumber?: number;
  linkedIssueUrl?: string;
  linkedRunId?: string;
  linkedPrNumber?: number;
  linkedPrUrl?: string;
  errorMessage?: string;
}

export type ProdErrorSource = 'frontend' | 'backend';

export type ProdErrorStatus =
  | 'new'
  | 'analyzing'
  | 'filtered_noise'
  | 'rejected_malicious'
  | 'queued_for_agy'
  | 'fixing'
  | 'pr_ready'
  | 'resolved'
  | 'ignored';

export interface ProdErrorDecisionScores {
  injectionProb: number;
  realBugProb: number;
  severityScore: number; // 0..3
  evaluatedAt: string;
}

export interface ProdErrorGroup {
  id: string;
  fingerprint: string;
  repoFullName: string;
  source: ProdErrorSource;
  errorName: string;
  rawMessageSample: string;
  normalizedMessage: string;
  topFrame: string;
  route: string;
  environment: string;
  httpStatus?: number;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  latestAppVersion?: string;
  sanitizedStackSample: string;
  recentRequestContext?: string;
  status: ProdErrorStatus;
  decisionScores?: ProdErrorDecisionScores;
  triageReason?: string;
  autofixBatchId?: string;
  linkedIssueNumber?: number;
  linkedIssueUrl?: string;
  linkedRunId?: string;
  linkedPrNumber?: number;
  linkedPrUrl?: string;
  lastDispatchedAt?: string;
  resolvedAt?: string;
  updatedAt: string;
}

export interface ProdErrorAutofixBatch {
  id: string;
  createdAt: string;
  updatedAt: string;
  trigger: 'auto_burst' | 'queue_drain' | 'manual';
  errorGroupIds: string[];
  errorFingerprints: string[];
  summary: string;
  status: 'queued_for_agy' | 'dispatched' | 'merged_into_active_pr' | 'failed';
  linkedIssueNumber?: number;
  linkedIssueUrl?: string;
  linkedRunId?: string;
  linkedPrNumber?: number;
  linkedPrUrl?: string;
  errorMessage?: string;
}

export interface MicroSpecTaskItem {
  id: string;
  title: string;
  module: 'frontend' | 'backend' | 'database' | 'shared';
  description: string;
  filesHint: string[];
  acceptanceCriteria: string[];
}

export interface MicroSpecDraft {
  title: string;
  summary: string;
  rootCauseOrContext: string;
  nonGoals: string[];
  tasks: MicroSpecTaskItem[];
  verificationChecklist: string[];
  riskNotes: string[];
}

export interface SignalsSummary {
  pendingFeedbackCount: number;
  acceptedFeedbackCount: number;
  blockedFeedbackCount: number;
  manualPrdFeedbackCount: number;
  activeErrorGroupsCount: number;
  queuedErrorGroupsCount: number;
  fixingErrorGroupsCount: number;
  totalErrorOccurrences: number;
  lastDailyTriageAt: string | null;
  activeAutofixPrNumber: number | null;
  activeAutofixPrUrl: string | null;
}

export interface SignalsIntegrationConfigStatus {
  ingestTokenConfigured: boolean;
  cronSecretConfigured: boolean;
  appBaseUrl: string;
  targetAppUrl: string;
  lastPullSyncAt: string | null;
  repoFullName: string;
  burstDebounceSec: number;
  maxErrorsPerBatch: number;
  infraSync?: {
    syncedAt: string;
    workflowSynced: boolean;
    githubSecretsUpdated: string[];
    githubSecretsSkippedReason?: string;
    cloudflareSecretsUpdated: string[];
    studioUrl: string;
    errors: string[];
  } | null;
}

export interface SignalsDashboardPayload {
  feedback: FeedbackRecord[];
  feedbackBatches: FeedbackTriageBatch[];
  prodErrors: ProdErrorGroup[];
  errorBatches: ProdErrorAutofixBatch[];
  summary: SignalsSummary;
  config: SignalsIntegrationConfigStatus;
}

export const MAX_SIGNAL_PAYLOAD_BYTES = 32 * 1024;
export const DEFAULT_ERROR_BURST_DEBOUNCE_MS = 15_000;
export const MAX_ERRORS_PER_CONSOLIDATED_PR = 15;
export const MAX_FEEDBACK_PER_DAILY_BATCH = 20;
export const ERROR_REOPEN_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Scrub common secrets, bearer tokens, cookies, API keys, emails, and phone numbers
 * before persisting any externally-ingested text to GitHub or sending to models.
 */
export function redactSensitiveText(input: string, maxLength = 4000): string {
  let out = String(input ?? '').replace(/\u0000/g, '').trim();
  if (!out) return '';

  const patterns: Array<[RegExp, string]> = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [REDACTED]'],
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GH_TOKEN]'],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]'],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_SECRET_KEY]'],
    [/\b(cookie|set-cookie|authorization|x-api-key|x-autodev-ingest-token)\s*[:=]\s*[^\r\n;]{4,}/gi, '$1: [REDACTED]'],
    [/([?&](?:token|key|api_key|apikey|secret|auth|password|passwd|session)=)[^&\s#]+/gi, '$1[REDACTED]'],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
    [/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[REDACTED_PHONE]'],
  ];

  for (const [regex, replacement] of patterns) {
    out = out.replace(regex, replacement);
  }

  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength)}\n...[truncated]`;
  }
  return out;
}

export function hashAnonymousReporter(rawIdentifier?: string): string | undefined {
  const clean = String(rawIdentifier ?? '').trim();
  if (!clean) return undefined;
  const digest = crypto.createHash('sha256').update(`autodev-reporter:${clean}`).digest('hex').slice(0, 12);
  return `u_${digest}`;
}

export function normalizeRouteTemplate(rawRoute?: string): string {
  let clean = String(rawRoute ?? '').trim();
  if (!clean) return '/';
  // Strip protocol + origin if full URL was sent
  clean = clean.replace(/^https?:\/\/[^/]+/i, '');
  // Strip query string and hash
  clean = clean.split(/[?#]/)[0] || '/';
  // Normalize UUIDs, long hex hashes, and pure numeric path segments
  clean = clean
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:hash')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
  return clean.slice(0, 180) || '/';
}

export function normalizeErrorMessage(rawMessage: string): string {
  let msg = redactSensitiveText(rawMessage, 500);
  msg = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<ts>')
    .replace(/https?:\/\/[^\s)'"]+/gi, (url) => normalizeRouteTemplate(url))
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
  return msg.slice(0, 260) || 'UnknownError';
}

export function extractTopAppFrame(stack?: string): string {
  const raw = String(stack ?? '').trim();
  if (!raw) return 'no-stack';

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const frameLines = lines.filter(
    (l) => l.startsWith('at ') || /@\S+:\d+/.test(l) || /\.(?:tsx?|jsx?|mjs|cjs):\d+/.test(l)
  );
  const candidates = frameLines.length > 0 ? frameLines : lines.slice(1);

  for (const line of candidates) {
    const lower = line.toLowerCase();
    if (
      lower.includes('node_modules') ||
      lower.includes('node:internal') ||
      lower.includes('chrome-extension://') ||
      lower.includes('moz-extension://') ||
      lower.includes('safari-extension://')
    ) {
      continue;
    }
    // Strip volatile bundle hashes and exact column numbers so the same bug maps cleanly
    const cleaned = line
      .replace(/https?:\/\/[^/]+/gi, '')
      .replace(/-[A-Za-z0-9_-]{6,12}\.(js|mjs|css)/g, '.$1')
      .replace(/:\d+:\d+\)?$/g, '')
      .replace(/:\d+\)?$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) {
      return cleaned.slice(0, 180);
    }
  }

  return (candidates[0] || 'unknown-frame').slice(0, 180);
}

export function computeProdErrorFingerprint(input: {
  source: ProdErrorSource;
  errorName: string;
  message: string;
  stack?: string;
  route?: string;
}): {
  fingerprint: string;
  normalizedMessage: string;
  topFrame: string;
  route: string;
} {
  const normalizedMessage = normalizeErrorMessage(input.message);
  const topFrame = extractTopAppFrame(input.stack);
  const route = normalizeRouteTemplate(input.route);
  const errorName = String(input.errorName || 'Error').trim().slice(0, 80) || 'Error';

  const basis = [input.source, errorName.toLowerCase(), normalizedMessage.toLowerCase(), topFrame.toLowerCase(), route.toLowerCase()].join('|');
  const fingerprint = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);

  return {
    fingerprint,
    normalizedMessage,
    topFrame,
    route,
  };
}

export function detectObviousErrorNoise(input: {
  source: ProdErrorSource;
  errorName: string;
  message: string;
  stack?: string;
}): { isNoise: boolean; reason?: string } {
  const msg = String(input.message || '').trim();
  const stack = String(input.stack || '').trim();
  const combined = `${input.errorName} ${msg} ${stack}`.toLowerCase();

  if (
    combined.includes('chrome-extension://') ||
    combined.includes('moz-extension://') ||
    combined.includes('safari-extension://') ||
    combined.includes('safari-web-extension://')
  ) {
    return { isNoise: true, reason: '第三方浏览器插件引发的脚本错误，非应用代码缺陷' };
  }

  if (
    msg === 'Script error.' &&
    (!stack || stack === 'no-stack' || stack.length < 12)
  ) {
    return { isNoise: true, reason: '跨域匿名 Script error. 且缺少堆栈上下文，无法定位应用代码' };
  }

  if (
    combined.includes('resizeobserver loop limit exceeded') ||
    combined.includes('resizeobserver loop completed with undelivered notifications')
  ) {
    return { isNoise: true, reason: '浏览器 ResizeObserver 良性布局通知噪音' };
  }

  if (
    input.source === 'frontend' &&
    (input.errorName === 'AbortError' || combined.includes('the user aborted a request'))
  ) {
    return { isNoise: true, reason: '用户主动取消页面跳转或请求中断（AbortError）' };
  }

  return { isNoise: false };
}

export interface ValidatedFeedbackInput {
  content: string;
  categoryHint?: string;
  pageRoute?: string;
  appVersion?: string;
  userAgent?: string;
  reporterHash?: string;
  metadata?: Record<string, string>;
}

export function validateFeedbackPayload(
  rawBody: unknown
): { ok: true; data: ValidatedFeedbackInput } | { ok: false; error: string } {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, error: '请求体必须为 JSON 对象' };
  }
  const body = rawBody as Record<string, unknown>;
  const rawContent = typeof body.content === 'string'
    ? body.content
    : typeof body.message === 'string'
      ? body.message
      : '';
  const content = redactSensitiveText(rawContent, 2000);
  if (content.length < 3) {
    return { ok: false, error: '反馈内容不能为空且至少需要 3 个字符' };
  }

  const categoryHint = typeof body.category === 'string'
    ? redactSensitiveText(body.category, 60)
    : typeof body.categoryHint === 'string'
      ? redactSensitiveText(body.categoryHint, 60)
      : undefined;
  const pageRoute = typeof body.pageRoute === 'string'
    ? normalizeRouteTemplate(body.pageRoute)
    : typeof body.route === 'string'
      ? normalizeRouteTemplate(body.route)
      : typeof body.url === 'string'
        ? normalizeRouteTemplate(body.url)
        : undefined;
  const appVersion = typeof body.appVersion === 'string'
    ? redactSensitiveText(body.appVersion, 60)
    : typeof body.version === 'string'
      ? redactSensitiveText(body.version, 60)
      : undefined;
  const userAgent = typeof body.userAgent === 'string'
    ? redactSensitiveText(body.userAgent, 200)
    : undefined;
  const reporterRaw =
    typeof body.userId === 'string'
      ? body.userId
      : typeof body.reporterId === 'string'
        ? body.reporterId
        : undefined;
  const reporterHash = hashAnonymousReporter(reporterRaw);

  let metadata: Record<string, string> | undefined;
  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
    const entries = Object.entries(body.metadata as Record<string, unknown>).slice(0, 12);
    const cleaned: Record<string, string> = {};
    for (const [k, v] of entries) {
      const safeKey = String(k).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
      if (!safeKey) continue;
      if (/(token|secret|password|cookie|authorization|key)/i.test(safeKey)) continue;
      cleaned[safeKey] = redactSensitiveText(typeof v === 'string' ? v : JSON.stringify(v), 200);
    }
    if (Object.keys(cleaned).length > 0) {
      metadata = cleaned;
    }
  }

  return {
    ok: true,
    data: {
      content,
      categoryHint: categoryHint || undefined,
      pageRoute,
      appVersion: appVersion || undefined,
      userAgent: userAgent || undefined,
      reporterHash,
      metadata,
    },
  };
}

export interface ValidatedProdErrorInput {
  source: ProdErrorSource;
  errorName: string;
  message: string;
  stack: string;
  route: string;
  environment: string;
  appVersion?: string;
  httpStatus?: number;
  requestContext?: string;
}

export function validateProdErrorPayload(
  rawBody: unknown
): { ok: true; data: ValidatedProdErrorInput } | { ok: false; error: string } {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, error: '请求体必须为 JSON 对象' };
  }
  const body = rawBody as Record<string, unknown>;
  const source: ProdErrorSource = body.source === 'backend' ? 'backend' : 'frontend';
  const rawMessage = typeof body.message === 'string'
    ? body.message
    : typeof body.errorMessage === 'string'
      ? body.errorMessage
      : '';
  const message = redactSensitiveText(rawMessage, 1200);
  if (message.length < 2) {
    return { ok: false, error: '报错 message 不能为空' };
  }

  const errorName = redactSensitiveText(
    typeof body.errorName === 'string'
      ? body.errorName
      : typeof body.name === 'string'
        ? body.name
        : 'Error',
    80
  ) || 'Error';

  const stack = redactSensitiveText(
    typeof body.stack === 'string' ? body.stack : '',
    4000
  );
  const route = normalizeRouteTemplate(
    typeof body.route === 'string'
      ? body.route
      : typeof body.url === 'string'
        ? body.url
        : '/'
  );
  const environment = redactSensitiveText(
    typeof body.environment === 'string' ? body.environment : 'production',
    40
  ) || 'production';
  const appVersion = typeof body.appVersion === 'string'
    ? redactSensitiveText(body.appVersion, 60)
    : typeof body.version === 'string'
      ? redactSensitiveText(body.version, 60)
      : undefined;
  const httpStatusNum = Number(body.httpStatus ?? body.statusCode);
  const httpStatus = Number.isFinite(httpStatusNum) && httpStatusNum >= 100 && httpStatusNum <= 599
    ? Math.trunc(httpStatusNum)
    : undefined;

  let requestContext: string | undefined;
  if (typeof body.requestContext === 'string') {
    requestContext = redactSensitiveText(body.requestContext, 1200);
  } else if (body.requestContext && typeof body.requestContext === 'object') {
    requestContext = redactSensitiveText(JSON.stringify(body.requestContext), 1200);
  }

  return {
    ok: true,
    data: {
      source,
      errorName,
      message,
      stack,
      route,
      environment,
      appVersion: appVersion || undefined,
      httpStatus,
      requestContext: requestContext || undefined,
    },
  };
}

export interface ErrorAutofixStrategyInput {
  /** Currently open (unmerged, unclosed) PipelineRun originated from prod_error_autofix, if any */
  activeAutofixRun?: PipelineRun;
  /** Whether the single-task serial lock is currently held by ANY other PR or active AGY run */
  serialLockBusy: boolean;
  /** Whether an AGY workflow run is currently executing on the active autofix PR branch */
  activeAutofixAgyRunning: boolean;
  /** Eligible error groups waiting to be dispatched (status 'queued_for_agy' or newly verified) */
  eligibleGroups: ProdErrorGroup[];
  /** Maximum error fingerprints to bundle into a single consolidated PR */
  maxPerBatch?: number;
}

export type ErrorAutofixStrategyResult =
  | { action: 'noop'; selectedGroups: [] }
  | {
      action: 'append_to_active_pr';
      targetRun: PipelineRun;
      selectedGroups: ProdErrorGroup[];
      dispatchNow: boolean;
    }
  | {
      action: 'queue_behind_lock';
      selectedGroups: ProdErrorGroup[];
    }
  | {
      action: 'create_consolidated_pr';
      selectedGroups: ProdErrorGroup[];
    };

/**
 * Enforces the SINGLE_ACTIVE_AUTOFIX_PR invariant:
 * - Never opens multiple PRs when an error storm hits.
 * - If an active open prod_error_autofix PR exists, merges all new eligible errors into THAT single PR.
 * - If another non-autofix task holds the serial lock, queues all eligible errors so they merge into 1 PR once idle.
 * - Otherwise bundles all eligible errors (sorted by severity + occurrenceCount) into 1 consolidated Bug-Fix PR.
 */
export function selectErrorAutofixStrategy(
  input: ErrorAutofixStrategyInput
): ErrorAutofixStrategyResult {
  const maxPerBatch = Math.max(1, input.maxPerBatch ?? MAX_ERRORS_PER_CONSOLIDATED_PR);
  const sorted = [...input.eligibleGroups].sort((a, b) => {
    const sevDiff = (b.decisionScores?.severityScore ?? 1) - (a.decisionScores?.severityScore ?? 1);
    if (Math.abs(sevDiff) > 0.15) return sevDiff;
    if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });

  const selected = sorted.slice(0, maxPerBatch);
  if (selected.length === 0) {
    return { action: 'noop', selectedGroups: [] };
  }

  if (
    input.activeAutofixRun &&
    input.activeAutofixRun.draftPr &&
    input.activeAutofixRun.status !== 'approved' &&
    !input.activeAutofixRun.mergedRelease
  ) {
    return {
      action: 'append_to_active_pr',
      targetRun: input.activeAutofixRun,
      selectedGroups: selected,
      dispatchNow: !input.activeAutofixAgyRunning,
    };
  }

  if (input.serialLockBusy) {
    return {
      action: 'queue_behind_lock',
      selectedGroups: selected,
    };
  }

  return {
    action: 'create_consolidated_pr',
    selectedGroups: selected,
  };
}

/**
 * Builds a complete PipelineRun + PrArtifacts from a sanitized MicroSpecDraft
 * (bypassing the heavy 3-Agent planning pipeline while remaining 100% compatible with
 * createSpecDraftPr, autodev-agy.yml, ST-04 ApprovalView, and Feishu notifications).
 */
export function buildMicroSpecRunAndArtifacts(params: {
  runId: string;
  repoFullName: string;
  defaultBranch: string;
  origin: Extract<PipelineRunOrigin, 'user_feedback_batch' | 'prod_error_autofix'>;
  specDraft: MicroSpecDraft;
  issueNumber?: number;
  issueUrl?: string;
  sourceItemSummaryLines: string[];
}): { run: PipelineRun; artifacts: PrArtifacts } {
  const nowIso = new Date().toISOString();
  const originLabel =
    params.origin === 'prod_error_autofix' ? '线上报错自动修复' : '用户反馈每日直通迭代';

  const prdSections = [
    `# ${params.specDraft.title}`,
    ``,
    `> 来源：AutoDev ${originLabel}（跳过前置 3-Agent 重策划，由 AI 安全消毒后直通 AGY 编码）`,
    params.issueNumber && params.issueUrl
      ? `> 关联追踪 Issue：[#${params.issueNumber}](${params.issueUrl})`
      : '',
    ``,
    `## 摘要与目标`,
    params.specDraft.summary,
    ``,
    `## 背景与根因分析`,
    params.specDraft.rootCauseOrContext,
    ``,
    `## 合并涵盖的信号清单（已脱敏与防注入消毒）`,
    ...params.sourceItemSummaryLines.map((line) => `- ${line}`),
    ``,
    `## 明确改动边界（Non-Goals）`,
    ...(params.specDraft.nonGoals.length > 0
      ? params.specDraft.nonGoals.map((g) => `- ${g}`)
      : ['- 严禁修改与本次修复/微调无关的核心业务逻辑与数据库表结构']),
    ``,
    `## 验收核对标准`,
    ...params.specDraft.verificationChecklist.map((c, idx) => `${idx + 1}. ${c}`),
  ].filter(Boolean);

  const prdContent = prdSections.join('\n');

  const tasks = params.specDraft.tasks.map((t, idx) => ({
    id: t.id || `T${idx + 1}`,
    title: t.title,
    module: t.module,
    description:
      t.filesHint.length > 0
        ? `${t.description}（相关文件提示：${t.filesHint.join(', ')}）`
        : t.description,
    dependsOn: idx === 0 ? [] : [params.specDraft.tasks[idx - 1]?.id || `T${idx}`],
    acceptanceCriteria: t.acceptanceCriteria,
    estimatedComplexity: 'S' as const,
  }));

  const checklist = params.specDraft.verificationChecklist.map((c, idx) => ({
    id: `AC-${idx + 1}`,
    endpoint: params.origin === 'prod_error_autofix' ? 'BUGFIX-VERIFY' : 'FEEDBACK-VERIFY',
    method: 'VERIFY',
    scenario: c,
    expectedStatus: 200,
    assertion: c,
  }));

  const run: PipelineRun = {
    id: params.runId,
    createdAt: nowIso,
    repoFullName: params.repoFullName,
    defaultBranch: params.defaultBranch,
    prdTitle: params.specDraft.title,
    prdContent,
    origin: params.origin,
    linkedIssueNumbers: params.issueNumber ? [params.issueNumber] : undefined,
    linkedIssueUrls: params.issueUrl ? [params.issueUrl] : undefined,
    architect: {
      architectureSummary: `[${originLabel}] ${params.specDraft.summary}`,
      techDecisions: [
        '采用轻量 Micro-Spec 直通模式：保持最小化改动面，优先确保回归安全与构建通过。',
        ...(params.specDraft.riskNotes.slice(0, 3)),
      ],
      ambiguities: [],
      apiContracts: [],
      tasks,
    },
    qaSpec: {
      e2eTestCode: '',
      apiTestChecklist: checklist,
      coverageNotes: [
        `由 ${originLabel} 轻量规格自动生成，共 ${checklist.length} 项核心验收核对标准。`,
      ],
    },
    qaCritic: {
      reviewSummary: `已完成双层 AI 安全消毒与范围校验（跳过重策划），共拆解 ${tasks.length} 项精简改动任务。`,
      findings: [],
      finalE2eTestCode: '',
      finalApiTestChecklist: checklist,
    },
    status: 'analyzed',
  };

  const artifacts = buildPrArtifacts(run);
  if (params.issueNumber) {
    artifacts.prBody = `${artifacts.prBody.trimEnd()}\n\nFixes #${params.issueNumber}\n`;
  }
  return { run, artifacts };
}

export function buildSignalsSummary(
  feedback: FeedbackRecord[],
  prodErrors: ProdErrorGroup[],
  feedbackBatches: FeedbackTriageBatch[],
  activeAutofixRun?: PipelineRun
): SignalsSummary {
  let pendingFeedbackCount = 0;
  let acceptedFeedbackCount = 0;
  let blockedFeedbackCount = 0;
  let manualPrdFeedbackCount = 0;

  for (const f of feedback) {
    if (f.status === 'pending') pendingFeedbackCount += 1;
    else if (f.status === 'accepted_queued' || f.status === 'dispatched') acceptedFeedbackCount += 1;
    else if (f.status === 'rejected_malicious' || f.status === 'rejected_invalid') blockedFeedbackCount += 1;
    else if (f.status === 'needs_manual_prd') manualPrdFeedbackCount += 1;
  }

  let activeErrorGroupsCount = 0;
  let queuedErrorGroupsCount = 0;
  let fixingErrorGroupsCount = 0;
  let totalErrorOccurrences = 0;

  for (const e of prodErrors) {
    totalErrorOccurrences += e.occurrenceCount;
    if (e.status === 'new' || e.status === 'analyzing' || e.status === 'queued_for_agy' || e.status === 'fixing' || e.status === 'pr_ready') {
      activeErrorGroupsCount += 1;
    }
    if (e.status === 'queued_for_agy') queuedErrorGroupsCount += 1;
    if (e.status === 'fixing' || e.status === 'pr_ready') fixingErrorGroupsCount += 1;
  }

  return {
    pendingFeedbackCount,
    acceptedFeedbackCount,
    blockedFeedbackCount,
    manualPrdFeedbackCount,
    activeErrorGroupsCount,
    queuedErrorGroupsCount,
    fixingErrorGroupsCount,
    totalErrorOccurrences,
    lastDailyTriageAt: feedbackBatches[0]?.createdAt ?? null,
    activeAutofixPrNumber: activeAutofixRun?.draftPr?.prNumber ?? null,
    activeAutofixPrUrl: activeAutofixRun?.draftPr?.prUrl ?? null,
  };
}
