import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitPullRequest,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
} from 'lucide-react';
import type {
  AgentStepState,
  AmbiguitySeverity,
  AnalysisJob,
  CriticFindingCategory,
  PipelineRun,
  SelectedTargetRepo,
  SingleTaskLockStatus,
} from '../types/autodev';
import type { PrdDraftState } from '../App';
import { buildTaskLayers, validatePrdInput } from '../lib/taskGraph';
import { buildPrArtifacts } from '../lib/specBuilder';
import { hasPrdDraftContent, savePrdDraft } from '../lib/prdDraftStorage';
import { AGY_AVAILABLE_MODELS } from '../lib/workflowBuilder';
import { TestDiffViewer } from './TestDiffViewer';

interface PrdWorkspaceViewProps {
  selectedRepo: SelectedTargetRepo | null;
  activeRun: PipelineRun | null;
  analysisJob: AnalysisJob | null;
  prdDraft: PrdDraftState;
  draftSavedAt: string | null;
  onDraftSavedAtChange: (savedAt: string | null) => void;
  onChangePrdDraft: (patch: Partial<PrdDraftState>) => void;
  onResetWorkspace: () => void;
  onJobStarted: (job: AnalysisJob) => void;
  onRunUpdated: (run: PipelineRun) => void;
  onGoToEnvironment: () => void;
  onGoToPipeline: () => void;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

type ResultTab = 'ambiguities' | 'architecture' | 'testing' | 'artifacts';

const DEFAULT_STEPS: AgentStepState[] = [
  {
    id: 'architect',
    label: '01. Architect Agent',
    roleTitle: 'PRD 漏洞审查 · 架构设计 · 任务树',
    status: 'idle',
  },
  {
    id: 'qa_spec',
    label: '02. QA Spec Agent',
    roleTitle: '接口测试清单 · Playwright 初版',
    status: 'idle',
  },
  {
    id: 'qa_critic',
    label: '03. QA Critic Agent',
    roleTitle: '边界异常评审 · 终版只读测试集',
    status: 'idle',
  },
];

const SEVERITY_LABELS: Record<AmbiguitySeverity, { text: string; className: string }> = {
  high: { text: '高风险', className: 'text-[#F85149]' },
  medium: { text: '中风险', className: 'text-[#D29922]' },
  low: { text: '低风险', className: 'text-[#8B949E]' },
};

const CATEGORY_LABELS: Record<CriticFindingCategory, string> = {
  boundary: '边界条件',
  invalid_input: '异常输入',
  ui_interaction: 'UI 交互',
  security: '安全校验',
  concurrency: '并发竞态',
};

export function PrdWorkspaceView({
  selectedRepo,
  activeRun,
  analysisJob,
  prdDraft,
  draftSavedAt,
  onDraftSavedAtChange,
  onChangePrdDraft,
  onResetWorkspace,
  onJobStarted,
  onRunUpdated,
  onGoToEnvironment,
  onGoToPipeline,
  onErrorToast,
  onSuccessToast,
}: PrdWorkspaceViewProps) {
  const [fieldErrors, setFieldErrors] = useState<{
    repoFullName?: string;
    prdTitle?: string;
    prdContent?: string;
  }>({});

  const [startingJob, setStartingJob] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>('ambiguities');
  const [creatingPr, setCreatingPr] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [copiedArtifact, setCopiedArtifact] = useState<string | null>(null);
  const prFeedbackRef = useRef<HTMLDivElement | null>(null);

  const [lockStatus, setLockStatus] = useState<SingleTaskLockStatus | null>(null);
  const [lockLoading, setLockLoading] = useState(false);
  const [forceOverride, setForceOverride] = useState(false);
  const [agyModel, setAgyModel] = useState<string>(AGY_AVAILABLE_MODELS[0].id);
  const [cancellingJob, setCancellingJob] = useState(false);

  const fetchIterationLock = useCallback(async (repoFullName: string, branch: string) => {
    setLockLoading(true);
    try {
      const res = await fetch(
        `/api/github/iteration-lock?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(branch)}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as SingleTaskLockStatus;
      setLockStatus(data);
      if (!data.locked) {
        setForceOverride(false);
      }
    } catch {
      // Ignore transient telemetry fetch error
    } finally {
      setLockLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRepo?.fullName) return;
    fetchIterationLock(selectedRepo.fullName, selectedRepo.defaultBranch || 'main');
  }, [
    selectedRepo?.fullName,
    selectedRepo?.defaultBranch,
    analysisJob?.status,
    activeRun?.draftPr?.prNumber,
    fetchIterationLock,
  ]);

  const repoNameForDraft = selectedRepo?.fullName ?? '';
  const latestDraftRef = useRef({
    repoFullName: repoNameForDraft,
    prdTitle: prdDraft.prdTitle,
    techStackHint: prdDraft.techStackHint,
    prdContent: prdDraft.prdContent,
  });
  latestDraftRef.current = {
    repoFullName: repoNameForDraft,
    prdTitle: prdDraft.prdTitle,
    techStackHint: prdDraft.techStackHint,
    prdContent: prdDraft.prdContent,
  };
  const lastSavedHashRef = useRef<string>('');

  // Debounced auto-save on user input
  useEffect(() => {
    const payload = {
      repoFullName: repoNameForDraft,
      prdTitle: prdDraft.prdTitle,
      techStackHint: prdDraft.techStackHint,
      prdContent: prdDraft.prdContent,
    };

    if (!hasPrdDraftContent(payload)) {
      return;
    }

    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedHashRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      const saved = savePrdDraft(payload);
      if (saved) {
        lastSavedHashRef.current = serialized;
        onDraftSavedAtChange(saved.savedAt);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    repoNameForDraft,
    prdDraft.prdTitle,
    prdDraft.techStackHint,
    prdDraft.prdContent,
    onDraftSavedAtChange,
  ]);

  // Periodic backup interval (every 5s) + beforeunload / unmount flush
  useEffect(() => {
    const flushBackup = (forceTimestamp = false) => {
      const current = latestDraftRef.current;
      if (!hasPrdDraftContent(current)) return;
      const serialized = JSON.stringify(current);
      if (!forceTimestamp && serialized === lastSavedHashRef.current) return;
      const saved = savePrdDraft(current);
      if (saved) {
        lastSavedHashRef.current = serialized;
        onDraftSavedAtChange(saved.savedAt);
      }
    };

    const interval = setInterval(() => {
      flushBackup(false);
    }, 5000);

    const handleBeforeUnload = () => {
      flushBackup(true);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushBackup(false);
    };
  }, [onDraftSavedAtChange]);

  const isAnalyzing = startingJob || analysisJob?.status === 'running';
  const steps = analysisJob?.steps ?? DEFAULT_STEPS;
  const jobError = analysisJob?.status === 'error' ? analysisJob.error || '推理执行失败' : null;

  // Progressive outputs directly from server-side job (survives tab switches) or activeRun
  const architectData = analysisJob?.architect ?? activeRun?.architect ?? null;
  const qaSpecData = analysisJob?.qaSpec ?? activeRun?.qaSpec ?? null;
  const qaCriticData = analysisJob?.qaCritic ?? activeRun?.qaCritic ?? null;

  const taskGraph = useMemo(
    () => (architectData ? buildTaskLayers(architectData.tasks) : null),
    [architectData]
  );

  const prArtifacts = useMemo(
    () => (activeRun ? buildPrArtifacts(activeRun) : null),
    [activeRun]
  );

  const handleStartAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePrdInput({
      repoFullName: selectedRepo?.fullName ?? '',
      prdTitle: prdDraft.prdTitle,
      prdContent: prdDraft.prdContent,
    });

    if (!validation.valid) {
      setFieldErrors(validation.errors);
      const firstErr =
        validation.errors.prdTitle ||
        validation.errors.prdContent ||
        validation.errors.repoFullName ||
        '请补充完整的标题与 PRD 需求内容';
      onErrorToast(firstErr, '表单校验未通过');
      return;
    }

    setFieldErrors({});
    setPrError(null);
    setStartingJob(true);

    try {
      const response = await fetch('/api/agents/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: selectedRepo!.fullName,
          defaultBranch: selectedRepo!.defaultBranch,
          prdTitle: prdDraft.prdTitle.trim(),
          prdContent: prdDraft.prdContent.trim(),
          techStackHint: prdDraft.techStackHint.trim() || undefined,
          agyModel,
          forceOverride,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.fieldErrors) {
          setFieldErrors(data.fieldErrors);
        }
        if (data.lockStatus) {
          setLockStatus(data.lockStatus as SingleTaskLockStatus);
        }
        throw new Error(data.error || `启动分析任务失败 (${response.status})`);
      }

      if (data.job) {
        onJobStarted(data.job as AnalysisJob);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '启动服务端分析任务失败';
      onErrorToast(msg, '无法启动分析');
    } finally {
      setStartingJob(false);
    }
  };

  const handleCancelJob = async () => {
    if (!analysisJob || analysisJob.status !== 'running') return;
    setCancellingJob(true);
    try {
      const res = await fetch(`/api/agents/jobs/${encodeURIComponent(analysisJob.id)}/cancel`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `取消失败 (${res.status})`);
      }
      if (data.job) {
        onJobStarted(data.job as AnalysisJob);
      }
      onSuccessToast('已取消当前规划任务', '任务已停止');
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : '取消规划任务失败', '取消失败');
    } finally {
      setCancellingJob(false);
    }
  };

  const handleCreateDraftPr = async () => {
    if (!activeRun) {
      const msg = '请等待 3 个智能体全部执行完成后再创建 Draft PR。';
      setPrError(msg);
      onErrorToast(msg, '无法创建 Draft PR');
      return;
    }
    setCreatingPr(true);
    setPrError(null);

    try {
      const response = await fetch('/api/github/create-draft-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: activeRun.id,
          runPayload: activeRun,
          baseBranch: selectedRepo?.defaultBranch || activeRun.defaultBranch,
          forceOverride,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.lockStatus) {
          setLockStatus(data.lockStatus as SingleTaskLockStatus);
        }
        throw new Error(data.error || `创建 GitHub Draft PR 失败 (${response.status})`);
      }

      if (data.run) {
        onRunUpdated(data.run);
      }
      onSuccessToast(
        `Draft PR #${data.draftPr?.prNumber ?? ''} 已推送至 ${selectedRepo?.fullName}`,
        'Draft PR 创建成功'
      );
      setTimeout(() => {
        prFeedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建 Draft PR 失败';
      setPrError(msg);
      onErrorToast(msg, 'Draft PR 创建失败');
      setTimeout(() => {
        prFeedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    } finally {
      setCreatingPr(false);
    }
  };

  const handleCopyArtifact = async (key: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedArtifact(key);
      setTimeout(() => setCopiedArtifact(null), 1800);
    } catch {
      onErrorToast('当前浏览器环境不支持剪贴板写入', '复制失败');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC] text-balance">
            新建需求 (PRD)
          </h1>
          <p className="mt-1 text-[13px] text-[#8B949E]">
            三阶段架构拆解与测试左移评审在 Instabox AGY 上基于最新代码执行，切换标签页不会中断进度。
          </p>
        </div>

        {(analysisJob || activeRun || prdDraft.prdTitle || prdDraft.prdContent) && !isAnalyzing && (
          <button
            type="button"
            onClick={() => {
              setFieldErrors({});
              setPrError(null);
              onResetWorkspace();
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建空白需求</span>
          </button>
        )}
      </div>

      {/* PRD Input Form */}
      <section
        aria-label="PRD 输入表单"
        className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-5"
      >
        {/* Target Repo Bar & Live Main Context */}
        <div className="space-y-3 pb-4 border-b border-[#30363D]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 text-[13px]">
              <GitBranch className="h-4 w-4 text-[#58A6FF] shrink-0" />
              <span className="text-[#8B949E] shrink-0">目标仓库</span>
              {selectedRepo ? (
                <span className="font-mono font-medium text-[#F0F6FC] truncate">
                  {selectedRepo.fullName}{' '}
                  <span className="text-[#8B949E]">({selectedRepo.defaultBranch})</span>
                </span>
              ) : (
                <span className="text-[#D29922]">尚未选定</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {selectedRepo && (
                <button
                  type="button"
                  disabled={lockLoading}
                  onClick={() =>
                    fetchIterationLock(selectedRepo.fullName, selectedRepo.defaultBranch || 'main')
                  }
                  className="inline-flex items-center gap-1 text-[12px] text-[#8B949E] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`h-3 w-3 ${lockLoading ? 'animate-spin' : ''}`} />
                  <span>刷新基线</span>
                </button>
              )}
              <button
                type="button"
                onClick={onGoToEnvironment}
                className="text-[12px] font-medium text-[#58A6FF] hover:underline transition-colors whitespace-nowrap"
              >
                查看 Runner 状态
              </button>
            </div>
          </div>

          {lockStatus?.repoContext && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-mono text-[#8B949E]">
              <span className="inline-flex items-center gap-1.5 text-[#C9D1D9]">
                <Database className="h-3.5 w-3.5 text-[#3FB950]" />
                {lockStatus.repoContext.isEmptyRepo
                  ? '空仓库 · 首次构建'
                  : `${lockStatus.repoContext.branch}@${lockStatus.repoContext.headSha.slice(0, 7)}`}
              </span>
              {!lockStatus.repoContext.isEmptyRepo && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{lockStatus.repoContext.totalFiles} 文件</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {lockStatus.repoContext.existingMigrations.length} 个 D1 迁移
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {lockStatus.repoContext.existingE2eTests.length} 个回归测试
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className={lockStatus.locked ? 'text-[#D29922]' : 'text-[#3FB950]'}>
                {lockStatus.locked ? '单任务串行门禁：占用中' : '单任务串行门禁：空闲'}
              </span>
            </div>
          )}

          {lockStatus?.locked && (
            <div
              role="status"
              className="rounded-md border border-[#D29922]/40 bg-[#D29922]/10 px-3.5 py-3 space-y-2 text-[12px]"
            >
              <div className="flex items-center gap-2 font-medium text-[#F0F6FC]">
                <Lock className="h-3.5 w-3.5 text-[#D29922] shrink-0" />
                <span>单任务串行保护已激活（当前最多允许 1 个活跃迭代）</span>
              </div>
              <ul className="space-y-1.5 text-[#C9D1D9]">
                {lockStatus.reasons.map((reason, idx) => (
                  <li key={`${reason.kind}-${idx}`} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[#D29922] font-medium">• {reason.title}</span>
                    <span className="text-[#8B949E]">— {reason.detail}</span>
                    {reason.url && (
                      <a
                        href={reason.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[#58A6FF] hover:underline"
                      >
                        <span>查看</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <label className="inline-flex items-center gap-2 pt-1 text-[12px] text-[#C9D1D9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceOverride}
                  onChange={(e) => setForceOverride(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-[#D29922]"
                />
                <span>我确认忽略串行门禁，强制基于当前基线发起新任务</span>
              </label>
            </div>
          )}
        </div>
        {fieldErrors.repoFullName && (
          <p role="alert" className="text-[12px] text-[#F85149] -mt-2">
            {fieldErrors.repoFullName}
          </p>
        )}

        <form onSubmit={handleStartAnalysis} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <label
                htmlFor="prd-title-input"
                className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
              >
                需求标题
              </label>
              <input
                id="prd-title-input"
                type="text"
                value={prdDraft.prdTitle}
                onChange={(e) => {
                  onChangePrdDraft({ prdTitle: e.target.value });
                  if (fieldErrors.prdTitle) {
                    setFieldErrors((prev) => ({ ...prev, prdTitle: undefined }));
                  }
                }}
                disabled={isAnalyzing}
                placeholder="例如：多租户 Webhook 签名校验与死信队列重试"
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-2 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none disabled:opacity-60"
              />
              {fieldErrors.prdTitle && (
                <p role="alert" className="mt-1.5 text-[12px] text-[#F85149]">
                  {fieldErrors.prdTitle}
                </p>
              )}
            </div>

            <div className="md:col-span-4">
              <label
                htmlFor="prd-stack-input"
                className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
              >
                技术栈覆盖（可选）
              </label>
              <input
                id="prd-stack-input"
                type="text"
                value={prdDraft.techStackHint}
                onChange={(e) => onChangePrdDraft({ techStackHint: e.target.value })}
                disabled={isAnalyzing}
                placeholder="默认 Cloudflare Workers + D1 + KV + React"
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-2 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none disabled:opacity-60"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="prd-agy-model-select"
                className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
              >
                规划模型 (Instabox AGY)
              </label>
              <select
                id="prd-agy-model-select"
                value={agyModel}
                onChange={(e) => setAgyModel(e.target.value)}
                disabled={isAnalyzing}
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none disabled:opacity-60"
              >
                {AGY_AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="prd-content-textarea"
                className="block text-[12px] font-medium text-[#F0F6FC]"
              >
                PRD 需求正文 (Markdown)
              </label>
              <span className="text-[11px] font-mono tabular-nums text-[#8B949E]">
                {prdDraft.prdContent.trim().length} 字符
              </span>
            </div>
            <textarea
              id="prd-content-textarea"
              rows={7}
              value={prdDraft.prdContent}
              onChange={(e) => {
                onChangePrdDraft({ prdContent: e.target.value });
                if (fieldErrors.prdContent) {
                  setFieldErrors((prev) => ({ ...prev, prdContent: undefined }));
                }
              }}
              disabled={isAnalyzing}
              placeholder="描述业务背景、核心用户流程、权限规则、异常处理与边界约束…"
              className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none disabled:opacity-60 font-sans"
            />
            {fieldErrors.prdContent && (
              <p role="alert" className="mt-1.5 text-[12px] text-[#F85149]">
                {fieldErrors.prdContent}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-[12px] font-mono tabular-nums text-[#8B949E]">
              {draftSavedAt
                ? `草稿已自动备份 · ${new Date(draftSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                : hasPrdDraftContent(prdDraft)
                  ? '等待本地备份…'
                  : ''}
            </div>
            <button
              type="submit"
              disabled={isAnalyzing || Boolean(lockStatus?.locked && !forceOverride)}
              className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>服务端分析中…</span>
                </>
              ) : lockStatus?.locked && !forceOverride ? (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  <span>已有进行中迭代</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>启动架构分析与用例评审</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Real-time 3-Agent Progress Stepper */}
      {(isAnalyzing || steps.some((s) => s.status !== 'idle') || activeRun) && (
        <section aria-label="多智能体执行进度" className="space-y-3">
          {analysisJob?.executionMode === 'vps_agy' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#30363D] bg-[#161B22] px-4 py-2.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[#C9D1D9]">
                <Server className="h-3.5 w-3.5 text-[#58A6FF] shrink-0" />
                <span>Instabox VPS AGY 实时代码规划</span>
                {analysisJob.agyModel && (
                  <>
                    <span aria-hidden="true" className="text-[#6E7681]">·</span>
                    <span className="text-[#8B949E]">{analysisJob.agyModel}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                {analysisJob.planActionsUrl && (
                  <a
                    href={analysisJob.planActionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#58A6FF] hover:underline whitespace-nowrap"
                  >
                    <span>查看 Actions</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {analysisJob.status === 'running' && (
                  <button
                    type="button"
                    disabled={cancellingJob}
                    onClick={handleCancelJob}
                    className="inline-flex items-center gap-1 rounded border border-[#F85149]/40 bg-[#F85149]/10 px-2.5 py-1 text-[11px] font-medium text-[#FFDCD7] hover:bg-[#F85149]/20 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Square className="h-3 w-3" />
                    <span>{cancellingJob ? '停止中…' : '停止任务'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((step) => {
            const effectiveStatus =
              step.status === 'idle' &&
              activeRun &&
              !isAnalyzing &&
              (!analysisJob || analysisJob.status === 'completed')
                ? 'completed'
                : step.status;
            return (
              <div
                key={step.id}
                className={`rounded-md border p-4 transition-colors ${
                  effectiveStatus === 'running'
                    ? 'border-[#58A6FF]/60 bg-[#1F6FEB]/10'
                    : effectiveStatus === 'error'
                      ? 'border-[#F85149]/50 bg-[#F85149]/10'
                      : 'border-[#30363D] bg-[#161B22]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#F0F6FC]">
                    {step.label}
                  </span>
                  {effectiveStatus === 'running' && (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#58A6FF] font-medium">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      执行中
                    </span>
                  )}
                  {effectiveStatus === 'completed' && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-[#3FB950] font-medium tabular-nums">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : '完成'}
                    </span>
                  )}
                  {effectiveStatus === 'error' && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-[#F85149] font-medium">
                      <AlertCircle className="h-3.5 w-3.5" />
                      异常
                    </span>
                  )}
                  {effectiveStatus === 'idle' && (
                    <span className="text-[12px] text-[#8B949E]">队列等待</span>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] text-[#8B949E]">{step.roleTitle}</p>
                {step.message && (
                  <p className="mt-2 text-[11px] text-[#C9D1D9] leading-relaxed">
                    {step.message}
                  </p>
                )}
              </div>
            );
          })}
          </div>
        </section>
      )}

      {jobError && (
        <div
          role="alert"
          className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-4 py-3 text-[13px] text-[#FFDCD7] flex items-start gap-2.5"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#F85149]" />
          <div>
            <div className="font-medium text-[#F0F6FC]">多智能体推理中断</div>
            <div className="mt-0.5 text-[12px] text-[#FFDCD7]">{jobError}</div>
          </div>
        </div>
      )}

      {/* Analysis Results Dashboard */}
      {architectData && (
        <section aria-label="架构分析与测试评审结果" className="space-y-6">
          {/* Approval & GitHub Draft PR Action Header */}
          <div className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#F0F6FC]">
                  <span>规格与只读测试集</span>
                  {activeRun && (
                    <span className="font-mono text-[12px] font-normal text-[#58A6FF]">
                      · {activeRun.repoFullName}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8B949E] tabular-nums">
                  <span>歧义提示 {architectData.ambiguities.length} 项</span>
                  <span aria-hidden="true">·</span>
                  <span>接口契约 {architectData.apiContracts.length} 项</span>
                  <span aria-hidden="true">·</span>
                  <span>原子任务 {architectData.tasks.length} 项</span>
                  {qaCriticData && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Critic 加固 {qaCriticData.findings.length} 项</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                {activeRun?.draftPr ? (
                  <>
                    <a
                      href={activeRun.draftPr.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors whitespace-nowrap"
                    >
                      <GitPullRequest className="h-4 w-4" />
                      <span>查看 Draft PR #{activeRun.draftPr.prNumber}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={onGoToPipeline}
                      className="rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-2 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
                    >
                      流水线追踪
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={
                      creatingPr ||
                      isAnalyzing ||
                      !activeRun ||
                      Boolean(lockStatus?.locked && !forceOverride)
                    }
                    onClick={handleCreateDraftPr}
                    className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {creatingPr ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>正在提交 Draft PR…</span>
                      </>
                    ) : isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>等待评审完成…</span>
                      </>
                    ) : lockStatus?.locked && !forceOverride ? (
                      <>
                        <Lock className="h-4 w-4" />
                        <span>等待当前 PR 合入</span>
                      </>
                    ) : (
                      <>
                        <GitPullRequest className="h-4 w-4" />
                        <span>批准方案并创建 GitHub Draft PR</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {prError && (
              <div
                ref={prFeedbackRef}
                role="alert"
                className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-4 py-3 text-[13px] text-[#FFDCD7] flex items-start gap-2.5"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#F85149]" />
                <span>{prError}</span>
              </div>
            )}

            {activeRun?.draftPr && (
              <div
                ref={prFeedbackRef}
                className="rounded-md border border-[#3FB950]/40 bg-[#2EA043]/10 px-4 py-3.5 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#3FB950]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      Draft PR #{activeRun.draftPr.prNumber} 已创建
                    </span>
                  </div>
                  <a
                    href={activeRun.draftPr.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[12px] text-[#58A6FF] hover:underline inline-flex items-center gap-1"
                  >
                    <span>{activeRun.draftPr.prUrl}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#C9D1D9] font-mono">
                  <span>分支: {activeRun.draftPr.branchName}</span>
                  <span>基线: {activeRun.draftPr.baseBranch}</span>
                  <span>Commit: {activeRun.draftPr.commitSha.slice(0, 7)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Result Sub-Navigation Tabs */}
          <div className="border-b border-[#30363D] flex items-center gap-6 overflow-x-auto">
            {(
              [
                {
                  id: 'ambiguities',
                  label: `需求歧义 (${architectData.ambiguities.length})`,
                },
                {
                  id: 'architecture',
                  label: `架构与任务树 (${architectData.tasks.length})`,
                },
                {
                  id: 'testing',
                  label: `测试对比${qaCriticData ? ` (${qaCriticData.findings.length})` : ''}`,
                },
                {
                  id: 'artifacts',
                  label: 'PR 制品预览 (3)',
                },
              ] as const
            ).map((tab) => {
              const active = resultTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setResultTab(tab.id)}
                  className={`pb-3 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'border-[#F78166] text-[#F0F6FC]'
                      : 'border-transparent text-[#8B949E] hover:text-[#C9D1D9]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab 1: PRD Ambiguities */}
          {resultTab === 'ambiguities' && (
            <div className="rounded-md border border-[#30363D] bg-[#161B22] divide-y divide-[#21262D]">
              {architectData.ambiguities.length > 0 ? (
                architectData.ambiguities.map((item) => {
                  const sev = SEVERITY_LABELS[item.severity] || SEVERITY_LABELS.medium;
                  return (
                    <div key={item.id} className="p-5 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="font-mono text-[#8B949E]">{item.id}</span>
                        <span aria-hidden="true" className="text-[#6E7681]">·</span>
                        <span className={`font-medium ${sev.className}`}>{sev.text}</span>
                      </div>
                      <h3 className="text-[14px] font-semibold text-[#F0F6FC]">{item.title}</h3>
                      <p className="text-[13px] text-[#8B949E] leading-relaxed">{item.detail}</p>
                      <div className="pt-1 text-[13px] text-[#C9D1D9]">
                        <span className="text-[#58A6FF] font-medium">澄清建议：</span>
                        {item.clarificationSuggestion}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-[13px] text-[#8B949E]">
                  未检出阻塞性 PRD 歧义。
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Architecture, API Contracts & Task Dependency Tree */}
          {resultTab === 'architecture' && (
            <div className="space-y-6">
              {/* Architecture Summary */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-4">
                <h3 className="text-[15px] font-semibold text-[#F0F6FC]">技术架构方案</h3>
                <p className="text-[13px] text-[#C9D1D9] leading-relaxed whitespace-pre-line">
                  {architectData.architectureSummary}
                </p>
                {architectData.techDecisions.length > 0 && (
                  <div className="pt-3 border-t border-[#21262D] space-y-2">
                    <div className="text-[12px] font-medium text-[#8B949E]">关键架构决策</div>
                    <ul className="space-y-1.5 text-[13px] text-[#C9D1D9]">
                      {architectData.techDecisions.map((dec, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="font-mono text-[11px] text-[#58A6FF] mt-0.5 tabular-nums">
                            0{idx + 1}.
                          </span>
                          <span>{dec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* API Contracts Table */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#30363D]">
                  <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                    公开接口契约 ({architectData.apiContracts.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-[#30363D] bg-[#0D1117] text-[#8B949E]">
                        <th className="py-2.5 px-4 font-medium">接口</th>
                        <th className="py-2.5 px-4 font-medium">职责</th>
                        <th className="py-2.5 px-4 font-medium">请求结构</th>
                        <th className="py-2.5 px-4 font-medium">响应结构</th>
                        <th className="py-2.5 px-4 font-medium">异常码</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#21262D]">
                      {architectData.apiContracts.map((api) => (
                        <tr key={api.id} className="hover:bg-[#21262D]/40">
                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                            <span className="text-[#58A6FF] font-semibold mr-2">{api.method}</span>
                            <span className="text-[#F0F6FC]">{api.path}</span>
                          </td>
                          <td className="py-3 px-4 text-[#C9D1D9] min-w-[160px]">{api.summary}</td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#8B949E] max-w-[240px]">
                            {api.requestSchema}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#8B949E] max-w-[240px]">
                            {api.responseSchema}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#D29922] whitespace-nowrap tabular-nums">
                            {api.errorCodes.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Layered Task Dependency Tree (DAG) */}
              {taskGraph && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                      原子开发任务树（DAG 拓扑分层）
                    </h3>
                    {taskGraph.hasCycle && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[#D29922]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        循环依赖：{taskGraph.cycleTaskIds.join(', ')}
                      </span>
                    )}
                  </div>

                  <div className="space-y-4">
                    {taskGraph.layers.map((wave, waveIndex) => (
                      <div
                        key={waveIndex}
                        className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden"
                      >
                        <div className="px-5 py-2.5 border-b border-[#30363D] bg-[#0D1117] flex items-center justify-between text-[12px]">
                          <span className="font-medium text-[#F0F6FC] tabular-nums">
                            Wave {waveIndex + 1}
                          </span>
                          <span className="text-[#8B949E] tabular-nums">
                            {wave.length} 个并行任务
                          </span>
                        </div>
                        <div className="divide-y divide-[#21262D]">
                          {wave.map((task) => (
                            <div key={task.id} className="p-5 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-[12px] font-semibold text-[#58A6FF]">
                                    {task.id}
                                  </span>
                                  <span className="text-[14px] font-semibold text-[#F0F6FC]">
                                    {task.title}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[12px] text-[#8B949E] font-mono">
                                  <span>{task.module}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>复杂度 {task.estimatedComplexity}</span>
                                  {task.dependsOn.length > 0 && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-[#58A6FF]">
                                        依赖 {task.dependsOn.join(', ')}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <p className="text-[13px] text-[#8B949E] leading-relaxed">
                                {task.description}
                              </p>
                              <div className="pt-1 space-y-1">
                                <div className="text-[11px] font-medium text-[#8B949E]">
                                  验收标准
                                </div>
                                <ul className="space-y-1 text-[12px] text-[#C9D1D9]">
                                  {task.acceptanceCriteria.map((ac, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                      <Check className="h-3.5 w-3.5 text-[#3FB950] shrink-0 mt-0.5" />
                                      <span>{ac}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Shift-Left Testing & QA Critic Diff */}
          {resultTab === 'testing' && (
            <div className="space-y-6">
              {qaCriticData ? (
                <>
                  <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                    <div className="p-5 border-b border-[#30363D] space-y-2">
                      <div className="flex items-center gap-2 text-[15px] font-semibold text-[#F0F6FC]">
                        <ShieldCheck className="h-4 w-4 text-[#3FB950]" />
                        <span>QA Critic 评审结论</span>
                      </div>
                      <p className="text-[13px] text-[#C9D1D9] leading-relaxed">
                        {qaCriticData.reviewSummary}
                      </p>
                    </div>
                    <div className="divide-y divide-[#21262D]">
                      {qaCriticData.findings.map((finding) => {
                        const sev = SEVERITY_LABELS[finding.severity] || SEVERITY_LABELS.medium;
                        return (
                          <div key={finding.id} className="p-5 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2 text-[12px]">
                              <span className="font-mono text-[#8B949E]">{finding.id}</span>
                              <span aria-hidden="true" className="text-[#6E7681]">·</span>
                              <span className="text-[#C9D1D9]">
                                {CATEGORY_LABELS[finding.category] || finding.category}
                              </span>
                              <span aria-hidden="true" className="text-[#6E7681]">·</span>
                              <span className={`font-medium ${sev.className}`}>{sev.text}</span>
                            </div>
                            <div className="text-[13px] font-medium text-[#F0F6FC]">
                              {finding.issue}
                            </div>
                            <div className="text-[12px] text-[#8B949E]">
                              加固方案：{finding.recommendation}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                        Playwright E2E 测试脚本对比
                      </h3>
                      <span className="text-[12px] text-[#8B949E]">
                        QA Spec 初版 → QA Critic 终版
                      </span>
                    </div>
                    <TestDiffViewer
                      initialCode={qaSpecData?.e2eTestCode || ''}
                      finalCode={qaCriticData.finalE2eTestCode}
                      fileName={prArtifacts?.e2eTestPath || 'tests/e2e/iteration.spec.ts'}
                    />
                  </div>

                  <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#30363D]">
                      <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                        终版接口测试清单 ({qaCriticData.finalApiTestChecklist.length})
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[12px]">
                        <thead>
                          <tr className="border-b border-[#30363D] bg-[#0D1117] text-[#8B949E]">
                            <th className="py-2.5 px-4 font-medium">用例编号</th>
                            <th className="py-2.5 px-4 font-medium">接口</th>
                            <th className="py-2.5 px-4 font-medium">测试场景</th>
                            <th className="py-2.5 px-4 font-medium text-right">状态码</th>
                            <th className="py-2.5 px-4 font-medium">断言</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#21262D]">
                          {qaCriticData.finalApiTestChecklist.map((tc) => (
                            <tr key={tc.id} className="hover:bg-[#21262D]/40">
                              <td className="py-3 px-4 font-mono text-[#58A6FF] whitespace-nowrap">
                                {tc.id}
                              </td>
                              <td className="py-3 px-4 font-mono text-[#F0F6FC] whitespace-nowrap">
                                {tc.method} {tc.endpoint}
                              </td>
                              <td className="py-3 px-4 text-[#C9D1D9]">{tc.scenario}</td>
                              <td className="py-3 px-4 font-mono text-right tabular-nums text-[#F0F6FC]">
                                {tc.expectedStatus}
                              </td>
                              <td className="py-3 px-4 text-[#8B949E]">{tc.assertion}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-[#30363D] bg-[#161B22] p-8 text-center text-[13px] text-[#8B949E]">
                  {isAnalyzing
                    ? '正在生成并评审测试用例…'
                    : '暂无测试评审结果。'}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: PR Artifacts Preview */}
          {resultTab === 'artifacts' && prArtifacts && (
            <div className="space-y-4">
              {[
                {
                  key: 'spec',
                  path: prArtifacts.specJsonPath,
                  archiveNote: `同步归档至 ${prArtifacts.archivedSpecPath}`,
                  content: prArtifacts.specJsonContent,
                },
                {
                  key: 'prd',
                  path: prArtifacts.prdMdPath,
                  archiveNote: `同步归档至 ${prArtifacts.archivedPrdPath}`,
                  content: prArtifacts.prdMdContent,
                },
                {
                  key: 'e2e',
                  path: prArtifacts.e2eTestPath,
                  archiveNote: '本轮独立只读回归测试（不覆盖历史测试）',
                  content: prArtifacts.e2eTestContent,
                },
              ].map((file) => (
                <div
                  key={file.key}
                  className="rounded-md border border-[#30363D] bg-[#010409] overflow-hidden"
                >
                  <div className="px-4 py-2.5 border-b border-[#30363D] bg-[#161B22] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-[#F0F6FC]">
                      <FileCode2 className="h-3.5 w-3.5 text-[#58A6FF] shrink-0" />
                      <span>{file.path}</span>
                      <span className="text-[11px] font-sans text-[#8B949E]">
                        · {file.archiveNote}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyArtifact(file.key, file.content)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-2.5 py-1 text-[11px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors"
                    >
                      {copiedArtifact === file.key ? (
                        <>
                          <Check className="h-3 w-3 text-[#3FB950]" />
                          <span>已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>复制</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-4 max-h-[260px] overflow-auto font-mono text-[12px] leading-relaxed text-[#C9D1D9]">
                    {file.content}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
