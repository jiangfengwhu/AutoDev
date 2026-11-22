import * as THREE from 'three';

export interface CleanroomMaterialPalette {
  ceramicWhite: THREE.MeshStandardMaterial;
  plinthWhite: THREE.MeshStandardMaterial;
  plinthBaseSlate: THREE.MeshStandardMaterial;
  plinthShadowGroove: THREE.MeshStandardMaterial;
  floorTile: THREE.MeshStandardMaterial;
  brushedAluminum: THREE.MeshStandardMaterial;
  matteSilver: THREE.MeshStandardMaterial;
  frostedGlass: THREE.MeshStandardMaterial;
  conveyorGlass: THREE.MeshStandardMaterial;
  darkGlassBezel: THREE.MeshStandardMaterial;
  darkMonitorBack: THREE.MeshStandardMaterial;
  avatarCeramic: THREE.MeshStandardMaterial;
  avatarJoint: THREE.MeshStandardMaterial;
  avatarVisor: THREE.MeshStandardMaterial;
  emissiveBlue: THREE.MeshStandardMaterial;
  emissiveEmerald: THREE.MeshStandardMaterial;
  emissiveAmber: THREE.MeshStandardMaterial;
  emissiveRed: THREE.MeshStandardMaterial;
  emissiveIdle: THREE.MeshStandardMaterial;
  contactShadowMat: THREE.MeshBasicMaterial;
  gridFloorTexture: THREE.CanvasTexture;
  dispose: () => void;
}

function createSubtleFloorGridTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#F6F8FB';
    ctx.fillRect(0, 0, size, size);

    // Architectural cleanroom ceramic tile seams with clear legible depth
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.36)';
    ctx.lineWidth = 2;
    const step = 64;
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    // Precision micro-dot intersections
    ctx.fillStyle = 'rgba(100, 116, 139, 0.45)';
    for (let x = 0; x <= size; x += step) {
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2.2);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.06,
      size / 2,
      size / 2,
      size * 0.5
    );
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.28)');
    grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.12)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCleanroomMaterials(
  isSoftwareGl: boolean,
  maxAnisotropy: number
): CleanroomMaterialPalette {
  const gridFloorTexture = createSubtleFloorGridTexture(maxAnisotropy);
  const shadowTex = createContactShadowTexture();

  // Matte architectural ceramic white with rich shading response (never blown-out flat)
  const ceramicWhite = new THREE.MeshStandardMaterial({
    color: 0xf6f8fb,
    roughness: 0.84,
    metalness: 0.04,
  });

  const plinthWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0.08,
  });

  const plinthBaseSlate = new THREE.MeshStandardMaterial({
    color: 0xb6c3d4,
    roughness: 0.52,
    metalness: 0.32,
  });

  const plinthShadowGroove = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.65,
    metalness: 0.25,
  });

  const floorTile = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: gridFloorTexture,
    roughness: 0.78,
    metalness: 0.05,
  });

  const brushedAluminum = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.28,
    metalness: 0.72,
  });

  const matteSilver = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.42,
    metalness: 0.48,
  });

  // Cool architectural frosted glass with subtle ice-blue tint so partitions & tabletops read crisply
  const frostedGlass = new THREE.MeshStandardMaterial({
    color: 0xd4e4f7,
    roughness: isSoftwareGl ? 0.22 : 0.16,
    metalness: 0.1,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });

  const conveyorGlass = new THREE.MeshStandardMaterial({
    color: 0xe6f0fb,
    roughness: 0.18,
    metalness: 0.14,
    transparent: true,
    opacity: 0.78,
  });

  const darkGlassBezel = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.24,
    metalness: 0.58,
  });

  const darkMonitorBack = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.42,
    metalness: 0.48,
  });

  const avatarCeramic = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0.12,
  });

  const avatarJoint = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.3,
    metalness: 0.68,
  });

  const avatarVisor = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.1,
    metalness: 0.85,
    emissive: 0x1e3a8a,
    emissiveIntensity: 0.3,
  });

  const emissiveBlue = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    emissive: 0x2563eb,
    emissiveIntensity: 0.85,
    roughness: 0.25,
    metalness: 0.1,
  });

  const emissiveEmerald = new THREE.MeshStandardMaterial({
    color: 0x059669,
    emissive: 0x059669,
    emissiveIntensity: 0.8,
    roughness: 0.25,
    metalness: 0.1,
  });

  const emissiveAmber = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: 0xd97706,
    emissiveIntensity: 0.85,
    roughness: 0.25,
    metalness: 0.1,
  });

  const emissiveRed = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xdc2626,
    emissiveIntensity: 0.95,
    roughness: 0.25,
    metalness: 0.1,
  });

  const emissiveIdle = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    emissive: 0x94a3b8,
    emissiveIntensity: 0.15,
    roughness: 0.45,
    metalness: 0.2,
  });

  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });

  const allMaterials: THREE.Material[] = [
    ceramicWhite,
    plinthWhite,
    plinthBaseSlate,
    plinthShadowGroove,
    floorTile,
    brushedAluminum,
    matteSilver,
    frostedGlass,
    conveyorGlass,
    darkGlassBezel,
    darkMonitorBack,
    avatarCeramic,
    avatarJoint,
    avatarVisor,
    emissiveBlue,
    emissiveEmerald,
    emissiveAmber,
    emissiveRed,
    emissiveIdle,
    contactShadowMat,
  ];

  return {
    ceramicWhite,
    plinthWhite,
    plinthBaseSlate,
    plinthShadowGroove,
    floorTile,
    brushedAluminum,
    matteSilver,
    frostedGlass,
    conveyorGlass,
    darkGlassBezel,
    darkMonitorBack,
    avatarCeramic,
    avatarJoint,
    avatarVisor,
    emissiveBlue,
    emissiveEmerald,
    emissiveAmber,
    emissiveRed,
    emissiveIdle,
    contactShadowMat,
    gridFloorTexture,
    dispose: () => {
      gridFloorTexture.dispose();
      shadowTex.dispose();
      for (const m of allMaterials) {
        m.dispose();
      }
    },
  };
}
