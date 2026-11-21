import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisJob,
  BackgroundTask,
  IntegrationsStatusResponse,
  NavSectionId,
  PipelineRun,
  SelectedTargetRepo,
  ToastItem,
} from './types/autodev';
import { StudioNavigationShell } from './components/StudioNavigationShell';
import { StudioOfficeMap, buildRoomLiveState } from './components/StudioOfficeMap';
import { StudioRoomBanner } from './components/StudioRoomBanner';
import { BackgroundTasksPanel } from './components/BackgroundTasksPanel';
import { EnvironmentView } from './components/EnvironmentView';
import { PrdWorkspaceView } from './components/PrdWorkspaceView';
import { RequirementsBoardView } from './components/RequirementsBoardView';
import { PipelineBoardView } from './components/PipelineBoardView';
import { ApprovalView } from './components/ApprovalView';
import { QualityRsiView, type QualityFocusTarget } from './components/QualityRsiView';
import { ToastContainer } from './components/ToastContainer';
import { FIXED_TARGET_REPO } from './lib/workflowBuilder';
import type { StudioRoomId } from './lib/studioTheme';
import {
  clearPrdDraft,
  loadPrdDraft,
} from './lib/prdDraftStorage';

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
  const [activeSection, setActiveSection] = useState<NavSectionId>('studio');

  const [status, setStatus] = useState<IntegrationsStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<SelectedTargetRepo>(DEFAULT_PINNED_REPO);

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [analysisJobs, setAnalysisJobs] = useState<AnalysisJob[]>([]);
  const [focusedQualityTarget, setFocusedQualityTarget] = useState<QualityFocusTarget | null>(null);

  // Global detached server-side background tasks
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const prevTaskStatusRef = useRef<Map<string, BackgroundTask['status']>>(new Map());

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
      const ttl = toast.type === 'error' ? 7500 : 4800;
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

  const fetchRunsAndLatestJob = useCallback(async () => {
    try {
      const [runsRes, jobRes] = await Promise.all([
        fetch('/api/runs'),
        fetch('/api/agents/jobs/latest'),
      ]);

      let loadedRuns: PipelineRun[] = [];
      if (runsRes.ok) {
        const runsData = (await runsRes.json()) as { runs?: PipelineRun[] };
        if (Array.isArray(runsData.runs)) {
          loadedRuns = runsData.runs;
          setRuns(loadedRuns);
          if (loadedRuns.length > 0) {
            setActiveRunId((prev) => prev ?? loadedRuns[0].id);
          }
        }
      }

      if (jobRes.ok) {
        const jobData = (await jobRes.json()) as {
          job?: AnalysisJob | null;
          jobs?: AnalysisJob[];
        };
        const loadedJobs = Array.isArray(jobData.jobs) ? jobData.jobs : [];
        setAnalysisJobs(loadedJobs);

        // Clean up any stale localStorage draft that already belongs to a submitted/completed requirement
        const savedLocal = loadPrdDraft();
        if (savedLocal) {
          const normTitle = savedLocal.prdTitle.trim();
          const normContent = savedLocal.prdContent.trim();
          const alreadySubmitted =
            loadedRuns.some(
              (r) =>
                r.prdTitle.trim() === normTitle &&
                r.prdContent.trim() === normContent
            ) ||
            loadedJobs.some(
              (j) =>
                j.status !== 'error' &&
                j.prdTitle.trim() === normTitle &&
                j.prdContent.trim() === normContent
            );
          if (alreadySubmitted) {
            clearPrdDraft();
            hasRestoredLocalDraftRef.current = false;
            setDraftSavedAt(null);
            if (!draftDirtyRef.current) {
              setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
            }
          }
        }

        const job = jobData.job ?? null;
        if (job) {
          const linkedRun = job.runId
            ? loadedRuns.find((r) => r.id === job.runId) ?? job.run ?? null
            : null;
          const isAwaitingDraftPr =
            job.status === 'completed' &&
            Boolean(linkedRun) &&
            !linkedRun?.draftPr &&
            !linkedRun?.mergedRelease &&
            linkedRun?.status === 'analyzed';

          // Only bind analysisJob into PRD workspace if actively running or awaiting Draft PR creation.
          // Completed requirements (Draft PR created / approved / merged) must NOT occupy the New Requirement screen.
          if (job.status === 'running' || isAwaitingDraftPr) {
            setAnalysisJob(job);
            lastJobStatusRef.current = job.status;
            if (!draftDirtyRef.current && job.status === 'running') {
              setPrdDraft({
                prdTitle: job.prdTitle,
                techStackHint: job.techStackHint ?? '',
                prdContent: job.prdContent,
              });
            }
            if (job.runId) {
              setActiveRunId((prev) => prev ?? job.runId!);
            }
          } else {
            setAnalysisJob(null);
            lastJobStatusRef.current = null;
          }
        } else {
          setAnalysisJob(null);
          lastJobStatusRef.current = null;
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

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

  const handleEnvironmentReset = useCallback(() => {
    setRuns([]);
    setActiveRunId(null);
    setAnalysisJob(null);
    setAnalysisJobs([]);
    lastJobStatusRef.current = null;
    clearPrdDraft();
    hasRestoredLocalDraftRef.current = false;
    draftDirtyRef.current = false;
    setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
    setDraftSavedAt(null);
    fetchRunsAndLatestJob();
  }, [fetchRunsAndLatestJob]);

  const fetchBackgroundTasks = useCallback(
    async (detectTransitions: boolean) => {
      try {
        const res = await fetch('/api/tasks');
        if (!res.ok) return;
        const data = (await res.json()) as { tasks?: BackgroundTask[] };
        const nextTasks = Array.isArray(data.tasks) ? data.tasks : [];

        if (detectTransitions) {
          let needsRefresh = false;
          let needsReset = false;

          for (const task of nextTasks) {
            const prevStatus = prevTaskStatusRef.current.get(task.id);
            if (prevStatus === 'running' && task.status === 'completed') {
              needsRefresh = true;
              if (task.kind === 'admin_reset') {
                needsReset = true;
              }
              pushSuccessToast(
                task.progressMessage || `${task.title} 已在后台完成`,
                `后台完成：${task.title}`
              );
            } else if (prevStatus === 'running' && task.status === 'failed') {
              needsRefresh = true;
              pushErrorToast(
                task.error || task.progressMessage || '后台任务执行失败',
                `后台失败：${task.title}`
              );
            }
          }

          if (needsReset) {
            handleEnvironmentReset();
          }
          if (needsRefresh) {
            fetchRunsAndLatestJob();
            fetchIntegrationsStatus();
            setRefreshNonce((n) => n + 1);
          }
        }

        const nextMap = new Map<string, BackgroundTask['status']>();
        for (const t of nextTasks) {
          nextMap.set(t.id, t.status);
        }
        prevTaskStatusRef.current = nextMap;
        setBackgroundTasks(nextTasks);
      } catch {
        // retry on next poll
      }
    },
    [
      fetchIntegrationsStatus,
      fetchRunsAndLatestJob,
      handleEnvironmentReset,
      pushErrorToast,
      pushSuccessToast,
    ]
  );

  const handleBackgroundTaskStarted = useCallback((task: BackgroundTask) => {
    prevTaskStatusRef.current.set(task.id, task.status);
    setBackgroundTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
  }, []);

  useEffect(() => {
    fetchIntegrationsStatus();
    fetchRunsAndLatestJob();
    fetchBackgroundTasks(false);
  }, [fetchIntegrationsStatus, fetchRunsAndLatestJob, fetchBackgroundTasks]);

  const hasRunningBackgroundTask = backgroundTasks.some((t) => t.status === 'running');

  useEffect(() => {
    if (!hasRunningBackgroundTask) return;
    const timer = setInterval(() => {
      fetchBackgroundTasks(true);
    }, 1800);
    return () => clearInterval(timer);
  }, [hasRunningBackgroundTask, fetchBackgroundTasks]);

  const handleRunCompleted = useCallback((run: PipelineRun) => {
    setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    setActiveRunId(run.id);
    clearPrdDraft();
    hasRestoredLocalDraftRef.current = false;
    setDraftSavedAt(null);
  }, []);

  const handleRunUpdated = useCallback((updated: PipelineRun) => {
    setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    // Once a Draft PR is created or the requirement is approved/merged, never keep it in PRD draft storage
    if (updated.draftPr || updated.mergedRelease || updated.status === 'approved') {
      clearPrdDraft();
      hasRestoredLocalDraftRef.current = false;
      draftDirtyRef.current = false;
      setDraftSavedAt(null);
      setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
      if (updated.mergedRelease || updated.status === 'approved') {
        setAnalysisJob((prev) => (prev?.runId === updated.id ? null : prev));
      }
    }
  }, []);

  // Poll running server-side analysis job regardless of which room the user is viewing
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
          clearPrdDraft();
          hasRestoredLocalDraftRef.current = false;
          setDraftSavedAt(null);
          if (nextJob.run) {
            handleRunCompleted(nextJob.run);
          } else {
            fetchRuns();
          }
          setRefreshNonce((n) => n + 1);
          pushSuccessToast(
            `「${nextJob.prdTitle}」已完成联合架构设计与盲测集评审，支持直接修改规划方案`,
            '分析完成'
          );
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

  const handleRecordDeleted = useCallback(() => {
    fetchRunsAndLatestJob();
    setRefreshNonce((n) => n + 1);
  }, [fetchRunsAndLatestJob]);

  const handlePrdDraftChange = (patch: Partial<PrdDraftState>) => {
    draftDirtyRef.current = true;
    setPrdDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleJobStarted = (job: AnalysisJob) => {
    lastJobStatusRef.current = job.status;
    setAnalysisJob(job);
    setAnalysisJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    draftDirtyRef.current = false;
    // Submitted requirements should no longer sit in localStorage draft cache
    clearPrdDraft();
    hasRestoredLocalDraftRef.current = false;
    setDraftSavedAt(null);
    setPrdDraft({
      prdTitle: job.prdTitle,
      techStackHint: job.techStackHint ?? '',
      prdContent: job.prdContent,
    });
  };

  const handleResetPrdWorkspace = useCallback(() => {
    if (analysisJob?.status === 'running') return;
    draftDirtyRef.current = false;
    hasRestoredLocalDraftRef.current = false;
    lastJobStatusRef.current = null;
    clearPrdDraft();
    setDraftSavedAt(null);
    setAnalysisJob(null);
    setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
  }, [analysisJob?.status]);

  const handleClearFocusedQualityTarget = useCallback(() => {
    setFocusedQualityTarget(null);
  }, []);

  // Match activeRun either from analysisJob.runId or selected activeRunId
  const activeRun =
    (analysisJob?.runId ? runs.find((r) => r.id === analysisJob.runId) : undefined) ??
    runs.find((r) => r.id === activeRunId) ??
    runs[0] ??
    null;

  const hasInProgressRun = runs.some(
    (r) => !r.mergedRelease && r.status !== 'approved'
  );
  const isRequirementInProgress =
    analysisJob?.status === 'running' || hasInProgressRun;

  // Navigate to New Requirement (PRD): if previous job already created a Draft PR / completed / merged,
  // clear it immediately so the user always lands on a clean blank requirement form.
  const handleSelectSection = useCallback(
    (section: NavSectionId) => {
      if (section === 'prd') {
        const linkedRun = analysisJob?.runId
          ? runs.find((r) => r.id === analysisJob.runId) ?? analysisJob.run ?? null
          : null;
        const isPendingDraftPr =
          analysisJob?.status === 'completed' &&
          Boolean(linkedRun) &&
          !linkedRun?.draftPr &&
          !linkedRun?.mergedRelease &&
          linkedRun?.status === 'analyzed';

        if (analysisJob && analysisJob.status !== 'running' && !isPendingDraftPr) {
          clearPrdDraft();
          hasRestoredLocalDraftRef.current = false;
          draftDirtyRef.current = false;
          lastJobStatusRef.current = null;
          setDraftSavedAt(null);
          setAnalysisJob(null);
          setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
        }
      }
      setActiveSection(section);
    },
    [analysisJob, runs]
  );

  const handleOpenNewPrd = useCallback(() => {
    handleSelectSection('prd');
  }, [handleSelectSection]);

  const activeRoomLiveState =
    activeSection !== 'studio'
      ? buildRoomLiveState({
          roomId: activeSection as StudioRoomId,
          runs,
          analysisJob,
          backgroundTasks,
          status,
        })
      : null;

  return (
    <div className="min-h-screen bg-[#0C0F16] studio-blueprint-floor text-[#E2E8F0] flex flex-col">
      <StudioNavigationShell
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        selectedRepo={selectedRepo}
        backgroundTasks={backgroundTasks}
        analysisJob={analysisJob}
        isRequirementInProgress={isRequirementInProgress}
        onOpenNewPrd={handleOpenNewPrd}
        onOpenTasksDrawer={() => setTasksDrawerOpen(true)}
      />

      <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-7">
        {activeSection === 'studio' ? (
          <StudioOfficeMap
            selectedRepo={selectedRepo}
            status={status}
            runs={runs}
            analysisJob={analysisJob}
            backgroundTasks={backgroundTasks}
            isRequirementInProgress={isRequirementInProgress}
            onEnterRoom={(roomId) => handleSelectSection(roomId)}
            onOpenNewPrd={handleOpenNewPrd}
            onOpenTasksDrawer={() => setTasksDrawerOpen(true)}
          />
        ) : (
          <>
            {activeRoomLiveState && (
              <StudioRoomBanner
                roomId={activeSection as StudioRoomId}
                statusSpeech={activeRoomLiveState.speech}
                isBusy={activeRoomLiveState.isBusy}
                onBackToFloorplan={() => handleSelectSection('studio')}
              />
            )}

            {activeSection === 'environment' && (
              <EnvironmentView
                status={status}
                loading={statusLoading}
                error={statusError}
                onRefresh={fetchIntegrationsStatus}
                selectedRepo={selectedRepo}
                onSelectRepo={handleSelectRepo}
                onEnvironmentReset={handleEnvironmentReset}
                onBackgroundTaskStarted={handleBackgroundTaskStarted}
                refreshNonce={refreshNonce}
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
                onBackgroundTaskStarted={handleBackgroundTaskStarted}
                onGoToEnvironment={() => handleSelectSection('environment')}
                onGoToPipeline={() => handleSelectSection('pipeline')}
                onGoToApproval={(runId) => {
                  setActiveRunId(runId);
                  handleSelectSection('approval');
                }}
                onErrorToast={pushErrorToast}
                onSuccessToast={pushSuccessToast}
              />
            )}

            {activeSection === 'requirements' && (
              <RequirementsBoardView
                repoFullName={selectedRepo.fullName}
                isRequirementInProgress={isRequirementInProgress}
                refreshNonce={refreshNonce}
                onGoToNewPrd={handleOpenNewPrd}
                onGoToPipeline={(runId) => {
                  setActiveRunId(runId);
                  handleSelectSection('pipeline');
                }}
                onGoToApproval={(runId) => {
                  setActiveRunId(runId);
                  handleSelectSection('approval');
                }}
                onRecordDeleted={handleRecordDeleted}
                onSuccessToast={pushSuccessToast}
                onErrorToast={pushErrorToast}
              />
            )}

            {activeSection === 'pipeline' && (
              <PipelineBoardView
                runs={runs}
                relatedJobs={analysisJobs}
                selectedRunId={activeRunId}
                onSelectRun={setActiveRunId}
                cloudflareStatus={status?.cloudflare}
                githubConnected={Boolean(status?.github.connected)}
                isRequirementInProgress={isRequirementInProgress}
                onGoToNewPrd={handleOpenNewPrd}
                onGoToApproval={(runId) => {
                  setActiveRunId(runId);
                  handleSelectSection('approval');
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
                onBackgroundTaskStarted={handleBackgroundTaskStarted}
                isRequirementInProgress={isRequirementInProgress}
                onGoToNewPrd={handleOpenNewPrd}
                onGoToQuality={(target) => {
                  setFocusedQualityTarget({
                    reportId: target?.reportId,
                    actionsRunId: target?.actionsRunId,
                    nonce: Date.now(),
                  });
                  handleSelectSection('quality');
                }}
                onErrorToast={pushErrorToast}
                onSuccessToast={pushSuccessToast}
              />
            )}

            {activeSection === 'quality' && (
              <QualityRsiView
                repoFullName={selectedRepo.fullName}
                focusedTarget={focusedQualityTarget}
                onClearFocusedTarget={handleClearFocusedQualityTarget}
                onBackgroundTaskStarted={handleBackgroundTaskStarted}
                refreshNonce={refreshNonce}
                onErrorToast={pushErrorToast}
                onSuccessToast={pushSuccessToast}
              />
            )}
          </>
        )}
      </main>

      <BackgroundTasksPanel
        open={tasksDrawerOpen}
        onClose={() => setTasksDrawerOpen(false)}
        tasks={backgroundTasks}
        runningAnalysisJob={analysisJob}
        onNavigateToRoom={(room) => handleSelectSection(room)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
