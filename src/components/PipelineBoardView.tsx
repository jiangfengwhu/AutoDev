import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cloud,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  Square,
} from 'lucide-react';
import type {
  AnalysisJob,
  CloudflareIntegrationStatus,
  GitHubActionRun,
  GitHubSelfHostedRunner,
  PipelineRun,
} from '../types/autodev';
import {
  AGY_AGENT_MODES,
  AGY_AVAILABLE_MODELS,
  DEFAULT_AGY_MODE,
  DEFAULT_AGY_MODEL,
  FIXED_TARGET_REPO,
} from '../lib/workflowBuilder';
import { filterActionRunsForPipelineRun } from '../lib/iterationContext';

interface PipelineBoardViewProps {
  runs: PipelineRun[];
  relatedJobs?: AnalysisJob[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  cloudflareStatus?: CloudflareIntegrationStatus;
  githubConnected: boolean;
  isRequirementInProgress?: boolean;
  onGoToNewPrd: () => void;
  onGoToApproval: (runId: string) => void;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

interface LiveAgyStreamSnapshot {
  statusLabel: string;
  workspace?: string;
  branch?: string;
  model?: string;
  elapsed?: string;
  updatedAt?: string;
  changedFiles?: string;
  output?: string;
}

interface RunLogDetail {
  runId: number;
  jobs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    runnerName: string | null;
    steps: Array<{
      number: number;
      name: string;
      status: string;
      conclusion: string | null;
    }>;
    logTail?: string;
  }>;
  liveAgyStream?: LiveAgyStreamSnapshot | null;
  error?: string;
}

const RUN_STATUS_TEXT: Record<PipelineRun['status'], { label: string; color: string }> = {
  analyzed: { label: '规格就绪 · 待建 PR', color: 'text-[#D29922]' },
  pr_created: { label: 'Draft PR 已创建', color: 'text-[#58A6FF]' },
  approved: { label: '验收通过 · 已批准', color: 'text-[#3FB950]' },
  changes_requested: { label: '退回修订', color: 'text-[#F85149]' },
};

export function PipelineBoardView({
  runs,
  relatedJobs = [],
  selectedRunId,
  onSelectRun,
  cloudflareStatus,
  githubConnected,
  isRequirementInProgress = false,
  onGoToNewPrd,
  onGoToApproval,
  onErrorToast,
  onSuccessToast,
}: PipelineBoardViewProps) {
  const activeRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
  const targetRepo = activeRun?.repoFullName || FIXED_TARGET_REPO.fullName;

  const [actionRuns, setActionRuns] = useState<GitHubActionRun[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);

  const [runners, setRunners] = useState<GitHubSelfHostedRunner[]>([]);
  const [repoBranches, setRepoBranches] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>(
    () => AGY_AVAILABLE_MODELS.map((m) => ({ id: m.id, label: m.label }))
  );

  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_AGY_MODEL);
  const [selectedMode, setSelectedMode] = useState<string>(DEFAULT_AGY_MODE);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    actionsUrl?: string;
  } | null>(null);

  // Real-time VPS AGY Execution Log Viewer State
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [runLogLoading, setRunLogLoading] = useState(false);
  const [runLogDetail, setRunLogDetail] = useState<RunLogDetail | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<number | null>(null);
  const agyLogViewportRef = useRef<HTMLPreElement | null>(null);

  const fetchRunDetail = useCallback(
    async (runId: number, silent = false) => {
      if (!silent) setRunLogLoading(true);
      try {
        const res = await fetch(
          `/api/github/actions-runs/${runId}?repo=${encodeURIComponent(targetRepo)}`
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setRunLogDetail({
          runId,
          jobs: data.jobs || [],
          liveAgyStream: data.liveAgyStream ?? null,
        });
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : '拉取运行日志失败';
          setRunLogDetail({
            runId,
            jobs: [],
            error: msg,
          });
          onErrorToast(msg, '日志拉取失败');
        }
      } finally {
        if (!silent) setRunLogLoading(false);
      }
    },
    [targetRepo, onErrorToast]
  );

  const fetchPipelineTelemetry = useCallback(
    async (repoFullName: string, silent = false) => {
      if (!silent) {
        setActionsLoading(true);
        setActionsError(null);
      }
      try {
        const [actionsRes, runnersRes] = await Promise.all([
          fetch(`/api/github/actions-runs?repo=${encodeURIComponent(repoFullName)}`),
          fetch(`/api/github/runners?repo=${encodeURIComponent(repoFullName)}`),
        ]);
        const actionsData = await actionsRes.json();
        if (!actionsRes.ok) {
          throw new Error(actionsData.error || `HTTP ${actionsRes.status}`);
        }
        const nextRuns: GitHubActionRun[] = actionsData.runs || [];
        setActionRuns(nextRuns);
        if (actionsData.error) {
          setActionsError(actionsData.error);
        }

        if (runnersRes.ok) {
          const runnersData = await runnersRes.json();
          setRunners(runnersData.runners || []);
          setRepoBranches(runnersData.branches || []);
        }
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : '拉取 Actions 与 Runner 状态失败';
          setActionsError(msg);
          setActionRuns([]);
          onErrorToast(msg, 'Actions 状态获取失败');
        }
      } finally {
        if (!silent) setActionsLoading(false);
      }
    },
    [onErrorToast]
  );

  // Sync live VPS AGY models (Gemini 4 + detected CLI models)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/github/vps-capabilities?repo=${encodeURIComponent(targetRepo)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { models?: Array<{ id: string; label: string }> } | null) => {
        if (!cancelled && data?.models && data.models.length > 0) {
          setAvailableModels(data.models);
        }
      })
      .catch(() => {
        // Fallback to built-in AGY_AVAILABLE_MODELS
      });
    return () => {
      cancelled = true;
    };
  }, [targetRepo]);

  useEffect(() => {
    if (githubConnected) {
      fetchPipelineTelemetry(targetRepo);
    } else {
      setActionRuns([]);
      setRunners([]);
      setRepoBranches([]);
      setActionsError(null);
    }
  }, [targetRepo, githubConnected, fetchPipelineTelemetry]);

  // Filter GitHub Actions strictly to the currently selected requirement pipeline
  const visibleActionRuns = useMemo(
    () => filterActionRunsForPipelineRun(actionRuns, activeRun, relatedJobs),
    [actionRuns, activeRun, relatedJobs]
  );

  useEffect(() => {
    setExpandedRunId((prev) => {
      if (prev !== null && visibleActionRuns.some((r) => r.id === prev)) {
        return prev;
      }
      const active = visibleActionRuns.find(
        (r) => r.status === 'in_progress' || r.status === 'queued'
      );
      return active ? active.id : visibleActionRuns[0]?.id ?? null;
    });
  }, [activeRun?.id, visibleActionRuns]);

  useEffect(() => {
    if (expandedRunId && githubConnected) {
      fetchRunDetail(expandedRunId);
    }
  }, [expandedRunId, githubConnected, fetchRunDetail]);

  const hasCurrentRunExecuting = useMemo(
    () => visibleActionRuns.some((r) => r.status === 'in_progress' || r.status === 'queued'),
    [visibleActionRuns]
  );

  const hasActiveActionRun = useMemo(
    () => actionRuns.some((r) => r.status === 'in_progress' || r.status === 'queued'),
    [actionRuns]
  );

  useEffect(() => {
    if (!githubConnected || !hasActiveActionRun) return;
    const pollTick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchPipelineTelemetry(targetRepo, true);
      if (expandedRunId) {
        fetchRunDetail(expandedRunId, true);
      }
    };
    const timer = setInterval(pollTick, 12000);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        pollTick();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [
    githubConnected,
    hasActiveActionRun,
    targetRepo,
    expandedRunId,
    fetchPipelineTelemetry,
    fetchRunDetail,
  ]);

  useEffect(() => {
    if (agyLogViewportRef.current) {
      agyLogViewportRef.current.scrollTop = agyLogViewportRef.current.scrollHeight;
    }
  }, [runLogDetail?.liveAgyStream?.output]);

  const candidateBranches = useMemo(() => {
    const set = new Set<string>();
    if (activeRun?.draftPr?.branchName) {
      set.add(activeRun.draftPr.branchName);
    }
    for (const b of repoBranches) {
      if (b.startsWith('autodev/')) set.add(b);
    }
    for (const b of repoBranches) {
      if (b !== 'main' && b !== 'master') set.add(b);
    }
    if (set.size === 0 && repoBranches.length > 0) {
      for (const b of repoBranches) set.add(b);
    }
    return Array.from(set);
  }, [activeRun?.draftPr?.branchName, repoBranches]);

  useEffect(() => {
    if (activeRun?.draftPr?.branchName) {
      setSelectedBranch(activeRun.draftPr.branchName);
    } else if (candidateBranches.length > 0 && !candidateBranches.includes(selectedBranch)) {
      setSelectedBranch(candidateBranches[0]);
    }
  }, [activeRun?.draftPr?.branchName, candidateBranches, selectedBranch]);

  const onlineRunners = runners.filter((r) => r.status === 'online');

  const handleDispatchAgy = async () => {
    if (!selectedBranch) {
      const msg = '请先选择目标规格分支。';
      setDispatchFeedback({ type: 'error', message: msg });
      onErrorToast(msg, '未选择分支');
      return;
    }

    setDispatching(true);
    setDispatchFeedback(null);
    try {
      const res = await fetch('/api/github/dispatch-agy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: targetRepo,
          prBranch: selectedBranch,
          prNumber: activeRun?.draftPr?.prNumber,
          runId: activeRun?.id,
          agyModel: selectedModel,
          agyMode: selectedMode,
          baseBranch: activeRun?.defaultBranch || FIXED_TARGET_REPO.defaultBranch,
          e2eTestPath: activeRun?.draftPr?.e2eTestPath,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `触发失败 (${res.status})`);
      }

      const msg = `已派发至 VPS AGY Runner（分支 ${data.branch} · 模型 ${data.model} · 模式 ${data.mode || selectedMode}）`;
      setDispatchFeedback({
        type: 'success',
        message: msg,
        actionsUrl: data.actionsUrl,
      });
      onSuccessToast(msg, '任务已派发');

      setExpandedRunId(null);
      setTimeout(() => {
        fetchPipelineTelemetry(targetRepo);
      }, 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '派发 VPS AGY 任务失败';
      setDispatchFeedback({ type: 'error', message: msg });
      onErrorToast(msg, '派发失败');
    } finally {
      setDispatching(false);
    }
  };

  const handleCancelRun = async (runId: number) => {
    setCancellingRunId(runId);
    try {
      const res = await fetch(`/api/github/actions-runs/${runId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName: targetRepo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `取消失败 (${res.status})`);
      }
      onSuccessToast(`已发送取消指令至 Run #${runId}`, '任务已取消');
      setTimeout(() => {
        fetchPipelineTelemetry(targetRepo);
        if (expandedRunId === runId) fetchRunDetail(runId);
      }, 1200);
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '停止任务失败', '操作失败');
    } finally {
      setCancellingRunId(null);
    }
  };

  if (runs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="pb-4 border-b border-[#30363D]">
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC]">
            全自动流水线看板
          </h1>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-12 text-center space-y-4">
          <div className="text-[15px] font-semibold text-[#F0F6FC]">
            尚无运行中的研发流水线
          </div>
          {!isRequirementInProgress && (
            <button
              type="button"
              onClick={onGoToNewPrd}
              className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>新建需求 (PRD)</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC]">
            全自动流水线看板
          </h1>
          <p className="mt-1 text-[13px] text-[#8B949E] font-mono">
            {targetRepo}
          </p>
        </div>
        {activeRun && (
          <button
            type="button"
            onClick={() => onGoToApproval(activeRun.id)}
            className="rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-1.5 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            前往验收审批
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Run Selector List */}
        <aside className="lg:col-span-4 rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363D] text-[12px] font-semibold text-[#F0F6FC] tabular-nums">
            需求流水线 ({runs.length})
          </div>
          <div className="divide-y divide-[#21262D] bg-[#0D1117]">
            {runs.map((run) => {
              const isSelected = activeRun?.id === run.id;
              const statusMeta = RUN_STATUS_TEXT[run.status];
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onSelectRun(run.id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors space-y-1.5 ${
                    isSelected ? 'bg-[#1F6FEB]/15' : 'hover:bg-[#161B22]'
                  }`}
                >
                  <div className="text-[13px] font-medium text-[#F0F6FC] line-clamp-1">
                    {run.prdTitle}
                  </div>
                  <div className="font-mono text-[11px] text-[#8B949E] truncate">
                    {run.repoFullName}
                    {run.draftPr ? ` · PR #${run.draftPr.prNumber}` : ''}
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={statusMeta.color}>{statusMeta.label}</span>
                    <span className="font-mono text-[#6E7681] tabular-nums">
                      {new Date(run.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Detail Column */}
        {activeRun && (
          <div className="lg:col-span-8 space-y-4">
            {/* Stage Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Stage 1: Multi-Agent Spec */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[#8B949E]">01 · 架构与测试左移</span>
                  <span className="inline-flex items-center gap-1 text-[#3FB950] font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    已完成
                  </span>
                </div>
                <div className="text-[14px] font-semibold text-[#F0F6FC]">
                  规格与只读测试集
                </div>
                <div className="text-[12px] text-[#8B949E] tabular-nums">
                  {activeRun.architect.tasks.length} 项任务 · {activeRun.architect.apiContracts.length} 项契约 · {activeRun.qaCritic.findings.length} 项加固
                </div>
              </div>

              {/* Stage 2: GitHub Draft PR */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[#8B949E]">02 · GitHub 规格分支</span>
                  {activeRun.draftPr ? (
                    <span className="inline-flex items-center gap-1 text-[#3FB950] font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      PR #{activeRun.draftPr.prNumber}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#D29922] font-medium">
                      <Clock className="h-3.5 w-3.5" />
                      待建 PR
                    </span>
                  )}
                </div>
                <div className="text-[14px] font-semibold text-[#F0F6FC] font-mono truncate">
                  docs/spec.json · 盲测用例已隔离至 Vault
                </div>
                {activeRun.draftPr ? (
                  <a
                    href={activeRun.draftPr.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[#58A6FF] hover:underline"
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                    <span className="truncate">{activeRun.draftPr.branchName}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <div className="text-[12px] text-[#8B949E]">
                    尚未创建 Draft PR
                  </div>
                )}
              </div>

              {/* Stage 3: Cloudflare Workers Runtime */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[#8B949E]">03 · Cloudflare 预览部署</span>
                  {activeRun.previewDeployment ? (
                    <span className="inline-flex items-center gap-1 text-[#3FB950] font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      在线
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#8B949E] font-medium">
                      <Cloud className="h-3.5 w-3.5" />
                      {cloudflareStatus?.connected ? '已就绪' : '未连接'}
                    </span>
                  )}
                </div>
                <div className="text-[14px] font-semibold text-[#F0F6FC]">
                  Workers (Hono) + D1 + KV
                </div>
                {activeRun.previewDeployment ? (
                  <a
                    href={activeRun.previewDeployment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[#3FB950] hover:underline max-w-full"
                  >
                    <span className="truncate">{activeRun.previewDeployment.url}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <div className="text-[12px] text-[#8B949E] tabular-nums">
                    {cloudflareStatus?.connected
                      ? `Workers ${cloudflareStatus.workers.length} · KV ${cloudflareStatus.kvNamespaces.length}`
                      : 'Cloudflare 未连接'}
                  </div>
                )}
              </div>

              {/* Stage 4: VPS Self-Hosted AGY Runner */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[#8B949E]">04 · VPS AGY Runner</span>
                  {onlineRunners.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[#3FB950] font-medium tabular-nums">
                      <Server className="h-3.5 w-3.5" />
                      在线 ({onlineRunners.length})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#D29922] font-medium">
                      <Server className="h-3.5 w-3.5" />
                      离线
                    </span>
                  )}
                </div>
                <div className="text-[14px] font-semibold text-[#F0F6FC]">
                  AGY Coding Agent
                </div>
                <div className="text-[12px] text-[#8B949E] truncate font-mono">
                  {onlineRunners.length > 0
                    ? `${onlineRunners[0].name} · ${onlineRunners[0].busy ? 'Busy' : 'Idle'}`
                    : '未检测到在线 Runner'}
                </div>
              </div>
            </div>

            {/* VPS AGY Coding Agent Dispatch Console (Hidden while current requirement is executing) */}
            {hasCurrentRunExecuting ? (
              <div
                role="status"
                className="rounded-md border border-[#58A6FF]/40 bg-[#1F6FEB]/10 px-5 py-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 text-[13px] text-[#F0F6FC]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#58A6FF] shrink-0" />
                  <span>
                    当前需求正在 VPS AGY 上执行（无超时限制，完成后自动 push 并运行隔离 E2E 盲测）
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[#79C0FF]">
                  专注模式 · 已锁定重复派发
                </span>
              </div>
            ) : (
              <div className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                    派发 VPS AGY 自动开发
                  </h2>
                  <span className="font-mono text-[11px] text-[#8B949E]">
                    无超时直等 · 盲测防作弊
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label
                      htmlFor="agy-branch-select"
                      className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
                    >
                      目标分支
                    </label>
                    <select
                      id="agy-branch-select"
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      disabled={dispatching || candidateBranches.length === 0}
                      className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none disabled:opacity-50"
                    >
                      {candidateBranches.length === 0 ? (
                        <option value="">暂无可用分支</option>
                      ) : (
                        candidateBranches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="agy-model-select"
                      className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
                    >
                      AGY 模型
                    </label>
                    <select
                      id="agy-model-select"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      disabled={dispatching}
                      className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none disabled:opacity-50"
                    >
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="agy-mode-select"
                      className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
                    >
                      Agent 模式
                    </label>
                    <select
                      id="agy-mode-select"
                      value={selectedMode}
                      onChange={(e) => setSelectedMode(e.target.value)}
                      disabled={dispatching}
                      className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none disabled:opacity-50"
                    >
                      {AGY_AGENT_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-[12px] text-[#8B949E]">
                    {onlineRunners.length > 0 ? (
                      <span className="text-[#3FB950] font-mono">
                        {onlineRunners[0].name} 就绪
                      </span>
                    ) : (
                      <span className="text-[#D29922]">
                        当前无在线 Runner（派发后将进入队列）
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleDispatchAgy}
                    disabled={dispatching || !githubConnected || !selectedBranch}
                    className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    {dispatching ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>派发中…</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        <span>派发 VPS AGY 自动开发</span>
                      </>
                    )}
                  </button>
                </div>

                {dispatchFeedback && (
                  <div
                    role={dispatchFeedback.type === 'error' ? 'alert' : 'status'}
                    className={`rounded-md border px-4 py-3 text-[12px] flex items-start justify-between gap-3 ${
                      dispatchFeedback.type === 'success'
                        ? 'border-[#3FB950]/40 bg-[#2EA043]/10 text-[#AFF5B4]'
                        : 'border-[#F85149]/40 bg-[#F85149]/10 text-[#FFDCD7]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {dispatchFeedback.type === 'error' ? (
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#F85149]" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[#3FB950]" />
                      )}
                      <span>{dispatchFeedback.message}</span>
                    </div>
                    {dispatchFeedback.actionsUrl && (
                      <a
                        href={dispatchFeedback.actionsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline whitespace-nowrap shrink-0"
                      >
                        <span>Actions</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Live GitHub Actions & VPS AGY Execution Stream (Filtered strictly to activeRun) */}
            <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#30363D] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                    GitHub Actions 与 VPS AGY 执行日志
                  </h2>
                  <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                    仅展示当前需求关联流水线（{visibleActionRuns.length} 条）
                  </span>
                  {hasCurrentRunExecuting && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#58A6FF]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      5s 轮询中
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!githubConnected || actionsLoading}
                  onClick={() => {
                    fetchPipelineTelemetry(targetRepo);
                    if (expandedRunId) fetchRunDetail(expandedRunId);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${actionsLoading ? 'animate-spin' : ''}`} />
                  <span>刷新日志</span>
                </button>
              </div>

              {!githubConnected ? (
                <div className="p-5 text-[13px] text-[#8B949E]">
                  GitHub 暂未连接。
                </div>
              ) : actionsError ? (
                <div className="p-5 text-[13px] text-[#F85149]">{actionsError}</div>
              ) : visibleActionRuns.length === 0 ? (
                <div className="p-5 text-[13px] text-[#8B949E]">
                  当前需求暂无关联的 GitHub Actions 执行记录
                  {activeRun.draftPr?.branchName
                    ? `（分支 ${activeRun.draftPr.branchName}）`
                    : ''}
                  。
                </div>
              ) : (
                <div className="divide-y divide-[#21262D] bg-[#0D1117]">
                  {visibleActionRuns.map((ar) => {
                    const isExpanded = expandedRunId === ar.id;
                    const isRunning = ar.status === 'in_progress' || ar.status === 'queued';
                    const conclusionColor =
                      ar.conclusion === 'success'
                        ? 'text-[#3FB950]'
                        : ar.conclusion === 'failure'
                          ? 'text-[#F85149]'
                          : isRunning
                            ? 'text-[#58A6FF]'
                            : 'text-[#8B949E]';
                    return (
                      <div key={ar.id} className="px-5 py-3.5 space-y-3 text-[12px]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {isRunning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#58A6FF] shrink-0" />
                              ) : ar.conclusion === 'success' ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-[#3FB950] shrink-0" />
                              ) : ar.conclusion === 'failure' ? (
                                <AlertCircle className="h-3.5 w-3.5 text-[#F85149] shrink-0" />
                              ) : (
                                <Clock className="h-3.5 w-3.5 text-[#8B949E] shrink-0" />
                              )}
                              <span className="font-medium text-[#F0F6FC] truncate">
                                {ar.name} #{ar.id}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-[#8B949E] mt-0.5 tabular-nums">
                              {ar.headBranch} · <span className={conclusionColor}>{ar.status}{ar.conclusion ? ` / ${ar.conclusion}` : ''}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {isRunning && (
                              <button
                                type="button"
                                disabled={cancellingRunId === ar.id}
                                onClick={() => handleCancelRun(ar.id)}
                                className="inline-flex items-center gap-1 rounded border border-[#F85149]/40 bg-[#F85149]/10 px-2.5 py-1 text-[11px] font-medium text-[#FFDCD7] hover:bg-[#F85149]/20 disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                <Square className="h-3 w-3" />
                                <span>{cancellingRunId === ar.id ? '停止中…' : '停止任务'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRunId((prev) => (prev === ar.id ? null : ar.id))
                              }
                              className="text-[12px] text-[#C9D1D9] hover:text-[#F0F6FC] underline-offset-2 hover:underline whitespace-nowrap"
                            >
                              {isExpanded ? '收起日志' : '展开日志'}
                            </button>
                            <a
                              href={ar.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#58A6FF] hover:underline whitespace-nowrap"
                            >
                              <span>GitHub</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="rounded-md border border-[#30363D] bg-[#161B22] p-3.5 space-y-3">
                            {runLogLoading && runLogDetail?.runId !== ar.id ? (
                              <div className="text-[12px] text-[#8B949E]">正在拉取运行日志…</div>
                            ) : runLogDetail?.error ? (
                              <div className="text-[12px] text-[#F85149]">{runLogDetail.error}</div>
                            ) : (
                              <>
                                {runLogDetail?.runId === ar.id && runLogDetail.liveAgyStream && (
                                  <div className="space-y-2.5 pb-3 border-b border-[#30363D]">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                                      <span className="text-[#3FB950] font-semibold">
                                        AGY 实时输出 · {runLogDetail.liveAgyStream.statusLabel}
                                      </span>
                                      <span className="text-[#8B949E] tabular-nums">
                                        {runLogDetail.liveAgyStream.model || '—'} ·{' '}
                                        {runLogDetail.liveAgyStream.elapsed || '—'}
                                      </span>
                                    </div>
                                    {runLogDetail.liveAgyStream.workspace && (
                                      <div className="font-mono text-[11px] text-[#8B949E]">
                                        CWD:{' '}
                                        <span className="text-[#F0F6FC]">
                                          {runLogDetail.liveAgyStream.workspace}
                                        </span>
                                      </div>
                                    )}
                                    {runLogDetail.liveAgyStream.changedFiles && (
                                      <div className="space-y-1">
                                        <div className="text-[11px] text-[#8B949E] font-mono">
                                          git status --short
                                        </div>
                                        <pre className="max-h-28 overflow-auto rounded bg-[#010409] border border-[#30363D] p-2.5 font-mono text-[11px] text-[#79C0FF] whitespace-pre-wrap break-all">
                                          {runLogDetail.liveAgyStream.changedFiles}
                                        </pre>
                                      </div>
                                    )}
                                    {runLogDetail.liveAgyStream.output && (
                                      <div className="space-y-1">
                                        <div className="text-[11px] text-[#8B949E] font-mono">
                                          AGY 终端输出
                                        </div>
                                        <pre
                                          ref={agyLogViewportRef}
                                          className="max-h-72 overflow-auto rounded bg-[#010409] border border-[#30363D] p-3 font-mono text-[11px] leading-relaxed text-[#C9D1D9] whitespace-pre-wrap break-all"
                                        >
                                          {runLogDetail.liveAgyStream.output}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {(runLogDetail?.runId === ar.id ? runLogDetail.jobs : []).map(
                                  (job) => (
                                    <div key={job.id} className="space-y-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#8B949E]">
                                        <span>
                                          Job: <span className="text-[#F0F6FC]">{job.name}</span>
                                          {job.runnerName ? ` · ${job.runnerName}` : ''}
                                        </span>
                                        <span>
                                          {job.status}
                                          {job.conclusion ? ` / ${job.conclusion}` : ''}
                                        </span>
                                      </div>
                                      {job.steps.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono">
                                          {job.steps.map((step) => (
                                            <div
                                              key={step.number}
                                              className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-[#0D1117] border border-[#30363D]"
                                            >
                                              <span className="truncate text-[#C9D1D9]">
                                                {step.number}. {step.name}
                                              </span>
                                              <span
                                                className={
                                                  step.conclusion === 'success'
                                                    ? 'text-[#3FB950] shrink-0'
                                                    : step.conclusion === 'failure'
                                                      ? 'text-[#F85149] shrink-0'
                                                      : step.status === 'in_progress'
                                                        ? 'text-[#58A6FF] shrink-0'
                                                        : 'text-[#8B949E] shrink-0'
                                                }
                                              >
                                                {step.conclusion || step.status}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {job.logTail && (
                                        <div className="space-y-1">
                                          <div className="text-[11px] text-[#8B949E] font-mono">
                                            Actions 日志尾部
                                          </div>
                                          <pre className="max-h-64 overflow-auto rounded bg-[#010409] border border-[#30363D] p-3 font-mono text-[11px] leading-relaxed text-[#C9D1D9] whitespace-pre-wrap break-all">
                                            {job.logTail}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  )
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
