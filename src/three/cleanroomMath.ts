import type { FactoryStationId, FactoryWorkpiecePod, StationLedState } from '../lib/factoryPipelineState';

export const STUDIO_SPACING = 32;
export const CAMERA_FOV = 32;
export const MAX_INSPECT_YAW_DEG = 22;
export const MAX_INSPECT_YAW_RAD = (MAX_INSPECT_YAW_DEG * Math.PI) / 180;

export const STATION_ORDER: FactoryStationId[] = [
  'ST-00',
  'ST-01',
  'ST-02',
  'ST-03',
  'ST-04',
  'ST-05',
];

export const STUDIO_X_POSITIONS: Record<FactoryStationId, number> = {
  'ST-00': 0 * STUDIO_SPACING,
  'ST-01': 1 * STUDIO_SPACING,
  'ST-02': 2 * STUDIO_SPACING,
  'ST-03': 3 * STUDIO_SPACING,
  'ST-04': 4 * STUDIO_SPACING,
  'ST-05': 5 * STUDIO_SPACING,
};

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface StudioCameraPose {
  position: Vec3Tuple;
  target: Vec3Tuple;
  fov: number;
}

export interface DollySample {
  cameraPos: Vec3Tuple;
  targetPos: Vec3Tuple;
  fov: number;
  focusBlurPx: number;
  easedProgress: number;
}

export interface WorkpieceWorldPose {
  x: number;
  y: number;
  z: number;
  isReworkRail: boolean;
  facingDir: 1 | -1;
}

export function getStationIndex(stationId: FactoryStationId): number {
  const idx = STATION_ORDER.indexOf(stationId);
  return idx >= 0 ? idx : 0;
}

export function getStationIdByIndex(index: number): FactoryStationId {
  const clamped = Math.max(0, Math.min(STATION_ORDER.length - 1, Math.round(index)));
  return STATION_ORDER[clamped];
}

export function getStationWorldX(stationId: FactoryStationId): number {
  return STUDIO_X_POSITIONS[stationId] ?? 0;
}

/**
 * Computes the hero 3/4 miniature architectural framing pose for a single studio.
 * Tuned for FOV = 32 deg so a 9.6 x 6.8 x 4.6 unit studio fills ~70% of viewport center.
 */
export function computeStudioCameraPose(stationId: FactoryStationId): StudioCameraPose {
  const sx = getStationWorldX(stationId);
  return {
    position: {
      x: sx + 3.85,
      y: 6.05,
      z: 15.25,
    },
    target: {
      x: sx,
      y: 1.68,
      z: -0.1,
    },
    fov: CAMERA_FOV,
  };
}

/**
 * Smooth cubic-in-out easing curve approximating cinematic dolly acceleration/deceleration.
 */
export function easeCinematicCubic(rawT: number): number {
  const t = Math.max(0, Math.min(1, rawT));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Evaluates cinematic camera glide between two X positions with:
 * - smooth cubic dolly glide (~1.0s)
 * - graceful Arc Sway (+Z pullback and subtle +Y lift proportional to jump distance)
 * - subtle Zoom Breath (gentle FOV widen mid-flight, settling to 32 deg)
 * - transient optical Focus Rack blur peaking mid-flight and snapping sharp on arrival
 */
export function evaluateDollyTransition(
  fromStation: FactoryStationId,
  toStation: FactoryStationId,
  rawT: number,
  options?: { isReworkRewind?: boolean }
): DollySample {
  const t = Math.max(0, Math.min(1, rawT));
  const eased = easeCinematicCubic(t);
  const fromPose = computeStudioCameraPose(fromStation);
  const toPose = computeStudioCameraPose(toStation);

  const deltaX = toPose.target.x - fromPose.target.x;
  const dist = Math.abs(deltaX);
  const bell = Math.sin(Math.PI * t); // 0 -> 1 -> 0

  const isRework = Boolean(options?.isReworkRewind);
  const arcPullbackZ = dist > 0.1 ? Math.min(2.8, 0.9 + dist * 0.032) * bell : 0;
  const arcLiftY = dist > 0.1 ? (isRework ? -0.35 : 0.42) * bell : 0;
  const zoomBreathFov = dist > 0.1 ? Math.min(1.6, 0.7 + dist * 0.015) * bell : 0;

  // Optical Focus Rack peaks cleanly in the middle ~0.35s of movement
  const focusWave = dist > 0.1 ? Math.pow(bell, 1.55) : 0;
  const maxBlur = isRework ? 2.8 : Math.min(2.6, 1.7 + dist * 0.012);
  const focusBlurPx = t <= 0.03 || t >= 0.97 ? 0 : Number((focusWave * maxBlur).toFixed(2));

  const targetX = fromPose.target.x + deltaX * eased;
  const cameraX = fromPose.position.x + deltaX * eased;

  // Slight lead on lookAt during lateral glide for cinematic gimbal feel
  const lookLeadX = dist > 0.1 ? Math.sign(deltaX) * bell * 0.65 : 0;

  return {
    cameraPos: {
      x: cameraX,
      y: fromPose.position.y + arcLiftY,
      z: fromPose.position.z + arcPullbackZ,
    },
    targetPos: {
      x: targetX + lookLeadX,
      y: fromPose.target.y + (isRework ? -0.45 * bell : 0),
      z: fromPose.target.z + (isRework ? 1.45 * bell : 0),
    },
    fov: CAMERA_FOV + zoomBreathFov,
    focusBlurPx,
    easedProgress: eased,
  };
}

/**
 * Clamps manual user orbit inspection strictly within +/-22 degrees so the cleanroom
 * architectural framing never breaks or exposes unfinished rear geometry.
 */
export function clampInspectYaw(yawRad: number): number {
  return Math.max(-MAX_INSPECT_YAW_RAD, Math.min(MAX_INSPECT_YAW_RAD, yawRad));
}

/**
 * Applies clamped yaw rotation around a studio lookAt pivot plus subtle mouse micro-parallax.
 */
export function applyCameraOrbitAndParallax(
  basePos: Vec3Tuple,
  target: Vec3Tuple,
  yawRad: number,
  parallaxNormX: number,
  parallaxNormY: number
): Vec3Tuple {
  const clampedYaw = clampInspectYaw(yawRad);
  const rx = basePos.x - target.x;
  const rz = basePos.z - target.z;
  const cosY = Math.cos(clampedYaw);
  const sinY = Math.sin(clampedYaw);

  const rotatedX = target.x + rx * cosY + rz * sinY;
  const rotatedZ = target.z - rx * sinY + rz * cosY;

  const px = Math.max(-1, Math.min(1, parallaxNormX)) * 0.42;
  const py = Math.max(-1, Math.min(1, parallaxNormY)) * 0.24;

  return {
    x: rotatedX + px,
    y: basePos.y + py,
    z: rotatedZ,
  };
}

export const MAIN_CONVEYOR_Z = 3.65;
export const MAIN_CONVEYOR_Y = 0.26;
export const REWORK_CONVEYOR_Z = 4.35;
export const REWORK_CONVEYOR_Y = -0.34;

/**
 * Resolves the live 3D coordinates of the floating glowing Workpiece Capsule pod
 * along either the main white-glass conveyor or the lower red/amber REWORK LOOP rail.
 */
export function evaluateWorkpieceWorldPos(
  workpiece: FactoryWorkpiecePod | null,
  timeSec: number
): WorkpieceWorldPose | null {
  if (!workpiece) return null;

  const loc = workpiece.location;
  const hover = Math.sin(timeSec * 3.1) * 0.04;

  if (loc === 'rework_3_2') {
    // Smoothly travels backward from ST-03 (X=96) to ST-02 (X=64) along the lower rework conduit
    const cycle = (timeSec * 0.36) % 1;
    const x = STUDIO_X_POSITIONS['ST-03'] - (STUDIO_X_POSITIONS['ST-03'] - STUDIO_X_POSITIONS['ST-02']) * easeCinematicCubic(cycle);
    return {
      x,
      y: REWORK_CONVEYOR_Y + 0.24 + hover,
      z: REWORK_CONVEYOR_Z,
      isReworkRail: true,
      facingDir: -1,
    };
  }

  const stationLocMap: Partial<Record<FactoryWorkpiecePod['location'], FactoryStationId>> = {
    'ST-01': 'ST-01',
    'ST-02': 'ST-02',
    'ST-03': 'ST-03',
    'ST-04': 'ST-04',
    'ST-05': 'ST-05',
  };

  const directStation = stationLocMap[loc];
  if (directStation) {
    // Gently oscillates near the studio front conveyor docking bay
    const dockDrift = Math.sin(timeSec * 1.4) * 0.45;
    return {
      x: STUDIO_X_POSITIONS[directStation] + dockDrift,
      y: MAIN_CONVEYOR_Y + 0.26 + hover,
      z: MAIN_CONVEYOR_Z,
      isReworkRail: false,
      facingDir: 1,
    };
  }

  // Track segments between consecutive stations
  const trackRanges: Record<string, [number, number]> = {
    track_1_2: [STUDIO_X_POSITIONS['ST-01'], STUDIO_X_POSITIONS['ST-02']],
    track_2_3: [STUDIO_X_POSITIONS['ST-02'], STUDIO_X_POSITIONS['ST-03']],
    track_3_4: [STUDIO_X_POSITIONS['ST-03'], STUDIO_X_POSITIONS['ST-04']],
    track_4_5: [STUDIO_X_POSITIONS['ST-04'], STUDIO_X_POSITIONS['ST-05']],
  };
  const range = trackRanges[loc] ?? [STUDIO_X_POSITIONS['ST-01'], STUDIO_X_POSITIONS['ST-02']];
  const progress = (timeSec * 0.32) % 1;
  return {
    x: range[0] + (range[1] - range[0]) * progress,
    y: MAIN_CONVEYOR_Y + 0.26 + hover,
    z: MAIN_CONVEYOR_Z,
    isReworkRail: false,
    facingDir: 1,
  };
}

export function getSemanticHexColor(state: StationLedState): number {
  switch (state) {
    case 'running':
      return 0x2563eb;
    case 'waiting':
      return 0xd97706;
    case 'passed':
      return 0x059669;
    case 'rework':
      return 0xdc2626;
    case 'idle':
    default:
      return 0x94a3b8;
  }
}
