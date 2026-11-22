import type {
  FactoryPipelineSnapshot,
  FactoryStationId,
} from '../lib/factoryPipelineState';
import { formatTokenCount } from '../lib/overviewMetrics';

export type AtmospherePresetId = 'day' | 'sunset' | 'night' | 'snow' | 'cycle';
export type CameraPresetId =
  | 'overview'
  | 'follow'
  | 'sanctuary_coder'
  | 'sanctuary_cloud'
  | 'rotunda';

export type VillageBuildingId =
  | FactoryStationId
  | 'BG-OPS'
  | 'AI-CODER'
  | 'AI-CLOUD';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface WorkshopDefinition {
  id: VillageBuildingId;
  stationId: FactoryStationId;
  name: string;
  departmentBadge: string;
  shortTag: string;
  position: Vec3Tuple;
  rotationY: number;
  variant:
    | 'brick_telecom'
    | 'solar_atelier'
    | 'glass_greenhouse'
    | 'sage_pavilion'
    | 'archive_villa'
    | 'telemetry_clockhouse';
  accentColor: string;
  conveyorId: string;
}

export interface ConveyorTrackDefinition {
  id: string;
  label: string;
  fromBuilding: VillageBuildingId;
  toBuilding: VillageBuildingId;
  railAccent: 'cream' | 'amber' | 'blue' | 'rework';
  points: Vec3Tuple[];
}

export interface ConveyorJunctionDefinition {
  id: string;
  position: Vec3Tuple;
  accentColor: string;
  ports: Array<'north' | 'south' | 'east' | 'west'>;
}

export interface AtmosphereState {
  id: Exclude<AtmospherePresetId, 'cycle'>;
  label: string;
  clockText: string;
  dateText: string;
  weatherText: string;
  tempText: string;
  weatherIcon: 'sun' | 'sunset' | 'moon' | 'snow' | 'leaf';
  skyHex: string;
  fogHex: string;
  fogNear: number;
  fogFar: number;
  sunColorHex: string;
  sunIntensity: number;
  sunPos: Vec3Tuple;
  hemiSkyHex: string;
  hemiGroundHex: string;
  hemiIntensity: number;
  ambientIntensity: number;
  envIntensity: number;
  exposure: number;
  nightFactor: number;
  snowFactor: number;
  autumnFactor: number;
}

export interface CameraPresetConfig {
  id: CameraPresetId;
  label: string;
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export interface VillageParcelSpec {
  id: string;
  trackId: string;
  progress: number;
  label: string;
  statusText: string;
  accentColor: string;
  isHero?: boolean;
  isRework?: boolean;
  /** True while actively gliding along conveyor; false when neatly docked at destination station */
  inTransit?: boolean;
  /** Optional scale multiplier (0..1) so parcels smoothly enter the Archive doorway and vanish */
  scale?: number;
}

export interface VillageTerminalState {
  visible: boolean;
  anchorBuilding: 'AI-CODER' | 'AI-CLOUD';
  agentName: string;
  statusBadge: string;
  statusTone: 'running' | 'passed' | 'rework' | 'waiting';
  lines: Array<{
    text: string;
    tone: 'muted' | 'info' | 'pass' | 'warn' | 'error';
  }>;
  summaryPill?: string;
}

export interface VillageComicBurstState {
  visible: boolean;
  anchorBuilding: VillageBuildingId;
  text: string;
  tone: 'amber' | 'red' | 'emerald';
}

export interface VillageHudOverlayState {
  activePipelinesCount: number;
  heroStepLabel: string;
  parcels: VillageParcelSpec[];
  comicBurst: VillageComicBurstState;
  terminal: VillageTerminalState;
  reworkActive: boolean;
  sanctuaryCelebrate: 'none' | 'coder' | 'cloud';
  /** True when at least one parcel is actively in transit (drives conveyor belt UV motion) */
  hasActiveTransit: boolean;
  /** Currently active/working 3D buildings so each can run its live stage working animation */
  workingBuildingIds: VillageBuildingId[];
  /** Short active stage label shown on the working building's tag */
  workingStageLabel: string;
  /** True while the village launch celebration fireworks & confetti are playing */
  celebrationActive: boolean;
  /** Elapsed seconds since celebration burst began (0..6s) */
  celebrationElapsedSec: number;
  /** Banner text shown during celebration */
  celebrationLabel: string;
  /** True once the post-delivery celebration completes so the scene returns cleanly to idle */
  celebrationDone: boolean;
}

export const CENTRAL_ROTUNDA_POS: Vec3Tuple = { x: 0, y: 0, z: 0 };
// Relocated pond cleanly clear of Central Rotunda stone terrace (distance 9.42 vs 5.85 + 2.36 = 8.21)
export const POND_POS: Vec3Tuple = { x: -0.6, y: 0, z: 9.4 };
export const POND_WATER_RADIUS = 2.22;

export const SANCTUARY_POSITIONS = {
  coder: { x: 13.6, y: 0, z: -6.2 } as Vec3Tuple,
  cloud: { x: 13.6, y: 0, z: 6.2 } as Vec3Tuple,
};

export const WORKSHOPS: WorkshopDefinition[] = [
  {
    id: 'ST-01',
    stationId: 'ST-01',
    name: '架构策划部',
    departmentBadge: 'SPEC',
    shortTag: 'PRD-to-Spec 编译',
    position: { x: -14.8, y: 0, z: -8.2 },
    rotationY: 0,
    variant: 'brick_telecom',
    accentColor: '#D96B38',
    conveyorId: 'track-st01-hub',
  },
  {
    id: 'ST-04',
    stationId: 'ST-04',
    name: '验收签批部',
    departmentBadge: 'GATE',
    shortTag: '预览验收与签批门禁',
    position: { x: -14.8, y: 0, z: 0.0 },
    rotationY: 0,
    variant: 'sage_pavilion',
    accentColor: '#D97706',
    conveyorId: 'track-st04-hub',
  },
  {
    id: 'ST-05',
    stationId: 'ST-05',
    name: '项目档案部',
    departmentBadge: 'ARCHIVE',
    shortTag: '成果归档与交付报告',
    position: { x: -14.8, y: 0, z: 8.2 },
    rotationY: 0,
    variant: 'archive_villa',
    accentColor: '#0EA5E9',
    conveyorId: 'track-st05-hub',
  },
  {
    id: 'BG-OPS',
    stationId: 'ST-00',
    name: '算力遥测站',
    departmentBadge: 'OPS',
    shortTag: '独立后台任务遥测',
    position: { x: 4.8, y: 0, z: -12.6 },
    rotationY: 0,
    variant: 'telemetry_clockhouse',
    accentColor: '#4F46E5',
    conveyorId: '',
  },
];

/**
 * All 3 West department cottages (SPEC, GATE, ARCHIVE) now connect directly via
 * dedicated non-crossing conveyors from their East arched loading doorways straight
 * into Rotunda Portals i=7, i=5, i=4; BG-OPS is a standalone telemetry station.
 */
export const CONVEYOR_JUNCTIONS: ConveyorJunctionDefinition[] = [];

/**
 * Zero-intersection physical conveyor belt segments aligned flush to each West
 * building's East arched loading doorway (world x = -12.65, y = 0.62) and the 5
 * dedicated Rotunda arched portals:
 *  - West-NW Portal (i=7, -135°): (-2.74, y, -2.74) ← ST-01 SPEC direct
 *  - West-MidS Portal (i=5, +165°): (-3.68, y, +0.98) ← ST-04 GATE direct
 *  - West-SW Portal (i=4, +135°): (-2.74, y, +2.74) ← ST-05 ARCHIVE direct
 *  - East-North Portal (i=11, -15°): (+3.68, y, -0.98) → Gemini 编码圣殿
 *  - East-South Portal (i=0, +15°):  (+3.68, y, +0.98) → 质检进化圣殿
 */
export const CONVEYOR_TRACKS: ConveyorTrackDefinition[] = [
  // Dedicated Direct: ST-01 (架构策划部 East Loading Archway) → Rotunda Portal i=7 (-135°)
  {
    id: 'track-st01-hub',
    label: '架构策划部 → 指挥调度中心',
    fromBuilding: 'ST-01',
    toBuilding: 'ST-00',
    railAccent: 'amber',
    points: [
      { x: -12.65, y: 0.62, z: -8.2 },
      { x: -10.1, y: 0.62, z: -8.2 },
      { x: -6.6, y: 0.62, z: -5.8 },
      { x: -2.74, y: 0.62, z: -2.74 },
    ],
  },
  // Dedicated Direct: ST-04 (验收签批部 East Loading Archway) ↔ Rotunda Portal i=5 (+165°)
  {
    id: 'track-st04-hub',
    label: '中枢派发 ↔ 验收签批部',
    fromBuilding: 'ST-04',
    toBuilding: 'ST-00',
    railAccent: 'cream',
    points: [
      { x: -12.65, y: 0.62, z: 0.0 },
      { x: -10.1, y: 0.62, z: 0.0 },
      { x: -6.8, y: 0.62, z: 0.55 },
      { x: -3.68, y: 0.62, z: 0.98 },
    ],
  },
  // Dedicated Direct: ST-05 (项目档案部 East Loading Archway) ↔ Rotunda Portal i=4 (+135°)
  {
    id: 'track-st05-hub',
    label: '中枢归档 ↔ 项目档案部',
    fromBuilding: 'ST-05',
    toBuilding: 'ST-00',
    railAccent: 'blue',
    points: [
      { x: -12.65, y: 0.62, z: 8.2 },
      { x: -10.1, y: 0.62, z: 8.2 },
      { x: -6.6, y: 0.62, z: 5.8 },
      { x: -2.74, y: 0.62, z: 2.74 },
    ],
  },
  // East-North Portal i=11 (-15°) → Gemini Coding Sanctuary
  {
    id: 'track-hub-coder',
    label: '中枢派发 → Gemini 编码圣殿',
    fromBuilding: 'ST-00',
    toBuilding: 'AI-CODER',
    railAccent: 'blue',
    points: [
      { x: 3.68, y: 0.62, z: -0.98 },
      { x: 5.85, y: 0.62, z: -1.98 },
      { x: 8.15, y: 0.62, z: -3.8 },
      { x: 10.35, y: 0.62, z: -5.15 },
    ],
  },
  // East-South Portal i=0 (+15°) → QA & RSI Sanctuary
  {
    id: 'track-hub-cloud',
    label: '中枢派发 → 质检进化圣殿',
    fromBuilding: 'ST-00',
    toBuilding: 'AI-CLOUD',
    railAccent: 'amber',
    points: [
      { x: 3.68, y: 0.62, z: 0.98 },
      { x: 5.85, y: 0.62, z: 1.98 },
      { x: 8.15, y: 0.62, z: 3.8 },
      { x: 10.35, y: 0.62, z: 5.15 },
    ],
  },
  // Clean non-overlapping Rework Loop connecting QA Sanctuary ↔ Gemini Sanctuary
  {
    id: 'track-rework-loop',
    label: 'REWORK LOOP 质检返工回流轨',
    fromBuilding: 'AI-CLOUD',
    toBuilding: 'AI-CODER',
    railAccent: 'rework',
    points: [
      { x: 10.1, y: 0.62, z: 2.7 },
      { x: 8.2, y: 0.62, z: 1.15 },
      { x: 8.2, y: 0.62, z: -1.15 },
      { x: 10.1, y: 0.62, z: -2.7 },
    ],
  },
];

/**
 * Direct single-segment routes for all 6 active conveyor belts (zero junctions needed).
 */
export const PARCEL_ROUTE_SEGMENTS: Record<string, string[]> = {
  'track-st01-hub': ['track-st01-hub'],
  'track-st04-hub': ['track-st04-hub'],
  'track-st05-hub': ['track-st05-hub'],
  'track-hub-coder': ['track-hub-coder'],
  'track-hub-cloud': ['track-hub-cloud'],
  'track-rework-loop': ['track-rework-loop'],
};

export const CAMERA_PRESETS: Record<CameraPresetId, CameraPresetConfig> = {
  overview: {
    id: 'overview',
    label: '全景鸟瞰',
    position: { x: 0.4, y: 26.5, z: 40.5 },
    target: { x: -0.6, y: 0.8, z: 0.2 },
  },
  follow: {
    id: 'follow',
    label: '跟随包裹',
    position: { x: -16.2, y: 5.4, z: -2.6 },
    target: { x: -10.0, y: 1.0, z: -4.2 },
  },
  sanctuary_coder: {
    id: 'sanctuary_coder',
    label: 'Gemini 圣殿',
    position: { x: 4.6, y: 6.4, z: 5.8 },
    target: { x: 11.4, y: 2.35, z: -5.4 },
  },
  sanctuary_cloud: {
    id: 'sanctuary_cloud',
    label: '质检圣殿',
    position: { x: 5.2, y: 5.6, z: 16.0 },
    target: { x: 12.6, y: 2.3, z: 6.2 },
  },
  rotunda: {
    id: 'rotunda',
    label: '中枢穹顶',
    position: { x: 0.4, y: 7.4, z: 16.8 },
    target: { x: 0, y: 2.9, z: 0.6 },
  },
};

export const ATMOSPHERE_PRESETS: Record<
  Exclude<AtmospherePresetId, 'cycle'>,
  AtmosphereState
> = {
  day: {
    id: 'day',
    label: '日间晴空',
    clockText: '09:38',
    dateText: '6月21日 周日',
    weatherText: '晴',
    tempText: '26°',
    weatherIcon: 'sun',
    skyHex: '#8EC9F2',
    fogHex: '#B7DCF6',
    fogNear: 58,
    fogFar: 132,
    sunColorHex: '#FFF2D6',
    sunIntensity: 2.2,
    sunPos: { x: 26, y: 34, z: 22 },
    hemiSkyHex: '#A6D6FF',
    hemiGroundHex: '#5A8D3E',
    hemiIntensity: 0.72,
    ambientIntensity: 0.14,
    envIntensity: 0.36,
    exposure: 0.97,
    nightFactor: 0,
    snowFactor: 0,
    autumnFactor: 0,
  },
  sunset: {
    id: 'sunset',
    label: '黄昏日落',
    clockText: '17:46',
    dateText: '9月18日 周五',
    weatherText: '晚霞',
    tempText: '22°',
    weatherIcon: 'sunset',
    skyHex: '#E89567',
    fogHex: '#EDAD84',
    fogNear: 50,
    fogFar: 118,
    sunColorHex: '#FF8D3D',
    sunIntensity: 2.15,
    sunPos: { x: -30, y: 12, z: 18 },
    hemiSkyHex: '#FFBE88',
    hemiGroundHex: '#5A4834',
    hemiIntensity: 0.56,
    ambientIntensity: 0.12,
    envIntensity: 0.24,
    exposure: 0.95,
    nightFactor: 0.48,
    snowFactor: 0,
    autumnFactor: 0.78,
  },
  night: {
    id: 'night',
    label: '星夜灯火',
    clockText: '21:12',
    dateText: '6月21日 周日',
    weatherText: '晴夜',
    tempText: '17°',
    weatherIcon: 'moon',
    skyHex: '#0F1B38',
    fogHex: '#152447',
    fogNear: 46,
    fogFar: 112,
    sunColorHex: '#5E85D6',
    sunIntensity: 0.38,
    sunPos: { x: -18, y: 28, z: -20 },
    hemiSkyHex: '#25407A',
    hemiGroundHex: '#111C30',
    hemiIntensity: 0.36,
    ambientIntensity: 0.09,
    envIntensity: 0.08,
    exposure: 0.93,
    nightFactor: 1,
    snowFactor: 0,
    autumnFactor: 0,
  },
  snow: {
    id: 'snow',
    label: '冬日初雪',
    clockText: '07:09',
    dateText: '12月14日 周日',
    weatherText: '小雪',
    tempText: '2°',
    weatherIcon: 'snow',
    skyHex: '#BDD3E6',
    fogHex: '#D0E0EE',
    fogNear: 48,
    fogFar: 115,
    sunColorHex: '#EBF4FF',
    sunIntensity: 1.58,
    sunPos: { x: 20, y: 26, z: 24 },
    hemiSkyHex: '#D6E8F8',
    hemiGroundHex: '#9EB3C4',
    hemiIntensity: 0.74,
    ambientIntensity: 0.16,
    envIntensity: 0.32,
    exposure: 0.95,
    nightFactor: 0.22,
    snowFactor: 1,
    autumnFactor: 0,
  },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpHexColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHexColor(a);
  const [br, bg, bb] = parseHexColor(b);
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function evaluateAtmosphere(
  preset: AtmospherePresetId,
  elapsedSec: number
): AtmosphereState {
  if (preset !== 'cycle') {
    return ATMOSPHERE_PRESETS[preset];
  }

  const order: Array<Exclude<AtmospherePresetId, 'cycle'>> = [
    'day',
    'sunset',
    'night',
    'snow',
  ];
  const cycleSeconds = 36;
  const phase = ((elapsedSec % cycleSeconds) / cycleSeconds) * order.length;
  const idxA = Math.floor(phase) % order.length;
  const idxB = (idxA + 1) % order.length;
  const localT = phase - Math.floor(phase);
  const blend = localT < 0.62 ? 0 : (localT - 0.62) / 0.38;
  const smooth = blend * blend * (3 - 2 * blend);

  const a = ATMOSPHERE_PRESETS[order[idxA]];
  const b = ATMOSPHERE_PRESETS[order[idxB]];
  const dominant = smooth < 0.5 ? a : b;

  return {
    id: dominant.id,
    label: `四季轮转 · ${dominant.label}`,
    clockText: dominant.clockText,
    dateText: dominant.dateText,
    weatherText: dominant.weatherText,
    tempText: dominant.tempText,
    weatherIcon: dominant.weatherIcon,
    skyHex: lerpHexColor(a.skyHex, b.skyHex, smooth),
    fogHex: lerpHexColor(a.fogHex, b.fogHex, smooth),
    fogNear: lerp(a.fogNear, b.fogNear, smooth),
    fogFar: lerp(a.fogFar, b.fogFar, smooth),
    sunColorHex: lerpHexColor(a.sunColorHex, b.sunColorHex, smooth),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, smooth),
    sunPos: {
      x: lerp(a.sunPos.x, b.sunPos.x, smooth),
      y: lerp(a.sunPos.y, b.sunPos.y, smooth),
      z: lerp(a.sunPos.z, b.sunPos.z, smooth),
    },
    hemiSkyHex: lerpHexColor(a.hemiSkyHex, b.hemiSkyHex, smooth),
    hemiGroundHex: lerpHexColor(a.hemiGroundHex, b.hemiGroundHex, smooth),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, smooth),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, smooth),
    envIntensity: lerp(a.envIntensity, b.envIntensity, smooth),
    exposure: lerp(a.exposure, b.exposure, smooth),
    nightFactor: lerp(a.nightFactor, b.nightFactor, smooth),
    snowFactor: lerp(a.snowFactor, b.snowFactor, smooth),
    autumnFactor: lerp(a.autumnFactor, b.autumnFactor, smooth),
  };
}

export function samplePolylinePoint(
  points: Vec3Tuple[],
  t: number
): { position: Vec3Tuple; tangent: Vec3Tuple } {
  const clamped = Math.max(0, Math.min(1, t));
  if (points.length === 0) {
    return { position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 } };
  }
  if (points.length === 1) {
    return { position: { ...points[0] }, tangent: { x: 1, y: 0, z: 0 } };
  }

  const segCount = points.length - 1;
  const scaled = clamped * segCount;
  const idx = Math.min(segCount - 1, Math.floor(scaled));
  const localT = scaled - idx;

  const p0 = points[Math.max(0, idx - 1)];
  const p1 = points[idx];
  const p2 = points[Math.min(points.length - 1, idx + 1)];
  const p3 = points[Math.min(points.length - 1, idx + 2)];

  const tt = localT * localT;
  const ttt = tt * localT;

  const catmull = (v0: number, v1: number, v2: number, v3: number) =>
    0.5 *
    (2 * v1 +
      (-v0 + v2) * localT +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * tt +
      (-v0 + 3 * v1 - 3 * v2 + v3) * ttt);

  const catmullDeriv = (v0: number, v1: number, v2: number, v3: number) =>
    0.5 *
    (-v0 +
      v2 +
      2 * (2 * v0 - 5 * v1 + 4 * v2 - v3) * localT +
      3 * (-v0 + 3 * v1 - 3 * v2 + v3) * tt);

  const pos = {
    x: catmull(p0.x, p1.x, p2.x, p3.x),
    y: catmull(p0.y, p1.y, p2.y, p3.y),
    z: catmull(p0.z, p1.z, p2.z, p3.z),
  };

  const dx = catmullDeriv(p0.x, p1.x, p2.x, p3.x);
  const dy = catmullDeriv(p0.y, p1.y, p2.y, p3.y);
  const dz = catmullDeriv(p0.z, p1.z, p2.z, p3.z);
  const len = Math.hypot(dx, dy, dz) || 1;

  return {
    position: pos,
    tangent: { x: dx / len, y: dy / len, z: dz / len },
  };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Translates either Real AutoDev Studio snapshot or Demo Phase into synchronized 3D parcels,
 * comic callout bursts, and AI Sanctuary streaming terminal bubbles (Department-only naming).
 */
function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Computes a one-shot workflow stage journey progress: smoothly travels from
 * `startT` to `endT` over `durationSec` when entering a stage, then rests docked
 * at `endT` (`inTransit: false`) until the pipeline transitions to the next state.
 */
export function computeStageJourneyProgress(
  stageElapsedSec: number,
  startT: number,
  endT: number,
  durationSec = 2.6
): { progress: number; inTransit: boolean } {
  if (durationSec <= 0 || stageElapsedSec >= durationSec) {
    return { progress: endT, inTransit: false };
  }
  const u = easeInOutCubic(Math.max(0, stageElapsedSec) / durationSec);
  return {
    progress: startT + (endT - startT) * u,
    inTransit: true,
  };
}

/**
 * Pure derivation of the 3D Village HUD overlays, state-driven parcel routes,
 * comic bursts, and AI terminal card from the real or demo FactoryPipelineSnapshot.
 */
export function deriveVillageHudState(
  snapshot: FactoryPipelineSnapshot,
  elapsedSec: number,
  stageElapsedSec = elapsedSec
): VillageHudOverlayState {
  const isDemo = snapshot.mode === 'demo';
  const phase = snapshot.phaseIndex ?? 0;
  const reworkActive = snapshot.tracks.reworkSt03ToSt02 === 'rework';

  if (isDemo) {
    const heroLabel = snapshot.workpiece
      ? `${snapshot.workpiece.prNumberLabel} ${snapshot.workpiece.title}`
      : 'PR #418 多币种发票';
    const parcels: VillageParcelSpec[] = [];

    if (phase === 0) {
      // Phase 01: ST-01 架构策划部 → 北转运站 → 中枢穹顶
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.04, 0.94, 2.8);
      parcels.push({
        id: 'hero-prd',
        trackId: 'track-st01-hub',
        progress: flow.progress,
        inTransit: flow.inTransit,
        label: heroLabel,
        statusText: flow.inTransit ? '架构策划部 · 发往中枢' : '架构策划部 · 编译完成',
        accentColor: '#D96B38',
        isHero: true,
      });
    } else if (phase === 1) {
      // Phase 02: 中枢穹顶 → Gemini 编码圣殿
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.04, 0.92, 2.5);
      parcels.push({
        id: 'hero-coder',
        trackId: 'track-hub-coder',
        progress: flow.progress,
        inTransit: flow.inTransit,
        label: heroLabel,
        statusText: flow.inTransit ? '派发至 Gemini 圣殿' : 'Gemini 编码 · 运行中',
        accentColor: '#2563EB',
        isHero: true,
      });
    } else if (phase === 2) {
      // Phase 03: 中枢穹顶 → 质检进化圣殿 (盲测中)
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.04, 0.92, 2.5);
      parcels.push({
        id: 'hero-qa',
        trackId: 'track-hub-cloud',
        progress: flow.progress,
        inTransit: flow.inTransit,
        label: heroLabel,
        statusText: flow.inTransit ? '送往质检圣殿' : '质检实验室 · 盲测中',
        accentColor: '#059669',
        isHero: true,
      });
    } else if (phase === 3) {
      // Phase 04: 质检圣殿拦截 → 经 REWORK LOOP 返工回流至 Gemini 圣殿
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.04, 0.94, 2.6);
      parcels.push({
        id: 'hero-rework',
        trackId: 'track-rework-loop',
        progress: flow.progress,
        inTransit: flow.inTransit,
        label: heroLabel,
        statusText: flow.inTransit ? '盲测拦截 · 返工回流中' : '已回流 Gemini 圣殿',
        accentColor: '#DC2626',
        isHero: true,
        isRework: true,
      });
    } else if (phase === 4) {
      // Phase 05: Gemini 编码圣殿原 Session 自动修复中（停靠在 Gemini 到达台）
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.72, 0.94, 1.4);
      parcels.push({
        id: 'hero-autofix',
        trackId: 'track-hub-coder',
        progress: flow.progress,
        inTransit: flow.inTransit,
        label: heroLabel,
        statusText: '自动修复 · 重推沙箱',
        accentColor: '#2563EB',
        isHero: true,
      });
    } else if (phase === 5) {
      // Phase 06: 返修完成 → 再次送达质检圣殿二次盲测全过
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.94, 0.06, 2.4);
      parcels.push({
        id: 'hero-pass2',
        trackId: 'track-rework-loop',
        progress: flow.progress,
        inTransit: flow.inTransit,
        label: heroLabel,
        statusText: flow.inTransit ? '复测回送质检圣殿' : '二次盲测 · 全部通过',
        accentColor: '#059669',
        isHero: true,
      });
    } else if (phase === 6) {
      // Phase 07: 两段式顺滑流转：质检圣殿 → 中枢穹顶 → 验收签批部
      if (stageElapsedSec < 1.25) {
        const leg1 = computeStageJourneyProgress(stageElapsedSec, 0.92, 0.06, 1.25);
        parcels.push({
          id: 'hero-approve',
          trackId: 'track-hub-cloud',
          progress: leg1.progress,
          inTransit: true,
          label: heroLabel,
          statusText: '质检通过 · 回送中枢',
          accentColor: '#059669',
          isHero: true,
        });
      } else {
        const leg2 = computeStageJourneyProgress(stageElapsedSec - 1.25, 0.94, 0.08, 2.0);
        parcels.push({
          id: 'hero-approve',
          trackId: 'track-st04-hub',
          progress: leg2.progress,
          inTransit: leg2.inTransit,
          label: heroLabel,
          statusText: leg2.inTransit ? '送达验收签批部' : 'APPROVED · 准予上线',
          accentColor: '#D97706',
          isHero: true,
        });
      }
    } else {
      // Phase 08: 两段式归档入库（验收签批部 → 中枢 → 项目档案部大门消失）随后触发全村上线庆祝！
      const leg1Dur = 1.15;
      const leg2Dur = 1.95;
      const totalTransit = leg1Dur + leg2Dur;
      if (stageElapsedSec < leg1Dur) {
        const leg1 = computeStageJourneyProgress(stageElapsedSec, 0.08, 0.94, leg1Dur);
        parcels.push({
          id: 'hero-archive',
          trackId: 'track-st04-hub',
          progress: leg1.progress,
          inTransit: true,
          scale: 1,
          label: heroLabel,
          statusText: '签批放行 · 经中枢归档',
          accentColor: '#059669',
          isHero: true,
        });
      } else if (stageElapsedSec < totalTransit) {
        const leg2Elapsed = stageElapsedSec - leg1Dur;
        const leg2 = computeStageJourneyProgress(leg2Elapsed, 0.94, 0.0, leg2Dur);
        const fadeTail = leg2Elapsed > leg2Dur - 0.35 ? Math.max(0, (leg2Dur - leg2Elapsed) / 0.35) : 1;
        parcels.push({
          id: 'hero-archive',
          trackId: 'track-st05-hub',
          progress: leg2.progress,
          inTransit: true,
          scale: fadeTail,
          label: heroLabel,
          statusText: '正在入库项目档案部',
          accentColor: '#059669',
          isHero: true,
        });
      }
      // Once stageElapsedSec >= totalTransit, parcel has entered the vault & disappeared!
    }

    const comicBurst: VillageComicBurstState =
      phase === 0
        ? {
            visible: true,
            anchorBuilding: 'ST-01',
            text: '叮! 新需求进入产线!',
            tone: 'amber',
          }
        : phase === 3
        ? {
            visible: true,
            anchorBuilding: 'AI-CLOUD',
            text: '叮! 盲测拦截，触发返工!',
            tone: 'red',
          }
        : phase === 6
        ? {
            visible: true,
            anchorBuilding: 'ST-04',
            text: 'APPROVED! 准予上线!',
            tone: 'emerald',
          }
        : phase === 7 && stageElapsedSec >= 3.1
        ? {
            visible: true,
            anchorBuilding: 'ST-00',
            text: '🎉 上线成功! 交付达成!',
            tone: 'emerald',
          }
        : {
            visible: false,
            anchorBuilding: 'ST-01',
            text: '',
            tone: 'amber',
          };

    let terminal: VillageTerminalState;
    if (phase === 1 || phase === 4) {
      terminal = {
        visible: true,
        anchorBuilding: 'AI-CODER',
        agentName: 'Gemini Coding Agent',
        statusBadge: phase === 4 ? '返工自动修复中' : '正在编写代码',
        statusTone: phase === 4 ? 'rework' : 'running',
        lines:
          phase === 4
            ? [
                { text: '接收质检实验室盲测报错 · 原 Session 唤醒', tone: 'warn' },
                { text: '定位 currencyFormatter.ts 零除浮点精度异常', tone: 'info' },
                { text: '✓ 修复整数分运算并补充边界单测', tone: 'pass' },
                { text: '✓ 冒烟沙箱构建通过 · 重新推送 PR #418', tone: 'pass' },
              ]
            : [
                { text: '读取架构策划部 Spec DAG · 生成业务模块', tone: 'muted' },
                { text: '+ src/lib/currencyFormatter.ts (多币种换算)', tone: 'info' },
                { text: '+ src/api/invoiceExport.ts (PDF 幂等导出)', tone: 'info' },
                { text: '✓ 本地 tsc & vite build 冒烟通过', tone: 'pass' },
              ],
        summaryPill:
          phase === 4 ? '✓ 已修复精度缺陷，发回盲测验证' : undefined,
      };
    } else if (phase === 2 || phase === 3 || phase === 5) {
      terminal = {
        visible: true,
        anchorBuilding: 'AI-CLOUD',
        agentName: '质检与 RSI 引擎',
        statusBadge:
          phase === 3 ? '拦截并沉淀规则' : phase === 5 ? '二次盲测全过' : '盲测执行中',
        statusTone:
          phase === 3 ? 'rework' : phase === 5 ? 'passed' : 'running',
        lines:
          phase === 3
            ? [
                { text: '执行防篡改 blind-tests/ (12 项用例)', tone: 'muted' },
                { text: '✗ TC-05 多币种四舍五入精度漂移 FAIL', tone: 'error' },
                { text: '→ 已沉淀 RULE+09: 禁止浮点直接累乘汇率', tone: 'warn' },
                { text: '→ 触发 REWORK LOOP 发回原 Session 修复', tone: 'warn' },
              ]
            : phase === 5
            ? [
                { text: '执行二次回归盲测 (12/12 用例)', tone: 'muted' },
                { text: '✓ TC-05 精度回归验证通过 (0.00ms 漂移)', tone: 'pass' },
                { text: '✓ Cloudflare Preview 环境健康检查通过', tone: 'pass' },
                { text: '✓ 已推送至验收签批部等待上线签批', tone: 'pass' },
              ]
            : [
                { text: '锁定 tests/ 防篡改哈希校验通过', tone: 'muted' },
                { text: '✓ TC-01..TC-04 并发导出幂等性 PASS', tone: 'pass' },
                { text: '▶ 正在压测多币种汇率边界场景...', tone: 'info' },
              ],
        summaryPill:
          phase === 5 ? '✓ 12/12 盲测全部通过，预览已就绪' : undefined,
      };
    } else if (phase === 6 || phase === 7) {
      terminal = {
        visible: true,
        anchorBuilding: 'AI-CODER',
        agentName: 'Gemini 交付总控',
        statusBadge: '已完成',
        statusTone: 'passed',
        lines: [
          { text: '✓ 12/12 盲测通过 · 1 轮返工自愈成功', tone: 'pass' },
          { text: '✓ 验收签批部批准合并主干并部署上线', tone: 'pass' },
          { text: '✓ 项目档案部完整交付报告已归档', tone: 'pass' },
        ],
        summaryPill: '✓ PR #418 已上线并归档，耗时 4m 18s',
      };
    } else {
      terminal = {
        visible: true,
        anchorBuilding: 'AI-CLOUD',
        agentName: '架构策划部 · 联合规划',
        statusBadge: '正在拆解需求',
        statusTone: 'running',
        lines: [
          { text: '解析 PRD 正文 · 生成结构化 Spec DAG', tone: 'muted' },
          { text: '✓ 提取 2 项 P0 歧义确认与 3 项架构假设', tone: 'pass' },
          { text: '✓ 同步生成 12 条防篡改盲测用例', tone: 'pass' },
        ],
      };
    }

    const demoWorkingBuildings: VillageBuildingId[] =
      phase === 0
        ? ['ST-01']
        : phase === 1 || phase === 3 || phase === 4
        ? ['AI-CODER']
        : phase === 2 || phase === 5
        ? ['AI-CLOUD']
        : phase === 6
        ? ['ST-04']
        : ['ST-05'];

    const demoWorkingStageLabel =
      phase === 0
        ? '架构规划中'
        : phase === 1
        ? '编码构建中'
        : phase === 2
        ? 'E2E 质检中'
        : phase === 3
        ? '返工修复中'
        : phase === 4
        ? '自动修复中'
        : phase === 5
        ? '复测通过'
        : phase === 6
        ? '签批放行中'
        : '成果归档中';

    const demoCelebrationActive = phase === 7 && stageElapsedSec >= 3.1;
    const demoCelebrationElapsed = demoCelebrationActive ? stageElapsedSec - 3.1 : 0;

    return {
      activePipelinesCount: 1,
      heroStepLabel: snapshot.phaseLabel,
      parcels,
      comicBurst,
      terminal,
      reworkActive,
      sanctuaryCelebrate:
        phase === 6 || phase === 7 ? 'coder' : phase === 5 ? 'cloud' : 'none',
      hasActiveTransit: parcels.some((p) => p.inTransit),
      workingBuildingIds: demoWorkingBuildings,
      workingStageLabel: demoWorkingStageLabel,
      celebrationActive: demoCelebrationActive,
      celebrationElapsedSec: demoCelebrationElapsed,
      celebrationLabel: demoCelebrationActive ? `${heroLabel} 已上线归档` : '',
      celebrationDone: false,
    };
  }

  // Real Live Production Data Mapping — Strictly State-Driven (ZERO endless spinning, ZERO lingering delivered parcels!)
  const wp = snapshot.workpiece;
  const activeStation = snapshot.activeStationId;
  const tokensFormatted = formatTokenCount(snapshot.st00.totalTokens);
  const successRateText =
    snapshot.st00.successRatePct !== null
      ? `${snapshot.st00.successRatePct}%`
      : '待统计';
  const realParcels: VillageParcelSpec[] = [];

  const isRunningPipeline =
    snapshot.st00.runningCount > 0 ||
    wp?.tone === 'running' ||
    wp?.tone === 'rework' ||
    reworkActive;

  // Delivery celebration sequence timing (ST-04 -> ST-00 -> ST-05 vault entry -> 5.6s village fireworks -> return to idle)
  const ARCHIVE_LEG1_DUR = 1.25;
  const ARCHIVE_LEG2_DUR = 2.05;
  const ARCHIVE_TRANSIT_TOTAL = ARCHIVE_LEG1_DUR + ARCHIVE_LEG2_DUR; // 3.3s
  const CELEBRATION_DUR = 5.6;
  const CELEBRATION_END = ARCHIVE_TRANSIT_TOTAL + CELEBRATION_DUR; // 8.9s

  let realCelebrationActive = false;
  let realCelebrationElapsed = 0;
  let realCelebrationDone = false;
  let realCelebrationLabel = '';

  if (wp) {
    const label = `${wp.prNumberLabel} ${wp.title}`;
    const accent =
      wp.tone === 'rework'
        ? '#DC2626'
        : wp.tone === 'waiting'
        ? '#D97706'
        : wp.tone === 'passed'
        ? '#059669'
        : '#2563EB';

    if (activeStation === 'ST-05' && snapshot.justDelivered) {
      // Freshly launched & archived release:
      // 1) Glide ST-04 -> ST-00 Hub -> ST-05 Archive doorway & vanish inside vault
      // 2) Trigger 3D village celebration fireworks & confetti
      // 3) Return cleanly to idle state (ZERO parcel lingering on conveyor!)
      if (stageElapsedSec < ARCHIVE_LEG1_DUR) {
        const leg1 = computeStageJourneyProgress(stageElapsedSec, 0.08, 0.94, ARCHIVE_LEG1_DUR);
        realParcels.push({
          id: 'real-hero',
          trackId: 'track-st04-hub',
          progress: leg1.progress,
          inTransit: true,
          scale: 1,
          label,
          statusText: '签批通过 · 发往归档',
          accentColor: '#059669',
          isHero: true,
        });
      } else if (stageElapsedSec < ARCHIVE_TRANSIT_TOTAL) {
        const leg2Elapsed = stageElapsedSec - ARCHIVE_LEG1_DUR;
        const leg2 = computeStageJourneyProgress(leg2Elapsed, 0.94, 0.0, ARCHIVE_LEG2_DUR);
        const fadeTail =
          leg2Elapsed > ARCHIVE_LEG2_DUR - 0.35
            ? Math.max(0, (ARCHIVE_LEG2_DUR - leg2Elapsed) / 0.35)
            : 1;
        realParcels.push({
          id: 'real-hero',
          trackId: 'track-st05-hub',
          progress: leg2.progress,
          inTransit: true,
          scale: fadeTail,
          label,
          statusText: '正在入库项目档案部',
          accentColor: '#059669',
          isHero: true,
        });
      } else if (stageElapsedSec < CELEBRATION_END) {
        // Parcel has entered the vault (hidden); village celebrates!
        realCelebrationActive = true;
        realCelebrationElapsed = stageElapsedSec - ARCHIVE_TRANSIT_TOTAL;
        realCelebrationLabel = `${label} 已成功上线归档`;
      } else {
        // Celebration finished -> signal controller/App to return to initial idle state
        realCelebrationDone = true;
      }
    } else if (activeStation === 'ST-04') {
      // Two-leg smooth delivery after coding/QA completes:
      // Leg 1: AI-CODER -> ST-00 Hub (1.2s), Leg 2: ST-00 Hub -> ST-04 Acceptance Gate (2.0s)
      const leg1Dur = 1.2;
      const leg2Dur = 2.0;
      if (stageElapsedSec < leg1Dur) {
        const leg1 = computeStageJourneyProgress(stageElapsedSec, 0.92, 0.06, leg1Dur);
        realParcels.push({
          id: 'real-hero',
          trackId: 'track-hub-coder',
          progress: leg1.progress,
          inTransit: true,
          scale: 1,
          label,
          statusText: '编码完成 · 回送中枢',
          accentColor: '#059669',
          isHero: true,
        });
      } else {
        const leg2 = computeStageJourneyProgress(stageElapsedSec - leg1Dur, 0.94, 0.08, leg2Dur);
        realParcels.push({
          id: 'real-hero',
          trackId: 'track-st04-hub',
          progress: leg2.progress,
          inTransit: leg2.inTransit,
          scale: 1,
          label,
          statusText: leg2.inTransit ? '送达验收签批部' : wp.statusLabel,
          accentColor: '#D97706',
          isHero: true,
        });
      }
    } else if (reworkActive || wp.location === 'rework_3_2') {
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.05, 0.94, 2.5);
      realParcels.push({
        id: 'real-hero',
        trackId: 'track-rework-loop',
        progress: flow.progress,
        inTransit: flow.inTransit,
        scale: 1,
        label,
        statusText: flow.inTransit ? '返工回流 Gemini 圣殿' : wp.statusLabel,
        accentColor: '#DC2626',
        isHero: true,
        isRework: true,
      });
    } else if (activeStation === 'ST-01') {
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.05, 0.92, 2.8);
      realParcels.push({
        id: 'real-hero',
        trackId: 'track-st01-hub',
        progress: flow.progress,
        inTransit: flow.inTransit,
        scale: 1,
        label,
        statusText: wp.statusLabel,
        accentColor: accent,
        isHero: true,
      });
    } else if (activeStation === 'ST-02') {
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.05, 0.92, 2.5);
      realParcels.push({
        id: 'real-hero',
        trackId: 'track-hub-coder',
        progress: flow.progress,
        inTransit: flow.inTransit,
        scale: 1,
        label,
        statusText: wp.statusLabel,
        accentColor: accent,
        isHero: true,
      });
    } else if (activeStation === 'ST-03') {
      const flow = computeStageJourneyProgress(stageElapsedSec, 0.05, 0.92, 2.5);
      realParcels.push({
        id: 'real-hero',
        trackId: 'track-hub-cloud',
        progress: flow.progress,
        inTransit: flow.inTransit,
        scale: 1,
        label,
        statusText: wp.statusLabel,
        accentColor: accent,
        isHero: true,
        isRework: reworkActive || wp.tone === 'rework',
      });
    }
  }

  const realActiveCount = snapshot.st00.runningCount;

  const isCoderAnchor =
    activeStation === 'ST-02' ||
    reworkActive ||
    activeStation === 'ST-05' ||
    activeStation === 'ST-00';

  const realTerminalLines: VillageTerminalState['lines'] = [];
  if (activeStation === 'ST-02' || reworkActive) {
    for (const logLine of snapshot.st02.smokeLogs.slice(-3)) {
      realTerminalLines.push({
        text: logLine,
        tone: reworkActive ? 'warn' : 'info',
      });
    }
  } else if (activeStation === 'ST-03') {
    for (const rule of snapshot.st03.rsiRules.slice(0, 3)) {
      realTerminalLines.push({
        text: `${rule.code} ${rule.title}`,
        tone: 'pass',
      });
    }
  } else {
    realTerminalLines.push(
      {
        text: `近 7 日成功率 ${successRateText} · 消耗 ${tokensFormatted} Tokens`,
        tone: 'muted',
      },
      {
        text: `✓ 已归档交付 ${snapshot.st05.deliveredCount} 项 · 当前运行 ${snapshot.st00.runningCount} 项`,
        tone: 'pass',
      },
      {
        text: snapshot.st05.latestTitle
          ? `✓ 最新交付：${snapshot.st05.latestTitle}`
          : '等待投放新 PRD 启动自动研发流水线',
        tone: 'info',
      }
    );
  }

  const realWorkingBuildings: VillageBuildingId[] = [];
  let realWorkingLabel = '';
  if (realCelebrationActive) {
    realWorkingBuildings.push('ST-05');
    realWorkingLabel = '上线归档达成';
  } else if (
    isRunningPipeline ||
    snapshot.st04.isAwaitingApproval ||
    (activeStation === 'ST-05' && snapshot.justDelivered && !realCelebrationDone)
  ) {
    if (activeStation === 'ST-01') {
      realWorkingBuildings.push('ST-01');
      realWorkingLabel =
        snapshot.stationStates['ST-01'].statusText === '创建 PR 中'
          ? '创建 PR 中'
          : snapshot.stationStates['ST-01'].led === 'running'
          ? '架构规划中'
          : '待建 Draft PR';
    } else if (activeStation === 'ST-02') {
      // Coding OR rework-fixing: STRICTLY ONLY Gemini Coding Sanctuary is working!
      realWorkingBuildings.push('AI-CODER');
      realWorkingLabel = reworkActive ? '返工修复中' : '编码开发中';
    } else if (activeStation === 'ST-03') {
      // QA inspection / interception: STRICTLY ONLY QA & RSI Sanctuary is working!
      realWorkingBuildings.push('AI-CLOUD');
      realWorkingLabel = reworkActive ? '质检拦截中' : 'E2E 质检中';
    } else if (activeStation === 'ST-04' || snapshot.st04.isAwaitingApproval) {
      realWorkingBuildings.push('ST-04');
      realWorkingLabel = '待签批验收';
    } else if (activeStation === 'ST-05') {
      realWorkingBuildings.push('ST-05');
      realWorkingLabel = '成果归档中';
    } else {
      realWorkingBuildings.push('ST-00');
      realWorkingLabel = '调度执行中';
    }
  }

  const showQaInterceptBurst = activeStation === 'ST-03' && reworkActive;
  const hasInFlightPipeline = Boolean(
    wp && !(activeStation === 'ST-05' && realCelebrationDone)
  );

  return {
    activePipelinesCount: Math.max(realActiveCount, hasInFlightPipeline ? 1 : 0),
    heroStepLabel: wp
      ? `${wp.prNumberLabel} · ${wp.statusLabel}`
      : snapshot.phaseLabel,
    parcels: realParcels,
    comicBurst: realCelebrationActive
      ? {
          visible: true,
          anchorBuilding: 'ST-00',
          text: '🎉 上线成功! 交付达成!',
          tone: 'emerald',
        }
      : {
          visible: showQaInterceptBurst || snapshot.st04.isAwaitingApproval,
          anchorBuilding: showQaInterceptBurst ? 'AI-CLOUD' : 'ST-04',
          text: showQaInterceptBurst ? '叮! 质检拦截返工!' : '叮! 编码完成待签批!',
          tone: showQaInterceptBurst ? 'red' : 'amber',
        },
    terminal: {
      // Do NOT show the persistent dark telemetry card by default in Real Mode!
      visible: false,
      anchorBuilding: isCoderAnchor ? 'AI-CODER' : 'AI-CLOUD',
      agentName: isCoderAnchor ? 'Gemini Coding Agent' : '质检与 RSI 引擎',
      statusBadge: wp?.statusLabel ?? snapshot.phaseLabel,
      statusTone:
        wp?.tone === 'rework'
          ? 'rework'
          : wp?.tone === 'waiting'
          ? 'waiting'
          : wp?.tone === 'running'
          ? 'running'
          : 'passed',
      lines: realTerminalLines,
      summaryPill:
        activeStation === 'ST-05' || activeStation === 'ST-00'
          ? `✓ ${snapshot.st05.latestTitle || '真实产线在线待命'}`
          : undefined,
    },
    reworkActive,
    sanctuaryCelebrate:
      realCelebrationActive || (activeStation === 'ST-05' && snapshot.justDelivered)
        ? 'coder'
        : activeStation === 'ST-03'
        ? 'cloud'
        : 'none',
    hasActiveTransit: realParcels.some((p) => p.inTransit),
    workingBuildingIds: realWorkingBuildings,
    workingStageLabel: realWorkingLabel,
    celebrationActive: realCelebrationActive,
    celebrationElapsedSec: realCelebrationElapsed,
    celebrationLabel: realCelebrationLabel,
    celebrationDone: realCelebrationDone,
  };
}
