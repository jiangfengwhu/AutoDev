import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Cloud,
  Cpu,
  ExternalLink,
  Gauge,
  GitBranch,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type {
  BackgroundTask,
  GitHubSelfHostedRunner,
  IntegrationsStatusResponse,
  SelectedTargetRepo,
} from '../types/autodev';
import { FIXED_TARGET_REPO } from '../lib/workflowBuilder';
import { OverviewDashboard } from './OverviewDashboard';

interface EnvironmentViewProps {
  status: IntegrationsStatusResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  selectedRepo: SelectedTargetRepo | null;
  onSelectRepo: (repo: SelectedTargetRepo) => void;
  onEnvironmentReset?: () => void;
  onBackgroundTaskStarted?: (task: BackgroundTask) => void;
  refreshNonce?: number;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

interface RunnersApiResponse {
  repoFullName: string;
  connected: boolean;
  runners: GitHubSelfHostedRunner[];
  workflowExists: boolean;
  workflowUrl?: string;
  deployWorkflowExists?: boolean;
  deployWorkflowUrl?: string;
  branches: string[];
  error?: string;
}

interface RateLimitAndPersistenceResponse {
  rateLimit: {
    configured: boolean;
    limit: number | null;
    remaining: number | null;
    used: number | null;
    resetAt: string | null;
    resource: string;
    observedAt: string | null;
    optimization: {
      ttlCacheHits: number;
      etag304Hits: number;
      inflightDedupHits: number;
      totalSavedRequests: number;
      totalNetworkRequests: number;
    };
  };
  statePersistence: {
    enabled: boolean;
    repoFullName: string;
    branch: string;
    hydrated: boolean;
    hydratedAt: string | null;
    lastSyncedAt: string | null;
    lastCommitSha: string | null;
    pendingKeys: string[];
    syncing: boolean;
    lastError: string | null;
    totalFlushes: number;
    coalescedWritesSaved: number;
  };
}

function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function EnvironmentView({
  status,
  loading,
  error,
  onRefresh,
  selectedRepo,
  onEnvironmentReset,
  onBackgroundTaskStarted,
  refreshNonce = 0,
  onErrorToast,
  onSuccessToast,
}: EnvironmentViewProps) {
  const [runnerInfo, setRunnerInfo] = useState<RunnersApiResponse | null>(null);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [overviewRefreshSignal, setOverviewRefreshSignal] = useState(0);
  const [telemetry, setTelemetry] = useState<RateLimitAndPersistenceResponse | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [syncingState, setSyncingState] = useState(false);

  // Danger Zone clean-slate reset & wipe-repo-code state
  const [showResetPanel, setShowResetPanel] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [optClearState, setOptClearState] = useState(true);
  const [optDeleteActions, setOptDeleteActions] = useState(true);
  const [optResetBranches, setOptResetBranches] = useState(true);
  const [optWipeD1, setOptWipeD1] = useState(true);
  const [optWipeRepoCode, setOptWipeRepoCode] = useState(false);
  const [optKeepRsiRules, setOptKeepRsiRules] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');

  const targetFullName = selectedRepo?.fullName || FIXED_TARGET_REPO.fullName;

  const pinnedLiveRepo = useMemo(() => {
    const list = status?.github.repos ?? [];
    return (
      list.find((r) => r.fullName.toLowerCase() === targetFullName.toLowerCase()) ?? null
    );
  }, [status?.github.repos, targetFullName]);

  const fetchRunnerStatus = useCallback(async () => {
    setRunnerLoading(true);
    try {
      const res = await fetch(
        `/api/github/runners?repo=${encodeURIComponent(targetFullName)}`
      );
      const data = (await res.json()) as RunnersApiResponse;
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRunnerInfo(data);
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '无法拉取 Self-Hosted Runner 状态',
        'Runner 查询失败'
      );
    } finally {
      setRunnerLoading(false);
    }
  }, [targetFullName, onErrorToast]);

  const fetchTelemetry = useCallback(async (forceRefresh = false) => {
    setTelemetryLoading(true);
    try {
      const res = await fetch(
        `/api/github/rate-limit${forceRefresh ? '?refresh=1' : ''}`
      );
      if (res.ok) {
        const data = (await res.json()) as RateLimitAndPersistenceResponse;
        setTelemetry(data);
      }
    } catch {
      // non-fatal
    } finally {
      setTelemetryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status?.github.connected) {
      fetchRunnerStatus();
      fetchTelemetry(false);
    }
  }, [status?.github.connected, fetchRunnerStatus, fetchTelemetry, refreshNonce]);

  useEffect(() => {
    if (refreshNonce > 0) {
      setOverviewRefreshSignal((prev) => prev + 1);
    }
  }, [refreshNonce]);

  const handleManualStateSync = async () => {
    setSyncingState(true);
    try {
      const res = await fetch('/api/admin/state/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'push', async: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.task) {
        onBackgroundTaskStarted?.(json.task as BackgroundTask);
        onSuccessToast(
          '状态分支同步已转入服务端后台执行，切换房间或离开页面不会中断',
          '后台同步已启动'
        );
        return;
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || json.statePersistence?.lastError || `HTTP ${res.status}`);
      }
      onSuccessToast('已将控制面状态全量同步至 GitHub autodev-state 分支', '持久化同步成功');
      await fetchTelemetry(false);
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '同步状态至 GitHub 分支失败',
        '状态同步失败'
      );
    } finally {
      setSyncingState(false);
    }
  };

  const handleExecuteResetAll = async () => {
    if (
      !optClearState &&
      !optDeleteActions &&
      !optResetBranches &&
      !optWipeD1 &&
      !optWipeRepoCode
    ) {
      onErrorToast('请至少勾选一项清理内容', '未选择清理项');
      return;
    }
    if (optWipeRepoCode && wipeConfirmText.trim().toUpperCase() !== 'RESET') {
      onErrorToast('清空仓库代码需先在确认框中输入 RESET', '需要二次确认');
      return;
    }
    setResetting(true);
    try {
      const res = await fetch('/api/admin/reset-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          async: true,
          repoFullName: targetFullName,
          clearState: optClearState,
          deleteActionRuns: optDeleteActions,
          resetGithubPrsAndBranches: optResetBranches,
          wipeCloudflareD1: optWipeD1,
          wipeRepoCode: optWipeRepoCode,
          keepRsiRules: optKeepRsiRules,
          d1TargetNames: ['community_db', 'community_db-preview'],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.task) {
        onBackgroundTaskStarted?.(json.task as BackgroundTask);
        setShowResetPanel(false);
        setOptWipeRepoCode(false);
        setWipeConfirmText('');
        onSuccessToast(
          optWipeRepoCode
            ? '清空仓库代码与环境重置已转入服务端后台执行，离开页面不会中断'
            : '测试环境清库重置已转入服务端后台执行，切换房间不会中断',
          '后台清理已启动'
        );
        return;
      }
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const deletedActions = Number(json.github?.deletedActionRuns ?? 0);
      const closedPrs = Array.isArray(json.github?.closedPrNumbers)
        ? json.github.closedPrNumbers.length
        : 0;
      const deletedBranches = Array.isArray(json.github?.deletedBranches)
        ? json.github.deletedBranches.length
        : 0;
      const droppedTablesTotal = Array.isArray(json.cloudflareD1?.databases)
        ? json.cloudflareD1.databases.reduce(
            (sum: number, db: { droppedTables?: string[] }) =>
              sum + (Array.isArray(db.droppedTables) ? db.droppedTables.length : 0),
            0
          )
        : 0;
      const removedRepoFiles = Number(json.repoCodeWipe?.removedFilesCount ?? 0);

      const summaryParts: string[] = [];
      if (optWipeRepoCode) summaryParts.push(`已清空主分支业务代码（移除 ${removedRepoFiles} 个文件，保留 Workflows）`);
      if (optClearState) summaryParts.push('状态分支与台账已清空');
      if (optDeleteActions) summaryParts.push(`删除 ${deletedActions} 条 Actions 记录`);
      if (optResetBranches) summaryParts.push(`关闭 ${closedPrs} 个 PR / 删 ${deletedBranches} 个分支`);
      if (optWipeD1) summaryParts.push(`清理 ${droppedTablesTotal} 张 D1 表`);

      onSuccessToast(summaryParts.join(' · '), optWipeRepoCode ? '仓库已清空重来' : '测试环境已清库重置');
      setShowResetPanel(false);
      setOptWipeRepoCode(false);
      setWipeConfirmText('');
      onEnvironmentReset?.();
      setOverviewRefreshSignal((prev) => prev + 1);
      await Promise.all([fetchRunnerStatus(), fetchTelemetry(true)]);
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '执行一键清库失败',
        '清库重置失败'
      );
    } finally {
      setResetting(false);
    }
  };

  const handleOpenWipeRepoPreset = () => {
    setOptClearState(true);
    setOptDeleteActions(true);
    setOptResetBranches(true);
    setOptWipeD1(true);
    setOptWipeRepoCode(true);
    setWipeConfirmText('');
    setShowResetPanel(true);
  };

  const onlineRunners = (runnerInfo?.runners ?? []).filter((r) => r.status === 'online');
  const busyRunnersCount = onlineRunners.filter((r) => r.busy).length;

  const rateLimit = telemetry?.rateLimit;
  const statePersistence = telemetry?.statePersistence;
  const rateLimitPct =
    rateLimit?.limit && rateLimit.remaining !== null
      ? Math.max(0, Math.min(100, Math.round((rateLimit.remaining / rateLimit.limit) * 100)))
      : null;

  const githubOk = Boolean(status?.github.connected);
  const runnerOk = onlineRunners.length > 0;
  const cloudflareOk = Boolean(status?.cloudflare.connected);
  const geminiOk = Boolean(status?.gemini.configured);

  return (
    <div className="space-y-5">
      {/* Condensed Section Header with Live Service Health Indicators */}
      <div
        data-testid="env-compact-header"
        className="flex flex-col gap-3 pb-4 border-b border-[#30363D]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pr-10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <h1 className="text-[19px] font-semibold tracking-tight text-[#F0F6FC] text-balance">
              环境与引擎装配
            </h1>
            <a
              href={pinnedLiveRepo?.htmlUrl || FIXED_TARGET_REPO.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[12px] font-medium text-[#58A6FF] hover:underline"
            >
              <span>{FIXED_TARGET_REPO.fullName}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>

          <button
            type="button"
            onClick={() => {
              onRefresh();
              fetchRunnerStatus();
              fetchTelemetry(true);
              setOverviewRefreshSignal((prev) => prev + 1);
            }}
            disabled={loading || runnerLoading || telemetryLoading}
            className="inline-flex items-center gap-2 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12.5px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || runnerLoading || telemetryLoading ? 'animate-spin' : ''}`}
            />
            <span>{loading ? '检测中…' : '刷新状态'}</span>
          </button>
        </div>

        {/* Inline Live Health Strip: GitHub · VPS AGY Runner · Cloudflare · Gemini */}
        <div
          data-testid="env-header-health-strip"
          aria-label="核心引擎在线状态"
          className="flex flex-wrap items-center gap-2 text-[11.5px]"
        >
          {/* GitHub */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30363D] bg-[#161B22] px-2.5 py-1">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                loading && !status
                  ? 'bg-[#8B949E]'
                  : githubOk
                    ? 'bg-[#3FB950]'
                    : 'bg-[#D29922]'
              }`}
            />
            <GitBranch className="h-3 w-3 text-[#58A6FF] shrink-0" />
            <span className="font-semibold text-[#F0F6FC]">GitHub</span>
            <span className={`font-mono ${githubOk ? 'text-[#3FB950]' : 'text-[#8B949E]'}`}>
              {loading && !status
                ? '检测中'
                : githubOk
                  ? status?.github.user?.login
                    ? `@${status.github.user.login}`
                    : 'OK'
                  : status?.github.configured
                    ? '异常'
                    : '未配置'}
            </span>
          </span>

          {/* VPS AGY Runner */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30363D] bg-[#161B22] px-2.5 py-1">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                runnerLoading && !runnerInfo
                  ? 'bg-[#8B949E]'
                  : runnerOk
                    ? 'bg-[#3FB950]'
                    : 'bg-[#F85149]'
              }`}
            />
            <Server className="h-3 w-3 text-[#58A6FF] shrink-0" />
            <span className="font-semibold text-[#F0F6FC]">VPS Runner</span>
            <span
              className={`font-mono tabular-nums ${
                runnerOk
                  ? busyRunnersCount > 0
                    ? 'text-[#D29922]'
                    : 'text-[#3FB950]'
                  : 'text-[#8B949E]'
              }`}
            >
              {runnerLoading && !runnerInfo
                ? '检测中'
                : runnerOk
                  ? `在线 ${onlineRunners.length}${busyRunnersCount > 0 ? ' · Busy' : ' · Idle'}`
                  : '离线'}
            </span>
          </span>

          {/* Cloudflare */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30363D] bg-[#161B22] px-2.5 py-1">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                loading && !status
                  ? 'bg-[#8B949E]'
                  : cloudflareOk
                    ? 'bg-[#3FB950]'
                    : 'bg-[#D29922]'
              }`}
            />
            <Cloud className="h-3 w-3 text-[#58A6FF] shrink-0" />
            <span className="font-semibold text-[#F0F6FC]">Cloudflare</span>
            <span className={`font-mono ${cloudflareOk ? 'text-[#3FB950]' : 'text-[#8B949E]'}`}>
              {loading && !status
                ? '检测中'
                : cloudflareOk
                  ? 'OK'
                  : status?.cloudflare.configured
                    ? '异常'
                    : '未配置'}
            </span>
          </span>

          {/* Gemini Engine */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30363D] bg-[#161B22] px-2.5 py-1">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                loading && !status
                  ? 'bg-[#8B949E]'
                  : geminiOk
                    ? 'bg-[#3FB950]'
                    : 'bg-[#F85149]'
              }`}
            />
            <Cpu className="h-3 w-3 text-[#58A6FF] shrink-0" />
            <span className="font-semibold text-[#F0F6FC]">Gemini</span>
            <span className={`font-mono ${geminiOk ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
              {loading && !status ? '检测中' : geminiOk ? 'OK' : '未配置'}
            </span>
          </span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-4 py-3 text-[13px] text-[#FFDCD7] flex items-start gap-2.5"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#F85149]" />
          <span>连通性接口请求失败：{error}</span>
        </div>
      )}

      {/* Global 7-Day R&D Efficiency Overview Dashboard (flat, no nested container) */}
      <OverviewDashboard
        repoFullName={targetFullName}
        refreshSignal={overviewRefreshSignal}
        onErrorToast={onErrorToast}
      />

      {/* Dedicated Danger Zone: State Persistence, GitHub API Quota, Clean-Slate Reset & Wipe Repo Code */}
      <section
        aria-label="危险区：状态持久化、API 配额与测试清库"
        className="rounded-md border border-[#F85149]/40 bg-[#161B22] overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#F85149]/30 bg-[#F85149]/5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-[14px] font-semibold text-[#FF7B72] flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#F85149]" />
              <span>危险区 · 状态持久化、API 配额与清库重置</span>
            </h2>
            <p className="text-[11px] text-[#8B949E]">
              底层控制面运维操作区域：支持状态同步、测试清库及一键清空仓库业务代码从头开始。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleManualStateSync}
              disabled={syncingState || !status?.github.connected}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <UploadCloud className={`h-3.5 w-3.5 ${syncingState ? 'animate-pulse' : ''}`} />
              <span>{syncingState ? '同步中…' : '立即同步状态分支'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOptWipeRepoCode(false);
                setWipeConfirmText('');
                setShowResetPanel((prev) => !prev);
              }}
              disabled={resetting}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-3 py-1.5 text-[12px] font-medium text-[#FF7B72] hover:bg-[#F85149]/20 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{showResetPanel ? '收起清理面板' : '测试清库重置'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenWipeRepoPreset}
              disabled={resetting || !status?.github.connected}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#DA3633] border border-[#F85149]/60 px-3 py-1.5 text-[12px] font-medium text-[#F0F6FC] hover:bg-[#F85149] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>一键清空仓库代码，从头开始</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* 2-Column Telemetry Strip: GitHub State Branch + Rate Limit Quota */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* GitHub Orphan Branch Persistence Status */}
            <div className="rounded-md border border-[#30363D] bg-[#0D1117] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="font-semibold text-[#F0F6FC] flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 text-[#3FB950]" />
                  <span>GitHub 独立状态分支持久化</span>
                </span>
                <span className="font-mono text-[11px] text-[#3FB950]">
                  {statePersistence?.enabled
                    ? statePersistence.syncing
                      ? '同步写入中…'
                      : statePersistence.pendingKeys.length > 0
                        ? `待合并写入 (${statePersistence.pendingKeys.length})`
                        : '已启用 · 防丢保护'
                    : '未启用'}
                </span>
              </div>

              <div className="text-[12px] text-[#8B949E] leading-relaxed font-mono tabular-nums space-y-1">
                <div>
                  分支 <span className="text-[#C9D1D9]">{statePersistence?.branch || 'autodev-state'}</span>
                  {statePersistence?.lastCommitSha && (
                    <>
                      <span aria-hidden="true" className="mx-1.5 text-[#6E7681]">·</span>
                      <span>HEAD {statePersistence.lastCommitSha.slice(0, 7)}</span>
                    </>
                  )}
                </div>
                <div>
                  最近同步 {formatShortTime(statePersistence?.lastSyncedAt || statePersistence?.hydratedAt)}
                  <span aria-hidden="true" className="mx-1.5 text-[#6E7681]">·</span>
                  合并提交 {statePersistence?.totalFlushes ?? 0} 次（防抖合并省 {statePersistence?.coalescedWritesSaved ?? 0} 次写）
                </div>
              </div>

              {statePersistence?.lastError && (
                <div className="text-[11px] text-[#F85149] font-mono break-all">
                  最近同步告警：{statePersistence.lastError}
                </div>
              )}
            </div>

            {/* GitHub REST API Quota & Optimization Savings */}
            <div className="rounded-md border border-[#30363D] bg-[#0D1117] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="font-semibold text-[#F0F6FC] flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5 text-[#58A6FF]" />
                  <span>GitHub API 小时配额与缓存节流</span>
                </span>
                <span className="font-mono tabular-nums text-[11px] text-[#C9D1D9]">
                  {rateLimit?.remaining !== null && rateLimit?.limit
                    ? `剩余 ${rateLimit.remaining.toLocaleString()} / ${rateLimit.limit.toLocaleString()}`
                    : '读取中…'}
                </span>
              </div>

              {rateLimitPct !== null && (
                <div className="h-1.5 w-full rounded-full bg-[#21262D] overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      rateLimitPct > 30
                        ? 'bg-[#3FB950]'
                        : rateLimitPct > 12
                          ? 'bg-[#D29922]'
                          : 'bg-[#F85149]'
                    }`}
                    style={{ width: `${rateLimitPct}%` }}
                  />
                </div>
              )}

              <div className="text-[12px] text-[#8B949E] font-mono tabular-nums space-y-1">
                <div>
                  重置时间 {formatShortTime(rateLimit?.resetAt)}
                  <span aria-hidden="true" className="mx-1.5 text-[#6E7681]">·</span>
                  已省请求 <span className="text-[#3FB950] font-semibold">{rateLimit?.optimization.totalSavedRequests ?? 0}</span> 次
                </div>
                <div className="text-[11px] text-[#6E7681]">
                  TTL 缓存 {rateLimit?.optimization.ttlCacheHits ?? 0} · ETag 304 零配额 {rateLimit?.optimization.etag304Hits ?? 0} · 并发合并 {rateLimit?.optimization.inflightDedupHits ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Inline Danger Zone Clean-Slate & Wipe Repo Confirmation Panel */}
          {showResetPanel && (
            <div className="rounded-md border border-[#F85149]/50 bg-[#F85149]/8 p-4 space-y-4">
              <div className="space-y-1">
                <h3 className="text-[13px] font-semibold text-[#FF7B72]">
                  {optWipeRepoCode
                    ? '高危确认：一键清空仓库业务代码并重置全部测试环境'
                    : '确认清理测试环境数据（不可逆）'}
                </h3>
                <p className="text-[12px] text-[#8B949E]">
                  选择需要清空的范围，提交后会同步刷新「近 7 日全局研发效能概览」、状态分支与运行台账。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px] text-[#C9D1D9]">
                <label className="flex items-start gap-2 cursor-pointer select-none sm:col-span-2 rounded border border-[#F85149]/40 bg-[#0D1117] p-3">
                  <input
                    type="checkbox"
                    checked={optWipeRepoCode}
                    onChange={(e) => {
                      setOptWipeRepoCode(e.target.checked);
                      if (!e.target.checked) setWipeConfirmText('');
                    }}
                    className="mt-0.5 rounded border-[#F85149] bg-[#0D1117]"
                  />
                  <span className="space-y-0.5">
                    <span className="block font-semibold text-[#FF7B72]">
                      清空目标仓库 <code className="font-mono">{targetFullName}</code> 主分支所有业务代码，从头开始
                    </span>
                    <span className="block text-[11px] text-[#8B949E]">
                      保留干净的 <code className="font-mono text-[#C9D1D9]">README.md</code> 与 3 个 AutoDev Workflows（<code className="font-mono text-[#C9D1D9]">.github/workflows/autodev-*.yml</code>），并重置 <code className="font-mono text-[#C9D1D9]">autodev-plan-channel</code> 盲测缓存，可直接开始全新项目构建。
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={optClearState}
                    onChange={(e) => setOptClearState(e.target.checked)}
                    className="mt-0.5 rounded border-[#30363D] bg-[#0D1117]"
                  />
                  <span>清空本地与 <code className="font-mono text-[#F0F6FC]">autodev-state</code> 状态分支（需求台账、任务、审计日志、测试报告）</span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={optDeleteActions}
                    onChange={(e) => setOptDeleteActions(e.target.checked)}
                    className="mt-0.5 rounded border-[#30363D] bg-[#0D1117]"
                  />
                  <span>直接删除仓库历史 GitHub Actions 记录（使「近 7 日全局概览」归零）</span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={optResetBranches}
                    onChange={(e) => setOptResetBranches(e.target.checked)}
                    className="mt-0.5 rounded border-[#30363D] bg-[#0D1117]"
                  />
                  <span>关闭所有 Open AutoDev PR 并删除 <code className="font-mono text-[#F0F6FC]">autodev/feat-*</code> 分支</span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={optWipeD1}
                    onChange={(e) => setOptWipeD1(e.target.checked)}
                    className="mt-0.5 rounded border-[#30363D] bg-[#0D1117]"
                  />
                  <span>清空项目 Cloudflare D1 数据表（仅限 <code className="font-mono text-[#F0F6FC]">community_db</code> 与预览库）</span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer select-none sm:col-span-2 pt-1 border-t border-[#30363D]/60 text-[#8B949E]">
                  <input
                    type="checkbox"
                    checked={optKeepRsiRules}
                    onChange={(e) => setOptKeepRsiRules(e.target.checked)}
                    disabled={!optClearState}
                    className="mt-0.5 rounded border-[#30363D] bg-[#0D1117]"
                  />
                  <span>保留已沉淀的 RSI 自进化 System Prompt 规则（仅清历史报告与台账）</span>
                </label>
              </div>

              {optWipeRepoCode && (
                <div className="rounded-md border border-[#F85149]/50 bg-[#0D1117] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label htmlFor="wipe-confirm-input" className="text-[12px] text-[#FFDCD7]">
                    为防止误清空 <code className="font-mono">{targetFullName}</code> 主分支代码，请输入{' '}
                    <code className="font-mono font-semibold text-[#FF7B72]">RESET</code> 确认：
                  </label>
                  <input
                    id="wipe-confirm-input"
                    type="text"
                    value={wipeConfirmText}
                    onChange={(e) => setWipeConfirmText(e.target.value)}
                    placeholder="输入 RESET"
                    className="rounded-md border border-[#F85149]/50 bg-[#161B22] px-3 py-1.5 font-mono text-[12px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#FF7B72] focus:outline-none w-full sm:w-[160px]"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#30363D]/60">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPanel(false);
                    setOptWipeRepoCode(false);
                    setWipeConfirmText('');
                  }}
                  disabled={resetting}
                  className="rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] disabled:opacity-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleExecuteResetAll}
                  disabled={
                    resetting ||
                    (optWipeRepoCode && wipeConfirmText.trim().toUpperCase() !== 'RESET')
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#DA3633] border border-[#F85149]/50 px-3.5 py-1.5 text-[12px] font-medium text-[#F0F6FC] hover:bg-[#F85149] disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>
                    {resetting
                      ? '正在执行重置…'
                      : optWipeRepoCode
                        ? '确认清空仓库代码并重来'
                        : '确认立即执行清库'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
