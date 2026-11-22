import type {
  AnalysisJob,
  BackgroundTask,
  IntegrationsStatusResponse,
  PipelineRun,
} from '../types/autodev';
import type { StudioRoomId } from './studioTheme';

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 740;
export const CORRIDOR_Y = 370;

export interface Point2D {
  x: number;
  y: number;
}

export interface StudioRoomGeometry {
  id: StudioRoomId;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
  doorHalfWidth: number;
  /** Where the NPC stands or sits */
  npcPos: Point2D;
  /** Where the player walks to when interacting with this room */
  interactPos: Point2D;
  /** Floor tint */
  carpetHex: string;
  /** Which side the doorway faces */
  doorSide: 'bottom' | 'top';
}

export const STUDIO_ROOM_GEOMETRY: Record<StudioRoomId, StudioRoomGeometry> = {
  prd: {
    id: 'prd',
    x: 34,
    y: 34,
    w: 356,
    h: 286,
    doorX: 212,
    doorY: 320,
    doorHalfWidth: 42,
    npcPos: { x: 174, y: 158 },
    interactPos: { x: 212, y: 236 },
    carpetHex: '#122136',
    doorSide: 'bottom',
  },
  environment: {
    id: 'environment',
    x: 422,
    y: 34,
    w: 356,
    h: 286,
    doorX: 600,
    doorY: 320,
    doorHalfWidth: 46,
    npcPos: { x: 600, y: 178 },
    interactPos: { x: 600, y: 244 },
    carpetHex: '#231C12',
    doorSide: 'bottom',
  },
  pipeline: {
    id: 'pipeline',
    x: 810,
    y: 34,
    w: 356,
    h: 286,
    doorX: 988,
    doorY: 320,
    doorHalfWidth: 42,
    npcPos: { x: 964, y: 162 },
    interactPos: { x: 988, y: 242 },
    carpetHex: '#0F2520',
    doorSide: 'bottom',
  },
  requirements: {
    id: 'requirements',
    x: 34,
    y: 420,
    w: 356,
    h: 286,
    doorX: 212,
    doorY: 420,
    doorHalfWidth: 42,
    npcPos: { x: 186, y: 562 },
    interactPos: { x: 212, y: 492 },
    carpetHex: '#1D1830',
    doorSide: 'top',
  },
  approval: {
    id: 'approval',
    x: 422,
    y: 420,
    w: 356,
    h: 286,
    doorX: 600,
    doorY: 420,
    doorHalfWidth: 46,
    npcPos: { x: 600, y: 564 },
    interactPos: { x: 600, y: 492 },
    carpetHex: '#261A14',
    doorSide: 'top',
  },
  quality: {
    id: 'quality',
    x: 810,
    y: 420,
    w: 356,
    h: 286,
    doorX: 988,
    doorY: 420,
    doorHalfWidth: 42,
    npcPos: { x: 992, y: 564 },
    interactPos: { x: 988, y: 492 },
    carpetHex: '#102526',
    doorSide: 'top',
  },
};

export const STUDIO_ROOM_LIST: StudioRoomGeometry[] = Object.values(STUDIO_ROOM_GEOMETRY);

export function getRoomAtPoint(x: number, y: number): StudioRoomId | null {
  for (const room of STUDIO_ROOM_LIST) {
    if (x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) {
      return room.id;
    }
  }
  return null;
}

/**
 * Checks whether a point is legally walkable inside any room, doorway, or central hallway.
 */
export function isPointWalkable(x: number, y: number): boolean {
  const pad = 18;
  // Outer studio boundary
  if (x < 34 + pad || x > WORLD_WIDTH - 34 - pad || y < 34 + pad || y > WORLD_HEIGHT - 34 - pad) {
    return false;
  }

  // Central horizontal corridor
  if (y >= 324 && y <= 416) {
    return true;
  }

  // Doorway openings (bridge between rooms and corridor)
  for (const room of STUDIO_ROOM_LIST) {
    if (Math.abs(x - room.doorX) <= room.doorHalfWidth - 6) {
      if (room.doorSide === 'bottom' && y >= room.y + room.h - 24 && y <= 338) {
        return true;
      }
      if (room.doorSide === 'top' && y >= 402 && y <= room.y + 24) {
        return true;
      }
    }
  }

  // Room interiors (keeping clear of top furniture wall band)
  for (const room of STUDIO_ROOM_LIST) {
    const topClearance = room.doorSide === 'bottom' ? 92 : 22;
    const bottomClearance = room.doorSide === 'top' ? 68 : 20;
    if (
      x >= room.x + pad &&
      x <= room.x + room.w - pad &&
      y >= room.y + topClearance &&
      y <= room.y + room.h - bottomClearance
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves smooth wall-sliding collision when moving with keyboard controls.
 */
export function moveWithStudioCollision(
  current: Point2D,
  dx: number,
  dy: number
): Point2D {
  const nextX = current.x + dx;
  const nextY = current.y + dy;
  if (isPointWalkable(nextX, nextY)) {
    return { x: nextX, y: nextY };
  }
  if (isPointWalkable(nextX, current.y)) {
    return { x: nextX, y: current.y };
  }
  if (isPointWalkable(current.x, nextY)) {
    return { x: current.x, y: nextY };
  }
  return current;
}

/**
 * Computes a clean architectural corridor waypoint path from start -> target
 * so the player avatar walks naturally through open doorways without clipping walls.
 */
export function computeStudioPath(from: Point2D, to: Point2D): Point2D[] {
  const clampedTarget = clampTargetToWalkable(to);
  const startRoom = getRoomAtPoint(from.x, from.y);
  const targetRoom = getRoomAtPoint(clampedTarget.x, clampedTarget.y);

  // Same room or both in central corridor -> direct path
  if (startRoom === targetRoom) {
    return [clampedTarget];
  }

  const waypoints: Point2D[] = [];

  if (startRoom) {
    const geom = STUDIO_ROOM_GEOMETRY[startRoom];
    waypoints.push({ x: geom.doorX, y: geom.doorSide === 'bottom' ? geom.y + geom.h - 28 : geom.y + 28 });
    waypoints.push({ x: geom.doorX, y: CORRIDOR_Y });
  } else if (Math.abs(from.y - CORRIDOR_Y) > 26) {
    waypoints.push({ x: from.x, y: CORRIDOR_Y });
  }

  if (targetRoom) {
    const geom = STUDIO_ROOM_GEOMETRY[targetRoom];
    waypoints.push({ x: geom.doorX, y: CORRIDOR_Y });
    waypoints.push({ x: geom.doorX, y: geom.doorSide === 'bottom' ? geom.y + geom.h - 28 : geom.y + 28 });
  }

  waypoints.push(clampedTarget);
  return waypoints;
}

function clampTargetToWalkable(target: Point2D): Point2D {
  if (isPointWalkable(target.x, target.y)) return target;
  const roomId = getRoomAtPoint(target.x, target.y);
  if (roomId) {
    const geom = STUDIO_ROOM_GEOMETRY[roomId];
    const minY = geom.doorSide === 'bottom' ? geom.y + 96 : geom.y + 26;
    const maxY = geom.doorSide === 'top' ? geom.y + geom.h - 72 : geom.y + geom.h - 24;
    return {
      x: Math.max(geom.x + 22, Math.min(geom.x + geom.w - 22, target.x)),
      y: Math.max(minY, Math.min(maxY, target.y)),
    };
  }
  return {
    x: Math.max(60, Math.min(WORLD_WIDTH - 60, target.x)),
    y: CORRIDOR_Y,
  };
}

export interface SprintQuestStage {
  id: string;
  label: string;
  roomId: StudioRoomId;
  done: boolean;
  active: boolean;
}

export interface StudioGameQuestState {
  studioLevel: number;
  totalXp: number;
  levelProgressPct: number;
  xpToNextLevel: number;
  questTitle: string;
  questSubtitle: string;
  targetRoomId: StudioRoomId;
  activeFlowRoute: { from: StudioRoomId; to: StudioRoomId; label: string; color: string } | null;
  stages: SprintQuestStage[];
  deliveredCount: number;
  activeRunTitle: string | null;
}

/**
 * Derives live RPG progression, main sprint quest, and animated corridor data packet routes
 * strictly from real software engineering workflow state.
 */
export function deriveStudioQuestState(params: {
  runs: PipelineRun[];
  analysisJob: AnalysisJob | null;
  backgroundTasks: BackgroundTask[];
  status: IntegrationsStatusResponse | null;
}): StudioGameQuestState {
  const { runs, analysisJob, backgroundTasks, status } = params;

  const deliveredCount = runs.filter(
    (r) => Boolean(r.mergedRelease) || r.status === 'approved'
  ).length;
  const prCount = runs.filter((r) => Boolean(r.draftPr)).length;
  const completedTasksCount = backgroundTasks.filter((t) => t.status === 'completed').length;

  // Real progression XP derived from genuine engineering milestones
  const totalXp =
    120 +
    runs.length * 45 +
    prCount * 60 +
    deliveredCount * 180 +
    completedTasksCount * 20;
  const xpPerLevel = 300;
  const studioLevel = Math.floor(totalXp / xpPerLevel) + 1;
  const xpInLevel = totalXp % xpPerLevel;
  const levelProgressPct = Math.round((xpInLevel / xpPerLevel) * 100);
  const xpToNextLevel = xpPerLevel - xpInLevel;

  const activeRun =
    runs.find((r) => !r.mergedRelease && r.status !== 'approved') ?? null;

  const isPlanning = analysisJob?.status === 'running';
  const isAwaitingPr =
    Boolean(activeRun) && !activeRun?.draftPr && activeRun?.status === 'analyzed';
  const isCodingOrTesting =
    Boolean(activeRun?.draftPr) && !activeRun?.previewDeployment && activeRun?.status !== 'changes_requested';
  const isReworking = activeRun?.status === 'changes_requested';
  const isReadyForApproval =
    Boolean(activeRun?.draftPr) && (Boolean(activeRun?.previewDeployment) || activeRun?.status === 'pr_created');

  const enginesOnline = Boolean(status?.github.connected);

  let questTitle = '前往「架构策划室」立项新需求';
  let questSubtitle = '找首席架构师周明，输入 PRD 启动单对话架构规划与盲测设计';
  let targetRoomId: StudioRoomId = 'prd';
  let activeFlowRoute: StudioGameQuestState['activeFlowRoute'] = null;
  let activeStageIdx = 0;

  if (!enginesOnline && status) {
    questTitle = '前往「指挥大厅」检查引擎连接';
    questSubtitle = '找 DevOps 总控官林工核查 GitHub / Cloudflare 与 Runner 状态';
    targetRoomId = 'environment';
    activeStageIdx = 0;
  } else if (isPlanning) {
    questTitle = `规划中：${analysisJob?.prdTitle || '新需求'}`;
    questSubtitle = '周明正在「架构策划室」进行单对话联合架构与盲测拆解';
    targetRoomId = 'prd';
    activeStageIdx = 1;
    activeFlowRoute = {
      from: 'prd',
      to: 'environment',
      label: 'AGY 规划算力流',
      color: '#38BDF8',
    };
  } else if (isAwaitingPr && activeRun) {
    questTitle = `审核规划：${activeRun.prdTitle}`;
    questSubtitle = '规划已完成！前往「架构策划室」修订方案并推送 Draft PR';
    targetRoomId = 'prd';
    activeStageIdx = 1;
    activeFlowRoute = {
      from: 'prd',
      to: 'pipeline',
      label: '蓝图待交接',
      color: '#38BDF8',
    };
  } else if (isReworking && activeRun) {
    questTitle = `返工修复：${activeRun.prdTitle}`;
    questSubtitle = '沈岚已退回修订，陈汐正在「代码车间」原分支增量修复中';
    targetRoomId = 'pipeline';
    activeStageIdx = 2;
    activeFlowRoute = {
      from: 'approval',
      to: 'pipeline',
      label: '返工意见回传',
      color: '#FB923C',
    };
  } else if (isReadyForApproval && activeRun && activeRun.previewDeployment) {
    questTitle = `待签批上线：${activeRun.prdTitle}`;
    questSubtitle = '预览环境已就绪，前往「验收会议室」找沈岚勾选验收并一键上线';
    targetRoomId = 'approval';
    activeStageIdx = 3;
    activeFlowRoute = {
      from: 'pipeline',
      to: 'approval',
      label: '构建产物送审',
      color: '#34D399',
    };
  } else if (isCodingOrTesting && activeRun) {
    questTitle = `编码与盲测：${activeRun.prdTitle}`;
    questSubtitle = '陈汐正在「代码车间」执行 VPS AGY 编码与自动盲测修复';
    targetRoomId = 'pipeline';
    activeStageIdx = 2;
    activeFlowRoute = {
      from: 'prd',
      to: 'pipeline',
      label: 'Spec 派发编码',
      color: '#34D399',
    };
  } else if (deliveredCount > 0) {
    questTitle = '上轮需求已交付 · 可发起下一轮迭代';
    questSubtitle = `累计已交付 ${deliveredCount} 个需求，前往「架构策划室」立项或到「项目档案室」查阅报告`;
    targetRoomId = 'prd';
    activeStageIdx = 4;
    activeFlowRoute = {
      from: 'approval',
      to: 'requirements',
      label: '交付归档',
      color: '#A78BFA',
    };
  }

  const runningTask = backgroundTasks.find((t) => t.status === 'running');
  if (runningTask && runningTask.roomId !== 'studio') {
    activeFlowRoute = {
      from: 'environment',
      to: runningTask.roomId,
      label: runningTask.title,
      color: '#FBBF24',
    };
  }

  const stages: SprintQuestStage[] = [
    { id: 'plan', label: '策划', roomId: 'prd', done: activeStageIdx > 1, active: activeStageIdx <= 1 },
    { id: 'code', label: '编码', roomId: 'pipeline', done: activeStageIdx > 2, active: activeStageIdx === 2 },
    { id: 'approve', label: '验收', roomId: 'approval', done: activeStageIdx > 3, active: activeStageIdx === 3 },
    { id: 'rsi', label: '复盘', roomId: 'quality', done: deliveredCount > 0 && activeStageIdx >= 4, active: activeStageIdx === 4 },
  ];

  return {
    studioLevel,
    totalXp,
    levelProgressPct,
    xpToNextLevel,
    questTitle,
    questSubtitle,
    targetRoomId,
    activeFlowRoute,
    stages,
    deliveredCount,
    activeRunTitle: activeRun?.prdTitle ?? (isPlanning ? analysisJob?.prdTitle ?? null : null),
  };
}
