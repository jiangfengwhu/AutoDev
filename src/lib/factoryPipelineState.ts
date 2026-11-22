import type {
  AnalysisJob,
  BackgroundTask,
  IntegrationsStatusResponse,
  PipelineRun,
} from '../types/autodev';
import type { SevenDayOverviewMetrics } from './overviewMetrics';
import type { RsiSystemRule, TestExecutionReport } from './rsiEngine';
import type { StudioRoomId } from './studioTheme';

export type FactoryStationId = 'ST-00' | 'ST-01' | 'ST-02' | 'ST-03' | 'ST-04' | 'ST-05';
export type FactoryMode = 'real' | 'demo';
export type StationLedState = 'idle' | 'running' | 'waiting' | 'passed' | 'rework';

export type ConveyorSegmentState = 'idle' | 'active' | 'passed' | 'rework';

export interface StationMeta {
  stationId: FactoryStationId;
  roomId: StudioRoomId;
  title: string;
  roleSubtitle: string;
  departmentCode: string;
  departmentMission: string;
}

export const FACTORY_STATIONS: Record<FactoryStationId, StationMeta> = {
  'ST-00': {
    stationId: 'ST-00',
    roomId: 'environment',
    title: '指挥调度中心',
    roleSubtitle: '全局监控中枢与引擎装配',
    departmentCode: 'HQ · OPS',
    departmentMission: '环境连通性、算力配额与仓库安全调度',
  },
  'ST-01': {
    stationId: 'ST-01',
    roomId: 'prd',
    title: '架构策划部',
    roleSubtitle: 'PRD-to-Spec 编译中心',
    departmentCode: 'ARCH · SPEC',
    departmentMission: '单对话需求澄清、架构任务树与 E2E 验收规格生成',
  },
  'ST-02': {
    stationId: 'ST-02',
    roomId: 'pipeline',
    title: 'Gemini 编码圣殿',
    roleSubtitle: '自动化编码与冒烟沙箱',
    departmentCode: 'GEMINI · CODE',
    departmentMission: 'Draft PR 分支编码、实时日志追踪与自动返工修复',
  },
  'ST-03': {
    stationId: 'ST-03',
    roomId: 'quality',
    title: '质检进化圣殿',
    roleSubtitle: 'E2E 验收与 RSI 规则沉淀',
    departmentCode: 'QA · RSI',
    departmentMission: '自动化 E2E 验收、失败根因归因与系统防护规则自进化',
  },
  'ST-04': {
    stationId: 'ST-04',
    roomId: 'approval',
    title: '验收签批部',
    roleSubtitle: 'Preview 预览验收与上线门禁',
    departmentCode: 'REVIEW · GATE',
    departmentMission: 'Cloudflare 预览核验、退回修订与一键合并上线',
  },
  'ST-05': {
    stationId: 'ST-05',
    roomId: 'requirements',
    title: '项目档案部',
    roleSubtitle: '成果归档与端到端交付报告',
    departmentCode: 'ARCHIVE · DOC',
    departmentMission: '全周期需求看板、Token 审计与完整交付复盘归档',
  },
};

export interface RackLedItem {
  id: string;
  label: string;
  tone: 'emerald' | 'blue' | 'amber' | 'slate';
  durationSec: number;
  delaySec: number;
}

export interface StickyNoteItem {
  id: string;
  tag: string;
  text: string;
  color: 'yellow' | 'blue' | 'green';
  tiltDeg: number;
}

export interface DagNodePreview {
  id: string;
  label: string;
  active: boolean;
  done: boolean;
}

export interface QaMatrixCell {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'running' | 'pending';
}

export interface FactoryWorkpiecePod {
  prNumberLabel: string;
  title: string;
  statusLabel: string;
  tone: StationLedState;
  location:
    | 'ST-01'
    | 'track_1_2'
    | 'ST-02'
    | 'track_2_3'
    | 'ST-03'
    | 'rework_3_2'
    | 'track_3_4'
    | 'ST-04'
    | 'track_4_5'
    | 'ST-05';
  repairRound: number;
}

export interface FactoryPipelineSnapshot {
  mode: FactoryMode;
  phaseIndex?: number;
  phaseLabel: string;
  phaseDescription: string;
  activeStationId: FactoryStationId;
  /** True ONLY when a requirement just completed delivery in this live session (triggers archive transit + village celebration) */
  justDelivered?: boolean;
  workpiece: FactoryWorkpiecePod | null;
  tracks: {
    st01ToSt02: ConveyorSegmentState;
    st02ToSt03: ConveyorSegmentState;
    reworkSt03ToSt02: ConveyorSegmentState;
    st03ToSt04: ConveyorSegmentState;
    st04ToSt05: ConveyorSegmentState;
  };
  stationStates: Record<FactoryStationId, { led: StationLedState; statusText: string }>;
  st00: {
    successRatePct: number | null;
    totalTokens: number;
    deliveredCount: number;
    runningCount: number;
    dailySeries: Array<{
      label: string;
      successRate: number;
      tokensK: number;
    }>;
    rackLeds: RackLedItem[];
  };
  st01: {
    dagNodes: DagNodePreview[];
    stickyNotes: StickyNoteItem[];
    p0Count: number;
    taskCount: number;
  };
  st02: {
    branchName: string;
    modelName: string;
    isSparking: boolean;
    repairRound: number;
    diffLines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>;
    smokeLogs: string[];
  };
  st03: {
    cells: QaMatrixCell[];
    passRateText: string;
    testsLockLabel: string;
    rsiRules: Array<{ code: string; title: string; isNew?: boolean }>;
  };
  st04: {
    previewUrl: string | null;
    previewTitle: string;
    previewSubtitle: string;
    criteriaChecked: number;
    criteriaTotal: number;
    isAwaitingApproval: boolean;
    isApprovedStamped: boolean;
    prNumber: number | null;
  };
  st05: {
    deliveredCount: number;
    activeDrawerIndex: number | null; // 0, 1, 2 or null
    latestReportId: string | null;
    latestTitle: string;
    latestDurationText: string;
    latestRepairRounds: number;
    latestPassRateText: string;
  };
}

export interface RealFactoryInputs {
  runs: PipelineRun[];
  analysisJob: AnalysisJob | null;
  backgroundTasks: BackgroundTask[];
  status: IntegrationsStatusResponse | null;
  overviewMetrics: SevenDayOverviewMetrics | null;
  rsiReports: TestExecutionReport[];
  rsiRules: RsiSystemRule[];
  approvedStampRunId?: string | null;
  activeCodingActionRunning?: boolean;
  /** Latest completed Coding Runner conclusion for the active PR ('success' | 'failure' | 'cancelled' | null) */
  latestCodingActionConclusion?: string | null;
  /** Run ID that JUST transitioned to delivered/approved in the current session so the village plays archive transit + celebration before returning to idle */
  celebratingDeliveredRunId?: string | null;
}

export function buildRackLeds(
  status: IntegrationsStatusResponse | null,
  runningCount: number
): RackLedItem[] {
  const ghOnline = Boolean(status?.github.connected);
  const cfOnline = Boolean(status?.cloudflare.connected);
  const aiOnline = Boolean(status?.gemini.configured);

  const presets: Array<{ label: string; tone: RackLedItem['tone'] }> = [
    { label: 'GH01', tone: ghOnline ? 'emerald' : 'slate' },
    { label: 'ACT1', tone: ghOnline ? 'emerald' : 'slate' },
    { label: 'VPS1', tone: runningCount > 0 ? 'blue' : ghOnline ? 'emerald' : 'slate' },
    { label: 'AGY1', tone: runningCount > 0 ? 'blue' : aiOnline ? 'emerald' : 'slate' },
    { label: 'CFW1', tone: cfOnline ? 'emerald' : 'slate' },
    { label: 'CFD1', tone: cfOnline ? 'emerald' : 'slate' },
    { label: 'SYNC', tone: ghOnline ? 'blue' : 'slate' },
    { label: 'QA01', tone: 'emerald' },
    { label: 'RSI1', tone: 'blue' },
    { label: 'BG01', tone: runningCount > 0 ? 'amber' : 'emerald' },
    { label: 'BG02', tone: runningCount > 1 ? 'amber' : 'emerald' },
    { label: 'TOKN', tone: aiOnline ? 'blue' : 'slate' },
    { label: 'SYS0', tone: 'emerald' },
    { label: 'NET0', tone: ghOnline ? 'emerald' : 'slate' },
    { label: 'LOG0', tone: 'blue' },
    { label: 'CLK0', tone: 'emerald' },
  ];

  return presets.map((p, i) => ({
    id: `led-${i}`,
    label: p.label,
    tone: p.tone,
    durationSec: 1.6 + ((i * 7) % 5) * 0.45,
    delaySec: ((i * 3) % 7) * 0.28,
  }));
}

export function deriveRealFactorySnapshot(input: RealFactoryInputs): FactoryPipelineSnapshot {
  const {
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
  } = input;

  const runningBgTasks = backgroundTasks.filter((t) => t.status === 'running');
  const runningCount = runningBgTasks.length + (analysisJob?.status === 'running' ? 1 : 0);

  const deliveredRuns = runs.filter(
    (r) => Boolean(r.mergedRelease) || r.status === 'approved'
  );
  const activeRun =
    runs.find((r) => !r.mergedRelease && r.status !== 'approved') ?? runs[0] ?? null;

  // Determine real active stage
  let activeStationId: FactoryStationId = 'ST-00';
  let phaseLabel = '产线待命';
  let phaseDescription = '全线引擎就绪，可从左上方投放新 PRD 启动自动化流水线';
  let workpiece: FactoryWorkpiecePod | null = null;

  const tracks: FactoryPipelineSnapshot['tracks'] = {
    st01ToSt02: 'idle',
    st02ToSt03: 'idle',
    reworkSt03ToSt02: 'idle',
    st03ToSt04: 'idle',
    st04ToSt05: 'idle',
  };

  const stationStates: FactoryPipelineSnapshot['stationStates'] = {
    'ST-00': {
      led: runningCount > 0 ? 'running' : 'passed',
      statusText: runningCount > 0 ? `${runningCount} 项运行中` : '监控正常',
    },
    'ST-01': { led: 'idle', statusText: '白板待命' },
    'ST-02': { led: 'idle', statusText: '沙箱空闲' },
    'ST-03': { led: 'idle', statusText: '质检待命' },
    'ST-04': { led: 'idle', statusText: '等待交付' },
    'ST-05': {
      led: deliveredRuns.length > 0 ? 'passed' : 'idle',
      statusText: deliveredRuns.length > 0 ? `已归档 ${deliveredRuns.length} 项` : '档案待建',
    },
  };

  // Strictly match QA report to activeRun (NEVER fall back to an older PR's failed report!)
  const latestReportForActive = activeRun
    ? rsiReports.find(
        (rep) =>
          rep.pipelineRunId === activeRun.id ||
          (Boolean(activeRun.draftPr?.branchName) && rep.branch === activeRun.draftPr?.branchName)
      )
    : rsiReports[0];

  const hasActiveRunInFlight = Boolean(
    activeRun && !activeRun.mergedRelease && activeRun.status !== 'approved'
  );

  const creatingDraftPrTask = runningBgTasks.find(
    (t) =>
      t.kind === 'create_draft_pr' &&
      (!t.runId || !activeRun || t.runId === activeRun.id)
  );
  const isCreatingDraftPr = Boolean(creatingDraftPrTask);

  const isCodingTaskRunning =
    runningBgTasks.some(
      (t) =>
        t.kind === 'request_rework' &&
        (!t.runId || !activeRun || t.runId === activeRun.id)
    ) || Boolean(activeCodingActionRunning);

  if (analysisJob?.status === 'running') {
    activeStationId = 'ST-01';
    phaseLabel = 'ST-01 架构拆解中';
    phaseDescription = `架构策划部正在单对话联合编译「${analysisJob.prdTitle}」的架构任务树与 E2E 验收规格`;
    stationStates['ST-01'] = { led: 'running', statusText: '编译 Spec 中' };
    workpiece = {
      prNumberLabel: 'SPEC-NEW',
      title: analysisJob.prdTitle,
      statusLabel: '架构拆解',
      tone: 'running',
      location: 'ST-01',
      repairRound: 0,
    };
  } else if (isCreatingDraftPr) {
    const title = activeRun?.prdTitle || creatingDraftPrTask?.title || 'Draft PR';
    activeStationId = 'ST-01';
    phaseLabel = 'ST-01 创建 PR 中';
    phaseDescription = `架构策划部正在提交 Spec 与 E2E 验收用例并创建「${title}」GitHub Draft PR`;
    stationStates['ST-01'] = { led: 'running', statusText: '创建 PR 中' };
    tracks.st01ToSt02 = 'active';
    workpiece = {
      prNumberLabel: 'CREATING-PR',
      title,
      statusLabel: '创建 PR 中',
      tone: 'running',
      location: 'ST-01',
      repairRound: 0,
    };
  } else if (hasActiveRunInFlight && activeRun) {
    const prTag = activeRun.draftPr ? `PR #${activeRun.draftPr.prNumber}` : 'DRAFT-SPEC';
    if (!activeRun.draftPr) {
      activeStationId = 'ST-01';
      phaseLabel = 'ST-01 待建 Draft PR';
      phaseDescription = `「${activeRun.prdTitle}」蓝图已就绪，进入架构策划部审阅并推送 Draft PR`;
      stationStates['ST-01'] = { led: 'waiting', statusText: '待推 Draft PR' };
      tracks.st01ToSt02 = 'active';
      workpiece = {
        prNumberLabel: prTag,
        title: activeRun.prdTitle,
        statusLabel: '待建 PR',
        tone: 'waiting',
        location: 'ST-01',
        repairRound: 0,
      };
    } else if (activeRun.status === 'changes_requested') {
      activeStationId = 'ST-02';
      phaseLabel = 'REWORK LOOP 返工修复';
      phaseDescription = `「${activeRun.prdTitle}」触发返工回流，Gemini 编码圣殿正在原分支增量修复`;
      stationStates['ST-01'] = { led: 'passed', statusText: '规格已锁定' };
      stationStates['ST-02'] = { led: 'rework', statusText: '返工修复中' };
      stationStates['ST-03'] = { led: 'idle', statusText: '等待复测' };
      tracks.st01ToSt02 = 'passed';
      tracks.st02ToSt03 = 'rework';
      tracks.reworkSt03ToSt02 = 'rework';
      workpiece = {
        prNumberLabel: prTag,
        title: activeRun.prdTitle,
        statusLabel: '返工修复',
        tone: 'rework',
        location: 'rework_3_2',
        repairRound: 1,
      };
    } else {
      const qaFailed =
        Boolean(latestReportForActive && latestReportForActive.failed > 0) ||
        latestCodingActionConclusion === 'failure';
      const qaPassed = Boolean(
        latestReportForActive &&
          latestReportForActive.total > 0 &&
          latestReportForActive.failed === 0
      );
      const codingSucceeded =
        !isCodingTaskRunning &&
        (Boolean(activeRun.previewDeployment) ||
          latestCodingActionConclusion === 'success' ||
          qaPassed);

      if (isCodingTaskRunning) {
        // Active coding OR active rework-coding: STRICTLY ONLY ST-02 (Gemini Coding Sanctuary) is active!
        const isReworkCoding = qaFailed;
        activeStationId = 'ST-02';
        phaseLabel = isReworkCoding ? 'ST-02 返工修复中' : 'ST-02 自动编码中';
        phaseDescription = isReworkCoding
          ? `Gemini 编码圣殿正在针对「${activeRun.prdTitle}」的质检报错进行增量修复`
          : `Gemini 编码圣殿正在为「${activeRun.prdTitle}」编写代码并运行 E2E 验证`;
        stationStates['ST-01'] = { led: 'passed', statusText: '规格已锁定' };
        stationStates['ST-02'] = {
          led: isReworkCoding ? 'rework' : 'running',
          statusText: isReworkCoding ? '返工修复中' : '编码加工中',
        };
        stationStates['ST-03'] = {
          led: 'idle',
          statusText: isReworkCoding ? '等待复测' : '等待送检',
        };
        tracks.st01ToSt02 = 'passed';
        tracks.st02ToSt03 = isReworkCoding ? 'rework' : 'active';
        if (isReworkCoding) tracks.reworkSt03ToSt02 = 'rework';
        workpiece = {
          prNumberLabel: prTag,
          title: activeRun.prdTitle,
          statusLabel: isReworkCoding ? '返工修复中' : '编码加工',
          tone: isReworkCoding ? 'rework' : 'running',
          location: isReworkCoding ? 'rework_3_2' : 'ST-02',
          repairRound: isReworkCoding ? 1 : 0,
        };
      } else if (codingSucceeded) {
        // Coding + E2E succeeded (or Preview already deployed): AUTOMATICALLY flow to ST-04 验收签批部!
        activeStationId = 'ST-04';
        phaseLabel = 'ST-04 等待人工签批';
        phaseDescription = activeRun.previewDeployment
          ? `「${activeRun.prdTitle}」Cloudflare 预览已就绪，等待验收签批部确认上线`
          : `「${activeRun.prdTitle}」编码与 E2E 验证已完成，已自动流转至验收签批部待验收`;
        stationStates['ST-01'] = { led: 'passed', statusText: '规格已完成' };
        stationStates['ST-02'] = { led: 'passed', statusText: '构建通过' };
        stationStates['ST-03'] = { led: 'passed', statusText: 'E2E 通过' };
        stationStates['ST-04'] = { led: 'waiting', statusText: '等待签批' };
        tracks.st01ToSt02 = 'passed';
        tracks.st02ToSt03 = 'passed';
        tracks.st03ToSt04 = 'active';
        workpiece = {
          prNumberLabel: prTag,
          title: activeRun.prdTitle,
          statusLabel: '待验收签批',
          tone: 'waiting',
          location: 'ST-04',
          repairRound: 0,
        };
      } else if (qaFailed) {
        // Coding runner or QA report for THIS exact PR failed and no coding runner is currently active
        activeStationId = 'ST-03';
        phaseLabel = 'ST-03 质检拦截';
        phaseDescription = `「${activeRun.prdTitle}」在质检进化圣殿捕获异常，准备回流修复`;
        stationStates['ST-01'] = { led: 'passed', statusText: '规格已锁定' };
        stationStates['ST-02'] = { led: 'idle', statusText: '待修复' };
        stationStates['ST-03'] = { led: 'rework', statusText: '质检拦截' };
        tracks.st01ToSt02 = 'passed';
        tracks.st02ToSt03 = 'rework';
        tracks.reworkSt03ToSt02 = 'rework';
        workpiece = {
          prNumberLabel: prTag,
          title: activeRun.prdTitle,
          statusLabel: '质检拦截',
          tone: 'rework',
          location: 'ST-03',
          repairRound: 1,
        };
      } else {
        // Draft PR freshly created; awaiting Coding Runner pickup at ST-02
        activeStationId = 'ST-02';
        phaseLabel = 'ST-02 自动编码中';
        phaseDescription = `Gemini 编码圣殿正在为「${activeRun.prdTitle}」准备编码与 E2E 验证`;
        stationStates['ST-01'] = { led: 'passed', statusText: '规格已锁定' };
        stationStates['ST-02'] = { led: 'running', statusText: '编码加工中' };
        stationStates['ST-03'] = { led: 'idle', statusText: '等待送检' };
        tracks.st01ToSt02 = 'passed';
        tracks.st02ToSt03 = 'active';
        workpiece = {
          prNumberLabel: prTag,
          title: activeRun.prdTitle,
          statusLabel: '编码加工',
          tone: 'running',
          location: 'ST-02',
          repairRound: 0,
        };
      }
    }
  } else if (deliveredRuns.length > 0 && celebratingDeliveredRunId) {
    const celebratingRun =
      deliveredRuns.find((r) => r.id === celebratingDeliveredRunId) ?? deliveredRuns[0];
    activeStationId = 'ST-05';
    phaseLabel = 'ST-05 上线归档庆祝中';
    phaseDescription = `「${celebratingRun.prdTitle}」已成功上线并归档至项目档案部`;
    stationStates['ST-01'] = { led: 'passed', statusText: '就绪' };
    stationStates['ST-02'] = { led: 'passed', statusText: '就绪' };
    stationStates['ST-03'] = { led: 'passed', statusText: 'E2E 通过' };
    stationStates['ST-04'] = { led: 'passed', statusText: '已签批上线' };
    stationStates['ST-05'] = { led: 'passed', statusText: `已归档 ${deliveredRuns.length} 项` };
    tracks.st01ToSt02 = 'passed';
    tracks.st02ToSt03 = 'passed';
    tracks.st03ToSt04 = 'passed';
    tracks.st04ToSt05 = 'passed';
    workpiece = {
      prNumberLabel: celebratingRun.draftPr ? `PR #${celebratingRun.draftPr.prNumber}` : 'RELEASED',
      title: celebratingRun.prdTitle,
      statusLabel: '归档入库中',
      tone: 'passed',
      location: 'ST-05',
      repairRound: 0,
    };
  }
  // When no run is in-flight and no delivery celebration is active, stay cleanly in ST-00 idle state
  // with workpiece = null so ZERO parcels linger on the conveyor belts!

  // ST-00 7-day daily series from real overviewMetrics
  const dailySeries =
    overviewMetrics?.daily && overviewMetrics.daily.length > 0
      ? overviewMetrics.daily.map((d) => ({
          label: d.label,
          successRate: d.successRate ?? 0,
          tokensK: Math.round((d.totalTokens || 0) / 1000),
        }))
      : [
          { label: 'D-6', successRate: 0, tokensK: 0 },
          { label: 'D-5', successRate: 0, tokensK: 0 },
          { label: 'D-4', successRate: 0, tokensK: 0 },
          { label: 'D-3', successRate: 0, tokensK: 0 },
          { label: 'D-2', successRate: 0, tokensK: 0 },
          { label: 'D-1', successRate: 0, tokensK: 0 },
          { label: '今日', successRate: 0, tokensK: 0 },
        ];

  // ST-01 DAG & Sticky Notes from real activeRun
  const realTasks = activeRun?.architect?.tasks ?? [];
  const dagNodes: DagNodePreview[] =
    realTasks.length > 0
      ? realTasks.slice(0, 4).map((t, idx) => ({
          id: t.id,
          label: t.module || t.title.slice(0, 8),
          active: stationStates['ST-01'].led === 'running' && idx === 1,
          done: stationStates['ST-01'].led === 'passed',
        }))
      : [
          { id: 'T1', label: 'PRD 语义解析', active: false, done: false },
          { id: 'T2', label: 'API 契约生成', active: false, done: false },
          { id: 'T3', label: 'DAG 任务编排', active: false, done: false },
          { id: 'T4', label: 'E2E 验收集', active: false, done: false },
        ];

  const realAmbiguities = activeRun?.architect?.ambiguities ?? [];
  const realDecisions = activeRun?.architect?.techDecisions ?? [];
  const stickyNotes: StickyNoteItem[] = [];
  realAmbiguities.slice(0, 3).forEach((amb, idx) => {
    stickyNotes.push({
      id: amb.id || `amb-${idx}`,
      tag: amb.severity === 'high' ? 'P0 歧义' : 'P1 假设',
      text: amb.title,
      color: amb.severity === 'high' ? 'yellow' : 'blue',
      tiltDeg: idx % 2 === 0 ? -1.5 : 1.5,
    });
  });
  realDecisions.slice(0, Math.max(0, 4 - stickyNotes.length)).forEach((dec, idx) => {
    stickyNotes.push({
      id: `dec-${idx}`,
      tag: '架构要点',
      text: dec,
      color: 'green',
      tiltDeg: idx % 2 === 0 ? 1.2 : -1.2,
    });
  });
  if (stickyNotes.length === 0) {
    stickyNotes.push(
      { id: 'n1', tag: 'P0 歧义', text: '等待投放新需求提取歧义项', color: 'yellow', tiltDeg: -1.5 },
      { id: 'n2', tag: 'P1 假设', text: '自动补齐边界与异常状态假设', color: 'blue', tiltDeg: 1.4 },
      { id: 'n3', tag: '契约输出', text: '单对话编译 docs/spec.json', color: 'green', tiltDeg: -1.0 },
      { id: 'n4', tag: 'E2E 验收', text: '生成透明 Playwright 验收测试集', color: 'blue', tiltDeg: 1.2 }
    );
  }

  // ST-02 real code & smoke preview
  const isSt02Coding =
    stationStates['ST-02'].led === 'running' || stationStates['ST-02'].led === 'rework';
  const branchName =
    activeRun?.draftPr?.branchName || activeRun?.defaultBranch || 'main';
  const diffLines: FactoryPipelineSnapshot['st02']['diffLines'] = [
    { type: 'ctx', text: `// branch: ${branchName}` },
    { type: 'add', text: `+ export async function handleRequirement(req) {` },
    { type: 'add', text: `+   const validated = assertSpecContract(req.body);` },
    { type: 'del', text: `-   return legacyHandler(req);` },
    { type: 'add', text: `+   return commitAtomicResult(validated);` },
    { type: 'ctx', text: `  }` },
  ];
  const smokeLogs = [
    `[runner] workspace=${activeRun?.repoFullName ?? 'jiangfengwhu/atd-v1'}`,
    `[tsc] typecheck passed (0 errors)`,
    `[vite] production bundle compiled in 1.8s`,
    isSt02Coding ? `[agy] applying task patches & running smoke suite...` : `[idle] awaiting next Draft PR dispatch`,
  ];

  // ST-03 real blind QA matrix & RSI rules
  const latestQa = latestReportForActive;
  const qaCells: QaMatrixCell[] = [];
  if (latestQa && latestQa.total > 0) {
    const passCount = Math.min(8, Math.round((latestQa.passed / latestQa.total) * 8));
    const failCount = latestQa.failed > 0 ? Math.max(1, Math.min(8 - passCount, 2)) : 0;
    for (let i = 0; i < 8; i += 1) {
      qaCells.push({
        id: `qa-${i}`,
        label: `TC-${String(i + 1).padStart(2, '0')}`,
        status: i < passCount ? 'pass' : i < passCount + failCount ? 'fail' : 'pending',
      });
    }
  } else {
    for (let i = 0; i < 8; i += 1) {
      qaCells.push({
        id: `qa-${i}`,
        label: `TC-${String(i + 1).padStart(2, '0')}`,
        status: deliveredRuns.length > 0 ? 'pass' : 'pending',
      });
    }
  }

  const activeRsiRules = rsiRules
    .filter((r) => r.status === 'active' || r.status === 'candidate')
    .slice(0, 4)
    .map((r, i) => ({
      code: `RULE+${String(i + 1).padStart(2, '0')}`,
      title: r.title,
      isNew: r.status === 'candidate',
    }));

  if (activeRsiRules.length === 0) {
    activeRsiRules.push(
      { code: 'RULE+01', title: '强制校验空列表与边界状态渲染防白屏', isNew: false },
      { code: 'RULE+02', title: '写操作接口启用幂等去重与错误回显', isNew: false }
    );
  }

  // ST-04 approval preview & stamp
  const criteriaTotal =
    activeRun?.architect?.tasks?.reduce((acc, t) => acc + t.acceptanceCriteria.length, 0) ?? 0;
  const criteriaChecked = activeRun?.checkedCriteriaIds?.length ?? 0;
  const isApprovedStamped = Boolean(
    activeRun &&
      (activeRun.mergedRelease ||
        activeRun.status === 'approved' ||
        approvedStampRunId === activeRun.id)
  );

  // ST-05 archive summary
  const latestDelivered = deliveredRuns[0] ?? activeRun;
  const latestQaPassPct =
    latestQa && latestQa.total > 0
      ? `${Math.round((latestQa.passed / latestQa.total) * 100)}%`
      : overviewMetrics?.summary.overallSuccessRate !== null &&
          overviewMetrics?.summary.overallSuccessRate !== undefined
        ? `${Math.round(overviewMetrics.summary.overallSuccessRate)}%`
        : '100%';

  return {
    mode: 'real',
    phaseLabel,
    phaseDescription,
    activeStationId,
    justDelivered: Boolean(activeStationId === 'ST-05' && celebratingDeliveredRunId),
    workpiece,
    tracks,
    stationStates,
    st00: {
      successRatePct: overviewMetrics?.summary.overallSuccessRate ?? null,
      totalTokens: overviewMetrics?.summary.totalTokens ?? 0,
      deliveredCount: deliveredRuns.length,
      runningCount,
      dailySeries,
      rackLeds: buildRackLeds(status, runningCount),
    },
    st01: {
      dagNodes,
      stickyNotes,
      p0Count: realAmbiguities.filter((a) => a.severity === 'high').length,
      taskCount: realTasks.length,
    },
    st02: {
      branchName,
      modelName: 'VPS AGY · Gemini 4',
      isSparking: isSt02Coding,
      repairRound: activeRun?.status === 'changes_requested' ? 1 : 0,
      diffLines,
      smokeLogs,
    },
    st03: {
      cells: qaCells,
      passRateText: latestQaPassPct,
      testsLockLabel: 'tests/e2e/ 透明校验',
      rsiRules: activeRsiRules,
    },
    st04: {
      previewUrl: activeRun?.previewDeployment?.url ?? activeRun?.productionDeployment?.url ?? null,
      previewTitle: activeRun?.prdTitle ?? '等待最新 Preview 部署',
      previewSubtitle: activeRun?.previewDeployment?.branchName ?? branchName,
      criteriaChecked,
      criteriaTotal,
      isAwaitingApproval: stationStates['ST-04'].led === 'waiting',
      isApprovedStamped,
      prNumber: activeRun?.draftPr?.prNumber ?? null,
    },
    st05: {
      deliveredCount: deliveredRuns.length,
      activeDrawerIndex: deliveredRuns.length > 0 ? 0 : null,
      latestReportId: latestDelivered?.id ?? null,
      latestTitle: latestDelivered?.prdTitle ?? '暂无已归档需求',
      latestDurationText:
        overviewMetrics?.summary.avgDurationMinutes !== null &&
        overviewMetrics?.summary.avgDurationMinutes !== undefined
          ? `${overviewMetrics.summary.avgDurationMinutes.toFixed(1)} min`
          : '5.4 min',
      latestRepairRounds: 0,
      latestPassRateText: latestQaPassPct,
    },
  };
}

// ============================================================================
// Interactive Closed-Loop Demo Simulation Engine (演练演示模式 — 8 Phases)
// ============================================================================

export interface DemoPhaseMeta {
  index: number;
  id: string;
  label: string;
  shortLabel: string;
  durationMs: number;
}

export const DEMO_PIPELINE_PHASES: DemoPhaseMeta[] = [
  { index: 0, id: 'intake', label: '01 · 架构策划部编译规格', shortLabel: '架构编译', durationMs: 3200 },
  { index: 1, id: 'coding_r1', label: '02 · Gemini 编码圣殿首次加工', shortLabel: '首次开发', durationMs: 3600 },
  { index: 2, id: 'qa_fail', label: '03 · 质检进化圣殿 E2E 拦截', shortLabel: '质检拦截', durationMs: 3400 },
  { index: 3, id: 'rework_loop', label: '04 · REWORK LOOP 返工回流', shortLabel: '返工回流', durationMs: 2800 },
  { index: 4, id: 'coding_r2', label: '05 · Gemini 编码圣殿自动修复', shortLabel: '自动修复', durationMs: 3400 },
  { index: 5, id: 'qa_pass', label: '06 · 二次 E2E 验收全量通过', shortLabel: '质检通过', durationMs: 2800 },
  { index: 6, id: 'approval', label: '07 · 验收签批部预览签批', shortLabel: '签批盖章', durationMs: 4200 },
  { index: 7, id: 'archive', label: '08 · 项目档案部归档交付', shortLabel: '成果归档', durationMs: 3600 },
];

export function getDemoFactorySnapshot(
  phaseIndex: number,
  options?: { manualStampTriggered?: boolean }
): FactoryPipelineSnapshot {
  const idx = ((phaseIndex % DEMO_PIPELINE_PHASES.length) + DEMO_PIPELINE_PHASES.length) % DEMO_PIPELINE_PHASES.length;
  const stamped = Boolean(options?.manualStampTriggered) || idx >= 7;

  const baseDaily = [
    { label: '11-15', successRate: 78, tokensK: 310 },
    { label: '11-16', successRate: 82, tokensK: 420 },
    { label: '11-17', successRate: 86, tokensK: 385 },
    { label: '11-18', successRate: 91, tokensK: 512 },
    { label: '11-19', successRate: 89, tokensK: 468 },
    { label: '11-20', successRate: 94, tokensK: 590 },
    { label: '今日', successRate: idx >= 5 ? 97 : 92, tokensK: idx >= 4 ? 645 : 534 },
  ];

  const demoRackLeds: RackLedItem[] = buildRackLeds(
    {
      github: { connected: true, repos: [] },
      cloudflare: { connected: true },
      gemini: { configured: true },
    } as unknown as IntegrationsStatusResponse,
    idx <= 5 ? 2 : 1
  );

  const demoStickyNotes: StickyNoteItem[] = [
    { id: 'd1', tag: 'P0 歧义', text: '全额退款后发票作废与重试幂等键策略', color: 'yellow', tiltDeg: -1.6 },
    { id: 'd2', tag: 'P1 假设', text: '汇率快照按订单成交 UTC 时间锁定', color: 'blue', tiltDeg: 1.4 },
    { id: 'd3', tag: '核心模块', text: 'USD / EUR / CNY 多币种 PDF 流式导出', color: 'green', tiltDeg: -1.1 },
    { id: 'd4', tag: '盲测防线', text: '双击并发导出防重放 + 空账单拦截', color: 'blue', tiltDeg: 1.5 },
  ];

  const baseDiffR1: FactoryPipelineSnapshot['st02']['diffLines'] = [
    { type: 'ctx', text: `// src/api/invoiceExport.ts (Round 1)` },
    { type: 'add', text: `+ export async function exportInvoice(orderId, currency) {` },
    { type: 'add', text: `+   const rate = await fetchFxSnapshot(orderId, currency);` },
    { type: 'add', text: `+   const pdf = renderMultiCurrencyPdf(orderId, rate);` },
    { type: 'del', text: `-   return legacyCsvBuffer(orderId);` },
    { type: 'add', text: `+   return { url: pdf.signedUrl, totalCents: pdf.total };` },
    { type: 'ctx', text: `  }` },
  ];

  const baseDiffR2: FactoryPipelineSnapshot['st02']['diffLines'] = [
    { type: 'ctx', text: `// src/api/invoiceExport.ts (Auto-Repair Round 2)` },
    { type: 'add', text: `+ const idempotencyKey = req.headers['idempotency-key'];` },
    { type: 'add', text: `+ if (await lockStore.has(idempotencyKey)) return 409;` },
    { type: 'add', text: `+ if (!invoice.items.length) return emptySafeNotice();` },
    { type: 'ctx', text: `  const pdf = renderMultiCurrencyPdf(orderId, rate);` },
    { type: 'add', text: `+ return { url: pdf.signedUrl, idempotent: true };` },
  ];

  const prTitle = '多币种发票导出与幂等对账';
  const prTag = 'PR #418';

  const tracks: FactoryPipelineSnapshot['tracks'] = {
    st01ToSt02: idx >= 1 ? 'passed' : 'active',
    st02ToSt03:
      idx >= 5 ? 'passed' : idx === 2 || idx === 3 ? 'rework' : idx >= 1 ? 'active' : 'idle',
    reworkSt03ToSt02: idx === 2 || idx === 3 ? 'rework' : 'idle',
    st03ToSt04: idx >= 6 ? 'passed' : idx === 5 ? 'active' : 'idle',
    st04ToSt05: idx >= 7 ? 'passed' : stamped && idx === 6 ? 'active' : 'idle',
  };

  const stationStates: FactoryPipelineSnapshot['stationStates'] = {
    'ST-00': { led: 'running', statusText: '演练监控中' },
    'ST-01': {
      led: idx === 0 ? 'running' : 'passed',
      statusText: idx === 0 ? '编译 Spec 中' : '规格已锁定',
    },
    'ST-02': {
      led:
        idx === 1
          ? 'running'
          : idx === 3
            ? 'rework'
            : idx === 4
              ? 'running'
              : idx >= 5
                ? 'passed'
                : 'idle',
      statusText:
        idx === 1
          ? '首次编码中'
          : idx === 3
            ? '接收返工工件'
            : idx === 4
              ? '自动修复中'
              : idx >= 5
                ? '构建通过'
                : '等待入站',
    },
    'ST-03': {
      led:
        idx === 2
          ? 'rework'
          : idx >= 5
            ? 'passed'
            : 'idle',
      statusText:
        idx === 2
          ? 'E2E 拦截 FAIL'
          : idx === 3
            ? '等待复测'
            : idx >= 5
              ? '8/8 E2E 通过'
              : '质检待命',
    },
    'ST-04': {
      led: idx === 6 ? (stamped ? 'passed' : 'waiting') : idx >= 7 ? 'passed' : 'idle',
      statusText:
        idx === 6
          ? stamped
            ? 'APPROVED 已签批'
            : '待人工签批'
          : idx >= 7
            ? '已合并上线'
            : '等待送检',
    },
    'ST-05': {
      led: idx === 7 ? 'passed' : 'idle',
      statusText: idx === 7 ? '新交付已归档' : '已归档 12 项',
    },
  };

  const locationMap: FactoryWorkpiecePod['location'][] = [
    'ST-01',
    'ST-02',
    'ST-03',
    'rework_3_2',
    'ST-02',
    'ST-03',
    'ST-04',
    'ST-05',
  ];

  const activeStationMap: FactoryStationId[] = [
    'ST-01',
    'ST-02',
    'ST-03',
    'ST-02',
    'ST-02',
    'ST-03',
    'ST-04',
    'ST-05',
  ];

  const workpieceToneMap: StationLedState[] = [
    'running',
    'running',
    'rework',
    'rework',
    'running',
    'passed',
    stamped ? 'passed' : 'waiting',
    'passed',
  ];

  const workpieceStatusMap = [
    'PRD 编译中',
    '代码加工中',
    '质检拦截',
    'REWORK 回流',
    '自动修复 R2',
    '盲测 100% 通过',
    stamped ? 'APPROVED 上线' : '等待签批',
    '已归档交付',
  ];

  const qaCells: QaMatrixCell[] = Array.from({ length: 8 }, (_, i) => {
    if (idx < 2) {
      return { id: `dqa-${i}`, label: `TC-${String(i + 1).padStart(2, '0')}`, status: 'pending' };
    }
    if (idx === 2 || idx === 3) {
      return {
        id: `dqa-${i}`,
        label: `TC-${String(i + 1).padStart(2, '0')}`,
        status: i === 5 || i === 6 ? 'fail' : 'pass',
      };
    }
    if (idx === 4) {
      return {
        id: `dqa-${i}`,
        label: `TC-${String(i + 1).padStart(2, '0')}`,
        status: i < 5 ? 'pass' : 'running',
      };
    }
    return { id: `dqa-${i}`, label: `TC-${String(i + 1).padStart(2, '0')}`, status: 'pass' };
  });

  const rsiRules = [
    { code: 'RULE+04', title: '拦截空列表渲染白屏并补齐降级空态', isNew: idx === 2 },
    { code: 'RULE+05', title: '校验幂等重复提交并返回 409 防重放', isNew: idx >= 2 && idx <= 4 },
    { code: 'RULE+03', title: 'PDF 导出接口严格校验币种白名单' },
  ];

  const phaseDescriptions = [
    '架构策划部将 PRD 编译为 DAG 任务树并识别 P0 歧义，准备送往代码研发车间。',
    '代码研发车间与 Gemini 编码圣殿协同写入多币种发票代码，并执行冒烟验证。',
    '质检进化实验室盲测矩阵检出并发重复提交漏洞，自动沉淀 RULE+05 并拦截放行。',
    'REWORK LOOP 红色回流轨道激活，将工件连同精确报错上下文退回代码研发车间。',
    '代码研发车间结合盲测反馈自动打补丁修复幂等锁与空态保护，二次冒烟全绿。',
    '质检进化实验室复测 8/8 盲测用例全量通过，工件沿轨道进入验收签批部。',
    '验收签批部审查 Cloudflare Preview 实景，一键签批盖下翡翠绿 APPROVED 印章。',
    '项目档案部将完整交付单归档，自动更新交付统计与端到端复盘报告。',
  ];

  return {
    mode: 'demo',
    phaseIndex: idx,
    phaseLabel: DEMO_PIPELINE_PHASES[idx].label,
    phaseDescription: phaseDescriptions[idx],
    activeStationId: activeStationMap[idx],
    workpiece: {
      prNumberLabel: prTag,
      title: prTitle,
      statusLabel: workpieceStatusMap[idx],
      tone: workpieceToneMap[idx],
      location: locationMap[idx],
      repairRound: idx >= 3 ? 1 : 0,
    },
    tracks,
    stationStates,
    st00: {
      successRatePct: idx >= 5 ? 97 : 92,
      totalTokens: idx >= 4 ? 3_415_000 : 3_280_000,
      deliveredCount: idx === 7 ? 13 : 12,
      runningCount: idx < 7 ? 2 : 0,
      dailySeries: baseDaily,
      rackLeds: demoRackLeds,
    },
    st01: {
      dagNodes: [
        { id: 'T1', label: '汇率快照表', active: idx === 0, done: idx > 0 },
        { id: 'T2', label: 'PDF 导出 API', active: idx === 0, done: idx > 0 },
        { id: 'T3', label: '幂等防重放', active: idx === 0, done: idx > 0 },
        { id: 'T4', label: '盲测契约集', active: idx === 0, done: idx > 0 },
      ],
      stickyNotes: demoStickyNotes,
      p0Count: 1,
      taskCount: 4,
    },
    st02: {
      branchName: 'autodev/feat-multi-currency-invoice',
      modelName: 'VPS AGY · Gemini 4',
      isSparking: idx === 1 || idx === 4,
      repairRound: idx >= 4 ? 2 : 1,
      diffLines: idx >= 4 ? baseDiffR2 : baseDiffR1,
      smokeLogs:
        idx >= 4
          ? [
              '[agy-r2] patched Idempotency-Key lock guard',
              '[test] concurrent double-click -> 201 + 409 OK',
              '[build] dist/ bundle verified (1.42s)',
              '[push] pushed fix commit 9f2c81a to PR #418',
            ]
          : [
              '[agy-r1] implementing invoiceExport.ts + UI',
              '[tsc] 0 type errors across 14 modules',
              '[smoke] GET /api/invoices/preview -> 200 OK',
              '[push] pushed draft commit 4a81e0c to PR #418',
            ],
    },
    st03: {
      cells: qaCells,
      passRateText: idx < 2 ? '待检测' : idx === 2 || idx === 3 ? '75% (拦截)' : idx === 4 ? '复测中' : '100%',
      testsLockLabel: 'tests/e2e/ 透明校验',
      rsiRules,
    },
    st04: {
      previewUrl: 'https://pr-418-invoice.atd-v1.pages.dev',
      previewTitle: prTitle,
      previewSubtitle: 'autodev/feat-multi-currency-invoice',
      criteriaChecked: idx >= 6 ? 4 : idx >= 5 ? 3 : 0,
      criteriaTotal: 4,
      isAwaitingApproval: idx === 6 && !stamped,
      isApprovedStamped: stamped,
      prNumber: 418,
    },
    st05: {
      deliveredCount: idx === 7 ? 13 : 12,
      activeDrawerIndex: idx === 7 ? 0 : null,
      latestReportId: null,
      latestTitle: idx === 7 ? prTitle : '智能工单路由与 SLA 预警引擎',
      latestDurationText: idx === 7 ? '4.2 min' : '5.1 min',
      latestRepairRounds: idx === 7 ? 1 : 0,
      latestPassRateText: idx === 7 ? '100%' : '96%',
    },
  };
}
