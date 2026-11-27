import type { AgySessionSnapshot } from '../lib/sessionReuse';

export type { AgySessionSnapshot };

export type NavSectionId =
  | 'studio'
  | 'environment'
  | 'prd'
  | 'requirements'
  | 'pipeline'
  | 'approval'
  | 'quality';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  updatedAt: string;
  canPush: boolean;
}

export interface GitHubIntegrationStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
  user?: GitHubUser;
  repos: GitHubRepo[];
  checkedAt: string;
}

export interface CloudflareWorker {
  id: string;
  name: string;
  modifiedOn?: string;
  usageModel?: string;
}

export interface CloudflareWorkflow {
  name: string;
  scriptName?: string;
  className?: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface CloudflareKvNamespace {
  id: string;
  title: string;
  supportsUrlEncoding?: boolean;
}

export interface CloudflareIntegrationStatus {
  configured: boolean;
  connected: boolean;
  accountIdMasked?: string;
  tokenStatus?: string;
  error?: string;
  warnings?: string[];
  workers: CloudflareWorker[];
  workflows: CloudflareWorkflow[];
  kvNamespaces: CloudflareKvNamespace[];
  checkedAt: string;
}

export interface GeminiIntegrationStatus {
  configured: boolean;
  model: string;
  fallbackModel?: string;
  decisionModel?: string;
  checkedAt: string;
}

export interface ShushengIntegrationStatus {
  configured: boolean;
  connected: boolean;
  enabled?: boolean;
  providerName?: string;
  baseUrl: string;
  defaultModel: string;
  availableModels: string[];
  apiKeySource?: 'custom' | 'env' | 'none';
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

export interface FeishuIntegrationStatus {
  configured: boolean;
  hasAppCredentials: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
  hasDefaultChatId: boolean;
  hasActiveChat: boolean;
  eventsCallbackPath: string;
  cardCallbackPath: string;
  lastPushOk?: boolean;
  lastPushError?: string;
  lastPushAt?: string;
  checkedAt: string;
}

export interface IntegrationsStatusResponse {
  github: GitHubIntegrationStatus;
  cloudflare: CloudflareIntegrationStatus;
  gemini: GeminiIntegrationStatus;
  shusheng?: ShushengIntegrationStatus;
  feishu?: FeishuIntegrationStatus;
}

export interface SelectedTargetRepo {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  htmlUrl?: string;
  isLiveGitHub: boolean;
}

export type AmbiguitySeverity = 'high' | 'medium' | 'low';

export interface PrdAmbiguity {
  id: string;
  severity: AmbiguitySeverity;
  title: string;
  detail: string;
  clarificationSuggestion: string;
}

export interface ApiContract {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  requestSchema: string;
  responseSchema: string;
  errorCodes: string[];
}

export type TaskComplexity = 'S' | 'M' | 'L';

export interface AtomicTask {
  id: string;
  title: string;
  module: string;
  description: string;
  dependsOn: string[];
  acceptanceCriteria: string[];
  estimatedComplexity: TaskComplexity;
}

export interface ArchitectOutput {
  ambiguities: PrdAmbiguity[];
  architectureSummary: string;
  techDecisions: string[];
  apiContracts: ApiContract[];
  tasks: AtomicTask[];
}

export interface ApiTestCase {
  id: string;
  endpoint: string;
  method: string;
  scenario: string;
  expectedStatus: number;
  assertion: string;
}

export interface QaSpecOutput {
  apiTestChecklist: ApiTestCase[];
  e2eTestCode: string;
  coverageNotes: string[];
}

export type CriticFindingCategory =
  | 'boundary'
  | 'invalid_input'
  | 'ui_interaction'
  | 'security'
  | 'concurrency';

export interface CriticFinding {
  id: string;
  category: CriticFindingCategory;
  severity: AmbiguitySeverity;
  issue: string;
  recommendation: string;
}

export interface QaCriticOutput {
  reviewSummary: string;
  findings: CriticFinding[];
  finalApiTestChecklist: ApiTestCase[];
  finalE2eTestCode: string;
}

export type AgentStepId = 'architect' | 'qa_spec' | 'qa_critic';
export type AgentStepStatus = 'idle' | 'running' | 'completed' | 'error';

export interface AgentStepState {
  id: AgentStepId;
  label: string;
  roleTitle: string;
  status: AgentStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
}

export interface RepoMigrationSnippet {
  path: string;
  snippet: string;
}

export interface RepoContextSnapshot {
  repoFullName: string;
  branch: string;
  headSha: string;
  fetchedAt: string;
  isEmptyRepo: boolean;
  totalFiles: number;
  fileTree: string[];
  packageJsonSnippet?: string;
  wranglerConfigSnippet?: string;
  existingMigrations: RepoMigrationSnippet[];
  existingE2eTests: string[];
  previousSpecSummary?: string;
}

export interface OpenAutodevPrSummary {
  number: number;
  title: string;
  headBranch: string;
  baseBranch: string;
  htmlUrl: string;
  draft: boolean;
  updatedAt: string;
}

export interface SingleTaskLockReason {
  kind: 'analysis_running' | 'actions_running' | 'open_pr';
  title: string;
  detail: string;
  url?: string;
  prNumber?: number;
  branchName?: string;
}

export interface SingleTaskLockStatus {
  locked: boolean;
  reasons: SingleTaskLockReason[];
  openAutodevPrs: OpenAutodevPrSummary[];
  activeActionCount: number;
  runningAnalysisJobId?: string;
  repoContext?: RepoContextSnapshot;
  checkedAt: string;
}

export interface ReworkDispatchResult {
  dispatched: boolean;
  branchName: string;
  feedbackFilePath: string;
  feedbackCommitSha?: string;
  actionsUrl?: string;
  dispatchedAt: string;
  note: string;
  sessionMode?: 'resume' | 'fresh';
  resumeSessionId?: string;
  sessionReason?: string;
  error?: string;
}

export interface DraftPrResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
  baseBranch: string;
  commitSha: string;
  filesCommitted: string[];
  e2eTestPath?: string;
  e2eVaultPath?: string;
  archivedSpecPath?: string;
  createdAt: string;
  initializedEmptyRepo?: boolean;
}

export type PipelineRunStatus =
  | 'analyzed'
  | 'pr_created'
  | 'approved'
  | 'changes_requested';

export interface AgentLogEntry {
  id: string;
  runId: string;
  step: AgentStepId;
  kind: 'status' | 'chunk' | 'complete' | 'error';
  text: string;
  timestamp: string;
}

export interface PreviewDeployment {
  url: string;
  workerName: string;
  branchName: string;
  deployedAt: string;
  d1DatabaseName?: string;
  d1DatabaseId?: string;
  migrationsApplied?: boolean;
  commitSha?: string;
  isIsolatedPreview?: boolean;
  buildLogsUrl?: string;
  provider?: 'cloudflare_workers_builds' | 'direct_wrangler';
}

export interface MergedReleaseResult {
  mergedAt: string;
  mergeCommitSha: string;
  baseBranch: string;
  prNumber: number;
  prUrl: string;
  commitUrl: string;
  mergeMethod: 'squash' | 'merge' | 'rebase';
  alreadyMerged?: boolean;
  branchDeleted?: boolean;
}

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: 'reported' | 'estimated';
  model?: string;
}

export interface CodingAgentOutputSnapshot {
  content: string;
  commitSha?: string;
  model?: string;
  actionsRunId?: number;
  actionsUrl?: string;
  repairRounds?: number;
  capturedAt: string;
  tokenUsage?: TokenUsageSummary;
}

export type PipelineRunOrigin =
  | 'manual_prd'
  | 'feishu_prd'
  | 'user_feedback_batch'
  | 'prod_error_autofix';

export interface PipelineRun {
  id: string;
  createdAt: string;
  repoFullName: string;
  defaultBranch: string;
  prdTitle: string;
  prdContent: string;
  origin?: PipelineRunOrigin;
  linkedIssueNumbers?: number[];
  linkedIssueUrls?: string[];
  linkedFeedbackIds?: string[];
  linkedErrorGroupIds?: string[];
  techStackHint?: string;
  repoContext?: RepoContextSnapshot;
  architect: ArchitectOutput;
  qaSpec: QaSpecOutput;
  qaCritic: QaCriticOutput;
  status: PipelineRunStatus;
  draftPr?: DraftPrResult;
  previewDeployment?: PreviewDeployment;
  productionDeployment?: PreviewDeployment;
  mergedRelease?: MergedReleaseResult;
  lastRework?: ReworkDispatchResult;
  lastAgySession?: AgySessionSnapshot;
  latestCodingOutput?: CodingAgentOutputSnapshot;
  planTokenUsage?: TokenUsageSummary;
  planUpdatedAt?: string;
  checkedCriteriaIds?: string[];
  approvalNote?: string;
  approvedAt?: string;
  agentLogs?: AgentLogEntry[];
}

export interface GitHubActionRun {
  id: number;
  name: string;
  headBranch: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  targetBranch?: string;
  pipelineRunId?: string;
  jobId?: string;
  prNumber?: number;
}

export interface GitHubSelfHostedRunner {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline' | string;
  busy: boolean;
  labels: string[];
}

export type AnalysisJobStatus = 'running' | 'completed' | 'error';

export type AnalysisExecutionMode = 'vps_agy' | 'gemini_api';

export interface SignalPlanContext {
  origin: 'user_feedback_batch' | 'prod_error_autofix';
  batchId: string;
  feedbackIds?: string[];
  errorGroupIds?: string[];
  issueNumber?: number;
  issueUrl?: string;
  prTitlePrefix?: string;
  /** Defaults to false: stops at ST-01 (status='analyzed') for review & standard Draft PR creation, identical to user-created PRDs. */
  autoDispatchCoding?: boolean;
}

export interface AnalysisJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  repoFullName: string;
  defaultBranch: string;
  prdTitle: string;
  prdContent: string;
  techStackHint?: string;
  executionMode?: AnalysisExecutionMode;
  agyModel?: string;
  agyMode?: string;
  planActionsUrl?: string;
  planActionsRunId?: number;
  planChannelBranch?: string;
  planIssueNumber?: number;
  planStateCommentId?: number;
  planInputCommentId?: number;
  planMode?: 'unified_single_turn' | 'three_stage';
  tokenUsage?: TokenUsageSummary;
  repoContext?: RepoContextSnapshot;
  signalContext?: SignalPlanContext;
  status: AnalysisJobStatus;
  steps: AgentStepState[];
  architect?: ArchitectOutput;
  qaSpec?: QaSpecOutput;
  qaCritic?: QaCriticOutput;
  runId?: string;
  run?: PipelineRun;
  error?: string;
}

export interface ToastItem {
  id: string;
  type: 'error' | 'success' | 'info';
  title?: string;
  message: string;
}

export type AnalysisSseEvent =
  | { type: 'step_start'; step: AgentStepId; message: string; timestamp: string }
  | {
      type: 'step_complete';
      step: AgentStepId;
      durationMs: number;
      data: ArchitectOutput | QaSpecOutput | QaCriticOutput;
      timestamp: string;
    }
  | { type: 'pipeline_complete'; run: PipelineRun; timestamp: string }
  | { type: 'error'; step?: AgentStepId; message: string; timestamp: string };

export type BackgroundTaskKind =
  | 'create_draft_pr'
  | 'deploy_preview'
  | 'deploy_production'
  | 'approve_release'
  | 'request_rework'
  | 'rsi_sync'
  | 'rsi_analyze'
  | 'rsi_consolidate'
  | 'rsi_report_incident'
  | 'signals_triage'
  | 'signals_autofix'
  | 'state_sync'
  | 'admin_reset';

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed';

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  roomId: NavSectionId;
  status: BackgroundTaskStatus;
  progressMessage: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  runId?: string;
  repoFullName?: string;
  dedupeKey?: string;
  summary?: string;
  result?: Record<string, unknown>;
  error?: string;
}


