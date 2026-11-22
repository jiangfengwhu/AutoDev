import type {
  AnalysisJob,
  BackgroundTask,
  IntegrationsStatusResponse,
  PipelineRun,
} from '../types/autodev';
import type { StudioRoomId } from '../lib/studioTheme';

export const TILE_SIZE = 32;
export const WORLD_COLS = 36;
export const WORLD_ROWS = 22;
export const WORLD_WIDTH = WORLD_COLS * TILE_SIZE; // 1152
export const WORLD_HEIGHT = WORLD_ROWS * TILE_SIZE; // 704

export type FacingDir = 'down' | 'up' | 'left' | 'right';

export interface RoomZoneRect {
  roomId: StudioRoomId;
  roomCode: string;
  roomName: string;
  npcName: string;
  npcRole: string;
  hotkey: '1' | '2' | '3' | '4' | '5' | '6';
  accentHex: string;
  accentNum: number;
  floorTheme: 'command' | 'architect' | 'archive' | 'coding' | 'approval' | 'quality';
  // Tile coordinates (inclusive start, exclusive end)
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
  // Doorway center in tile coords (facing central corridor)
  doorCol: number;
  doorRow: number;
  // NPC standing position in tile coords
  npcCol: number;
  npcRow: number;
  // Interaction spot for player
  interactCol: number;
  interactRow: number;
}

/**
 * 6 architecturally distinct rooms arranged across a 36x22 studio floorplan:
 * - Top wing (rows 1..8): RM-01 Command Hall, RM-02 Architect Studio, RM-03 Archive Library
 * - Central Grand Corridor (rows 9..12): 4 tiles tall (128px), wide open walkway with reception lounge
 * - Bottom wing (rows 13..20): RM-04 Coding Bay, RM-05 Approval War-Room, RM-06 QA & RSI Lab
 */
export const STUDIO_WORLD_ROOMS: RoomZoneRect[] = [
  {
    roomId: 'environment',
    roomCode: 'RM-01',
    roomName: '指挥大厅',
    npcName: '林工',
    npcRole: 'DevOps 主管',
    hotkey: '1',
    accentHex: '#F59E0B',
    accentNum: 0xf59e0b,
    floorTheme: 'command',
    colStart: 1,
    colEnd: 12,
    rowStart: 1,
    rowEnd: 9,
    doorCol: 6.5,
    doorRow: 9,
    npcCol: 6.5,
    npcRow: 5.5,
    interactCol: 6.5,
    interactRow: 7.4,
  },
  {
    roomId: 'prd',
    roomCode: 'RM-02',
    roomName: '架构策划室',
    npcName: '周明',
    npcRole: '首席架构师',
    hotkey: '2',
    accentHex: '#38BDF8',
    accentNum: 0x38bdf8,
    floorTheme: 'architect',
    colStart: 12,
    colEnd: 24,
    rowStart: 1,
    rowEnd: 9,
    doorCol: 18,
    doorRow: 9,
    npcCol: 18,
    npcRow: 5.4,
    interactCol: 18,
    interactRow: 7.4,
  },
  {
    roomId: 'requirements',
    roomCode: 'RM-03',
    roomName: '需求档案室',
    npcName: '苏禾',
    npcRole: '项目档案官',
    hotkey: '3',
    accentHex: '#FBBF24',
    accentNum: 0xfbbf24,
    floorTheme: 'archive',
    colStart: 24,
    colEnd: 35,
    rowStart: 1,
    rowEnd: 9,
    doorCol: 29.5,
    doorRow: 9,
    npcCol: 29.5,
    npcRow: 5.5,
    interactCol: 29.5,
    interactRow: 7.4,
  },
  {
    roomId: 'pipeline',
    roomCode: 'RM-04',
    roomName: '编码工位',
    npcName: '陈汐',
    npcRole: 'Coding Agent 工程师',
    hotkey: '4',
    accentHex: '#34D399',
    accentNum: 0x34d399,
    floorTheme: 'coding',
    colStart: 1,
    colEnd: 12,
    rowStart: 13,
    rowEnd: 21,
    doorCol: 6.5,
    doorRow: 13,
    npcCol: 6.5,
    npcRow: 16.5,
    interactCol: 6.5,
    interactRow: 14.6,
  },
  {
    roomId: 'approval',
    roomCode: 'RM-05',
    roomName: '审批会议室',
    npcName: '沈岚',
    npcRole: '产品总监',
    hotkey: '5',
    accentHex: '#A78BFA',
    accentNum: 0xa78bfa,
    floorTheme: 'approval',
    colStart: 12,
    colEnd: 24,
    rowStart: 13,
    rowEnd: 21,
    doorCol: 18,
    doorRow: 13,
    npcCol: 18,
    npcRow: 16.6,
    interactCol: 18,
    interactRow: 14.6,
  },
  {
    roomId: 'quality',
    roomCode: 'RM-06',
    roomName: '质量实验室',
    npcName: '陆知',
    npcRole: 'QA & RSI 负责人',
    hotkey: '6',
    accentHex: '#FB7185',
    accentNum: 0xfb7185,
    floorTheme: 'quality',
    colStart: 24,
    colEnd: 35,
    rowStart: 13,
    rowEnd: 21,
    doorCol: 29.5,
    doorRow: 13,
    npcCol: 29.5,
    npcRow: 16.5,
    interactCol: 29.5,
    interactRow: 14.6,
  },
];

// Player spawns in the wide open central corridor facing North toward the Architect Studio
export const PLAYER_SPAWN_WORLD = {
  x: 18 * TILE_SIZE,
  y: 11 * TILE_SIZE,
  facing: 'up' as FacingDir,
};

/**
 * Pure spatial walkability check.
 * Outer perimeter walls + interior dividing walls (with wide 3-tile doorways) + heavy furniture desks.
 */
export function isWalkableWorldPoint(x: number, y: number): boolean {
  const margin = 10;
  if (
    x < TILE_SIZE + margin ||
    x > WORLD_WIDTH - TILE_SIZE - margin ||
    y < TILE_SIZE * 2.2 ||
    y > WORLD_HEIGHT - TILE_SIZE - margin
  ) {
    return false;
  }

  const col = x / TILE_SIZE;
  const row = y / TILE_SIZE;

  // Central grand corridor (rows 9.1 .. 12.9) is completely open horizontally!
  if (row >= 9.05 && row <= 12.95) {
    return true;
  }

  // Horizontal partition walls separating rooms from central corridor (row ~8.85..9.05 and 12.95..13.15)
  const inTopDoorWall = row >= 8.55 && row < 9.05;
  const inBottomDoorWall = row > 12.95 && row <= 13.45;
  if (inTopDoorWall || inBottomDoorWall) {
    // 3.4-tile wide doorways centered at 6.5, 18.0, 29.5
    const inDoorway =
      Math.abs(col - 6.5) <= 1.7 ||
      Math.abs(col - 18.0) <= 1.7 ||
      Math.abs(col - 29.5) <= 1.7;
    return inDoorway;
  }

  // Vertical partition walls between rooms at col=12 and col=24 (outside the corridor)
  if (Math.abs(col - 12) < 0.42 || Math.abs(col - 24) < 0.42) {
    return false;
  }

  // Top wall furniture strip (wall monitors, whiteboards, server racks) inside top rooms
  if (row < 3.6) {
    return false;
  }

  // Bottom wall furniture strip inside bottom rooms
  if (row > 19.3) {
    return false;
  }

  // Avoid walking right on top of NPC desks & front nameplates
  for (const room of STUDIO_WORLD_ROOMS) {
    const npcX = room.npcCol * TILE_SIZE;
    const npcY = room.npcRow * TILE_SIZE;
    const dx = x - npcX;
    const dy = y - npcY;
    if (Math.abs(dx) < 42 && dy > -22 && dy < 38) {
      return false;
    }
  }

  return true;
}

/**
 * Resolves which room (if any) contains the given world coordinates.
 */
export function getRoomAtWorldPoint(x: number, y: number): RoomZoneRect | null {
  const col = x / TILE_SIZE;
  const row = y / TILE_SIZE;
  for (const room of STUDIO_WORLD_ROOMS) {
    if (
      col >= room.colStart &&
      col < room.colEnd &&
      row >= room.rowStart &&
      row < room.rowEnd
    ) {
      return room;
    }
  }
  return null;
}

/**
 * Finds the nearest interactable room / NPC within range of the player.
 */
export function findNearbyInteractableRoom(
  playerX: number,
  playerY: number,
  maxDistancePx = 112
): { room: RoomZoneRect; distance: number } | null {
  let best: { room: RoomZoneRect; distance: number } | null = null;

  // If the player is physically inside a room, prioritize that room
  const inside = getRoomAtWorldPoint(playerX, playerY);
  if (inside) {
    const dx = playerX - inside.npcCol * TILE_SIZE;
    const dy = playerY - inside.npcRow * TILE_SIZE;
    return { room: inside, distance: Math.hypot(dx, dy) };
  }

  for (const room of STUDIO_WORLD_ROOMS) {
    const doorX = room.doorCol * TILE_SIZE;
    const doorY = room.doorRow * TILE_SIZE;
    const dist = Math.hypot(playerX - doorX, playerY - doorY);
    if (dist <= maxDistancePx && (!best || dist < best.distance)) {
      best = { room, distance: dist };
    }
  }
  return best;
}

export interface StudioProgressionState {
  level: number;
  rankTitle: string;
  totalXp: number;
  xpInCurrentLevel: number;
  xpForNextLevel: number;
  xpProgressPct: number;
  deliveredCount: number;
  activeRunsCount: number;
  activeQuest: {
    stageIndex: number; // 1..5
    totalStages: number;
    stageLabel: string;
    questTitle: string;
    objective: string;
    targetRoomId: StudioRoomId;
    isUrgent: boolean;
  };
}

/**
 * Pure deterministic RPG progression & Active Main Quest state machine derived
 * strictly from real AutoDev Studio runs, analysis jobs, and background tasks.
 */
export function computeStudioProgression(params: {
  runs: PipelineRun[];
  analysisJob: AnalysisJob | null;
  backgroundTasks: BackgroundTask[];
  status: IntegrationsStatusResponse | null;
}): StudioProgressionState {
  const { runs, analysisJob, backgroundTasks, status } = params;

  const deliveredCount = runs.filter(
    (r) => Boolean(r.mergedRelease) || r.status === 'approved'
  ).length;
  const draftPrCount = runs.filter((r) => Boolean(r.draftPr)).length;
  const completedBgTasks = backgroundTasks.filter((t) => t.status === 'completed').length;
  const activeRunsCount = runs.filter(
    (r) => !r.mergedRelease && r.status !== 'approved'
  ).length;

  // Real experience points strictly grounded in actual software deliverables
  const totalXp =
    deliveredCount * 220 +
    draftPrCount * 75 +
    runs.length * 40 +
    completedBgTasks * 20;

  const xpPerLevel = 250;
  const level = Math.max(1, Math.floor(totalXp / xpPerLevel) + 1);
  const xpInCurrentLevel = totalXp % xpPerLevel;
  const xpProgressPct = Math.min(100, Math.round((xpInCurrentLevel / xpPerLevel) * 100));

  const rankTitle =
    level >= 10
      ? '传奇全自动研发公会'
      : level >= 6
        ? '精英架构与智造工作室'
        : level >= 3
          ? '高速迭代研发团队'
          : '独立软件研发工作室';

  // Determine real Active Main Quest from current workflow stage
  const runningBg = backgroundTasks.find((t) => t.status === 'running');
  const activeRun = runs.find((r) => !r.mergedRelease && r.status !== 'approved');

  let activeQuest: StudioProgressionState['activeQuest'];

  if (status && !status.github.connected) {
    activeQuest = {
      stageIndex: 1,
      totalStages: 5,
      stageLabel: '环境装配',
      questTitle: '校准指挥大厅引擎连通性',
      objective: '前往 RM-01 指挥大厅检查 GitHub 与 VPS Runner 连接状态',
      targetRoomId: 'environment',
      isUrgent: true,
    };
  } else if (analysisJob?.status === 'running') {
    activeQuest = {
      stageIndex: 2,
      totalStages: 5,
      stageLabel: '需求规划中',
      questTitle: `架构拆解：${analysisJob.prdTitle}`,
      objective: '周明正在 RM-02 架构策划室后台拆解架构任务树与盲测集',
      targetRoomId: 'prd',
      isUrgent: false,
    };
  } else if (activeRun && !activeRun.draftPr) {
    activeQuest = {
      stageIndex: 2,
      totalStages: 5,
      stageLabel: '待建 Draft PR',
      questTitle: `评审蓝图：${activeRun.prdTitle}`,
      objective: '前往 RM-02 架构策划室审阅/微调方案并创建 Draft PR',
      targetRoomId: 'prd',
      isUrgent: true,
    };
  } else if (activeRun?.status === 'changes_requested') {
    activeQuest = {
      stageIndex: 3,
      totalStages: 5,
      stageLabel: '返工修复中',
      questTitle: `返工迭代：${activeRun.prdTitle}`,
      objective: '陈汐正在 RM-04 编码工位根据评审反馈增量修复分支代码',
      targetRoomId: 'pipeline',
      isUrgent: true,
    };
  } else if (activeRun?.draftPr && !activeRun.previewDeployment) {
    activeQuest = {
      stageIndex: 3,
      totalStages: 5,
      stageLabel: '自动编码阶段',
      questTitle: `编码执行：${activeRun.prdTitle}`,
      objective: '前往 RM-04 编码工位观察 AGY 编码流水线与实时测试验证',
      targetRoomId: 'pipeline',
      isUrgent: false,
    };
  } else if (activeRun?.draftPr) {
    activeQuest = {
      stageIndex: 4,
      totalStages: 5,
      stageLabel: '待验收上线',
      questTitle: `上线签批：${activeRun.prdTitle}`,
      objective: '前往 RM-05 审批会议室体验预览环境并签批合入主分支',
      targetRoomId: 'approval',
      isUrgent: true,
    };
  } else if (runningBg) {
    const bgRoom =
      runningBg.roomId === 'studio' ? 'environment' : (runningBg.roomId as StudioRoomId);
    activeQuest = {
      stageIndex: 3,
      totalStages: 5,
      stageLabel: '后台任务执行中',
      questTitle: runningBg.title,
      objective: runningBg.progressMessage,
      targetRoomId: bgRoom,
      isUrgent: false,
    };
  } else {
    activeQuest = {
      stageIndex: deliveredCount > 0 ? 5 : 1,
      totalStages: 5,
      stageLabel: deliveredCount > 0 ? '随时开启新迭代' : '准备就绪',
      questTitle: deliveredCount > 0 ? '开启下一轮需求研发' : '发起首个自动化研发需求',
      objective: '走入 RM-02 架构策划室与周明对话，或前往 RM-01 查看大屏战报',
      targetRoomId: 'prd',
      isUrgent: false,
    };
  }

  return {
    level,
    rankTitle,
    totalXp,
    xpInCurrentLevel,
    xpForNextLevel: xpPerLevel,
    xpProgressPct,
    deliveredCount,
    activeRunsCount,
    activeQuest,
  };
}

/**
 * Computes corridor workflow track route between two rooms for animated data orbs.
 */
export function getCorridorRouteWaypoints(
  fromRoomId: StudioRoomId,
  toRoomId: StudioRoomId
): Array<{ x: number; y: number }> {
  const from = STUDIO_WORLD_ROOMS.find((r) => r.roomId === fromRoomId);
  const to = STUDIO_WORLD_ROOMS.find((r) => r.roomId === toRoomId);
  if (!from || !to) return [];
  const corridorY = 11 * TILE_SIZE;
  return [
    { x: from.npcCol * TILE_SIZE, y: from.npcRow * TILE_SIZE },
    { x: from.doorCol * TILE_SIZE, y: corridorY },
    { x: to.doorCol * TILE_SIZE, y: corridorY },
    { x: to.npcCol * TILE_SIZE, y: to.npcRow * TILE_SIZE },
  ];
}
