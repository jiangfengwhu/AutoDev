import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Inbox,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { apiFetch } from '../lib/editAuthClient';
import type {
  FeedbackRecord,
  FeedbackStatus,
  ProdErrorGroup,
  ProdErrorStatus,
  SignalsDashboardPayload,
} from '../lib/signalsEngine';
import type { BackgroundTask } from '../types/autodev';

export type SignalsPanelMode = 'feedback' | 'errors';

interface SignalsHubPanelProps {
  mode: SignalsPanelMode;
  repoFullName: string;
  refreshNonce?: number;
  activeTasks?: BackgroundTask[];
  onBackgroundTaskStarted?: (task: BackgroundTask) => void;
  onClosePavilion?: () => void;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

const FEEDBACK_STATUS_META: Record<
  FeedbackStatus,
  { label: string; colorClass: string }
> = {
  pending: { label: '待巡检', colorClass: 'text-amber-700' },
  accepted_queued: { label: '已采纳·待派发', colorClass: 'text-blue-700' },
  dispatched: { label: '已直通编码', colorClass: 'text-emerald-700' },
  rejected_malicious: { label: '已拦截·恶意/注入', colorClass: 'text-red-700' },
  rejected_invalid: { label: '已过滤·无效反馈', colorClass: 'text-slate-500' },
  needs_manual_prd: { label: '建议转大型 PRD', colorClass: 'text-violet-700' },
  ignored: { label: '已人工忽略', colorClass: 'text-slate-400' },
};

const ERROR_STATUS_META: Record<
  ProdErrorStatus,
  { label: string; colorClass: string }
> = {
  new: { label: '新捕获·合批中', colorClass: 'text-amber-700' },
  analyzing: { label: 'AI 评估中', colorClass: 'text-blue-700' },
  filtered_noise: { label: '已过滤·外部噪音', colorClass: 'text-slate-500' },
  rejected_malicious: { label: '已拦截·疑似注入', colorClass: 'text-red-700' },
  queued_for_agy: { label: '排队等待合批 PR', colorClass: 'text-amber-700' },
  fixing: { label: 'AGY 修复中', colorClass: 'text-blue-700' },
  pr_ready: { label: 'PR 待 ST-04 验收', colorClass: 'text-emerald-700' },
  resolved: { label: '已合入解决', colorClass: 'text-emerald-700' },
  ignored: { label: '已忽略指纹', colorClass: 'text-slate-400' },
};

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function SignalsHubPanel({
  mode,
  refreshNonce = 0,
  activeTasks = [],
  onBackgroundTaskStarted,
  onClosePavilion,
  onErrorToast,
  onSuccessToast,
}: SignalsHubPanelProps) {
  const [data, setData] = useState<SignalsDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingLive, setSyncingLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Feedback filters
  const [fbFilter, setFbFilter] = useState<'all' | 'pending' | 'accepted' | 'blocked' | 'manual'>('all');
  const [fbSearch, setFbSearch] = useState('');
  const [expandedFbId, setExpandedFbId] = useState<string | null>(null);
  const [triagingDaily, setTriagingDaily] = useState(false);
  const [dispatchingFbId, setDispatchingFbId] = useState<string | null>(null);

  // Error filters
  const [errFilter, setErrFilter] = useState<'all' | 'active' | 'fixing' | 'filtered' | 'resolved'>('all');
  const [errSearch, setErrSearch] = useState('');
  const [expandedErrId, setExpandedErrId] = useState<string | null>(null);
  const [flushingErrors, setFlushingErrors] = useState(false);
  const [flushingErrId, setFlushingErrId] = useState<string | null>(null);

  const runningSignalTasks = useMemo(
    () =>
      activeTasks.filter(
        (t) =>
          t.status === 'running' &&
          (t.kind === 'signals_triage' || t.kind === 'signals_autofix')
      ),
    [activeTasks]
  );

  const loadSignals = useCallback(async (opts?: { silent?: boolean; forcePull?: boolean }) => {
    const silent = opts?.silent ?? false;
    const forcePull = opts?.forcePull ?? false;
    if (!silent) setLoading(true);
    if (forcePull) setSyncingLive(true);
    setError(null);
    try {
      const url = forcePull ? '/api/signals/state?refresh=1' : '/api/signals/state';
      const res = await fetch(url);
      const json = (await res.json()) as SignalsDashboardPayload & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || `加载线上信号失败 (HTTP ${res.status})`);
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载线上信号状态失败');
    } finally {
      setLoading(false);
      setSyncingLive(false);
    }
  }, []);

  useEffect(() => {
    void loadSignals({ silent: data !== null });
  }, [loadSignals, refreshNonce]);

  // Continuously keep signal status cards fresh while any triage/autofix task is running in background
  useEffect(() => {
    if (runningSignalTasks.length === 0) return;
    const timer = setInterval(() => {
      void loadSignals({ silent: true });
    }, 2500);
    return () => clearInterval(timer);
  }, [runningSignalTasks.length, loadSignals]);

  const handleRunDailyTriage = async () => {
    setTriagingDaily(true);
    try {
      const res = await apiFetch('/api/triage/feedback/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual', async: true }),
      });
      const json = (await res.json()) as { task?: BackgroundTask; message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || `触发每日反馈巡检失败 (HTTP ${res.status})`);
      }
      if (json.task && onBackgroundTaskStarted) {
        onBackgroundTaskStarted(json.task);
      }
      setExpandedFbId(null);
      onSuccessToast(
        json.message || '已启动用户反馈 AI 筛选与直通编码派发，可在后台队列实时查看进度。',
        '反馈派发已启动'
      );
      onClosePavilion?.();
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '触发每日巡检失败', '巡检启动失败');
    } finally {
      setTriagingDaily(false);
    }
  };

  const handleDirectDispatchFeedback = async (id: string) => {
    setDispatchingFbId(id);
    try {
      const res = await apiFetch(`/api/signals/feedback/${encodeURIComponent(id)}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = (await res.json()) as { task?: BackgroundTask; error?: string };
      if (!res.ok) {
        throw new Error(json.error || `直接派发编码失败 (HTTP ${res.status})`);
      }
      if (json.task && onBackgroundTaskStarted) {
        onBackgroundTaskStarted(json.task);
      }
      setExpandedFbId(null);
      onSuccessToast(
        '已一键直派该条反馈至 AGY 编码流水线，正在生成轻量任务书与 Draft PR。',
        '一键直派已启动'
      );
      onClosePavilion?.();
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '直接派发失败', '派发失败');
    } finally {
      setDispatchingFbId(null);
    }
  };

  const handleFlushErrors = async (groupIds?: string[]) => {
    const singleId = groupIds && groupIds.length === 1 ? groupIds[0] : null;
    if (singleId) setFlushingErrId(singleId);
    else setFlushingErrors(true);
    try {
      const res = await apiFetch('/api/signals/errors/flush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupIds ? { groupIds } : {}),
      });
      const json = (await res.json()) as { task?: BackgroundTask; error?: string };
      if (!res.ok) {
        throw new Error(json.error || `触发报错合并修复失败 (HTTP ${res.status})`);
      }
      if (json.task && onBackgroundTaskStarted) {
        onBackgroundTaskStarted(json.task);
      }
      setExpandedErrId(null);
      onSuccessToast(
        '已启动线上报错单 PR 合并自愈调度（若已有活跃自愈 PR 将自动合并至同一 PR）。',
        '报错自愈调度已启动'
      );
      onClosePavilion?.();
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '触发合并修复失败', '调度失败');
    } finally {
      setFlushingErrId(null);
      setFlushingErrors(false);
    }
  };

  const handleUpdateFeedbackStatus = async (id: string, status: FeedbackStatus) => {
    try {
      const res = await apiFetch(`/api/signals/feedback/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json()) as { record?: FeedbackRecord; error?: string };
      if (!res.ok) throw new Error(json.error || '更新反馈状态失败');
      if (json.record) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                feedback: prev.feedback.map((f) => (f.id === id ? json.record! : f)),
              }
            : prev
        );
      }
      setExpandedFbId(null);
      onSuccessToast('已更新反馈处理状态', '状态已同步');
      void loadSignals({ silent: true });
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '更新状态失败');
    }
  };

  const handleUpdateErrorStatus = async (id: string, status: ProdErrorStatus) => {
    try {
      const res = await apiFetch(`/api/signals/errors/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json()) as { group?: ProdErrorGroup; error?: string };
      if (!res.ok) throw new Error(json.error || '更新报错状态失败');
      if (json.group) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                prodErrors: prev.prodErrors.map((g) => (g.id === id ? json.group! : g)),
              }
            : prev
        );
      }
      setExpandedErrId(null);
      onSuccessToast('已更新报错指纹状态', '状态已同步');
      void loadSignals({ silent: true });
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '更新报错状态失败');
    }
  };

  const filteredFeedback = useMemo(() => {
    const list = data?.feedback ?? [];
    const q = fbSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (fbFilter === 'pending' && item.status !== 'pending') return false;
      if (fbFilter === 'accepted' && item.status !== 'accepted_queued' && item.status !== 'dispatched') return false;
      if (fbFilter === 'blocked' && item.status !== 'rejected_malicious' && item.status !== 'rejected_invalid' && item.status !== 'ignored') return false;
      if (fbFilter === 'manual' && item.status !== 'needs_manual_prd') return false;
      if (q) {
        const hay = `${item.content} ${item.pageRoute || ''} ${item.triageReason || ''} ${item.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.feedback, fbFilter, fbSearch]);

  const filteredErrors = useMemo(() => {
    const list = data?.prodErrors ?? [];
    const q = errSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (errFilter === 'active' && item.status !== 'new' && item.status !== 'analyzing' && item.status !== 'queued_for_agy') return false;
      if (errFilter === 'fixing' && item.status !== 'fixing' && item.status !== 'pr_ready') return false;
      if (errFilter === 'filtered' && item.status !== 'filtered_noise' && item.status !== 'rejected_malicious' && item.status !== 'ignored') return false;
      if (errFilter === 'resolved' && item.status !== 'resolved') return false;
      if (q) {
        const hay = `${item.errorName} ${item.normalizedMessage} ${item.route} ${item.fingerprint} ${item.topFrame}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.prodErrors, errFilter, errSearch]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-20 rounded-md border border-slate-200 bg-white p-4 animate-pulse"
            >
              <div className="h-3 w-20 bg-slate-200 rounded" />
              <div className="mt-3 h-6 w-12 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
        <div className="h-56 rounded-md border border-slate-200 bg-white animate-pulse" />
      </div>
    );
  }

  const summary = data?.summary;
  const config = data?.config;

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadSignals({ forcePull: true })}
            className="text-[12px] font-medium text-red-700 underline whitespace-nowrap"
          >
            重试
          </button>
        </div>
      )}

      {runningSignalTasks.length > 0 && (
        <div
          role="status"
          className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[13px] text-blue-900 flex items-center gap-2.5"
        >
          <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{runningSignalTasks[0].title}</span>
            <span className="mx-1.5 text-blue-300">·</span>
            <span className="text-blue-800">{runningSignalTasks[0].progressMessage}</span>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1: PRODUCTION USER FEEDBACK INBOX & DAILY SMART TRIAGE        */}
      {/* ================================================================= */}
      {mode === 'feedback' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-[18px] font-semibold text-slate-900 tracking-tight">
                线上用户反馈与每日直通迭代
              </h2>
              <p className="mt-1 text-[13px] text-slate-600">
                自动从线上 <code className="font-mono text-slate-800">atd-v1</code> 同步并保存至 <code className="font-mono text-slate-800">autodev-state</code> · 支持单条一键直派或每日合并筛选直发 AGY
                {summary?.lastDailyTriageAt && (
                  <span className="font-mono text-[12px] text-slate-500 tabular-nums">
                    {' '}· 上次巡检 {formatTime(summary.lastDailyTriageAt)}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRunDailyTriage}
                disabled={triagingDaily || runningSignalTasks.some((t) => t.kind === 'signals_triage')}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {triagingDaily || runningSignalTasks.some((t) => t.kind === 'signals_triage') ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>
                  {triagingDaily || runningSignalTasks.some((t) => t.kind === 'signals_triage')
                    ? '巡检派发中…'
                    : (summary?.pendingFeedbackCount ?? 0) > 0
                      ? `一键巡检并派发 (${summary?.pendingFeedbackCount})`
                      : '一键巡检并派发'}
                </span>
              </button>
            </div>
          </div>

          {/* 4-column flat KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">待巡检反馈</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-amber-700 tabular-nums">
                {summary?.pendingFeedbackCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">等待每日 Cron 或手动巡检</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">已采纳 / 已派发</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-emerald-700 tabular-nums">
                {summary?.acceptedFeedbackCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">通过防注入审查并合并直通 AGY</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">已拦截（恶意 / 无效）</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-red-700 tabular-nums">
                {summary?.blockedFeedbackCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">已隔离在 autodev-state，不建 Issue</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">转人工大型 PRD</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-violet-700 tabular-nums">
                {summary?.manualPrdFeedbackCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">超出细碎范围，保留供人工策划</div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-slate-100 border border-slate-200">
              {(
                [
                  ['all', '全部'],
                  ['pending', '待巡检'],
                  ['accepted', '已采纳'],
                  ['blocked', '已拦截/忽略'],
                  ['manual', '转大型PRD'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFbFilter(key)}
                  className={`px-2.5 py-1 text-[12px] font-medium rounded transition-colors whitespace-nowrap ${
                    fbFilter === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={fbSearch}
                onChange={(e) => setFbSearch(e.target.value)}
                placeholder="搜索反馈文案、路由或判定理由…"
                className="w-full sm:w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] text-slate-900"
              />
              <button
                type="button"
                onClick={() => void loadSignals({ silent: true, forcePull: true })}
                disabled={syncingLive}
                aria-label="同步并刷新线上反馈"
                title="从线上 atd-v1 拉取最新反馈"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${syncingLive ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Feedback Table */}
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            {filteredFeedback.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-2">
                <Inbox className="h-7 w-7 text-slate-400 mx-auto" />
                <div className="text-[14px] font-medium text-slate-800">
                  暂无匹配的用户反馈记录
                </div>
                <p className="text-[12px] text-slate-500 max-w-md mx-auto">
                  用户在 <code className="font-mono">dev社区</code> 提交「意见反馈」后，系统会通过推送与 D1 兜底拉取自动同步至此并持久化到 GitHub <code className="font-mono">autodev-state</code> 分支。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredFeedback.map((item: FeedbackRecord) => {
                  const meta = FEEDBACK_STATUS_META[item.status] || {
                    label: item.status,
                    colorClass: 'text-slate-600',
                  };
                  const expanded = expandedFbId === item.id;
                  const canQuickDispatch = item.status !== 'dispatched';
                  const isRowDispatching = dispatchingFbId === item.id;
                  return (
                    <div key={item.id} className="bg-white">
                      <div className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedFbId(expanded ? null : item.id)}
                          aria-expanded={expanded}
                          className="min-w-0 flex-1 text-left space-y-1"
                        >
                          <div className="flex items-center gap-2 text-[12px] flex-wrap">
                            {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            )}
                            <span className={`font-semibold ${meta.colorClass}`}>
                              {meta.label}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="font-mono text-slate-600">
                              {item.pageRoute || '/'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="font-mono text-slate-500 tabular-nums">
                              {formatTime(item.createdAt)}
                            </span>
                            {item.linkedIssueNumber && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-mono text-blue-700">
                                  Issue #{item.linkedIssueNumber}
                                </span>
                              </>
                            )}
                            {item.linkedPrNumber && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-mono text-emerald-700">
                                  PR #{item.linkedPrNumber}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="pl-5 text-[13px] text-slate-900 line-clamp-2">
                            {item.content}
                          </div>
                          {item.triageReason && (
                            <div className="pl-5 text-[12px] text-slate-500 truncate">
                              AI 分诊：{item.triageReason}
                            </div>
                          )}
                        </button>
                        <div className="shrink-0 flex items-center gap-2.5 self-center">
                          {item.decisionScores && (
                            <div className="hidden sm:block text-right font-mono text-[11px] text-slate-500 tabular-nums">
                              <div>优先级 {item.decisionScores.priorityScore.toFixed(1)}/3</div>
                              <div>注入 {(item.decisionScores.injectionProb * 100).toFixed(0)}%</div>
                            </div>
                          )}
                          {canQuickDispatch && (
                            <button
                              type="button"
                              onClick={() => void handleDirectDispatchFeedback(item.id)}
                              disabled={isRowDispatching}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {isRowDispatching ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              <span>{isRowDispatching ? '派发中…' : '直接派发'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {expanded && (
                        <div className="px-9 pb-4 pt-2 bg-slate-50 border-t border-slate-200 space-y-3 text-[12px]">
                          <div className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {item.content}
                          </div>
                          {item.decisionScores && (
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-[11px] tabular-nums text-slate-600 pt-1">
                              <div>注入概率：{(item.decisionScores.injectionProb * 100).toFixed(0)}%</div>
                              <div>恶意/灌水：{(item.decisionScores.maliciousProb * 100).toFixed(0)}%</div>
                              <div>可执行度：{(item.decisionScores.actionableProb * 100).toFixed(0)}%</div>
                              <div>范围分类：{item.decisionScores.scopeChoice}</div>
                              <div>优先级：{item.decisionScores.priorityScore.toFixed(2)} / 3</div>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex flex-wrap items-center gap-3 text-[12px]">
                              {item.linkedIssueUrl && (
                                <a
                                  href={item.linkedIssueUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                                >
                                  <span>查看 GitHub Issue #{item.linkedIssueNumber}</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              {item.linkedPrUrl && (
                                <a
                                  href={item.linkedPrUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-medium"
                                >
                                  <span>查看直通 Draft PR #{item.linkedPrNumber}</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {canQuickDispatch && (
                                <button
                                  type="button"
                                  onClick={() => void handleDirectDispatchFeedback(item.id)}
                                  disabled={isRowDispatching}
                                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {isRowDispatching ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Send className="h-3 w-3" />
                                  )}
                                  <span>直接派发 AGY 编码</span>
                                </button>
                              )}
                              {item.status !== 'pending' && item.status !== 'dispatched' && (
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateFeedbackStatus(item.id, 'pending')}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  重置为待巡检
                                </button>
                              )}
                              {item.status !== 'ignored' && item.status !== 'dispatched' && (
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateFeedbackStatus(item.id, 'ignored')}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100"
                                >
                                  忽略
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Daily Triage Batch History */}
          {(data?.feedbackBatches?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <h3 className="text-[14px] font-semibold text-slate-900">近期每日巡检批次记录</h3>
              <div className="rounded-md border border-slate-200 bg-white divide-y divide-slate-200">
                {data!.feedbackBatches.slice(0, 8).map((b) => (
                  <div
                    key={b.id}
                    className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px]"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 text-slate-500 font-mono tabular-nums">
                        <span>{formatTime(b.createdAt)}</span>
                        <span>·</span>
                        <span>{b.trigger === 'cron' ? 'GitHub Cron 定时' : '手动触发'}</span>
                        <span>·</span>
                        <span>扫描 {b.scannedCount} / 采纳 {b.acceptedCount} / 拦截 {b.rejectedMaliciousCount + b.rejectedInvalidCount}</span>
                      </div>
                      <div className="text-slate-800">{b.summary}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 font-mono">
                      {b.linkedIssueUrl && (
                        <a
                          href={b.linkedIssueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          <span>Issue #{b.linkedIssueNumber}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {b.linkedPrUrl && (
                        <a
                          href={b.linkedPrUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline inline-flex items-center gap-1"
                        >
                          <span>PR #{b.linkedPrNumber}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* TAB 2: PRODUCTION ERRORS & SINGLE-PR BURST AUTOFIX                */}
      {/* ================================================================= */}
      {mode === 'errors' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-[18px] font-semibold text-slate-900 tracking-tight">
                线上报错收集与单 PR 合并自愈
              </h2>
              <p className="mt-1 text-[13px] text-slate-600">
                自动从线上 <code className="font-mono text-slate-800">atd-v1</code> 捕获前后端未处理异常并按堆栈指纹去重 · 报错风暴进入 {config?.burstDebounceSec ?? 15}s 聚合窗口，同一波或已有未合入修复 PR 时<strong>强制合并为 1 个 Draft PR</strong>，绝不创建海量 PR
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleFlushErrors()}
                disabled={flushingErrors}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {flushingErrors ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wrench className="h-3.5 w-3.5" />
                )}
                <span>{flushingErrors ? '合并派发中…' : '立即合并派发修复 PR'}</span>
              </button>
            </div>
          </div>

          {/* Active Single Autofix PR Guard Banner */}
          {summary?.activeAutofixPrNumber && summary.activeAutofixPrUrl && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[13px] text-blue-900">
              <div className="flex items-center gap-2">
                <GitPullRequest className="h-4 w-4 shrink-0 text-blue-700" />
                <span>
                  当前存在活跃的线上自愈合并 PR <strong className="font-mono">#{summary.activeAutofixPrNumber}</strong>：在其合入前，后续新涌入的线上报错都将自动合并到该 PR 中修复，不会新建第二个 PR。
                </span>
              </div>
              <a
                href={summary.activeAutofixPrUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
              >
                <span>查看合并 PR</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* 4-column flat KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">活跃报错指纹</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-red-700 tabular-nums">
                {summary?.activeErrorGroupsCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">去重后的独立异常类</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">排队等待合并</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-amber-700 tabular-nums">
                {summary?.queuedErrorGroupsCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">空闲后自动合并为 1 个 PR</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">AGY 修复中 / 待验收</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-blue-700 tabular-nums">
                {summary?.fixingErrorGroupsCount ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">最终在 ST-04 人工签批上线</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-[12px] text-slate-500">累计捕获次数</div>
              <div className="mt-1 font-mono text-[24px] font-semibold text-slate-900 tabular-nums">
                {summary?.totalErrorOccurrences ?? 0}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">已通过指纹去重折叠</div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-slate-100 border border-slate-200">
              {(
                [
                  ['all', '全部'],
                  ['active', '待处理 / 排队'],
                  ['fixing', '修复中 / 待验收'],
                  ['filtered', '已过滤 / 忽略'],
                  ['resolved', '已解决'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setErrFilter(key)}
                  className={`px-2.5 py-1 text-[12px] font-medium rounded transition-colors whitespace-nowrap ${
                    errFilter === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={errSearch}
                onChange={(e) => setErrSearch(e.target.value)}
                placeholder="搜索错误名、堆栈帧、路由或指纹…"
                className="w-full sm:w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] text-slate-900"
              />
              <button
                type="button"
                onClick={() => void loadSignals({ silent: true, forcePull: true })}
                disabled={syncingLive}
                aria-label="同步并刷新线上报错"
                title="从线上 atd-v1 拉取最新报错"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${syncingLive ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Errors Fingerprint Table */}
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            {filteredErrors.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-2">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 mx-auto" />
                <div className="text-[14px] font-medium text-slate-800">
                  暂无匹配的线上报错指纹
                </div>
                <p className="text-[12px] text-slate-500 max-w-md mx-auto">
                  线上 <code className="font-mono">atd-v1</code> 已自动开启前端全局错误边界与后端 Worker 5xx 捕获；一旦出现真实异常将自动去重、合批并开启单 PR 自愈修复。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredErrors.map((g: ProdErrorGroup) => {
                  const meta = ERROR_STATUS_META[g.status] || {
                    label: g.status,
                    colorClass: 'text-slate-600',
                  };
                  const expanded = expandedErrId === g.id;
                  const canQuickFix = g.status !== 'fixing' && g.status !== 'resolved';
                  const isRowFixing = flushingErrId === g.id;
                  return (
                    <div key={g.id} className="bg-white">
                      <div className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedErrId(expanded ? null : g.id)}
                          aria-expanded={expanded}
                          className="min-w-0 flex-1 text-left space-y-1"
                        >
                          <div className="flex items-center gap-2 text-[12px] flex-wrap">
                            {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            )}
                            <span className={`font-semibold ${meta.colorClass}`}>
                              {meta.label}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="text-slate-600">
                              {g.source === 'backend' ? '后端 Worker' : '前端页面'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="font-mono text-slate-700">{g.route}</span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="font-mono text-slate-500">#{g.fingerprint.slice(0, 8)}</span>
                            {g.linkedPrNumber && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-mono text-emerald-700 font-medium">
                                  PR #{g.linkedPrNumber}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="pl-5 text-[13px] font-medium text-slate-900 font-mono truncate">
                            {g.errorName}: {g.normalizedMessage}
                          </div>
                          {g.triageReason && (
                            <div className="pl-5 text-[12px] text-slate-500 truncate">
                              {g.triageReason}
                            </div>
                          )}
                        </button>
                        <div className="shrink-0 flex items-center gap-2.5 self-center">
                          <div className="text-right font-mono tabular-nums">
                            <div className="text-[13px] font-semibold text-slate-900">
                              ×{g.occurrenceCount}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatTime(g.lastSeenAt)}
                            </div>
                          </div>
                          {canQuickFix && (
                            <button
                              type="button"
                              onClick={() => void handleFlushErrors([g.id])}
                              disabled={isRowFixing}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {isRowFixing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Wrench className="h-3 w-3" />
                              )}
                              <span>{isRowFixing ? '派发中…' : '立即修复'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {expanded && (
                        <div className="px-9 pb-4 pt-2 bg-slate-50 border-t border-slate-200 space-y-3 text-[12px]">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-600 tabular-nums">
                            <span>指纹：{g.fingerprint}</span>
                            <span>顶层帧：{g.topFrame}</span>
                            <span>首次：{formatTime(g.firstSeenAt)}</span>
                            <span>最近：{formatTime(g.lastSeenAt)}</span>
                            {g.httpStatus && <span>HTTP {g.httpStatus}</span>}
                          </div>

                          {g.sanitizedStackSample && (
                            <pre className="rounded-md bg-slate-900 text-slate-100 p-3 text-[11px] font-mono overflow-x-auto max-h-48 leading-relaxed">
                              {g.sanitizedStackSample}
                            </pre>
                          )}

                          {g.decisionScores && (
                            <div className="flex flex-wrap gap-4 font-mono text-[11px] text-slate-600 tabular-nums">
                              <span>代码缺陷概率：{(g.decisionScores.realBugProb * 100).toFixed(0)}%</span>
                              <span>注入风险：{(g.decisionScores.injectionProb * 100).toFixed(0)}%</span>
                              <span>严重度：{g.decisionScores.severityScore.toFixed(2)} / 3</span>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex flex-wrap items-center gap-3">
                              {g.linkedIssueUrl && (
                                <a
                                  href={g.linkedIssueUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                                >
                                  <span>追踪 Issue #{g.linkedIssueNumber}</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              {g.linkedPrUrl && (
                                <a
                                  href={g.linkedPrUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-medium"
                                >
                                  <span>合并自愈 PR #{g.linkedPrNumber}</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {g.status !== 'fixing' && g.status !== 'resolved' && (
                                <button
                                  type="button"
                                  onClick={() => void handleFlushErrors([g.id])}
                                  className="rounded border border-blue-300 bg-white px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50"
                                >
                                  合并进自愈 PR 修复
                                </button>
                              )}
                              {g.status !== 'resolved' && (
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateErrorStatus(g.id, 'resolved')}
                                  className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50"
                                >
                                  标记已解决
                                </button>
                              )}
                              {g.status !== 'ignored' && (
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateErrorStatus(g.id, 'ignored')}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100"
                                >
                                  忽略此指纹
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Autofix Batch Audit History */}
          {(data?.errorBatches?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <h3 className="text-[14px] font-semibold text-slate-900">近期报错合批自愈记录</h3>
              <div className="rounded-md border border-slate-200 bg-white divide-y divide-slate-200">
                {data!.errorBatches.slice(0, 8).map((b) => (
                  <div
                    key={b.id}
                    className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px]"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 font-mono text-slate-500 tabular-nums">
                        <span>{formatTime(b.createdAt)}</span>
                        <span>·</span>
                        <span>
                          {b.status === 'merged_into_active_pr'
                            ? '合并进活跃 PR'
                            : b.status === 'queued_for_agy'
                              ? '队列等待'
                              : '新建合并 PR'}
                        </span>
                        <span>·</span>
                        <span>包含 {b.errorGroupIds.length} 类指纹</span>
                      </div>
                      <div className="text-slate-800">{b.summary}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 font-mono">
                      {b.linkedIssueUrl && (
                        <a
                          href={b.linkedIssueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          <span>Issue #{b.linkedIssueNumber}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {b.linkedPrUrl && (
                        <a
                          href={b.linkedPrUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline inline-flex items-center gap-1"
                        >
                          <span>PR #{b.linkedPrNumber}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
