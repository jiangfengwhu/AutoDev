import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CENTRAL_ROTUNDA_POS,
  CONVEYOR_JUNCTIONS,
  CONVEYOR_TRACKS,
  POND_POS,
  POND_WATER_RADIUS,
  SANCTUARY_POSITIONS,
  WORKSHOPS,
  createSeededRandom,
  samplePolylinePoint,
  type ConveyorJunctionDefinition,
  type ConveyorTrackDefinition,
  type VillageBuildingId,
  type WorkshopDefinition,
} from './villageConfig';
import type { ProceduralTextureBundle } from './proceduralTextures';
import type { FactoryStationId } from '../lib/factoryPipelineState';

export interface WorkingSparkRig {
  group: THREE.Group;
  motes: THREE.Mesh[];
  material: THREE.MeshStandardMaterial;
  baseY: number;
}

export interface CelebrationParticleSeed {
  originX: number;
  originY: number;
  originZ: number;
  vx: number;
  vy: number;
  vz: number;
  rotSpeedX: number;
  rotSpeedY: number;
  rotSpeedZ: number;
  delay: number;
  scale: number;
}

export interface CelebrationConfettiRig {
  mesh: THREE.InstancedMesh;
  seeds: CelebrationParticleSeed[];
  haloRing: THREE.Mesh;
  haloMat: THREE.MeshStandardMaterial;
}

export interface AnimatedVillageHandles {
  rotundaSpire: THREE.Object3D;
  weathervane: THREE.Object3D;
  clockHourHand: THREE.Object3D;
  clockMinuteHand: THREE.Object3D;
  clockSecondHand: THREE.Object3D;
  satelliteDish: THREE.Object3D | null;
  gears: THREE.Object3D[];
  spinnersY: THREE.Object3D[];
  gateBoomPivot: THREE.Object3D | null;
  archiveVaultWheel: THREE.Object3D | null;
  opsRadarGroup: THREE.Object3D | null;
  specBlueprintMat: THREE.MeshStandardMaterial | null;
  opsLedMaterials: THREE.MeshStandardMaterial[];
  workingSparks: Map<VillageBuildingId, WorkingSparkRig>;
  celebrationRig: CelebrationConfettiRig;
  coderArmillaryOuter: THREE.Object3D;
  coderArmillaryInner: THREE.Object3D;
  cloudArmillaryOuter: THREE.Object3D;
  cloudArmillaryInner: THREE.Object3D;
  coderMascot: THREE.Object3D;
  coderMascotOrbit: THREE.Object3D | null;
  cloudMascot: THREE.Object3D;
  cloudMascotOrbit: THREE.Object3D | null;
  coderSparkles: THREE.Points;
  cloudSparkles: THREE.Points;
  snowParticles: THREE.Points;
  snowMaterial: THREE.PointsMaterial;
  windowMaterials: THREE.MeshStandardMaterial[];
  lampBulbMaterials: THREE.MeshStandardMaterial[];
  lampPoolMaterials: THREE.MeshBasicMaterial[];
  sanctuaryWheelMaterials: THREE.MeshStandardMaterial[];
  reworkRailMaterial: THREE.MeshStandardMaterial;
  groundMaterial: THREE.MeshStandardMaterial;
  hillMaterial: THREE.MeshStandardMaterial;
  foliageCanopyMesh: THREE.InstancedMesh;
  foliageBaseColors: THREE.Color[];
  foliageAutumnColors: THREE.Color[];
  snowRoofMeshes: THREE.Mesh[];
  clickables: THREE.Object3D[];
  hoverRings: Map<VillageBuildingId, THREE.Mesh>;
  buildingAnchors: Map<VillageBuildingId, THREE.Vector3>;
  trackCurves: Map<string, THREE.CatmullRomCurve3>;
  parcelPool: Array<{
    group: THREE.Group;
    ribbonMat: THREE.MeshStandardMaterial;
  }>;
}

function makeContactShadow(
  textures: ProceduralTextureBundle,
  radiusX: number,
  radiusZ = radiusX
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.028;
  mesh.renderOrder = 1;
  return mesh;
}

function createHitbox(
  buildingId: VillageBuildingId,
  stationId: FactoryStationId,
  width: number,
  height: number,
  depth: number,
  yOffset: number
): THREE.Mesh {
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = yOffset;
  hitbox.layers.set(1);
  hitbox.userData = { buildingId, stationId };
  return hitbox;
}

function createHoverRing(radius: number, colorHex: string): THREE.Mesh {
  const geo = new THREE.RingGeometry(radius * 0.92, radius * 1.06, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.y = 0.105;
  ring.renderOrder = 3;
  return ring;
}

function createWorkingSparkRig(
  baseY: number,
  orbitRadius: number,
  colorHex: string
): WorkingSparkRig {
  const group = new THREE.Group();
  group.position.y = baseY;
  group.visible = false;

  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.45,
    roughness: 0.2,
    metalness: 0.15,
    transparent: true,
    opacity: 0.9,
  });

  const moteGeo = new THREE.OctahedronGeometry(0.14, 0);
  const motes: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const mote = new THREE.Mesh(moteGeo, material);
    mote.position.set(
      Math.cos(angle) * orbitRadius,
      (i % 3) * 0.32,
      Math.sin(angle) * orbitRadius
    );
    mote.userData = { angle, orbitRadius, phase: i * 1.05 };
    group.add(mote);
    motes.push(mote);
  }

  return { group, motes, material, baseY };
}

/**
 * Smooth concave 4-pointed Gemini sparkle star silhouette for extruded crystal sculpting.
 */
function createGeminiStarShape(radius: number, waist: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, radius);
  s.quadraticCurveTo(waist, waist, radius, 0);
  s.quadraticCurveTo(waist, -waist, 0, -radius);
  s.quadraticCurveTo(-waist, -waist, -radius, 0);
  s.quadraticCurveTo(-waist, waist, 0, radius);
  s.closePath();
  return s;
}

/**
 * Iconic smooth arching Google Antigravity "A" ribbon silhouette for 3D crystal sculpting.
 */
function createAntigravityLogoShape(scale = 1.0): THREE.Shape {
  const s = new THREE.Shape();
  const k = scale;
  // Start at bottom-left rounded tip and sweep up to the sleek rounded apex
  s.moveTo(-0.88 * k, -0.84 * k);
  s.bezierCurveTo(
    -0.56 * k,
    -0.08 * k,
    -0.28 * k,
    0.98 * k,
    0.0 * k,
    0.98 * k
  );
  // Sweep down right outer flank to bottom-right rounded tip
  s.bezierCurveTo(
    0.28 * k,
    0.98 * k,
    0.56 * k,
    -0.08 * k,
    0.88 * k,
    -0.84 * k
  );
  // Smooth rounded right foot
  s.bezierCurveTo(
    0.94 * k,
    -0.98 * k,
    0.72 * k,
    -1.08 * k,
    0.56 * k,
    -0.94 * k
  );
  // Sweeping gravity-defying concave inner arch (the signature Antigravity lift curve)
  s.bezierCurveTo(
    0.34 * k,
    -0.56 * k,
    0.2 * k,
    -0.18 * k,
    0.0 * k,
    -0.18 * k
  );
  s.bezierCurveTo(
    -0.2 * k,
    -0.18 * k,
    -0.34 * k,
    -0.56 * k,
    -0.56 * k,
    -0.94 * k
  );
  // Smooth rounded left foot closing back to start
  s.bezierCurveTo(
    -0.72 * k,
    -1.08 * k,
    -0.94 * k,
    -0.98 * k,
    -0.88 * k,
    -0.84 * k
  );
  s.closePath();
  return s;
}

/**
 * Normalizes extruded geometry UVs into [0, 1] x [0, 1] planar coordinates so
 * multi-color canvas gradients wrap seamlessly across sculpted logos.
 */
function normalizeExtrudePlanarUVs(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return;
  const sizeX = Math.max(0.001, box.max.x - box.min.x);
  const sizeY = Math.max(0.001, box.max.y - box.min.y);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!pos || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) - box.min.x) / sizeX;
    const v = (pos.getY(i) - box.min.y) / sizeY;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

/**
 * Procedural vibrant Google Antigravity 4-color gradient canvas texture
 * (Cobalt Blue -> Emerald Green -> Warm Gold -> Coral Red).
 */
function createAntigravityGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Rich luminous base sweep left-to-right & bottom-to-top matching Google Antigravity palette
    const grad = ctx.createLinearGradient(0, 512, 512, 0);
    grad.addColorStop(0.0, '#3186FF');
    grad.addColorStop(0.28, '#00B95C');
    grad.addColorStop(0.54, '#FFE432');
    grad.addColorStop(0.78, '#FC413D');
    grad.addColorStop(1.0, '#4285F4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle soft radial highlight near the apex for ceramic-glass dimension
    const apexGlow = ctx.createRadialGradient(256, 110, 16, 256, 140, 260);
    apexGlow.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    apexGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = apexGlow;
    ctx.fillRect(0, 0, 512, 512);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sculpted brass-framed porcelain department doorplate (门牌) mounted on HQ-left cottages.
 */
function createDepartmentDoorplate(
  code: string,
  title: string,
  accentHex: string,
  brassMat: THREE.Material
): THREE.Group {
  const plaqueGroup = new THREE.Group();

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Warm cream enamel porcelain backdrop
    ctx.fillStyle = '#FFFDF7';
    ctx.fillRect(0, 0, 512, 192);

    // Warm matte ivory enamel base (high legibility without glare)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 192);
    bgGrad.addColorStop(0, '#FFFDF8');
    bgGrad.addColorStop(1, '#F1EAD9');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 512, 192);

    // Outer & inner hairline brass architectural border
    ctx.strokeStyle = '#B8893E';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 176);

    // Rich top department color ribbon with white monospace code
    ctx.fillStyle = accentHex;
    ctx.fillRect(16, 16, 480, 56);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 32px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code, 256, 45);

    // High-contrast bold Chinese department title
    ctx.fillStyle = '#0F172A';
    ctx.font = '900 72px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(title, 256, 128);
  }

  const plateTex = new THREE.CanvasTexture(canvas);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.anisotropy = 4;
  plateTex.needsUpdate = true;

  // Solid brushed-brass backing frame
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.8, 0.08),
    brassMat
  );
  backing.castShadow = true;

  // Matte porcelain enamel front face offset slightly proud of backing (zero z-fighting, zero sun glare)
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.98, 0.68),
    new THREE.MeshStandardMaterial({
      map: plateTex,
      roughness: 0.82,
      metalness: 0.0,
    })
  );
  face.position.z = 0.044;

  // Miniature brass mounting rivets at left & right edges
  for (const rx of [-0.95, 0.95]) {
    const rivet = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 8, 8),
      brassMat
    );
    rivet.position.set(rx, 0, 0.048);
    plaqueGroup.add(rivet);
  }

  plaqueGroup.add(backing, face);
  // Tilt slightly upward so the elevated isometric camera reads the lettering clearly
  plaqueGroup.rotation.x = -0.24;
  return plaqueGroup;
}

function createBeveledRectShape(w: number, h: number, r: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw * 0.45, hh * 0.45);
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hh);
  s.lineTo(hw - rr, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + rr);
  s.lineTo(hw, hh - rr);
  s.quadraticCurveTo(hw, hh, hw - rr, hh);
  s.lineTo(-hw + rr, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - rr);
  s.lineTo(-hw, -hh + rr);
  s.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
  return s;
}

function createGearMesh(
  outerR: number,
  innerR: number,
  thickness: number,
  teeth: number,
  mat: THREE.Material
): THREE.Mesh {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.25;
    const a2 = a0 + step * 0.52;
    const a3 = a0 + step * 0.78;
    const p0x = Math.cos(a0) * innerR;
    const p0y = Math.sin(a0) * innerR;
    if (i === 0) shape.moveTo(p0x, p0y);
    else shape.lineTo(p0x, p0y);
    shape.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
    shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    shape.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR * 0.35, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  geo.center();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Builds the iconic Central Glass-Dome Conservatory / Dispatch Rotunda (ST-00)
 */
function buildCentralGlassRotunda(
  textures: ProceduralTextureBundle,
  shared: {
    creamStone: THREE.MeshStandardMaterial;
    warmSandstone: THREE.MeshStandardMaterial;
    terracottaRoof: THREE.MeshStandardMaterial;
    sageTrim: THREE.MeshStandardMaterial;
    brassMetal: THREE.MeshStandardMaterial;
    darkIron: THREE.MeshStandardMaterial;
    glassDomeMat: THREE.Material;
    warmWindowMat: THREE.MeshStandardMaterial;
    snowCapMat: THREE.MeshStandardMaterial;
  },
  isSoftwareGl: boolean
): {
  group: THREE.Group;
  spire: THREE.Object3D;
  weathervane: THREE.Object3D;
  hitbox: THREE.Mesh;
  hoverRing: THREE.Mesh;
  snowMeshes: THREE.Mesh[];
  clockHourHand: THREE.Object3D;
  clockMinuteHand: THREE.Object3D;
  clockSecondHand: THREE.Object3D;
} {
  const group = new THREE.Group();
  group.position.set(CENTRAL_ROTUNDA_POS.x, 0, CENTRAL_ROTUNDA_POS.z);
  const snowMeshes: THREE.Mesh[] = [];

  group.add(makeContactShadow(textures, 6.2));

  // Concentric stepped circular stone terrace with tactile tile bump map
  const baseOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(5.6, 5.85, 0.24, 48),
    new THREE.MeshStandardMaterial({
      map: textures.courtyardTiles,
      bumpMap: textures.tileBump,
      bumpScale: 0.024,
      roughness: 0.84,
      metalness: 0.02,
    })
  );
  baseOuter.position.y = 0.12;
  baseOuter.receiveShadow = true;
  group.add(baseOuter);

  const baseInner = new THREE.Mesh(
    new THREE.CylinderGeometry(4.55, 4.72, 0.24, 40),
    shared.warmSandstone
  );
  baseInner.position.y = 0.36;
  baseInner.receiveShadow = true;
  group.add(baseInner);

  // Neoclassical cylindrical drum
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(3.82, 3.92, 3.2, 36),
    shared.creamStone
  );
  drum.position.y = 2.08;
  drum.castShadow = true;
  drum.receiveShadow = true;
  group.add(drum);

  // Dark stone dado plinth
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(3.98, 4.04, 0.56, 36),
    new THREE.MeshStandardMaterial({ color: '#8E887D', roughness: 0.85 })
  );
  plinth.position.y = 0.74;
  group.add(plinth);

  // Upper molded cornice ring
  const cornice = new THREE.Mesh(
    new THREE.CylinderGeometry(4.24, 4.02, 0.34, 36),
    shared.warmSandstone
  );
  cornice.position.y = 3.74;
  cornice.castShadow = true;
  group.add(cornice);

  // 12 classical pilasters + arched mullioned windows + flower window boxes
  const flowerColors = ['#F472B6', '#FBBF24', '#FFFFFF', '#FB7185'];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const pilaster = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 3.1, 0.32),
      shared.warmSandstone
    );
    pilaster.position.set(
      Math.cos(angle) * 3.86,
      2.12,
      Math.sin(angle) * 3.86
    );
    pilaster.rotation.y = -angle;
    pilaster.castShadow = true;
    group.add(pilaster);

    // Place windows between pilasters (5 dedicated arched conveyor portals: West i=4,5,7 + East i=0,11; remaining bays stay bright mullioned windows!)
    const winAngle = angle + Math.PI / 12;
    const isPortal = i === 0 || i === 4 || i === 5 || i === 7 || i === 11;
    if (isPortal) {
      // Sculpted arched conveyor entry portal with keystone & clean recessed tunnel
      const portalGroup = new THREE.Group();
      portalGroup.position.set(
        Math.cos(winAngle) * 3.88,
        0,
        Math.sin(winAngle) * 3.88
      );
      portalGroup.rotation.y = -winAngle + Math.PI / 2;

      const portalFrame = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.16, 10, 22, Math.PI),
        shared.warmSandstone
      );
      portalFrame.position.set(0, 1.24, 0.04);
      portalFrame.castShadow = true;
      portalGroup.add(portalFrame);

      // Left & right portal jambs
      for (const jx of [-0.92, 0.92]) {
        const jamb = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.85, 0.3),
          shared.warmSandstone
        );
        jamb.position.set(jx, 0.84, 0.04);
        portalGroup.add(jamb);
      }

      // Brass arch keystone
      const keystone = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.3, 0.24),
        shared.brassMetal
      );
      keystone.position.set(0, 2.18, 0.08);
      portalGroup.add(keystone);

      const portalDark = new THREE.Mesh(
        new THREE.BoxGeometry(1.72, 1.56, 0.36),
        new THREE.MeshStandardMaterial({ color: '#1A2230', roughness: 0.92 })
      );
      portalDark.position.set(0, 1.24, -0.06);
      portalGroup.add(portalDark);

      group.add(portalGroup);
    } else {
      const winGroup = new THREE.Group();
      winGroup.position.set(
        Math.cos(winAngle) * 3.86,
        2.15,
        Math.sin(winAngle) * 3.86
      );
      winGroup.rotation.y = -winAngle + Math.PI / 2;

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.02, 1.48, 0.14),
        shared.sageTrim
      );
      winGroup.add(frame);

      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 1.24, 0.16),
        shared.warmWindowMat
      );
      winGroup.add(pane);

      // Mullion cross
      const mullionV = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.24, 0.18),
        shared.creamStone
      );
      const mullionH = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.06, 0.18),
        shared.creamStone
      );
      winGroup.add(mullionV, mullionH);

      // Terracotta window flower box with colorful tiny blossoms
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.06, 0.24, 0.34),
        shared.terracottaRoof
      );
      box.position.set(0, -0.84, 0.16);
      winGroup.add(box);

      for (let f = -1; f <= 1; f++) {
        const bloom = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 8, 8),
          new THREE.MeshStandardMaterial({
            color: flowerColors[(i + f + 4) % flowerColors.length],
            roughness: 0.7,
          })
        );
        bloom.position.set(f * 0.28, -0.66, 0.18);
        winGroup.add(bloom);
      }

      group.add(winGroup);
    }
  }

  // Classical balustrade parapet ring with a clean architectural gap around the front +Z Clock Pediment!
  const clockGapHalfRad = 0.34;
  const railArcPts: THREE.Vector3[] = [];
  const railSegs = 44;
  const railStart = Math.PI / 2 + clockGapHalfRad;
  const railSpan = Math.PI * 2 - clockGapHalfRad * 2;
  for (let s = 0; s <= railSegs; s++) {
    const a = railStart + (s / railSegs) * railSpan;
    railArcPts.push(new THREE.Vector3(Math.cos(a) * 4.06, 4.38, Math.sin(a) * 4.06));
  }
  const topRail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railArcPts), 48, 0.085, 8, false),
    shared.creamStone
  );
  group.add(topRail);

  // Twin carved stone end-cap piers + finial orbs cleanly terminating the balustrade on either side of the clock
  for (const endA of [Math.PI / 2 + clockGapHalfRad, Math.PI / 2 - clockGapHalfRad]) {
    const ex = Math.cos(endA) * 4.06;
    const ez = Math.sin(endA) * 4.06;
    const endPier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.54, 10),
      shared.warmSandstone
    );
    endPier.position.set(ex, 4.18, ez);
    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      shared.creamStone
    );
    finial.position.set(ex, 4.52, ez);
    group.add(endPier, finial);
  }

  const balusterGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.48, 8);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    // Skip balusters inside the front +Z clock pediment opening
    const deltaFromFront = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
    if (deltaFromFront < clockGapHalfRad + 0.05) continue;
    const post = new THREE.Mesh(balusterGeo, shared.creamStone);
    post.position.set(Math.cos(a) * 4.06, 4.14, Math.sin(a) * 4.06);
    group.add(post);
  }

  // Pure Circular Front Clock Medallion seated cleanly onto the cornice (zero rectangular base!)
  const pedimentGroup = new THREE.Group();
  pedimentGroup.position.set(0, 4.78, 3.98);

  const pedBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 0.96, 0.44, 32),
    shared.warmSandstone
  );
  pedBody.rotation.x = Math.PI / 2;
  pedBody.castShadow = true;
  pedimentGroup.add(pedBody);

  const clockBezel = new THREE.Mesh(
    new THREE.TorusGeometry(0.79, 0.055, 10, 32),
    shared.brassMetal
  );
  clockBezel.position.z = 0.22;
  pedimentGroup.add(clockBezel);

  const clockDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.76, 32),
    new THREE.MeshStandardMaterial({
      map: textures.clockFace,
      roughness: 0.32,
      metalness: 0.08,
    })
  );
  clockDisc.position.z = 0.23;
  pedimentGroup.add(clockDisc);

  // Real-time 3D analog clock hands (pivoted at center; +Y = 12 o'clock, negative Z rotation = clockwise)
  const clockHandMat = new THREE.MeshStandardMaterial({
    color: '#1E293B',
    roughness: 0.35,
    metalness: 0.25,
  });
  const clockSecondMat = new THREE.MeshStandardMaterial({
    color: '#DC2626',
    roughness: 0.3,
    metalness: 0.2,
  });

  const clockHourHand = new THREE.Group();
  clockHourHand.position.set(0, 0, 0.246);
  const hourMesh = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.44, 0.014), clockHandMat);
  hourMesh.position.y = 0.16;
  clockHourHand.add(hourMesh);
  pedimentGroup.add(clockHourHand);

  const clockMinuteHand = new THREE.Group();
  clockMinuteHand.position.set(0, 0, 0.258);
  const minuteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.62, 0.012), clockHandMat);
  minuteMesh.position.y = 0.23;
  clockMinuteHand.add(minuteMesh);
  pedimentGroup.add(clockMinuteHand);

  const clockSecondHand = new THREE.Group();
  clockSecondHand.position.set(0, 0, 0.268);
  const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.7, 0.01), clockSecondMat);
  secondMesh.position.y = 0.22;
  clockSecondHand.add(secondMesh);
  pedimentGroup.add(clockSecondHand);

  const clockCenterCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.068, 0.036, 16),
    shared.brassMetal
  );
  clockCenterCap.rotation.x = Math.PI / 2;
  clockCenterCap.position.z = 0.274;
  pedimentGroup.add(clockCenterCap);

  const pedRoof = new THREE.Mesh(
    new THREE.TorusGeometry(0.94, 0.11, 10, 28, Math.PI),
    shared.terracottaRoof
  );
  pedRoof.position.z = 0.03;
  pedimentGroup.add(pedRoof);
  group.add(pedimentGroup);

  // Ribbed Hemispherical Glass Conservatory Dome
  const domeRadius = 3.68;
  const domeBaseY = 3.92;
  const glassDome = new THREE.Mesh(
    new THREE.SphereGeometry(
      domeRadius,
      isSoftwareGl ? 24 : 36,
      isSoftwareGl ? 14 : 22,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.49
    ),
    shared.glassDomeMat
  );
  glassDome.position.y = domeBaseY;
  glassDome.renderOrder = 3;
  group.add(glassDome);

  // 12 curved architectural ribs framing the glass dome
  const ribArcGeo = new THREE.TorusGeometry(
    domeRadius + 0.03,
    0.055,
    6,
    24,
    Math.PI * 0.49
  );
  for (let i = 0; i < 12; i++) {
    const rib = new THREE.Mesh(ribArcGeo, shared.creamStone);
    rib.position.y = domeBaseY;
    rib.rotation.y = (i / 12) * Math.PI * 2;
    group.add(rib);
  }
  // Horizontal structural ring mullions
  for (const frac of [0.22, 0.5, 0.78]) {
    const phi = frac * Math.PI * 0.48;
    const r = Math.cos(phi) * (domeRadius + 0.03);
    const y = domeBaseY + Math.sin(phi) * domeRadius;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.045, 6, 36),
      shared.creamStone
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }

  // Winter snow cap overlay for dome crown (fades in during winter snow)
  const snowCrown = new THREE.Mesh(
    new THREE.SphereGeometry(
      domeRadius + 0.07,
      24,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.25
    ),
    shared.snowCapMat
  );
  snowCrown.position.y = domeBaseY;
  snowCrown.visible = false;
  group.add(snowCrown);
  snowMeshes.push(snowCrown);

  // Central spinning brass spire inside the glass dome
  const spire = new THREE.Group();
  spire.position.y = 4.2;
  const spireRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.26, 3.2, 12),
    shared.brassMetal
  );
  spireRod.position.y = 1.4;
  spire.add(spireRod);
  for (let i = 0; i < 3; i++) {
    const gyroRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.1 - i * 0.24, 0.045, 8, 28),
      shared.brassMetal
    );
    gyroRing.position.y = 1.2 + i * 0.42;
    gyroRing.rotation.x = Math.PI * (0.25 + i * 0.22);
    gyroRing.rotation.z = i * 0.6;
    spire.add(gyroRing);
  }
  group.add(spire);

  // Top Cupola Lantern + Terracotta Cap + Golden Weathervane
  const cupolaY = domeBaseY + domeRadius - 0.1;
  const cupolaBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.76, 0.88, 0.85, 12),
    shared.creamStone
  );
  cupolaBase.position.y = cupolaY + 0.32;
  group.add(cupolaBase);

  const cupolaGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 0.68, 0.56, 12),
    shared.warmWindowMat
  );
  cupolaGlass.position.y = cupolaY + 0.36;
  group.add(cupolaGlass);

  const cupolaCap = new THREE.Mesh(
    new THREE.ConeGeometry(0.92, 0.92, 12),
    shared.terracottaRoof
  );
  cupolaCap.position.y = cupolaY + 1.18;
  cupolaCap.castShadow = true;
  group.add(cupolaCap);

  const weathervane = new THREE.Group();
  weathervane.position.y = cupolaY + 1.9;
  const vaneStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.85, 8),
    shared.brassMetal
  );
  const vaneArrow = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.05, 0.06),
    shared.brassMetal
  );
  vaneArrow.position.y = 0.28;
  const vaneTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.22, 6),
    shared.brassMetal
  );
  vaneTip.rotation.z = -Math.PI / 2;
  vaneTip.position.set(0.5, 0.28, 0);
  weathervane.add(vaneStem, vaneArrow, vaneTip);
  group.add(weathervane);

  // Stylized miniature perched pigeons on the balustrade (charming detail from 00:59!)
  const pigeonMat = new THREE.MeshStandardMaterial({
    color: '#94A3B8',
    roughness: 0.72,
  });
  const pigeonHeadMat = new THREE.MeshStandardMaterial({
    color: '#64748B',
    roughness: 0.65,
  });
  const pigeonAngles = [0.65, 0.82, 2.38];
  for (const pa of pigeonAngles) {
    const bird = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      pigeonMat
    );
    body.scale.set(1.3, 0.9, 0.85);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 8, 8),
      pigeonHeadMat
    );
    head.position.set(0.14, 0.1, 0);
    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.09, 6),
      shared.brassMetal
    );
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.24, 0.09, 0);
    bird.add(body, head, beak);
    bird.position.set(Math.cos(pa) * 4.06, 4.54, Math.sin(pa) * 4.06);
    bird.rotation.y = -pa + 0.5;
    group.add(bird);
  }

  const hoverRing = createHoverRing(5.85, '#2563EB');
  group.add(hoverRing);

  const hitbox = createHitbox('ST-00', 'ST-00', 8.8, 9.2, 8.8, 4.6);
  group.add(hitbox);

  return {
    group,
    spire,
    weathervane,
    clockHourHand,
    clockMinuteHand,
    clockSecondHand,
    hitbox,
    hoverRing,
    snowMeshes,
  };
}

/**
 * Builds one of the 6 distinct sunlit miniature architectural workshop cottages
 * along the West Courtyard District.
 */
function buildWorkshopCottage(
  def: WorkshopDefinition,
  textures: ProceduralTextureBundle,
  shared: {
    creamStone: THREE.MeshStandardMaterial;
    warmSandstone: THREE.MeshStandardMaterial;
    terracottaRoof: THREE.MeshStandardMaterial;
    sageTrim: THREE.MeshStandardMaterial;
    slateRoof: THREE.MeshStandardMaterial;
    brassMetal: THREE.MeshStandardMaterial;
    darkIron: THREE.MeshStandardMaterial;
    woodMat: THREE.MeshStandardMaterial;
    glassDomeMat: THREE.Material;
    warmWindowMat: THREE.MeshStandardMaterial;
    snowCapMat: THREE.MeshStandardMaterial;
  }
): {
  group: THREE.Group;
  hitbox: THREE.Mesh;
  hoverRing: THREE.Mesh;
  satelliteDish: THREE.Object3D | null;
  gears: THREE.Object3D[];
  spinnersY: THREE.Object3D[];
  gateBoomPivot: THREE.Object3D | null;
  archiveVaultWheel: THREE.Object3D | null;
  opsRadarGroup: THREE.Object3D | null;
  specBlueprintMat: THREE.MeshStandardMaterial | null;
  opsLedMaterials: THREE.MeshStandardMaterial[];
  snowMeshes: THREE.Mesh[];
} {
  const group = new THREE.Group();
  group.position.set(def.position.x, 0, def.position.z);
  group.rotation.y = def.rotationY;

  const gears: THREE.Object3D[] = [];
  const spinnersY: THREE.Object3D[] = [];
  const snowMeshes: THREE.Mesh[] = [];
  const opsLedMaterials: THREE.MeshStandardMaterial[] = [];
  let satelliteDish: THREE.Object3D | null = null;
  let gateBoomPivot: THREE.Object3D | null = null;
  let archiveVaultWheel: THREE.Object3D | null = null;
  let opsRadarGroup: THREE.Object3D | null = null;
  let specBlueprintMat: THREE.MeshStandardMaterial | null = null;

  group.add(makeContactShadow(textures, 3.45, 3.0));

  // Raised tiled courtyard patio (5.6 x 4.6) with crisp stepped sandstone outer curb
  const curbShape = createBeveledRectShape(5.72, 4.72, 0.36);
  const curbGeo = new THREE.ExtrudeGeometry(curbShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  curbGeo.rotateX(Math.PI / 2);
  const patioCurb = new THREE.Mesh(curbGeo, shared.warmSandstone);
  patioCurb.position.y = 0.15;
  patioCurb.receiveShadow = true;
  group.add(patioCurb);

  const patioShape = createBeveledRectShape(5.42, 4.42, 0.3);
  const patioGeo = new THREE.ExtrudeGeometry(patioShape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  patioGeo.rotateX(Math.PI / 2);
  const patio = new THREE.Mesh(
    patioGeo,
    new THREE.MeshStandardMaterial({
      map: textures.courtyardTiles,
      bumpMap: textures.tileBump,
      bumpScale: 0.022,
      roughness: 0.86,
      metalness: 0.02,
    })
  );
  patio.position.y = 0.22;
  patio.receiveShadow = true;
  group.add(patio);

  // Carved stone entrance threshold step on front patio
  const entryStep = new THREE.Mesh(
    new THREE.BoxGeometry(1.32, 0.14, 0.44),
    shared.creamStone
  );
  entryStep.position.set(0, 0.28, 1.54);
  entryStep.receiveShadow = true;
  group.add(entryStep);

  // Potted miniature boxwood topiaries flanking front patio corners (authentic European diorama touch)
  const topiaryLeafMat = new THREE.MeshStandardMaterial({
    color: '#4F9A44',
    roughness: 0.8,
  });
  const addPottedTopiary = (px: number, pz: number) => {
    const planter = new THREE.Group();
    planter.position.set(px, 0.24, pz);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.14, 0.26, 10),
      shared.terracottaRoof
    );
    pot.position.y = 0.13;
    pot.castShadow = true;
    const bushLow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24, 1),
      topiaryLeafMat
    );
    bushLow.position.y = 0.4;
    bushLow.castShadow = true;
    const bushTop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 1),
      topiaryLeafMat
    );
    bushTop.position.y = 0.64;
    planter.add(pot, bushLow, bushTop);
    group.add(planter);
  };
  addPottedTopiary(-2.22, 1.72);
  addPottedTopiary(-2.22, -1.72);

  // Subtle decorative courtyard bench tucked neatly on west-south patio corner
  const bench = new THREE.Group();
  bench.position.set(-1.55, 0.24, 1.85);
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.08, 0.34),
    shared.woodMat
  );
  seat.position.y = 0.24;
  const leg1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.24, 0.3),
    shared.darkIron
  );
  leg1.position.set(-0.36, 0.12, 0);
  const leg2 = leg1.clone();
  leg2.position.x = 0.36;
  bench.add(seat, leg1, leg2);
  group.add(bench);

  // Helper for crisp mullioned cottage windows with sandstone sills & optional flowerboxes
  const blossomPalette = ['#F472B6', '#FBBF24', '#FFFFFF', '#FB7185'];
  const addFramedWindow = (
    x: number,
    y: number,
    z: number,
    w = 0.68,
    h = 0.92,
    withFlowerBox = true
  ) => {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.1),
      shared.creamStone
    );
    frame.position.set(x, y, z - 0.01);
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.12),
      shared.warmWindowMat
    );
    pane.position.set(x, y, z + 0.01);
    const mullionV = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, h, 0.14),
      shared.creamStone
    );
    mullionV.position.set(x, y, z + 0.02);
    const mullionH = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.05, 0.14),
      shared.creamStone
    );
    mullionH.position.set(x, y, z + 0.02);
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.24, 0.1, 0.2),
      shared.warmSandstone
    );
    sill.position.set(x, y - h / 2 - 0.06, z + 0.05);
    group.add(frame, pane, mullionV, mullionH, sill);

    if (withFlowerBox) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.18, 0.18, 0.24),
        shared.terracottaRoof
      );
      box.position.set(x, y - h / 2 - 0.17, z + 0.12);
      group.add(box);
      for (let f = -1; f <= 1; f++) {
        const bloom = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 7, 7),
          new THREE.MeshStandardMaterial({
            color: blossomPalette[Math.abs(Math.round(x * 3) + f) % blossomPalette.length],
            roughness: 0.7,
          })
        );
        bloom.position.set(x + f * (w * 0.28), y - h / 2 - 0.06, z + 0.14);
        group.add(bloom);
      }
    }
  };

  // Sculpted East Arched Conveyor Loading Bay flush with conveyor track at local x = +2.15, y = 0.62, z = 0
  const addEastLoadingArchway = (
    wallX: number,
    housingMat: THREE.Material,
    canopyMat: THREE.Material
  ) => {
    const bayGroup = new THREE.Group();
    const bayDepth = Math.max(0.38, 2.18 - wallX);
    const bayCenterX = wallX + bayDepth / 2;

    // Stone/brick projecting housing flanking the conveyor mouth
    const leftPier = new THREE.Mesh(
      new THREE.BoxGeometry(bayDepth, 1.44, 0.24),
      housingMat
    );
    leftPier.position.set(bayCenterX, 0.96, -0.58);
    leftPier.castShadow = true;
    const rightPier = new THREE.Mesh(
      new THREE.BoxGeometry(bayDepth, 1.44, 0.24),
      housingMat
    );
    rightPier.position.set(bayCenterX, 0.96, 0.58);
    rightPier.castShadow = true;

    const topLintel = new THREE.Mesh(
      new THREE.BoxGeometry(bayDepth + 0.08, 0.28, 1.46),
      shared.warmSandstone
    );
    topLintel.position.set(bayCenterX, 1.66, 0);
    topLintel.castShadow = true;

    // Sloped architectural canopy hood above the conveyor doorway
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(bayDepth + 0.24, 0.1, 1.56),
      canopyMat
    );
    hood.position.set(bayCenterX + 0.06, 1.84, 0);
    hood.rotation.z = -0.18;
    hood.castShadow = true;

    // Brass arch keystone + recessed dark interior delivery chute
    const keystone = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.24, 0.22),
      shared.brassMetal
    );
    keystone.position.set(2.2, 1.66, 0);

    const chuteDark = new THREE.Mesh(
      new THREE.BoxGeometry(bayDepth + 0.04, 1.28, 0.96),
      new THREE.MeshStandardMaterial({ color: '#1A2230', roughness: 0.92 })
    );
    chuteDark.position.set(bayCenterX - 0.03, 0.92, 0);

    // Lower stone apron beneath belt height (y = 0.62)
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(bayDepth + 0.06, 0.38, 1.06),
      shared.creamStone
    );
    apron.position.set(bayCenterX, 0.41, 0);

    // Warm miniature wall sconce lamp beside loading bay
    const sconce = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 8, 8),
      new THREE.MeshStandardMaterial({
        color: '#FEF3C7',
        emissive: '#F59E0B',
        emissiveIntensity: 0.85,
        roughness: 0.2,
      })
    );
    sconce.position.set(2.22, 1.48, 0.6);

    bayGroup.add(leftPier, rightPier, topLintel, hood, keystone, chuteDark, apron, sconce);
    group.add(bayGroup);
  };

  // Variant-specific architectural body with tactile bump-mapped brickwork
  const brickMat = new THREE.MeshStandardMaterial({
    map: textures.brickWall,
    bumpMap: textures.brickBump,
    bumpScale: 0.038,
    roughness: 0.86,
    metalness: 0.02,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    map: textures.solarPanel,
    roughness: 0.24,
    metalness: 0.48,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    color: '#958E82',
    roughness: 0.88,
  });

  if (def.variant === 'brick_telecom') {
    // ST-01 (SPEC): Hero Brick Telecom & Blueprint Cottage with East Arched Loading Bay, Turret Dish, Solar Roof & NE Brass Gear Chimney!
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.35, 2.7), brickMat);
    body.position.set(0, 1.38, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Molded stone dado plinth base
    const dado = new THREE.Mesh(new THREE.BoxGeometry(3.52, 0.36, 2.82), plinthMat);
    dado.position.set(0, 0.4, 0);
    group.add(dado);

    // Cream sandstone corner quoins cleanly seated ABOVE stone dado plinth (y=0.585..2.505) to eliminate z-fighting!
    for (const cx of [-1.66, 1.66]) {
      for (const cz of [-1.31, 1.31]) {
        const quoin = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 1.92, 0.2),
          shared.creamStone
        );
        quoin.position.set(cx, 1.545, cz);
        group.add(quoin);
      }
    }
    const eavesBand = new THREE.Mesh(
      new THREE.BoxGeometry(3.64, 0.14, 2.94),
      shared.creamStone
    );
    eavesBand.position.set(0, 2.58, 0);
    group.add(eavesBand);

    // Pitched terracotta hip/gable roof
    const roofGeo = new THREE.CylinderGeometry(0, 2.6, 1.48, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, shared.terracottaRoof);
    roof.scale.set(1.12, 1, 0.92);
    roof.position.set(0, 3.34, 0);
    roof.castShadow = true;
    group.add(roof);

    const snowRoof = new THREE.Mesh(roofGeo, shared.snowCapMat);
    snowRoof.scale.set(1.15, 0.96, 0.95);
    snowRoof.position.set(0, 3.42, 0);
    snowRoof.visible = false;
    group.add(snowRoof);
    snowMeshes.push(snowRoof);

    // Rooftop photovoltaic solar panel cleanly mounted above front terracotta roof slope
    const solar = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.08, 0.88), solarMat);
    solar.position.set(0.05, 3.42, 0.78);
    solar.rotation.x = 0.54;
    group.add(solar);

    // Sculpted stone roof turret pedestal rising cleanly above the NW terracotta slope
    const dishTurret = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 1.28, 0.56),
      shared.creamStone
    );
    dishTurret.position.set(-0.96, 3.34, -0.58);
    dishTurret.castShadow = true;
    const dishTurretCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.1, 0.66),
      shared.warmSandstone
    );
    dishTurretCap.position.set(-0.96, 4.0, -0.58);
    group.add(dishTurret, dishTurretCap);

    // Rotating white rooftop satellite dish seated cleanly ON TOP of the turret cap
    const dishRoot = new THREE.Group();
    dishRoot.position.set(-0.96, 4.06, -0.58);
    const dishBaseCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.1, 12),
      shared.brassMetal
    );
    dishBaseCollar.position.y = 0.05;
    const dishPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.52, 8),
      shared.darkIron
    );
    dishPole.position.y = 0.34;
    const dishBowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
      shared.creamStone
    );
    dishBowl.rotation.x = Math.PI * 0.64;
    dishBowl.position.set(0, 0.72, 0.1);
    const dishPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.032, 0.4, 8),
      shared.brassMetal
    );
    dishPin.rotation.x = Math.PI * 0.28;
    dishPin.position.set(0, 0.8, 0.25);
    const dishTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 8, 8),
      shared.brassMetal
    );
    dishTip.position.set(0, 0.94, 0.4);
    dishRoot.add(dishBaseCollar, dishPole, dishBowl, dishPin, dishTip);
    group.add(dishRoot);
    satelliteDish = dishRoot;

    // Brick Parcel-Launcher Chimney + Spinning Brass Gears neatly tucked at NE corner (100% clear of East conveyor doorway at z = 0!)
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.72, 3.05, 0.72), brickMat);
    chimney.position.set(1.54, 1.76, -1.04);
    chimney.castShadow = true;
    group.add(chimney);

    const pressArch = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.24, 0.84),
      shared.warmSandstone
    );
    pressArch.position.set(1.54, 3.34, -1.04);
    group.add(pressArch);

    const gearA = createGearMesh(0.34, 0.25, 0.1, 10, shared.brassMetal);
    gearA.position.set(1.94, 1.62, -1.04);
    gearA.rotation.y = Math.PI / 2;
    const gearB = createGearMesh(0.24, 0.17, 0.1, 8, shared.brassMetal);
    gearB.position.set(1.94, 2.12, -0.78);
    gearB.rotation.y = Math.PI / 2;
    group.add(gearA, gearB);
    gears.push(gearA, gearB);

    // East Arched Brick & Brass Conveyor Loading Bay (flush at x = +2.15, z = 0)
    addEastLoadingArchway(1.7, brickMat, shared.terracottaRoof);

    // Crisp framed warm mullioned windows with flowerboxes on front facade
    for (const wx of [-0.98, 0.98]) {
      addFramedWindow(wx, 1.46, 1.38, 0.68, 0.92, true);
    }

    // SPEC Signature Feature 1: Architectural Blueprint Drafting Lectern on front courtyard
    const blueprintGroup = new THREE.Group();
    blueprintGroup.position.set(0, 0.24, 1.84);
    const lecternPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.1, 0.62, 10),
      shared.darkIron
    );
    lecternPost.position.y = 0.31;
    const lecternBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.08, 0.76),
      shared.creamStone
    );
    lecternBoard.position.set(0, 0.64, 0);
    lecternBoard.rotation.x = 0.42;
    lecternBoard.castShadow = true;
    const blueprintMat = new THREE.MeshStandardMaterial({
      color: '#1D4ED8',
      emissive: '#1E40AF',
      emissiveIntensity: 0.28,
      roughness: 0.35,
    });
    specBlueprintMat = blueprintMat;
    const blueprintSheet = new THREE.Mesh(
      new THREE.BoxGeometry(1.04, 0.025, 0.64),
      blueprintMat
    );
    blueprintSheet.position.set(0, 0.68, 0.02);
    blueprintSheet.rotation.x = 0.42;
    const dagNodeMat = new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      emissive: '#DBEAFE',
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });
    for (const [nx, nz] of [
      [-0.28, -0.1],
      [0, 0.04],
      [0.28, -0.06],
    ]) {
      const node = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.12), dagNodeMat);
      node.position.set(nx, 0.705 + nz * -0.4, 0.02 + nz);
      node.rotation.x = 0.42;
      blueprintGroup.add(node);
    }
    blueprintGroup.add(lecternPost, lecternBoard, blueprintSheet);
    group.add(blueprintGroup);

    // SPEC Signature Feature 2: Sculpted Brass Drafting Compass Emblem centered cleanly between front windows
    const compassCrest = new THREE.Group();
    compassCrest.position.set(0, 1.56, 1.4);
    const compassMedallion = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.07, 18),
      shared.creamStone
    );
    compassMedallion.rotation.x = Math.PI / 2;
    const legLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.32, 0.044),
      shared.brassMetal
    );
    legLeft.position.set(-0.072, -0.015, 0.045);
    legLeft.rotation.z = -0.32;
    const legRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.32, 0.044),
      shared.brassMetal
    );
    legRight.position.set(0.072, -0.015, 0.045);
    legRight.rotation.z = 0.32;
    const compassArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.018, 8, 16, Math.PI),
      shared.brassMetal
    );
    compassArc.position.set(0, -0.048, 0.048);
    compassArc.rotation.z = Math.PI;
    const compassHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.046, 10, 10),
      shared.brassMetal
    );
    compassHead.position.set(0, 0.14, 0.045);
    compassCrest.add(compassMedallion, legLeft, legRight, compassArc, compassHead);
    group.add(compassCrest);

    // Department Doorplate (门牌) mounted cleanly proud of eavesBand with horizontal brass brackets (zero roof clipping!)
    const specDoorplate = createDepartmentDoorplate(
      def.departmentBadge,
      def.name,
      def.accentColor,
      shared.brassMetal
    );
    specDoorplate.position.set(0, 2.58, 1.92);
    group.add(specDoorplate);
    for (const bx of [-0.68, 0.68]) {
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.48),
        shared.brassMetal
      );
      bracket.position.set(bx, 2.58, 1.66);
      group.add(bracket);
    }
  } else if (def.variant === 'glass_greenhouse') {
    // ST-03 (RSI): Glass QA Botanical Conservatory + Rotating Double-Helix Evolution Spire
    const stoneBase = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.95, 2.7),
      shared.creamStone
    );
    stoneBase.position.set(0, 0.7, -0.15);
    stoneBase.castShadow = true;
    group.add(stoneBase);

    const glassWall = new THREE.Mesh(
      new THREE.BoxGeometry(3.26, 1.45, 2.56),
      shared.glassDomeMat
    );
    glassWall.position.set(0, 1.88, -0.15);
    group.add(glassWall);

    // White steel greenhouse ribs
    for (const gx of [-1.62, -0.54, 0.54, 1.62]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 1.5, 2.62),
        shared.creamStone
      );
      post.position.set(gx, 1.88, -0.15);
      group.add(post);
    }

    // Pitched glass roof + emerald lab core glow inside
    const prism = new THREE.Mesh(
      new THREE.CylinderGeometry(0, 2.1, 3.36, 3),
      shared.glassDomeMat
    );
    prism.rotation.z = Math.PI / 2;
    prism.rotation.x = Math.PI / 6;
    prism.scale.set(0.65, 1, 0.9);
    prism.position.set(0, 3.0, -0.15);
    group.add(prism);

    const labCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.58, 0),
      new THREE.MeshStandardMaterial({
        color: '#34D399',
        emissive: '#059669',
        emissiveIntensity: 0.62,
        roughness: 0.22,
        metalness: 0.25,
      })
    );
    labCore.position.set(0, 1.68, -0.15);
    group.add(labCore);

    // RSI Signature Feature 1: Internal Orbiting QA Scanner Calibration Ring
    const scanRingGroup = new THREE.Group();
    scanRingGroup.position.set(0, 1.68, -0.15);
    const scanRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.04, 8, 28),
      shared.brassMetal
    );
    scanRing.rotation.x = Math.PI * 0.42;
    const scanBeam = new THREE.Mesh(
      new THREE.TorusGeometry(0.76, 0.028, 8, 24),
      new THREE.MeshStandardMaterial({
        color: '#10B981',
        emissive: '#10B981',
        emissiveIntensity: 0.85,
        roughness: 0.2,
      })
    );
    scanBeam.rotation.x = -Math.PI * 0.35;
    scanRingGroup.add(scanRing, scanBeam);
    group.add(scanRingGroup);
    spinnersY.push(scanRingGroup);

    // RSI Signature Feature 2: Rotating Double-Helix DNA Evolution Spire atop glass ridge
    const helixTurret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 0.34, 16),
      shared.creamStone
    );
    helixTurret.position.set(0, 3.55, -0.15);
    const helixCollar = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.045, 8, 20),
      shared.brassMetal
    );
    helixCollar.rotation.x = Math.PI / 2;
    helixCollar.position.set(0, 3.72, -0.15);
    group.add(helixTurret, helixCollar);

    const helixGroup = new THREE.Group();
    helixGroup.position.set(0, 3.74, -0.15);
    const emeraldHelixMat = new THREE.MeshStandardMaterial({
      color: '#10B981',
      emissive: '#059669',
      emissiveIntensity: 0.55,
      roughness: 0.24,
      metalness: 0.35,
    });
    const cobaltHelixMat = new THREE.MeshStandardMaterial({
      color: '#3B82F6',
      emissive: '#2563EB',
      emissiveIntensity: 0.5,
      roughness: 0.24,
      metalness: 0.35,
    });
    const nodeGeo = new THREE.SphereGeometry(0.09, 10, 10);
    const rungGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.56, 6);
    for (let k = 0; k < 7; k++) {
      const y = 0.14 + k * 0.19;
      const a = k * 0.82;
      const r = 0.28;
      const n1 = new THREE.Mesh(nodeGeo, emeraldHelixMat);
      n1.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      const n2 = new THREE.Mesh(nodeGeo, cobaltHelixMat);
      n2.position.set(-Math.cos(a) * r, y, -Math.sin(a) * r);
      const rung = new THREE.Mesh(rungGeo, shared.brassMetal);
      rung.position.set(0, y, 0);
      rung.rotation.z = Math.PI / 2;
      rung.rotation.y = -a;
      helixGroup.add(n1, n2, rung);
    }
    const helixCrown = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      shared.brassMetal
    );
    helixCrown.position.y = 1.56;
    helixGroup.add(helixCrown);
    group.add(helixGroup);
    spinnersY.push(helixGroup);

    // Side calibration coolant tanks with copper feed pipes & brass gauge caps
    for (const tz of [-0.6, 0.25]) {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 1.25, 14),
        shared.sageTrim
      );
      tank.position.set(1.98, 0.88, tz);
      tank.castShadow = true;
      const tankCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.08, 14),
        shared.brassMetal
      );
      tankCap.position.set(1.98, 1.52, tz);
      const feedPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.42, 8),
        shared.brassMetal
      );
      feedPipe.rotation.z = Math.PI / 2;
      feedPipe.position.set(1.78, 1.12, tz);
      group.add(tank, tankCap, feedPipe);
    }

    const snowCap = new THREE.Mesh(
      new THREE.BoxGeometry(3.38, 0.16, 2.6),
      shared.snowCapMat
    );
    snowCap.position.set(0, 3.12, -0.15);
    snowCap.visible = false;
    group.add(snowCap);
    snowMeshes.push(snowCap);
  } else if (def.variant === 'solar_atelier') {
    // ST-02: Ochre-cream & Timber Solar Code Atelier
    const stucco = new THREE.MeshStandardMaterial({
      color: '#F4E5C8',
      roughness: 0.82,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.2, 2.6), stucco);
    body.position.set(0, 1.32, -0.18);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(3.86, 0.24, 3.0),
      shared.slateRoof
    );
    roof.position.set(0, 2.58, -0.18);
    roof.rotation.x = 0.12;
    roof.castShadow = true;
    group.add(roof);

    const snowRoof = new THREE.Mesh(
      new THREE.BoxGeometry(3.9, 0.16, 3.04),
      shared.snowCapMat
    );
    snowRoof.position.set(0, 2.74, -0.18);
    snowRoof.rotation.x = 0.12;
    snowRoof.visible = false;
    group.add(snowRoof);
    snowMeshes.push(snowRoof);

    // Twin tilted rooftop solar arrays
    for (const sx of [-0.95, 0.95]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(1.42, 0.08, 1.05),
        solarMat
      );
      panel.position.set(sx, 3.0, -0.22);
      panel.rotation.x = 0.42;
      panel.castShadow = true;
      group.add(panel);
    }

    // Copper exhaust vents & framed glowing atelier windows
    for (const wx of [-1.05, 0, 1.05]) {
      addFramedWindow(wx, 1.38, 1.14, 0.64, 1.04);
    }
    const gear = createGearMesh(0.32, 0.23, 0.1, 9, shared.brassMetal);
    gear.position.set(1.82, 1.25, 0.4);
    gear.rotation.y = Math.PI / 2;
    group.add(gear);
    gears.push(gear);
  } else if (def.variant === 'sage_pavilion') {
    // ST-04 (GATE): Ceremonial Preview Approval Gatehouse with Portico, Seal Dormer, SE Boom Gate & East Arched Loading Bay
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.3, 2.25, 2.7),
      shared.creamStone
    );
    body.position.set(0, 1.34, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const dado = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.34, 2.82), plinthMat);
    dado.position.set(0, 0.39, 0);
    group.add(dado);

    const cornice = new THREE.Mesh(
      new THREE.BoxGeometry(3.56, 0.14, 2.94),
      shared.warmSandstone
    );
    cornice.position.set(0, 2.5, 0);
    group.add(cornice);

    const roofGeo = new THREE.ConeGeometry(2.62, 1.44, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, shared.sageTrim);
    roof.scale.set(1.06, 1, 0.92);
    roof.position.set(0, 3.24, 0);
    roof.castShadow = true;
    group.add(roof);

    // Brass ridge finial crowning the sage pavilion
    const finialStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.11, 0.34, 10),
      shared.brassMetal
    );
    finialStem.position.set(0, 4.04, 0);
    const finialOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 10),
      shared.brassMetal
    );
    finialOrb.position.set(0, 4.24, 0);
    group.add(finialStem, finialOrb);

    const snowRoof = new THREE.Mesh(roofGeo, shared.snowCapMat);
    snowRoof.scale.set(1.08, 0.96, 0.95);
    snowRoof.position.set(0, 3.32, 0);
    snowRoof.visible = false;
    group.add(snowRoof);
    snowMeshes.push(snowRoof);

    // East Arched Stone & Brass Gatehouse Loading Bay (flush at x = +2.15, z = 0)
    addEastLoadingArchway(1.65, shared.creamStone, shared.sageTrim);

    // GATE Signature Feature 1: Ceremonial Entry Portico with Twin Fluted Columns & Hanging Amber Lanterns
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(2.62, 0.12, 0.82),
      shared.terracottaRoof
    );
    awning.position.set(0, 2.08, 1.66);
    awning.rotation.x = 0.24;
    awning.castShadow = true;
    group.add(awning);

    for (const cx of [-1.06, 1.06]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 1.72, 12),
        shared.creamStone
      );
      col.position.set(cx, 1.1, 1.9);
      col.castShadow = true;
      const colBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.16, 0.32),
        shared.warmSandstone
      );
      colBase.position.set(cx, 0.32, 1.9);
      const colCap = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.12, 0.28),
        shared.brassMetal
      );
      colCap.position.set(cx, 1.96, 1.9);
      group.add(col, colBase, colCap);
    }

    const lanternMat = new THREE.MeshStandardMaterial({
      color: '#FDE68A',
      emissive: '#D97706',
      emissiveIntensity: 0.72,
      roughness: 0.25,
    });
    for (const lx of [-0.66, 0.66]) {
      const lantern = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.06, 0.2, 8),
        lanternMat
      );
      lantern.position.set(lx, 1.84, 1.74);
      group.add(lantern);
    }

    // GATE Signature Feature 2: Sculpted Vertical Dormer Pediment + Golden Approval Wax-Seal Crest
    const dormerGroup = new THREE.Group();
    dormerGroup.position.set(0, 3.12, 1.12);
    const dormerBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.08, 0.86, 0.64),
      shared.creamStone
    );
    dormerBody.castShadow = true;
    const dormerCapGeo = new THREE.ConeGeometry(0.86, 0.44, 4);
    dormerCapGeo.rotateY(Math.PI / 4);
    const dormerCap = new THREE.Mesh(dormerCapGeo, shared.sageTrim);
    dormerCap.scale.set(1.04, 1, 0.72);
    dormerCap.position.set(0, 0.62, -0.02);
    dormerGroup.add(dormerBody, dormerCap);

    const sealGroup = new THREE.Group();
    sealGroup.position.set(0, 0.02, 0.36);
    const sealBacking = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.41, 0.1, 20),
      shared.brassMetal
    );
    sealBacking.rotation.x = Math.PI / 2;
    const sealCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.12, 20),
      new THREE.MeshStandardMaterial({
        color: '#059669',
        emissive: '#047857',
        emissiveIntensity: 0.35,
        roughness: 0.3,
      })
    );
    sealCore.rotation.x = Math.PI / 2;
    const checkShort = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.05, 0.04),
      shared.creamStone
    );
    checkShort.position.set(-0.065, -0.015, 0.075);
    checkShort.rotation.z = -0.78;
    const checkLong = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.05, 0.04),
      shared.creamStone
    );
    checkLong.position.set(0.055, 0.025, 0.075);
    checkLong.rotation.z = 0.78;
    sealGroup.add(sealBacking, sealCore, checkShort, checkLong);
    dormerGroup.add(sealGroup);
    group.add(dormerGroup);

    // GATE Signature Feature 3: Striped Mechanical Approval Barrier Boom Gate cleanly at SE patio corner
    const gatePostGroup = new THREE.Group();
    gatePostGroup.position.set(2.04, 0.24, 1.56);
    const gateStanchion = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.88, 0.28),
      shared.slateRoof
    );
    gateStanchion.position.y = 0.44;
    gateStanchion.castShadow = true;
    const gateCapLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 10),
      new THREE.MeshStandardMaterial({
        color: '#34D399',
        emissive: '#059669',
        emissiveIntensity: 0.75,
        roughness: 0.25,
      })
    );
    gateCapLight.position.y = 0.94;
    const boomPivot = new THREE.Group();
    boomPivot.position.set(0, 0.72, 0);
    boomPivot.rotation.z = 0.52;
    const boomArm = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.08, 0.08),
      shared.creamStone
    );
    boomArm.position.x = 0.54;
    boomPivot.add(boomArm);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#D97706',
      roughness: 0.4,
    });
    for (const sx of [0.22, 0.54, 0.86]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.09, 0.09),
        stripeMat
      );
      stripe.position.x = sx;
      boomPivot.add(stripe);
    }
    gateBoomPivot = boomPivot;
    gatePostGroup.add(gateStanchion, gateCapLight, boomPivot);
    group.add(gatePostGroup);

    for (const wx of [-0.84, 0.84]) {
      addFramedWindow(wx, 1.38, 1.38, 0.68, 0.96, true);
    }

    // Department Doorplate (门牌) mounted cleanly on ceremonial portico fascia
    const gateDoorplate = createDepartmentDoorplate(
      def.departmentBadge,
      def.name,
      def.accentColor,
      shared.brassMetal
    );
    gateDoorplate.position.set(0, 2.22, 2.12);
    group.add(gateDoorplate);
  } else if (def.variant === 'archive_villa') {
    // ST-05 (ARCHIVE): Two-Tier Terracotta Archive Vault Villa with Circular Brass Vault Door, Skylight & East Vault Loading Bay
    const mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 2.6, 2.6),
      shared.creamStone
    );
    mainBody.position.set(-0.42, 1.52, 0);
    mainBody.castShadow = true;
    mainBody.receiveShadow = true;
    group.add(mainBody);

    const dadoMain = new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.36, 2.72), plinthMat);
    dadoMain.position.set(-0.42, 0.4, 0);
    group.add(dadoMain);

    const sideWing = new THREE.Mesh(
      new THREE.BoxGeometry(1.32, 1.82, 2.12),
      brickMat
    );
    sideWing.position.set(1.12, 1.12, 0);
    sideWing.castShadow = true;
    sideWing.receiveShadow = true;
    group.add(sideWing);

    const wingCornice = new THREE.Mesh(
      new THREE.BoxGeometry(1.44, 0.12, 2.24),
      shared.warmSandstone
    );
    wingCornice.position.set(1.12, 2.06, 0);
    group.add(wingCornice);

    const mainCornice = new THREE.Mesh(
      new THREE.BoxGeometry(2.84, 0.14, 2.84),
      shared.warmSandstone
    );
    mainCornice.position.set(-0.42, 2.86, 0);
    group.add(mainCornice);

    const roofMainGeo = new THREE.ConeGeometry(2.12, 1.3, 4);
    roofMainGeo.rotateY(Math.PI / 4);
    const roofMain = new THREE.Mesh(roofMainGeo, shared.terracottaRoof);
    roofMain.position.set(-0.42, 3.56, 0);
    roofMain.castShadow = true;
    group.add(roofMain);

    const vaultFinial = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      shared.brassMetal
    );
    vaultFinial.position.set(-0.42, 4.26, 0);
    group.add(vaultFinial);

    const snowRoof = new THREE.Mesh(roofMainGeo, shared.snowCapMat);
    snowRoof.scale.set(1.03, 0.96, 1.03);
    snowRoof.position.set(-0.42, 3.64, 0);
    snowRoof.visible = false;
    group.add(snowRoof);
    snowMeshes.push(snowRoof);

    // East Arched Vault Loading Bay on sideWing East face (flush at x = +2.15, z = 0)
    addEastLoadingArchway(1.78, brickMat, shared.terracottaRoof);

    // ARCHIVE Signature Feature 1: Heavy Circular Burnished-Brass Vault Door + Spoked Locking Wheel
    const vaultDoorGroup = new THREE.Group();
    vaultDoorGroup.position.set(-0.42, 0.96, 1.32);
    const vaultFrame = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.085, 10, 24),
      shared.slateRoof
    );
    const vaultDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.52, 0.1, 24),
      shared.brassMetal
    );
    vaultDisc.rotation.x = Math.PI / 2;
    const vaultWheelGroup = new THREE.Group();
    vaultWheelGroup.position.z = 0.08;
    const wheelRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.032, 8, 18),
      shared.darkIron
    );
    vaultWheelGroup.add(wheelRim);
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.036, 0.036),
        shared.darkIron
      );
      spoke.rotation.z = (s * Math.PI) / 3;
      vaultWheelGroup.add(spoke);
    }
    const wheelHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12),
      shared.brassMetal
    );
    wheelHub.rotation.x = Math.PI / 2;
    wheelHub.position.z = 0.01;
    vaultWheelGroup.add(wheelHub);
    archiveVaultWheel = vaultWheelGroup;
    vaultDoorGroup.add(vaultFrame, vaultDisc, vaultWheelGroup);
    group.add(vaultDoorGroup);

    // Classical twin archive pilasters cleanly seated above dadoMain (y=0.585..2.785, zero z-fighting)
    for (const px of [-1.22, 0.38]) {
      const pilaster = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 2.2, 0.24),
        shared.warmSandstone
      );
      pilaster.position.set(px, 1.685, 1.34);
      group.add(pilaster);
    }

    // Department Doorplate (门牌) mounted cleanly on front main archive cornice frieze
    const archiveDoorplate = createDepartmentDoorplate(
      def.departmentBadge,
      def.name,
      def.accentColor,
      shared.brassMetal
    );
    archiveDoorplate.position.set(-0.42, 2.86, 1.54);
    group.add(archiveDoorplate);

    // ARCHIVE Signature Feature 2: Illuminated Glass Skylight Lantern on brick side wing roof
    const skylightBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 0.22, 1.34),
      shared.creamStone
    );
    skylightBase.position.set(1.12, 2.22, 0);
    const skylightGlass = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 0.56, 4),
      shared.glassDomeMat
    );
    skylightGlass.rotation.y = Math.PI / 4;
    skylightGlass.position.set(1.12, 2.6, 0);
    const skylightGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.64, 0.24, 0.84),
      new THREE.MeshStandardMaterial({
        color: '#BAE6FD',
        emissive: '#0284C7',
        emissiveIntensity: 0.45,
        roughness: 0.25,
      })
    );
    skylightGlow.position.set(1.12, 2.38, 0);
    group.add(skylightBase, skylightGlass, skylightGlow);

    // ARCHIVE Signature Feature 3: Stacked Miniature Brass-Bound Ledger Tomes on front-right patio
    const ledgerColors = ['#0369A1', '#0284C7', '#1E3A8A'];
    for (let b = 0; b < 3; b++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.56 - b * 0.05, 0.14, 0.4 - b * 0.03),
        new THREE.MeshStandardMaterial({
          color: ledgerColors[b],
          roughness: 0.45,
        })
      );
      book.position.set(1.36, 0.31 + b * 0.145, 1.54);
      book.rotation.y = (b - 1) * 0.18;
      book.castShadow = true;
      group.add(book);
    }

    addFramedWindow(-0.84, 2.04, 1.32, 0.54, 0.62, false);
    addFramedWindow(0.0, 2.04, 1.32, 0.54, 0.62, false);
  } else {
    // BG-OPS (OPS): Standalone Aerospace Telemetry Observatory Pavilion (NO conveyor — independent background monitor!)
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.2, 2.5),
      shared.warmSandstone
    );
    body.position.set(0, 1.32, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const dado = new THREE.Mesh(new THREE.BoxGeometry(3.32, 0.34, 2.62), plinthMat);
    dado.position.set(0, 0.39, 0);
    group.add(dado);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(3.52, 0.26, 2.82),
      shared.slateRoof
    );
    roof.position.set(0, 2.54, 0);
    roof.castShadow = true;
    group.add(roof);

    // Crisp miniature rooftop perimeter parapet rail
    for (const rz of [-1.32, 1.32]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.36, 0.08, 0.06), shared.creamStone);
      rail.position.set(0, 2.82, rz);
      group.add(rail);
    }
    for (const rx of [-1.66, 1.66]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 2.66), shared.creamStone);
      rail.position.set(rx, 2.82, 0);
      group.add(rail);
    }

    const snowRoof = new THREE.Mesh(
      new THREE.BoxGeometry(3.56, 0.16, 2.86),
      shared.snowCapMat
    );
    snowRoof.position.set(0, 2.72, 0);
    snowRoof.visible = false;
    group.add(snowRoof);
    snowMeshes.push(snowRoof);

    const solar = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.08, 0.96), solarMat);
    solar.position.set(-0.68, 2.94, 0);
    solar.rotation.x = 0.35;
    group.add(solar);

    // OPS Signature Feature 1: Raised Equipment Plinth + Rotating Aerospace Radar Telemetry Array
    const radarPlinth = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.34, 0.98),
      shared.creamStone
    );
    radarPlinth.position.set(0.88, 2.84, -0.14);
    radarPlinth.castShadow = true;
    group.add(radarPlinth);

    const radarSpinGroup = new THREE.Group();
    radarSpinGroup.position.set(0.88, 3.02, -0.14);
    const radarMast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.1, 0.98, 10),
      shared.darkIron
    );
    radarMast.position.y = 0.49;
    const radarCrossbar = new THREE.Mesh(
      new THREE.BoxGeometry(1.22, 0.14, 0.12),
      shared.creamStone
    );
    radarCrossbar.position.y = 0.9;
    const radarSubDish = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.44),
      shared.brassMetal
    );
    radarSubDish.rotation.x = Math.PI * 0.58;
    radarSubDish.position.set(0, 0.9, 0.18);
    const beaconBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 10),
      new THREE.MeshStandardMaterial({
        color: '#60A5FA',
        emissive: '#2563EB',
        emissiveIntensity: 0.95,
        roughness: 0.18,
      })
    );
    beaconBulb.position.y = 1.18;
    radarSpinGroup.add(radarMast, radarCrossbar, radarSubDish, beaconBulb);
    group.add(radarSpinGroup);
    spinnersY.push(radarSpinGroup);
    opsRadarGroup = radarSpinGroup;

    // OPS Signature Feature 2: Exterior Mini Server Rack Louver Bay + Glowing Tri-Color LED Telemetry Strip
    const rackBay = new THREE.Mesh(
      new THREE.BoxGeometry(0.76, 1.2, 0.14),
      shared.slateRoof
    );
    rackBay.position.set(0, 1.24, 1.26);
    group.add(rackBay);
    const ledSpecs: Array<{ y: number; color: string }> = [
      { y: 1.62, color: '#10B981' },
      { y: 1.44, color: '#3B82F6' },
      { y: 1.26, color: '#F59E0B' },
      { y: 1.08, color: '#10B981' },
    ];
    for (const spec of ledSpecs) {
      const louver = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.04, 0.06),
        shared.creamStone
      );
      louver.position.set(-0.06, spec.y, 1.33);
      const ledMat = new THREE.MeshStandardMaterial({
        color: spec.color,
        emissive: spec.color,
        emissiveIntensity: 0.95,
        roughness: 0.2,
      });
      opsLedMaterials.push(ledMat);
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.06, 0.07),
        ledMat
      );
      led.position.set(0.26, spec.y, 1.34);
      group.add(louver, led);
    }

    // Circular brass load barometer dial above the server bay
    const dialBezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 8, 18),
      shared.brassMetal
    );
    dialBezel.position.set(0, 2.08, 1.28);
    const dialFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 18),
      new THREE.MeshStandardMaterial({
        map: textures.clockFace,
        roughness: 0.32,
      })
    );
    dialFace.position.set(0, 2.08, 1.29);
    group.add(dialBezel, dialFace);

    // Extra potted boxwood on east side of standalone OPS pavilion
    addPottedTopiary(2.22, 1.72);
    addPottedTopiary(2.22, -1.72);

    for (const wx of [-0.98, 0.98]) {
      addFramedWindow(wx, 1.4, 1.27, 0.62, 0.88, true);
    }

    // Department Doorplate (门牌) mounted cleanly proud of front South slate cornice parapet
    const opsDoorplate = createDepartmentDoorplate(
      def.departmentBadge,
      def.name,
      def.accentColor,
      shared.brassMetal
    );
    opsDoorplate.position.set(0, 2.68, 1.64);
    group.add(opsDoorplate);
    for (const bx of [-0.66, 0.66]) {
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.34),
        shared.brassMetal
      );
      bracket.position.set(bx, 2.56, 1.48);
      group.add(bracket);
    }
  }

  const hoverRing = createHoverRing(3.25, def.accentColor);
  group.add(hoverRing);

  const hitbox = createHitbox(def.id, def.stationId, 5.4, 4.4, 4.5, 2.1);
  group.add(hitbox);

  return {
    group,
    hitbox,
    hoverRing,
    satelliteDish,
    gears,
    spinnersY,
    snowMeshes,
    gateBoomPivot,
    archiveVaultWheel,
    opsRadarGroup,
    specBlueprintMat,
    opsLedMaterials,
  };
}

/**
 * Builds one of the East Twin AI Sanctuary Plazas:
 *  - Upper-Right ('coder'): Gemini Celestial Sparkle Sanctuary (sculpted 4-pointed
 *    iridescent Gemini star mascot + orbiting companion sparkles + sapphire-gold rose wheel)
 *  - Lower-Right ('cloud'): QA & RSI Crystal Sanctuary (luminous ">_" cloud mascot + emerald wheel)
 */
function buildAiSanctuary(
  kind: 'coder' | 'cloud',
  position: { x: number; y: number; z: number },
  textures: ProceduralTextureBundle,
  shared: {
    creamStone: THREE.MeshStandardMaterial;
    warmSandstone: THREE.MeshStandardMaterial;
    brassMetal: THREE.MeshStandardMaterial;
    lampBulbMat: THREE.MeshStandardMaterial;
  }
): {
  group: THREE.Group;
  armillaryOuter: THREE.Object3D;
  armillaryInner: THREE.Object3D;
  mascot: THREE.Object3D;
  mascotOrbit: THREE.Object3D | null;
  sparkles: THREE.Points;
  wheelMat: THREE.MeshStandardMaterial;
  hitbox: THREE.Mesh;
  hoverRing: THREE.Mesh;
} {
  const isCoder = kind === 'coder';
  const buildingId: VillageBuildingId = isCoder ? 'AI-CODER' : 'AI-CLOUD';
  const stationId: FactoryStationId = isCoder ? 'ST-02' : 'ST-03';
  const accentHex = isCoder ? '#3B82F6' : '#0D9488';

  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.add(makeContactShadow(textures, 5.9));

  // Outer stone rim enclosing water moat
  const outerRim = new THREE.Mesh(
    new THREE.TorusGeometry(5.15, 0.28, 12, 48),
    shared.creamStone
  );
  outerRim.rotation.x = Math.PI / 2;
  outerRim.position.y = 0.2;
  outerRim.receiveShadow = true;
  group.add(outerRim);

  // Shimmering turquoise / emerald-aqua water moat disc
  const moatWater = new THREE.Mesh(
    new THREE.CylinderGeometry(5.05, 5.05, 0.14, 48),
    new THREE.MeshPhysicalMaterial({
      color: isCoder ? '#5BC0EB' : '#4ECDC4',
      roughness: 0.12,
      metalness: 0.08,
      clearcoat: 0.95,
      clearcoatRoughness: 0.1,
    })
  );
  moatWater.position.y = 0.095;
  group.add(moatWater);

  // Floating lily pads around the moat (skipping west conveyor bridge zone)
  const lilyMat = new THREE.MeshStandardMaterial({
    color: '#4CA754',
    roughness: 0.65,
  });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (isCoder ? 0.2 : 0.6);
    if (Math.cos(a) < -0.68) continue;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.32,
        0.32,
        0.03,
        12,
        1,
        false,
        0.3,
        Math.PI * 1.8
      ),
      lilyMat
    );
    pad.position.set(Math.cos(a) * 4.35, 0.18, Math.sin(a) * 4.35);
    pad.rotation.y = a;
    group.add(pad);
  }

  // Concentric stepped cream-marble center island
  const islandStep1 = new THREE.Mesh(
    new THREE.CylinderGeometry(3.65, 3.85, 0.3, 40),
    shared.warmSandstone
  );
  islandStep1.position.y = 0.2;
  islandStep1.receiveShadow = true;
  group.add(islandStep1);

  const islandStep2 = new THREE.Mesh(
    new THREE.CylinderGeometry(3.15, 3.3, 0.22, 40),
    new THREE.MeshStandardMaterial({
      map: textures.courtyardTiles,
      bumpMap: textures.tileBump,
      bumpScale: 0.02,
      roughness: 0.78,
    })
  );
  islandStep2.position.y = 0.44;
  islandStep2.receiveShadow = true;
  group.add(islandStep2);

  // Stone arrival threshold pad & brass bollards facing incoming conveyor bridge
  const arrivalAngle = isCoder ? Math.PI - 0.32 : Math.PI + 0.32;
  const arrivalPad = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.22, 1.65),
    shared.warmSandstone
  );
  arrivalPad.position.set(
    Math.cos(arrivalAngle) * 3.55,
    0.45,
    Math.sin(arrivalAngle) * 3.55
  );
  arrivalPad.rotation.y = -arrivalAngle;
  arrivalPad.receiveShadow = true;
  group.add(arrivalPad);

  for (const side of [-0.62, 0.62]) {
    const bollard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.44, 10),
      shared.brassMetal
    );
    const perp = arrivalAngle + Math.PI / 2;
    bollard.position.set(
      Math.cos(arrivalAngle) * 3.8 + Math.cos(perp) * side,
      0.72,
      Math.sin(arrivalAngle) * 3.8 + Math.sin(perp) * side
    );
    group.add(bollard);
  }

  // Classical colonnade lamp pillars circling the outer moat rim (wide clean opening for bridge)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (Math.cos(a) < -0.58) continue;
    const pillar = new THREE.Group();
    pillar.position.set(Math.cos(a) * 5.15, 0.24, Math.sin(a) * 5.15);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 1.35, 10),
      shared.creamStone
    );
    shaft.position.y = 0.68;
    shaft.castShadow = true;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.18, 0.14, 10),
      shared.warmSandstone
    );
    cap.position.y = 1.4;
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 12),
      shared.lampBulbMat
    );
    orb.position.y = 1.62;
    pillar.add(shaft, cap, orb);
    group.add(pillar);
  }

  // Grand Curved Stone Archway + Luminous Circular Stained-Glass Astronomical Wheel
  const archGroup = new THREE.Group();
  archGroup.position.set(1.45, 0.52, -0.65);
  archGroup.rotation.y = -Math.PI * 0.36;

  const wheelRadius = 2.15;
  const stoneArch = new THREE.Mesh(
    new THREE.TorusGeometry(wheelRadius + 0.24, 0.28, 12, 36, Math.PI * 1.15),
    shared.creamStone
  );
  stoneArch.position.y = 2.05;
  stoneArch.rotation.z = -Math.PI * 0.075;
  stoneArch.castShadow = true;
  archGroup.add(stoneArch);

  for (const px of [-(wheelRadius + 0.24), wheelRadius + 0.24]) {
    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 2.25, 0.62),
      shared.creamStone
    );
    pier.position.set(px, 1.05, 0);
    pier.castShadow = true;
    archGroup.add(pier);
  }

  const wheelMat = new THREE.MeshStandardMaterial({
    map: isCoder ? textures.stainedGlassGemini : textures.stainedGlassBlue,
    emissive: isCoder ? '#4F86F7' : '#2DD4BF',
    emissiveMap: isCoder
      ? textures.stainedGlassGemini
      : textures.stainedGlassBlue,
    emissiveIntensity: 0.48,
    roughness: 0.2,
    metalness: 0.16,
    side: THREE.DoubleSide,
  });
  const stainedWheel = new THREE.Mesh(
    new THREE.CircleGeometry(wheelRadius, 36),
    wheelMat
  );
  stainedWheel.position.y = 2.15;
  archGroup.add(stainedWheel);

  const goldWheelRim = new THREE.Mesh(
    new THREE.TorusGeometry(wheelRadius, 0.08, 10, 40),
    shared.brassMetal
  );
  goldWheelRim.position.y = 2.15;
  archGroup.add(goldWheelRim);
  group.add(archGroup);

  // Overhead Dual-Ring Spinning Golden Armillary Sphere Halo
  const armillaryCenterY = 5.05;
  const armillaryOuter = new THREE.Group();
  armillaryOuter.position.set(0, armillaryCenterY, 0);
  const ringA = new THREE.Mesh(
    new THREE.TorusGeometry(1.18, 0.055, 10, 36),
    shared.brassMetal
  );
  const ringB = new THREE.Mesh(
    new THREE.TorusGeometry(1.18, 0.045, 10, 36),
    shared.brassMetal
  );
  ringB.rotation.x = Math.PI / 2;
  armillaryOuter.add(ringA, ringB);
  group.add(armillaryOuter);

  const armillaryInner = new THREE.Group();
  armillaryInner.position.set(0, armillaryCenterY, 0);
  const ringC = new THREE.Mesh(
    new THREE.TorusGeometry(0.76, 0.048, 10, 30),
    shared.brassMetal
  );
  ringC.rotation.y = Math.PI / 3;
  const coreOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 16, 16),
    new THREE.MeshStandardMaterial({
      color: isCoder ? '#E0F2FE' : '#CCFBF1',
      emissive: isCoder ? '#38BDF8' : '#14B8A6',
      emissiveIntensity: 1.4,
      roughness: 0.15,
    })
  );
  armillaryInner.add(ringC, coreOrb);
  group.add(armillaryInner);

  // Rising Celestial Sparkle Particle Stream
  const sparkCount = 26;
  const sparkPositions = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i++) {
    const a = (i / sparkCount) * Math.PI * 2;
    const r = 0.55 + (i % 5) * 0.28;
    sparkPositions[i * 3] = Math.cos(a) * r;
    sparkPositions[i * 3 + 1] = 0.9 + (i / sparkCount) * 4.1;
    sparkPositions[i * 3 + 2] = Math.sin(a) * r;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(sparkPositions, 3)
  );
  const sparkMat = new THREE.PointsMaterial({
    color: isCoder ? '#93C5FD' : '#5EEAD4',
    size: 0.22,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const sparkles = new THREE.Points(sparkGeo, sparkMat);
  group.add(sparkles);

  // HERO AI MASCOT
  const mascot = new THREE.Group();
  mascot.position.set(-0.2, 0.55, 0.2);
  mascot.rotation.y = -Math.PI * 0.35;
  let mascotOrbit: THREE.Object3D | null = null;

  // Stepped alabaster & brushed-brass pedestal beneath BOTH sanctuary mascots
  const plinthBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 1.08, 0.24, 24),
    shared.creamStone
  );
  plinthBase.position.set(-0.2, 0.64, 0.2);
  plinthBase.castShadow = true;
  plinthBase.receiveShadow = true;
  const plinthStep = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 0.82, 0.16, 24),
    shared.warmSandstone
  );
  plinthStep.position.set(-0.2, 0.82, 0.2);
  plinthStep.castShadow = true;
  const plinthRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.76, 0.048, 8, 28),
    shared.brassMetal
  );
  plinthRing.rotation.x = Math.PI / 2;
  plinthRing.position.set(-0.2, 0.91, 0.2);
  const plinthGlowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 24),
    new THREE.MeshBasicMaterial({
      color: isCoder ? '#93C5FD' : '#6EE7B7',
      transparent: true,
      opacity: 0.45,
    })
  );
  plinthGlowDisc.rotation.x = -Math.PI / 2;
  plinthGlowDisc.position.set(-0.2, 0.915, 0.2);
  group.add(plinthBase, plinthStep, plinthRing, plinthGlowDisc);

  if (isCoder) {
    // HERO MASCOT (AI-CODER): Sculpted 3D Google Antigravity Logo Emblem with 4-Color Iridescent Gradient
    const agyTex = createAntigravityGradientTexture();
    const agyMat = new THREE.MeshPhysicalMaterial({
      map: agyTex,
      emissive: '#3B82F6',
      emissiveMap: agyTex,
      emissiveIntensity: 0.34,
      roughness: 0.12,
      metalness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    });

    const agyShape = createAntigravityLogoShape(1.12);
    const agyGeo = new THREE.ExtrudeGeometry(agyShape, {
      depth: 0.26,
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.1,
      bevelSegments: 6,
    });
    agyGeo.center();
    normalizeExtrudePlanarUVs(agyGeo);

    const agyMesh = new THREE.Mesh(agyGeo, agyMat);
    agyMesh.position.y = 1.68;
    agyMesh.castShadow = true;
    mascot.add(agyMesh);

    // Subtle luminous pearl-white inner rim highlight crowning the Antigravity arch
    const agyHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1.18, 0.032, 8, 44),
      shared.brassMetal
    );
    agyHalo.position.y = 1.66;
    agyHalo.rotation.x = Math.PI * 0.38;
    agyHalo.rotation.y = -Math.PI * 0.16;
    mascot.add(agyHalo);

    // Orbiting companion Antigravity floating multi-color energy orbs
    const orbitGroup = new THREE.Group();
    orbitGroup.position.y = 1.7;

    const orbBlue = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 14),
      new THREE.MeshPhysicalMaterial({
        color: '#3186FF',
        emissive: '#2563EB',
        emissiveIntensity: 0.65,
        roughness: 0.14,
        clearcoat: 1.0,
      })
    );
    orbBlue.position.set(1.22, 0.32, 0.44);
    orbBlue.castShadow = true;

    const orbGold = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 14),
      new THREE.MeshPhysicalMaterial({
        color: '#FFE432',
        emissive: '#F59E0B',
        emissiveIntensity: 0.65,
        roughness: 0.16,
        clearcoat: 0.95,
      })
    );
    orbGold.position.set(-1.14, -0.24, -0.48);
    orbGold.castShadow = true;

    const orbCoral = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshPhysicalMaterial({
        color: '#FC413D',
        emissive: '#EF4444',
        emissiveIntensity: 0.55,
        roughness: 0.16,
        clearcoat: 0.95,
      })
    );
    orbCoral.position.set(0.18, 0.98, -0.78);

    orbitGroup.add(orbBlue, orbGold, orbCoral);
    mascot.add(orbitGroup);
    mascotOrbit = orbitGroup;
  } else {
    // HERO MASCOT (AI-CLOUD / 质检进化圣殿): Sculpted 3D Gemini Four-Pointed Iridescent Crystal Sparkle Star
    const geminiCrystalMat = new THREE.MeshPhysicalMaterial({
      color: '#4F86F7',
      emissive: '#3B82F6',
      emissiveIntensity: 0.48,
      roughness: 0.1,
      metalness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    const geminiVioletMat = new THREE.MeshPhysicalMaterial({
      color: '#8B5CF6',
      emissive: '#7C3AED',
      emissiveIntensity: 0.42,
      roughness: 0.14,
      metalness: 0.25,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.86,
    });
    const geminiCoreMat = new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      emissive: '#38BDF8',
      emissiveIntensity: 1.15,
      roughness: 0.12,
      metalness: 0.15,
    });

    const starShape = createGeminiStarShape(1.18, 0.24);
    const starGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.24,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.12,
      bevelSegments: 6,
    });
    starGeo.center();
    const starMesh = new THREE.Mesh(starGeo, geminiCrystalMat);
    starMesh.position.y = 1.65;
    starMesh.castShadow = true;
    mascot.add(starMesh);

    // Secondary crossed iridescent violet-indigo diamond accent (45° faceted flare)
    const accentStarShape = createGeminiStarShape(0.76, 0.16);
    const accentGeo = new THREE.ExtrudeGeometry(accentStarShape, {
      depth: 0.28,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.08,
      bevelSegments: 4,
    });
    accentGeo.center();
    const accentMesh = new THREE.Mesh(accentGeo, geminiVioletMat);
    accentMesh.position.y = 1.65;
    accentMesh.rotation.z = Math.PI / 4;
    mascot.add(accentMesh);

    // Luminous inner faceted Gemini star core
    const innerStarShape = createGeminiStarShape(0.56, 0.12);
    const innerGeo = new THREE.ExtrudeGeometry(innerStarShape, {
      depth: 0.38,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.07,
      bevelSegments: 4,
    });
    innerGeo.center();
    const innerMesh = new THREE.Mesh(innerGeo, geminiCoreMat);
    innerMesh.position.y = 1.65;
    mascot.add(innerMesh);

    // Slender tilted brass orbital halo framing the Gemini star
    const starHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.032, 8, 40),
      shared.brassMetal
    );
    starHalo.position.y = 1.65;
    starHalo.rotation.x = Math.PI * 0.36;
    starHalo.rotation.y = Math.PI * 0.18;
    mascot.add(starHalo);

    // Orbiting companion mini Gemini sparkles (Warm Gold + Lavender-Violet)
    const orbitGroup = new THREE.Group();
    orbitGroup.position.y = 1.68;

    const miniShape = createGeminiStarShape(0.32, 0.07);
    const miniGeo = new THREE.ExtrudeGeometry(miniShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 3,
    });
    miniGeo.center();

    const goldSpark = new THREE.Mesh(
      miniGeo,
      new THREE.MeshPhysicalMaterial({
        color: '#FCD34D',
        emissive: '#F59E0B',
        emissiveIntensity: 0.65,
        roughness: 0.18,
        metalness: 0.45,
        clearcoat: 0.9,
      })
    );
    goldSpark.position.set(1.18, 0.38, 0.48);
    goldSpark.castShadow = true;

    const violetSpark = new THREE.Mesh(
      miniGeo,
      new THREE.MeshPhysicalMaterial({
        color: '#C4B5FD',
        emissive: '#7C3AED',
        emissiveIntensity: 0.6,
        roughness: 0.18,
        metalness: 0.3,
        clearcoat: 0.9,
      })
    );
    violetSpark.position.set(-1.12, -0.26, -0.52);
    violetSpark.scale.setScalar(0.82);
    violetSpark.castShadow = true;

    orbitGroup.add(goldSpark, violetSpark);
    mascot.add(orbitGroup);
    mascotOrbit = orbitGroup;
  }

  group.add(mascot);

  const hoverRing = createHoverRing(5.45, accentHex);
  group.add(hoverRing);

  const hitbox = createHitbox(buildingId, stationId, 9.6, 6.2, 9.6, 3.0);
  group.add(hitbox);

  return {
    group,
    armillaryOuter,
    armillaryInner,
    mascot,
    mascotOrbit,
    sparkles,
    wheelMat,
    hitbox,
    hoverRing,
  };
}

/**
 * Builds elevated curved ribbed rubber conveyor belts with dual metallic side rails
 * and grounded steel legs along each CatmullRomCurve3 track.
 */
function buildConveyorTracks(
  scene: THREE.Scene,
  textures: ProceduralTextureBundle,
  shared: {
    creamStone: THREE.MeshStandardMaterial;
    brassMetal: THREE.MeshStandardMaterial;
    darkIron: THREE.MeshStandardMaterial;
  }
): {
  trackCurves: Map<string, THREE.CatmullRomCurve3>;
  reworkRailMaterial: THREE.MeshStandardMaterial;
} {
  const trackCurves = new Map<string, THREE.CatmullRomCurve3>();
  const beltMat = new THREE.MeshStandardMaterial({
    map: textures.conveyorBelt,
    roughness: 0.78,
    metalness: 0.12,
  });

  const railMaterials = {
    cream: new THREE.MeshStandardMaterial({
      color: '#D8CFC0',
      roughness: 0.35,
      metalness: 0.45,
    }),
    amber: new THREE.MeshStandardMaterial({
      color: '#E59D54',
      emissive: '#B45309',
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.55,
    }),
    blue: new THREE.MeshStandardMaterial({
      color: '#7FA8F8',
      emissive: '#2563EB',
      emissiveIntensity: 0.2,
      roughness: 0.32,
      metalness: 0.55,
    }),
    rework: new THREE.MeshStandardMaterial({
      color: '#CBD5E1',
      emissive: '#DC2626',
      emissiveIntensity: 0.0,
      roughness: 0.35,
      metalness: 0.48,
    }),
  };

  const legGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.62, 8);
  const footGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.06, 8);

  const buildTrackRibbon = (track: ConveyorTrackDefinition) => {
    const pts = track.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.45);
    trackCurves.set(track.id, curve);

    const segments = 38;
    const beltHalfW = track.railAccent === 'rework' ? 0.32 : 0.42;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const leftRailPts: THREE.Vector3[] = [];
    const rightRailPts: THREE.Vector3[] = [];
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const side = new THREE.Vector3().crossVectors(up, tan).normalize();

      const left = pos.clone().addScaledVector(side, beltHalfW);
      const right = pos.clone().addScaledVector(side, -beltHalfW);

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, t * 4, 1, t * 4);

      if (i < segments) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }

      leftRailPts.push(
        pos.clone().addScaledVector(side, beltHalfW + 0.07).add(new THREE.Vector3(0, 0.06, 0))
      );
      rightRailPts.push(
        pos.clone().addScaledVector(side, -(beltHalfW + 0.07)).add(new THREE.Vector3(0, 0.06, 0))
      );

      // Periodic steel support legs grounded flush on y = 0
      if (i > 0 && i < segments && i % 9 === 0) {
        for (const offset of [beltHalfW * 0.82, -beltHalfW * 0.82]) {
          const legPos = pos.clone().addScaledVector(side, offset);
          const leg = new THREE.Mesh(legGeo, shared.darkIron);
          leg.position.set(legPos.x, 0.31, legPos.z);
          scene.add(leg);

          const foot = new THREE.Mesh(footGeo, shared.creamStone);
          foot.position.set(legPos.x, 0.03, legPos.z);
          scene.add(foot);
        }
      }
    }

    const beltGeo = new THREE.BufferGeometry();
    beltGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    beltGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    beltGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    beltGeo.setIndex(indices);

    const beltMesh = new THREE.Mesh(beltGeo, beltMat);
    beltMesh.receiveShadow = true;
    scene.add(beltMesh);

    // Side metallic guide rails via TubeGeometry
    const railMat = railMaterials[track.railAccent];
    const leftCurve = new THREE.CatmullRomCurve3(leftRailPts);
    const rightCurve = new THREE.CatmullRomCurve3(rightRailPts);
    const leftRail = new THREE.Mesh(
      new THREE.TubeGeometry(leftCurve, 32, 0.065, 6, false),
      railMat
    );
    const rightRail = new THREE.Mesh(
      new THREE.TubeGeometry(rightCurve, 32, 0.065, 6, false),
      railMat
    );
    leftRail.castShadow = true;
    rightRail.castShadow = true;
    scene.add(leftRail, rightRail);
  };

  for (const track of CONVEYOR_TRACKS) {
    buildTrackRibbon(track);
  }

  return {
    trackCurves,
    reworkRailMaterial: railMaterials.rework,
  };
}

/**
 * Builds a miniature brass-and-limestone Conveyor Transfer Junction Gatehouse
 * where branch conveyors dock cleanly into orthogonal walls and exit as a single trunk.
 */
function buildConveyorJunction(
  def: ConveyorJunctionDefinition,
  shared: {
    creamStone: THREE.MeshStandardMaterial;
    warmSandstone: THREE.MeshStandardMaterial;
    terracottaRoof: THREE.MeshStandardMaterial;
    brassMetal: THREE.MeshStandardMaterial;
    lampBulbMat: THREE.MeshStandardMaterial;
  }
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(def.position.x, 0, def.position.z);

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(1.96, 0.24, 1.96),
    shared.warmSandstone
  );
  plinth.position.y = 0.12;
  plinth.receiveShadow = true;
  group.add(plinth);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.66, 1.52, 1.66),
    shared.creamStone
  );
  body.position.y = 0.98;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Sculpted dark recessed arched tunnel openings on active sides
  const portDarkMat = new THREE.MeshStandardMaterial({
    color: '#1A2230',
    roughness: 0.92,
  });
  for (const side of def.ports) {
    const port = new THREE.Group();
    if (side === 'north') {
      port.position.set(0, 0.94, -0.84);
      port.rotation.y = Math.PI;
    } else if (side === 'south') {
      port.position.set(0, 0.94, 0.84);
    } else if (side === 'east') {
      port.position.set(0.84, 0.94, 0);
      port.rotation.y = Math.PI / 2;
    } else {
      port.position.set(-0.84, 0.94, 0);
      port.rotation.y = -Math.PI / 2;
    }
    const opening = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.92, 0.14), portDarkMat);
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(1.22, 0.14, 0.2),
      shared.warmSandstone
    );
    lintel.position.y = 0.5;
    const brassKey = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.18, 0.24),
      shared.brassMetal
    );
    brassKey.position.y = 0.52;
    port.add(opening, lintel, brassKey);
    group.add(port);
  }

  // Cornice + miniature pitched terracotta pavilion roof + brass lantern finial
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(1.88, 0.16, 1.88),
    shared.warmSandstone
  );
  cornice.position.y = 1.8;
  group.add(cornice);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.38, 0.72, 4),
    shared.terracottaRoof
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.24;
  roof.castShadow = true;
  group.add(roof);

  const lanternStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.18, 0.22, 8),
    shared.brassMetal
  );
  lanternStem.position.y = 2.66;
  const lanternBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 10),
    shared.lampBulbMat
  );
  lanternBulb.position.y = 2.82;
  group.add(lanternStem, lanternBulb);

  return group;
}

/**
 * Creates a pool of tactile cardboard workpiece parcels strapped with bright cross-ribbons
 * and a white barcode shipping label (matching video 00:07-00:20).
 */
function buildParcelPool(
  scene: THREE.Scene,
  textures: ProceduralTextureBundle,
  count: number
): Array<{ group: THREE.Group; ribbonMat: THREE.MeshStandardMaterial }> {
  const cardboardMat = new THREE.MeshStandardMaterial({
    color: '#D5A26B',
    roughness: 0.78,
    metalness: 0.02,
  });
  const labelMat = new THREE.MeshStandardMaterial({
    map: textures.parcelLabel,
    roughness: 0.65,
  });

  const pool: Array<{ group: THREE.Group; ribbonMat: THREE.MeshStandardMaterial }> = [];

  for (let i = 0; i < count; i++) {
    const group = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.64, 0.48, 0.64),
      cardboardMat
    );
    box.position.y = 0.24;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    const ribbonMat = new THREE.MeshStandardMaterial({
      color: '#F59E0B',
      roughness: 0.35,
      metalness: 0.1,
    });
    const strapA = new THREE.Mesh(
      new THREE.BoxGeometry(0.67, 0.5, 0.12),
      ribbonMat
    );
    strapA.position.y = 0.24;
    const strapB = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, 0.67),
      ribbonMat
    );
    strapB.position.y = 0.24;
    group.add(strapA, strapB);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.2),
      labelMat
    );
    label.position.set(0.14, 0.24, 0.326);
    group.add(label);

    group.visible = false;
    scene.add(group);
    pool.push({ group, ribbonMat });
  }

  return pool;
}

/**
 * Master village builder assembling ground, sandy cobblestone walkways, pond,
 * central glass rotunda, 6 workshop cottages, twin AI sanctuaries, elevated conveyors,
 * instanced lush trees + autumn accents + wildflowers, cast-iron streetlamps, distant hills,
 * and winter snow particle system.
 */
export function buildMiniatureVillage(
  scene: THREE.Scene,
  textures: ProceduralTextureBundle,
  isSoftwareGl: boolean
): AnimatedVillageHandles {
  const rand = createSeededRandom(20250621);

  const shared = {
    creamStone: new THREE.MeshStandardMaterial({
      color: '#F5EFE2',
      roughness: 0.78,
      metalness: 0.03,
    }),
    warmSandstone: new THREE.MeshStandardMaterial({
      color: '#E3D3BA',
      roughness: 0.84,
      metalness: 0.02,
    }),
    terracottaRoof: new THREE.MeshStandardMaterial({
      color: '#C86D4E',
      roughness: 0.72,
      metalness: 0.04,
    }),
    sageTrim: new THREE.MeshStandardMaterial({
      color: '#6C947C',
      roughness: 0.72,
      metalness: 0.06,
    }),
    slateRoof: new THREE.MeshStandardMaterial({
      color: '#516378',
      roughness: 0.65,
      metalness: 0.16,
    }),
    brassMetal: new THREE.MeshStandardMaterial({
      color: '#D7A84E',
      roughness: 0.26,
      metalness: 0.84,
    }),
    darkIron: new THREE.MeshStandardMaterial({
      color: '#343E4C',
      roughness: 0.45,
      metalness: 0.68,
    }),
    woodMat: new THREE.MeshStandardMaterial({
      color: '#A5754A',
      roughness: 0.84,
      metalness: 0.02,
    }),
    glassDomeMat: new THREE.MeshPhysicalMaterial({
      color: '#DFF3FF',
      roughness: 0.12,
      metalness: 0.06,
      transparent: true,
      opacity: isSoftwareGl ? 0.44 : 0.36,
      depthWrite: false,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    }),
    warmWindowMat: new THREE.MeshStandardMaterial({
      color: '#FFF6D8',
      emissive: '#FFBE55',
      emissiveIntensity: 0.22,
      roughness: 0.25,
    }),
    lampBulbMat: new THREE.MeshStandardMaterial({
      color: '#FFFBEB',
      emissive: '#FBBF24',
      emissiveIntensity: 0.45,
      roughness: 0.15,
    }),
    snowCapMat: new THREE.MeshStandardMaterial({
      color: '#F4F8FC',
      roughness: 0.88,
      metalness: 0.0,
    }),
  };

  // 1. Expansive Meadow Ground & Rolling Distant Hills (never floating in a void!)
  const groundMaterial = new THREE.MeshStandardMaterial({
    map: textures.meadowDay,
    roughness: 0.94,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(130, 64),
    groundMaterial
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Rolling distant green hills ringing the far horizon (pushed strictly >= 41u from origin — ZERO sanctuary clipping!)
  const hillMaterial = new THREE.MeshStandardMaterial({
    color: '#6CAE53',
    roughness: 0.95,
  });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dist = 66 + (i % 3) * 8;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(12 + (i % 3) * 3, 18, 12),
      hillMaterial
    );
    hill.scale.set(1.35, 0.32, 1.25);
    hill.position.set(Math.cos(a) * dist, -1.4, Math.sin(a) * dist);
    scene.add(hill);
  }

  // 2. Clean Village Avenue & Garden Footpaths (ZERO road-under-building overlap!)
  const roadMat = new THREE.MeshStandardMaterial({
    map: textures.gravelRoad,
    roughness: 0.9,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // North-South West Village Boulevard cleanly 1.2u east of every West patio (x ∈ [-10.8, -8.4], z ∈ [-10.6, +10.6])
  const mainAvenue = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 21.2), roadMat);
  mainAvenue.rotation.x = -Math.PI / 2;
  mainAvenue.position.set(-9.6, 0.02, 0);
  mainAvenue.receiveShadow = true;
  scene.add(mainAvenue);

  // Subtle low sandstone curbs edging the West Village Boulevard
  const curbEdgeGeo = new THREE.BoxGeometry(0.14, 0.06, 21.3);
  const westEdge = new THREE.Mesh(curbEdgeGeo, shared.warmSandstone);
  westEdge.position.set(-10.86, 0.03, 0);
  const eastEdge = new THREE.Mesh(curbEdgeGeo, shared.warmSandstone);
  eastEdge.position.set(-8.34, 0.03, 0);
  scene.add(westEdge, eastEdge);

  // 3 short cobblestone entrance paths linking SPEC, GATE, ARCHIVE patios cleanly to the West Boulevard
  for (const wz of [-8.2, 0.0, 8.2]) {
    const connector = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 1.72), roadMat);
    connector.rotation.x = -Math.PI / 2;
    connector.position.set(-11.4, 0.022, wz);
    connector.receiveShadow = true;
    scene.add(connector);
  }

  // Central East-West Promenade strictly from West Boulevard (-8.4) to Rotunda Terrace (-5.4)
  const centralPromenade = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), roadMat);
  centralPromenade.rotation.x = -Math.PI / 2;
  centralPromenade.position.set(-6.9, 0.018, 0);
  centralPromenade.receiveShadow = true;
  scene.add(centralPromenade);

  // North-East Garden Footpath connecting Rotunda North-East edge to standalone BG-OPS (4.8, -12.6)
  const opsFootpath = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 6.2), roadMat);
  opsFootpath.rotation.x = -Math.PI / 2;
  opsFootpath.rotation.z = -Math.atan2(3.0, 5.1);
  opsFootpath.position.set(3.3, 0.016, -7.75);
  opsFootpath.receiveShadow = true;
  scene.add(opsFootpath);

  // Twin East Sanctuary Diagonal Garden Lanes strictly between Rotunda & Sanctuary moat rims
  for (const sign of [-1, 1]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.85), roadMat);
    lane.rotation.x = -Math.PI / 2;
    lane.rotation.z = sign * -0.44;
    lane.position.set(6.8, 0.014, sign * 3.1);
    lane.receiveShadow = true;
    scene.add(lane);
  }

  // 3. Shimmering Miniature Village Pond (cleanly separated from Rotunda terrace + elevated water Y = 0.095 -> ZERO z-fighting!)
  const pondGroup = new THREE.Group();
  pondGroup.position.set(POND_POS.x, 0, POND_POS.z);

  // Subtle recessed dark basin bed under the water
  const pondBed = new THREE.Mesh(
    new THREE.CircleGeometry(POND_WATER_RADIUS + 0.06, 40),
    new THREE.MeshStandardMaterial({ color: '#1B5E73', roughness: 0.95 })
  );
  pondBed.rotation.x = -Math.PI / 2;
  pondBed.position.y = 0.032;
  pondGroup.add(pondBed);

  const pondWater = new THREE.Mesh(
    new THREE.CircleGeometry(POND_WATER_RADIUS, 40),
    new THREE.MeshPhysicalMaterial({
      color: '#4CBBD8',
      roughness: 0.09,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    })
  );
  pondWater.rotation.x = -Math.PI / 2;
  pondWater.position.y = 0.095;
  pondWater.receiveShadow = true;
  pondGroup.add(pondWater);

  const pondRim = new THREE.Mesh(
    new THREE.TorusGeometry(POND_WATER_RADIUS + 0.08, 0.17, 10, 40),
    shared.warmSandstone
  );
  pondRim.rotation.x = Math.PI / 2;
  pondRim.position.y = 0.11;
  pondRim.receiveShadow = true;
  pondGroup.add(pondRim);

  // Lily pads & delicate pink lotus blossom cleanly floating above water at y = 0.122
  const padMat = new THREE.MeshStandardMaterial({
    color: '#47A452',
    roughness: 0.68,
  });
  for (let i = 0; i < 6; i++) {
    const a = i * 1.08 + 0.25;
    const r = 0.62 + (i % 3) * 0.45;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.028, 12, 1, false, 0.25, Math.PI * 1.82),
      padMat
    );
    pad.position.set(Math.cos(a) * r, 0.122, Math.sin(a) * r);
    pad.rotation.y = a;
    pondGroup.add(pad);
  }
  const lotus = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.15, 7),
    new THREE.MeshStandardMaterial({ color: '#F9A8D4', roughness: 0.55 })
  );
  lotus.rotation.x = Math.PI;
  lotus.position.set(0.62 * Math.cos(0.25), 0.19, 0.62 * Math.sin(0.25));
  pondGroup.add(lotus);
  scene.add(pondGroup);

  // Collections for animation & interaction
  const clickables: THREE.Object3D[] = [];
  const hoverRings = new Map<VillageBuildingId, THREE.Mesh>();
  const workingSparks = new Map<VillageBuildingId, WorkingSparkRig>();
  const buildingAnchors = new Map<VillageBuildingId, THREE.Vector3>();
  const gears: THREE.Object3D[] = [];
  const spinnersY: THREE.Object3D[] = [];
  const snowRoofMeshes: THREE.Mesh[] = [];
  let satelliteDish: THREE.Object3D | null = null;
  let gateBoomPivot: THREE.Object3D | null = null;
  let archiveVaultWheel: THREE.Object3D | null = null;
  let opsRadarGroup: THREE.Object3D | null = null;
  let specBlueprintMat: THREE.MeshStandardMaterial | null = null;
  const opsLedMaterials: THREE.MeshStandardMaterial[] = [];

  // 4. Central Glass-Dome Conservatory (ST-00)
  const rotunda = buildCentralGlassRotunda(textures, shared, isSoftwareGl);
  const rotundaSparks = createWorkingSparkRig(6.9, 2.35, '#38BDF8');
  rotunda.group.add(rotundaSparks.group);
  scene.add(rotunda.group);
  clickables.push(rotunda.hitbox);
  hoverRings.set('ST-00', rotunda.hoverRing);
  workingSparks.set('ST-00', rotundaSparks);
  buildingAnchors.set('ST-00', new THREE.Vector3(0, 7.6, 0));
  snowRoofMeshes.push(...rotunda.snowMeshes);

  // 5. Three West Department Cottages (SPEC, GATE, ARCHIVE) + Standalone North-East OPS Station
  for (const ws of WORKSHOPS) {
    const built = buildWorkshopCottage(ws, textures, shared);
    const workSparks = createWorkingSparkRig(3.55, 1.55, ws.accentColor);
    built.group.add(workSparks.group);
    scene.add(built.group);
    clickables.push(built.hitbox);
    hoverRings.set(ws.id, built.hoverRing);
    workingSparks.set(ws.id, workSparks);
    const anchorY =
      ws.id === 'ST-01'
        ? 4.95
        : ws.id === 'BG-OPS'
        ? 4.55
        : 4.65;
    buildingAnchors.set(
      ws.id,
      new THREE.Vector3(ws.position.x, anchorY, ws.position.z)
    );
    if (built.satelliteDish) satelliteDish = built.satelliteDish;
    if (built.gateBoomPivot) gateBoomPivot = built.gateBoomPivot;
    if (built.archiveVaultWheel) archiveVaultWheel = built.archiveVaultWheel;
    if (built.opsRadarGroup) opsRadarGroup = built.opsRadarGroup;
    if (built.specBlueprintMat) specBlueprintMat = built.specBlueprintMat;
    if (built.opsLedMaterials.length > 0) opsLedMaterials.push(...built.opsLedMaterials);
    gears.push(...built.gears);
    spinnersY.push(...built.spinnersY);
    snowRoofMeshes.push(...built.snowMeshes);
  }

  // 6. East Twin AI Sanctuaries
  const coderSanctuary = buildAiSanctuary(
    'coder',
    SANCTUARY_POSITIONS.coder,
    textures,
    shared
  );
  const coderWorkSparks = createWorkingSparkRig(4.35, 2.25, '#60A5FA');
  coderSanctuary.group.add(coderWorkSparks.group);
  scene.add(coderSanctuary.group);
  clickables.push(coderSanctuary.hitbox);
  hoverRings.set('AI-CODER', coderSanctuary.hoverRing);
  workingSparks.set('AI-CODER', coderWorkSparks);
  buildingAnchors.set(
    'AI-CODER',
    new THREE.Vector3(
      SANCTUARY_POSITIONS.coder.x,
      4.5,
      SANCTUARY_POSITIONS.coder.z
    )
  );

  const cloudSanctuary = buildAiSanctuary(
    'cloud',
    SANCTUARY_POSITIONS.cloud,
    textures,
    shared
  );
  const cloudWorkSparks = createWorkingSparkRig(4.35, 2.25, '#34D399');
  cloudSanctuary.group.add(cloudWorkSparks.group);
  scene.add(cloudSanctuary.group);
  clickables.push(cloudSanctuary.hitbox);
  hoverRings.set('AI-CLOUD', cloudSanctuary.hoverRing);
  workingSparks.set('AI-CLOUD', cloudWorkSparks);
  buildingAnchors.set(
    'AI-CLOUD',
    new THREE.Vector3(
      SANCTUARY_POSITIONS.cloud.x + 1.1,
      5.85,
      SANCTUARY_POSITIONS.cloud.z
    )
  );

  // 7. Elevated Ribbed Conveyor Track Network + Miniature Transfer Junction Gatehouses
  const { trackCurves, reworkRailMaterial } = buildConveyorTracks(
    scene,
    textures,
    shared
  );
  for (const junc of CONVEYOR_JUNCTIONS) {
    scene.add(buildConveyorJunction(junc, shared));
  }

  // 8. Tactile Cardboard Parcels Pool
  const parcelPool = buildParcelPool(scene, textures, 8);

  // Shared zero-clipping exclusion helper covering Rotunda, Pond, Sanctuaries, all 6 Cottages, Junctions, Roads & ALL Conveyor Splines!
  const conveyorSamples: Array<[number, number]> = [];
  for (const track of CONVEYOR_TRACKS) {
    for (let s = 0; s <= 24; s++) {
      const sample = samplePolylinePoint(track.points, s / 24).position;
      conveyorSamples.push([sample.x, sample.z]);
    }
  }

  const isClearMeadowSpot = (x: number, z: number, margin: number): boolean => {
    // Central Rotunda terrace
    if (Math.hypot(x, z) < 6.15 + margin) return false;
    // Village Pond + stone rim
    if (
      Math.hypot(x - POND_POS.x, z - POND_POS.z) <
      POND_WATER_RADIUS + 0.55 + margin
    ) {
      return false;
    }
    // East Twin AI Sanctuaries (generous 6.45u exclusion so zero canopies touch moats or archways)
    if (
      Math.hypot(
        x - SANCTUARY_POSITIONS.coder.x,
        z - SANCTUARY_POSITIONS.coder.z
      ) <
      6.45 + margin
    ) {
      return false;
    }
    if (
      Math.hypot(
        x - SANCTUARY_POSITIONS.cloud.x,
        z - SANCTUARY_POSITIONS.cloud.z
      ) <
      6.45 + margin
    ) {
      return false;
    }
    // All Workshop Patios (rectangular AABB clearance covering 5.72 x 4.72 patio + margin)
    for (const ws of WORKSHOPS) {
      if (
        Math.abs(x - ws.position.x) < 3.45 + margin &&
        Math.abs(z - ws.position.z) < 2.95 + margin
      ) {
        return false;
      }
    }
    // Conveyor Transfer Junction Gatehouses (if any)
    for (const junc of CONVEYOR_JUNCTIONS) {
      if (Math.hypot(x - junc.position.x, z - junc.position.z) < 1.85 + margin) {
        return false;
      }
    }
    // West Village Boulevard (x ∈ [-10.8, -8.4], z ∈ [-10.6, +10.6])
    if (
      x > -11.3 - margin * 0.45 &&
      x < -8.0 + margin * 0.45 &&
      Math.abs(z) < 11.4 + margin * 0.45
    ) {
      return false;
    }
    // Central East-West Promenade (-9.6 to -4.6)
    if (x > -9.6 && x < -4.4 && Math.abs(z) < 1.85 + margin * 0.45) return false;
    // North-East Garden Footpath to BG-OPS (1.8, -5.2) -> (4.8, -10.3)
    const fpDx = 3.0;
    const fpDz = -5.1;
    const fpLenSq = fpDx * fpDx + fpDz * fpDz;
    const fpT = Math.max(0, Math.min(1, ((x - 1.8) * fpDx + (z + 5.2) * fpDz) / fpLenSq));
    const fpDist = Math.hypot(x - (1.8 + fpT * fpDx), z - (-5.2 + fpT * fpDz));
    if (fpDist < 1.35 + margin * 0.5) return false;
    // East Sanctuary Garden Lanes
    if (x > 4.2 && x < 9.6 && Math.abs(z) < 4.7 + margin * 0.4) return false;
    // Elevated Conveyor Splines
    const beltClear = 0.96 + margin * 0.72;
    const beltClearSq = beltClear * beltClear;
    for (let i = 0; i < conveyorSamples.length; i++) {
      const dx = x - conveyorSamples[i][0];
      const dz = z - conveyorSamples[i][1];
      if (dx * dx + dz * dz < beltClearSq) return false;
    }
    return true;
  };

  // 9. Instanced Miniature Deciduous Trees (strictly clear of pond, patios & conveyors)
  const treeSpots: Array<{
    x: number;
    z: number;
    s: number;
    isAutumnAccent: boolean;
  }> = [];

  for (let i = 0; i < 360 && treeSpots.length < 92; i++) {
    const angle = rand() * Math.PI * 2;
    const ring = treeSpots.length < 24 ? 12 + rand() * 14 : 21 + rand() * 24;
    const x = Math.cos(angle) * ring * 1.15;
    const z = Math.sin(angle) * ring * 0.94;
    if (!isClearMeadowSpot(x, z, 1.45)) continue;
    // Also keep trees from overlapping each other heavily
    if (treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 2.1)) continue;
    treeSpots.push({
      x,
      z,
      s: 0.74 + rand() * 0.64,
      isAutumnAccent: rand() < 0.2,
    });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.35, 7);
  trunkGeo.translate(0, 0.675, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: '#7B573A',
    roughness: 0.9,
  });
  const trunkInst = new THREE.InstancedMesh(
    trunkGeo,
    trunkMat,
    treeSpots.length
  );
  trunkInst.castShadow = true;

  const puffMain = new THREE.IcosahedronGeometry(1.02, 2);
  puffMain.scale(1.05, 0.9, 1.05);
  puffMain.translate(0, 2.08, 0);
  const puffLeft = new THREE.IcosahedronGeometry(0.76, 1);
  puffLeft.translate(-0.62, 1.82, 0.25);
  const puffRight = new THREE.IcosahedronGeometry(0.74, 1);
  puffRight.translate(0.58, 1.88, -0.28);
  const puffTop = new THREE.IcosahedronGeometry(0.68, 1);
  puffTop.translate(0.08, 2.66, 0.08);
  const canopyGeo =
    mergeGeometries([puffMain, puffLeft, puffRight, puffTop]) ?? puffMain;
  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.84,
    metalness: 0.0,
  });
  const foliageCanopyMesh = new THREE.InstancedMesh(
    canopyGeo,
    canopyMat,
    treeSpots.length
  );
  foliageCanopyMesh.castShadow = true;
  foliageCanopyMesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const springPalette = ['#4E9A3F', '#61B449', '#3F8636', '#72BE52'];
  const autumnPalette = ['#DC7E33', '#CC5D28', '#E2A738', '#C24E2A'];
  const foliageBaseColors: THREE.Color[] = [];
  const foliageAutumnColors: THREE.Color[] = [];

  treeSpots.forEach((spot, i) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(spot.s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);
    foliageCanopyMesh.setMatrixAt(i, dummy.matrix);

    const baseCol = new THREE.Color(
      spot.isAutumnAccent
        ? autumnPalette[i % autumnPalette.length]
        : springPalette[i % springPalette.length]
    );
    const autCol = new THREE.Color(autumnPalette[i % autumnPalette.length]);
    foliageBaseColors.push(baseCol);
    foliageAutumnColors.push(autCol);
    foliageCanopyMesh.setColorAt(i, baseCol);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  foliageCanopyMesh.instanceMatrix.needsUpdate = true;
  if (foliageCanopyMesh.instanceColor) {
    foliageCanopyMesh.instanceColor.needsUpdate = true;
  }
  scene.add(trunkInst, foliageCanopyMesh);

  // 10. Instanced Miniature Wildflower Clusters (strictly on open meadow — ZERO flowers inside pond or roads!)
  const flowerSpots: Array<[number, number, number]> = [];
  for (let tries = 0; tries < 900 && flowerSpots.length < 135; tries++) {
    const x = (rand() - 0.5) * 46;
    const z = (rand() - 0.5) * 32;
    if (!isClearMeadowSpot(x, z, 0.35)) continue;
    flowerSpots.push([x, z, 0.72 + rand() * 0.65]);
  }
  const flowerGeo = new THREE.SphereGeometry(0.1, 6, 6);
  const flowerMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.7,
  });
  const flowerInst = new THREE.InstancedMesh(
    flowerGeo,
    flowerMat,
    flowerSpots.length
  );
  const blossomHexes = ['#FFFDF5', '#C4B5FD', '#FDE047', '#FBCFE8'];
  flowerSpots.forEach(([x, z, s], i) => {
    dummy.position.set(x, 0.08, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    flowerInst.setMatrixAt(i, dummy.matrix);
    flowerInst.setColorAt(
      i,
      new THREE.Color(blossomHexes[i % blossomHexes.length])
    );
  });
  flowerInst.instanceMatrix.needsUpdate = true;
  if (flowerInst.instanceColor) flowerInst.instanceColor.needsUpdate = true;
  scene.add(flowerInst);

  // 11. Miniature Cast-Iron Streetlamps (framed cleanly along boulevard & pond curbs, zero belt overlap)
  const lampCoords: Array<[number, number]> = [
    [-8.1, -11.4],
    [-8.1, -3.2],
    [-8.1, 3.6],
    [-8.1, 11.2],
    [-11.3, -11.4],
    [-11.3, 11.2],
    [1.6, -8.2],
    [6.6, -9.2],
    [-4.2, 9.6],
    [3.0, 9.6],
  ];
  const lampPoolMat = new THREE.MeshBasicMaterial({
    map: textures.warmGlowDisc,
    color: '#FDE68A',
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const [lx, lz] of lampCoords) {
    const lamp = new THREE.Group();
    lamp.position.set(lx, 0, lz);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.085, 2.15, 8),
      shared.darkIron
    );
    pole.position.y = 1.08;
    pole.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      shared.lampBulbMat
    );
    head.position.y = 2.24;
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 0.16, 8),
      shared.darkIron
    );
    cap.position.y = 2.42;

    const lightPool = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 3.8),
      lampPoolMat
    );
    lightPool.rotation.x = -Math.PI / 2;
    lightPool.position.y = 0.038;
    lightPool.renderOrder = 2;

    lamp.add(pole, head, cap, lightPool);
    scene.add(lamp);
  }

  // 12. 3D Falling Snow Particle System
  const snowCount = isSoftwareGl ? 220 : 520;
  const snowPositions = new Float32Array(snowCount * 3);
  for (let i = 0; i < snowCount; i++) {
    snowPositions[i * 3] = (rand() - 0.5) * 62;
    snowPositions[i * 3 + 1] = rand() * 24;
    snowPositions[i * 3 + 2] = (rand() - 0.5) * 44;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(snowPositions, 3)
  );
  const snowMaterial = new THREE.PointsMaterial({
    color: '#FFFFFF',
    size: 0.22,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const snowParticles = new THREE.Points(snowGeo, snowMaterial);
  snowParticles.visible = false;
  scene.add(snowParticles);

  // 13. 3D Village Launch Celebration Confetti & Golden Rotunda Halo (hidden until a real/demo release ships!)
  const confettiCount = isSoftwareGl ? 96 : 156;
  const confettiGeo = new THREE.BoxGeometry(0.24, 0.14, 0.03);
  const confettiMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.32,
    metalness: 0.18,
    emissive: '#FFFFFF',
    emissiveIntensity: 0.22,
  });
  const confettiMesh = new THREE.InstancedMesh(confettiGeo, confettiMat, confettiCount);
  confettiMesh.visible = false;
  confettiMesh.frustumCulled = false;

  const celebrationPalette = [
    '#F59E0B',
    '#10B981',
    '#3B82F6',
    '#EC4899',
    '#8B5CF6',
    '#FACC15',
    '#FB7185',
    '#38BDF8',
  ];
  const burstOrigins: Array<[number, number, number]> = [
    [CENTRAL_ROTUNDA_POS.x, 7.8, CENTRAL_ROTUNDA_POS.z],
    [-14.8, 4.4, 8.2], // ST-05 Archive Villa
    [SANCTUARY_POSITIONS.coder.x, 5.2, SANCTUARY_POSITIONS.coder.z],
    [SANCTUARY_POSITIONS.cloud.x, 5.2, SANCTUARY_POSITIONS.cloud.z],
  ];
  const celebrationSeeds: CelebrationParticleSeed[] = [];
  for (let i = 0; i < confettiCount; i++) {
    const origin = burstOrigins[i % burstOrigins.length];
    const theta = rand() * Math.PI * 2;
    const speed = 2.6 + rand() * 4.4;
    const upSpeed = 4.6 + rand() * 4.8;
    celebrationSeeds.push({
      originX: origin[0] + (rand() - 0.5) * 1.4,
      originY: origin[1] + (rand() - 0.5) * 0.6,
      originZ: origin[2] + (rand() - 0.5) * 1.4,
      vx: Math.cos(theta) * speed,
      vy: upSpeed,
      vz: Math.sin(theta) * speed,
      rotSpeedX: (rand() - 0.5) * 9.5,
      rotSpeedY: (rand() - 0.5) * 9.5,
      rotSpeedZ: (rand() - 0.5) * 9.5,
      delay: Math.floor(i / 44) * 0.65 + rand() * 0.28,
      scale: 0.78 + rand() * 0.72,
    });
    confettiMesh.setColorAt(
      i,
      new THREE.Color(celebrationPalette[i % celebrationPalette.length])
    );
    dummy.position.set(origin[0], -20, origin[2]);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    confettiMesh.setMatrixAt(i, dummy.matrix);
  }
  confettiMesh.instanceMatrix.needsUpdate = true;
  if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
  scene.add(confettiMesh);

  const celebrationHaloMat = new THREE.MeshStandardMaterial({
    color: '#FDE047',
    emissive: '#F59E0B',
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.65,
    transparent: true,
    opacity: 0,
  });
  const celebrationHaloRing = new THREE.Mesh(
    new THREE.TorusGeometry(4.8, 0.14, 12, 48),
    celebrationHaloMat
  );
  celebrationHaloRing.rotation.x = Math.PI / 2;
  celebrationHaloRing.position.set(CENTRAL_ROTUNDA_POS.x, 4.2, CENTRAL_ROTUNDA_POS.z);
  celebrationHaloRing.visible = false;
  scene.add(celebrationHaloRing);

  const celebrationRig: CelebrationConfettiRig = {
    mesh: confettiMesh,
    seeds: celebrationSeeds,
    haloRing: celebrationHaloRing,
    haloMat: celebrationHaloMat,
  };

  return {
    rotundaSpire: rotunda.spire,
    weathervane: rotunda.weathervane,
    clockHourHand: rotunda.clockHourHand,
    clockMinuteHand: rotunda.clockMinuteHand,
    clockSecondHand: rotunda.clockSecondHand,
    satelliteDish,
    gears,
    spinnersY,
    gateBoomPivot,
    archiveVaultWheel,
    opsRadarGroup,
    specBlueprintMat,
    opsLedMaterials,
    workingSparks,
    celebrationRig,
    coderArmillaryOuter: coderSanctuary.armillaryOuter,
    coderArmillaryInner: coderSanctuary.armillaryInner,
    cloudArmillaryOuter: cloudSanctuary.armillaryOuter,
    cloudArmillaryInner: cloudSanctuary.armillaryInner,
    coderMascot: coderSanctuary.mascot,
    coderMascotOrbit: coderSanctuary.mascotOrbit,
    cloudMascot: cloudSanctuary.mascot,
    cloudMascotOrbit: cloudSanctuary.mascotOrbit,
    coderSparkles: coderSanctuary.sparkles,
    cloudSparkles: cloudSanctuary.sparkles,
    snowParticles,
    snowMaterial,
    windowMaterials: [shared.warmWindowMat],
    lampBulbMaterials: [shared.lampBulbMat],
    lampPoolMaterials: [lampPoolMat],
    sanctuaryWheelMaterials: [
      coderSanctuary.wheelMat,
      cloudSanctuary.wheelMat,
    ],
    reworkRailMaterial,
    groundMaterial,
    hillMaterial,
    foliageCanopyMesh,
    foliageBaseColors,
    foliageAutumnColors,
    snowRoofMeshes,
    clickables,
    hoverRings,
    buildingAnchors,
    trackCurves,
    parcelPool,
  };
}
