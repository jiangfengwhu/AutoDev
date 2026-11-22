import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CAMERA_PRESETS,
  PARCEL_ROUTE_SEGMENTS,
  WORKSHOPS,
  deriveVillageHudState,
  evaluateAtmosphere,
  type AtmospherePresetId,
  type AtmosphereState,
  type CameraPresetId,
  type VillageBuildingId,
  type VillageHudOverlayState,
} from './villageConfig';
import { createProceduralTextures } from './proceduralTextures';
import {
  buildMiniatureVillage,
  type AnimatedVillageHandles,
} from './buildArchitecture';
import type {
  FactoryPipelineSnapshot,
  FactoryStationId,
} from '../lib/factoryPipelineState';

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface VillageProjectedOverlay {
  hud: VillageHudOverlayState;
  atmosphere: AtmosphereState;
  parcelCoords: Record<string, ProjectedPoint>;
  comicAnchor: ProjectedPoint;
  terminalAnchor: ProjectedPoint;
  stationTags: Array<{
    buildingId: VillageBuildingId;
    stationId: FactoryStationId;
    label: string;
    departmentBadge: string;
    x: number;
    y: number;
    visible: boolean;
    hovered: boolean;
    isWorking: boolean;
    workingLabel: string;
  }>;
  hoveredBuildingId: VillageBuildingId | null;
}

export interface VillageControllerCallbacks {
  onSelectBuilding: (stationId: FactoryStationId, buildingId: VillageBuildingId) => void;
  onOverlayUpdate: (overlay: VillageProjectedOverlay) => void;
  onUserOrbitStart?: () => void;
  onCelebrationComplete?: () => void;
}

const BUILDING_LABELS: Array<{
  buildingId: VillageBuildingId;
  stationId: FactoryStationId;
  label: string;
  departmentBadge: string;
}> = [
  { buildingId: 'ST-00', stationId: 'ST-00', label: '指挥调度中心', departmentBadge: 'HQ' },
  ...WORKSHOPS.map((w) => ({
    buildingId: w.id,
    stationId: w.stationId,
    label: w.name,
    departmentBadge: w.departmentBadge,
  })),
  { buildingId: 'AI-CODER', stationId: 'ST-02', label: 'Gemini 编码圣殿', departmentBadge: 'GEMINI' },
  { buildingId: 'AI-CLOUD', stationId: 'ST-03', label: '质检进化圣殿', departmentBadge: 'QA·RSI' },
];

export class VillageSceneController {
  private container: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmremGenerator: THREE.PMREMGenerator;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private textures: ReturnType<typeof createProceduralTextures>;
  private handles: AnimatedVillageHandles;
  private callbacks: VillageControllerCallbacks;

  private sunLight: THREE.DirectionalLight;
  private rimFillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;
  private coderPointLight: THREE.PointLight;
  private cloudPointLight: THREE.PointLight;
  private fog: THREE.Fog;

  private isSoftwareGl = false;
  private disposed = false;
  private paused = false;
  private rafId = 0;
  private timerId = 0;
  private lastFrameMs = 0;
  private elapsedSec = 0;
  private lastOverlayEmitMs = 0;
  private lastSnowApplied = -1;
  private lastAutumnApplied = -1;

  private snapshot: FactoryPipelineSnapshot;
  private runningTasksCount = 0;
  private stageKey = '';
  private stageEnteredAtSec = 0;
  private beltScrollSpeed = 0;
  private atmospherePreset: AtmospherePresetId = 'day';
  private activeCameraPreset: CameraPresetId | null = 'overview';
  private cameraGoalPos = new THREE.Vector3(0.4, 26.5, 40.5);
  private cameraGoalTarget = new THREE.Vector3(-0.6, 0.8, 0.2);
  private heroParcelPos = new THREE.Vector3(-10, 0.62, -4);
  private heroParcelDir = new THREE.Vector3(1, 0, 0);

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private hoveredBuildingId: VillageBuildingId | null = null;
  private pointerDownClient = { x: 0, y: 0 };
  private lastHoverRaycastMs = 0;
  private resizeObserver: ResizeObserver;

  private tmpVec = new THREE.Vector3();
  private tmpColor = new THREE.Color();
  private snowWhite = new THREE.Color('#E8F1F8');
  private confettiDummy = new THREE.Object3D();
  private celebrationCompleteNotifiedKey = '';

  constructor(
    container: HTMLDivElement,
    initialSnapshot: FactoryPipelineSnapshot,
    callbacks: VillageControllerCallbacks
  ) {
    this.container = container;
    this.snapshot = initialSnapshot;
    this.callbacks = callbacks;

    // 1. Detect software WebGL before constructing renderer
    const probeCanvas = document.createElement('canvas');
    const probeGl =
      probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    let glRendererName = '';
    if (probeGl) {
      const dbg = probeGl.getExtension('WEBGL_debug_renderer_info');
      glRendererName = String(
        probeGl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : probeGl.RENDERER) || ''
      );
      probeGl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.isSoftwareGl =
      /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(glRendererName);

    const width = Math.max(container.clientWidth || window.innerWidth, 320);
    const height = Math.max(container.clientHeight || window.innerHeight, 320);

    // 2. Renderer with ACESFilmic tone mapping and software-GL cost scaling
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 3. Scene, sky, fog & RoomEnvironment IBL
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#B6DCF6');
    this.fog = new THREE.Fog('#CBE5F6', 52, 122);
    this.scene.fog = this.fog;

    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = this.pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    );
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.34;

    // 4. Telephoto miniature diorama perspective camera (FOV 33 for authentic toy-model framing!)
    this.camera = new THREE.PerspectiveCamera(33, width / height, 0.5, 220);
    const initPreset = CAMERA_PRESETS.overview;
    this.camera.position.set(
      initPreset.position.x,
      initPreset.position.y,
      initPreset.position.z
    );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.maxPolarAngle = Math.PI * 0.445;
    this.controls.minPolarAngle = 0.2;
    this.controls.minDistance = 8.5;
    this.controls.maxDistance = 58;
    this.controls.target.set(
      initPreset.target.x,
      initPreset.target.y,
      initPreset.target.z
    );
    this.controls.update();

    this.controls.addEventListener('start', () => {
      // Yield immediately to manual orbit/pan/zoom
      this.activeCameraPreset = null;
      this.callbacks.onUserOrbitStart?.();
    });

    // 5. Three-Point Outdoor Daylight + Sanctuary Accent Lights
    this.hemiLight = new THREE.HemisphereLight('#C7E6FF', '#7CB35B', 1.15);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight('#FFFFFF', 0.35);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight('#FFF6E3', 2.45);
    this.sunLight.position.set(24, 34, 22);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 110;
    const d = 28;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);

    // Warm opposite-side sculptural rim/fill bounce light (prevents flat muddy shadows)
    this.rimFillLight = new THREE.DirectionalLight('#FFE7C7', 0.56);
    this.rimFillLight.position.set(-24, 18, -18);
    this.scene.add(this.rimFillLight);

    // Local celestial glow lights inside the Gemini Coding Sanctuary & QA Sanctuary
    this.coderPointLight = new THREE.PointLight('#60A5FA', 1.8, 17, 1.8);
    this.coderPointLight.position.set(13.6, 4.2, -6.2);
    this.scene.add(this.coderPointLight);

    this.cloudPointLight = new THREE.PointLight('#34D399', 1.7, 17, 1.8);
    this.cloudPointLight.position.set(13.6, 4.2, 6.2);
    this.scene.add(this.cloudPointLight);

    // 6. Procedural Textures & Complete Miniature Village Architecture
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.handles = buildMiniatureVillage(
      this.scene,
      this.textures,
      this.isSoftwareGl
    );

    // Layer 1 strictly for simplified invisible hitboxes
    this.raycaster.layers.set(1);

    // 7. Pointer & Resize Listeners
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.stageKey = this.computeStageKey(initialSnapshot);
    this.stageEnteredAtSec = 0;

    // Start animation loop
    this.lastFrameMs = performance.now();
    this.renderStep(this.lastFrameMs);
  }

  private computeStageKey(snap: FactoryPipelineSnapshot): string {
    return `${snap.mode}|${snap.phaseIndex ?? -1}|${snap.activeStationId}|${snap.justDelivered ? 'deliv' : 'std'}|${snap.workpiece?.location ?? 'none'}|${snap.workpiece?.prNumberLabel ?? ''}|${snap.tracks.reworkSt03ToSt02}`;
  }

  public updateSnapshot(next: FactoryPipelineSnapshot): void {
    const nextKey = this.computeStageKey(next);
    if (nextKey !== this.stageKey) {
      this.stageKey = nextKey;
      this.stageEnteredAtSec = this.elapsedSec;
    }
    this.snapshot = next;
  }

  public setRunningTasksCount(count: number): void {
    this.runningTasksCount = Math.max(0, count);
  }

  /**
   * Samples a position and tangent along either a single track or a composite
   * multi-segment route passing smoothly through a Transfer Junction Gatehouse.
   */
  private sampleParcelRoute(
    routeId: string,
    t: number
  ): { pos: THREE.Vector3; tan: THREE.Vector3 } | null {
    const segIds = PARCEL_ROUTE_SEGMENTS[routeId] ?? [routeId];
    const curves: THREE.CatmullRomCurve3[] = [];
    let totalLen = 0;
    for (const sid of segIds) {
      const c = this.handles.trackCurves.get(sid);
      if (c) {
        curves.push(c);
        totalLen += c.getLength();
      }
    }
    if (curves.length === 0 || totalLen <= 0.0001) return null;

    const clampedT = Math.max(0.005, Math.min(0.995, t));
    let targetDist = clampedT * totalLen;
    for (let i = 0; i < curves.length; i++) {
      const segLen = curves[i].getLength();
      if (targetDist <= segLen || i === curves.length - 1) {
        const localT = Math.max(0, Math.min(1, targetDist / Math.max(segLen, 0.0001)));
        return {
          pos: curves[i].getPointAt(localT),
          tan: curves[i].getTangentAt(localT).normalize(),
        };
      }
      targetDist -= segLen;
    }
    return null;
  }

  public setAtmospherePreset(preset: AtmospherePresetId): void {
    this.atmospherePreset = preset;
  }

  public setCameraPreset(preset: CameraPresetId): void {
    this.activeCameraPreset = preset;
    if (preset !== 'follow') {
      const cfg = CAMERA_PRESETS[preset];
      this.cameraGoalPos.set(cfg.position.x, cfg.position.y, cfg.position.z);
      this.cameraGoalTarget.set(cfg.target.x, cfg.target.y, cfg.target.z);
    }
  }

  public focusBuilding(buildingId: VillageBuildingId): void {
    const resolvedId: VillageBuildingId =
      buildingId === 'ST-02'
        ? 'AI-CODER'
        : buildingId === 'ST-03'
          ? 'AI-CLOUD'
          : buildingId;
    const anchor = this.handles.buildingAnchors.get(resolvedId);
    if (!anchor) return;
    this.activeCameraPreset = 'overview'; // reuse smooth damp target
    this.cameraGoalTarget.set(anchor.x, 1.8, anchor.z);
    this.cameraGoalPos.set(anchor.x + 2.4, 9.6, anchor.z + 13.5);
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private updatePointerNdc(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownClient.x = e.clientX;
    this.pointerDownClient.y = e.clientY;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastHoverRaycastMs < 48) return;
    this.lastHoverRaycastMs = now;

    this.updatePointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.handles.clickables, false);
    const nextHover =
      hits.length > 0
        ? ((hits[0].object.userData.buildingId as VillageBuildingId) ?? null)
        : null;

    if (nextHover !== this.hoveredBuildingId) {
      this.hoveredBuildingId = nextHover;
      this.renderer.domElement.style.cursor = nextHover ? 'pointer' : 'grab';
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const dx = e.clientX - this.pointerDownClient.x;
    const dy = e.clientY - this.pointerDownClient.y;
    if (Math.hypot(dx, dy) > 7) return; // user was orbiting, not clicking

    this.updatePointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.handles.clickables, false);
    if (hits.length > 0) {
      const { buildingId, stationId } = hits[0].object.userData as {
        buildingId: VillageBuildingId;
        stationId: FactoryStationId;
      };
      if (stationId) {
        this.callbacks.onSelectBuilding(stationId, buildingId);
      }
    }
  };

  private projectWorldPoint(pos: THREE.Vector3): ProjectedPoint {
    this.tmpVec.copy(pos).project(this.camera);
    const width = this.renderer.domElement.clientWidth || 1;
    const height = this.renderer.domElement.clientHeight || 1;
    const visible =
      this.tmpVec.z >= -1 &&
      this.tmpVec.z <= 1 &&
      Math.abs(this.tmpVec.x) <= 1.08 &&
      Math.abs(this.tmpVec.y) <= 1.08;
    return {
      x: (this.tmpVec.x * 0.5 + 0.5) * width,
      y: (-this.tmpVec.y * 0.5 + 0.5) * height,
      visible,
    };
  }

  private applyAtmosphere(atmo: AtmosphereState): void {
    (this.scene.background as THREE.Color).set(atmo.skyHex);
    this.fog.color.set(atmo.fogHex);
    this.fog.near = atmo.fogNear;
    this.fog.far = atmo.fogFar;

    this.sunLight.color.set(atmo.sunColorHex);
    this.sunLight.intensity = atmo.sunIntensity;
    this.sunLight.position.set(atmo.sunPos.x, atmo.sunPos.y, atmo.sunPos.z);

    this.hemiLight.color.set(atmo.hemiSkyHex);
    this.hemiLight.groundColor.set(atmo.hemiGroundHex);
    this.hemiLight.intensity = atmo.hemiIntensity;
    this.ambientLight.intensity = atmo.ambientIntensity;
    this.scene.environmentIntensity = atmo.envIntensity;
    this.renderer.toneMappingExposure = atmo.exposure;

    // Warm glowing cottage windows, feathered streetlamp halos & stained-glass wheels at dusk/night
    const night = atmo.nightFactor;
    this.rimFillLight.intensity = 0.56 * (1 - night * 0.72);
    for (const mat of this.handles.windowMaterials) {
      mat.emissiveIntensity = 0.16 + night * 2.75;
    }
    for (const mat of this.handles.lampBulbMaterials) {
      mat.emissiveIntensity = 0.25 + night * 3.1;
    }
    for (const mat of this.handles.lampPoolMaterials) {
      mat.opacity = night * 0.52;
    }
    for (const mat of this.handles.sanctuaryWheelMaterials) {
      mat.emissiveIntensity = 0.45 + night * 1.45;
    }
    this.coderPointLight.intensity = 1.4 + night * 8.5;
    this.cloudPointLight.intensity = 1.3 + night * 8.0;

    // Tint distant rolling hills smoothly across Spring / Autumn / Snow / Night
    this.tmpColor.set('#5EA14A');
    if (atmo.autumnFactor > 0.01) {
      this.tmpColor.lerp(new THREE.Color('#B57A42'), atmo.autumnFactor * 0.65);
    }
    if (atmo.snowFactor > 0.01) {
      this.tmpColor.lerp(this.snowWhite, atmo.snowFactor * 0.92);
    }
    if (night > 0.01) {
      this.tmpColor.lerp(new THREE.Color('#182848'), night * 0.78);
    }
    this.handles.hillMaterial.color.copy(this.tmpColor);

    // Snow ground & snow-dusted roofs + falling snow visibility
    const showSnowTexture = atmo.snowFactor > 0.45;
    const targetGroundMap = showSnowTexture
      ? this.textures.meadowSnow
      : this.textures.meadowDay;
    if (this.handles.groundMaterial.map !== targetGroundMap) {
      this.handles.groundMaterial.map = targetGroundMap;
      this.handles.groundMaterial.needsUpdate = true;
    }
    for (const mesh of this.handles.snowRoofMeshes) {
      mesh.visible = atmo.snowFactor > 0.38;
    }

    this.handles.snowParticles.visible = atmo.snowFactor > 0.12;
    this.handles.snowMaterial.opacity = Math.min(0.92, atmo.snowFactor * 0.95);

    // Update instanced tree canopy seasonal colors when snow/autumn shifts meaningfully
    if (
      Math.abs(atmo.snowFactor - this.lastSnowApplied) > 0.04 ||
      Math.abs(atmo.autumnFactor - this.lastAutumnApplied) > 0.04
    ) {
      this.lastSnowApplied = atmo.snowFactor;
      this.lastAutumnApplied = atmo.autumnFactor;
      const count = this.handles.foliageBaseColors.length;
      for (let i = 0; i < count; i++) {
        this.tmpColor.copy(this.handles.foliageBaseColors[i]);
        if (atmo.autumnFactor > 0.01) {
          this.tmpColor.lerp(this.handles.foliageAutumnColors[i], atmo.autumnFactor);
        }
        if (atmo.snowFactor > 0.01) {
          this.tmpColor.lerp(this.snowWhite, atmo.snowFactor * 0.78);
        }
        this.handles.foliageCanopyMesh.setColorAt(i, this.tmpColor);
      }
      if (this.handles.foliageCanopyMesh.instanceColor) {
        this.handles.foliageCanopyMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * Software-GL pacing per threejs SKILL.md: wait for GPU command completion via fenceSync
   * plus brief yield so Chromium remains 100% responsive even on SwiftShader.
   */
  public setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      if (this.timerId) {
        window.clearTimeout(this.timerId);
        this.timerId = 0;
      }
    } else {
      this.lastFrameMs = performance.now();
      this.scheduleNextFrame();
    }
  }

  private scheduleNextFrame(): void {
    if (this.disposed || this.paused) return;
    if (!this.isSoftwareGl) {
      this.rafId = requestAnimationFrame((ts) => this.renderStep(ts));
      return;
    }

    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync) {
        gl.flush();
        const pollFence = () => {
          if (this.disposed) {
            gl.deleteSync(sync);
            return;
          }
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.TIMEOUT_EXPIRED) {
            this.timerId = window.setTimeout(pollFence, 16);
          } else {
            gl.deleteSync(sync);
            this.timerId = window.setTimeout(
              () => this.renderStep(performance.now()),
              72
            );
          }
        };
        this.timerId = window.setTimeout(pollFence, 16);
        return;
      }
    }

    this.timerId = window.setTimeout(
      () => this.renderStep(performance.now()),
      80
    );
  }

  private renderStep(nowMs: number): void {
    if (this.disposed || this.paused) return;

    const dt = Math.min(0.08, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    this.elapsedSec += dt;

    // 1. Evaluate Atmosphere & State-Driven HUD State
    const atmosphere = evaluateAtmosphere(this.atmospherePreset, this.elapsedSec);
    this.applyAtmosphere(atmosphere);
    const stageElapsedSec = Math.max(0, this.elapsedSec - this.stageEnteredAtSec);
    const hud = deriveVillageHudState(this.snapshot, this.elapsedSec, stageElapsedSec);

    // 2. Scroll Ribbed Rubber Conveyor Texture ONLY while parcels are in transit (calm when docked!)
    const targetBeltSpeed = hud.hasActiveTransit ? 1.15 : 0;
    this.beltScrollSpeed = THREE.MathUtils.damp(
      this.beltScrollSpeed,
      targetBeltSpeed,
      5.5,
      dt
    );
    if (Math.abs(this.beltScrollSpeed) > 0.002) {
      this.textures.conveyorBelt.offset.y -= dt * this.beltScrollSpeed;
    }
    if (hud.reworkActive) {
      this.handles.reworkRailMaterial.color.set('#EF4444');
      this.handles.reworkRailMaterial.emissiveIntensity =
        0.75 + Math.sin(this.elapsedSec * 7.0) * 0.45;
    } else {
      this.handles.reworkRailMaterial.color.set('#CBD5E1');
      this.handles.reworkRailMaterial.emissiveIntensity = 0.04;
    }

    // 3. Active Working Building Set (pipeline active building + OPS when background tasks run)
    const activeWorkingSet = new Set<VillageBuildingId>(hud.workingBuildingIds);
    if (this.runningTasksCount > 0) {
      activeWorkingSet.add('BG-OPS');
    }

    const isSt00Working = activeWorkingSet.has('ST-00');
    const isSpecWorking = activeWorkingSet.has('ST-01');
    const isCoderWorking = activeWorkingSet.has('AI-CODER');
    const isCloudWorking = activeWorkingSet.has('AI-CLOUD');
    const isGateWorking = activeWorkingSet.has('ST-04');
    const isArchiveWorking = activeWorkingSet.has('ST-05');
    const isOpsWorking = activeWorkingSet.has('BG-OPS');

    // Animate Kinetic Diorama Details + Working Stage Boosts!
    this.handles.rotundaSpire.rotation.y += dt * (isSt00Working ? 2.1 : 0.48);
    this.handles.weathervane.rotation.y = Math.sin(this.elapsedSec * 0.55) * 0.65;
    if (this.handles.satelliteDish) {
      this.handles.satelliteDish.rotation.y =
        Math.sin(this.elapsedSec * (isSpecWorking ? 2.15 : 0.42)) *
        (isSpecWorking ? 1.05 : 0.7);
    }
    if (this.handles.specBlueprintMat) {
      this.handles.specBlueprintMat.emissiveIntensity = isSpecWorking
        ? 0.62 + Math.sin(this.elapsedSec * 4.4) * 0.34
        : 0.24;
    }
    this.handles.gears.forEach((gear, idx) => {
      const mult = isSpecWorking ? 2.6 : 1.0;
      gear.rotation.x += dt * (idx % 2 === 0 ? 1.8 : -2.4) * mult;
    });
    this.handles.spinnersY.forEach((spinner, idx) => {
      const isOpsRadar = spinner === this.handles.opsRadarGroup;
      const mult = isOpsRadar && isOpsWorking ? 3.8 : 1.0;
      spinner.rotation.y += dt * (idx % 2 === 0 ? 0.95 : -0.78) * mult;
    });

    // GATE boom arm waves cleanly when awaiting approval / signing off
    if (this.handles.gateBoomPivot) {
      const targetBoomZ = isGateWorking
        ? 0.42 + Math.sin(this.elapsedSec * 2.6) * 0.36
        : 0.14;
      this.handles.gateBoomPivot.rotation.z = THREE.MathUtils.damp(
        this.handles.gateBoomPivot.rotation.z,
        targetBoomZ,
        6,
        dt
      );
    }

    // ARCHIVE vault wheel spins briskly when sealing/archiving a release
    if (this.handles.archiveVaultWheel) {
      if (isArchiveWorking) {
        this.handles.archiveVaultWheel.rotation.z += dt * 2.4;
      } else {
        this.handles.archiveVaultWheel.rotation.z += dt * 0.12;
      }
    }

    // OPS telemetry server rack sequential LED chase when background jobs run
    if (this.handles.opsLedMaterials.length > 0) {
      const activeLedIdx = Math.floor(this.elapsedSec * 5.2) % this.handles.opsLedMaterials.length;
      this.handles.opsLedMaterials.forEach((ledMat, idx) => {
        ledMat.emissiveIntensity = isOpsWorking
          ? idx === activeLedIdx
            ? 2.45
            : 0.55
          : 0.75;
      });
    }

    // Rising Energy Spark Motes on Active Buildings (no ground shrinking circle rings)
    this.handles.workingSparks.forEach((rig, id) => {
      const working = activeWorkingSet.has(id);
      rig.group.visible = working;
      if (working) {
        rig.group.rotation.y += dt * 1.45;
        rig.motes.forEach((mote) => {
          const { phase } = mote.userData as { phase: number };
          const rise = ((this.elapsedSec * 0.85 + phase) % 1.45);
          mote.position.y = rise;
          const fadeScale = Math.sin((rise / 1.45) * Math.PI);
          mote.scale.setScalar(0.55 + fadeScale * 0.85);
          mote.rotation.y += dt * 2.6;
        });
      }
    });

    // Twin AI Sanctuary Armillary Spheres (accelerated when active!)
    const coderSpeed = isCoderWorking ? 2.55 : 1.0;
    const cloudSpeed = isCloudWorking ? 2.55 : 1.0;
    this.handles.coderArmillaryOuter.rotation.y += dt * 0.65 * coderSpeed;
    this.handles.coderArmillaryOuter.rotation.x = Math.sin(this.elapsedSec * 0.6 * coderSpeed) * 0.25;
    this.handles.coderArmillaryInner.rotation.y -= dt * 1.15 * coderSpeed;
    this.handles.coderArmillaryInner.rotation.z += dt * 0.5 * coderSpeed;

    this.handles.cloudArmillaryOuter.rotation.y -= dt * 0.62 * cloudSpeed;
    this.handles.cloudArmillaryOuter.rotation.z = Math.cos(this.elapsedSec * 0.55 * cloudSpeed) * 0.25;
    this.handles.cloudArmillaryInner.rotation.y += dt * 1.1 * cloudSpeed;

    // Antigravity Logo Mascot zero-gravity levitation + orbiting energy orbs (AI-CODER)
    const coderActiveFloat = hud.sanctuaryCelebrate === 'coder' || isCoderWorking;
    const coderFloat = coderActiveFloat
      ? Math.abs(Math.sin(this.elapsedSec * 5.0)) * 0.42 + 0.14
      : Math.sin(this.elapsedSec * 2.0) * 0.16;
    this.handles.coderMascot.position.y = 0.58 + coderFloat;
    this.handles.coderMascot.rotation.y +=
      dt * (coderActiveFloat ? 1.7 : 0.45);
    if (this.handles.coderMascotOrbit) {
      this.handles.coderMascotOrbit.rotation.y -= dt * (coderActiveFloat ? 2.4 : 1.35);
      this.handles.coderMascotOrbit.rotation.z =
        Math.sin(this.elapsedSec * 1.4) * 0.22;
    }

    // Gemini 4-Point Crystal Star Mascot celestial levitation + orbiting mini sparkles (AI-CLOUD)
    const cloudActiveFloat = hud.sanctuaryCelebrate === 'cloud' || isCloudWorking;
    const cloudFloat = cloudActiveFloat
      ? Math.abs(Math.sin(this.elapsedSec * 5.2)) * 0.44 + 0.14
      : Math.sin(this.elapsedSec * 2.1 + 1.0) * 0.16;
    this.handles.cloudMascot.position.y = 0.58 + cloudFloat;
    this.handles.cloudMascot.rotation.y +=
      dt * (cloudActiveFloat ? 1.85 : 0.42);
    if (this.handles.cloudMascotOrbit) {
      this.handles.cloudMascotOrbit.rotation.y -= dt * (cloudActiveFloat ? 2.4 : 1.35);
      this.handles.cloudMascotOrbit.rotation.z =
        Math.sin(this.elapsedSec * 1.4 + 0.8) * 0.22;
    }

    // Rising Sparkles around both sanctuaries
    for (const [idx, sparks] of [this.handles.coderSparkles, this.handles.cloudSparkles].entries()) {
      const boost = (idx === 0 && isCoderWorking) || (idx === 1 && isCloudWorking) ? 2.1 : 1.0;
      const posAttr = sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) + dt * 0.85 * boost;
        if (y > 5.2) y = 0.9;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
      sparks.rotation.y += dt * 0.4 * boost;
    }

    // Falling Winter Snow
    if (this.handles.snowParticles.visible) {
      const snowAttr = this.handles.snowParticles.geometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let i = 0; i < snowAttr.count; i++) {
        let y = snowAttr.getY(i) - dt * 2.6;
        let x = snowAttr.getX(i) + Math.sin(this.elapsedSec + i) * dt * 0.45;
        if (y < 0.1) y = 24;
        if (x > 31) x = -31;
        snowAttr.setXYZ(i, x, y, snowAttr.getZ(i));
      }
      snowAttr.needsUpdate = true;
    }

    // 3.5. 3D Village Launch Celebration Fireworks, Confetti Fountain & Golden Rotunda Halo!
    const { celebrationRig } = this.handles;
    if (hud.celebrationActive) {
      celebrationRig.mesh.visible = true;
      celebrationRig.haloRing.visible = true;
      const cTime = hud.celebrationElapsedSec;
      const haloWave = (cTime * 0.85) % 1;
      celebrationRig.haloRing.scale.setScalar(0.85 + haloWave * 1.45);
      celebrationRig.haloRing.position.y = 4.2 + haloWave * 4.4;
      celebrationRig.haloMat.opacity = Math.sin(haloWave * Math.PI) * 0.72;

      const gravity = 4.8;
      const dummy = this.confettiDummy;
      for (let i = 0; i < celebrationRig.seeds.length; i++) {
        const s = celebrationRig.seeds[i];
        const rawT = cTime - s.delay;
        if (rawT < 0) {
          dummy.position.set(s.originX, -20, s.originZ);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          celebrationRig.mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        // Loop 2 festive bursts smoothly across the 5.6s celebration window
        const localT = rawT % 2.6;
        const drag = 1 - Math.min(0.45, localT * 0.14);
        const x = s.originX + s.vx * localT * drag + Math.sin(localT * 4.2 + i) * 0.25;
        const y = s.originY + s.vy * localT - 0.5 * gravity * localT * localT;
        const z = s.originZ + s.vz * localT * drag + Math.cos(localT * 3.8 + i) * 0.25;
        if (y < 0.25) {
          dummy.position.set(x, -20, z);
          dummy.scale.setScalar(0.001);
        } else {
          const fadeOut = Math.max(0, 1 - Math.max(0, cTime - 4.4) / 1.2);
          dummy.position.set(x, y, z);
          dummy.rotation.set(
            localT * s.rotSpeedX,
            localT * s.rotSpeedY,
            localT * s.rotSpeedZ
          );
          dummy.scale.setScalar(s.scale * fadeOut);
        }
        dummy.updateMatrix();
        celebrationRig.mesh.setMatrixAt(i, dummy.matrix);
      }
      celebrationRig.mesh.instanceMatrix.needsUpdate = true;
    } else {
      celebrationRig.mesh.visible = false;
      celebrationRig.haloRing.visible = false;
      celebrationRig.haloMat.opacity = 0;
    }

    if (hud.celebrationDone && this.celebrationCompleteNotifiedKey !== this.stageKey) {
      this.celebrationCompleteNotifiedKey = this.stageKey;
      this.callbacks.onCelebrationComplete?.();
    }

    // 4. Position Cardboard Parcels along Multi-Segment Non-Crossing Conveyor Splines
    const parcelCoords: Record<string, ProjectedPoint> = {};
    this.handles.parcelPool.forEach((slot, idx) => {
      const spec = hud.parcels[idx];
      if (!spec || (spec.scale !== undefined && spec.scale <= 0.02)) {
        slot.group.visible = false;
        return;
      }
      const sampled = this.sampleParcelRoute(spec.trackId, spec.progress);
      if (!sampled) {
        slot.group.visible = false;
        return;
      }
      const { pos, tan } = sampled;

      slot.group.visible = true;
      slot.group.position.set(pos.x, pos.y + 0.04, pos.z);
      slot.group.rotation.y = Math.atan2(tan.x, tan.z);
      slot.group.scale.setScalar(spec.scale ?? 1);
      slot.ribbonMat.color.set(spec.isRework ? '#DC2626' : spec.accentColor);

      if (spec.isHero) {
        this.heroParcelPos.copy(pos);
        this.heroParcelDir.copy(tan);
      }

      parcelCoords[spec.id] = this.projectWorldPoint(
        new THREE.Vector3(pos.x, pos.y + 1.05, pos.z)
      );
    });

    // 5. Hover Ring Feedback on Layer-1 Raycasted Buildings
    this.handles.hoverRings.forEach((ring, id) => {
      const mat = ring.material as THREE.MeshBasicMaterial;
      const targetOp = id === this.hoveredBuildingId ? 0.85 : 0;
      mat.opacity = THREE.MathUtils.damp(mat.opacity, targetOp, 10, dt);
    });

    // 6. Smooth Damped Camera Presets / Parcel Follow-Cam
    if (this.activeCameraPreset === 'follow') {
      // Dynamic low-angle behind/beside hero parcel tracking down conveyor!
      this.cameraGoalTarget.set(
        this.heroParcelPos.x,
        this.heroParcelPos.y + 0.65,
        this.heroParcelPos.z
      );
      this.cameraGoalPos.set(
        this.heroParcelPos.x - this.heroParcelDir.x * 6.5 - 2.2,
        4.6,
        this.heroParcelPos.z - this.heroParcelDir.z * 6.5 + 5.8
      );
    }

    if (this.activeCameraPreset !== null) {
      const lambda = this.activeCameraPreset === 'follow' ? 4.2 : 5.2;
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.cameraGoalPos.x,
        lambda,
        dt
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.cameraGoalPos.y,
        lambda,
        dt
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.cameraGoalPos.z,
        lambda,
        dt
      );
      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.cameraGoalTarget.x,
        lambda,
        dt
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.cameraGoalTarget.y,
        lambda,
        dt
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.cameraGoalTarget.z,
        lambda,
        dt
      );
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // 7. Throttled 3D-to-2D Projection Emission (~18 Hz) for crisp DOM callout pills & terminal bubble
    if (nowMs - this.lastOverlayEmitMs > 55) {
      this.lastOverlayEmitMs = nowMs;

      const comicAnchorVec =
        this.handles.buildingAnchors.get(hud.comicBurst.anchorBuilding) ??
        new THREE.Vector3(-14.8, 4.4, -7.4);
      const terminalAnchorVec =
        this.handles.buildingAnchors.get(hud.terminal.anchorBuilding) ??
        new THREE.Vector3(13.6, 4.2, -6.2);

      const stationTags = BUILDING_LABELS.map((b) => {
        const anchor =
          this.handles.buildingAnchors.get(b.buildingId) ?? new THREE.Vector3();
        const proj = this.projectWorldPoint(anchor);
        const isWorking = activeWorkingSet.has(b.buildingId);
        const workingLabel =
          b.buildingId === 'BG-OPS' && this.runningTasksCount > 0 && !hud.workingBuildingIds.includes('BG-OPS')
            ? `后台作业 ${this.runningTasksCount} 项`
            : isWorking
              ? hud.workingStageLabel
              : '';
        return {
          ...b,
          x: proj.x,
          y: proj.y,
          visible: proj.visible,
          hovered: b.buildingId === this.hoveredBuildingId,
          isWorking,
          workingLabel,
        };
      });

      this.callbacks.onOverlayUpdate({
        hud,
        atmosphere,
        parcelCoords,
        comicAnchor: this.projectWorldPoint(
          comicAnchorVec.clone().add(new THREE.Vector3(0, 0.9, 0))
        ),
        terminalAnchor: this.projectWorldPoint(
          terminalAnchorVec.clone().add(new THREE.Vector3(-1.45, 0.45, -0.25))
        ),
        stationTags,
        hoveredBuildingId: this.hoveredBuildingId,
      });
    }

    this.scheduleNextFrame();
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.timerId);
    this.resizeObserver.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);

    this.controls.dispose();
    this.textures.dispose();
    this.envRenderTarget.dispose();
    this.pmremGenerator.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
