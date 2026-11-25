import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cloud,
  ExternalLink,
  FileText,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  History,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AUDIT_CATEGORY_LABELS,
  REQUIREMENT_STATUS_META,
  type AuditLogCategory,
  type DailyRequirementActivityPoint,
  type RequirementBoardItem,
  type RequirementBoardStatus,
  type RequirementsBoardPayload,
  type RequirementStatusBucket,
} from '../lib/requirementsBoard';
import type { BackgroundTask } from '../types/autodev';
import { formatTokenCount } from '../lib/overviewMetrics';
import { apiFetch } from '../lib/editAuthClient';
import { RequirementReportModal } from './RequirementReportModal';

interface RequirementsBoardViewProps {
  repoFullName: string;
  isRequirementInProgress?: boolean;
  refreshNonce?: number;
  onGoToNewPrd: () => void;
  onGoToPipeline: (runId: string) => void;
  onGoToApproval: (runId: string) => void;
  onBackgroundTaskStarted?: (task: BackgroundTask) => void;
  onRecordDeleted?: () => void;
  onSuccessToast?: (message: string, title?: string) => void;
  onErrorToast: (message: string, title?: string) => void;
}

type BoardTab = 'requirements' | 'audit';
type StatusFilter = 'all' | 'active' | 'rework' | 'delivered' | 'failed';
type AuditCategoryFilter = 'all' | AuditLogCategory;

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function StatusFunnelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RequirementStatusBucket }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2 text-[12px] shadow-lg">
      <div className="font-semibold text-[#F0F6FC]">{row.label}</div>
      <div className="mt-1 font-mono tabular-nums text-[11px] text-[#58A6FF]">
        {row.count} 个需求
      </div>
    </div>
  );
}

function DailyActivityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyRequirementActivityPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2.5 text-[12px] shadow-lg">
      <div className="font-mono font-semibold text-[#F0F6FC] mb-1.5">{row.dateKey}</div>
      <div className="space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">新增需求</span>
          <span className="text-[#F0F6FC] font-semibold">{row.newRequirements} 个</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">规划与 PR</span>
          <span className="text-[#58A6FF]">{row.planning} 次</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">执行与部署</span>
          <span className="text-[#A371F7]">{row.execution} 次</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">验收与审批</span>
          <span className="text-[#3FB950]">{row.approval} 次</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">质量与 RSI</span>
          <span className="text-[#D29922]">{row.quality} 次</span>
        </div>
      </div>
    </div>
  );
}

function matchesStatusFilter(status: RequirementBoardStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') {
    return status === 'analyzing' || status === 'analyzed' || status === 'pr_created';
  }
  if (filter === 'rework') return status === 'changes_requested';
  if (filter === 'delivered') return status === 'approved' || status === 'merged';
  if (filter === 'failed') return status === 'analysis_failed';
  return true;
}

export function RequirementsBoardView({
  repoFullName,
  isRequirementInProgress = false,
  refreshNonce = 0,
  onGoToNewPrd,
  onGoToPipeline,
  onGoToApproval,
  onBackgroundTaskStarted,
  onRecordDeleted,
  onSuccessToast,
  onErrorToast,
}: RequirementsBoardViewProps) {
  const [board, setBoard] = useState<RequirementsBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<BoardTab>('requirements');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [reqQuery, setReqQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [redeployingProdId, setRedeployingProdId] = useState<string | null>(null);

  const [auditCategory, setAuditCategory] = useState<AuditCategoryFilter>('all');
  const [auditQuery, setAuditQuery] = useState('');

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/requirements/board');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setBoard(json as RequirementsBoardPayload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载需求看板数据失败';
      setError(msg);
      onErrorToast(msg, '需求看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [onErrorToast]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard, refreshNonce]);

  const handleDeleteRequirement = useCallback(
    async (item: RequirementBoardItem) => {
      setDeletingId(item.id);
      try {
        const endpoint = item.runId
          ? `/api/runs/${encodeURIComponent(item.runId)}`
          : item.jobId
            ? `/api/agents/jobs/${encodeURIComponent(item.jobId)}`
            : null;
        if (!endpoint) {
          throw new Error('该记录缺少可删除的标识 ID');
        }
        const res = await apiFetch(endpoint, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setConfirmDeleteId(null);
        onSuccessToast?.(`已删除「${item.title}」并同步状态分支`, '记录已删除');
        await fetchBoard();
        onRecordDeleted?.();
      } catch (err) {
        onErrorToast(
          err instanceof Error ? err.message : '删除需求记录失败',
          '删除失败'
        );
      } finally {
        setDeletingId(null);
      }
    },
    [fetchBoard, onRecordDeleted, onSuccessToast, onErrorToast]
  );

  const handleRedeployProduction = useCallback(
    async (item: RequirementBoardItem) => {
      setRedeployingProdId(item.id);
      try {
        const res = await apiFetch('/api/cloudflare/deploy-production', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            async: true,
            runId: item.runId,
            repoFullName: item.repoFullName,
            branchName: item.mergedBaseBranch || item.defaultBranch || 'main',
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 202 && json.task) {
          onBackgroundTaskStarted?.(json.task as BackgroundTask);
          onSuccessToast?.(
            `已启动「${item.title}」的 Cloudflare 生产环境重新部署`,
            '后台生产部署已启动'
          );
          return;
        }
        if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        onSuccessToast?.(
          json.deployment?.url
            ? `生产环境已重新上线：${json.deployment.url}`
            : '生产环境已重新部署上线',
          '生产部署完成'
        );
        await fetchBoard();
      } catch (err) {
        onErrorToast(
          err instanceof Error ? err.message : '重新部署生产环境失败',
          '生产部署失败'
        );
      } finally {
        setRedeployingProdId(null);
      }
    },
    [fetchBoard, onBackgroundTaskStarted, onErrorToast, onSuccessToast]
  );

  const filteredRequirements = useMemo(() => {
    const list = board?.requirements ?? [];
    const q = reqQuery.trim().toLowerCase();
    return list.filter((item) => {
      if (!matchesStatusFilter(item.status, statusFilter)) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.branchName || '').toLowerCase().includes(q) ||
        (item.prNumber ? `#${item.prNumber}`.includes(q) : false) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [board?.requirements, statusFilter, reqQuery]);

  const filteredAuditLogs = useMemo(() => {
    const list = board?.auditLogs ?? [];
    const q = auditQuery.trim().toLowerCase();
    return list.filter((entry) => {
      if (auditCategory !== 'all' && entry.category !== auditCategory) return false;
      if (!q) return true;
      return (
        entry.label.toLowerCase().includes(q) ||
        entry.detail.toLowerCase().includes(q) ||
        (entry.prdTitle || '').toLowerCase().includes(q) ||
        (entry.branch || '').toLowerCase().includes(q) ||
        entry.actor.toLowerCase().includes(q)
      );
    });
  }, [board?.auditLogs, auditCategory, auditQuery]);

  const summary = board?.summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC] text-balance">
            需求看板与操作审计
          </h1>
          <p className="mt-1 text-[13px] text-[#8B949E]">
            仓库 <code className="font-mono text-[#C9D1D9]">{repoFullName}</code> · 全量历史需求追踪、生命周期数据面板与人工操作日志
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={fetchBoard}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-1.5 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新看板</span>
          </button>
          {!isRequirementInProgress && (
            <button
              type="button"
              onClick={onGoToNewPrd}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] border border-[#3FB950]/30 px-3.5 py-1.5 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建需求</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-4 py-3 text-[13px] text-[#FFDCD7] flex items-start gap-2.5"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#F85149]" />
          <span>{error}</span>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <section aria-label="需求看板核心指标" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">历史需求总数</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-16 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#F0F6FC] tabular-nums">
                {summary?.totalRequirements ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">个需求</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary
              ? `近 7 日新增 ${summary.last7dRequirements} · 进行中 ${summary.inProgressCount}`
              : '正在加载…'}
          </div>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">已批准 / 上线交付</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-16 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#3FB950] tabular-nums">
                {summary?.deliveredCount ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">
                {summary?.deliveryRatePct !== null && summary?.deliveryRatePct !== undefined
                  ? `(${summary.deliveryRatePct}%)`
                  : '个'}
              </span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary
              ? `已合入 main ${summary.mergedCount} · 待验收 ${summary.pendingApprovalCount}`
              : '正在加载…'}
          </div>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">退回修订与一次通过率</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#58A6FF] tabular-nums">
                {summary?.firstPassAcceptanceRatePct !== null &&
                summary?.firstPassAcceptanceRatePct !== undefined
                  ? `${summary.firstPassAcceptanceRatePct}%`
                  : '—'}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">一次通过</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary
              ? `曾退回修订 ${summary.reworkRequestedCount} 个 · 规划中断 ${summary.failedAnalysisCount}`
              : '正在加载…'}
          </div>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">人工操作审计记录</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-16 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#F0F6FC] tabular-nums">
                {summary?.totalManualActions ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">条日志</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary?.lastActionAt ? `最近操作 ${formatDateTime(summary.lastActionAt)}` : '暂无记录'}
          </div>
        </div>
      </section>

      {/* 2-Column Recharts Data Panel */}
      <section
        aria-label="需求状态与操作活跃度数据面板"
        className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch"
      >
        {/* Left Chart: Requirement Status Distribution */}
        <div className="xl:col-span-5 rounded-md border border-[#30363D] bg-[#161B22] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                需求生命周期状态分布
              </h2>
              <p className="mt-0.5 text-[11px] text-[#8B949E]">
                按当前阶段统计全部历史与进行中需求
              </p>
            </div>
            <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
              共 {summary?.totalRequirements ?? 0} 项
            </span>
          </div>

          <div className="h-[230px] w-full">
            {loading && !board ? (
              <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={board?.statusDistribution ?? []}
                  layout="vertical"
                  margin={{ top: 6, right: 20, left: 6, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262D" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={{ stroke: '#30363D' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={84}
                    tick={{ fill: '#C9D1D9', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<StatusFunnelTooltip />}
                    cursor={{ fill: 'rgba(88, 166, 255, 0.06)' }}
                  />
                  <Bar
                    dataKey="count"
                    barSize={16}
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  >
                    {(board?.statusDistribution ?? []).map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right Chart: 7-Day Manual Operation & Requirement Activity */}
        <div className="xl:col-span-7 rounded-md border border-[#30363D] bg-[#161B22] p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                近 7 日人工操作与需求推进趋势
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#8B949E]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#58A6FF]" aria-hidden="true" />
                  规划与 PR
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#A371F7]" aria-hidden="true" />
                  执行与部署
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#3FB950]" aria-hidden="true" />
                  验收与审批
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#D29922]" aria-hidden="true" />
                  质量与 RSI
                </span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
              近 7 天审计分布
            </span>
          </div>

          <div className="h-[230px] w-full">
            {loading && !board ? (
              <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={board?.dailyActivity ?? []}
                  margin={{ top: 8, right: 16, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262D" vertical={false} />
                  <XAxis
                    dataKey="label"
                    padding={{ left: 12, right: 12 }}
                    tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={{ stroke: '#30363D' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<DailyActivityTooltip />}
                    cursor={{ fill: 'rgba(88, 166, 255, 0.06)' }}
                  />
                  <Bar
                    dataKey="planning"
                    name="规划与 PR"
                    stackId="ops"
                    fill="#58A6FF"
                    barSize={22}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="execution"
                    name="执行与部署"
                    stackId="ops"
                    fill="#A371F7"
                    barSize={22}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="approval"
                    name="验收与审批"
                    stackId="ops"
                    fill="#3FB950"
                    barSize={22}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="quality"
                    name="质量与 RSI"
                    stackId="ops"
                    fill="#D29922"
                    radius={[3, 3, 0, 0]}
                    barSize={22}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* Main 2-Tab Workbench: Historical Requirements + Manual Audit Logs */}
      <section className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
        <div className="px-5 py-3 border-b border-[#30363D] flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="需求看板视图切换"
            className="inline-flex items-center gap-1 rounded-md bg-[#0D1117] p-1 border border-[#30363D]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'requirements'}
              onClick={() => setActiveTab('requirements')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap tabular-nums ${
                activeTab === 'requirements'
                  ? 'bg-[#21262D] text-[#F0F6FC]'
                  : 'text-[#8B949E] hover:text-[#C9D1D9]'
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span>历史需求列表 ({board?.requirements.length ?? 0})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'audit'}
              onClick={() => setActiveTab('audit')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap tabular-nums ${
                activeTab === 'audit'
                  ? 'bg-[#21262D] text-[#F0F6FC]'
                  : 'text-[#8B949E] hover:text-[#C9D1D9]'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>人工操作日志 ({board?.auditLogs.length ?? 0})</span>
            </button>
          </div>

          {activeTab === 'requirements' ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-[#8B949E] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  data-readonly-safe="true"
                  value={reqQuery}
                  onChange={(e) => setReqQuery(e.target.value)}
                  aria-label="搜索历史需求"
                  placeholder="搜索标题、分支或 PR#…"
                  className="rounded-md border border-[#30363D] bg-[#0D1117] pl-8 pr-3 py-1 text-[12px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none w-[200px]"
                />
              </div>

              <div
                role="group"
                aria-label="需求状态筛选"
                className="inline-flex items-center gap-1 rounded-md border border-[#30363D] bg-[#0D1117] p-0.5"
              >
                {(
                  [
                    { id: 'all', label: '全部' },
                    { id: 'active', label: '进行中' },
                    { id: 'rework', label: '退回修订' },
                    { id: 'delivered', label: '已上线' },
                    { id: 'failed', label: '异常' },
                  ] as const
                ).map((item) => {
                  const active = statusFilter === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatusFilter(item.id)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#21262D] text-[#F0F6FC]'
                          : 'text-[#8B949E] hover:text-[#C9D1D9]'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-[#8B949E] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  data-readonly-safe="true"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  aria-label="搜索操作日志"
                  placeholder="搜索动作、分支或内容…"
                  className="rounded-md border border-[#30363D] bg-[#0D1117] pl-8 pr-3 py-1 text-[12px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none w-[200px]"
                />
              </div>

              <div
                role="group"
                aria-label="操作日志分类筛选"
                className="inline-flex items-center gap-1 rounded-md border border-[#30363D] bg-[#0D1117] p-0.5"
              >
                {(
                  [
                    { id: 'all', label: '全部' },
                    { id: 'planning', label: '规划与 PR' },
                    { id: 'execution', label: '执行与部署' },
                    { id: 'approval', label: '验收与审批' },
                    { id: 'quality', label: '质量与 RSI' },
                  ] as const
                ).map((item) => {
                  const active = auditCategory === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAuditCategory(item.id)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#21262D] text-[#F0F6FC]'
                          : 'text-[#8B949E] hover:text-[#C9D1D9]'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* TAB 1: Historical Requirements Table */}
        {activeTab === 'requirements' && (
          <div className="bg-[#0D1117]">
            {filteredRequirements.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-3">
                <div className="text-[14px] font-medium text-[#F0F6FC]">
                  当前筛选条件下暂无需求记录
                </div>
                <p className="text-[12px] text-[#8B949E]">
                  {isRequirementInProgress
                    ? '当前有新需求正在进行中，可切换筛选条件查看进度。'
                    : '您可以切换筛选状态，或点击右上角「新建需求」发起新一轮自动化研发迭代。'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[940px]">
                  <div className="grid grid-cols-[2rem_minmax(220px,2.1fr)_104px_162px_126px_112px_182px] items-center border-b border-[#30363D] bg-[#161B22] text-[11px] font-semibold text-[#8B949E]">
                    <div className="py-2.5 pl-5 pr-2" aria-label="展开" />
                    <div className="py-2.5 px-3">需求标题 / 原特性分支</div>
                    <div className="py-2.5 px-3">当前状态</div>
                    <div className="py-2.5 px-3">任务与验收进度</div>
                    <div className="py-2.5 px-3">PR / 预览</div>
                    <div className="py-2.5 px-3">最近更新</div>
                    <div className="py-2.5 pl-3 pr-5 text-right">快捷操作</div>
                  </div>
                  <div className="divide-y divide-[#21262D] text-[12px]">
                    {filteredRequirements.map((item: RequirementBoardItem) => {
                      const expanded = expandedId === item.id;
                      const meta = REQUIREMENT_STATUS_META[item.status];
                      return (
                        <div key={item.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setExpandedId(expanded ? null : item.id);
                              }
                            }}
                            className="grid grid-cols-[2rem_minmax(220px,2.1fr)_104px_162px_126px_112px_182px] items-center hover:bg-[#161B22]/80 cursor-pointer transition-colors"
                          >
                            <div className="py-3 pl-5 pr-2 text-[#8B949E]">
                              {expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </div>

                              <div className="py-3 px-3 min-w-0">
                                <div className="font-medium text-[#F0F6FC] truncate">
                                  {item.title}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-[#8B949E] truncate">
                                  <GitBranch className="h-3 w-3 shrink-0 text-[#58A6FF]" />
                                  <span className="truncate">
                                    {item.branchName || item.defaultBranch}
                                  </span>
                                  {item.reworkCount > 0 && (
                                    <span className="text-[#D29922] shrink-0">
                                      · 返工 {item.reworkCount} 次
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className={`py-3 px-3 font-medium whitespace-nowrap ${meta.colorClass}`}>
                                {meta.label}
                              </div>

                              <div className="py-3 px-3 font-mono tabular-nums text-[11px]">
                                {item.totalCriteriaCount > 0 ? (
                                  <div className="space-y-1">
                                    <div className="text-[#C9D1D9]">
                                      任务 {item.tasksCount} · 验收 {item.checkedCriteriaCount}/
                                      {item.totalCriteriaCount}
                                    </div>
                                    <div className="h-1.5 w-28 rounded-full bg-[#21262D] overflow-hidden">
                                      <div
                                        className="h-full bg-[#3FB950]"
                                        style={{ width: `${item.acceptanceProgressPct ?? 0}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[#8B949E]">
                                    {item.status === 'analysis_failed' ? '规划中断' : '生成中…'}
                                  </span>
                                )}
                              </div>

                              <div
                                className="py-3 px-3 font-mono text-[11px] flex items-center gap-2.5 whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {item.prUrl && item.prNumber ? (
                                  <a
                                    href={item.prUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[#58A6FF] hover:underline"
                                  >
                                    <GitPullRequest className="h-3 w-3" />
                                    <span>#{item.prNumber}</span>
                                  </a>
                                ) : (
                                  <span className="text-[#6E7681]">—</span>
                                )}
                                {item.productionUrl ? (
                                  <a
                                    href={item.productionUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[#3FB950] hover:underline"
                                  >
                                    <Globe className="h-3 w-3" />
                                    <span>线上</span>
                                  </a>
                                ) : item.previewUrl ? (
                                  <a
                                    href={item.previewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[#3FB950] hover:underline"
                                  >
                                    <Globe className="h-3 w-3" />
                                    <span>预览</span>
                                  </a>
                                ) : null}
                              </div>

                              <div className="py-3 px-3 font-mono tabular-nums text-[11px] text-[#8B949E] whitespace-nowrap">
                                {formatDateTime(item.updatedAt)}
                              </div>

                              <div
                                className="py-3 pl-3 pr-5 flex items-center justify-end gap-2 whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {confirmDeleteId === item.id ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRequirement(item)}
                                      disabled={deletingId === item.id}
                                      className="text-[11px] font-medium text-[#FF7B72] hover:text-[#F85149] disabled:opacity-50"
                                    >
                                      {deletingId === item.id ? '删除中…' : '确认删除'}
                                    </button>
                                    <span aria-hidden="true" className="text-[#30363D]">|</span>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      disabled={deletingId === item.id}
                                      className="text-[11px] text-[#8B949E] hover:text-[#C9D1D9]"
                                    >
                                      取消
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setReportTargetId(item.runId || item.jobId || item.id)}
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#3FB950] hover:underline"
                                    >
                                      <FileText className="h-3 w-3" />
                                      <span>报告</span>
                                    </button>
                                    {item.runId ? (
                                      <>
                                        <span aria-hidden="true" className="text-[#30363D]">|</span>
                                        <button
                                          type="button"
                                          onClick={() => onGoToPipeline(item.runId!)}
                                          className="text-[11px] font-medium text-[#C9D1D9] hover:text-[#58A6FF]"
                                        >
                                          流水线
                                        </button>
                                        <span aria-hidden="true" className="text-[#30363D]">|</span>
                                        <button
                                          type="button"
                                          onClick={() => onGoToApproval(item.runId!)}
                                          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#58A6FF] hover:underline"
                                        >
                                          <span>验收</span>
                                          <ArrowUpRight className="h-3 w-3" />
                                        </button>
                                      </>
                                    ) : null}
                                    {(item.runId || item.jobId) && (
                                      <>
                                        <span aria-hidden="true" className="text-[#30363D]">|</span>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteId(item.id)}
                                          title="删除该需求记录"
                                          className="inline-flex items-center text-[#8B949E] hover:text-[#FF7B72] transition-colors"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {expanded && (
                              <div className="px-5 py-4 bg-[#010409] border-t border-[#21262D] space-y-4">
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                                  {/* Left: Requirement Metadata & Branch / Rework Trace */}
                                  <div className="lg:col-span-6 space-y-2.5">
                                    <div className="text-[12px] font-semibold text-[#F0F6FC]">
                                      需求摘要与分支追踪
                                    </div>
                                    <p className="text-[12px] text-[#8B949E] leading-relaxed">
                                      {item.prdPreview}
                                      {item.prdPreview.length >= 180 ? '…' : ''}
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-[#0D1117] border border-[#30363D] rounded-md p-3">
                                      <div>
                                        <span className="text-[#8B949E]">运行 ID：</span>
                                        <span className="text-[#C9D1D9]">{item.id}</span>
                                      </div>
                                      <div>
                                        <span className="text-[#8B949E]">规划引擎：</span>
                                        <span className="text-[#C9D1D9]">
                                          {item.executionMode === 'gemini_api'
                                            ? 'Gemini API'
                                            : 'Instabox VPS AGY'}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[#8B949E]">需求分支：</span>
                                        <span className="text-[#58A6FF]">
                                          {item.branchName || '尚未建分支'}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[#8B949E]">测试结果：</span>
                                        <span className="text-[#C9D1D9]">
                                          {item.latestTestPassRate !== null
                                            ? `${item.latestTestPassRate}% (${item.latestTestPassed}/${item.latestTestPassed + item.latestTestFailed})`
                                            : '待同步'}
                                        </span>
                                      </div>
                                    </div>

                                    {item.lastReworkBranch && (
                                      <div className="rounded-md border border-[#D29922]/40 bg-[#D29922]/10 px-3 py-2 text-[12px] text-[#F2CC60] flex items-start gap-2">
                                        <RotateCcw className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                        <div className="space-y-0.5">
                                          <div>
                                            退回修订在原需求分支{' '}
                                            <code className="font-mono">{item.lastReworkBranch}</code>{' '}
                                            增量返工（未新建分支）
                                          </div>
                                          {item.lastReworkNote && (
                                            <div className="text-[11px] text-[#F2CC60]/90">
                                              修改意见：{item.lastReworkNote}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {(item.mergedCommitSha || item.status === 'approved' || item.status === 'merged') && (
                                      <div className="rounded-md border border-[#3FB950]/40 bg-[#2EA043]/10 px-3 py-2 text-[12px] text-[#AFF5B4] flex flex-wrap items-center justify-between gap-2">
                                        <span className="inline-flex items-center gap-1.5 font-mono">
                                          <GitMerge className="h-3.5 w-3.5 text-[#3FB950]" />
                                          {item.mergedCommitSha
                                            ? `已合入 ${item.mergedBaseBranch || 'main'} (${item.mergedCommitSha.slice(0, 7)})`
                                            : '已批准上线'}
                                        </span>
                                        <div className="flex items-center gap-2.5">
                                          {item.productionUrl && (
                                            <a
                                              href={item.productionUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center gap-1 underline text-[11px]"
                                            >
                                              <Globe className="h-3 w-3" />
                                              <span>生产站</span>
                                            </a>
                                          )}
                                          {item.mergedCommitUrl && (
                                            <a
                                              href={item.mergedCommitUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center gap-1 underline text-[11px]"
                                            >
                                              <span>Commit</span>
                                              <ExternalLink className="h-3 w-3" />
                                            </a>
                                          )}
                                          <button
                                            type="button"
                                            data-testid="btn-board-redeploy-production"
                                            disabled={redeployingProdId === item.id}
                                            onClick={() => handleRedeployProduction(item)}
                                            className="inline-flex items-center gap-1 rounded border border-[#3FB950]/40 bg-[#0D1117]/70 px-2 py-0.5 text-[11px] font-medium text-[#AFF5B4] hover:bg-[#2EA043]/30 disabled:opacity-50 transition-colors cursor-pointer"
                                          >
                                            {redeployingProdId === item.id ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <Cloud className="h-3 w-3" />
                                            )}
                                            <span>
                                              {redeployingProdId === item.id
                                                ? '部署中…'
                                                : item.productionUrl
                                                  ? '重部署生产'
                                                  : '重新部署生产'}
                                            </span>
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {item.analysisError && (
                                      <div className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-3 py-2 text-[12px] text-[#FFDCD7]">
                                        规划异常：{item.analysisError}
                                      </div>
                                    )}

                                    {/* Coding Agent Chat Window Final Reply Preview & Full Report Launcher */}
                                    <div className="rounded-lg border border-[#2A3548] bg-[#111723] p-3.5 space-y-2.5">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#F8FAFC]">
                                          <MessageSquare className="h-3.5 w-3.5 text-[#34D399]" />
                                          <span>Gemini 编码圣殿 · Coding Agent 聊天窗口最终回复</span>
                                          {item.latestCodingCommitSha && (
                                            <span className="font-mono font-normal text-[11px] text-[#38BDF8]">
                                              · {item.latestCodingCommitSha.slice(0, 7)}
                                            </span>
                                          )}
                                          {item.totalTokens ? (
                                            <span className="font-mono font-normal text-[11px] text-[#A78BFA]">
                                              · {formatTokenCount(item.totalTokens)} Tokens
                                            </span>
                                          ) : null}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setReportTargetId(item.runId || item.jobId || item.id)
                                          }
                                          className="inline-flex items-center gap-1 rounded-md border border-[#2D384D] bg-[#1B2230] px-2.5 py-1 text-[11px] font-medium text-[#38BDF8] hover:bg-[#253044] hover:text-[#F8FAFC] transition-colors whitespace-nowrap"
                                        >
                                          <FileText className="h-3 w-3" />
                                          <span>查看完整需求报告</span>
                                        </button>
                                      </div>
                                      {item.latestCodingOutputPreview ? (
                                        <div className="rounded-lg border border-[#242F42] bg-[#0B0F18] px-3 py-2.5">
                                          <p className="text-[12px] text-[#DCE5F2] leading-relaxed whitespace-pre-wrap line-clamp-4">
                                            {item.latestCodingOutputPreview}
                                            {item.latestCodingOutputPreview.length >= 260 ? '…' : ''}
                                          </p>
                                        </div>
                                      ) : (
                                        <p className="text-[11px] text-[#94A3B8]">
                                          {item.branchName
                                            ? '尚未捕获到 Coding Agent 聊天窗口最终回复（点击「查看完整需求报告」可查阅 PRD 规划、盲测记录或回溯最新交付消息）。'
                                            : '尚未进入编码阶段，点击「查看完整需求报告」可查阅完整 PRD 与规划方案。'}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right: Requirement-specific Manual Operation Timeline */}
                                  <div className="lg:col-span-6 space-y-2.5">
                                    <div className="text-[12px] font-semibold text-[#F0F6FC]">
                                      关联人工操作时间线 ({item.auditEvents.length})
                                    </div>
                                    {item.auditEvents.length === 0 ? (
                                      <div className="rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-4 text-[12px] text-[#8B949E]">
                                        暂无关联的人工操作记录。
                                      </div>
                                    ) : (
                                      <div className="rounded-md border border-[#30363D] divide-y divide-[#21262D] bg-[#0D1117] max-h-[220px] overflow-y-auto">
                                        {item.auditEvents.map((ev) => (
                                          <div
                                            key={ev.id}
                                            className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-[11px]"
                                          >
                                            <div className="space-y-0.5 min-w-0">
                                              <div className="flex items-center gap-1.5">
                                                {ev.status === 'success' ? (
                                                  <CheckCircle2 className="h-3 w-3 text-[#3FB950] shrink-0" />
                                                ) : (
                                                  <XCircle className="h-3 w-3 text-[#F85149] shrink-0" />
                                                )}
                                                <span className="font-medium text-[#F0F6FC]">
                                                  {ev.label}
                                                </span>
                                                <span className="text-[#8B949E]">
                                                  · {ev.actor}
                                                </span>
                                              </div>
                                              <div className="text-[#C9D1D9] break-all">
                                                {ev.detail}
                                              </div>
                                            </div>
                                            <span className="font-mono tabular-nums text-[#8B949E] shrink-0">
                                              {formatDateTime(ev.timestamp)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
            )}
          </div>
        )}

        {/* TAB 2: Global Manual Operation Audit Logs */}
        {activeTab === 'audit' && (
          <div className="bg-[#0D1117]">
            {filteredAuditLogs.length === 0 ? (
              <div className="px-6 py-12 text-center text-[12px] text-[#8B949E]">
                当前筛选条件下暂无人工操作日志。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#30363D] bg-[#161B22] text-[11px] font-semibold text-[#8B949E]">
                      <th className="py-2.5 pl-5 pr-3">操作时间</th>
                      <th className="py-2.5 px-3">分类</th>
                      <th className="py-2.5 px-3">操作动作</th>
                      <th className="py-2.5 px-3">关联需求 / 分支</th>
                      <th className="py-2.5 px-3">结果</th>
                      <th className="py-2.5 pl-3 pr-5">操作详情</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#21262D] text-[12px]">
                    {filteredAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#161B22]/60 transition-colors">
                        <td className="py-3 pl-5 pr-3 font-mono tabular-nums text-[11px] text-[#8B949E] whitespace-nowrap">
                          {formatDateTime(log.timestamp)}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[#8B949E] whitespace-nowrap">
                          {AUDIT_CATEGORY_LABELS[log.category]}
                        </td>
                        <td className="py-3 px-3 font-medium text-[#F0F6FC] whitespace-nowrap">
                          {log.label}
                        </td>
                        <td className="py-3 px-3 max-w-[260px]">
                          <div className="text-[#C9D1D9] flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{log.prdTitle || log.repoFullName}</span>
                            {log.prNumber && (
                              <span className="font-mono text-[11px] text-[#58A6FF] shrink-0">
                                #{log.prNumber}
                              </span>
                            )}
                          </div>
                          {log.branch && (
                            <div className="font-mono text-[11px] text-[#8B949E] truncate">
                              {log.branch}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {log.status === 'success' ? (
                            <span className="inline-flex items-center gap-1 text-[#3FB950] text-[11px]">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              成功
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[#F85149] text-[11px]">
                              <XCircle className="h-3.5 w-3.5" />
                              失败
                            </span>
                          )}
                        </td>
                        <td className="py-3 pl-3 pr-5 text-[#C9D1D9] text-[12px] break-all max-w-[380px]">
                          {log.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {reportTargetId && (
        <RequirementReportModal
          requirementId={reportTargetId}
          onClose={() => setReportTargetId(null)}
          onSuccessToast={onSuccessToast}
          onErrorToast={onErrorToast}
        />
      )}
    </div>
  );
}
