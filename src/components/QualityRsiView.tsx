import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../lib/editAuthClient';
import {
  ROOT_CAUSE_LABELS,
  RSI_BUDGET_LIMITS,
  TARGET_STAGE_LABELS,
  type FailureIncident,
  type FailureIncidentSource,
  type QualityRsiSummary,
  type QualityTrendPoint,
  type RootCauseDistributionItem,
  type RsiDecisionAction,
  type RsiEvolutionTrendPoint,
  type RsiPromptBudgetUsage,
  type RsiRootCauseCategory,
  type RsiRuleSeverity,
  type RsiRuleStatus,
  type RsiSystemRule,
  type RsiTargetStage,
  type TestExecutionReport,
} from '../lib/rsiEngine';

import type { BackgroundTask } from '../types/autodev';

export interface QualityFocusTarget {
  reportId?: string;
  actionsRunId?: number;
  nonce: number;
}

interface QualityRsiViewProps {
  repoFullName: string;
  focusedTarget?: QualityFocusTarget | null;
  onClearFocusedTarget?: () => void;
  onBackgroundTaskStarted?: (task: BackgroundTask) => void;
  refreshNonce?: number;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

interface RsiDashboardApiResponse {
  testReports: TestExecutionReport[];
  incidents: FailureIncident[];
  rules: RsiSystemRule[];
  lastSyncedAt?: string;
  summary: QualityRsiSummary;
  budget?: RsiPromptBudgetUsage;
  testTrend: QualityTrendPoint[];
  evolutionTrend?: RsiEvolutionTrendPoint[];
  rootCauseDistribution: RootCauseDistributionItem[];
  effectivePrompts: {
    architect: string;
    qa_spec: string;
    qa_critic: string;
    coding: string;
  };
}

const DECISION_ACTION_LABELS: Record<RsiDecisionAction, { label: string; color: string }> = {
  create_critical_active: { label: '立即生效 (Active)', color: 'text-[#3FB950]' },
  create_candidate: { label: '写入待观察池 (Candidate)', color: 'text-[#D29922]' },
  merge_existing: { label: '语义合并现有规则 (Merge)', color: 'text-[#58A6FF]' },
  discard_edge_case: { label: '丢弃特例 (Discard)', color: 'text-[#8B949E]' },
};

const RULE_STATUS_META: Record<RsiRuleStatus, { label: string; color: string }> = {
  active: { label: '生效中（自动注入）', color: 'text-[#3FB950]' },
  candidate: { label: '待观察（复发 ≥2 次自动转正）', color: 'text-[#D29922]' },
  paused: { label: '已暂停', color: 'text-[#8B949E]' },
  archived: { label: '已归档（超 30 天未命中/超预算）', color: 'text-[#6E7681]' },
};

type WorkbenchTab = 'reports' | 'incidents' | 'rules';
type TrendKindFilter = 'all' | 'tests' | 'build_check';
type PromptPreviewStage = 'architect' | 'qa_spec' | 'qa_critic' | 'coding';

const SOURCE_LABELS: Record<FailureIncidentSource, string> = {
  test_failure: '测试失败',
  ci_env_error: 'CI / 环境异常',
  plan_error: '规划阶段异常',
  deploy_error: '部署失败',
  manual_acceptance: '人工验收退回',
  manual_report: '人工上报',
};

const REPORT_KIND_LABELS: Record<TestExecutionReport['kind'], string> = {
  e2e: 'Playwright E2E',
  unit: '自动化单测',
  build_check: '流水线校验',
};

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

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function TestTrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: QualityTrendPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2.5 text-[12px] shadow-lg max-w-[260px]">
      <div className="font-mono font-semibold text-[#F0F6FC] truncate">
        {row.workflowName} ({row.label})
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-[#8B949E] truncate">
        {row.dateKey} · {row.branch}
      </div>
      <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#8B949E]">通过率</span>
          <span className="text-[#58A6FF] font-semibold">
            {row.passRate !== null ? `${row.passRate}%` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#8B949E]">通过 / 失败 / 跳过</span>
          <span>
            <span className="text-[#3FB950]">{row.passed}</span>
            <span className="text-[#6E7681]"> / </span>
            <span className="text-[#F85149]">{row.failed}</span>
            <span className="text-[#6E7681]"> / </span>
            <span className="text-[#D29922]">{row.skipped}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function RootCauseTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RootCauseDistributionItem }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2.5 text-[12px] shadow-lg">
      <div className="font-semibold text-[#F0F6FC] mb-1.5">{row.label}</div>
      <div className="space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">已归因故障</span>
          <span className="text-[#58A6FF] font-semibold">{row.count} 次</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#8B949E]">已沉淀为规则</span>
          <span className="text-[#3FB950] font-semibold">{row.codifiedCount} 次</span>
        </div>
      </div>
    </div>
  );
}

function RsiEvolutionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RsiEvolutionTrendPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-[#30363D] bg-[#161B22] px-3 py-2.5 text-[12px] shadow-lg max-w-[270px]">
      <div className="font-mono font-semibold text-[#F0F6FC] truncate">
        {row.workflowName} ({row.label})
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-[#8B949E] truncate">
        {row.dateKey} · {row.branch}
      </div>
      <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#8B949E]">本轮成功率</span>
          <span className="text-[#58A6FF] font-semibold">
            {row.passRatePct !== null ? `${row.passRatePct}%` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#8B949E]">3 轮滚动成功率</span>
          <span className="text-[#3FB950] font-semibold">
            {row.rollingSuccessRatePct !== null ? `${row.rollingSuccessRatePct}%` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#8B949E]">累计采纳 System Prompt</span>
          <span className="text-[#A371F7] font-semibold">
            {row.adoptedPromptsCumulative} 条
            {row.newlyAdoptedPrompts > 0 ? ` (+${row.newlyAdoptedPrompts})` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export function QualityRsiView({
  repoFullName,
  focusedTarget,
  onClearFocusedTarget,
  onBackgroundTaskStarted,
  refreshNonce = 0,
  onErrorToast,
  onSuccessToast,
}: QualityRsiViewProps) {
  const [data, setData] = useState<RsiDashboardApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<WorkbenchTab>('reports');
  const [trendFilter, setTrendFilter] = useState<TrendKindFilter>('all');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [highlightedReportId, setHighlightedReportId] = useState<string | null>(null);
  const [analyzingIncidentId, setAnalyzingIncidentId] = useState<string | null>(null);

  // Manual Incident Report Drawer/Form
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentSource, setIncidentSource] = useState<FailureIncidentSource>('manual_acceptance');
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentBranch, setIncidentBranch] = useState('main');
  const [incidentSummary, setIncidentSummary] = useState('');
  const [incidentEvidence, setIncidentEvidence] = useState('');
  const [submittingIncident, setSubmittingIncident] = useState(false);

  // Rules management state
  const [ruleStageFilter, setRuleStageFilter] = useState<'all_filter' | RsiTargetStage>('all_filter');
  const [ruleStatusFilter, setRuleStatusFilter] = useState<'all' | RsiRuleStatus>('all');
  const [showNewRuleForm, setShowNewRuleForm] = useState(false);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleStage, setNewRuleStage] = useState<RsiTargetStage>('all');
  const [newRuleSeverity, setNewRuleSeverity] = useState<RsiRuleSeverity>('critical');
  const [newRuleCategory, setNewRuleCategory] = useState<RsiRootCauseCategory>('env_infra');
  const [newRuleDirective, setNewRuleDirective] = useState('');
  const [savingRule, setSavingRule] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);

  // Live Prompt Preview
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [previewStage, setPreviewStage] = useState<PromptPreviewStage>('architect');

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/rsi/state');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const loaded = json as RsiDashboardApiResponse;
      setData(loaded);
      const stages: PromptPreviewStage[] = ['architect', 'qa_spec', 'qa_critic', 'coding'];
      const firstActive = stages.find(
        (stage) => Boolean(loaded.effectivePrompts?.[stage]?.trim())
      );
      if (firstActive) {
        setPreviewStage((prev) =>
          loaded.effectivePrompts?.[prev]?.trim() ? prev : firstActive
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载测试质量与 RSI 数据失败';
      setError(msg);
      onErrorToast(msg, '质量看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [onErrorToast]);

  useEffect(() => {
    fetchState();
  }, [fetchState, refreshNonce]);

  // Direct jump from ApprovalView automated test summary to matching test report detail
  useEffect(() => {
    if (!focusedTarget || !data) return;
    setActiveTab('reports');
    const reports = data.testReports ?? [];
    const matched =
      (focusedTarget.reportId
        ? reports.find((r) => r.id === focusedTarget.reportId)
        : undefined) ??
      (focusedTarget.actionsRunId
        ? reports.find((r) => r.actionsRunId === focusedTarget.actionsRunId)
        : undefined) ??
      reports[0] ??
      null;

    if (matched) {
      setExpandedReportId(matched.id);
      setHighlightedReportId(matched.id);
      const scrollTimer = setTimeout(() => {
        document
          .getElementById(`test-report-${matched.id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      const clearHighlightTimer = setTimeout(() => {
        setHighlightedReportId((prev) => (prev === matched.id ? null : prev));
      }, 4500);
      onClearFocusedTarget?.();
      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(clearHighlightTimer);
      };
    }

    onClearFocusedTarget?.();
  }, [focusedTarget, data, onClearFocusedTarget]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await apiFetch('/api/rsi/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          async: true,
          repoFullName,
          autoAnalyzeLimit: 4,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.task) {
        onBackgroundTaskStarted?.(json.task as BackgroundTask);
        onSuccessToast(
          '测试报告同步与 RSI AI 归因已转入服务端后台执行，切换房间不会中断',
          '后台同步已启动'
        );
        return;
      }
      if (!res.ok) {
        throw new Error(json.error || `同步失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      const sr = json.syncResult as
        | { syncedReportsCount: number; newIncidentsCount: number; analyzedCount: number }
        | undefined;
      onSuccessToast(
        sr
          ? `同步 ${sr.syncedReportsCount} 份执行报告，新增 ${sr.newIncidentsCount} 条故障，完成 ${sr.analyzedCount} 次 AI 归因`
          : '已完成测试报告同步与 RSI 归因',
        '质量数据已更新'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '同步测试报告与归因失败';
      setError(msg);
      onErrorToast(msg, '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyzeIncident = async (incidentId: string) => {
    setAnalyzingIncidentId(incidentId);
    try {
      const res = await apiFetch(`/api/rsi/incidents/${encodeURIComponent(incidentId)}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.task) {
        onBackgroundTaskStarted?.(json.task as BackgroundTask);
        onSuccessToast(
          '故障归因与 RSI 门控分析已转入服务端后台执行，离开页面不会中断',
          '后台归因已启动'
        );
        return;
      }
      if (!res.ok) {
        throw new Error(json.error || `AI 归因失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      const outcome = json.incident?.attribution?.appliedOutcome;
      const actionText =
        outcome === 'merged' || json.ruleAction === 'merged'
          ? 'gemini-decision-1 判定语义重复，已合并强化现有规则'
          : outcome === 'candidate_created'
            ? 'gemini-decision-1 判定为候选规则，已写入待观察池（复发 ≥2 次自动转正）'
            : outcome === 'active_created' || json.ruleAction === 'created'
              ? 'gemini-decision-1 判定为高危通用规则，已立即生效注入'
              : 'gemini-decision-1 判定为一次性特例/偶发故障，拒绝写入 System Prompt';
      onSuccessToast(actionText, 'RSI 归因与门控完成');
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : 'AI 归因失败', '归因异常');
    } finally {
      setAnalyzingIncidentId(null);
    }
  };

  const handleSubmitManualIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (incidentTitle.trim().length < 3 || incidentSummary.trim().length < 5) {
      onErrorToast('请填写事件标题与错误/退回详情（至少 5 字）', '输入不完整');
      return;
    }
    setSubmittingIncident(true);
    try {
      const res = await apiFetch('/api/rsi/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          async: true,
          repoFullName,
          source: incidentSource,
          title: incidentTitle.trim(),
          branch: incidentBranch.trim() || 'main',
          errorSummary: incidentSummary.trim(),
          rawEvidence: incidentEvidence.trim() || incidentSummary.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.task) {
        onBackgroundTaskStarted?.(json.task as BackgroundTask);
        setIncidentTitle('');
        setIncidentSummary('');
        setIncidentEvidence('');
        setShowIncidentForm(false);
        setActiveTab('incidents');
        onSuccessToast(
          '异常上报与 RSI 自动归因已转入服务端后台执行，切换房间不会中断',
          '后台归因已启动'
        );
        return;
      }
      if (!res.ok) {
        throw new Error(json.error || `提交失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      setIncidentTitle('');
      setIncidentSummary('');
      setIncidentEvidence('');
      setShowIncidentForm(false);
      setActiveTab('incidents');
      const codified = Boolean(json.incident?.attribution?.shouldCodifyAsRule);
      onSuccessToast(
        codified
          ? '异常已归因并沉淀至 RSI System Prompt 规则库'
          : '异常已归因评估（判定为无需写入长期 Prompt）',
        'RSI 反馈闭环完成'
      );
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '提交异常归因失败', '提交失败');
    } finally {
      setSubmittingIncident(false);
    }
  };

  const handleCreateManualRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newRuleTitle.trim().length < 2 || newRuleDirective.trim().length < 8) {
      onErrorToast('请填写规则标题与完整的 System Prompt 约束指令', '输入不完整');
      return;
    }
    setSavingRule(true);
    try {
      const res = await apiFetch('/api/rsi/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newRuleTitle.trim(),
          targetStage: newRuleStage,
          severity: newRuleSeverity,
          rootCauseCategory: newRuleCategory,
          promptDirective: newRuleDirective.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `新增规则失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      setNewRuleTitle('');
      setNewRuleDirective('');
      setShowNewRuleForm(false);
      onSuccessToast('新规则已生效，将在下一次需求生成与编码中自动注入', '规则已添加');
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '新增规则失败', '操作失败');
    } finally {
      setSavingRule(false);
    }
  };

  const handleUpdateRuleStatus = async (rule: RsiSystemRule, nextStatus: RsiRuleStatus) => {
    setBusyRuleId(rule.id);
    try {
      const res = await apiFetch(`/api/rsi/rules/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `更新失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      const msgMap: Record<RsiRuleStatus, string> = {
        active: `已将规则「${rule.title}」设为生效注入`,
        candidate: `已将规则「${rule.title}」移入待观察池`,
        paused: `已暂停规则「${rule.title}」`,
        archived: `已归档规则「${rule.title}」`,
      };
      onSuccessToast(msgMap[nextStatus], '规则状态已更新');
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '更新规则状态失败', '操作失败');
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleConsolidateRules = async () => {
    setConsolidating(true);
    try {
      const res = await apiFetch('/api/rsi/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.task) {
        onBackgroundTaskStarted?.(json.task as BackgroundTask);
        onSuccessToast(
          'RSI 规则蒸馏压缩已转入服务端后台执行，离开页面不会中断',
          '后台蒸馏已启动'
        );
        return;
      }
      if (!res.ok) {
        throw new Error(json.error || `AI 蒸馏压缩失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      const c = json.consolidation as
        | { beforeCount: number; afterCount: number; summary: string }
        | undefined;
      onSuccessToast(
        c ? `${c.beforeCount} 条 -> ${c.afterCount} 条：${c.summary}` : '已完成规则库蒸馏压缩',
        'RSI 规则蒸馏完成'
      );
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : 'AI 蒸馏压缩失败', '蒸馏异常');
    } finally {
      setConsolidating(false);
    }
  };

  const handleDeleteRule = async (rule: RsiSystemRule) => {
    setBusyRuleId(rule.id);
    try {
      const res = await apiFetch(`/api/rsi/rules/${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `删除失败 (${res.status})`);
      }
      if (json.state) {
        setData(json.state as RsiDashboardApiResponse);
      }
      onSuccessToast(`已移除规则「${rule.title}」`, '规则已删除');
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '删除规则失败', '操作失败');
    } finally {
      setBusyRuleId(null);
    }
  };

  const filteredTrend = useMemo(() => {
    const raw = data?.testTrend ?? [];
    if (trendFilter === 'tests') {
      return raw.filter((item) => item.kind === 'e2e' || item.kind === 'unit');
    }
    if (trendFilter === 'build_check') {
      return raw.filter((item) => item.kind === 'build_check');
    }
    return raw;
  }, [data?.testTrend, trendFilter]);

  const filteredRules = useMemo(() => {
    let raw = data?.rules ?? [];
    if (ruleStageFilter !== 'all_filter') {
      raw = raw.filter((r) => r.targetStage === ruleStageFilter);
    }
    if (ruleStatusFilter !== 'all') {
      raw = raw.filter((r) => r.status === ruleStatusFilter);
    }
    return raw;
  }, [data?.rules, ruleStageFilter, ruleStatusFilter]);

  const evolutionTrend = useMemo(() => data?.evolutionTrend ?? [], [data?.evolutionTrend]);

  const evolutionMetrics = useMemo(() => {
    const ratePoints = evolutionTrend.filter((p) => p.passRatePct !== null);
    const latestRate =
      ratePoints.length > 0 ? ratePoints[ratePoints.length - 1].passRatePct : null;
    const firstRate = ratePoints.length > 1 ? ratePoints[0].passRatePct : null;
    const delta =
      latestRate !== null && firstRate !== null ? latestRate - firstRate : null;
    const latestAdopted =
      evolutionTrend.length > 0
        ? evolutionTrend[evolutionTrend.length - 1].adoptedPromptsCumulative
        : (data?.summary?.activeRulesCount ?? 0);
    return { latestRate, delta, latestAdopted };
  }, [evolutionTrend, data?.summary?.activeRulesCount]);

  const summary = data?.summary;
  const activePromptText = data?.effectivePrompts?.[previewStage] ?? '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC] text-balance">
            测试看板与系统自进化 (RSI)
          </h1>
          <p className="mt-1 text-[13px] text-[#8B949E]">
            仓库 <code className="font-mono text-[#C9D1D9]">{repoFullName}</code> · 自动捕获测试/环境/验收故障并按需沉淀至下一轮 System Prompt
            {data?.lastSyncedAt && (
              <>
                <span aria-hidden="true" className="mx-1.5 text-[#6E7681]">·</span>
                <span className="font-mono text-[12px] tabular-nums">
                  同步于 {formatDateTime(data.lastSyncedAt)}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setShowIncidentForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-1.5 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>手动上报异常</span>
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-3.5 py-1.5 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? '同步与归因中…' : '同步测试与自动归因'}</span>
          </button>
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

      {/* Collapsible Manual Incident Capture Form */}
      {showIncidentForm && (
        <section
          aria-label="手动上报异常进入 RSI 反馈闭环"
          className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                手动上报测试 / 环境 / 验收问题
              </h2>
              <p className="text-[12px] text-[#8B949E] mt-0.5">
                提交后将立即触发 AI 失败归因引擎，判断是否值得沉淀为长期 System Prompt 规则。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowIncidentForm(false)}
              className="text-[12px] text-[#8B949E] hover:text-[#F0F6FC]"
            >
              收起
            </button>
          </div>

          <form onSubmit={handleSubmitManualIncident} className="space-y-3.5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <div>
                <label
                  htmlFor="rsi-inc-source"
                  className="block text-[12px] font-medium text-[#C9D1D9] mb-1"
                >
                  异常来源
                </label>
                <select
                  id="rsi-inc-source"
                  value={incidentSource}
                  onChange={(e) => setIncidentSource(e.target.value as FailureIncidentSource)}
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[13px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                >
                  <option value="manual_acceptance">人工验收发现问题</option>
                  <option value="test_failure">自动化测试用例失败</option>
                  <option value="ci_env_error">环境 / Runner 故障</option>
                  <option value="deploy_error">Cloudflare 部署异常</option>
                  <option value="plan_error">需求规划阶段报错</option>
                  <option value="manual_report">其他系统反馈</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="rsi-inc-title"
                  className="block text-[12px] font-medium text-[#C9D1D9] mb-1"
                >
                  问题标题
                </label>
                <input
                  id="rsi-inc-title"
                  type="text"
                  value={incidentTitle}
                  onChange={(e) => setIncidentTitle(e.target.value)}
                  placeholder="例如：D1 迁移重复建表导致预览部署失败"
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="rsi-inc-branch"
                  className="block text-[12px] font-medium text-[#C9D1D9] mb-1"
                >
                  关联分支
                </label>
                <input
                  id="rsi-inc-branch"
                  type="text"
                  value={incidentBranch}
                  onChange={(e) => setIncidentBranch(e.target.value)}
                  placeholder="main 或 autodev/feat-*"
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-1.5 font-mono text-[12px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="rsi-inc-summary"
                className="block text-[12px] font-medium text-[#C9D1D9] mb-1"
              >
                故障现象与错误摘要
              </label>
              <textarea
                id="rsi-inc-summary"
                rows={2}
                value={incidentSummary}
                onChange={(e) => setIncidentSummary(e.target.value)}
                placeholder="简述报错原因、失败用例表现或人工验收中暴露的缺陷…"
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="rsi-inc-evidence"
                className="block text-[12px] font-medium text-[#C9D1D9] mb-1"
              >
                原始报错日志 / 堆栈（可选）
              </label>
              <textarea
                id="rsi-inc-evidence"
                rows={3}
                value={incidentEvidence}
                onChange={(e) => setIncidentEvidence(e.target.value)}
                placeholder="粘贴控制台日志、Playwright 断言失败堆栈或 Wrangler 输出…"
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#C9D1D9] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowIncidentForm(false)}
                className="rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D]"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submittingIncident}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-1.5 text-[12px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-50"
              >
                {submittingIncident && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{submittingIncident ? '正在 AI 归因分析…' : '提交并自动归因'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 4-Column Quality & RSI KPI Strip */}
      <section aria-label="质量与自进化核心指标" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">自动化测试与校验通过率</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className={`font-mono text-[24px] font-semibold tracking-tight tabular-nums ${
                  summary?.overallTestPassRate === null || summary?.overallTestPassRate === undefined
                    ? 'text-[#8B949E]'
                    : summary.overallTestPassRate >= 80
                      ? 'text-[#3FB950]'
                      : summary.overallTestPassRate >= 50
                        ? 'text-[#D29922]'
                        : 'text-[#F85149]'
                }`}
              >
                {summary?.overallTestPassRate !== null && summary?.overallTestPassRate !== undefined
                  ? `${summary.overallTestPassRate}%`
                  : '—'}
              </span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary
              ? `通过 ${summary.passedCases} · 失败 ${summary.failedCases} · 跳过 ${summary.skippedCases}`
              : '正在加载…'}
          </div>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">已采集测试报告</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#F0F6FC] tabular-nums">
                {summary?.totalReports ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">份报告</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary ? `累计用例与校验项 ${summary.totalCases} 项` : '正在加载…'}
          </div>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">失败归因与沉淀筛选</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#58A6FF] tabular-nums">
                {summary?.codifiedIncidents ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">
                / {summary?.analyzedIncidents ?? 0} 已沉淀
              </span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary
              ? `总异常 ${summary.totalIncidents} · 过滤偶发 ${summary.ignoredTransientIncidents}`
              : '正在加载…'}
          </div>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4">
          <div className="text-[12px] text-[#8B949E]">生效中 RSI System Prompt</div>
          {loading && !summary ? (
            <div className="mt-2 h-7 w-20 rounded bg-[#21262D] animate-pulse" />
          ) : (
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-semibold tracking-tight text-[#3FB950] tabular-nums">
                {summary?.activeRulesCount ?? 0}
              </span>
              <span className="text-[12px] font-mono text-[#8B949E]">条规则</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-[#8B949E]">
            {summary
              ? `待观察 ${summary.candidateRulesCount} · 已归档 ${summary.archivedRulesCount} · 注入 ${summary.totalRuleApplications} 次`
              : '正在加载…'}
          </div>
        </div>
      </section>

      {/* Primary Self-Evolution Recharts Panel: Success Rate Trend vs Adopted System Prompts */}
      <section
        aria-label="系统自进化成功率与采纳规则趋势"
        className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-4"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
              系统自进化趋势：成功率变化 vs 采纳 System Prompt 数量
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] text-[#8B949E]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-[#58A6FF]" aria-hidden="true" />
                单轮成功率 %
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 bg-[#3FB950]" aria-hidden="true" />
                3 轮滚动成功率 %
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-[#A371F7]" aria-hidden="true" />
                累计采纳 System Prompt 数
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono tabular-nums text-[12px]">
            <div>
              <span className="text-[#8B949E] mr-1.5">最新成功率</span>
              <span className="font-semibold text-[#F0F6FC]">
                {evolutionMetrics.latestRate !== null ? `${evolutionMetrics.latestRate}%` : '—'}
              </span>
            </div>
            <div>
              <span className="text-[#8B949E] mr-1.5">进化净变化</span>
              <span
                className={`font-semibold ${
                  evolutionMetrics.delta === null
                    ? 'text-[#8B949E]'
                    : evolutionMetrics.delta >= 0
                      ? 'text-[#3FB950]'
                      : 'text-[#F85149]'
                }`}
              >
                {evolutionMetrics.delta === null
                  ? '—'
                  : `${evolutionMetrics.delta >= 0 ? '+' : ''}${evolutionMetrics.delta}%`}
              </span>
            </div>
            <div>
              <span className="text-[#8B949E] mr-1.5">已采纳规则</span>
              <span className="font-semibold text-[#A371F7]">
                {evolutionMetrics.latestAdopted} 条
              </span>
            </div>
          </div>
        </div>

        <div className="h-[260px] w-full">
          {loading && !data ? (
            <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
          ) : evolutionTrend.length === 0 ? (
            <div className="h-full w-full rounded border border-dashed border-[#30363D] bg-[#0D1117] flex flex-col items-center justify-center gap-2 text-[12px] text-[#8B949E] px-4 text-center">
              <span>暂无自进化趋势样本，完成首轮测试或同步报告后将自动绘制成功率与规则增长曲线</span>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="text-[#58A6FF] hover:underline"
              >
                立即同步 GitHub Actions 测试报告
              </button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={evolutionTrend}
                margin={{ top: 10, right: 16, left: -6, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="rsiPassRateGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#58A6FF" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#58A6FF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262D" vertical={false} />
                <XAxis
                  dataKey="label"
                  padding={{ left: 16, right: 16 }}
                  tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={{ stroke: '#30363D' }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="rate"
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <YAxis
                  yAxisId="prompts"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: '#A371F7', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  content={<RsiEvolutionTooltip />}
                  cursor={{ fill: 'rgba(88, 166, 255, 0.06)' }}
                />
                <Bar
                  yAxisId="prompts"
                  dataKey="adoptedPromptsCumulative"
                  name="累计采纳 System Prompt"
                  fill="#A371F7"
                  fillOpacity={0.45}
                  barSize={22}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="rate"
                  type="monotone"
                  dataKey="passRatePct"
                  name="单轮成功率"
                  stroke="#58A6FF"
                  strokeWidth={2}
                  fill="url(#rsiPassRateGradient)"
                  connectNulls
                  isAnimationActive={false}
                  dot={{ r: 3.5, fill: '#0D1117', stroke: '#58A6FF', strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: '#58A6FF', stroke: '#F0F6FC', strokeWidth: 1.5 }}
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="rollingSuccessRatePct"
                  name="3 轮滚动成功率"
                  stroke="#3FB950"
                  strokeWidth={2.5}
                  connectNulls
                  isAnimationActive={false}
                  dot={{ r: 3, fill: '#0D1117', stroke: '#3FB950', strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: '#3FB950', stroke: '#F0F6FC', strokeWidth: 1.5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* 2-Column Recharts Visualizations */}
      <section aria-label="测试质量与失败归因可视化" className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left Chart: Test Execution Outcomes & Pass Rate Trend */}
        <div className="xl:col-span-6 rounded-md border border-[#30363D] bg-[#161B22] p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                测试执行结果与通过率趋势
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#8B949E]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#3FB950]" aria-hidden="true" />
                  通过
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#F85149]" aria-hidden="true" />
                  失败
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#D29922]" aria-hidden="true" />
                  跳过
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 bg-[#58A6FF]" aria-hidden="true" />
                  通过率 %
                </span>
              </div>
            </div>

            <div
              role="group"
              aria-label="报告类型筛选"
              className="inline-flex items-center gap-1 rounded-md border border-[#30363D] bg-[#0D1117] p-0.5"
            >
              {(
                [
                  { id: 'all', label: '全部' },
                  { id: 'tests', label: 'E2E/单测' },
                  { id: 'build_check', label: '流水线校验' },
                ] as const
              ).map((tab) => {
                const active = trendFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTrendFilter(tab.id)}
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
            {loading && !data ? (
              <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
            ) : filteredTrend.length === 0 ? (
              <div className="h-full w-full rounded border border-dashed border-[#30363D] bg-[#0D1117] flex flex-col items-center justify-center gap-2 text-[12px] text-[#8B949E] px-4 text-center">
                <span>暂无该类型的测试执行记录</span>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className="text-[#58A6FF] hover:underline"
                >
                  点击同步 GitHub Actions 最新执行报告
                </button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={filteredTrend}
                  margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
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
                    content={<TestTrendTooltip />}
                    cursor={{ fill: 'rgba(88, 166, 255, 0.06)' }}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="passed"
                    name="通过"
                    stackId="cases"
                    fill="#3FB950"
                    barSize={20}
                    isAnimationActive={false}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="failed"
                    name="失败"
                    stackId="cases"
                    fill="#F85149"
                    barSize={20}
                    isAnimationActive={false}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="skipped"
                    name="跳过"
                    stackId="cases"
                    fill="#D29922"
                    radius={[3, 3, 0, 0]}
                    barSize={20}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="passRate"
                    name="通过率"
                    stroke="#58A6FF"
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                    dot={{ r: 3.5, fill: '#0D1117', stroke: '#58A6FF', strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#58A6FF', stroke: '#F0F6FC', strokeWidth: 1.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right Chart: Failure Root-Cause Distribution & Codification Rate */}
        <div className="xl:col-span-6 rounded-md border border-[#30363D] bg-[#161B22] p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
                失败归因根因分类分布
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#8B949E]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#58A6FF]" aria-hidden="true" />
                  已归因事件
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-[#3FB950]" aria-hidden="true" />
                  沉淀为 System Prompt 规则
                </span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
              6 类工程根因
            </span>
          </div>

          <div className="h-[240px] w-full">
            {loading && !data ? (
              <div className="h-full w-full rounded bg-[#0D1117] animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data?.rootCauseDistribution ?? []}
                  layout="vertical"
                  margin={{ top: 6, right: 20, left: 10, bottom: 4 }}
                  barGap={3}
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
                    width={96}
                    tick={{ fill: '#C9D1D9', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<RootCauseTooltip />}
                    cursor={{ fill: 'rgba(88, 166, 255, 0.06)' }}
                  />
                  <Bar
                    dataKey="count"
                    name="已归因事件"
                    fill="#58A6FF"
                    barSize={10}
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="codifiedCount"
                    name="已沉淀规则"
                    fill="#3FB950"
                    barSize={10}
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* Main 3-Tab Operational Workbench */}
      <section className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
        <div className="px-5 py-3 border-b border-[#30363D] flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="质量与 RSI 工作区切换"
            className="inline-flex items-center gap-1 rounded-md bg-[#0D1117] p-1 border border-[#30363D]"
          >
            {(
              [
                { id: 'reports', label: '测试执行明细', count: data?.testReports.length ?? 0 },
                { id: 'incidents', label: '失败归因与沉淀决策', count: data?.incidents.length ?? 0 },
                { id: 'rules', label: 'RSI System Prompt 规则库', count: data?.rules.length ?? 0 },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap tabular-nums ${
                    active
                      ? 'bg-[#21262D] text-[#F0F6FC]'
                      : 'text-[#8B949E] hover:text-[#C9D1D9]'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>

          {activeTab === 'rules' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={consolidating}
                onClick={handleConsolidateRules}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors"
              >
                {consolidating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#58A6FF]" />
                ) : (
                  <Layers className="h-3.5 w-3.5 text-[#D29922]" />
                )}
                <span>{consolidating ? 'AI 蒸馏中…' : 'AI 蒸馏压缩'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowPromptPreview((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#58A6FF]" />
                <span>{showPromptPreview ? '隐藏注入预览' : '预览注入 Prompt'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNewRuleForm((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] border border-[#3FB950]/30 px-3 py-1.5 text-[12px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新增规则</span>
              </button>
            </div>
          )}
        </div>

        {/* TAB 1: Test Execution Reports Table */}
        {activeTab === 'reports' && (
          <div className="bg-[#0D1117]">
            {!data || data.testReports.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-3">
                <div className="text-[14px] font-medium text-[#F0F6FC]">
                  尚未采集到测试执行报告
                </div>
                <p className="text-[12px] text-[#8B949E] max-w-md mx-auto">
                  点击右上角「同步测试与自动归因」，系统将立即拉取 <code className="font-mono">{repoFullName}</code> 最近的真实 GitHub Actions 测试报告、用例明细与失败日志。
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[880px]">
                  <div className="grid grid-cols-[2rem_minmax(240px,2fr)_116px_88px_132px_76px_82px_124px] items-center border-b border-[#30363D] bg-[#161B22] text-[11px] font-semibold text-[#8B949E]">
                    <div className="py-2.5 pl-5 pr-2" aria-label="展开" />
                    <div className="py-2.5 px-3">流水线 / 分支</div>
                    <div className="py-2.5 px-3">类型</div>
                    <div className="py-2.5 px-3">状态</div>
                    <div className="py-2.5 px-3">通过 / 失败 / 跳过</div>
                    <div className="py-2.5 px-3">通过率</div>
                    <div className="py-2.5 px-3">耗时</div>
                    <div className="py-2.5 pl-3 pr-5 text-right">执行时间</div>
                  </div>
                  <div className="divide-y divide-[#21262D] text-[12px]">
                    {data.testReports.map((report) => {
                      const expanded = expandedReportId === report.id;
                      const statusColor =
                        report.status === 'passed'
                          ? 'text-[#3FB950]'
                          : report.status === 'partial'
                            ? 'text-[#D29922]'
                            : report.status === 'failed'
                              ? 'text-[#F85149]'
                              : 'text-[#8B949E]';
                      const statusLabel =
                        report.status === 'passed'
                          ? '全部通过'
                          : report.status === 'partial'
                            ? '部分通过'
                            : report.status === 'failed'
                              ? '执行失败'
                              : '已跳过';

                      const isHighlighted = highlightedReportId === report.id;
                      return (
                        <div
                          key={report.id}
                          id={`test-report-${report.id}`}
                          className={
                            isHighlighted
                              ? 'bg-[#1F6FEB]/15 ring-1 ring-inset ring-[#58A6FF]/70 transition-colors'
                              : undefined
                          }
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedReportId(expanded ? null : report.id)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setExpandedReportId(expanded ? null : report.id);
                              }
                            }}
                            className="grid grid-cols-[2rem_minmax(240px,2fr)_116px_88px_132px_76px_82px_124px] items-center hover:bg-[#161B22]/80 cursor-pointer transition-colors"
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
                                {report.workflowName}
                                {report.actionsRunId && (
                                  <span className="ml-1.5 font-mono text-[11px] text-[#8B949E]">
                                    #{report.actionsRunId}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-[#8B949E] truncate">
                                {report.branch}
                              </div>
                            </div>
                            <div className="py-3 px-3 font-mono text-[11px] text-[#C9D1D9] whitespace-nowrap">
                              {REPORT_KIND_LABELS[report.kind]}
                            </div>
                            <div className={`py-3 px-3 font-medium whitespace-nowrap ${statusColor}`}>
                              {statusLabel}
                            </div>
                            <div className="py-3 px-3 font-mono tabular-nums whitespace-nowrap">
                              <span className="text-[#3FB950]">{report.passed}</span>
                              <span className="text-[#6E7681]"> / </span>
                              <span className="text-[#F85149]">{report.failed}</span>
                              <span className="text-[#6E7681]"> / </span>
                              <span className="text-[#D29922]">{report.skipped}</span>
                            </div>
                            <div className="py-3 px-3 font-mono tabular-nums text-[#F0F6FC] whitespace-nowrap">
                              {report.passRate !== null ? `${report.passRate}%` : '—'}
                            </div>
                            <div className="py-3 px-3 font-mono tabular-nums text-[#8B949E] whitespace-nowrap">
                              {formatDuration(report.durationMs)}
                            </div>
                            <div className="py-3 pl-3 pr-5 text-right font-mono tabular-nums text-[11px] text-[#8B949E] whitespace-nowrap">
                              {formatDateTime(report.executedAt)}
                            </div>
                          </div>

                          {expanded && (
                            <div className="px-5 pb-4 pt-2 bg-[#010409] border-t border-[#21262D] space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                                <span className="text-[#C9D1D9]">{report.summary}</span>
                                {report.actionsUrl && (
                                  <a
                                    href={report.actionsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[#58A6FF] hover:underline font-mono text-[11px]"
                                  >
                                    <span>在 GitHub Actions 查看完整日志</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>

                              {report.cases.length > 0 && (
                                <div className="rounded-md border border-[#30363D] divide-y divide-[#21262D] bg-[#0D1117]">
                                  {report.cases.map((tc) => (
                                    <div
                                      key={tc.id}
                                      className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-[12px]"
                                    >
                                      <div className="flex items-start gap-2 min-w-0">
                                        {tc.status === 'passed' ? (
                                          <CheckCircle2 className="h-3.5 w-3.5 text-[#3FB950] shrink-0 mt-0.5" />
                                        ) : tc.status === 'failed' ? (
                                          <XCircle className="h-3.5 w-3.5 text-[#F85149] shrink-0 mt-0.5" />
                                        ) : (
                                          <AlertCircle className="h-3.5 w-3.5 text-[#D29922] shrink-0 mt-0.5" />
                                        )}
                                        <div className="min-w-0">
                                          <div className="text-[#F0F6FC] font-mono text-[12px] break-all">
                                            {tc.title}
                                          </div>
                                          {tc.error && (
                                            <div className="mt-1 text-[11px] font-mono text-[#FFDCD7] whitespace-pre-wrap break-all">
                                              {tc.error}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <span className="font-mono text-[11px] text-[#8B949E] tabular-nums shrink-0">
                                        {tc.durationMs > 0 ? formatDuration(tc.durationMs) : tc.status}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
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

        {/* TAB 2: Failure Incidents & RSI Attribution Stream */}
        {activeTab === 'incidents' && (
          <div className="divide-y divide-[#21262D] bg-[#0D1117]">
            {!data || data.incidents.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-2">
                <div className="text-[14px] font-medium text-[#F0F6FC]">
                  暂无待归因或已归因的异常事件
                </div>
                <p className="text-[12px] text-[#8B949E]">
                  当测试失败、环境报错、部署异常或人工验收退回发生时，事件将自动进入此列表并触发 RSI 自进化评估。
                </p>
              </div>
            ) : (
              data.incidents.map((inc) => {
                const isBusy =
                  analyzingIncidentId === inc.id || inc.analysisStatus === 'analyzing';
                const attr = inc.attribution;

                return (
                  <div key={inc.id} className="p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                          <span className="font-mono text-[11px] text-[#58A6FF]">
                            [{SOURCE_LABELS[inc.source]}]
                          </span>
                          <span className="font-semibold text-[14px] text-[#F0F6FC]">
                            {inc.title}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#8B949E] tabular-nums">
                          <span>{inc.branch || 'main'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatDateTime(inc.occurredAt)}</span>
                          {inc.relatedActionsUrl && (
                            <>
                              <span aria-hidden="true">·</span>
                              <a
                                href={inc.relatedActionsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#58A6FF] hover:underline inline-flex items-center gap-1"
                              >
                                <span>Actions 日志</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleAnalyzeIncident(inc.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#58A6FF]" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {isBusy
                              ? 'AI 归因中…'
                              : inc.analysisStatus === 'analyzed'
                                ? '重新归因'
                                : '立即 AI 归因'}
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="text-[12px] text-[#C9D1D9] bg-[#161B22] border border-[#30363D] rounded-md px-3.5 py-2.5 font-mono break-all">
                      {inc.errorSummary}
                    </div>

                    {inc.analysisStatus === 'error' && inc.analysisError && (
                      <div className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-3.5 py-2 text-[12px] text-[#FFDCD7]">
                        归因分析异常：{inc.analysisError}
                      </div>
                    )}

                    {attr && (
                      <div
                        className={`rounded-md border px-4 py-3 space-y-2 text-[12px] ${
                          attr.shouldCodifyAsRule
                            ? 'border-[#3FB950]/40 bg-[#2EA043]/10'
                            : 'border-[#30363D] bg-[#161B22]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 font-medium">
                            {attr.shouldCodifyAsRule ? (
                              <span
                                className={`inline-flex items-center gap-1.5 ${
                                  attr.appliedOutcome === 'candidate_created'
                                    ? 'text-[#D29922]'
                                    : 'text-[#3FB950]'
                                }`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>
                                  {attr.appliedOutcome === 'merged' || attr.mergedIntoRuleId
                                    ? '已语义合并强化现有 RSI 规则'
                                    : attr.appliedOutcome === 'candidate_created'
                                      ? '已写入待观察候选池（复发 ≥2 次自动转正）'
                                      : '已沉淀为生效中 RSI System Prompt 规则'}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[#8B949E]">
                                <AlertCircle className="h-3.5 w-3.5 text-[#D29922]" />
                                <span>判定为偶发/一次性特例，拒绝写入 System Prompt</span>
                              </span>
                            )}
                            <span aria-hidden="true" className="text-[#6E7681]">·</span>
                            <span className="text-[#C9D1D9]">
                              根因：{ROOT_CAUSE_LABELS[attr.rootCauseCategory]}
                            </span>
                          </div>

                          <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                            置信度 {Math.round(attr.confidence * 100)}% · {attr.model}
                          </span>
                        </div>

                        {attr.decisionGate && (
                          <div className="rounded border border-[#30363D] bg-[#0D1117] px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] tabular-nums">
                            <span className="inline-flex items-center gap-1.5 text-[#58A6FF] font-semibold">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              <span>{attr.decisionGate.model} 门控校准</span>
                            </span>
                            <span className="text-[#C9D1D9]">
                              通用性{' '}
                              <strong
                                className={
                                  attr.decisionGate.generalizableProb >= 0.65
                                    ? 'text-[#3FB950]'
                                    : 'text-[#D29922]'
                                }
                              >
                                {Math.round(attr.decisionGate.generalizableProb * 100)}%
                              </strong>
                            </span>
                            <span className="text-[#C9D1D9]">
                              重复度{' '}
                              <strong
                                className={
                                  attr.decisionGate.duplicateProb >= 0.65
                                    ? 'text-[#58A6FF]'
                                    : 'text-[#8B949E]'
                                }
                              >
                                {Math.round(attr.decisionGate.duplicateProb * 100)}%
                              </strong>
                            </span>
                            <span className="text-[#C9D1D9]">
                              泛化评分{' '}
                              <strong className="text-[#F0F6FC]">
                                {attr.decisionGate.generalityScore.toFixed(2)}/3.0
                              </strong>
                            </span>
                            <span className={DECISION_ACTION_LABELS[attr.decisionGate.chosenAction].color}>
                              决策：{DECISION_ACTION_LABELS[attr.decisionGate.chosenAction].label}
                            </span>
                          </div>
                        )}

                        <p className="text-[#F0F6FC] leading-relaxed">
                          <span className="text-[#8B949E]">根因诊断：</span>
                          {attr.rootCauseSummary}
                        </p>
                        <p className="text-[#C9D1D9] leading-relaxed">
                          <span className="text-[#8B949E]">沉淀判断依据：</span>
                          {attr.decisionRationale}
                        </p>

                        {attr.shouldCodifyAsRule && attr.suggestedRule && (
                          <div className="mt-2 rounded border border-[#30363D] bg-[#0D1117] px-3 py-2 space-y-1">
                            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                              <span className="text-[#3FB950] font-semibold">
                                [{attr.suggestedRule.severity.toUpperCase()}]
                              </span>
                              <span className="text-[#58A6FF]">
                                {TARGET_STAGE_LABELS[attr.suggestedRule.targetStage]}
                              </span>
                              <span className="text-[#F0F6FC] font-sans font-medium">
                                {attr.suggestedRule.title}
                              </span>
                            </div>
                            <div className="text-[12px] text-[#C9D1D9] leading-relaxed">
                              {attr.suggestedRule.promptDirective}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 3: RSI System Prompt Rules Library & Live Injection Preview */}
        {activeTab === 'rules' && (
          <div className="bg-[#0D1117] p-5 space-y-5">
            {/* RSI Anti-Bloat Prompt Budget Guardrail Strip */}
            {data?.budget && (
              <div className="rounded-md border border-[#30363D] bg-[#161B22] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[12px]">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] tabular-nums">
                  <span className="font-sans font-semibold text-[#F0F6FC] inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#3FB950]" />
                    <span>防膨胀硬预算护栏</span>
                  </span>
                  <span className="text-[#C9D1D9]">
                    生效池{' '}
                    <strong
                      className={
                        data.budget.activeRulesCount >= data.budget.activePoolLimit - 2
                          ? 'text-[#D29922]'
                          : 'text-[#3FB950]'
                      }
                    >
                      {data.budget.activeRulesCount}/{data.budget.activePoolLimit}
                    </strong>
                  </span>
                  <span className="text-[#C9D1D9]">
                    编码注入{' '}
                    <strong className="text-[#58A6FF]">
                      {data.budget.codingInjectedRules}/{data.budget.codingRulesLimit} 条
                    </strong>{' '}
                    · {data.budget.codingCharsUsed}/{data.budget.codingCharsLimit} 字符
                  </span>
                  <span className="text-[#8B949E]">
                    单条 ≤ {RSI_BUDGET_LIMITS.maxDirectiveChars} 字 · {RSI_BUDGET_LIMITS.staleArchiveDays} 天未命中自动归档
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                  待观察 {data.budget.candidateRulesCount} · 已归档 {data.budget.archivedRulesCount}
                </span>
              </div>
            )}

            {/* Live System Prompt Injection Preview */}
            {showPromptPreview && (
              <div className="rounded-md border border-[#58A6FF]/40 bg-[#010409] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#30363D] bg-[#161B22] flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#F0F6FC]">
                    实时 System Prompt 注入预览（下一次需求规划/编码将自动携带）
                  </span>
                  <div className="inline-flex items-center gap-1 rounded border border-[#30363D] bg-[#0D1117] p-0.5">
                    {(
                      [
                        { id: 'architect', label: 'Architect' },
                        { id: 'qa_spec', label: 'QA Spec' },
                        { id: 'qa_critic', label: 'QA Critic' },
                        { id: 'coding', label: 'VPS AGY 编码' },
                      ] as const
                    ).map((s) => {
                      const stageCount = (data?.rules ?? []).filter(
                        (r) =>
                          r.status === 'active' &&
                          (r.targetStage === 'all' || r.targetStage === s.id)
                      ).length;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setPreviewStage(s.id)}
                          className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors tabular-nums ${
                            previewStage === s.id
                              ? 'bg-[#21262D] text-[#F0F6FC]'
                              : 'text-[#8B949E] hover:text-[#C9D1D9]'
                          }`}
                        >
                          {s.label}
                          {stageCount > 0 ? ` (${stageCount})` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <pre className="p-4 text-[12px] font-mono text-[#C9D1D9] whitespace-pre-wrap leading-relaxed max-h-[260px] overflow-y-auto">
                  {activePromptText || '当前该阶段暂无生效中的 RSI 规则（系统将使用基础 System Prompt）。'}
                </pre>
              </div>
            )}

            {/* Inline New Rule Form */}
            {showNewRuleForm && (
              <form
                onSubmit={handleCreateManualRule}
                className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-3"
              >
                <div className="text-[13px] font-semibold text-[#F0F6FC]">
                  新增 RSI System Prompt 强制规则
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2">
                    <label htmlFor="rsi-rule-title" className="block text-[11px] text-[#8B949E] mb-1">
                      规则标题
                    </label>
                    <input
                      id="rsi-rule-title"
                      type="text"
                      value={newRuleTitle}
                      onChange={(e) => setNewRuleTitle(e.target.value)}
                      placeholder="例如：所有 D1 SQL 迁移必须使用 IF NOT EXISTS"
                      className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="rsi-rule-stage" className="block text-[11px] text-[#8B949E] mb-1">
                      生效阶段
                    </label>
                    <select
                      id="rsi-rule-stage"
                      value={newRuleStage}
                      onChange={(e) => setNewRuleStage(e.target.value as RsiTargetStage)}
                      className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-2.5 py-1.5 text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                    >
                      <option value="all">全链路通用</option>
                      <option value="architect">Architect 架构规划</option>
                      <option value="qa_spec">QA Spec 测试规格</option>
                      <option value="qa_critic">QA Critic 边界评审</option>
                      <option value="coding">VPS AGY 编码实现</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="rsi-rule-severity" className="block text-[11px] text-[#8B949E] mb-1">
                      优先级与分类
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        id="rsi-rule-severity"
                        value={newRuleSeverity}
                        onChange={(e) => setNewRuleSeverity(e.target.value as RsiRuleSeverity)}
                        className="rounded-md border border-[#30363D] bg-[#0D1117] px-2 py-1.5 text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                      >
                        <option value="critical">Critical</option>
                        <option value="recommended">Recommended</option>
                      </select>
                      <select
                        aria-label="根因分类"
                        value={newRuleCategory}
                        onChange={(e) => setNewRuleCategory(e.target.value as RsiRootCauseCategory)}
                        className="rounded-md border border-[#30363D] bg-[#0D1117] px-2 py-1.5 text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                      >
                        {(Object.keys(ROOT_CAUSE_LABELS) as RsiRootCauseCategory[]).map((cat) => (
                          <option key={cat} value={cat}>
                            {ROOT_CAUSE_LABELS[cat]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div>
                  <label htmlFor="rsi-rule-directive" className="block text-[11px] text-[#8B949E] mb-1">
                    System Prompt 指令正文（建议 ≤ 140 字）
                  </label>
                  <textarea
                    id="rsi-rule-directive"
                    rows={2}
                    value={newRuleDirective}
                    onChange={(e) => setNewRuleDirective(e.target.value)}
                    placeholder="填写将直接注入下游 Agent System Prompt 的具体硬性规范…"
                    className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewRuleForm(false)}
                    className="rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] text-[#C9D1D9] hover:bg-[#30363D]"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={savingRule}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] border border-[#3FB950]/30 px-3.5 py-1.5 text-[12px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-50"
                  >
                    {savingRule && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>保存并立即生效</span>
                  </button>
                </div>
              </form>
            )}

            {/* Stage + Status filter bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="规则生效阶段筛选"
                  className="inline-flex flex-wrap items-center gap-1 rounded-md border border-[#30363D] bg-[#161B22] p-0.5"
                >
                  {(
                    [
                      { id: 'all_filter', label: '全部阶段' },
                      { id: 'all', label: '全链路通用' },
                      { id: 'architect', label: 'Architect' },
                      { id: 'qa_spec', label: 'QA Spec' },
                      { id: 'qa_critic', label: 'QA Critic' },
                      { id: 'coding', label: 'VPS AGY 编码' },
                    ] as const
                  ).map((item) => {
                    const active = ruleStageFilter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setRuleStageFilter(item.id)}
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

                <div
                  role="group"
                  aria-label="规则生命周期状态筛选"
                  className="inline-flex flex-wrap items-center gap-1 rounded-md border border-[#30363D] bg-[#161B22] p-0.5"
                >
                  {(
                    [
                      { id: 'all', label: '全部状态' },
                      { id: 'active', label: '生效中' },
                      { id: 'candidate', label: '待观察' },
                      { id: 'paused', label: '已暂停' },
                      { id: 'archived', label: '已归档' },
                    ] as const
                  ).map((item) => {
                    const active = ruleStatusFilter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setRuleStatusFilter(item.id)}
                        className={`rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
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
              <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                显示 {filteredRules.length} 条规则
              </span>
            </div>

            {/* Rules List */}
            {filteredRules.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#30363D] py-10 px-6 text-center text-[12px] text-[#8B949E]">
                当前筛选条件下暂无 RSI System Prompt 规则。点击「同步测试与自动归因」或「新增规则」即可沉淀。
              </div>
            ) : (
              <div className="rounded-md border border-[#30363D] divide-y divide-[#21262D] bg-[#161B22]">
                {filteredRules.map((rule) => {
                  const isBusy = busyRuleId === rule.id;
                  const isActive = rule.status === 'active';
                  const isCandidate = rule.status === 'candidate';
                  const statusMeta = RULE_STATUS_META[rule.status] ?? RULE_STATUS_META.paused;
                  return (
                    <div
                      key={rule.id}
                      className={`p-4 space-y-2 ${isActive || isCandidate ? '' : 'opacity-65'}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-[13px]">
                            <span
                              className={`font-mono text-[11px] font-semibold ${
                                rule.severity === 'critical'
                                  ? 'text-[#F85149]'
                                  : 'text-[#58A6FF]'
                              }`}
                            >
                              [{rule.severity === 'critical' ? 'CRITICAL' : 'REC'}]
                            </span>
                            <span className="font-semibold text-[#F0F6FC]">{rule.title}</span>
                            <span className="font-mono text-[11px] text-[#8B949E]">
                              · {TARGET_STAGE_LABELS[rule.targetStage]}
                            </span>
                            <span className="font-mono text-[11px] text-[#8B949E]">
                              · {ROOT_CAUSE_LABELS[rule.rootCauseCategory]}
                            </span>
                          </div>
                          <p className="text-[12px] text-[#C9D1D9] leading-relaxed">
                            {rule.promptDirective}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-[#8B949E]">
                            <span className={statusMeta.color}>状态：{statusMeta.label}</span>
                            <span aria-hidden="true">·</span>
                            <span>触发归因 {rule.hitCount} 次</span>
                            <span aria-hidden="true">·</span>
                            <span>已注入下游 {rule.appliedCount} 次</span>
                            <span aria-hidden="true">·</span>
                            <span>{rule.promptDirective.length} 字</span>
                            <span aria-hidden="true">·</span>
                            <span>更新于 {formatDateTime(rule.updatedAt)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isCandidate ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleUpdateRuleStatus(rule, 'active')}
                              className="inline-flex items-center gap-1 rounded-md border border-[#3FB950]/40 bg-[#238636]/20 px-2.5 py-1 text-[11px] font-medium text-[#3FB950] hover:bg-[#238636]/30 disabled:opacity-50 whitespace-nowrap"
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5" />
                              <span>转正生效</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                handleUpdateRuleStatus(rule, isActive ? 'paused' : 'active')
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-[#30363D] bg-[#21262D] px-2.5 py-1 text-[11px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 whitespace-nowrap"
                            >
                              {isActive ? (
                                <>
                                  <PauseCircle className="h-3.5 w-3.5 text-[#D29922]" />
                                  <span>暂停</span>
                                </>
                              ) : (
                                <>
                                  <PlayCircle className="h-3.5 w-3.5 text-[#3FB950]" />
                                  <span>启用</span>
                                </>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDeleteRule(rule)}
                            aria-label={`删除规则 ${rule.title}`}
                            className="inline-flex items-center justify-center rounded-md border border-[#30363D] bg-[#21262D] p-1.5 text-[#8B949E] hover:text-[#F85149] hover:border-[#F85149]/40 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
