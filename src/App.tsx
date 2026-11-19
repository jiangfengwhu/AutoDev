import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, Menu } from 'lucide-react';
import type {
  AnalysisJob,
  IntegrationsStatusResponse,
  NavSectionId,
  PipelineRun,
  SelectedTargetRepo,
  ToastItem,
} from './types/autodev';
import { Sidebar } from './components/Sidebar';
import { EnvironmentView } from './components/EnvironmentView';
import { PrdWorkspaceView } from './components/PrdWorkspaceView';
import { RequirementsBoardView } from './components/RequirementsBoardView';
import { PipelineBoardView } from './components/PipelineBoardView';
import { ApprovalView } from './components/ApprovalView';
import { QualityRsiView } from './components/QualityRsiView';
import { ToastContainer } from './components/ToastContainer';
import { FIXED_TARGET_REPO } from './lib/workflowBuilder';
import {
  clearPrdDraft,
  loadPrdDraft,
  savePrdDraft,
} from './lib/prdDraftStorage';

const SECTION_META: Record<NavSectionId, { breadcrumb: string }> = {
  environment: { breadcrumb: '1. 环境与引擎装配' },
  prd: { breadcrumb: '2. 新建需求 (PRD)' },
  requirements: { breadcrumb: '3. 需求看板' },
  pipeline: { breadcrumb: '4. 全自动流水线看板' },
  approval: { breadcrumb: '5. 验收与上线审批' },
  quality: { breadcrumb: '6. 质量与自进化 (RSI)' },
};

const DEFAULT_PINNED_REPO: SelectedTargetRepo = {
  fullName: FIXED_TARGET_REPO.fullName,
  owner: FIXED_TARGET_REPO.owner,
  name: FIXED_TARGET_REPO.name,
  defaultBranch: FIXED_TARGET_REPO.defaultBranch,
  htmlUrl: FIXED_TARGET_REPO.htmlUrl,
  isLiveGitHub: true,
};

export interface PrdDraftState {
  prdTitle: string;
  techStackHint: string;
  prdContent: string;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('environment');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [status, setStatus] = useState<IntegrationsStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<SelectedTargetRepo>(DEFAULT_PINNED_REPO);

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [prdDraft, setPrdDraft] = useState<PrdDraftState>(() => {
    const saved = loadPrdDraft();
    return saved
      ? {
          prdTitle: saved.prdTitle,
          techStackHint: saved.techStackHint,
          prdContent: saved.prdContent,
        }
      : {
          prdTitle: '',
          techStackHint: '',
          prdContent: '',
        };
  });
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(
    () => loadPrdDraft()?.savedAt ?? null
  );
  const hasRestoredLocalDraftRef = useRef<boolean>(Boolean(loadPrdDraft()));
  const draftDirtyRef = useRef(false);
  const lastJobStatusRef = useRef<string | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
      const ttl = toast.type === 'error' ? 7500 : 4500;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    },
    []
  );

  const pushErrorToast = useCallback(
    (message: string, title = '操作失败') => {
      pushToast({ type: 'error', title, message });
    },
    [pushToast]
  );

  const pushSuccessToast = useCallback(
    (message: string, title = '操作成功') => {
      pushToast({ type: 'success', title, message });
    },
    [pushToast]
  );

  const fetchIntegrationsStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/integrations/status');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as IntegrationsStatusResponse;
      setStatus(data);

      if (data.github.connected && data.github.repos.length > 0) {
        const pinned = data.github.repos.find(
          (r) => r.fullName.toLowerCase() === FIXED_TARGET_REPO.fullName.toLowerCase()
        );
        if (pinned) {
          setSelectedRepo({
            fullName: pinned.fullName,
            owner: pinned.owner,
            name: pinned.name,
            defaultBranch: pinned.defaultBranch || 'main',
            htmlUrl: pinned.htmlUrl,
            isLiveGitHub: true,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法连接控制面服务端';
      setStatusError(msg);
      pushErrorToast(msg, '连通性检测失败');
    } finally {
      setStatusLoading(false);
    }
  }, [pushErrorToast]);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/runs');
      if (!res.ok) return;
      const data = (await res.json()) as { runs?: PipelineRun[] };
      if (Array.isArray(data.runs)) {
        setRuns(data.runs);
        if (data.runs.length > 0) {
          setActiveRunId((prev) => prev ?? data.runs![0].id);
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  const fetchLatestAnalysisJob = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/jobs/latest');
      if (!res.ok) return;
      const data = (await res.json()) as { job?: AnalysisJob | null };
      const job = data.job ?? null;
      if (job) {
        setAnalysisJob(job);
        lastJobStatusRef.current = job.status;
        if (!draftDirtyRef.current && (!hasRestoredLocalDraftRef.current || job.status === 'running')) {
          setPrdDraft({
            prdTitle: job.prdTitle,
            techStackHint: job.techStackHint ?? '',
            prdContent: job.prdContent,
          });
        }
        if (job.runId) {
          setActiveRunId((prev) => prev ?? job.runId!);
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchIntegrationsStatus();
    fetchRuns();
    fetchLatestAnalysisJob();
  }, [fetchIntegrationsStatus, fetchRuns, fetchLatestAnalysisJob]);

  const handleRunCompleted = useCallback((run: PipelineRun) => {
    setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    setActiveRunId(run.id);
  }, []);

  const handleRunUpdated = useCallback((updated: PipelineRun) => {
    setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  // Poll running server-side analysis job regardless of which tab the user is viewing
  useEffect(() => {
    if (!analysisJob || analysisJob.status !== 'running') return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/agents/jobs/${encodeURIComponent(analysisJob.id)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job?: AnalysisJob };
        const nextJob = data.job;
        if (!nextJob) return;

        setAnalysisJob(nextJob);

        if (lastJobStatusRef.current === 'running' && nextJob.status === 'completed') {
          lastJobStatusRef.current = 'completed';
          if (nextJob.run) {
            handleRunCompleted(nextJob.run);
          } else {
            fetchRuns();
          }
          pushSuccessToast(`「${nextJob.prdTitle}」已完成架构设计与只读测试集评审`, '分析完成');
        } else if (lastJobStatusRef.current === 'running' && nextJob.status === 'error') {
          lastJobStatusRef.current = 'error';
          pushErrorToast(nextJob.error || '多智能体执行失败', 'PRD 分析中断');
        }
      } catch {
        // retry next tick
      }
    }, 1200);

    return () => clearInterval(timer);
  }, [analysisJob, fetchRuns, handleRunCompleted, pushErrorToast, pushSuccessToast]);

  const handleSelectRepo = (repo: SelectedTargetRepo) => {
    setSelectedRepo(repo);
  };

  const handlePrdDraftChange = (patch: Partial<PrdDraftState>) => {
    draftDirtyRef.current = true;
    setPrdDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleJobStarted = (job: AnalysisJob) => {
    lastJobStatusRef.current = job.status;
    setAnalysisJob(job);
    draftDirtyRef.current = false;
    const nextDraft = {
      prdTitle: job.prdTitle,
      techStackHint: job.techStackHint ?? '',
      prdContent: job.prdContent,
    };
    setPrdDraft(nextDraft);
    const saved = savePrdDraft({
      repoFullName: job.repoFullName,
      ...nextDraft,
    });
    if (saved) {
      setDraftSavedAt(saved.savedAt);
    }
  };

  const handleResetPrdWorkspace = () => {
    if (analysisJob?.status === 'running') return;
    draftDirtyRef.current = true;
    hasRestoredLocalDraftRef.current = false;
    lastJobStatusRef.current = null;
    clearPrdDraft();
    setDraftSavedAt(null);
    setAnalysisJob(null);
    setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
  };

  // Match activeRun either from analysisJob.runId or selected activeRunId
  const activeRun =
    (analysisJob?.runId ? runs.find((r) => r.id === analysisJob.runId) : undefined) ??
    runs.find((r) => r.id === activeRunId) ??
    runs[0] ??
    null;

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#C9D1D9] flex">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        selectedRepo={selectedRepo}
        runCount={runs.length}
        isAnalyzingJob={analysisJob?.status === 'running'}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, Target Repo + 1 contextual CTA on right */}
        <header className="sticky top-0 z-30 h-14 bg-[#161B22]/95 backdrop-blur-sm border-b border-[#30363D] px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="打开导航菜单"
              className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#30363D] bg-[#21262D] text-[#F0F6FC] hover:bg-[#30363D]"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 text-[13px] min-w-0">
              <span className="text-[#8B949E] whitespace-nowrap hidden sm:inline">
                AutoDev Studio
              </span>
              <span aria-hidden="true" className="text-[#6E7681] hidden sm:inline">
                /
              </span>
              <span className="font-semibold text-[#F0F6FC] truncate">
                {SECTION_META[activeSection].breadcrumb}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {selectedRepo && (
              <div className="hidden md:flex items-center gap-1.5 text-[12px] font-mono text-[#8B949E] max-w-[260px]">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#58A6FF]" />
                <span className="truncate">{selectedRepo.fullName}</span>
              </div>
            )}
            {activeSection !== 'prd' && (
              <button
                type="button"
                onClick={() => setActiveSection('prd')}
                className="rounded-md bg-[#238636] border border-[#3FB950]/30 px-3.5 py-1.5 text-[12px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors whitespace-nowrap shrink-0"
              >
                新建需求
              </button>
            )}
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {activeSection === 'environment' && (
            <EnvironmentView
              status={status}
              loading={statusLoading}
              error={statusError}
              onRefresh={fetchIntegrationsStatus}
              selectedRepo={selectedRepo}
              onSelectRepo={handleSelectRepo}
              onErrorToast={pushErrorToast}
              onSuccessToast={pushSuccessToast}
            />
          )}

          {activeSection === 'prd' && (
            <PrdWorkspaceView
              selectedRepo={selectedRepo}
              activeRun={analysisJob === null ? null : activeRun}
              analysisJob={analysisJob}
              prdDraft={prdDraft}
              draftSavedAt={draftSavedAt}
              onDraftSavedAtChange={setDraftSavedAt}
              onChangePrdDraft={handlePrdDraftChange}
              onResetWorkspace={handleResetPrdWorkspace}
              onJobStarted={handleJobStarted}
              onRunUpdated={handleRunUpdated}
              onGoToEnvironment={() => setActiveSection('environment')}
              onGoToPipeline={() => setActiveSection('pipeline')}
              onErrorToast={pushErrorToast}
              onSuccessToast={pushSuccessToast}
            />
          )}

          {activeSection === 'requirements' && (
            <RequirementsBoardView
              repoFullName={selectedRepo.fullName}
              onGoToNewPrd={() => setActiveSection('prd')}
              onGoToPipeline={(runId) => {
                setActiveRunId(runId);
                setActiveSection('pipeline');
              }}
              onGoToApproval={(runId) => {
                setActiveRunId(runId);
                setActiveSection('approval');
              }}
              onErrorToast={pushErrorToast}
            />
          )}

          {activeSection === 'pipeline' && (
            <PipelineBoardView
              runs={runs}
              selectedRunId={activeRunId}
              onSelectRun={setActiveRunId}
              cloudflareStatus={status?.cloudflare}
              githubConnected={Boolean(status?.github.connected)}
              onGoToNewPrd={() => setActiveSection('prd')}
              onGoToApproval={(runId) => {
                setActiveRunId(runId);
                setActiveSection('approval');
              }}
              onErrorToast={pushErrorToast}
              onSuccessToast={pushSuccessToast}
            />
          )}

          {activeSection === 'approval' && (
            <ApprovalView
              runs={runs}
              selectedRunId={activeRunId}
              onSelectRun={setActiveRunId}
              onRunUpdated={handleRunUpdated}
              onGoToNewPrd={() => setActiveSection('prd')}
              onGoToQuality={() => setActiveSection('quality')}
              onErrorToast={pushErrorToast}
              onSuccessToast={pushSuccessToast}
            />
          )}

          {activeSection === 'quality' && (
            <QualityRsiView
              repoFullName={selectedRepo.fullName}
              onErrorToast={pushErrorToast}
              onSuccessToast={pushSuccessToast}
            />
          )}
        </main>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
