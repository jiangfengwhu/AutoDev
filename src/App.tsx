import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnalysisJob,
  BackgroundTask,
  IntegrationsStatusResponse,
  NavSectionId,
  PipelineRun,
  SelectedTargetRepo,
  ToastItem,
} from './types/autodev';
import type { RsiSystemRule, TestExecutionReport } from './lib/rsiEngine';
import { BackgroundTasksPanel } from './components/BackgroundTasksPanel';
import { EnvironmentView } from './components/EnvironmentView';
import { PrdWorkspaceView } from './components/PrdWorkspaceView';
import { RequirementsBoardView } from './components/RequirementsBoardView';
import { PipelineBoardView } from './components/PipelineBoardView';
import { ApprovalView } from './components/ApprovalView';
import { QualityRsiView, type QualityFocusTarget } from './components/QualityRsiView';
import { RequirementReportModal } from './components/RequirementReportModal';
import { ToastContainer } from './components/ToastContainer';
import { DepartmentPavilionModal } from './components/village/DepartmentPavilionModal';
import { EditUnlockModal } from './components/village/EditUnlockModal';
import { PreviewZoomModal } from './components/cleanroom/PreviewZoomModal';
import { VillageViewport } from './components/village/VillageViewport';
import { VillageBottomDock } from './components/village/VillageBottomDock';
import type { AtmospherePresetId, CameraPresetId, VillageBuildingId } from './scene/villageConfig';
import { FIXED_TARGET_REPO } from './lib/workflowBuilder';
import { clearPrdDraft, loadPrdDraft } from './lib/prdDraftStorage';
import {
  apiFetch,
  installEditAuthFetchInterceptor,
  subscribeEditAuthLocked,
  type EditAuthMeta,
  type EditAuthStatusResponse,
} from './lib/editAuthClient';
import type { SevenDayOverviewMetrics } from './lib/overviewMetrics';
import {
  DEMO_PIPELINE_PHASES,
  deriveRealFactorySnapshot,
  detectNewlyLaunchedRunId,
  getDemoFactorySnapshot,
  isRunDelivered,
  type FactoryMode,
  type FactoryStationId,
} from './lib/factoryPipelineState';
import { soundEngine } from './game/soundEngine';
import {
  getBrowserNotificationPermission,
  loadBrowserNotificationsEnabled,
  requestBrowserNotificationPermission,
  saveBrowserNotificationsEnabled,
  sendBrowserNotification,
  type BrowserNotificationPermission,
} from './lib/browserNotifications';

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

const ROOM_TO_STATION: Record<Exclude<NavSectionId, 'studio'>, FactoryStationId> = {
  environment: 'ST-00',
  prd: 'ST-01',
  pipeline: 'ST-02',
  quality: 'ST-03',
  approval: 'ST-04',
  requirements: 'ST-05',
};

export default function App() {
  // Factory Display Mode: Real Live Production vs Interactive Closed-Loop Demo Simulation
  const [factoryMode, setFactoryMode] = useState<FactoryMode>('real');
  const [demoPhaseIndex, setDemoPhaseIndex] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(true);
  const [demoManualStamped, setDemoManualStamped] = useState(false);

  // 3D Miniature Village Camera & 4-Season Atmosphere State
  const [atmospherePreset, setAtmospherePreset] = useState<AtmospherePresetId>('day');
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId | null>('overview');
  const [cameraPresetNonce, setCameraPresetNonce] = useState(0);
  const [focusBuildingId, setFocusBuildingId] = useState<VillageBuildingId | null>(null);
  const [focusBuildingNonce, setFocusBuildingNonce] = useState(0);

  // Active right-side deep-dive station drawer
  const [drawerStationId, setDrawerStationId] = useState<FactoryStationId | null>(null);
  const [previewZoomOpen, setPreviewZoomOpen] = useState(false);
  const [reportModalRequirementId, setReportModalRequirementId] = useState<string | null>(null);
  const [approvedStampRunId, setApprovedStampRunId] = useState<string | null>(null);
  const [showBuildingLabels, setShowBuildingLabels] = useState(true);

  // Browser desktop notification state (fires on every task completion/failure)
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission());
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() =>
    loadBrowserNotificationsEnabled()
  );

  // Password-gated edit permission state (Bearer token kept strictly in JS memory)
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [editAuthMeta, setEditAuthMeta] = useState<EditAuthMeta | null>(null);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState<string | null>(null);

  // Real Backend State
  const [status, setStatus] = useState<IntegrationsStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [overviewMetrics, setOverviewMetrics] = useState<SevenDayOverviewMetrics | null>(null);
  const [rsiReports, setRsiReports] = useState<TestExecutionReport[]>([]);
  const [rsiRules, setRsiRules] = useState<RsiSystemRule[]>([]);

  const [selectedRepo, setSelectedRepo] = useState<SelectedTargetRepo>(DEFAULT_PINNED_REPO);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [analysisJobs, setAnalysisJobs] = useState<AnalysisJob[]>([]);
  const [focusedQualityTarget, setFocusedQualityTarget] = useState<QualityFocusTarget | null>(null);

  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [activeCodingActionRunning, setActiveCodingActionRunning] = useState(false);
  const [latestCodingActionConclusion, setLatestCodingActionConclusion] = useState<string | null>(
    null
  );
  const [celebratingDeliveredRunId, setCelebratingDeliveredRunId] = useState<string | null>(null);
  const [runsHydrated, setRunsHydrated] = useState(false);
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const prevTaskStatusRef = useRef<Map<string, BackgroundTask['status']>>(new Map());
  const prevCodingRunningRef = useRef(false);
  const knownDeliveredIdsRef = useRef<Set<string>>(new Set());
  const knownInFlightIdsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    document.body.dataset.mode = factoryMode;
  }, [factoryMode]);

  const openUnlockModal = useCallback((reason?: string) => {
    setUnlockReason(reason ?? null);
    setUnlockModalOpen(true);
  }, []);

  useEffect(() => {
    installEditAuthFetchInterceptor();
    const unsubscribe = subscribeEditAuthLocked((reason) => {
      setIsEditUnlocked(false);
      setUnlockReason(reason);
      setUnlockModalOpen(true);
    });

    let cancelled = false;
    apiFetch('/api/auth/status')
      .then((res) => (res.ok ? (res.json() as Promise<EditAuthStatusResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setIsEditUnlocked(Boolean(data.unlocked));
        if (data.meta) setEditAuthMeta(data.meta);
      })
      .catch(() => {
        // non-fatal
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
    const ttl = toast.type === 'error' ? 7500 : 4800;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ttl);
  }, []);

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

  const notifyDesktop = useCallback(
    (params: {
      title: string;
      body: string;
      tag: string;
      stationId?: FactoryStationId;
    }) => {
      sendBrowserNotification({
        title: params.title,
        body: params.body,
        tag: params.tag,
        enabled: notificationsEnabled,
        onClick: params.stationId
          ? () => setDrawerStationId(params.stationId!)
          : undefined,
      });
    },
    [notificationsEnabled]
  );

  const handleToggleNotifications = useCallback(async () => {
    const currentPerm = getBrowserNotificationPermission();
    setNotificationPermission(currentPerm);

    if (currentPerm === 'unsupported') {
      pushErrorToast('当前浏览器环境不支持桌面通知 API。', '不支持通知');
      return;
    }
    if (currentPerm === 'denied') {
      pushErrorToast(
        '浏览器已阻止本站通知权限，请在地址栏左侧网站设置中改为「允许」后再试。',
        '通知权限已被拒绝'
      );
      return;
    }
    if (currentPerm === 'default') {
      const granted = await requestBrowserNotificationPermission();
      setNotificationPermission(granted);
      if (granted === 'granted') {
        saveBrowserNotificationsEnabled(true);
        setNotificationsEnabled(true);
        pushSuccessToast('已开启浏览器桌面通知，每次任务完成时将自动弹窗提醒。', '通知已开启');
        sendBrowserNotification({
          title: 'AutoDev Studio 通知已就绪',
          body: '后续每次架构规划、编码流水线、预览与生产部署完成时，都会第一时间提醒你。',
          tag: 'autodev-notify-ready',
          enabled: true,
        });
      } else {
        pushErrorToast('未授予浏览器通知权限，可在浏览器设置中重新开启。', '未开启通知');
      }
      return;
    }

    const nextEnabled = !notificationsEnabled;
    saveBrowserNotificationsEnabled(nextEnabled);
    setNotificationsEnabled(nextEnabled);
    pushSuccessToast(
      nextEnabled ? '已恢复浏览器任务完成桌面通知。' : '已静音浏览器桌面通知（站内提示仍保留）。',
      nextEnabled ? '通知已开启' : '通知已关闭'
    );
  }, [notificationsEnabled, pushErrorToast, pushSuccessToast]);

  const fetchOverviewMetrics = useCallback(async (repoFullName: string) => {
    try {
      const res = await fetch(
        `/api/overview/metrics?repo=${encodeURIComponent(repoFullName)}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as SevenDayOverviewMetrics & {
        metrics?: SevenDayOverviewMetrics;
      };
      const resolved = data.summary ? data : data.metrics ?? null;
      if (resolved?.summary) {
        setOverviewMetrics(resolved);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const fetchRsiState = useCallback(async (repoFullName: string) => {
    try {
      const res = await fetch(
        `/api/rsi/state?repo=${encodeURIComponent(repoFullName)}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        testReports?: TestExecutionReport[];
        rules?: RsiSystemRule[];
      };
      if (Array.isArray(data.testReports)) {
        setRsiReports(data.testReports);
      }
      if (Array.isArray(data.rules)) {
        setRsiRules(data.rules);
      }
    } catch {
      // non-fatal
    }
  }, []);

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
          setRunsHydrated(true);
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

        const savedLocal = loadPrdDraft();
        if (savedLocal) {
          const normTitle = savedLocal.prdTitle.trim();
          const normContent = savedLocal.prdContent.trim();
          const alreadySubmitted =
            loadedRuns.some(
              (r) =>
                r.prdTitle.trim() === normTitle && r.prdContent.trim() === normContent
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
        setRunsHydrated(true);
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
    setRsiReports([]);
    setCelebratingDeliveredRunId(null);
    setApprovedStampRunId(null);
    knownDeliveredIdsRef.current = new Set();
    knownInFlightIdsRef.current = new Set();
    lastJobStatusRef.current = null;
    clearPrdDraft();
    hasRestoredLocalDraftRef.current = false;
    draftDirtyRef.current = false;
    setPrdDraft({ prdTitle: '', techStackHint: '', prdContent: '' });
    setDraftSavedAt(null);
    fetchRunsAndLatestJob();
    fetchOverviewMetrics(selectedRepo.fullName);
    fetchRsiState(selectedRepo.fullName);
  }, [fetchOverviewMetrics, fetchRsiState, fetchRunsAndLatestJob, selectedRepo.fullName]);

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
              if (task.kind === 'approve_release' && task.runId) {
                setApprovedStampRunId(task.runId);
                setCelebratingDeliveredRunId(task.runId);
              }
              pushSuccessToast(
                task.progressMessage || `${task.title} 已在后台完成`,
                `后台完成：${task.title}`
              );
              const stationId =
                task.roomId && task.roomId !== 'studio'
                  ? ROOM_TO_STATION[task.roomId]
                  : 'ST-04';
              notifyDesktop({
                title: `任务完成 · ${task.title}`,
                body: task.progressMessage || `${task.title} 已完成，点击查看详情`,
                tag: `bg-task-done:${task.id}`,
                stationId,
              });
            } else if (prevStatus === 'running' && task.status === 'failed') {
              needsRefresh = true;
              pushErrorToast(
                task.error || task.progressMessage || '后台任务执行失败',
                `后台失败：${task.title}`
              );
              const stationId =
                task.roomId && task.roomId !== 'studio'
                  ? ROOM_TO_STATION[task.roomId]
                  : 'ST-04';
              notifyDesktop({
                title: `任务失败 · ${task.title}`,
                body: task.error || task.progressMessage || '后台任务执行失败，请检查日志',
                tag: `bg-task-fail:${task.id}`,
                stationId,
              });
            }
          }

          if (needsReset) {
            handleEnvironmentReset();
          }
          if (needsRefresh) {
            fetchRunsAndLatestJob();
            fetchIntegrationsStatus();
            fetchOverviewMetrics(selectedRepo.fullName);
            fetchRsiState(selectedRepo.fullName);
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
      fetchOverviewMetrics,
      fetchRsiState,
      fetchRunsAndLatestJob,
      handleEnvironmentReset,
      notifyDesktop,
      pushErrorToast,
      pushSuccessToast,
      selectedRepo.fullName,
    ]
  );

  const handleBackgroundTaskStarted = useCallback((rawTask: BackgroundTask) => {
    const maybeWrapped = rawTask as unknown as { task?: BackgroundTask };
    const task =
      rawTask && typeof rawTask.id === 'string'
        ? rawTask
        : maybeWrapped?.task && typeof maybeWrapped.task.id === 'string'
          ? maybeWrapped.task
          : null;
    if (!task) return;
    prevTaskStatusRef.current.set(task.id, task.status);
    setBackgroundTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
  }, []);

  useEffect(() => {
    fetchIntegrationsStatus();
    fetchRunsAndLatestJob();
    fetchBackgroundTasks(false);
    fetchOverviewMetrics(DEFAULT_PINNED_REPO.fullName);
    fetchRsiState(DEFAULT_PINNED_REPO.fullName);
  }, [
    fetchBackgroundTasks,
    fetchIntegrationsStatus,
    fetchOverviewMetrics,
    fetchRsiState,
    fetchRunsAndLatestJob,
  ]);

  const hasRunningBackgroundTask = backgroundTasks.some((t) => t.status === 'running');

  useEffect(() => {
    if (!hasRunningBackgroundTask) return;
    const timer = setInterval(() => {
      fetchBackgroundTasks(true);
    }, 1800);

    let keepalive: EventSource | null = null;
    if (typeof window !== 'undefined' && typeof window.EventSource === 'function') {
      try {
        keepalive = new window.EventSource('/api/tasks/keepalive');
      } catch {
        keepalive = null;
      }
    }

    return () => {
      clearInterval(timer);
      keepalive?.close();
    };
  }, [hasRunningBackgroundTask, fetchBackgroundTasks]);

  const handleRunCompleted = useCallback((run: PipelineRun) => {
    setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    setActiveRunId(run.id);
    clearPrdDraft();
    hasRestoredLocalDraftRef.current = false;
    setDraftSavedAt(null);
  }, []);

  const handleRunUpdated = useCallback((updated: PipelineRun) => {
    setRuns((prev) => {
      const existing = prev.find((r) => r.id === updated.id);
      const wasDelivered = Boolean(existing && isRunDelivered(existing));
      const isNowDelivered = isRunDelivered(updated);
      if (existing && isNowDelivered && !wasDelivered) {
        knownDeliveredIdsRef.current.add(updated.id);
        knownInFlightIdsRef.current.delete(updated.id);
        setCelebratingDeliveredRunId(updated.id);
      }
      return prev.map((r) => (r.id === updated.id ? updated : r));
    });
    if (updated.mergedRelease || updated.status === 'approved') {
      setApprovedStampRunId(updated.id);
      soundEngine.unlock();
      soundEngine.playStampApprove();
    }
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

  // Detect live transitions from in-flight -> delivered/launched across polls
  // (NEVER fire on cold-start hydration, feedback triage -> 转大型PRD, or old historical runs!)
  useEffect(() => {
    if (!runsHydrated) return;

    const newlyLaunchedId = detectNewlyLaunchedRunId({
      runs,
      knownDeliveredIds: knownDeliveredIdsRef.current,
      knownInFlightIds: knownInFlightIdsRef.current,
    });

    for (const r of runs) {
      if (isRunDelivered(r)) {
        knownDeliveredIdsRef.current.add(r.id);
        knownInFlightIdsRef.current.delete(r.id);
      } else {
        knownInFlightIdsRef.current.add(r.id);
      }
    }

    if (newlyLaunchedId) {
      setCelebratingDeliveredRunId(newlyLaunchedId);
    }
  }, [runs, runsHydrated]);

  // Poll running server-side analysis job regardless of drawer state
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
          fetchOverviewMetrics(selectedRepo.fullName);
          fetchRsiState(selectedRepo.fullName);
          setRefreshNonce((n) => n + 1);
          pushSuccessToast(
            `「${nextJob.prdTitle}」已完成联合架构设计与 E2E 验收用例评审，支持直接修改规划方案`,
            '分析完成'
          );
          notifyDesktop({
            title: `架构规划完成 · ${nextJob.prdTitle}`,
            body: '多智能体已完成架构拆解与盲测用例评审，点击前往创建 Draft PR。',
            tag: `plan-done:${nextJob.id}`,
            stationId: 'ST-01',
          });
        } else if (lastJobStatusRef.current === 'running' && nextJob.status === 'error') {
          lastJobStatusRef.current = 'error';
          pushErrorToast(nextJob.error || '多智能体执行失败', 'PRD 分析中断');
          notifyDesktop({
            title: `架构规划失败 · ${nextJob.prdTitle}`,
            body: nextJob.error || '规划任务异常中断，点击查看详情。',
            tag: `plan-fail:${nextJob.id}`,
            stationId: 'ST-01',
          });
        }
      } catch {
        // retry next tick
      }
    }, 1200);

    return () => clearInterval(timer);
  }, [
    analysisJob,
    fetchOverviewMetrics,
    fetchRsiState,
    fetchRuns,
    handleRunCompleted,
    notifyDesktop,
    pushErrorToast,
    pushSuccessToast,
    selectedRepo.fullName,
  ]);

  // Smooth closed-loop auto-advance timer for Demo Simulation mode
  useEffect(() => {
    if (factoryMode !== 'demo' || !demoPlaying) return;
    const current = DEMO_PIPELINE_PHASES[demoPhaseIndex] ?? DEMO_PIPELINE_PHASES[0];
    const timer = setTimeout(() => {
      setDemoPhaseIndex((prev) => {
        const next = (prev + 1) % DEMO_PIPELINE_PHASES.length;
        if (next === 0) {
          setDemoManualStamped(false);
        }
        return next;
      });
    }, current.durationMs);
    return () => clearTimeout(timer);
  }, [factoryMode, demoPlaying, demoPhaseIndex]);

  const handleSelectRepo = (repo: SelectedTargetRepo) => {
    setSelectedRepo(repo);
    fetchOverviewMetrics(repo.fullName);
    fetchRsiState(repo.fullName);
  };

  const handleRecordDeleted = useCallback(() => {
    fetchRunsAndLatestJob();
    fetchOverviewMetrics(selectedRepo.fullName);
    fetchRsiState(selectedRepo.fullName);
    setRefreshNonce((n) => n + 1);
  }, [fetchOverviewMetrics, fetchRsiState, fetchRunsAndLatestJob, selectedRepo.fullName]);

  const handlePrdDraftChange = (patch: Partial<PrdDraftState>) => {
    draftDirtyRef.current = true;
    setPrdDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleJobStarted = (job: AnalysisJob) => {
    lastJobStatusRef.current = job.status;
    setAnalysisJob(job);
    setAnalysisJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    draftDirtyRef.current = false;
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

  const activeRun =
    (analysisJob?.runId ? runs.find((r) => r.id === analysisJob.runId) : undefined) ??
    runs.find((r) => r.id === activeRunId) ??
    runs[0] ??
    null;

  const hasInProgressRun = runs.some((r) => !r.mergedRelease && r.status !== 'approved');
  const isRequirementInProgress = analysisJob?.status === 'running' || hasInProgressRun;

  // Track whether GitHub Actions Coding Runner is currently executing OR finished on the in-flight PR
  const inFlightPrRun = useMemo(() => {
    return (
      runs.find(
        (r) => !r.mergedRelease && r.status !== 'approved' && Boolean(r.draftPr?.branchName)
      ) ?? null
    );
  }, [runs]);
  const inFlightPrBranch = inFlightPrRun?.draftPr?.branchName ?? null;
  const inFlightPrCreatedAtMs = inFlightPrRun?.draftPr?.createdAt
    ? Date.parse(inFlightPrRun.draftPr.createdAt)
    : 0;

  useEffect(() => {
    setActiveCodingActionRunning(false);
    setLatestCodingActionConclusion(null);
    prevCodingRunningRef.current = false;

    if (!inFlightPrBranch || !selectedRepo.fullName) {
      return;
    }
    let cancelled = false;
    const checkActions = async () => {
      try {
        const res = await fetch(
          `/api/github/actions-runs?repo=${encodeURIComponent(selectedRepo.fullName)}&per_page=10`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          runs?: Array<{
            headBranch?: string;
            status?: string;
            conclusion?: string | null;
            name?: string;
            createdAt?: string;
          }>;
        };
        const list = Array.isArray(data.runs) ? data.runs : [];
        // Match coding runs: workflow_dispatch runs execute on ref `main` with name "AutoDev AGY Coding Runner",
        // so match by coding workflow name created AFTER this PR's creation (tight 5s slack) OR direct headBranch match.
        const codingRuns = list.filter((r) => {
          const isCodingName = /coding\s*runner|autodev-agy\.yml/i.test(r.name || '');
          const branchMatches = r.headBranch === inFlightPrBranch;
          if (!isCodingName && !branchMatches) return false;
          if (branchMatches) return true;
          const runMs = r.createdAt ? Date.parse(r.createdAt) : 0;
          return !inFlightPrCreatedAtMs || !runMs || runMs >= inFlightPrCreatedAtMs - 5_000;
        });

        const isRunning = codingRuns.some(
          (r) => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting'
        );
        const latestCompleted = codingRuns.find((r) => r.status === 'completed');
        const nextConclusion = latestCompleted?.conclusion ?? null;

        if (!cancelled) {
          const wasRunning = prevCodingRunningRef.current;
          prevCodingRunningRef.current = isRunning;
          setActiveCodingActionRunning(isRunning);
          setLatestCodingActionConclusion(nextConclusion);
          // Immediately sync runs & RSI reports when Coding Runner transitions from running -> completed!
          if (wasRunning && !isRunning) {
            fetchRunsAndLatestJob();
            fetchRsiState(selectedRepo.fullName);
            fetchOverviewMetrics(selectedRepo.fullName);
            setRefreshNonce((n) => n + 1);
            const succeeded = nextConclusion === 'success';
            const prTitle = inFlightPrRun?.prdTitle || inFlightPrBranch || 'AGY 编码流水线';
            notifyDesktop({
              title: succeeded
                ? `AGY 编码与校验完成 · ${prTitle}`
                : `AGY 编码流水线异常 · ${prTitle}`,
              body: succeeded
                ? '代码实现与自动化测试已完成，点击前往部署隔离预览环境进行验收。'
                : `流水线结束状态：${nextConclusion || 'failure'}，点击查看日志。`,
              tag: `agy-coding:${inFlightPrBranch}:${nextConclusion || 'done'}`,
              stationId: succeeded ? 'ST-04' : 'ST-02',
            });
          }
        }
      } catch {
        // non-fatal
      }
    };
    checkActions();
    const timer = setInterval(checkActions, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    fetchOverviewMetrics,
    fetchRsiState,
    fetchRunsAndLatestJob,
    inFlightPrBranch,
    inFlightPrCreatedAtMs,
    inFlightPrRun?.prdTitle,
    notifyDesktop,
    selectedRepo.fullName,
    refreshNonce,
  ]);

  // Open a specific station's right frosted drawer (cleaning up finished PRD draft if opening ST-01)
  const openStationDrawer = useCallback(
    (stationId: FactoryStationId) => {
      if (stationId === 'ST-01') {
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
      setDrawerStationId(stationId);
    },
    [analysisJob, runs]
  );

  const handleNavigateFromTasksDrawer = useCallback(
    (section: NavSectionId, task?: BackgroundTask) => {
      if (section === 'studio') {
        setDrawerStationId(null);
      } else {
        if (section === 'quality' && task) {
          if (task.kind === 'signals_triage') {
            setFocusedQualityTarget({ topSection: 'feedback', nonce: Date.now() });
          } else if (task.kind === 'signals_autofix') {
            setFocusedQualityTarget({ topSection: 'errors', nonce: Date.now() });
          }
        }
        openStationDrawer(ROOM_TO_STATION[section]);
      }
    },
    [openStationDrawer]
  );

  const handleSelectCameraPreset = useCallback((preset: CameraPresetId) => {
    setCameraPreset(preset);
    setCameraPresetNonce((n) => n + 1);
  }, []);

  const handleUserOrbitStart = useCallback(() => {
    setCameraPreset(null);
  }, []);

  const handleSwitchMode = (nextMode: FactoryMode) => {
    setFactoryMode(nextMode);
    if (nextMode === 'demo') {
      setDemoPhaseIndex(0);
      setDemoManualStamped(false);
      setDemoPlaying(true);
      handleSelectCameraPreset('overview');
    } else {
      handleSelectCameraPreset('overview');
    }
  };

  // Compute live snapshot for current factory mode
  const factorySnapshot = useMemo(() => {
    if (factoryMode === 'demo') {
      return getDemoFactorySnapshot(demoPhaseIndex, {
        manualStampTriggered: demoManualStamped,
      });
    }
    return deriveRealFactorySnapshot({
      runs,
      analysisJob,
      backgroundTasks,
      status,
      overviewMetrics,
      rsiReports,
      rsiRules,
      approvedStampRunId,
      activeCodingActionRunning,
      latestCodingActionConclusion,
      celebratingDeliveredRunId,
    });
  }, [
    activeCodingActionRunning,
    analysisJob,
    approvedStampRunId,
    backgroundTasks,
    celebratingDeliveredRunId,
    demoManualStamped,
    demoPhaseIndex,
    factoryMode,
    latestCodingActionConclusion,
    overviewMetrics,
    rsiReports,
    rsiRules,
    runs,
    status,
  ]);

  const runningTasksCount =
    backgroundTasks.filter((t) => t.status === 'running').length +
    (analysisJob?.status === 'running' ? 1 : 0);

  return (
    <div className="relative w-screen h-screen overflow-hidden text-[#0F172A] bg-[#B6DCF6]">
      {/* =====================================================================
          FULL-SCREEN 3D SUNLIT MINIATURE ARCHITECTURAL AUTOMATION VILLAGE
         ===================================================================== */}
      <VillageViewport
        snapshot={factorySnapshot}
        repoFullName={selectedRepo.fullName}
        factoryMode={factoryMode}
        atmospherePreset={atmospherePreset}
        cameraPreset={cameraPreset}
        cameraPresetNonce={cameraPresetNonce}
        runningTasksCount={runningTasksCount}
        focusBuildingId={focusBuildingId}
        focusBuildingNonce={focusBuildingNonce}
        showBuildingLabels={showBuildingLabels}
        paused={Boolean(
          drawerStationId ||
            tasksDrawerOpen ||
            previewZoomOpen ||
            reportModalRequirementId ||
            unlockModalOpen
        )}
        onSelectStation={openStationDrawer}
        onSelectBackgroundTasks={() => setTasksDrawerOpen(true)}
        onSwitchMode={handleSwitchMode}
        onUserOrbitStart={handleUserOrbitStart}
        onCelebrationComplete={() => setCelebratingDeliveredRunId(null)}
      />

      {/* =====================================================================
          COLLAPSIBLE BOTTOM-CENTER CAMERA, SEASON & DEPARTMENT CONTROL DOCK
         ===================================================================== */}
      <VillageBottomDock
        factoryMode={factoryMode}
        cameraPreset={cameraPreset}
        atmospherePreset={atmospherePreset}
        runningTasksCount={runningTasksCount}
        demoPhaseIndex={demoPhaseIndex}
        demoPlaying={demoPlaying}
        showBuildingLabels={showBuildingLabels}
        onToggleBuildingLabels={() => setShowBuildingLabels((prev) => !prev)}
        notificationPermission={notificationPermission}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={handleToggleNotifications}
        isEditUnlocked={isEditUnlocked}
        onOpenUnlockModal={() => openUnlockModal()}
        onSelectCameraPreset={handleSelectCameraPreset}
        onSelectAtmosphere={setAtmospherePreset}
        onOpenStation={openStationDrawer}
        onOpenTasks={() => setTasksDrawerOpen(true)}
        onDemoSelectPhase={(idx) => {
          setDemoPlaying(false);
          setDemoPhaseIndex(idx);
          if (idx < 6) setDemoManualStamped(false);
        }}
        onDemoTogglePlay={() => setDemoPlaying((p) => !p)}
        onDemoNextStep={() => {
          setDemoPhaseIndex((prev) => {
            const next = (prev + 1) % DEMO_PIPELINE_PHASES.length;
            if (next === 0) setDemoManualStamped(false);
            return next;
          });
        }}
        onDemoReplay={() => {
          setDemoPhaseIndex(0);
          setDemoManualStamped(false);
          setDemoPlaying(true);
        }}
      />

      {/* =====================================================================
          CENTERED ARCHITECTURAL PAVILION DEPARTMENT DETAIL MODAL
         ===================================================================== */}
      <DepartmentPavilionModal
        stationId={drawerStationId}
        snapshot={factorySnapshot}
        repoFullName={selectedRepo.fullName}
        isEditUnlocked={isEditUnlocked}
        onOpenUnlockModal={openUnlockModal}
        onSelectStation={openStationDrawer}
        onFocusBuilding={(sid) => {
          setCameraPreset(null);
          setFocusBuildingId(sid);
          setFocusBuildingNonce((n) => n + 1);
        }}
        onClose={() => setDrawerStationId(null)}
      >
        {drawerStationId === 'ST-00' && (
          <EnvironmentView
            status={status}
            loading={statusLoading}
            error={statusError}
            onRefresh={fetchIntegrationsStatus}
            selectedRepo={selectedRepo}
            onSelectRepo={handleSelectRepo}
            onEnvironmentReset={handleEnvironmentReset}
            onBackgroundTaskStarted={handleBackgroundTaskStarted}
            onOpenSignalsTab={(tab) => {
              setFocusedQualityTarget({
                topSection: tab,
                nonce: Date.now(),
              });
              openStationDrawer('ST-03');
            }}
            refreshNonce={refreshNonce}
            onErrorToast={pushErrorToast}
            onSuccessToast={pushSuccessToast}
          />
        )}

        {drawerStationId === 'ST-01' && (
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
            onClosePavilion={() => setDrawerStationId(null)}
            onGoToEnvironment={() => openStationDrawer('ST-00')}
            onGoToPipeline={() => openStationDrawer('ST-02')}
            onGoToApproval={(runId) => {
              setActiveRunId(runId);
              openStationDrawer('ST-04');
            }}
            onErrorToast={pushErrorToast}
            onSuccessToast={pushSuccessToast}
          />
        )}

        {drawerStationId === 'ST-02' && (
          <PipelineBoardView
            runs={runs}
            relatedJobs={analysisJobs}
            selectedRunId={activeRunId}
            onSelectRun={setActiveRunId}
            cloudflareStatus={status?.cloudflare}
            githubConnected={Boolean(status?.github.connected)}
            isRequirementInProgress={isRequirementInProgress}
            onGoToNewPrd={() => openStationDrawer('ST-01')}
            onGoToApproval={(runId) => {
              setActiveRunId(runId);
              openStationDrawer('ST-04');
            }}
            onErrorToast={pushErrorToast}
            onSuccessToast={pushSuccessToast}
          />
        )}

        {drawerStationId === 'ST-03' && (
          <QualityRsiView
            repoFullName={selectedRepo.fullName}
            focusedTarget={focusedQualityTarget}
            onClearFocusedTarget={handleClearFocusedQualityTarget}
            activeTasks={backgroundTasks}
            onBackgroundTaskStarted={handleBackgroundTaskStarted}
            onClosePavilion={() => setDrawerStationId(null)}
            refreshNonce={refreshNonce}
            onErrorToast={pushErrorToast}
            onSuccessToast={pushSuccessToast}
          />
        )}

        {drawerStationId === 'ST-04' && (
          <ApprovalView
            runs={runs}
            selectedRunId={activeRunId}
            onSelectRun={setActiveRunId}
            onRunUpdated={handleRunUpdated}
            onBackgroundTaskStarted={handleBackgroundTaskStarted}
            onClosePavilion={() => setDrawerStationId(null)}
            isRequirementInProgress={isRequirementInProgress}
            onGoToNewPrd={() => openStationDrawer('ST-01')}
            onGoToQuality={(target) => {
              setFocusedQualityTarget({
                reportId: target?.reportId,
                actionsRunId: target?.actionsRunId,
                nonce: Date.now(),
              });
              openStationDrawer('ST-03');
            }}
            onErrorToast={pushErrorToast}
            onSuccessToast={pushSuccessToast}
          />
        )}

        {drawerStationId === 'ST-05' && (
          <RequirementsBoardView
            repoFullName={selectedRepo.fullName}
            isRequirementInProgress={isRequirementInProgress}
            refreshNonce={refreshNonce}
            onGoToNewPrd={() => openStationDrawer('ST-01')}
            onGoToPipeline={(runId) => {
              setActiveRunId(runId);
              openStationDrawer('ST-02');
            }}
            onGoToApproval={(runId) => {
              setActiveRunId(runId);
              openStationDrawer('ST-04');
            }}
            onBackgroundTaskStarted={handleBackgroundTaskStarted}
            onRecordDeleted={handleRecordDeleted}
            onSuccessToast={pushSuccessToast}
            onErrorToast={pushErrorToast}
          />
        )}
      </DepartmentPavilionModal>

      {/* Preview Zoom Modal (ST-04) */}
      <PreviewZoomModal
        open={previewZoomOpen}
        mode={factoryMode}
        previewUrl={factorySnapshot.st04.previewUrl}
        title={factorySnapshot.st04.previewTitle}
        subtitle={factorySnapshot.st04.previewSubtitle}
        prNumber={factorySnapshot.st04.prNumber}
        onClose={() => setPreviewZoomOpen(false)}
      />

      {/* Direct Full Requirement Report Modal (ST-05 1-Click) */}
      {reportModalRequirementId && (
        <RequirementReportModal
          requirementId={reportModalRequirementId}
          onClose={() => setReportModalRequirementId(null)}
          onSuccessToast={pushSuccessToast}
          onErrorToast={pushErrorToast}
        />
      )}

      {/* Detached Background Operations 3D Cleanroom Glass Modal */}
      <BackgroundTasksPanel
        open={tasksDrawerOpen}
        onClose={() => setTasksDrawerOpen(false)}
        tasks={backgroundTasks}
        runningAnalysisJob={analysisJob}
        repoFullName={selectedRepo.fullName}
        onFocusOpsBuilding={() => {
          setCameraPreset(null);
          setFocusBuildingId('BG-OPS');
          setFocusBuildingNonce((n) => n + 1);
        }}
        onNavigateToRoom={handleNavigateFromTasksDrawer}
      />

      {/* Password-Gated Edit Permission Modal */}
      <EditUnlockModal
        open={unlockModalOpen}
        unlocked={isEditUnlocked}
        reason={unlockReason}
        meta={editAuthMeta}
        onClose={() => {
          setUnlockModalOpen(false);
          setUnlockReason(null);
        }}
        onUnlocked={(meta) => {
          setIsEditUnlocked(true);
          setEditAuthMeta(meta);
          setUnlockReason(null);
        }}
        onLocked={(meta) => {
          setIsEditUnlocked(false);
          if (meta) setEditAuthMeta(meta);
        }}
        onSuccessToast={pushSuccessToast}
      />

      {/* Cleanroom Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
