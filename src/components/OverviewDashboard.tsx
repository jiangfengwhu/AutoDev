import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, RefreshCw } from 'lucide-react';
import {
  formatTokenCount,
  type OverviewDailyBucket,
  type OverviewFilterScope,
  type SevenDayOverviewMetrics,
} from '../lib/overviewMetrics';

interface OverviewDashboardProps {
  repoFullName: string;
  refreshSignal: number;
  onErrorToast?: (message: string, title?: string) => void;
}

type ResourceChartMode = 'tokens' | 'minutes' | 'runs';

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string | null;
  color?: string;
  dataKey?: string;
  payload?: OverviewDailyBucket & {
    displaySucceeded?: number;
    displayFailed?: number;
    displayRate?: number | null;
    codingAndDeployMinutes?: number;
  };
}

function SuccessRateTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const succeeded = row.displaySucceeded ?? row.succeeded;
  const failed = row.displayFailed ?? row.failed;
  const rate = row.displayRate !== undefined ? row.displayRate : row.successRate;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2.5 text-[12px] shadow-lg">
      <div className="font-mono font-semibold text-[#F0F6FC] mb-1.5">
        {row.dateKey || label}
      </div>
      <div className="space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">成功率</span>
          <span className="text-[#58A6FF] font-semibold">
            {rate !== null ? `${rate}%` : '无记录'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">成功</span>
          <span className="text-[#3FB950]">{succeeded} 次</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">失败 / 取消</span>
          <span className="text-[#F85149]">{failed} 次</span>
        </div>
      </div>
    </div>
  );
}

function ResourceUsageTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  mode: ResourceChartMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2.5 text-[12px] shadow-lg">
      <div className="font-mono font-semibold text-[#F0F6FC] mb-1.5">
        {row.dateKey || label}
      </div>
      {mode === 'tokens' ? (
        <div className="space-y-1 font-mono tabular-nums text-[11px]">
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">总 Token 消耗</span>
            <span className="text-[#F0F6FC] font-semibold">
              {formatTokenCount(row.totalTokens)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">需求规划</span>
            <span className="text-[#58A6FF]">{formatTokenCount(row.planTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">编码与验证</span>
            <span className="text-[#A371F7]">{formatTokenCount(row.codingTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-5 pt-1 border-t border-[#21262D] text-[#8B949E]">
            <span>输入 / 输出</span>
            <span>
              {formatTokenCount(row.inputTokens)} / {formatTokenCount(row.outputTokens)}
            </span>
          </div>
        </div>
      ) : mode === 'minutes' ? (
        <div className="space-y-1 font-mono tabular-nums text-[11px]">
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">总计算耗时</span>
            <span className="text-[#F0F6FC] font-semibold">{row.totalMinutes.toFixed(1)} min</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">需求规划 (AGY/AI)</span>
            <span className="text-[#58A6FF]">{row.planMinutes.toFixed(1)} min</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">编码与部署 Runner</span>
            <span className="text-[#A371F7]">
              {(row.codingMinutes + row.deployMinutes).toFixed(1)} min
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-1 font-mono tabular-nums text-[11px]">
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">总执行次数</span>
            <span className="text-[#F0F6FC] font-semibold">{row.total} 次</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">规划任务</span>
            <span className="text-[#58A6FF]">{row.planCount} 次</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#8B949E]">编码与部署</span>
            <span className="text-[#A371F7]">{row.codingCount} 次</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function OverviewDashboard({
  repoFullName,
  refreshSignal,
  onErrorToast,
}: OverviewDashboardProps) {
  const [metrics, setMetrics] = useState<SevenDayOverviewMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<OverviewFilterScope>('all');
  const [resourceMode, setResourceMode] = useState<ResourceChartMode>('tokens');

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/overview/metrics?repo=${encodeURIComponent(repoFullName)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `加载研发效能数据失败 (${res.status})`);
      }
      setMetrics(data as SevenDayOverviewMetrics);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法加载最近 7 日概览指标';
      setError(msg);
      onErrorToast?.(msg, '概览指标加载失败');
    } finally {
      setLoading(false);
    }
  }, [repoFullName, onErrorToast]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics, refreshSignal]);

  const chartRows = useMemo(() => {
    if (!metrics) return [];
    return metrics.daily.map((d) => {
      const displaySucceeded =
        scope === 'plan'
          ? d.planSucceeded
          : scope === 'coding'
            ? d.codingSucceeded
            : d.succeeded;
      const displayFailed =
        scope === 'plan'
          ? d.planFailed
          : scope === 'coding'
            ? d.codingFailed
            : d.failed;
      const displayRate =
        scope === 'plan'
          ? d.planSuccessRate
          : scope === 'coding'
            ? d.codingSuccessRate
            : d.successRate;

      return {
        ...d,
        displaySucceeded,
        displayFailed,
        displayRate,
        codingAndDeployMinutes: Number((d.codingMinutes + d.deployMinutes).toFixed(1)),
      };
    });
  }, [metrics, scope]);

  const summary = metrics?.summary;

  return (
    <section
      aria-label="近 7 日全局研发效能与 Token 算力遥测"
      data-testid="overview-metrics-flat"
      className="space-y-4"
    >
      {error && (
        <div
          role="alert"
          className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-4 py-3 text-[12px] text-[#FFDCD7] flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#F85149]" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchMetrics}
            className="inline-flex items-center gap-1.5 rounded border border-[#F85149]/40 bg-[#F85149]/15 px-2.5 py-1 text-[11px] font-medium text-[#FFDCD7] hover:bg-[#F85149]/25 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            <span>重试</span>
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: 7-day Success Rate */}
        <div className="rounded-xl border border-[#242F44] bg-[#0F1522] p-4">
          <div className="text-[12px] text-[#94A3B8]">近 7 日任务成功率</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#1B2435] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className={`font-mono text-[26px] font-semibold tracking-tight tabular-nums ${
                  summary?.overallSuccessRate === null || summary?.overallSuccessRate === undefined
                    ? 'text-[#8E9DB5]'
                    : summary.overallSuccessRate >= 70
                      ? 'text-[#34D399]'
                      : summary.overallSuccessRate >= 40
                        ? 'text-[#FBBF24]'
                        : 'text-[#FB7185]'
                }`}
              >
                {summary?.overallSuccessRate !== null && summary?.overallSuccessRate !== undefined
                  ? `${summary.overallSuccessRate}%`
                  : '—'}
              </span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8E9DB5]">
            {summary
              ? `成功 ${summary.succeededRuns} · 失败 ${summary.failedRuns} · 总计 ${summary.totalRuns}`
              : '正在统计…'}
          </div>
        </div>

        {/* KPI 2: Compute Resource Consumption (Tokens) */}
        <div className="rounded-xl border border-[#242F44] bg-[#0F1522] p-4">
          <div className="text-[12px] text-[#94A3B8]">近 7 日算力消耗 (Token)</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-24 rounded bg-[#1B2435] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[26px] font-semibold tracking-tight text-[#F8FAFC] tabular-nums">
                {summary ? formatTokenCount(summary.totalTokens) : '0'}
              </span>
              <span className="text-[12px] font-mono text-[#A78BFA]">Tokens</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8E9DB5]">
            {summary
              ? `规划 ${formatTokenCount(summary.planTokens)} · 编码 ${formatTokenCount(summary.codingTokens)}`
              : '正在统计…'}
          </div>
        </div>

        {/* KPI 3: Average Duration per Task */}
        <div className="rounded-xl border border-[#242F44] bg-[#0F1522] p-4">
          <div className="text-[12px] text-[#94A3B8]">平均单次执行耗时</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#1B2435] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[26px] font-semibold tracking-tight text-[#38BDF8] tabular-nums">
                {summary?.avgDurationMinutes !== null && summary?.avgDurationMinutes !== undefined
                  ? summary.avgDurationMinutes.toFixed(1)
                  : '—'}
              </span>
              {summary?.avgDurationMinutes !== null && summary?.avgDurationMinutes !== undefined && (
                <span className="text-[12px] font-mono text-[#8E9DB5]">分钟/次</span>
              )}
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8E9DB5]">
            {summary
              ? summary.runningRuns > 0
                ? `当前 ${summary.runningRuns} 项执行中`
                : `已完成 ${summary.completedRuns} 次流水线`
              : '正在统计…'}
          </div>
        </div>

        {/* KPI 4: Weekly PRD Delivery */}
        <div className="rounded-xl border border-[#242F44] bg-[#0F1522] p-4">
          <div className="text-[12px] text-[#94A3B8]">本周需求交付</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#1B2435] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[26px] font-semibold tracking-tight text-[#FBBF24] tabular-nums">
                {summary?.deliveredPrdCount ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8E9DB5]">个需求</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8E9DB5]">
            {summary
              ? `已批准上线 ${summary.approvedPrdCount} · 近 7 日执行 ${summary.totalRuns} 次`
              : '正在统计…'}
          </div>
        </div>
      </div>

      {/* 2-Column Recharts Visualizations */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left Chart: 7-Day Task Success Rate Trend */}
        <div className="xl:col-span-6 rounded-xl border border-[#242F44] bg-[#0F1522] p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-display text-[14px] font-semibold text-[#F8FAFC]">
                近 7 日任务成功率趋势
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#8E9DB5]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#34D399]" aria-hidden="true" />
                  成功
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#FB7185]" aria-hidden="true" />
                  失败/取消
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 bg-[#38BDF8]" aria-hidden="true" />
                  成功率 %
                </span>
              </div>
            </div>

            <div
              role="group"
              aria-label="任务类型筛选"
              className="inline-flex items-center gap-1 rounded-md border border-[#30363D] bg-[#0D1117] p-0.5"
            >
              {(
                [
                  { id: 'all', label: '全部' },
                  { id: 'plan', label: '规划' },
                  { id: 'coding', label: '编码/部署' },
                ] as const
              ).map((tab) => {
                const active = scope === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setScope(tab.id)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#21262D] text-[#F0F6FC]'
                        : 'text-[#8B949E] hover:text-[#C9D1D9]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-[240px] w-full">
            {loading && !metrics ? (
              <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartRows}
                  margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262D" vertical={false} />
                  <XAxis
                    dataKey="label"
                    padding={{ left: 8, right: 8 }}
                    tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={{ stroke: '#30363D' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="count"
                    allowDecimals={false}
                    tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Tooltip
                    content={<SuccessRateTooltip />}
                    cursor={{ fill: 'rgba(88, 166, 255, 0.06)' }}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="displaySucceeded"
                    name="成功"
                    stackId="runs"
                    fill="#34D399"
                    radius={[0, 0, 0, 0]}
                    barSize={24}
                    isAnimationActive={false}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="displayFailed"
                    name="失败/取消"
                    stackId="runs"
                    fill="#FB7185"
                    radius={[3, 3, 0, 0]}
                    barSize={24}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="displayRate"
                    name="成功率"
                    stroke="#38BDF8"
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                    dot={{ r: 4, fill: '#0F1522', stroke: '#38BDF8', strokeWidth: 2 }}
                    activeDot={{ r: 5.5, fill: '#38BDF8', stroke: '#F8FAFC', strokeWidth: 1.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right Chart: 7-Day Resource Consumption Trend */}
        <div className="xl:col-span-6 rounded-xl border border-[#242F44] bg-[#0F1522] p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-display text-[14px] font-semibold text-[#F8FAFC]">
                近 7 日资源消耗趋势
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#8E9DB5]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#38BDF8]" aria-hidden="true" />
                  需求规划
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#A78BFA]" aria-hidden="true" />
                  编码与部署 Runner
                </span>
              </div>
            </div>

            <div
              role="group"
              aria-label="资源指标切换"
              className="inline-flex items-center gap-1 rounded-md border border-[#30363D] bg-[#0D1117] p-0.5"
            >
              {(
                [
                  { id: 'tokens', label: 'Token 消耗' },
                  { id: 'runs', label: '执行频次' },
                  { id: 'minutes', label: '耗时 (分)' },
                ] as const
              ).map((tab) => {
                const active = resourceMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setResourceMode(tab.id)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#21262D] text-[#F0F6FC]'
                        : 'text-[#8B949E] hover:text-[#C9D1D9]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-[240px] w-full">
            {loading && !metrics ? (
              <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartRows}
                  margin={{ top: 10, right: 20, left: -4, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="autodevPlanFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="autodevCodingFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#A78BFA" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#A78BFA" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E283B" vertical={false} />
                  <XAxis
                    dataKey="label"
                    padding={{ left: 12, right: 12 }}
                    tick={{ fill: '#8E9DB5', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={{ stroke: '#2A3548' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={resourceMode === 'minutes'}
                    tickFormatter={(v) =>
                      resourceMode === 'tokens'
                        ? formatTokenCount(Number(v))
                        : resourceMode === 'minutes'
                          ? `${v}m`
                          : `${v}`
                    }
                    tick={{ fill: '#8E9DB5', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<ResourceUsageTooltip mode={resourceMode} />}
                    cursor={{ stroke: '#2A3548', strokeDasharray: '3 3' }}
                  />
                  <Area
                    type="monotone"
                    dataKey={
                      resourceMode === 'tokens'
                        ? 'planTokens'
                        : resourceMode === 'minutes'
                          ? 'planMinutes'
                          : 'planCount'
                    }
                    name="需求规划"
                    stackId="resource"
                    stroke="#38BDF8"
                    strokeWidth={2}
                    fill="url(#autodevPlanFill)"
                    isAnimationActive={false}
                    dot={{ r: 3, fill: '#0F1522', stroke: '#38BDF8', strokeWidth: 1.5 }}
                    activeDot={{ r: 4.5, fill: '#38BDF8', stroke: '#F8FAFC', strokeWidth: 1.5 }}
                  />
                  <Area
                    type="monotone"
                    dataKey={
                      resourceMode === 'tokens'
                        ? 'codingTokens'
                        : resourceMode === 'minutes'
                          ? 'codingAndDeployMinutes'
                          : 'codingCount'
                    }
                    name="编码与部署"
                    stackId="resource"
                    stroke="#A78BFA"
                    strokeWidth={2}
                    fill="url(#autodevCodingFill)"
                    isAnimationActive={false}
                    dot={{ r: 3, fill: '#0F1522', stroke: '#A78BFA', strokeWidth: 1.5 }}
                    activeDot={{ r: 4.5, fill: '#A78BFA', stroke: '#F8FAFC', strokeWidth: 1.5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
