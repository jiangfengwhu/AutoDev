import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Cpu,
  ExternalLink,
  GitBranch,
  Lock,
  RefreshCw,
  Server,
  Unlock,
} from 'lucide-react';
import type {
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

export function EnvironmentView({
  status,
  loading,
  error,
  onRefresh,
  selectedRepo,
  onErrorToast,
}: EnvironmentViewProps) {
  const [runnerInfo, setRunnerInfo] = useState<RunnersApiResponse | null>(null);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [overviewRefreshSignal, setOverviewRefreshSignal] = useState(0);

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

  useEffect(() => {
    if (status?.github.connected) {
      fetchRunnerStatus();
    }
  }, [status?.github.connected, fetchRunnerStatus]);

  const onlineRunners = (runnerInfo?.runners ?? []).filter((r) => r.status === 'online');

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC] text-balance">
            环境与引擎装配
          </h1>
          <p className="mt-1 text-[13px] text-[#8B949E]">
            仓库 <code className="font-mono text-[#C9D1D9]">{FIXED_TARGET_REPO.fullName}</code> · VPS Self-Hosted Runner
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            onRefresh();
            fetchRunnerStatus();
            setOverviewRefreshSignal((prev) => prev + 1);
          }}
          disabled={loading || runnerLoading}
          className="inline-flex items-center gap-2 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-1.5 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading || runnerLoading ? 'animate-spin' : ''}`}
          />
          <span>{loading ? '检测中…' : '刷新状态'}</span>
        </button>
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

      {/* Global 7-Day R&D Efficiency Overview Dashboard */}
      <OverviewDashboard
        repoFullName={targetFullName}
        refreshSignal={overviewRefreshSignal}
        onErrorToast={onErrorToast}
      />

      {/* 3-Column Integration Status Grid */}
      <section aria-label="外部引擎连通状态" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* GitHub Card */}
        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[#F0F6FC]">
                <GitBranch className="h-4 w-4 text-[#58A6FF]" />
                <span>GitHub 执行沙箱</span>
              </div>
              {loading && !status ? (
                <span className="text-[12px] text-[#8B949E]">检测中…</span>
              ) : status?.github.connected ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3FB950]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已连接
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#D29922]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {status?.github.configured ? '鉴权异常' : '未配置'}
                </span>
              )}
            </div>

            <div className="mt-3 text-[12px] text-[#8B949E] leading-relaxed">
              {loading && !status ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-3.5 w-2/3 rounded bg-[#21262D]" />
                  <div className="h-3.5 w-1/2 rounded bg-[#21262D]" />
                </div>
              ) : status?.github.connected && status.github.user ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[#F0F6FC]">
                    <span className="font-mono font-medium">@{status.github.user.login}</span>
                    {status.github.user.name && (
                      <>
                        <span aria-hidden="true" className="text-[#6E7681]">·</span>
                        <span className="text-[#8B949E] truncate">{status.github.user.name}</span>
                      </>
                    )}
                  </div>
                  <div className="font-mono text-[#8B949E]">
                    {FIXED_TARGET_REPO.fullName}
                  </div>
                </div>
              ) : (
                <p className="text-[#D29922]">
                  {status?.github.error || 'GitHub 鉴权未就绪'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Cloudflare Card */}
        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[#F0F6FC]">
                <Cloud className="h-4 w-4 text-[#58A6FF]" />
                <span>Cloudflare 运行时</span>
              </div>
              {loading && !status ? (
                <span className="text-[12px] text-[#8B949E]">检测中…</span>
              ) : status?.cloudflare.connected ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3FB950]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已连接
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#D29922]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {status?.cloudflare.configured ? '鉴权异常' : '未配置'}
                </span>
              )}
            </div>

            <div className="mt-3 text-[12px] text-[#8B949E] leading-relaxed">
              {loading && !status ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-3.5 w-3/4 rounded bg-[#21262D]" />
                  <div className="h-3.5 w-1/2 rounded bg-[#21262D]" />
                </div>
              ) : status?.cloudflare.connected ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[#F0F6FC] font-mono">
                    <span>Account {status.cloudflare.accountIdMasked}</span>
                    {status.cloudflare.tokenStatus && (
                      <>
                        <span aria-hidden="true" className="text-[#6E7681]">·</span>
                        <span className="text-[#3FB950]">{status.cloudflare.tokenStatus}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span>Workers {status.cloudflare.workers.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>Workflows {status.cloudflare.workflows.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>KV {status.cloudflare.kvNamespaces.length}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[#D29922]">
                  {status?.cloudflare.error || 'Cloudflare 凭证未就绪'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Gemini Engine Card */}
        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[#F0F6FC]">
                <Cpu className="h-4 w-4 text-[#58A6FF]" />
                <span>多智能体推理引擎</span>
              </div>
              {loading && !status ? (
                <span className="text-[12px] text-[#8B949E]">检测中…</span>
              ) : status?.gemini.configured ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3FB950]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  就绪
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#F85149]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  未配置
                </span>
              )}
            </div>

            <div className="mt-3 text-[12px] text-[#8B949E] leading-relaxed space-y-1">
              <div className="text-[#F0F6FC] font-mono">
                {status?.gemini.model || 'gemini-4-hydrogen'}
              </div>
              <div>
                Architect · QA Spec · QA Critic
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pinned Repository & VPS Self-Hosted AGY Runner */}
      <section
        aria-label="锁定仓库与 VPS AGY Runner 状态"
        className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden"
      >
          <div className="px-5 py-3.5 border-b border-[#30363D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold text-[#F0F6FC] flex items-center gap-2">
              <Server className="h-4 w-4 text-[#58A6FF]" />
              <span>目标仓库与 VPS AGY Runner</span>
            </h2>
            <button
              type="button"
              onClick={fetchRunnerStatus}
              disabled={runnerLoading || !status?.github.connected}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${runnerLoading ? 'animate-spin' : ''}`} />
              <span>刷新 Runner</span>
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Pinned Repo Summary */}
            <div className="rounded-md border border-[#30363D] bg-[#0D1117] p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {pinnedLiveRepo?.private ? (
                    <Lock className="h-3.5 w-3.5 text-[#3FB950] shrink-0" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5 text-[#8B949E] shrink-0" />
                  )}
                  <a
                    href={pinnedLiveRepo?.htmlUrl || FIXED_TARGET_REPO.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[14px] font-semibold text-[#58A6FF] hover:underline inline-flex items-center gap-1.5"
                  >
                    <span>{FIXED_TARGET_REPO.fullName}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <span className="text-[12px] font-mono text-[#8B949E]">
                  {pinnedLiveRepo?.private ? 'Private' : 'Public'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8B949E] font-mono tabular-nums">
                <span>分支 {pinnedLiveRepo?.defaultBranch || 'main'}</span>
                <span aria-hidden="true" className="text-[#6E7681]">·</span>
                <span>{pinnedLiveRepo?.canPush ? '可写入' : '待检测权限'}</span>
                {runnerInfo?.branches && runnerInfo.branches.length > 0 && (
                  <>
                    <span aria-hidden="true" className="text-[#6E7681]">·</span>
                    <span>{runnerInfo.branches.length} 个活跃分支</span>
                  </>
                )}
              </div>
            </div>

            {/* Live Self-Hosted Runners */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-[#F0F6FC]">
                  Self-Hosted Runner 节点
                </span>
                <span className="font-mono tabular-nums text-[#8B949E]">
                  在线 {onlineRunners.length} / {runnerInfo?.runners.length ?? 0}
                </span>
              </div>

              {runnerInfo?.error ? (
                <div className="rounded-md border border-[#D29922]/40 bg-[#D29922]/10 px-4 py-3 text-[12px] text-[#F2CC60] leading-relaxed">
                  {runnerInfo.error}
                </div>
              ) : runnerInfo && runnerInfo.runners.length > 0 ? (
                <div className="rounded-md border border-[#30363D] divide-y divide-[#21262D] bg-[#0D1117]">
                  {runnerInfo.runners.map((runner) => {
                    const isOnline = runner.status === 'online';
                    return (
                      <div
                        key={runner.id}
                        className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[12px]"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isOnline ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#3FB950] shrink-0" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-[#F85149] shrink-0" />
                            )}
                            <span className="font-mono font-medium text-[#F0F6FC]">
                              {runner.name}
                            </span>
                            <span className="text-[#6E7681] font-mono">({runner.os})</span>
                          </div>
                          <div className="font-mono text-[11px] text-[#8B949E]">
                            {runner.labels.join(', ') || 'self-hosted'}
                          </div>
                        </div>

                        <div className="font-mono text-[12px] shrink-0">
                          {isOnline ? (
                            <span className={runner.busy ? 'text-[#D29922]' : 'text-[#3FB950]'}>
                              {runner.busy ? 'Busy' : 'Idle'}
                            </span>
                          ) : (
                            <span className="text-[#F85149]">Offline</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-[#30363D] bg-[#0D1117] px-4 py-4 text-[12px] text-[#8B949E]">
                  {runnerLoading ? '正在查询 Runner 列表…' : '暂未检测到已注册的 Runner。'}
                </div>
              )}
            </div>
          </div>
      </section>
    </div>
  );
}
