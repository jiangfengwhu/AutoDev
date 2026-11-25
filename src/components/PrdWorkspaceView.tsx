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
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AgentStepState,
  AmbiguitySeverity,
  AnalysisJob,
  ArchitectOutput,
  BackgroundTask,
  CriticFindingCategory,
  PipelineRun,
  QaCriticOutput,
  QaSpecOutput,
  SelectedTargetRepo,
  SingleTaskLockStatus,
} from '../types/autodev';
import type { PrdDraftState } from '../App';
import { buildTaskLayers, validatePrdInput } from '../lib/taskGraph';
import { buildPrArtifacts } from '../lib/specBuilder';
import { hasPrdDraftContent, savePrdDraft } from '../lib/prdDraftStorage';
import { formatTokenCount } from '../lib/overviewMetrics';
import { apiFetch } from '../lib/editAuthClient';
import { PrArtifactsPreview } from './PrArtifactsPreview';
import {
  AGY_AGENT_MODES,
  AGY_AVAILABLE_MODELS,
  DEFAULT_AGY_MODE,
  DEFAULT_AGY_MODEL,
} from '../lib/workflowBuilder';
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
  onBackgroundTaskStarted?: (task: BackgroundTask) => void;
  onGoToEnvironment: () => void;
  onGoToPipeline: () => void;
  onGoToApproval?: (runId: string) => void;
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
  onBackgroundTaskStarted,
  onGoToEnvironment,
  onGoToPipeline,
  onGoToApproval,
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
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>(
    () => AGY_AVAILABLE_MODELS.map((m) => ({ id: m.id, label: m.label }))
  );
  const [agyModel, setAgyModel] = useState<string>(DEFAULT_AGY_MODEL);
  const [agyMode, setAgyMode] = useState<string>(DEFAULT_AGY_MODE);
  const [cancellingJob, setCancellingJob] = useState(false);

  // Post-planning inline editing state
  const [editingPlan, setEditingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [showNewPrdForm, setShowNewPrdForm] = useState(false);
  const [planDraft, setPlanDraft] = useState<{
    architect: ArchitectOutput;
    qaSpec: QaSpecOutput;
    qaCritic: QaCriticOutput;
  } | null>(null);

  const fetchIterationLock = useCallback(async (repoFullName: string, branch: string) => {
    setLockLoading(true);
    try {
      const res = await fetch(
        `/api/github/iteration-lock?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(branch)}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as SingleTaskLockStatus;
      setLockStatus(data);
    } catch {
      // Ignore transient telemetry fetch error
    } finally {
      setLockLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRepo?.fullName) return;
    let cancelled = false;
    fetch(`/api/github/vps-capabilities?repo=${encodeURIComponent(selectedRepo.fullName)}`)
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
  }, [selectedRepo?.fullName]);

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

  const isAnalyzing = startingJob || analysisJob?.status === 'running';
  const hasLockedIteration = Boolean(lockStatus?.locked);
  const isRequirementInProgress = isAnalyzing || hasLockedIteration;
  const shouldAutoSaveDraft =
    !isAnalyzing &&
    !hasLockedIteration &&
    !analysisJob &&
    !activeRun?.draftPr &&
    !activeRun?.mergedRelease &&
    activeRun?.status !== 'approved';
  const shouldAutoSaveDraftRef = useRef(shouldAutoSaveDraft);
  shouldAutoSaveDraftRef.current = shouldAutoSaveDraft;

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

  // Debounced auto-save on user input (ONLY for fresh, unsubmitted blank-form drafts)
  useEffect(() => {
    if (!shouldAutoSaveDraft) {
      return;
    }

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
      if (!shouldAutoSaveDraftRef.current) return;
      const saved = savePrdDraft(payload);
      if (saved) {
        lastSavedHashRef.current = serialized;
        onDraftSavedAtChange(saved.savedAt);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    shouldAutoSaveDraft,
    repoNameForDraft,
    prdDraft.prdTitle,
    prdDraft.techStackHint,
    prdDraft.prdContent,
    onDraftSavedAtChange,
  ]);

  // Periodic backup interval (every 5s) + beforeunload / unmount flush (guarded against completed PRDs)
  useEffect(() => {
    const flushBackup = (forceTimestamp = false) => {
      if (!shouldAutoSaveDraftRef.current) return;
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

  const steps = analysisJob?.steps ?? DEFAULT_STEPS;
  const jobError = analysisJob?.status === 'error' ? analysisJob.error || '推理执行失败' : null;

  // Focus Mode isolation: while analyzing a new requirement, NEVER leak data from previous activeRun.
  // When an iteration is locked externally (open PR / running workflow) and not currently analyzing,
  // suppress stale leftover artifacts from earlier runs so the workspace stays clean and unambiguous.
  const currentScopedRun = isAnalyzing
    ? null
    : hasLockedIteration
      ? null
      : activeRun && !activeRun.mergedRelease && activeRun.status !== 'approved'
        ? activeRun
        : null;

  const architectData = isAnalyzing
    ? (analysisJob?.architect ?? null)
    : hasLockedIteration
      ? null
      : (analysisJob?.architect ?? currentScopedRun?.architect ?? null);
  const qaSpecData = isAnalyzing
    ? (analysisJob?.qaSpec ?? null)
    : hasLockedIteration
      ? null
      : (analysisJob?.qaSpec ?? currentScopedRun?.qaSpec ?? null);
  const qaCriticData = isAnalyzing
    ? (analysisJob?.qaCritic ?? null)
    : hasLockedIteration
      ? null
      : (analysisJob?.qaCritic ?? currentScopedRun?.qaCritic ?? null);

  const effectiveArchitect =
    editingPlan && planDraft ? planDraft.architect : architectData;
  const effectiveQaSpec =
    editingPlan && planDraft ? planDraft.qaSpec : qaSpecData;

  const hasCompletedPlanFocus = Boolean(
    !isAnalyzing &&
      !hasLockedIteration &&
      currentScopedRun &&
      (architectData || qaSpecData || qaCriticData)
  );
  const shouldHideCreateForm =
    isRequirementInProgress || (hasCompletedPlanFocus && !showNewPrdForm);

  useEffect(() => {
    if (currentScopedRun?.id) {
      setShowNewPrdForm(false);
    }
  }, [currentScopedRun?.id]);
  const effectiveQaCritic =
    editingPlan && planDraft ? planDraft.qaCritic : qaCriticData;

  const taskGraph = useMemo(
    () => (effectiveArchitect ? buildTaskLayers(effectiveArchitect.tasks) : null),
    [effectiveArchitect]
  );

  const prArtifacts = useMemo(() => {
    if (!currentScopedRun) return null;
    if (editingPlan && planDraft) {
      return buildPrArtifacts({
        ...currentScopedRun,
        architect: planDraft.architect,
        qaSpec: planDraft.qaSpec,
        qaCritic: planDraft.qaCritic,
      });
    }
    return buildPrArtifacts(currentScopedRun);
  }, [currentScopedRun, editingPlan, planDraft]);

  // Exit edit mode if scoped run disappears or changes
  useEffect(() => {
    if (!currentScopedRun || currentScopedRun.draftPr) {
      setEditingPlan(false);
      setPlanDraft(null);
    }
  }, [currentScopedRun?.id, currentScopedRun?.draftPr]);

  const handleEnterEditPlan = () => {
    if (!currentScopedRun) return;
    setPlanDraft({
      architect: JSON.parse(JSON.stringify(currentScopedRun.architect)) as ArchitectOutput,
      qaSpec: JSON.parse(JSON.stringify(currentScopedRun.qaSpec)) as QaSpecOutput,
      qaCritic: JSON.parse(JSON.stringify(currentScopedRun.qaCritic)) as QaCriticOutput,
    });
    setEditingPlan(true);
  };

  const handleCancelEditPlan = () => {
    setEditingPlan(false);
    setPlanDraft(null);
  };

  const handleSavePlanEdits = async () => {
    if (!currentScopedRun || !planDraft) return;
    setSavingPlan(true);
    try {
      const res = await apiFetch(`/api/runs/${encodeURIComponent(currentScopedRun.id)}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          architect: planDraft.architect,
          qaSpec: planDraft.qaSpec,
          qaCritic: planDraft.qaCritic,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `保存规划方案失败 (${res.status})`);
      }
      if (data.run) {
        onRunUpdated(data.run as PipelineRun);
      }
      setEditingPlan(false);
      setPlanDraft(null);
      onSuccessToast('规划方案修改已保存并同步至 PR 制品预览', '规划已更新');
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '保存需求规划修改失败',
        '保存失败'
      );
    } finally {
      setSavingPlan(false);
    }
  };

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
      const response = await apiFetch('/api/agents/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: selectedRepo!.fullName,
          defaultBranch: selectedRepo!.defaultBranch,
          prdTitle: prdDraft.prdTitle.trim(),
          prdContent: prdDraft.prdContent.trim(),
          techStackHint: prdDraft.techStackHint.trim() || undefined,
          agyModel,
          agyMode,
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
      const res = await apiFetch(`/api/agents/jobs/${encodeURIComponent(analysisJob.id)}/cancel`, {
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
      const response = await apiFetch('/api/github/create-draft-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          async: true,
          runId: activeRun.id,
          runPayload: activeRun,
          baseBranch: selectedRepo?.defaultBranch || activeRun.defaultBranch,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 202 && data.task) {
        onBackgroundTaskStarted?.(data.task as BackgroundTask);
        onSuccessToast(
          'Draft PR 创建与分支推送已转入服务端后台执行，切换房间或离开页面不会中断',
          '后台建 PR 已启动'
        );
        return;
      }
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
            {isRequirementInProgress
              ? '需求迭代进行中'
              : hasCompletedPlanFocus && !showNewPrdForm
                ? currentScopedRun?.draftPr
                  ? `规划方案 · Draft PR #${currentScopedRun.draftPr.prNumber}`
                  : '架构规划已完成 · 待创建 Draft PR'
                : '新建需求 (PRD)'}
          </h1>
          <p className="mt-1 text-[13px] text-[#8B949E]">
            {isAnalyzing
              ? '正在 Instabox VPS AGY 单对话中联合完成架构拆解、E2E 验收规格与 Critic 评审，当前界面保持专注无干扰。'
              : hasLockedIteration
                ? '当前已有活跃迭代推进中，已自动隐藏新建迭代入口与上轮遗留数据，避免误操作。'
                : hasCompletedPlanFocus && !showNewPrdForm
                  ? `当前需求「${currentScopedRun?.prdTitle}」已完成架构分析与规格编译，已聚焦规划方案与 Draft PR 确认面板。`
                  : '单次 AGY 对话联合输出架构任务树与 E2E 验收用例，规划完成后支持在线编辑修改再创建 Draft PR。'}
          </p>
        </div>

        {(analysisJob || currentScopedRun || prdDraft.prdTitle || prdDraft.prdContent) &&
          !isRequirementInProgress && (
            <button
              type="button"
              onClick={() => {
                setFieldErrors({});
                setPrError(null);
                setShowNewPrdForm(true);
                onResetWorkspace();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建空白需求</span>
            </button>
          )}
      </div>

      {/* Focus Mode Banner when an iteration is already in progress (locked) and not currently analyzing */}
      {!isAnalyzing && hasLockedIteration && lockStatus && (
        <section
          aria-label="当前进行中的迭代"
          className="rounded-md border border-[#58A6FF]/40 bg-[#161B22] p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#F0F6FC]">
                <Lock className="h-4 w-4 text-[#58A6FF] shrink-0" />
                <span>当前已有需求迭代正在进行中</span>
              </div>
              <p className="text-[13px] text-[#8B949E]">
                为防止并发分支冲突与误操作，请先在流水线看板追踪或完成当前需求验收上线后，再发起下一轮需求。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onGoToPipeline}
                className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                <span>查看全自动流水线</span>
              </button>
              {activeRun && onGoToApproval && (
                <button
                  type="button"
                  onClick={() => onGoToApproval(activeRun.id)}
                  className="inline-flex items-center gap-2 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-2 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-[#58A6FF]" />
                  <span>前往验收审批</span>
                </button>
              )}
              {selectedRepo && (
                <button
                  type="button"
                  disabled={lockLoading}
                  onClick={() =>
                    fetchIterationLock(selectedRepo.fullName, selectedRepo.defaultBranch || 'main')
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[12px] text-[#8B949E] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${lockLoading ? 'animate-spin' : ''}`} />
                  <span>刷新状态</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-md border border-[#30363D] bg-[#0D1117] divide-y divide-[#21262D]">
            {lockStatus.reasons.map((reason, idx) => (
              <div
                key={`${reason.kind}-${idx}`}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[12px]"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="font-medium text-[#F0F6FC]">{reason.title}</div>
                  <div className="text-[#8B949E] font-mono text-[11px]">{reason.detail}</div>
                </div>
                {reason.url && (
                  <a
                    href={reason.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#58A6FF] hover:underline whitespace-nowrap shrink-0"
                  >
                    <span>在 GitHub 查看</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Focused Analyzing Header when a new requirement is actively being planned */}
      {isAnalyzing && (
        <section
          aria-label="当前分析中的需求"
          className="rounded-md border border-[#58A6FF]/40 bg-[#161B22] p-5 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="h-4 w-4 animate-spin text-[#58A6FF] shrink-0" />
              <span className="text-[15px] font-semibold text-[#F0F6FC] truncate">
                {analysisJob?.prdTitle || prdDraft.prdTitle || '正在初始化新需求分析…'}
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#79C0FF] shrink-0">
              {analysisJob?.agyModel || agyModel} · {analysisJob?.agyMode || agyMode}
            </span>
          </div>
          <p className="text-[12px] text-[#8B949E]">
            已进入专注视图，仅展示本轮需求的实时规划进度与输出，不会混入历史需求数据。
          </p>
        </section>
      )}

      {/* PRD Input Form (Hidden while analyzing, locked, or when an analyzed plan is ready for Draft PR focus) */}
      {!shouldHideCreateForm && (
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
                <span className="text-[#3FB950]">单任务串行门禁：空闲</span>
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
              <div className="md:col-span-6">
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
                  placeholder="例如：多租户 Webhook 签名校验与死信队列重试"
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-2 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
                />
                {fieldErrors.prdTitle && (
                  <p role="alert" className="mt-1.5 text-[12px] text-[#F85149]">
                    {fieldErrors.prdTitle}
                  </p>
                )}
              </div>

              <div className="md:col-span-6">
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
                  placeholder="默认 Cloudflare Workers + D1"
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-2 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
                />
              </div>

              <div className="md:col-span-6">
                <label
                  htmlFor="prd-agy-model-select"
                  className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
                >
                  AGY 模型
                </label>
                <select
                  id="prd-agy-model-select"
                  value={agyModel}
                  onChange={(e) => setAgyModel(e.target.value)}
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <label
                  htmlFor="prd-agy-mode-select"
                  className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
                >
                  Agent 模式
                </label>
                <select
                  id="prd-agy-mode-select"
                  value={agyMode}
                  onChange={(e) => setAgyMode(e.target.value)}
                  className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                >
                  {AGY_AGENT_MODES.map((m) => (
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
                placeholder="描述业务背景、核心用户流程、权限规则、异常处理与边界约束…"
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none font-sans"
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
                disabled={startingJob}
                className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5" />
                <span>启动架构分析与用例评审</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Real-time 3-Agent Progress Stepper */}
      {(isAnalyzing || (!hasLockedIteration && (steps.some((s) => s.status !== 'idle') || Boolean(currentScopedRun)))) && (
        <section aria-label="多智能体执行进度" className="space-y-3">
          {analysisJob?.executionMode === 'vps_agy' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#30363D] bg-[#161B22] px-4 py-2.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[#C9D1D9]">
                <Server className="h-3.5 w-3.5 text-[#58A6FF] shrink-0" />
                <span>
                  {analysisJob.planMode === 'three_stage'
                    ? 'Instabox VPS AGY 三阶段代码规划'
                    : 'Instabox VPS AGY 单对话联合规划'}
                </span>
                {analysisJob.agyModel && (
                  <>
                    <span aria-hidden="true" className="text-[#6E7681]">·</span>
                    <span className="text-[#8B949E]">{analysisJob.agyModel}</span>
                  </>
                )}
                {(analysisJob.tokenUsage?.totalTokens || currentScopedRun?.planTokenUsage?.totalTokens) ? (
                  <>
                    <span aria-hidden="true" className="text-[#6E7681]">·</span>
                    <span className="text-[#A371F7]">
                      {formatTokenCount(
                        analysisJob.tokenUsage?.totalTokens ||
                          currentScopedRun?.planTokenUsage?.totalTokens ||
                          0
                      )}{' '}
                      Tokens
                    </span>
                  </>
                ) : null}
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
      {effectiveArchitect && (
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
                  {currentScopedRun?.planUpdatedAt && (
                    <span className="font-mono text-[11px] font-normal text-[#3FB950]">
                      · 已人工修订
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8B949E] tabular-nums">
                  <span>歧义提示 {effectiveArchitect.ambiguities.length} 项</span>
                  <span aria-hidden="true">·</span>
                  <span>接口契约 {effectiveArchitect.apiContracts.length} 项</span>
                  <span aria-hidden="true">·</span>
                  <span>原子任务 {effectiveArchitect.tasks.length} 项</span>
                  {effectiveQaCritic && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Critic 加固 {effectiveQaCritic.findings.length} 项</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {currentScopedRun && !currentScopedRun.draftPr && !isAnalyzing && (
                  editingPlan ? (
                    <>
                      <button
                        type="button"
                        disabled={savingPlan}
                        onClick={handleCancelEditPlan}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-2 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>取消编辑</span>
                      </button>
                      <button
                        type="button"
                        disabled={savingPlan}
                        onClick={handleSavePlanEdits}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#1F6FEB] border border-[#58A6FF]/40 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#388BFD] disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {savingPlan ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        <span>{savingPlan ? '保存中…' : '保存规划修改'}</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={creatingPr || hasLockedIteration}
                      onClick={handleEnterEditPlan}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-2 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      <Pencil className="h-3.5 w-3.5 text-[#58A6FF]" />
                      <span>编辑规划方案</span>
                    </button>
                  )
                )}

                {currentScopedRun?.draftPr ? (
                  <>
                    <a
                      href={currentScopedRun.draftPr.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors whitespace-nowrap"
                    >
                      <GitPullRequest className="h-4 w-4" />
                      <span>查看 Draft PR #{currentScopedRun.draftPr.prNumber}</span>
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
                      editingPlan ||
                      !currentScopedRun ||
                      hasLockedIteration
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
                    ) : editingPlan ? (
                      <>
                        <Pencil className="h-4 w-4" />
                        <span>请先保存规划修改</span>
                      </>
                    ) : hasLockedIteration ? (
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

            {editingPlan && (
              <div className="rounded-md border border-[#58A6FF]/40 bg-[#1F6FEB]/10 px-4 py-2.5 text-[12px] text-[#C9D1D9] flex items-center justify-between gap-3">
                <span>
                  当前处于规划编辑模式：可在下方「需求歧义」「架构与任务树」「测试对比」标签中直接修改方案、任务验收标准与 E2E 测试脚本，点击「保存规划修改」后生效。
                </span>
              </div>
            )}

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
                  label: `需求歧义 (${effectiveArchitect.ambiguities.length})`,
                },
                {
                  id: 'architecture',
                  label: `架构与任务树 (${effectiveArchitect.tasks.length})`,
                },
                {
                  id: 'testing',
                  label: `测试对比${effectiveQaCritic ? ` (${effectiveQaCritic.findings.length})` : ''}`,
                },
                {
                  id: 'artifacts',
                  label: 'PR 制品预览 (2)',
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
              {editingPlan && planDraft ? (
                <>
                  <div className="px-5 py-3 flex items-center justify-between bg-[#0D1117]">
                    <span className="text-[12px] font-medium text-[#C9D1D9]">
                      编辑需求歧义与澄清说明
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPlanDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                architect: {
                                  ...prev.architect,
                                  ambiguities: [
                                    ...prev.architect.ambiguities,
                                    {
                                      id: `AMB-${prev.architect.ambiguities.length + 1}`,
                                      severity: 'medium',
                                      title: '新增需求澄清项',
                                      detail: '',
                                      clarificationSuggestion: '',
                                    },
                                  ],
                                },
                              }
                            : prev
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#30363D] bg-[#21262D] px-2.5 py-1 text-[11px] text-[#58A6FF] hover:bg-[#30363D]"
                    >
                      <Plus className="h-3 w-3" />
                      <span>新增澄清项</span>
                    </button>
                  </div>
                  {planDraft.architect.ambiguities.length > 0 ? (
                    planDraft.architect.ambiguities.map((item, idx) => (
                      <div key={item.id + idx} className="p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12px] text-[#8B949E]">{item.id}</span>
                            <select
                              value={item.severity}
                              onChange={(e) =>
                                setPlanDraft((prev) => {
                                  if (!prev) return prev;
                                  const next = [...prev.architect.ambiguities];
                                  next[idx] = {
                                    ...next[idx],
                                    severity: e.target.value as AmbiguitySeverity,
                                  };
                                  return {
                                    ...prev,
                                    architect: { ...prev.architect, ambiguities: next },
                                  };
                                })
                              }
                              className="rounded border border-[#30363D] bg-[#0D1117] px-2 py-1 text-[11px] text-[#F0F6FC]"
                            >
                              <option value="high">高风险</option>
                              <option value="medium">中风险</option>
                              <option value="low">低风险</option>
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  architect: {
                                    ...prev.architect,
                                    ambiguities: prev.architect.ambiguities.filter((_, i) => i !== idx),
                                  },
                                };
                              })
                            }
                            className="inline-flex items-center gap-1 text-[11px] text-[#FF7B72] hover:underline"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>删除</span>
                          </button>
                        </div>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) =>
                            setPlanDraft((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.architect.ambiguities];
                              next[idx] = { ...next[idx], title: e.target.value };
                              return { ...prev, architect: { ...prev.architect, ambiguities: next } };
                            })
                          }
                          placeholder="歧义标题"
                          className="w-full rounded border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[13px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                        />
                        <textarea
                          rows={2}
                          value={item.detail}
                          onChange={(e) =>
                            setPlanDraft((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.architect.ambiguities];
                              next[idx] = { ...next[idx], detail: e.target.value };
                              return { ...prev, architect: { ...prev.architect, ambiguities: next } };
                            })
                          }
                          placeholder="详细说明"
                          className="w-full rounded border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[12px] text-[#C9D1D9] focus:border-[#58A6FF] focus:outline-none"
                        />
                        <input
                          type="text"
                          value={item.clarificationSuggestion}
                          onChange={(e) =>
                            setPlanDraft((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.architect.ambiguities];
                              next[idx] = {
                                ...next[idx],
                                clarificationSuggestion: e.target.value,
                              };
                              return { ...prev, architect: { ...prev.architect, ambiguities: next } };
                            })
                          }
                          placeholder="澄清建议 / 最终拍板口径"
                          className="w-full rounded border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[12px] text-[#C9D1D9] focus:border-[#58A6FF] focus:outline-none"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-[13px] text-[#8B949E]">
                      暂无歧义条目，可点击右上角「新增澄清项」补充业务约定。
                    </div>
                  )}
                </>
              ) : effectiveArchitect.ambiguities.length > 0 ? (
                effectiveArchitect.ambiguities.map((item) => {
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
                {editingPlan && planDraft ? (
                  <>
                    <textarea
                      rows={4}
                      value={planDraft.architect.architectureSummary}
                      onChange={(e) =>
                        setPlanDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                architect: {
                                  ...prev.architect,
                                  architectureSummary: e.target.value,
                                },
                              }
                            : prev
                        )
                      }
                      className="w-full rounded border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[13px] text-[#F0F6FC] leading-relaxed focus:border-[#58A6FF] focus:outline-none"
                    />
                    <div className="space-y-1.5">
                      <label className="block text-[12px] font-medium text-[#8B949E]">
                        关键架构决策（每行一条）
                      </label>
                      <textarea
                        rows={4}
                        value={planDraft.architect.techDecisions.join('\n')}
                        onChange={(e) =>
                          setPlanDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  architect: {
                                    ...prev.architect,
                                    techDecisions: e.target.value
                                      .split('\n')
                                      .map((line) => line.trim())
                                      .filter(Boolean),
                                  },
                                }
                              : prev
                          )
                        }
                        className="w-full rounded border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[12px] text-[#C9D1D9] focus:border-[#58A6FF] focus:outline-none"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-[#C9D1D9] leading-relaxed whitespace-pre-line">
                      {effectiveArchitect.architectureSummary}
                    </p>
                    {effectiveArchitect.techDecisions.length > 0 && (
                      <div className="pt-3 border-t border-[#21262D] space-y-2">
                        <div className="text-[12px] font-medium text-[#8B949E]">关键架构决策</div>
                        <ul className="space-y-1.5 text-[13px] text-[#C9D1D9]">
                          {effectiveArchitect.techDecisions.map((dec, idx) => (
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
                  </>
                )}
              </div>

              {/* API Contracts Table */}
              <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#30363D] flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                    公开接口契约 ({effectiveArchitect.apiContracts.length})
                  </h3>
                  {editingPlan && planDraft && (
                    <button
                      type="button"
                      onClick={() =>
                        setPlanDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                architect: {
                                  ...prev.architect,
                                  apiContracts: [
                                    ...prev.architect.apiContracts,
                                    {
                                      id: `API-${prev.architect.apiContracts.length + 1}`,
                                      method: 'POST',
                                      path: '/api/new-endpoint',
                                      summary: '新增接口职责',
                                      requestSchema: '{}',
                                      responseSchema: '{ ok: boolean }',
                                      errorCodes: ['400', '500'],
                                    },
                                  ],
                                },
                              }
                            : prev
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#30363D] bg-[#21262D] px-2.5 py-1 text-[11px] text-[#58A6FF] hover:bg-[#30363D]"
                    >
                      <Plus className="h-3 w-3" />
                      <span>新增接口契约</span>
                    </button>
                  )}
                </div>

                {editingPlan && planDraft ? (
                  <div className="divide-y divide-[#21262D]">
                    {planDraft.architect.apiContracts.map((api, idx) => (
                      <div key={api.id + idx} className="p-4 space-y-2.5 bg-[#0D1117]">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                          <select
                            value={api.method}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.apiContracts];
                                next[idx] = {
                                  ...next[idx],
                                  method: e.target.value as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
                                };
                                return { ...prev, architect: { ...prev.architect, apiContracts: next } };
                              })
                            }
                            className="md:col-span-2 rounded border border-[#30363D] bg-[#161B22] px-2 py-1.5 font-mono text-[12px] text-[#58A6FF]"
                          >
                            {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={api.path}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.apiContracts];
                                next[idx] = { ...next[idx], path: e.target.value };
                                return { ...prev, architect: { ...prev.architect, apiContracts: next } };
                              })
                            }
                            placeholder="/api/..."
                            className="md:col-span-4 rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC]"
                          />
                          <input
                            type="text"
                            value={api.summary}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.apiContracts];
                                next[idx] = { ...next[idx], summary: e.target.value };
                                return { ...prev, architect: { ...prev.architect, apiContracts: next } };
                              })
                            }
                            placeholder="接口职责"
                            className="md:col-span-5 rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 text-[12px] text-[#C9D1D9]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setPlanDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      architect: {
                                        ...prev.architect,
                                        apiContracts: prev.architect.apiContracts.filter(
                                          (_, i) => i !== idx
                                        ),
                                      },
                                    }
                                  : prev
                              )
                            }
                            className="md:col-span-1 inline-flex items-center justify-end text-[11px] text-[#FF7B72] hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <input
                            type="text"
                            value={api.requestSchema}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.apiContracts];
                                next[idx] = { ...next[idx], requestSchema: e.target.value };
                                return { ...prev, architect: { ...prev.architect, apiContracts: next } };
                              })
                            }
                            placeholder="请求结构"
                            className="rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[11px] text-[#8B949E]"
                          />
                          <input
                            type="text"
                            value={api.responseSchema}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.apiContracts];
                                next[idx] = { ...next[idx], responseSchema: e.target.value };
                                return { ...prev, architect: { ...prev.architect, apiContracts: next } };
                              })
                            }
                            placeholder="响应结构"
                            className="rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[11px] text-[#8B949E]"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
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
                        {effectiveArchitect.apiContracts.map((api) => (
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
                )}
              </div>

              {/* Layered Task Dependency Tree (DAG) / Editable Task List */}
              {editingPlan && planDraft ? (
                <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                  <div className="px-5 py-3 border-b border-[#30363D] flex items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                      编辑原子开发任务 ({planDraft.architect.tasks.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setPlanDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                architect: {
                                  ...prev.architect,
                                  tasks: [
                                    ...prev.architect.tasks,
                                    {
                                      id: `TASK-${prev.architect.tasks.length + 1}`,
                                      title: '新增开发任务',
                                      module: 'web',
                                      description: '',
                                      dependsOn: [],
                                      acceptanceCriteria: ['功能符合预期并通过测试'],
                                      estimatedComplexity: 'M',
                                    },
                                  ],
                                },
                              }
                            : prev
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#30363D] bg-[#21262D] px-2.5 py-1 text-[11px] text-[#58A6FF] hover:bg-[#30363D]"
                    >
                      <Plus className="h-3 w-3" />
                      <span>新增原子任务</span>
                    </button>
                  </div>
                  <div className="divide-y divide-[#21262D]">
                    {planDraft.architect.tasks.map((task, idx) => (
                      <div key={task.id + idx} className="p-4 space-y-2.5 bg-[#0D1117]">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                          <input
                            type="text"
                            value={task.id}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.tasks];
                                next[idx] = { ...next[idx], id: e.target.value };
                                return { ...prev, architect: { ...prev.architect, tasks: next } };
                              })
                            }
                            className="md:col-span-2 rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#58A6FF]"
                          />
                          <input
                            type="text"
                            value={task.title}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.tasks];
                                next[idx] = { ...next[idx], title: e.target.value };
                                return { ...prev, architect: { ...prev.architect, tasks: next } };
                              })
                            }
                            placeholder="任务标题"
                            className="md:col-span-5 rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 text-[13px] text-[#F0F6FC]"
                          />
                          <input
                            type="text"
                            value={task.module}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.tasks];
                                next[idx] = { ...next[idx], module: e.target.value };
                                return { ...prev, architect: { ...prev.architect, tasks: next } };
                              })
                            }
                            placeholder="模块"
                            className="md:col-span-2 rounded border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#8B949E]"
                          />
                          <select
                            value={task.estimatedComplexity}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.tasks];
                                next[idx] = {
                                  ...next[idx],
                                  estimatedComplexity: e.target.value as 'S' | 'M' | 'L',
                                };
                                return { ...prev, architect: { ...prev.architect, tasks: next } };
                              })
                            }
                            className="md:col-span-2 rounded border border-[#30363D] bg-[#161B22] px-2 py-1.5 font-mono text-[12px] text-[#C9D1D9]"
                          >
                            <option value="S">复杂度 S</option>
                            <option value="M">复杂度 M</option>
                            <option value="L">复杂度 L</option>
                          </select>
                          <button
                            type="button"
                            disabled={planDraft.architect.tasks.length <= 1}
                            onClick={() =>
                              setPlanDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      architect: {
                                        ...prev.architect,
                                        tasks: prev.architect.tasks.filter((_, i) => i !== idx),
                                      },
                                    }
                                  : prev
                              )
                            }
                            className="md:col-span-1 inline-flex items-center justify-end text-[11px] text-[#FF7B72] hover:underline disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <textarea
                          rows={2}
                          value={task.description}
                          onChange={(e) =>
                            setPlanDraft((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.architect.tasks];
                              next[idx] = { ...next[idx], description: e.target.value };
                              return { ...prev, architect: { ...prev.architect, tasks: next } };
                            })
                          }
                          placeholder="任务实现说明"
                          className="w-full rounded border border-[#30363D] bg-[#161B22] px-3 py-1.5 text-[12px] text-[#C9D1D9]"
                        />
                        <div className="space-y-1">
                          <label className="block text-[11px] text-[#8B949E]">
                            验收标准（每行一条）
                          </label>
                          <textarea
                            rows={2}
                            value={task.acceptanceCriteria.join('\n')}
                            onChange={(e) =>
                              setPlanDraft((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.architect.tasks];
                                next[idx] = {
                                  ...next[idx],
                                  acceptanceCriteria: e.target.value
                                    .split('\n')
                                    .map((line) => line.trim())
                                    .filter(Boolean),
                                };
                                return { ...prev, architect: { ...prev.architect, tasks: next } };
                              })
                            }
                            className="w-full rounded border border-[#30363D] bg-[#161B22] px-3 py-1.5 text-[12px] text-[#C9D1D9]"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                taskGraph && (
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
                )
              )}
            </div>
          )}

          {/* Tab 3: Shift-Left Testing & QA Critic Diff */}
          {resultTab === 'testing' && (
            <div className="space-y-6">
              {effectiveQaCritic ? (
                <>
                  <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                    <div className="p-5 border-b border-[#30363D] space-y-2">
                      <div className="flex items-center gap-2 text-[15px] font-semibold text-[#F0F6FC]">
                        <ShieldCheck className="h-4 w-4 text-[#3FB950]" />
                        <span>QA Critic 评审结论</span>
                      </div>
                      {editingPlan && planDraft ? (
                        <textarea
                          rows={3}
                          value={planDraft.qaCritic.reviewSummary}
                          onChange={(e) =>
                            setPlanDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    qaCritic: {
                                      ...prev.qaCritic,
                                      reviewSummary: e.target.value,
                                    },
                                  }
                                : prev
                            )
                          }
                          className="w-full rounded border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[13px] text-[#F0F6FC] leading-relaxed focus:border-[#58A6FF] focus:outline-none"
                        />
                      ) : (
                        <p className="text-[13px] text-[#C9D1D9] leading-relaxed">
                          {effectiveQaCritic.reviewSummary}
                        </p>
                      )}
                    </div>
                    <div className="divide-y divide-[#21262D]">
                      {effectiveQaCritic.findings.map((finding) => {
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
                        {editingPlan ? '编辑终版 Playwright E2E 验收脚本' : 'Playwright E2E 测试脚本对比'}
                      </h3>
                      <span className="text-[12px] text-[#8B949E]">
                        {editingPlan ? '保存后将直接提交至 PR 仓库的 tests/e2e/' : 'QA Spec 初版 → QA Critic 终版'}
                      </span>
                    </div>
                    {editingPlan && planDraft ? (
                      <textarea
                        rows={16}
                        value={planDraft.qaCritic.finalE2eTestCode}
                        onChange={(e) =>
                          setPlanDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  qaCritic: {
                                    ...prev.qaCritic,
                                    finalE2eTestCode: e.target.value,
                                  },
                                }
                              : prev
                          )
                        }
                        className="w-full rounded-md border border-[#30363D] bg-[#010409] p-4 font-mono text-[12px] leading-relaxed text-[#E6EDF3] focus:border-[#58A6FF] focus:outline-none"
                      />
                    ) : (
                      <TestDiffViewer
                        initialCode={effectiveQaSpec?.e2eTestCode || ''}
                        finalCode={effectiveQaCritic.finalE2eTestCode}
                        fileName={prArtifacts?.e2eTestPath || 'tests/e2e/iteration.spec.ts'}
                      />
                    )}
                  </div>

                  <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#30363D]">
                      <h3 className="text-[15px] font-semibold text-[#F0F6FC]">
                        终版接口测试清单 ({effectiveQaCritic.finalApiTestChecklist.length})
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
                          {effectiveQaCritic.finalApiTestChecklist.map((tc) => (
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

          {/* Tab 4: PR Artifacts Preview (docs/spec.json structured UI + docs/prd.md Markdown preview) */}
          {resultTab === 'artifacts' && prArtifacts && (
            <PrArtifactsPreview
              artifacts={prArtifacts}
              copiedArtifact={copiedArtifact}
              onCopyArtifact={handleCopyArtifact}
            />
          )}
        </section>
      )}
    </div>
  );
}
