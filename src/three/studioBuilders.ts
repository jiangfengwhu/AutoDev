import * as THREE from 'three';
import {
  FACTORY_STATIONS,
  type ConveyorSegmentState,
  type FactoryPipelineSnapshot,
  type FactoryStationId,
  type StationLedState,
} from '../lib/factoryPipelineState';
import {
  evaluateWorkpieceWorldPos,
  getSemanticHexColor,
  MAIN_CONVEYOR_Y,
  MAIN_CONVEYOR_Z,
  REWORK_CONVEYOR_Y,
  REWORK_CONVEYOR_Z,
  STUDIO_X_POSITIONS,
} from './cleanroomMath';
import type { CleanroomMaterialPalette } from './cleanroomMaterials';
import {
  createApprovedStampTexture,
  createDynamicCanvasSurface,
  createSignageTexture,
  paintSt00WallScreen,
  paintSt01DagScreen,
  paintSt02DiffScreen,
  paintSt02SmokeScreen,
  paintSt03RsiScreen,
  paintSt04PreviewScreen,
  paintSt05ReportCover,
  paintStickyNoteSurface,
  type DynamicCanvasSurface,
} from './cleanroomTextures';

export interface InteractiveHitMeta {
  stationId: FactoryStationId;
  action: 'drawer' | 'approve_stamp' | 'preview_zoom' | 'open_report';
}

export interface AvatarRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  haloMat: THREE.MeshStandardMaterial;
  baseY: number;
  phaseOffset: number;
}

export interface StudioRuntimeHandles {
  root: THREE.Group;
  hitMeshes: THREE.Object3D[];
  updateFromSnapshot: (snapshot: FactoryPipelineSnapshot) => void;
  tick: (timeSec: number, dtSec: number, snapshot: FactoryPipelineSnapshot) => void;
  dispose: () => void;
}

function registerHitTarget(
  obj: THREE.Object3D,
  meta: InteractiveHitMeta,
  hitMeshes: THREE.Object3D[]
) {
  obj.userData.hitMeta = meta;
  hitMeshes.push(obj);
}

/**
 * Apple-minimalist pure-white geometric humanoid / miniature robot avatar
 * (composite 8-part THREE.Group with bottom-center pivot at y = 0).
 */
function buildOperatorAvatar(
  materials: CleanroomMaterialPalette,
  accentHex: number,
  phaseOffset: number,
  ownedMaterials: THREE.Material[],
  ownedGeometries: THREE.BufferGeometry[]
): AvatarRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const haloMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.95,
    roughness: 0.25,
    metalness: 0.1,
  });
  ownedMaterials.push(haloMat);

  // Ground hover halo ring
  const haloGeo = new THREE.TorusGeometry(0.36, 0.028, 12, 36);
  haloGeo.rotateX(Math.PI / 2);
  ownedGeometries.push(haloGeo);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = 0.05;
  group.add(halo);

  // Ground contact shadow disc
  const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
  shadowGeo.rotateX(-Math.PI / 2);
  ownedGeometries.push(shadowGeo);
  const shadow = new THREE.Mesh(shadowGeo, materials.contactShadowMat);
  shadow.position.y = 0.015;
  group.add(shadow);

  // Sleek tapered ceramic lower pod (hovering slightly above halo)
  const lowerGeo = new THREE.CylinderGeometry(0.22, 0.13, 0.56, 20);
  ownedGeometries.push(lowerGeo);
  const lower = new THREE.Mesh(lowerGeo, materials.avatarCeramic);
  lower.position.y = 0.44;
  lower.castShadow = true;
  lower.receiveShadow = true;
  bodyGroup.add(lower);

  // Upper sculpted chest / torso
  const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.34, 10, 20);
  ownedGeometries.push(torsoGeo);
  const torso = new THREE.Mesh(torsoGeo, materials.avatarCeramic);
  torso.position.y = 0.94;
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyGroup.add(torso);

  // Brushed aluminum chest accent band
  const collarGeo = new THREE.TorusGeometry(0.225, 0.022, 10, 28);
  collarGeo.rotateX(Math.PI / 2);
  ownedGeometries.push(collarGeo);
  const collar = new THREE.Mesh(collarGeo, materials.avatarJoint);
  collar.position.y = 1.18;
  bodyGroup.add(collar);

  // Left & Right floating minimalist ceramic arms
  const armGeo = new THREE.CapsuleGeometry(0.068, 0.34, 8, 14);
  ownedGeometries.push(armGeo);
  const leftArm = new THREE.Mesh(armGeo, materials.avatarCeramic);
  leftArm.position.set(-0.33, 0.92, 0.04);
  leftArm.rotation.z = 0.16;
  leftArm.rotation.x = -0.18;
  leftArm.castShadow = true;
  bodyGroup.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, materials.avatarCeramic);
  rightArm.position.set(0.33, 0.92, 0.04);
  rightArm.rotation.z = -0.16;
  rightArm.rotation.x = -0.18;
  rightArm.castShadow = true;
  bodyGroup.add(rightArm);

  // Sculpted head group with rounded helmet & dark reflective visor
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.46;
  bodyGroup.add(headGroup);

  const headGeo = new THREE.SphereGeometry(0.23, 24, 20);
  headGeo.scale(1.04, 0.94, 0.98);
  ownedGeometries.push(headGeo);
  const head = new THREE.Mesh(headGeo, materials.avatarCeramic);
  head.castShadow = true;
  head.receiveShadow = true;
  headGroup.add(head);

  // Sleek dark glass visor band
  const visorGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.11, 24, 1, false, -0.85, 1.7);
  ownedGeometries.push(visorGeo);
  const visor = new THREE.Mesh(visorGeo, materials.avatarVisor);
  visor.position.set(0, 0.01, 0.032);
  headGroup.add(visor);

  // Two tiny glowing geometric optical eyes inside visor
  const eyeGeo = new THREE.SphereGeometry(0.022, 10, 10);
  ownedGeometries.push(eyeGeo);
  const leftEye = new THREE.Mesh(eyeGeo, haloMat);
  leftEye.position.set(-0.075, 0.01, 0.228);
  headGroup.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeo, haloMat);
  rightEye.position.set(0.075, 0.01, 0.228);
  headGroup.add(rightEye);

  group.scale.setScalar(1.12);

  return {
    group,
    bodyGroup,
    headGroup,
    haloMat,
    baseY: 0,
    phaseOffset,
  };
}

/**
 * Shared architectural studio plinth + glowing perimeter trim + signage plaque.
 */
function buildStudioPlinth(
  stationId: FactoryStationId,
  materials: CleanroomMaterialPalette,
  maxAnisotropy: number,
  ownedMaterials: THREE.Material[],
  ownedGeometries: THREE.BufferGeometry[],
  ownedTextures: THREE.Texture[],
  hitMeshes: THREE.Object3D[]
) {
  const group = new THREE.Group();
  group.position.x = STUDIO_X_POSITIONS[stationId];

  // Grounding contact shadow plane beneath floating plinth
  const shadowGeo = new THREE.PlaneGeometry(13.2, 10.4);
  shadowGeo.rotateX(-Math.PI / 2);
  ownedGeometries.push(shadowGeo);
  const contactShadow = new THREE.Mesh(shadowGeo, materials.contactShadowMat);
  contactShadow.position.y = -0.58;
  group.add(contactShadow);

  // Lower recessed architectural sub-base + crisp dark shadow reveal groove
  const subBaseGeo = new THREE.BoxGeometry(9.1, 0.34, 6.3);
  ownedGeometries.push(subBaseGeo);
  const subBase = new THREE.Mesh(subBaseGeo, materials.plinthBaseSlate);
  subBase.position.y = -0.35;
  subBase.receiveShadow = true;
  group.add(subBase);

  const grooveGeo = new THREE.BoxGeometry(9.35, 0.06, 6.55);
  ownedGeometries.push(grooveGeo);
  const groove = new THREE.Mesh(grooveGeo, materials.plinthShadowGroove);
  groove.position.y = -0.19;
  group.add(groove);

  // Main floating ceramic plinth slab
  const deckGeo = new THREE.BoxGeometry(9.6, 0.24, 6.8);
  ownedGeometries.push(deckGeo);
  const deck = new THREE.Mesh(deckGeo, materials.plinthWhite);
  deck.position.y = -0.06;
  deck.receiveShadow = true;
  deck.castShadow = true;
  group.add(deck);

  // Ceramic cleanroom tiled top floor inlay
  const floorGeo = new THREE.PlaneGeometry(9.2, 6.4);
  floorGeo.rotateX(-Math.PI / 2);
  ownedGeometries.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, materials.floorTile);
  floor.position.y = 0.065;
  floor.receiveShadow = true;
  group.add(floor);
  registerHitTarget(floor, { stationId, action: 'drawer' }, hitMeshes);

  // Semantic glowing perimeter light strip around front/left/right edge of plinth
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x2563eb,
    emissiveIntensity: 0.75,
    roughness: 0.25,
    metalness: 0.1,
  });
  ownedMaterials.push(trimMat);

  const frontTrimGeo = new THREE.BoxGeometry(9.66, 0.065, 0.07);
  ownedGeometries.push(frontTrimGeo);
  const frontTrim = new THREE.Mesh(frontTrimGeo, trimMat);
  frontTrim.position.set(0, -0.14, 3.41);
  group.add(frontTrim);

  const sideTrimGeo = new THREE.BoxGeometry(0.07, 0.065, 6.84);
  ownedGeometries.push(sideTrimGeo);
  const leftTrim = new THREE.Mesh(sideTrimGeo, trimMat);
  leftTrim.position.set(-4.81, -0.14, 0);
  group.add(leftTrim);
  const rightTrim = new THREE.Mesh(sideTrimGeo, trimMat);
  rightTrim.position.set(4.81, -0.14, 0);
  group.add(rightTrim);

  // Rear pure-white cleanroom architectural wall + brushed aluminum right column & upper overhang canopy
  const backWallGeo = new THREE.BoxGeometry(9.2, 4.1, 0.24);
  ownedGeometries.push(backWallGeo);
  const backWall = new THREE.Mesh(backWallGeo, materials.ceramicWhite);
  backWall.position.set(0, 2.1, -3.12);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  group.add(backWall);

  // Top brushed-aluminum architectural lintel bar + cleanroom light canopy rib
  const lintelGeo = new THREE.BoxGeometry(9.36, 0.12, 0.42);
  ownedGeometries.push(lintelGeo);
  const lintel = new THREE.Mesh(lintelGeo, materials.brushedAluminum);
  lintel.position.set(0, 4.19, -3.05);
  group.add(lintel);

  const rightColGeo = new THREE.BoxGeometry(0.14, 4.12, 0.28);
  ownedGeometries.push(rightColGeo);
  const rightCol = new THREE.Mesh(rightColGeo, materials.brushedAluminum);
  rightCol.position.set(4.62, 2.11, -3.12);
  group.add(rightCol);

  // Left subtle translucent frosted glass wing partition
  const wingFrameGeo = new THREE.BoxGeometry(0.08, 3.9, 2.5);
  ownedGeometries.push(wingFrameGeo);
  const leftGlass = new THREE.Mesh(wingFrameGeo, materials.frostedGlass);
  leftGlass.position.set(-4.56, 2.0, -1.85);
  group.add(leftGlass);

  const mullionGeo = new THREE.BoxGeometry(0.12, 4.08, 0.11);
  ownedGeometries.push(mullionGeo);
  const leftPost = new THREE.Mesh(mullionGeo, materials.brushedAluminum);
  leftPost.position.set(-4.56, 2.09, -0.58);
  group.add(leftPost);

  // Front-left angled 3D station signage plaque (Retina crisp toneMapped: false)
  const meta = FACTORY_STATIONS[stationId];
  const signTex = createSignageTexture(stationId, meta.title, meta.departmentCode, maxAnisotropy);
  ownedTextures.push(signTex);
  const signMat = new THREE.MeshBasicMaterial({
    map: signTex,
    toneMapped: false,
  });
  ownedMaterials.push(signMat);

  const signStandGeo = new THREE.BoxGeometry(2.75, 0.56, 0.08);
  ownedGeometries.push(signStandGeo);
  const signMesh = new THREE.Mesh(signStandGeo, [
    materials.brushedAluminum,
    materials.brushedAluminum,
    materials.brushedAluminum,
    materials.brushedAluminum,
    signMat,
    materials.brushedAluminum,
  ]);
  signMesh.position.set(-3.05, 0.42, 2.86);
  signMesh.rotation.x = -0.34;
  signMesh.castShadow = true;
  group.add(signMesh);
  registerHitTarget(signMesh, { stationId, action: 'drawer' }, hitMeshes);

  return { group, trimMat };
}

/**
 * Builds the continuous pure-white glowing glass 3D conveyor track,
 * translucent acrylic conduits, REWORK LOOP return rail (X=96 -> X=64),
 * and the glowing 3D Workpiece Capsule pod.
 */
function buildConveyorCorridor(
  materials: CleanroomMaterialPalette,
  ownedMaterials: THREE.Material[],
  ownedGeometries: THREE.BufferGeometry[]
) {
  const group = new THREE.Group();

  const totalLength = 224; // X = -32 .. +192
  const centerX = 80;

  // Lower matte aluminum structural beam supporting conveyor
  const beamGeo = new THREE.BoxGeometry(totalLength, 0.16, 0.88);
  ownedGeometries.push(beamGeo);
  const beam = new THREE.Mesh(beamGeo, materials.matteSilver);
  beam.position.set(centerX, MAIN_CONVEYOR_Y - 0.18, MAIN_CONVEYOR_Z);
  beam.receiveShadow = true;
  group.add(beam);

  // Translucent white glowing glass track bed
  const glassBedGeo = new THREE.BoxGeometry(totalLength, 0.1, 0.72);
  ownedGeometries.push(glassBedGeo);
  const glassBed = new THREE.Mesh(glassBedGeo, materials.conveyorGlass);
  glassBed.position.set(centerX, MAIN_CONVEYOR_Y - 0.04, MAIN_CONVEYOR_Z);
  group.add(glassBed);

  // Brushed aluminum front & back guide rails
  const railGeo = new THREE.BoxGeometry(totalLength, 0.08, 0.06);
  ownedGeometries.push(railGeo);
  const frontRail = new THREE.Mesh(railGeo, materials.brushedAluminum);
  frontRail.position.set(centerX, MAIN_CONVEYOR_Y + 0.02, MAIN_CONVEYOR_Z + 0.38);
  group.add(frontRail);

  const backRail = new THREE.Mesh(railGeo, materials.brushedAluminum);
  backRail.position.set(centerX, MAIN_CONVEYOR_Y + 0.02, MAIN_CONVEYOR_Z - 0.38);
  group.add(backRail);

  // Translucent acrylic tubular conduit running parallel beneath conveyor
  const conduitGeo = new THREE.CylinderGeometry(0.075, 0.075, totalLength, 12);
  conduitGeo.rotateZ(Math.PI / 2);
  ownedGeometries.push(conduitGeo);
  const conduit = new THREE.Mesh(conduitGeo, materials.frostedGlass);
  conduit.position.set(centerX, MAIN_CONVEYOR_Y - 0.34, MAIN_CONVEYOR_Z - 0.25);
  group.add(conduit);

  // Segment-colored emissive center runner strips between stations
  const segmentSpecs: Array<{
    key: keyof FactoryPipelineSnapshot['tracks'];
    xStart: number;
    xEnd: number;
  }> = [
    { key: 'st01ToSt02', xStart: STUDIO_X_POSITIONS['ST-01'], xEnd: STUDIO_X_POSITIONS['ST-02'] },
    { key: 'st02ToSt03', xStart: STUDIO_X_POSITIONS['ST-02'], xEnd: STUDIO_X_POSITIONS['ST-03'] },
    { key: 'st03ToSt04', xStart: STUDIO_X_POSITIONS['ST-03'], xEnd: STUDIO_X_POSITIONS['ST-04'] },
    { key: 'st04ToSt05', xStart: STUDIO_X_POSITIONS['ST-04'], xEnd: STUDIO_X_POSITIONS['ST-05'] },
  ];

  const segmentMaterials: Record<string, THREE.MeshStandardMaterial> = {};
  for (const seg of segmentSpecs) {
    const len = seg.xEnd - seg.xStart;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      emissive: 0x94a3b8,
      emissiveIntensity: 0.2,
      roughness: 0.25,
      metalness: 0.1,
    });
    ownedMaterials.push(mat);
    segmentMaterials[seg.key] = mat;

    const stripGeo = new THREE.BoxGeometry(len, 0.03, 0.14);
    ownedGeometries.push(stripGeo);
    const strip = new THREE.Mesh(stripGeo, mat);
    strip.position.set((seg.xStart + seg.xEnd) / 2, MAIN_CONVEYOR_Y + 0.02, MAIN_CONVEYOR_Z);
    group.add(strip);
  }

  // Animated conveyor flow pulses along main corridor
  const pulseCount = 24;
  const pulseGeo = new THREE.BoxGeometry(0.9, 0.035, 0.22);
  ownedGeometries.push(pulseGeo);
  const pulseMat = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    emissive: 0x2563eb,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.72,
  });
  ownedMaterials.push(pulseMat);
  const mainPulses: THREE.Mesh[] = [];
  for (let i = 0; i < pulseCount; i += 1) {
    const m = new THREE.Mesh(pulseGeo, pulseMat);
    m.position.set(i * 8, MAIN_CONVEYOR_Y + 0.032, MAIN_CONVEYOR_Z);
    group.add(m);
    mainPulses.push(m);
  }

  // Dedicated REWORK LOOP Return Rail between ST-03 (X=96) and ST-02 (X=64)
  const reworkLen = STUDIO_X_POSITIONS['ST-03'] - STUDIO_X_POSITIONS['ST-02'];
  const reworkCenterX = (STUDIO_X_POSITIONS['ST-02'] + STUDIO_X_POSITIONS['ST-03']) / 2;

  const reworkMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    emissive: 0x94a3b8,
    emissiveIntensity: 0.12,
    roughness: 0.3,
    metalness: 0.2,
  });
  ownedMaterials.push(reworkMat);

  const reworkBarGeo = new THREE.CylinderGeometry(0.085, 0.085, reworkLen, 14);
  reworkBarGeo.rotateZ(Math.PI / 2);
  ownedGeometries.push(reworkBarGeo);
  const reworkBar = new THREE.Mesh(reworkBarGeo, reworkMat);
  reworkBar.position.set(reworkCenterX, REWORK_CONVEYOR_Y, REWORK_CONVEYOR_Z);
  group.add(reworkBar);

  // Entry & exit vertical riser connectors at X=96 and X=64
  const riserGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.65, 12);
  ownedGeometries.push(riserGeo);
  const riserRight = new THREE.Mesh(riserGeo, reworkMat);
  riserRight.position.set(STUDIO_X_POSITIONS['ST-03'], REWORK_CONVEYOR_Y + 0.32, REWORK_CONVEYOR_Z - 0.25);
  riserRight.rotation.x = -0.45;
  group.add(riserRight);

  const riserLeft = new THREE.Mesh(riserGeo, reworkMat);
  riserLeft.position.set(STUDIO_X_POSITIONS['ST-02'], REWORK_CONVEYOR_Y + 0.32, REWORK_CONVEYOR_Z - 0.25);
  riserLeft.rotation.x = -0.45;
  group.add(riserLeft);

  // Rework reverse-flowing crimson/amber light pulses
  const reworkPulseMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0xdc2626,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  ownedMaterials.push(reworkPulseMat);
  const reworkPulseGeo = new THREE.BoxGeometry(1.1, 0.09, 0.22);
  ownedGeometries.push(reworkPulseGeo);
  const reworkPulses: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const rp = new THREE.Mesh(reworkPulseGeo, reworkPulseMat);
    rp.position.set(STUDIO_X_POSITIONS['ST-02'] + i * 5.3, REWORK_CONVEYOR_Y + 0.04, REWORK_CONVEYOR_Z);
    rp.visible = false;
    group.add(rp);
    reworkPulses.push(rp);
  }

  // Glowing 3D Workpiece Capsule Pod (composite 5-part sleek architectural pill)
  const podGroup = new THREE.Group();
  const podGlowMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x2563eb,
    emissiveIntensity: 1.15,
    roughness: 0.18,
    metalness: 0.12,
  });
  ownedMaterials.push(podGlowMat);

  const podShellGeo = new THREE.CapsuleGeometry(0.24, 0.62, 10, 20);
  podShellGeo.rotateZ(Math.PI / 2);
  ownedGeometries.push(podShellGeo);
  const podShell = new THREE.Mesh(podShellGeo, materials.avatarCeramic);
  podShell.castShadow = true;
  podGroup.add(podShell);

  const podCoreGeo = new THREE.CylinderGeometry(0.255, 0.255, 0.32, 20);
  podCoreGeo.rotateZ(Math.PI / 2);
  ownedGeometries.push(podCoreGeo);
  const podCore = new THREE.Mesh(podCoreGeo, podGlowMat);
  podGroup.add(podCore);

  const podCapGeo = new THREE.TorusGeometry(0.23, 0.032, 10, 24);
  podCapGeo.rotateY(Math.PI / 2);
  ownedGeometries.push(podCapGeo);
  const capL = new THREE.Mesh(podCapGeo, materials.brushedAluminum);
  capL.position.x = -0.26;
  podGroup.add(capL);
  const capR = new THREE.Mesh(podCapGeo, materials.brushedAluminum);
  capR.position.x = 0.26;
  podGroup.add(capR);

  podGroup.position.set(STUDIO_X_POSITIONS['ST-01'], MAIN_CONVEYOR_Y + 0.28, MAIN_CONVEYOR_Z);
  group.add(podGroup);

  return {
    group,
    segmentMaterials,
    mainPulses,
    reworkMat,
    reworkPulses,
    podGroup,
    podGlowMat,
  };
}

/**
 * Creates all 6 miniature cleanroom studios, corridor, operator avatars, and live update handlers.
 */
export function buildCleanroomFactoryScene(
  materials: CleanroomMaterialPalette,
  maxAnisotropy: number
): StudioRuntimeHandles {
  const root = new THREE.Group();
  const hitMeshes: THREE.Object3D[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedTextures: THREE.Texture[] = [];

  const plinthTrims: Record<FactoryStationId, THREE.MeshStandardMaterial> = {} as Record<
    FactoryStationId,
    THREE.MeshStandardMaterial
  >;
  const avatars: AvatarRig[] = [];

  // Shared corridor & glowing workpiece pod
  const corridor = buildConveyorCorridor(materials, ownedMaterials, ownedGeometries);
  root.add(corridor.group);

  // ============================================================================
  // ST-00 · 指挥大厅（林工）
  // ============================================================================
  const st00Plinth = buildStudioPlinth(
    'ST-00',
    materials,
    maxAnisotropy,
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    hitMeshes
  );
  plinthTrims['ST-00'] = st00Plinth.trimMat;
  root.add(st00Plinth.group);

  // Giant curved-style wall telemetry display (Retina sharp, zero washout)
  const st00ScreenSurface = createDynamicCanvasSurface(1024, 512, maxAnisotropy);
  ownedTextures.push(st00ScreenSurface.texture);
  const st00ScreenMat = new THREE.MeshBasicMaterial({
    map: st00ScreenSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st00ScreenMat);

  const st00BezelGeo = new THREE.BoxGeometry(5.55, 2.86, 0.14);
  ownedGeometries.push(st00BezelGeo);
  const st00Bezel = new THREE.Mesh(st00BezelGeo, materials.darkGlassBezel);
  st00Bezel.position.set(1.05, 2.38, -2.92);
  st00Bezel.castShadow = true;
  st00Plinth.group.add(st00Bezel);
  registerHitTarget(st00Bezel, { stationId: 'ST-00', action: 'drawer' }, hitMeshes);

  const st00PanelGeo = new THREE.PlaneGeometry(5.32, 2.66);
  ownedGeometries.push(st00PanelGeo);
  const st00Panel = new THREE.Mesh(st00PanelGeo, st00ScreenMat);
  st00Panel.position.set(1.05, 2.38, -2.84);
  st00Plinth.group.add(st00Panel);

  // 3 Brushed Silver-White 3D Server Racks on the Left + 16 Micro LED Cubes
  const st00LedMats: THREE.MeshStandardMaterial[] = [];
  const rackGeo = new THREE.BoxGeometry(0.76, 2.85, 0.88);
  const rackTrimGeo = new THREE.BoxGeometry(0.64, 0.04, 0.04);
  const ledCubeGeo = new THREE.BoxGeometry(0.085, 0.05, 0.04);
  ownedGeometries.push(rackGeo, rackTrimGeo, ledCubeGeo);

  for (let r = 0; r < 3; r += 1) {
    const rx = -3.72 + r * 0.92;
    const rack = new THREE.Mesh(rackGeo, materials.matteSilver);
    rack.position.set(rx, 1.5, -2.28);
    rack.castShadow = true;
    rack.receiveShadow = true;
    st00Plinth.group.add(rack);
    registerHitTarget(rack, { stationId: 'ST-00', action: 'drawer' }, hitMeshes);

    // Server rack vent slots
    for (let v = 0; v < 5; v += 1) {
      const vent = new THREE.Mesh(rackTrimGeo, materials.darkGlassBezel);
      vent.position.set(rx, 0.65 + v * 0.44, -1.83);
      st00Plinth.group.add(vent);
    }
  }

  // 16 independently blinking LED cubes across the 3 server racks
  for (let i = 0; i < 16; i += 1) {
    const rackIdx = i % 3;
    const rowIdx = Math.floor(i / 3);
    const colInRack = (i % 2 === 0 ? -0.18 : 0.18);
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 1.1,
      roughness: 0.2,
    });
    ownedMaterials.push(ledMat);
    st00LedMats.push(ledMat);

    const ledMesh = new THREE.Mesh(ledCubeGeo, ledMat);
    ledMesh.position.set(
      -3.72 + rackIdx * 0.92 + colInRack,
      2.56 - rowIdx * 0.34,
      -1.825
    );
    st00Plinth.group.add(ledMesh);
  }

  // Central circular frosted-glass command console
  const cmdBaseGeo = new THREE.CylinderGeometry(0.45, 0.65, 0.88, 24);
  const cmdTopGeo = new THREE.CylinderGeometry(1.55, 1.48, 0.09, 32);
  const cmdRingGeo = new THREE.TorusGeometry(1.52, 0.03, 12, 42);
  cmdRingGeo.rotateX(Math.PI / 2);
  ownedGeometries.push(cmdBaseGeo, cmdTopGeo, cmdRingGeo);

  const cmdBase = new THREE.Mesh(cmdBaseGeo, materials.ceramicWhite);
  cmdBase.position.set(0.65, 0.5, 0.55);
  cmdBase.castShadow = true;
  st00Plinth.group.add(cmdBase);

  const cmdTop = new THREE.Mesh(cmdTopGeo, materials.frostedGlass);
  cmdTop.position.set(0.65, 0.98, 0.55);
  st00Plinth.group.add(cmdTop);
  registerHitTarget(cmdTop, { stationId: 'ST-00', action: 'drawer' }, hitMeshes);

  const cmdRing = new THREE.Mesh(cmdRingGeo, materials.brushedAluminum);
  cmdRing.position.set(0.65, 0.98, 0.55);
  st00Plinth.group.add(cmdRing);

  // Lin Gong pure-white geometric avatar
  const linAvatar = buildOperatorAvatar(materials, 0x2563eb, 0.2, ownedMaterials, ownedGeometries);
  linAvatar.group.position.set(2.55, 0.06, 0.75);
  linAvatar.group.rotation.y = -0.52;
  st00Plinth.group.add(linAvatar.group);
  avatars.push(linAvatar);

  // ============================================================================
  // ST-01 · 架构策划室（周明）
  // ============================================================================
  const st01Plinth = buildStudioPlinth(
    'ST-01',
    materials,
    maxAnisotropy,
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    hitMeshes
  );
  plinthTrims['ST-01'] = st01Plinth.trimMat;
  root.add(st01Plinth.group);

  // Rear frosted glass sticky-note board
  const noteWallGeo = new THREE.BoxGeometry(5.6, 2.35, 0.08);
  ownedGeometries.push(noteWallGeo);
  const noteWall = new THREE.Mesh(noteWallGeo, materials.frostedGlass);
  noteWall.position.set(0.4, 2.45, -2.76);
  st01Plinth.group.add(noteWall);

  // 6 tilted pastel macaron 3D sticky note meshes
  const stickySurfaces: DynamicCanvasSurface[] = [];
  const stickyGeo = new THREE.BoxGeometry(0.86, 0.72, 0.025);
  ownedGeometries.push(stickyGeo);
  const stickyPositions = [
    [-1.75, 2.95, -2.69, -0.07],
    [-0.55, 2.98, -2.69, 0.05],
    [0.65, 2.92, -2.69, -0.05],
    [1.85, 2.96, -2.69, 0.06],
    [-1.12, 2.02, -2.69, 0.06],
    [1.18, 2.02, -2.69, -0.06],
  ];
  stickyPositions.forEach(([sx, sy, sz, rz]) => {
    const surf = createDynamicCanvasSurface(256, 224, maxAnisotropy);
    ownedTextures.push(surf.texture);
    stickySurfaces.push(surf);
    const mat = new THREE.MeshBasicMaterial({
      map: surf.texture,
      toneMapped: false,
    });
    ownedMaterials.push(mat);
    const noteMesh = new THREE.Mesh(stickyGeo, mat);
    noteMesh.position.set(sx, sy, sz);
    noteMesh.rotation.z = rz;
    noteMesh.castShadow = true;
    st01Plinth.group.add(noteMesh);
  });

  // Minimalist white architectural desk with brushed aluminum edge accent
  const deskTopGeo = new THREE.BoxGeometry(4.4, 0.12, 1.75);
  const deskLegGeo = new THREE.BoxGeometry(0.12, 0.88, 1.55);
  ownedGeometries.push(deskTopGeo, deskLegGeo);
  const st01Desk = new THREE.Mesh(deskTopGeo, materials.ceramicWhite);
  st01Desk.position.set(-0.35, 0.96, 0.45);
  st01Desk.castShadow = true;
  st01Desk.receiveShadow = true;
  st01Plinth.group.add(st01Desk);
  registerHitTarget(st01Desk, { stationId: 'ST-01', action: 'drawer' }, hitMeshes);

  const st01LegL = new THREE.Mesh(deskLegGeo, materials.brushedAluminum);
  st01LegL.position.set(-2.35, 0.5, 0.45);
  st01Plinth.group.add(st01LegL);
  const st01LegR = new THREE.Mesh(deskLegGeo, materials.brushedAluminum);
  st01LegR.position.set(1.65, 0.5, 0.45);
  st01Plinth.group.add(st01LegR);

  // Dual tilted widescreen 3D DAG monitors (Retina crisp)
  const st01DagSurface = createDynamicCanvasSurface(960, 420, maxAnisotropy);
  ownedTextures.push(st01DagSurface.texture);
  const st01DagMat = new THREE.MeshBasicMaterial({
    map: st01DagSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st01DagMat);

  const monBezelGeo = new THREE.BoxGeometry(2.05, 1.02, 0.07);
  const monFaceGeo = new THREE.PlaneGeometry(1.94, 0.92);
  const monStandGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.45, 14);
  ownedGeometries.push(monBezelGeo, monFaceGeo, monStandGeo);

  const monConfigs = [
    { x: -1.35, z: 0.15, ry: 0.22 },
    { x: 0.65, z: 0.15, ry: -0.22 },
  ];
  monConfigs.forEach((mc) => {
    const monGroup = new THREE.Group();
    monGroup.position.set(mc.x, 1.65, mc.z);
    monGroup.rotation.y = mc.ry;
    const bez = new THREE.Mesh(monBezelGeo, materials.darkGlassBezel);
    bez.castShadow = true;
    monGroup.add(bez);
    const face = new THREE.Mesh(monFaceGeo, st01DagMat);
    face.position.z = 0.04;
    monGroup.add(face);
    const stand = new THREE.Mesh(monStandGeo, materials.brushedAluminum);
    stand.position.set(0, -0.45, -0.05);
    monGroup.add(stand);
    st01Plinth.group.add(monGroup);
    registerHitTarget(bez, { stationId: 'ST-01', action: 'drawer' }, hitMeshes);
  });

  // Zhou Ming avatar
  const zhouAvatar = buildOperatorAvatar(materials, 0x2563eb, 1.1, ownedMaterials, ownedGeometries);
  zhouAvatar.group.position.set(2.55, 0.06, 0.88);
  zhouAvatar.group.rotation.y = -0.48;
  st01Plinth.group.add(zhouAvatar.group);
  avatars.push(zhouAvatar);

  // ============================================================================
  // ST-02 · 代码车间（陈汐）+ 3D THREE.Points Sparks
  // ============================================================================
  const st02Plinth = buildStudioPlinth(
    'ST-02',
    materials,
    maxAnisotropy,
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    hitMeshes
  );
  plinthTrims['ST-02'] = st02Plinth.trimMat;
  root.add(st02Plinth.group);

  // Industrial white standing console workbench
  const st02BenchGeo = new THREE.BoxGeometry(4.6, 1.08, 1.65);
  ownedGeometries.push(st02BenchGeo);
  const st02Bench = new THREE.Mesh(st02BenchGeo, materials.ceramicWhite);
  st02Bench.position.set(-0.4, 0.6, 0.15);
  st02Bench.castShadow = true;
  st02Bench.receiveShadow = true;
  st02Plinth.group.add(st02Bench);
  registerHitTarget(st02Bench, { stationId: 'ST-02', action: 'drawer' }, hitMeshes);

  // Brushed metallic workbench top rail
  const st02RailGeo = new THREE.BoxGeometry(4.68, 0.07, 1.72);
  ownedGeometries.push(st02RailGeo);
  const st02Rail = new THREE.Mesh(st02RailGeo, materials.brushedAluminum);
  st02Rail.position.set(-0.4, 1.16, 0.15);
  st02Plinth.group.add(st02Rail);

  // Landscape dark-glass Code Diff Screen (Retina crisp)
  const st02DiffSurface = createDynamicCanvasSurface(896, 448, maxAnisotropy);
  ownedTextures.push(st02DiffSurface.texture);
  const st02DiffMat = new THREE.MeshBasicMaterial({
    map: st02DiffSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st02DiffMat);

  const diffBezelGeo = new THREE.BoxGeometry(3.25, 1.78, 0.1);
  const diffFaceGeo = new THREE.PlaneGeometry(3.08, 1.62);
  ownedGeometries.push(diffBezelGeo, diffFaceGeo);

  const diffGroup = new THREE.Group();
  diffGroup.position.set(-1.1, 2.38, -0.35);
  diffGroup.rotation.y = 0.12;
  const diffBezel = new THREE.Mesh(diffBezelGeo, materials.darkGlassBezel);
  diffBezel.castShadow = true;
  diffGroup.add(diffBezel);
  const diffFace = new THREE.Mesh(diffFaceGeo, st02DiffMat);
  diffFace.position.z = 0.055;
  diffGroup.add(diffFace);
  st02Plinth.group.add(diffGroup);
  registerHitTarget(diffBezel, { stationId: 'ST-02', action: 'drawer' }, hitMeshes);

  // Portrait dark-glass Smoke & Build Log Screen (Retina crisp)
  const st02SmokeSurface = createDynamicCanvasSurface(480, 720, maxAnisotropy);
  ownedTextures.push(st02SmokeSurface.texture);
  const st02SmokeMat = new THREE.MeshBasicMaterial({
    map: st02SmokeSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st02SmokeMat);

  const smokeBezelGeo = new THREE.BoxGeometry(1.48, 2.18, 0.1);
  const smokeFaceGeo = new THREE.PlaneGeometry(1.36, 2.04);
  ownedGeometries.push(smokeBezelGeo, smokeFaceGeo);

  const smokeGroup = new THREE.Group();
  smokeGroup.position.set(1.45, 2.42, -0.18);
  smokeGroup.rotation.y = -0.26;
  const smokeBezel = new THREE.Mesh(smokeBezelGeo, materials.darkGlassBezel);
  smokeBezel.castShadow = true;
  smokeGroup.add(smokeBezel);
  const smokeFace = new THREE.Mesh(smokeFaceGeo, st02SmokeMat);
  smokeFace.position.z = 0.055;
  smokeGroup.add(smokeFace);
  st02Plinth.group.add(smokeGroup);
  registerHitTarget(smokeBezel, { stationId: 'ST-02', action: 'drawer' }, hitMeshes);

  // Compiler emitter nozzle on front-left of workbench (origin of 3D welding sparks)
  const emitterGeo = new THREE.CylinderGeometry(0.14, 0.22, 0.36, 16);
  ownedGeometries.push(emitterGeo);
  const emitter = new THREE.Mesh(emitterGeo, materials.brushedAluminum);
  emitter.position.set(-1.35, 1.38, 0.62);
  st02Plinth.group.add(emitter);

  // Real 3D THREE.Points Spark Particle System (gravity + floor bounce!)
  const SPARK_COUNT = 84;
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkColors = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  const sparkOrigin = new THREE.Vector3(-1.35, 1.56, 0.62);

  const resetSpark = (i: number) => {
    sparkPositions[i * 3] = sparkOrigin.x + (Math.random() - 0.5) * 0.24;
    sparkPositions[i * 3 + 1] = sparkOrigin.y + Math.random() * 0.12;
    sparkPositions[i * 3 + 2] = sparkOrigin.z + (Math.random() - 0.5) * 0.24;

    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 2.6;
    sparkVel[i * 3] = Math.cos(angle) * speed;
    sparkVel[i * 3 + 1] = 2.2 + Math.random() * 2.8;
    sparkVel[i * 3 + 2] = Math.sin(angle) * speed + 0.45;
    sparkLife[i] = 0.45 + Math.random() * 0.75;

    // 65% vivid amber-gold #F59E0B, 35% electric-blue #2563EB
    if (i % 3 === 0) {
      sparkColors[i * 3] = 0.15;
      sparkColors[i * 3 + 1] = 0.45;
      sparkColors[i * 3 + 2] = 0.98;
    } else {
      sparkColors[i * 3] = 0.98;
      sparkColors[i * 3 + 1] = 0.52;
      sparkColors[i * 3 + 2] = 0.04;
    }
  };
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    resetSpark(i);
    sparkLife[i] *= Math.random();
  }

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  ownedGeometries.push(sparkGeo);

  const sparkMat = new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    toneMapped: false,
  });
  ownedMaterials.push(sparkMat);
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  st02Plinth.group.add(sparkPoints);

  // Chen Xi avatar
  const chenAvatar = buildOperatorAvatar(materials, 0x2563eb, 2.0, ownedMaterials, ownedGeometries);
  chenAvatar.group.position.set(2.75, 0.06, 0.85);
  chenAvatar.group.rotation.y = -0.55;
  st02Plinth.group.add(chenAvatar.group);
  avatars.push(chenAvatar);

  // ============================================================================
  // ST-03 · 质检与进化实验室（顾航）
  // ============================================================================
  const st03Plinth = buildStudioPlinth(
    'ST-03',
    materials,
    maxAnisotropy,
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    hitMeshes
  );
  plinthTrims['ST-03'] = st03Plinth.trimMat;
  root.add(st03Plinth.group);

  // Central frosted-glass blind-test bench
  const qaBaseGeo = new THREE.BoxGeometry(4.1, 0.82, 2.1);
  const qaTopGeo = new THREE.BoxGeometry(4.3, 0.1, 2.3);
  ownedGeometries.push(qaBaseGeo, qaTopGeo);
  const qaBase = new THREE.Mesh(qaBaseGeo, materials.ceramicWhite);
  qaBase.position.set(-1.0, 0.46, 0.25);
  qaBase.castShadow = true;
  qaBase.receiveShadow = true;
  st03Plinth.group.add(qaBase);
  registerHitTarget(qaBase, { stationId: 'ST-03', action: 'drawer' }, hitMeshes);

  const qaTop = new THREE.Mesh(qaTopGeo, materials.frostedGlass);
  qaTop.position.set(-1.0, 0.94, 0.25);
  st03Plinth.group.add(qaTop);

  // 8-cube 3D blind-test matrix (4 cols x 2 rows)
  const qaCubeGeo = new THREE.BoxGeometry(0.54, 0.54, 0.54);
  ownedGeometries.push(qaCubeGeo);
  const qaCubeMeshes: THREE.Mesh[] = [];
  const qaCubeMats: THREE.MeshStandardMaterial[] = [];

  for (let i = 0; i < 8; i += 1) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      emissive: 0x94a3b8,
      emissiveIntensity: 0.22,
      roughness: 0.26,
      metalness: 0.14,
    });
    ownedMaterials.push(mat);
    qaCubeMats.push(mat);

    const cube = new THREE.Mesh(qaCubeGeo, mat);
    cube.position.set(-2.35 + col * 0.9, 1.38, -0.2 + row * 0.92);
    cube.castShadow = true;
    st03Plinth.group.add(cube);
    qaCubeMeshes.push(cube);
    registerHitTarget(cube, { stationId: 'ST-03', action: 'drawer' }, hitMeshes);
  }

  // Animated sweeping 3D Laser Scanner Gantry + Beam
  const scannerGroup = new THREE.Group();
  scannerGroup.position.set(-1.0, 1.98, 0.25);
  const scannerBarGeo = new THREE.BoxGeometry(0.12, 0.1, 2.38);
  const laserPlaneGeo = new THREE.PlaneGeometry(0.06, 2.25);
  laserPlaneGeo.rotateX(Math.PI / 2);
  const laserVertGeo = new THREE.PlaneGeometry(2.25, 0.98);
  laserVertGeo.rotateY(Math.PI / 2);
  ownedGeometries.push(scannerBarGeo, laserPlaneGeo, laserVertGeo);

  const scannerBar = new THREE.Mesh(scannerBarGeo, materials.brushedAluminum);
  scannerGroup.add(scannerBar);

  const laserBeamMat = new THREE.MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  ownedMaterials.push(laserBeamMat);
  const laserSheet = new THREE.Mesh(laserVertGeo, laserBeamMat);
  laserSheet.position.y = -0.52;
  scannerGroup.add(laserSheet);
  st03Plinth.group.add(scannerGroup);

  // Floating 3D Brushed-Silver Padlock Emblem (`tests/` vault)
  const padlockGroup = new THREE.Group();
  padlockGroup.position.set(-1.0, 2.86, 0.25);
  const lockBodyGeo = new THREE.BoxGeometry(0.46, 0.38, 0.18);
  const lockShackleGeo = new THREE.TorusGeometry(0.15, 0.042, 10, 24, Math.PI);
  ownedGeometries.push(lockBodyGeo, lockShackleGeo);
  const lockBody = new THREE.Mesh(lockBodyGeo, materials.brushedAluminum);
  lockBody.castShadow = true;
  padlockGroup.add(lockBody);
  const lockShackle = new THREE.Mesh(lockShackleGeo, materials.darkGlassBezel);
  lockShackle.position.y = 0.19;
  padlockGroup.add(lockShackle);
  st03Plinth.group.add(padlockGroup);

  // Side vertical RSI Self-Evolution Rule Terminal (Retina crisp)
  const st03RsiSurface = createDynamicCanvasSurface(560, 560, maxAnisotropy);
  ownedTextures.push(st03RsiSurface.texture);
  const st03RsiMat = new THREE.MeshBasicMaterial({
    map: st03RsiSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st03RsiMat);

  const rsiBezelGeo = new THREE.BoxGeometry(2.35, 2.35, 0.12);
  const rsiFaceGeo = new THREE.PlaneGeometry(2.2, 2.2);
  ownedGeometries.push(rsiBezelGeo, rsiFaceGeo);
  const rsiGroup = new THREE.Group();
  rsiGroup.position.set(2.58, 2.22, -1.65);
  rsiGroup.rotation.y = -0.34;
  const rsiBezel = new THREE.Mesh(rsiBezelGeo, materials.darkGlassBezel);
  rsiBezel.castShadow = true;
  rsiGroup.add(rsiBezel);
  const rsiFace = new THREE.Mesh(rsiFaceGeo, st03RsiMat);
  rsiFace.position.z = 0.065;
  rsiGroup.add(rsiFace);
  st03Plinth.group.add(rsiGroup);
  registerHitTarget(rsiBezel, { stationId: 'ST-03', action: 'drawer' }, hitMeshes);

  // Gu Hang avatar
  const guAvatar = buildOperatorAvatar(materials, 0x059669, 3.0, ownedMaterials, ownedGeometries);
  guAvatar.group.position.set(2.65, 0.06, 0.95);
  guAvatar.group.rotation.y = -0.62;
  st03Plinth.group.add(guAvatar.group);
  avatars.push(guAvatar);

  // ============================================================================
  // ST-04 · 验收会议室（沈岚）+ 3D APPROVED Stamp & Emerald Shockwave
  // ============================================================================
  const st04Plinth = buildStudioPlinth(
    'ST-04',
    materials,
    maxAnisotropy,
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    hitMeshes
  );
  plinthTrims['ST-04'] = st04Plinth.trimMat;
  root.add(st04Plinth.group);

  // Giant High-Clarity 3D Cloudflare Preview Display Wall (Retina crisp)
  const st04PreviewSurface = createDynamicCanvasSurface(960, 540, maxAnisotropy);
  ownedTextures.push(st04PreviewSurface.texture);
  const st04PreviewMat = new THREE.MeshBasicMaterial({
    map: st04PreviewSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st04PreviewMat);

  const prevBezelGeo = new THREE.BoxGeometry(5.6, 3.05, 0.14);
  const prevFaceGeo = new THREE.PlaneGeometry(5.38, 2.86);
  ownedGeometries.push(prevBezelGeo, prevFaceGeo);
  const prevBezel = new THREE.Mesh(prevBezelGeo, materials.darkGlassBezel);
  prevBezel.position.set(0, 2.38, -2.92);
  prevBezel.castShadow = true;
  st04Plinth.group.add(prevBezel);
  registerHitTarget(prevBezel, { stationId: 'ST-04', action: 'preview_zoom' }, hitMeshes);

  const prevFace = new THREE.Mesh(prevFaceGeo, st04PreviewMat);
  prevFace.position.set(0, 2.38, -2.84);
  st04Plinth.group.add(prevFace);

  // Clean glass conference table with brushed aluminum perimeter trim for crisp silhouette
  const confTopGeo = new THREE.BoxGeometry(3.8, 0.08, 1.65);
  const confRimGeo = new THREE.BoxGeometry(3.88, 0.055, 1.72);
  const confLegGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.84, 20);
  ownedGeometries.push(confTopGeo, confRimGeo, confLegGeo);
  const confRim = new THREE.Mesh(confRimGeo, materials.brushedAluminum);
  confRim.position.set(-0.6, 0.91, 0.15);
  st04Plinth.group.add(confRim);
  const confTop = new THREE.Mesh(confTopGeo, materials.frostedGlass);
  confTop.position.set(-0.6, 0.96, 0.15);
  st04Plinth.group.add(confTop);
  registerHitTarget(confTop, { stationId: 'ST-04', action: 'drawer' }, hitMeshes);

  const confLeg1 = new THREE.Mesh(confLegGeo, materials.matteSilver);
  confLeg1.position.set(-1.75, 0.48, 0.15);
  st04Plinth.group.add(confLeg1);
  const confLeg2 = new THREE.Mesh(confLegGeo, materials.matteSilver);
  confLeg2.position.set(0.55, 0.48, 0.15);
  st04Plinth.group.add(confLeg2);

  // Sculptural Approval Podium with Glowing Pulse Ring (clickable for Quick Stamp!)
  const podiumBodyGeo = new THREE.CylinderGeometry(0.42, 0.5, 1.06, 24);
  const podiumRingGeo = new THREE.TorusGeometry(0.44, 0.048, 12, 32);
  podiumRingGeo.rotateX(Math.PI / 2);
  ownedGeometries.push(podiumBodyGeo, podiumRingGeo);

  const podiumBody = new THREE.Mesh(podiumBodyGeo, materials.matteSilver);
  podiumBody.position.set(1.85, 0.58, 1.15);
  podiumBody.castShadow = true;
  st04Plinth.group.add(podiumBody);
  registerHitTarget(podiumBody, { stationId: 'ST-04', action: 'approve_stamp' }, hitMeshes);

  const podiumGlowMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 1.0,
    roughness: 0.2,
  });
  ownedMaterials.push(podiumGlowMat);
  const podiumRing = new THREE.Mesh(podiumRingGeo, podiumGlowMat);
  podiumRing.position.set(1.85, 1.13, 1.15);
  st04Plinth.group.add(podiumRing);

  // 3D Floating/Slamming APPROVED Stamp Badge + Expanding Emerald Shockwave Ring
  const stampTex = createApprovedStampTexture(maxAnisotropy);
  ownedTextures.push(stampTex);
  const stampMat = new THREE.MeshBasicMaterial({
    map: stampTex,
    toneMapped: false,
    transparent: true,
    opacity: 0,
  });
  ownedMaterials.push(stampMat);

  const stampGeo = new THREE.BoxGeometry(2.35, 0.88, 0.1);
  ownedGeometries.push(stampGeo);
  const stampMesh = new THREE.Mesh(stampGeo, [
    materials.emissiveEmerald,
    materials.emissiveEmerald,
    materials.emissiveEmerald,
    materials.emissiveEmerald,
    stampMat,
    materials.emissiveEmerald,
  ]);
  stampMesh.position.set(-0.2, 1.88, 0.85);
  stampMesh.rotation.z = 0.08;
  stampMesh.visible = false;
  st04Plinth.group.add(stampMesh);

  const waveRingGeo = new THREE.RingGeometry(0.45, 0.62, 42);
  waveRingGeo.rotateX(-Math.PI / 2);
  ownedGeometries.push(waveRingGeo);
  const waveRingMat = new THREE.MeshBasicMaterial({
    color: 0x059669,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  ownedMaterials.push(waveRingMat);
  const waveRing = new THREE.Mesh(waveRingGeo, waveRingMat);
  waveRing.position.set(0.2, 0.09, 0.55);
  st04Plinth.group.add(waveRing);

  // Shen Lan avatar
  const shenAvatar = buildOperatorAvatar(materials, 0xd97706, 4.0, ownedMaterials, ownedGeometries);
  shenAvatar.group.position.set(3.05, 0.06, 0.88);
  shenAvatar.group.rotation.y = -0.6;
  st04Plinth.group.add(shenAvatar.group);
  avatars.push(shenAvatar);

  // ============================================================================
  // ST-05 · 项目档案室（陆瑶）+ 3x3 Metal Cabinet with Sliding Drawers
  // ============================================================================
  const st05Plinth = buildStudioPlinth(
    'ST-05',
    materials,
    maxAnisotropy,
    ownedMaterials,
    ownedGeometries,
    ownedTextures,
    hitMeshes
  );
  plinthTrims['ST-05'] = st05Plinth.trimMat;
  root.add(st05Plinth.group);

  // Wall-mounted 3x3 brushed-white metal archive cabinet housing
  const cabBodyGeo = new THREE.BoxGeometry(4.6, 3.05, 1.05);
  ownedGeometries.push(cabBodyGeo);
  const cabBody = new THREE.Mesh(cabBodyGeo, materials.matteSilver);
  cabBody.position.set(-1.15, 1.6, -2.35);
  cabBody.castShadow = true;
  cabBody.receiveShadow = true;
  st05Plinth.group.add(cabBody);
  registerHitTarget(cabBody, { stationId: 'ST-05', action: 'drawer' }, hitMeshes);

  // 9 individually animated archive drawers (3 cols x 3 rows)
  const drawerGeo = new THREE.BoxGeometry(1.36, 0.86, 0.96);
  const handleGeo = new THREE.BoxGeometry(0.42, 0.06, 0.09);
  const dLedGeo = new THREE.BoxGeometry(0.24, 0.045, 0.04);
  ownedGeometries.push(drawerGeo, handleGeo, dLedGeo);

  const archiveDrawers: Array<{
    group: THREE.Group;
    baseZ: number;
    ledMat: THREE.MeshStandardMaterial;
  }> = [];

  for (let i = 0; i < 9; i += 1) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const dg = new THREE.Group();
    const baseZ = -2.28;
    dg.position.set(-2.6 + col * 1.45, 2.55 - row * 0.95, baseZ);

    const box = new THREE.Mesh(drawerGeo, materials.ceramicWhite);
    box.castShadow = true;
    box.receiveShadow = true;
    dg.add(box);

    const handle = new THREE.Mesh(handleGeo, materials.brushedAluminum);
    handle.position.set(0, 0.08, 0.51);
    dg.add(handle);

    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.45,
      roughness: 0.25,
    });
    ownedMaterials.push(ledMat);
    const led = new THREE.Mesh(dLedGeo, ledMat);
    led.position.set(0, -0.22, 0.49);
    dg.add(led);

    st05Plinth.group.add(dg);
    archiveDrawers.push({ group: dg, baseZ, ledMat });
    registerHitTarget(box, { stationId: 'ST-05', action: 'drawer' }, hitMeshes);
  }

  // Spotlighted Hardcover Delivery Report Display Podium (clickable -> Full Report!)
  const repPedGeo = new THREE.CylinderGeometry(0.68, 0.82, 0.95, 28);
  ownedGeometries.push(repPedGeo);
  const repPed = new THREE.Mesh(repPedGeo, materials.ceramicWhite);
  repPed.position.set(1.92, 0.52, 0.45);
  repPed.castShadow = true;
  st05Plinth.group.add(repPed);

  const st05CoverSurface = createDynamicCanvasSurface(512, 640, maxAnisotropy);
  ownedTextures.push(st05CoverSurface.texture);
  const st05CoverMat = new THREE.MeshBasicMaterial({
    map: st05CoverSurface.texture,
    toneMapped: false,
  });
  ownedMaterials.push(st05CoverMat);

  const bookGeo = new THREE.BoxGeometry(1.22, 1.54, 0.12);
  ownedGeometries.push(bookGeo);
  const reportBook = new THREE.Mesh(bookGeo, [
    materials.brushedAluminum,
    materials.brushedAluminum,
    materials.brushedAluminum,
    materials.brushedAluminum,
    st05CoverMat,
    materials.ceramicWhite,
  ]);
  reportBook.position.set(1.92, 1.72, 0.42);
  reportBook.rotation.x = -0.32;
  reportBook.rotation.y = -0.28;
  reportBook.castShadow = true;
  st05Plinth.group.add(reportBook);
  registerHitTarget(reportBook, { stationId: 'ST-05', action: 'open_report' }, hitMeshes);

  // Lu Yao avatar
  const luAvatar = buildOperatorAvatar(materials, 0x059669, 5.1, ownedMaterials, ownedGeometries);
  luAvatar.group.position.set(-0.35, 0.06, 1.35);
  luAvatar.group.rotation.y = 0.25;
  st05Plinth.group.add(luAvatar.group);
  avatars.push(luAvatar);

  // ============================================================================
  // Dynamic State Sync & Per-Frame Animation Loop
  // ============================================================================
  let prevApprovedState = false;
  let waveAnimTime = 99;
  let lastCanvasAnimSec = -1;

  const applyTrackColor = (mat: THREE.MeshStandardMaterial, state: ConveyorSegmentState) => {
    if (state === 'rework') {
      mat.color.setHex(0xef4444);
      mat.emissive.setHex(0xdc2626);
      mat.emissiveIntensity = 1.15;
    } else if (state === 'passed') {
      mat.color.setHex(0x10b981);
      mat.emissive.setHex(0x059669);
      mat.emissiveIntensity = 0.72;
    } else if (state === 'active') {
      mat.color.setHex(0x3b82f6);
      mat.emissive.setHex(0x2563eb);
      mat.emissiveIntensity = 0.95;
    } else {
      mat.color.setHex(0xcbd5e1);
      mat.emissive.setHex(0x94a3b8);
      mat.emissiveIntensity = 0.16;
    }
  };

  const applyTrimColor = (mat: THREE.MeshStandardMaterial, led: StationLedState) => {
    const hex = getSemanticHexColor(led);
    mat.color.setHex(hex);
    mat.emissive.setHex(hex);
    mat.emissiveIntensity = led === 'idle' ? 0.18 : 0.85;
  };

  const updateFromSnapshot = (snapshot: FactoryPipelineSnapshot) => {
    // 1. Update plinth semantic trims & operator avatar halos
    const stationIds: FactoryStationId[] = ['ST-00', 'ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05'];
    stationIds.forEach((sid, idx) => {
      const led = snapshot.stationStates[sid].led;
      applyTrimColor(plinthTrims[sid], led);
      const av = avatars[idx];
      if (av) {
        const hex = led === 'idle' ? 0x3b82f6 : getSemanticHexColor(led);
        av.haloMat.color.setHex(hex);
        av.haloMat.emissive.setHex(hex);
      }
    });

    // 2. Update corridor segments & rework rail
    applyTrackColor(corridor.segmentMaterials.st01ToSt02, snapshot.tracks.st01ToSt02);
    applyTrackColor(corridor.segmentMaterials.st02ToSt03, snapshot.tracks.st02ToSt03);
    applyTrackColor(corridor.segmentMaterials.st03ToSt04, snapshot.tracks.st03ToSt04);
    applyTrackColor(corridor.segmentMaterials.st04ToSt05, snapshot.tracks.st04ToSt05);

    const isReworkActive = snapshot.tracks.reworkSt03ToSt02 === 'rework';
    applyTrackColor(corridor.reworkMat, snapshot.tracks.reworkSt03ToSt02);
    corridor.reworkPulses.forEach((rp) => {
      rp.visible = isReworkActive;
    });

    // 3. Workpiece pod visibility & color
    if (snapshot.workpiece) {
      corridor.podGroup.visible = true;
      const pHex = getSemanticHexColor(snapshot.workpiece.tone);
      corridor.podGlowMat.color.setHex(pHex);
      corridor.podGlowMat.emissive.setHex(pHex);
    } else {
      corridor.podGroup.visible = false;
    }

    // 4. Repaint live 3D studio displays
    paintSt00WallScreen(st00ScreenSurface, snapshot);
    paintSt01DagScreen(st01DagSurface, snapshot, 0.2);

    const notes = snapshot.st01.stickyNotes;
    stickySurfaces.forEach((surf, idx) => {
      const item = notes[idx % Math.max(1, notes.length)];
      if (item) paintStickyNoteSurface(surf, item);
    });

    paintSt02DiffScreen(st02DiffSurface, snapshot, 0);
    paintSt02SmokeScreen(st02SmokeSurface, snapshot);
    paintSt03RsiScreen(st03RsiSurface, snapshot);
    paintSt04PreviewScreen(st04PreviewSurface, snapshot);
    paintSt05ReportCover(st05CoverSurface, snapshot);

    // 5. ST-03 8-cube matrix semantic colors
    snapshot.st03.cells.slice(0, 8).forEach((cell, idx) => {
      const m = qaCubeMats[idx];
      if (!m) return;
      if (cell.status === 'pass') {
        m.color.setHex(0x34d399);
        m.emissive.setHex(0x059669);
        m.emissiveIntensity = 0.72;
      } else if (cell.status === 'fail') {
        m.color.setHex(0xf87171);
        m.emissive.setHex(0xdc2626);
        m.emissiveIntensity = 1.05;
      } else if (cell.status === 'running') {
        m.color.setHex(0x60a5fa);
        m.emissive.setHex(0x2563eb);
        m.emissiveIntensity = 0.9;
      } else {
        m.color.setHex(0xe2e8f0);
        m.emissive.setHex(0x94a3b8);
        m.emissiveIntensity = 0.14;
      }
    });

    // 6. ST-04 approval podium & stamp trigger
    const stamped = snapshot.st04.isApprovedStamped;
    if (stamped && !prevApprovedState) {
      waveAnimTime = 0;
    }
    prevApprovedState = stamped;

    if (stamped) {
      podiumGlowMat.color.setHex(0x10b981);
      podiumGlowMat.emissive.setHex(0x059669);
      stampMesh.visible = true;
      stampMat.opacity = 1;
    } else if (snapshot.st04.isAwaitingApproval) {
      podiumGlowMat.color.setHex(0xf59e0b);
      podiumGlowMat.emissive.setHex(0xd97706);
      stampMesh.visible = false;
      stampMat.opacity = 0;
    } else {
      podiumGlowMat.color.setHex(0x94a3b8);
      podiumGlowMat.emissive.setHex(0x64748b);
      stampMesh.visible = false;
      stampMat.opacity = 0;
    }
  };

  const tick = (timeSec: number, dtSec: number, snapshot: FactoryPipelineSnapshot) => {
    const dt = Math.min(0.05, Math.max(0.001, dtSec));

    // 1. Gentle Apple-robot breathing hover & subtle gaze motion
    for (const av of avatars) {
      av.bodyGroup.position.y = Math.sin(timeSec * 2.1 + av.phaseOffset) * 0.045;
      av.headGroup.rotation.y = Math.sin(timeSec * 0.85 + av.phaseOffset) * 0.14;
    }

    // 2. ST-00 16 server rack LEDs twinkling at staggered real-telemetry frequencies
    snapshot.st00.rackLeds.slice(0, 16).forEach((led, idx) => {
      const m = st00LedMats[idx];
      if (!m) return;
      const hex =
        led.tone === 'emerald'
          ? 0x10b981
          : led.tone === 'blue'
            ? 0x3b82f6
            : led.tone === 'amber'
              ? 0xf59e0b
              : 0x94a3b8;
      m.color.setHex(hex);
      m.emissive.setHex(hex);
      const pulse = 0.45 + 0.55 * Math.sin((timeSec + led.delaySec) * ((Math.PI * 2) / led.durationSec));
      m.emissiveIntensity = led.tone === 'slate' ? 0.18 : 0.38 + pulse * 0.95;
    });

    // 3. Main conveyor flow pulses, rework return reverse flow, & glowing 3D Workpiece Capsule
    for (let i = 0; i < corridor.mainPulses.length; i += 1) {
      const m = corridor.mainPulses[i];
      m.position.x = -16 + ((i * 8.5 + timeSec * 4.2) % 200);
    }
    if (snapshot.tracks.reworkSt03ToSt02 === 'rework') {
      const span = STUDIO_X_POSITIONS['ST-03'] - STUDIO_X_POSITIONS['ST-02'];
      for (let i = 0; i < corridor.reworkPulses.length; i += 1) {
        const rp = corridor.reworkPulses[i];
        const offset = (i * (span / 6) + timeSec * 7.8) % span;
        rp.position.x = STUDIO_X_POSITIONS['ST-03'] - offset;
      }
    }
    const podPose = evaluateWorkpieceWorldPos(snapshot.workpiece, timeSec);
    if (podPose) {
      corridor.podGroup.visible = true;
      corridor.podGroup.position.set(podPose.x, podPose.y, podPose.z);
      corridor.podGroup.rotation.z = podPose.isReworkRail ? Math.sin(timeSec * 6) * 0.06 : 0;
    } else {
      corridor.podGroup.visible = false;
    }

    // 4. ST-02 3D Welding Sparks physics (gravity + floor bounce!)
    const sparking = snapshot.st02.isSparking;
    sparkPoints.visible = sparking;
    if (sparking) {
      const posAttr = sparkGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < SPARK_COUNT; i += 1) {
        sparkLife[i] -= dt;
        if (sparkLife[i] <= 0) {
          resetSpark(i);
          continue;
        }
        sparkVel[i * 3 + 1] -= 8.8 * dt;
        sparkPositions[i * 3] += sparkVel[i * 3] * dt;
        sparkPositions[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPositions[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;

        // Bounce cleanly off cleanroom ceramic deck
        if (sparkPositions[i * 3 + 1] < 0.09) {
          sparkPositions[i * 3 + 1] = 0.09;
          sparkVel[i * 3 + 1] *= -0.42;
          sparkVel[i * 3] *= 0.72;
          sparkVel[i * 3 + 2] *= 0.72;
        }
      }
      posAttr.needsUpdate = true;
    }

    // 5. ST-03 laser scanner bar sweep + floating cubes + padlock rotation
    const sweep = Math.sin(timeSec * 1.65) * 1.65;
    scannerGroup.position.x = -1.0 + sweep;
    const isQaRework = snapshot.stationStates['ST-03'].led === 'rework';
    laserBeamMat.color.setHex(isQaRework ? 0xdc2626 : 0x2563eb);
    qaCubeMeshes.forEach((cube, idx) => {
      cube.position.y = 1.38 + Math.sin(timeSec * 2.2 + idx * 0.6) * 0.04;
    });
    padlockGroup.position.y = 2.86 + Math.sin(timeSec * 1.8) * 0.06;
    padlockGroup.rotation.y = Math.sin(timeSec * 0.9) * 0.35;

    // 6. ST-04 approval podium pulse, 3D stamp hover, & emerald shockwave ring expansion
    if (snapshot.st04.isAwaitingApproval) {
      podiumGlowMat.emissiveIntensity = 0.65 + 0.55 * Math.sin(timeSec * 3.4);
    } else if (snapshot.st04.isApprovedStamped) {
      podiumGlowMat.emissiveIntensity = 0.95;
      stampMesh.position.y = 1.84 + Math.sin(timeSec * 2.4) * 0.05;
    }

    if (waveAnimTime < 1.35) {
      waveAnimTime += dt;
      const p = Math.min(1, waveAnimTime / 1.35);
      const scale = 1 + p * 7.2;
      waveRing.scale.set(scale, scale, 1);
      waveRingMat.opacity = (1 - p) * 0.75;
    } else {
      waveRingMat.opacity = 0;
    }

    // 7. ST-05 3x3 archive cabinet active drawer smooth slide-out along +Z
    const activeDrawerIdx = snapshot.st05.activeDrawerIndex;
    archiveDrawers.forEach((dr, idx) => {
      const targetZ = activeDrawerIdx === idx ? dr.baseZ + 0.62 : dr.baseZ;
      dr.group.position.z += (targetZ - dr.group.position.z) * Math.min(1, dt * 6.5);
      dr.ledMat.emissiveIntensity = activeDrawerIdx === idx ? 1.35 : 0.32;
    });
    reportBook.position.y = 1.72 + Math.sin(timeSec * 1.7) * 0.03;

    // 8. Throttled dynamic canvas refresh (~3Hz) for ST-01 DAG scan & ST-02 scrolling diff
    if (timeSec - lastCanvasAnimSec > 0.33) {
      lastCanvasAnimSec = timeSec;
      paintSt01DagScreen(st01DagSurface, snapshot, (timeSec * 0.25) % 1);
      if (snapshot.st02.isSparking) {
        paintSt02DiffScreen(st02DiffSurface, snapshot, timeSec);
      }
    }
  };

  const dispose = () => {
    for (const g of ownedGeometries) g.dispose();
    for (const m of ownedMaterials) m.dispose();
    for (const t of ownedTextures) t.dispose();
  };

  return {
    root,
    hitMeshes,
    updateFromSnapshot,
    tick,
    dispose,
  };
}
