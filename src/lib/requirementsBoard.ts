import type { AnalysisJob, PipelineRun } from '../types/autodev.ts';
import type { TestExecutionReport } from './rsiEngine.ts';
import { sanitizeCodingChatOutput } from './codingChatOutput.ts';

export type AuditLogCategory = 'planning' | 'execution' | 'approval' | 'quality';

export type AuditActionType =
  | 'prd_analysis_started'
  | 'prd_analysis_cancelled'
  | 'plan_edited'
  | 'draft_pr_created'
  | 'agy_coding_dispatched'
  | 'actions_run_cancelled'
  | 'preview_deployed'
  | 'production_deployed'
  | 'cf_actions_deploy_dispatched'
  | 'acceptance_checklist_updated'
  | 'release_approved'
  | 'revision_requested'
  | 'rsi_sync_triggered'
  | 'rsi_incident_reported'
  | 'rsi_rule_mutated'
  | 'user_feedback_ingested'
  | 'daily_feedback_batch_dispatched'
  | 'feedback_direct_dispatched'
  | 'prod_error_new_fingerprint'
  | 'prod_error_occurrence_recorded'
  | 'prod_error_merged_into_active_pr'
  | 'prod_error_autofix_dispatched'
  | 'atd_v1_feedback_reply_bridge_synced'
  | 'atd_v1_feedback_post_replied'
  | 'feedback_plan_to_code_dispatched'
  | 'signal_full_plan_failed'
  | 'prod_error_merge_plan_started'
  | 'prod_error_full_plan_started'
  | 'daily_feedback_full_plan_started'
  | 'feedback_direct_full_plan_started'
  | 'ai_model_config_updated';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: AuditLogCategory;
  action: AuditActionType;
  label: string;
  actor: string;
  repoFullName: string;
  runId?: string;
  jobId?: string;
  prdTitle?: string;
  branch?: string;
  prNumber?: number;
  status: 'success' | 'failed';
  detail: string;
  synthetic?: boolean;
}

export type RequirementBoardStatus =
  | 'analyzing'
  | 'analysis_failed'
  | 'analyzed'
  | 'pr_created'
  | 'changes_requested'
  | 'approved'
  | 'merged';

export interface RequirementBoardItem {
  id: string;
  runId?: string;
  jobId?: string;
  title: string;
  prdPreview: string;
  repoFullName: string;
  defaultBranch: string;
  branchName?: string;
  status: RequirementBoardStatus;
  executionMode?: 'vps_agy' | 'gemini_api';
  agyModel?: string;
  prNumber?: number;
  prUrl?: string;
  previewUrl?: string;
  productionUrl?: string;
  mergedCommitSha?: string;
  mergedCommitUrl?: string;
  mergedBaseBranch?: string;
  tasksCount: number;
  apiContractsCount: number;
  checkedCriteriaCount: number;
  totalCriteriaCount: number;
  acceptanceProgressPct: number | null;
  reworkCount: number;
  lastReworkBranch?: string;
  lastReworkNote?: string;
  approvalNote?: string;
  analysisError?: string;
  latestTestPassRate: number | null;
  latestTestPassed: number;
  latestTestFailed: number;
  latestTestSummary?: string;
  hasCodingOutput?: boolean;
  latestCodingOutputPreview?: string;
  latestCodingCommitSha?: string;
  repairRounds?: number;
  totalTokens?: number;
  createdAt: string;
  updatedAt: string;
  auditEvents: AuditLogEntry[];
}

export interface RequirementStatusBucket {
  key: string;
  label: string;
  count: number;
  color: string;
}

export interface DailyRequirementActivityPoint {
  dateKey: string;
  label: string;
  planning: number;
  execution: number;
  approval: number;
  quality: number;
  totalActions: number;
  newRequirements: number;
}

export interface RequirementsBoardSummary {
  totalRequirements: number;
  inProgressCount: number;
  pendingApprovalCount: number;
  reworkRequestedCount: number;
  deliveredCount: number;
  mergedCount: number;
  failedAnalysisCount: number;
  deliveryRatePct: number | null;
  firstPassAcceptanceRatePct: number | null;
  totalManualActions: number;
  last7dRequirements: number;
  lastActionAt?: string;
}

export interface RequirementsBoardPayload {
  generatedAt: string;
  summary: RequirementsBoardSummary;
  statusDistribution: RequirementStatusBucket[];
  dailyActivity: DailyRequirementActivityPoint[];
  requirements: RequirementBoardItem[];
  auditLogs: AuditLogEntry[];
}

export const AUDIT_CATEGORY_LABELS: Record<AuditLogCategory, string> = {
  planning: '规划与 PR',
  execution: '执行与部署',
  approval: '验收与审批',
  quality: '质量与 RSI',
};

export const AUDIT_ACTION_LABELS: Record<AuditActionType, string> = {
  prd_analysis_started: '发起需求规划',
  prd_analysis_cancelled: '取消需求规划',
  plan_edited: '编辑需求规划方案',
  draft_pr_created: '创建规格 Draft PR',
  agy_coding_dispatched: '派发 AGY 编码执行',
  actions_run_cancelled: '取消 Actions 任务',
  preview_deployed: '部署隔离预览环境',
  production_deployed: '部署正式生产环境',
  cf_actions_deploy_dispatched: '派发 Cloudflare 部署',
  acceptance_checklist_updated: '更新验收清单勾选',
  release_approved: '验收通过并批准上线',
  revision_requested: '退回修订（原分支返工）',
  rsi_sync_triggered: '同步测试报告与归因',
  rsi_incident_reported: '手动上报异常事件',
  rsi_rule_mutated: '维护 RSI 规则库',
  user_feedback_ingested: '采集线上用户反馈',
  daily_feedback_batch_dispatched: '每日反馈合批直通编码',
  feedback_direct_dispatched: '用户反馈一键直派编码',
  prod_error_new_fingerprint: '捕获新线上报错指纹',
  prod_error_occurrence_recorded: '线上报错复发计数',
  prod_error_merged_into_active_pr: '合并线上报错至进行中 PR',
  prod_error_autofix_dispatched: '派发线上报错自愈修复',
  atd_v1_feedback_reply_bridge_synced: '同步 atd-v1 官方反馈回帖桥接',
  atd_v1_feedback_post_replied: '自动以 @官方反馈 回复社区原帖',
  feedback_plan_to_code_dispatched: '反馈策划完成并自动派发编码',
  signal_full_plan_failed: '线上信号完整策划失败回退',
  prod_error_merge_plan_started: '线上报错增量策划（合入活跃 PR）',
  prod_error_full_plan_started: '线上报错启动完整架构策划',
  daily_feedback_full_plan_started: '每日反馈合批启动完整策划',
  feedback_direct_full_plan_started: '单条反馈启动完整策划',
  ai_model_config_updated: '更新 AI 模型与容灾配置',
};

export const REQUIREMENT_STATUS_META: Record<
  RequirementBoardStatus,
  { label: string; colorClass: string; hex: string }
> = {
  analyzing: { label: 'AI 规划中', colorClass: 'text-[#58A6FF]', hex: '#58A6FF' },
  analysis_failed: { label: '规划中断', colorClass: 'text-[#F85149]', hex: '#F85149' },
  analyzed: { label: '待创建 PR', colorClass: 'text-[#8B949E]', hex: '#8B949E' },
  pr_created: { label: '开发 / 待验收', colorClass: 'text-[#58A6FF]', hex: '#58A6FF' },
  changes_requested: { label: '退回修订中', colorClass: 'text-[#D29922]', hex: '#D29922' },
  approved: { label: '已批准上线', colorClass: 'text-[#3FB950]', hex: '#3FB950' },
  merged: { label: '已合入上线', colorClass: 'text-[#3FB950]', hex: '#2EA043' },
};

function toDateKeyInOffset(iso: string, tzOffsetMinutes: number): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolveRequirementStatus(run: PipelineRun): RequirementBoardStatus {
  if (run.mergedRelease) return 'merged';
  if (run.status === 'approved') return 'approved';
  if (run.status === 'changes_requested') return 'changes_requested';
  if (run.draftPr || run.status === 'pr_created') return 'pr_created';
  return 'analyzed';
}

/**
 * Synthesizes baseline historical events from persisted PipelineRuns and AnalysisJobs
 * so existing requirements prior to live audit logging still have an accurate timeline.
 */
export function synthesizeBaselineAuditEvents(params: {
  runs: PipelineRun[];
  jobs: AnalysisJob[];
  existingAuditLogs: AuditLogEntry[];
}): AuditLogEntry[] {
  const synthetic: AuditLogEntry[] = [];
  const realKeys = new Set(
    params.existingAuditLogs.map(
      (e) => `${e.action}::${e.runId || ''}::${e.jobId || ''}::${e.prNumber || ''}`
    )
  );

  for (const job of params.jobs) {
    const key = `prd_analysis_started::${job.runId || ''}::${job.id}::`;
    if (!realKeys.has(key)) {
      synthetic.push({
        id: `hist-job-${job.id}`,
        timestamp: job.createdAt,
        category: 'planning',
        action: 'prd_analysis_started',
        label: AUDIT_ACTION_LABELS.prd_analysis_started,
        actor: '控制面操作员',
        repoFullName: job.repoFullName,
        runId: job.runId,
        jobId: job.id,
        prdTitle: job.prdTitle,
        branch: job.defaultBranch,
        status: job.status === 'error' ? 'failed' : 'success',
        detail: `${job.executionMode === 'gemini_api' ? 'Gemini API' : 'Instabox VPS AGY'} ${
          job.planMode === 'unified_single_turn' ? '单对话联合规划' : '三阶段规划'
        }${job.agyModel ? ` (${job.agyModel})` : ''}`,
        synthetic: true,
      });
    }
  }

  for (const run of params.runs) {
    if (run.draftPr) {
      const key = `draft_pr_created::${run.id}::::${run.draftPr.prNumber}`;
      if (!realKeys.has(key)) {
        synthetic.push({
          id: `hist-pr-${run.id}-${run.draftPr.prNumber}`,
          timestamp: run.draftPr.createdAt || run.createdAt,
          category: 'planning',
          action: 'draft_pr_created',
          label: AUDIT_ACTION_LABELS.draft_pr_created,
          actor: '控制面操作员',
          repoFullName: run.repoFullName,
          runId: run.id,
          prdTitle: run.prdTitle,
          branch: run.draftPr.branchName,
          prNumber: run.draftPr.prNumber,
          status: 'success',
          detail: `创建 Draft PR #${run.draftPr.prNumber}，特性分支 ${run.draftPr.branchName}`,
          synthetic: true,
        });
      }
    }

    if (run.previewDeployment) {
      const key = `preview_deployed::${run.id}::::${run.draftPr?.prNumber || ''}`;
      if (!realKeys.has(key)) {
        synthetic.push({
          id: `hist-preview-${run.id}`,
          timestamp: run.previewDeployment.deployedAt || run.createdAt,
          category: 'execution',
          action: 'preview_deployed',
          label: AUDIT_ACTION_LABELS.preview_deployed,
          actor: '控制面操作员',
          repoFullName: run.repoFullName,
          runId: run.id,
          prdTitle: run.prdTitle,
          branch: run.previewDeployment.branchName,
          prNumber: run.draftPr?.prNumber,
          status: 'success',
          detail: `发布预览 Worker ${run.previewDeployment.workerName} (${run.previewDeployment.url})`,
          synthetic: true,
        });
      }
    }

    if (run.lastRework) {
      const key = `revision_requested::${run.id}::::${run.draftPr?.prNumber || ''}`;
      if (!realKeys.has(key)) {
        synthetic.push({
          id: `hist-rework-${run.id}`,
          timestamp: run.lastRework.dispatchedAt || run.approvedAt || run.createdAt,
          category: 'approval',
          action: 'revision_requested',
          label: AUDIT_ACTION_LABELS.revision_requested,
          actor: '验收审批人',
          repoFullName: run.repoFullName,
          runId: run.id,
          prdTitle: run.prdTitle,
          branch: run.lastRework.branchName,
          prNumber: run.draftPr?.prNumber,
          status: run.lastRework.dispatched ? 'success' : 'failed',
          detail: `在原需求分支 ${run.lastRework.branchName} 写入修改意见并派发返工${
            run.lastRework.note ? `：${run.lastRework.note}` : ''
          }`,
          synthetic: true,
        });
      }
    }

    if (run.mergedRelease || run.status === 'approved') {
      const key = `release_approved::${run.id}::::${run.draftPr?.prNumber || ''}`;
      if (!realKeys.has(key)) {
        synthetic.push({
          id: `hist-approve-${run.id}`,
          timestamp: run.mergedRelease?.mergedAt || run.approvedAt || run.createdAt,
          category: 'approval',
          action: 'release_approved',
          label: AUDIT_ACTION_LABELS.release_approved,
          actor: '验收审批人',
          repoFullName: run.repoFullName,
          runId: run.id,
          prdTitle: run.prdTitle,
          branch: run.mergedRelease?.baseBranch || run.draftPr?.branchName || run.defaultBranch,
          prNumber: run.draftPr?.prNumber,
          status: 'success',
          detail: run.mergedRelease
            ? `验收通过并合入 ${run.mergedRelease.baseBranch} (${run.mergedRelease.mergeCommitSha.slice(0, 7)})`
            : `验收通过${run.approvalNote ? `：${run.approvalNote}` : ''}`,
          synthetic: true,
        });
      }
    }
  }

  return [...params.existingAuditLogs, ...synthetic].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
  );
}

/**
 * Unifies PipelineRuns, AnalysisJobs, AuditLogs, and TestExecutionReports into a complete
 * Requirements Board payload with KPI summary, status distribution, and 7-day activity trends.
 */
export function buildRequirementsBoardData(params: {
  runs: PipelineRun[];
  jobs: AnalysisJob[];
  auditLogs: AuditLogEntry[];
  testReports: TestExecutionReport[];
  now?: Date;
  timezoneOffsetMinutes?: number;
}): RequirementsBoardPayload {
  const now = params.now ?? new Date();
  const tzOffset = params.timezoneOffsetMinutes ?? 480;

  const combinedLogs = synthesizeBaselineAuditEvents({
    runs: params.runs,
    jobs: params.jobs,
    existingAuditLogs: params.auditLogs,
  });

  const jobByRunId = new Map<string, AnalysisJob>();
  const standaloneJobs: AnalysisJob[] = [];
  for (const job of params.jobs) {
    if (job.runId) {
      if (!jobByRunId.has(job.runId)) {
        jobByRunId.set(job.runId, job);
      }
    } else {
      standaloneJobs.push(job);
    }
  }

  const reportsByRunId = new Map<string, TestExecutionReport[]>();
  const reportsByBranch = new Map<string, TestExecutionReport[]>();
  for (const report of params.testReports) {
    if (report.pipelineRunId) {
      const list = reportsByRunId.get(report.pipelineRunId) ?? [];
      list.push(report);
      reportsByRunId.set(report.pipelineRunId, list);
    }
    if (report.branch) {
      const list = reportsByBranch.get(report.branch) ?? [];
      list.push(report);
      reportsByBranch.set(report.branch, list);
    }
  }

  const items: RequirementBoardItem[] = [];

  for (const run of params.runs) {
    const linkedJob = jobByRunId.get(run.id);
    const branchName = run.draftPr?.branchName;
    const matchedEvents = combinedLogs.filter(
      (e) =>
        e.runId === run.id ||
        (linkedJob && e.jobId === linkedJob.id) ||
        (branchName && e.branch === branchName)
    );

    const matchedReports =
      reportsByRunId.get(run.id) ?? (branchName ? reportsByBranch.get(branchName) : undefined) ?? [];
    const latestReport = matchedReports[0];

    const totalCriteriaCount = run.architect.tasks.reduce(
      (acc, t) => acc + (t.acceptanceCriteria?.length ?? 0),
      0
    );
    const checkedCriteriaCount = (run.checkedCriteriaIds ?? []).length;
    const acceptanceProgressPct =
      totalCriteriaCount > 0
        ? Math.min(100, Math.round((checkedCriteriaCount / totalCriteriaCount) * 100))
        : null;

    const reworkEventsCount = matchedEvents.filter((e) => e.action === 'revision_requested').length;
    const reworkCount = Math.max(reworkEventsCount, run.lastRework ? 1 : 0);

    const candidateTimestamps = [
      run.createdAt,
      run.draftPr?.createdAt,
      run.previewDeployment?.deployedAt,
      run.lastRework?.dispatchedAt,
      run.approvedAt,
      run.mergedRelease?.mergedAt,
      matchedEvents[0]?.timestamp,
    ].filter((t): t is string => Boolean(t && Number.isFinite(Date.parse(t))));
    const updatedAt =
      candidateTimestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || run.createdAt;

    const rawCodingText = (
      run.latestCodingOutput?.content ||
      matchedReports.find((r) => Boolean(r.codingFinalOutput?.trim()))?.codingFinalOutput ||
      ''
    ).trim();
    const latestCodingText = sanitizeCodingChatOutput(rawCodingText) || '';
    const codingTokensSum = matchedReports.reduce(
      (sum, r) => sum + (r.tokenUsage?.totalTokens || 0),
      0
    );
    const planTokensVal = run.planTokenUsage?.totalTokens || linkedJob?.tokenUsage?.totalTokens || 0;
    const totalTokens =
      planTokensVal + Math.max(codingTokensSum, run.latestCodingOutput?.tokenUsage?.totalTokens || 0);

    items.push({
      id: run.id,
      runId: run.id,
      jobId: linkedJob?.id,
      title: run.prdTitle,
      prdPreview: run.prdContent.slice(0, 180),
      repoFullName: run.repoFullName,
      defaultBranch: run.defaultBranch || 'main',
      branchName,
      status: resolveRequirementStatus(run),
      executionMode: linkedJob?.executionMode,
      agyModel: linkedJob?.agyModel,
      prNumber: run.draftPr?.prNumber,
      prUrl: run.draftPr?.prUrl,
      previewUrl: run.previewDeployment?.url,
      productionUrl: run.productionDeployment?.url,
      mergedCommitSha: run.mergedRelease?.mergeCommitSha,
      mergedCommitUrl: run.mergedRelease?.commitUrl,
      mergedBaseBranch: run.mergedRelease?.baseBranch,
      tasksCount: run.architect.tasks.length,
      apiContractsCount: run.architect.apiContracts.length,
      checkedCriteriaCount,
      totalCriteriaCount,
      acceptanceProgressPct,
      reworkCount,
      lastReworkBranch: run.lastRework?.branchName,
      lastReworkNote: run.lastRework?.note,
      approvalNote: run.approvalNote,
      latestTestPassRate: latestReport ? latestReport.passRate : null,
      latestTestPassed: latestReport ? latestReport.passed : 0,
      latestTestFailed: latestReport ? latestReport.failed : 0,
      latestTestSummary: latestReport?.summary,
      hasCodingOutput: Boolean(latestCodingText),
      latestCodingOutputPreview: latestCodingText
        ? latestCodingText.replace(/\s+/g, ' ').slice(0, 220)
        : undefined,
      latestCodingCommitSha: run.latestCodingOutput?.commitSha,
      repairRounds: run.latestCodingOutput?.repairRounds ?? latestReport?.repairRounds,
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
      createdAt: run.createdAt,
      updatedAt,
      auditEvents: matchedEvents,
    });
  }

  for (const job of standaloneJobs) {
    const matchedEvents = combinedLogs.filter((e) => e.jobId === job.id);
    const status: RequirementBoardStatus =
      job.status === 'running' ? 'analyzing' : 'analysis_failed';

    items.push({
      id: job.id,
      jobId: job.id,
      title: job.prdTitle,
      prdPreview: job.prdContent.slice(0, 180),
      repoFullName: job.repoFullName,
      defaultBranch: job.defaultBranch || 'main',
      status,
      executionMode: job.executionMode,
      agyModel: job.agyModel,
      tasksCount: 0,
      apiContractsCount: 0,
      checkedCriteriaCount: 0,
      totalCriteriaCount: 0,
      acceptanceProgressPct: null,
      reworkCount: 0,
      analysisError: job.error,
      latestTestPassRate: null,
      latestTestPassed: 0,
      latestTestFailed: 0,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt || job.createdAt,
      auditEvents: matchedEvents,
    });
  }

  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  // Status funnel distribution
  const countByGroup = {
    planning: 0,
    analyzed: 0,
    pr_created: 0,
    changes_requested: 0,
    delivered: 0,
  };
  let mergedCount = 0;
  let failedAnalysisCount = 0;
  let inProgressCount = 0;

  for (const item of items) {
    if (item.status === 'analyzing') {
      countByGroup.planning += 1;
      inProgressCount += 1;
    } else if (item.status === 'analysis_failed') {
      countByGroup.planning += 1;
      failedAnalysisCount += 1;
    } else if (item.status === 'analyzed') {
      countByGroup.analyzed += 1;
      inProgressCount += 1;
    } else if (item.status === 'pr_created') {
      countByGroup.pr_created += 1;
      inProgressCount += 1;
    } else if (item.status === 'changes_requested') {
      countByGroup.changes_requested += 1;
      inProgressCount += 1;
    } else if (item.status === 'approved') {
      countByGroup.delivered += 1;
    } else if (item.status === 'merged') {
      countByGroup.delivered += 1;
      mergedCount += 1;
    }
  }

  const statusDistribution: RequirementStatusBucket[] = [
    { key: 'planning', label: '规划中/中断', count: countByGroup.planning, color: '#8B949E' },
    { key: 'analyzed', label: '待创建 PR', count: countByGroup.analyzed, color: '#A371F7' },
    { key: 'pr_created', label: '开发/待验收', count: countByGroup.pr_created, color: '#58A6FF' },
    {
      key: 'changes_requested',
      label: '退回修订中',
      count: countByGroup.changes_requested,
      color: '#D29922',
    },
    { key: 'delivered', label: '已批准/上线', count: countByGroup.delivered, color: '#3FB950' },
  ];

  // Build 7-day rolling window buckets in target timezone
  const dailyMap = new Map<string, DailyRequirementActivityPoint>();
  const dailyOrder: string[] = [];
  const shiftedNow = new Date(now.getTime() + tzOffset * 60_000);
  const baseUtcDay = Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate()
  );

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(baseUtcDay - offset * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${day}`;
    dailyOrder.push(dateKey);
    dailyMap.set(dateKey, {
      dateKey,
      label: `${m}-${day}`,
      planning: 0,
      execution: 0,
      approval: 0,
      quality: 0,
      totalActions: 0,
      newRequirements: 0,
    });
  }

  let last7dRequirements = 0;
  for (const item of items) {
    const key = toDateKeyInOffset(item.createdAt, tzOffset);
    if (key && dailyMap.has(key)) {
      dailyMap.get(key)!.newRequirements += 1;
      last7dRequirements += 1;
    }
  }

  for (const log of combinedLogs) {
    const key = toDateKeyInOffset(log.timestamp, tzOffset);
    if (key && dailyMap.has(key)) {
      const bucket = dailyMap.get(key)!;
      bucket[log.category] += 1;
      bucket.totalActions += 1;
    }
  }

  const dailyActivity = dailyOrder.map((k) => dailyMap.get(k)!);

  const deliveredCount = countByGroup.delivered;
  const totalRequirements = items.length;
  const deliveryRatePct =
    totalRequirements > 0 ? Math.round((deliveredCount / totalRequirements) * 100) : null;

  const reviewedItems = items.filter(
    (i) => i.status === 'approved' || i.status === 'merged' || i.reworkCount > 0
  );
  const firstPassItems = reviewedItems.filter(
    (i) => (i.status === 'approved' || i.status === 'merged') && i.reworkCount === 0
  );
  const firstPassAcceptanceRatePct =
    reviewedItems.length > 0
      ? Math.round((firstPassItems.length / reviewedItems.length) * 100)
      : null;

  return {
    generatedAt: now.toISOString(),
    summary: {
      totalRequirements,
      inProgressCount,
      pendingApprovalCount: countByGroup.pr_created,
      reworkRequestedCount: items.filter((i) => i.reworkCount > 0).length,
      deliveredCount,
      mergedCount,
      failedAnalysisCount,
      deliveryRatePct,
      firstPassAcceptanceRatePct,
      totalManualActions: combinedLogs.length,
      last7dRequirements,
      lastActionAt: combinedLogs[0]?.timestamp,
    },
    statusDistribution,
    dailyActivity,
    requirements: items,
    auditLogs: combinedLogs.slice(0, 150),
  };
}
