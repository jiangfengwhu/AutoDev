import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  FactoryPipelineSnapshot,
  FactoryStationId,
} from '../../lib/factoryPipelineState';
import {
  applyCameraOrbitAndParallax,
  CAMERA_FOV,
  clampInspectYaw,
  computeStudioCameraPose,
  evaluateDollyTransition,
  getStationWorldX,
} from '../../three/cleanroomMath';
import { createCleanroomMaterials } from '../../three/cleanroomMaterials';
import {
  buildCleanroomFactoryScene,
  type InteractiveHitMeta,
} from '../../three/studioBuilders';

export interface CleanroomSceneCanvasProps {
  snapshot: FactoryPipelineSnapshot;
  focusedStationId: FactoryStationId;
  isReworkTransition?: boolean;
  onInteract3D: (meta: InteractiveHitMeta) => void;
}

export function CleanroomSceneCanvas({
  snapshot,
  focusedStationId,
  isReworkTransition = false,
  onInteract3D,
}: CleanroomSceneCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const onInteractRef = useRef(onInteract3D);
  onInteractRef.current = onInteract3D;

  // Camera dolly transition state stored in ref to avoid re-creating WebGL context
  const dollyRef = useRef<{
    fromStation: FactoryStationId;
    toStation: FactoryStationId;
    startSec: number;
    durationSec: number;
    active: boolean;
    isRework: boolean;
  }>({
    fromStation: focusedStationId,
    toStation: focusedStationId,
    startSec: 0,
    durationSec: 0.96,
    active: false,
    isRework: false,
  });

  const sceneHandlesRef = useRef<ReturnType<typeof buildCleanroomFactoryScene> | null>(null);
  const renderNowRef = useRef<(() => void) | null>(null);

  // Trigger smooth ~1.0s cinematic dolly glide when focusedStationId changes
  useEffect(() => {
    const d = dollyRef.current;
    if (d.toStation !== focusedStationId) {
      d.fromStation = d.toStation;
      d.toStation = focusedStationId;
      d.startSec = performance.now() * 0.001;
      const isReworkJump =
        isReworkTransition ||
        (d.fromStation === 'ST-03' &&
          focusedStationId === 'ST-02' &&
          snapshotRef.current.tracks.reworkSt03ToSt02 === 'rework');
      d.isRework = isReworkJump;
      d.durationSec = isReworkJump ? 1.18 : 0.95;
      d.active = true;
      renderNowRef.current?.();
    }
  }, [focusedStationId, isReworkTransition]);

  // Push latest snapshot telemetry into 3D textures/materials immediately & render synchronously
  useEffect(() => {
    sceneHandlesRef.current?.updateFromSnapshot(snapshot);
    renderNowRef.current?.();
  }, [snapshot]);

  useEffect(() => {
    const host = hostRef.current;
    const canvasWrap = canvasWrapRef.current;
    if (!host || !canvasWrap) return;

    const initWidth = Math.max(320, host.clientWidth || window.innerWidth);
    const initHeight = Math.max(240, host.clientHeight || window.innerHeight);

    // 1. Detect software WebGL (SwiftShader / llvmpipe) to keep rendering cost safe
    const probeCanvas = document.createElement('canvas');
    const probeGl =
      probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    let isSoftwareGl = false;
    if (probeGl) {
      const dbg = probeGl.getExtension('WEBGL_debug_renderer_info');
      const rendererStr = dbg
        ? String(probeGl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        : String(probeGl.getParameter(probeGl.RENDERER));
      isSoftwareGl = /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(rendererStr);
    }

    // 2. Renderer setup (preserveDrawingBuffer on software GL prevents blank screenshot clears)
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: false,
      preserveDrawingBuffer: isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(initWidth, initHeight, false);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.dataset.testid = 'cleanroom-3d-canvas';

    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(renderer.domElement);

    // 3. Scene, Crisp Platinum Cleanroom Mist (#EAEFF5) & RoomEnvironment IBL
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaeff5);
    scene.fog = new THREE.Fog(0xeaeff5, 22, 46);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.5;

    // 4. Camera (Telephoto miniature architectural FOV = 32)
    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      initWidth / initHeight,
      0.2,
      120
    );
    const initialPose = computeStudioCameraPose(dollyRef.current.toStation);
    camera.position.set(
      initialPose.position.x,
      initialPose.position.y,
      initialPose.position.z
    );
    camera.lookAt(initialPose.target.x, initialPose.target.y, initialPose.target.z);

    // 5. Sculpted Swiss Cleanroom Studio Lighting (balanced for ceramic relief, zero washout)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.02);
    hemiLight.position.set(0, 28, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffcf7, 1.18);
    keyLight.position.set(initialPose.target.x + 9, 16, 10);
    keyLight.target.position.set(initialPose.target.x, 0, 0);
    scene.add(keyLight.target);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 2;
      keyLight.shadow.camera.far = 38;
      keyLight.shadow.camera.left = -9;
      keyLight.shadow.camera.right = 9;
      keyLight.shadow.camera.top = 9;
      keyLight.shadow.camera.bottom = -9;
      keyLight.shadow.bias = -0.0002;
      keyLight.shadow.normalBias = 0.025;
      keyLight.shadow.radius = 3.5;
    }
    scene.add(keyLight);

    // Cool rim fill from left-rear so white walls & desks exhibit crisp architectural facets
    const fillLight = new THREE.DirectionalLight(0xbfdbfe, 0.48);
    fillLight.position.set(-14, 8, -9);
    scene.add(fillLight);

    // Continuous subtle cleanroom infinite floor plane beneath floating studios
    const baseFloorGeo = new THREE.PlaneGeometry(420, 120);
    baseFloorGeo.rotateX(-Math.PI / 2);
    const baseFloorMat = new THREE.MeshStandardMaterial({
      color: 0xe6ecf4,
      roughness: 0.94,
      metalness: 0.0,
    });
    const baseFloor = new THREE.Mesh(baseFloorGeo, baseFloorMat);
    baseFloor.position.set(80, -0.62, 0);
    baseFloor.receiveShadow = true;
    scene.add(baseFloor);

    // 6. Build all 6 3D Miniature Studios & Conveyor Corridor
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const materials = createCleanroomMaterials(isSoftwareGl, maxAnisotropy);
    const factoryScene = buildCleanroomFactoryScene(materials, maxAnisotropy);
    scene.add(factoryScene.root);
    factoryScene.updateFromSnapshot(snapshotRef.current);
    sceneHandlesRef.current = factoryScene;

    // 7. Interactive Pointer State: Clamped +/-22 deg Drag Inspect + Micro-Parallax + Raycast Click
    let inspectYaw = 0;
    let targetInspectYaw = 0;
    let parallaxX = 0;
    let parallaxY = 0;
    let smoothParallaxX = 0;
    let smoothParallaxY = 0;

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragMovedDist = 0;
    let dragInitialYaw = 0;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      ndc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragMovedDist = 0;
      dragInitialYaw = targetInspectYaw;
      renderer.domElement.style.cursor = 'grabbing';
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      parallaxX = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      parallaxY = -(((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2);

      if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        dragMovedDist = Math.max(dragMovedDist, Math.hypot(dx, dy));
        targetInspectYaw = clampInspectYaw(dragInitialYaw - dx * 0.0028);
        return;
      }

      updatePointerNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(factoryScene.hitMeshes, false);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      renderer.domElement.style.cursor = 'grab';

      if (dragMovedDist < 6) {
        updatePointerNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(factoryScene.hitMeshes, false);
        if (hits.length > 0) {
          const meta = hits[0].object.userData.hitMeta as InteractiveHitMeta | undefined;
          if (meta) {
            onInteractRef.current(meta);
          }
        }
      }

      targetInspectYaw = 0;
    };

    const handlePointerLeave = () => {
      isDragging = false;
      targetInspectYaw = 0;
      parallaxX = 0;
      parallaxY = 0;
      renderer.domElement.style.cursor = 'default';
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

    // 8. Wall-clock Animation Loop (zero deprecated THREE.Clock!) + Software WebGL Fence Pacing
    const mountStartSec = performance.now() * 0.001;
    let lastFrameWallSec = mountStartSec;
    const gl = renderer.getContext();
    let disposed = false;
    let rafId = 0;
    let timeoutId = 0;
    let lastBlurPx = 0;

    const renderSingleFrame = () => {
      if (disposed) return;

      const nowWallSec = performance.now() * 0.001;
      const dtSec = Math.min(0.05, Math.max(0.004, nowWallSec - lastFrameWallSec));
      lastFrameWallSec = nowWallSec;
      const elapsedSec = nowWallSec - mountStartSec;

      const d = dollyRef.current;

      // Update camera dolly glide or settled framing
      let baseCamPos = computeStudioCameraPose(d.toStation).position;
      let baseTarget = computeStudioCameraPose(d.toStation).target;
      let nextFov = CAMERA_FOV;
      let blurPx = 0;

      if (d.active) {
        const progress = (nowWallSec - d.startSec) / Math.max(0.1, d.durationSec);
        if (progress >= 1) {
          d.active = false;
          d.fromStation = d.toStation;
          blurPx = 0;
        } else {
          const sample = evaluateDollyTransition(d.fromStation, d.toStation, progress, {
            isReworkRewind: d.isRework,
          });
          baseCamPos = sample.cameraPos;
          baseTarget = sample.targetPos;
          nextFov = sample.fov;
          blurPx = sample.focusBlurPx;
        }
      }

      inspectYaw += (targetInspectYaw - inspectYaw) * Math.min(1, dtSec * 8);
      smoothParallaxX += (parallaxX - smoothParallaxX) * Math.min(1, dtSec * 4.5);
      smoothParallaxY += (parallaxY - smoothParallaxY) * Math.min(1, dtSec * 4.5);

      const finalCamPos = applyCameraOrbitAndParallax(
        baseCamPos,
        baseTarget,
        d.active ? 0 : inspectYaw,
        d.active ? 0 : smoothParallaxX,
        d.active ? 0 : smoothParallaxY
      );

      camera.position.set(finalCamPos.x, finalCamPos.y, finalCamPos.z);
      camera.lookAt(baseTarget.x, baseTarget.y, baseTarget.z);
      if (Math.abs(camera.fov - nextFov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }

      if (Math.abs(blurPx - lastBlurPx) > 0.05) {
        lastBlurPx = blurPx;
        canvasWrap.style.filter = blurPx > 0.05 ? `blur(${blurPx}px)` : 'none';
      }

      // Keep shadow-casting key light centered on active camera X
      const focusX = baseTarget.x;
      keyLight.position.set(focusX + 9, 16, 10.5);
      keyLight.target.position.set(focusX, 0.5, 0);
      keyLight.target.updateMatrixWorld();

      renderer.domElement.dataset.focusX = String(Math.round(focusX));
      renderer.domElement.dataset.stationX = String(getStationWorldX(d.toStation));

      factoryScene.tick(elapsedSec, dtSec, snapshotRef.current);
      renderer.render(scene, camera);
    };

    renderNowRef.current = renderSingleFrame;

    // Responsive ResizeObserver renders immediately so resize NEVER flashes blank
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || disposed) return;
      const w = Math.max(320, Math.floor(entry.contentRect.width));
      const h = Math.max(240, Math.floor(entry.contentRect.height));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderSingleFrame();
    });
    resizeObserver.observe(host);

    const afterDraw = (next: () => void) => {
      if (disposed) return;
      if (!isSoftwareGl) {
        rafId = requestAnimationFrame(next);
        return;
      }
      const gl2 = gl as WebGL2RenderingContext;
      if (typeof gl2.fenceSync === 'function') {
        const fence = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (fence) {
          gl2.flush();
          const poll = () => {
            if (disposed) {
              gl2.deleteSync(fence);
              return;
            }
            const status = gl2.clientWaitSync(fence, 0, 0);
            if (status === gl2.TIMEOUT_EXPIRED) {
              timeoutId = window.setTimeout(poll, 16);
              return;
            }
            gl2.deleteSync(fence);
            timeoutId = window.setTimeout(() => {
              if (!disposed) rafId = requestAnimationFrame(next);
            }, 80);
          };
          poll();
          return;
        }
      }
      timeoutId = window.setTimeout(() => {
        if (!disposed) rafId = requestAnimationFrame(next);
      }, 90);
    };

    const tick = () => {
      if (disposed) return;
      renderSingleFrame();
      afterDraw(tick);
    };

    tick();

    return () => {
      disposed = true;
      renderNowRef.current = null;
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);

      sceneHandlesRef.current = null;
      factoryScene.dispose();
      materials.dispose();
      baseFloorGeo.dispose();
      baseFloorMat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative w-full h-full overflow-hidden bg-[#EAEFF5] select-none"
    >
      <div
        ref={canvasWrapRef}
        className="w-full h-full will-change-[filter] transition-[filter] duration-75"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 84% 78% at 50% 50%, rgba(234,239,245,0) 64%, rgba(234,239,245,0.44) 100%)',
        }}
      />
    </div>
  );
}
