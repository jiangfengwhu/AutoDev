import * as THREE from 'three';

export interface ProceduralTextureBundle {
  meadowDay: THREE.CanvasTexture;
  meadowSnow: THREE.CanvasTexture;
  courtyardTiles: THREE.CanvasTexture;
  tileBump: THREE.CanvasTexture;
  gravelRoad: THREE.CanvasTexture;
  brickWall: THREE.CanvasTexture;
  brickBump: THREE.CanvasTexture;
  solarPanel: THREE.CanvasTexture;
  conveyorBelt: THREE.CanvasTexture;
  clockFace: THREE.CanvasTexture;
  stainedGlassGemini: THREE.CanvasTexture;
  stainedGlassBlue: THREE.CanvasTexture;
  parcelLabel: THREE.CanvasTexture;
  cloudTerminalFace: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  warmGlowDisc: THREE.CanvasTexture;
  dispose: () => void;
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  options?: { repeatX?: number; repeatY?: number; srgb?: boolean }
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace =
    options?.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (options?.repeatX || options?.repeatY) {
    tex.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
  }
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function makeCanvas(
  w: number,
  h: number
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

export function createProceduralTextures(
  maxAnisotropy: number
): ProceduralTextureBundle {
  // 1. Dappled vibrant sunlit spring meadow grass
  const [meadowCanvas, mCtx] = makeCanvas(512, 512);
  mCtx.fillStyle = '#73B856';
  mCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 950; i++) {
    const x = (i * 137.5) % 512;
    const y = (i * 293.3) % 512;
    const r = 8 + (i % 24);
    mCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(136, 206, 94, 0.24)'
        : i % 3 === 1
        ? 'rgba(88, 154, 62, 0.2)'
        : 'rgba(158, 218, 110, 0.18)';
    mCtx.beginPath();
    mCtx.arc(x, y, r, 0, Math.PI * 2);
    mCtx.fill();
  }
  for (let i = 0; i < 650; i++) {
    const x = (i * 89.7) % 512;
    const y = (i * 197.1) % 512;
    mCtx.fillStyle =
      i % 2 === 0 ? 'rgba(62,122,46,0.26)' : 'rgba(178,228,118,0.26)';
    mCtx.fillRect(x, y, 2, 7);
  }
  const meadowDay = finalizeTexture(meadowCanvas, maxAnisotropy, {
    repeatX: 18,
    repeatY: 18,
  });

  // 2. Soft winter snow meadow
  const [snowCanvas, sCtx] = makeCanvas(512, 512);
  sCtx.fillStyle = '#EBF2F7';
  sCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 500; i++) {
    const x = (i * 149) % 512;
    const y = (i * 271) % 512;
    const r = 10 + (i % 28);
    sCtx.fillStyle =
      i % 2 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(195,216,232,0.26)';
    sCtx.beginPath();
    sCtx.arc(x, y, r, 0, Math.PI * 2);
    sCtx.fill();
  }
  const meadowSnow = finalizeTexture(snowCanvas, maxAnisotropy, {
    repeatX: 16,
    repeatY: 16,
  });

  // 3. Warm miniature courtyard sandstone pavers + tactile bump map
  const [tileCanvas, tCtx] = makeCanvas(256, 256);
  const [tileBumpCanvas, tbCtx] = makeCanvas(256, 256);
  tCtx.fillStyle = '#D2BE9F';
  tCtx.fillRect(0, 0, 256, 256);
  tbCtx.fillStyle = '#2B2B2B';
  tbCtx.fillRect(0, 0, 256, 256);
  const step = 32;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const shade = ((gx * 7 + gy * 13) % 5) - 2;
      tCtx.fillStyle = `rgb(${226 + shade * 4}, ${208 + shade * 4}, ${180 + shade * 3})`;
      tCtx.fillRect(gx * step + 2, gy * step + 2, step - 4, step - 4);
      tCtx.strokeStyle = 'rgba(148, 124, 96, 0.38)';
      tCtx.lineWidth = 1;
      tCtx.strokeRect(gx * step + 1.5, gy * step + 1.5, step - 3, step - 3);

      const bv = 195 + shade * 10;
      tbCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
      tbCtx.fillRect(gx * step + 2.5, gy * step + 2.5, step - 5, step - 5);
    }
  }
  const courtyardTiles = finalizeTexture(tileCanvas, maxAnisotropy, {
    repeatX: 3,
    repeatY: 3,
  });
  const tileBump = finalizeTexture(tileBumpCanvas, maxAnisotropy, {
    repeatX: 3,
    repeatY: 3,
    srgb: false,
  });

  // 4. Sandy-cream cobblestone / gravel avenue
  const [gravelCanvas, gCtx] = makeCanvas(256, 256);
  gCtx.fillStyle = '#E7D8BE';
  gCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 850; i++) {
    const x = (i * 73.1) % 256;
    const y = (i * 151.7) % 256;
    const r = 1.2 + (i % 3);
    gCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(196, 174, 140, 0.45)'
        : i % 3 === 1
        ? 'rgba(248, 240, 224, 0.55)'
        : 'rgba(168, 146, 114, 0.35)';
    gCtx.beginPath();
    gCtx.arc(x, y, r, 0, Math.PI * 2);
    gCtx.fill();
  }
  const gravelRoad = finalizeTexture(gravelCanvas, maxAnisotropy, {
    repeatX: 6,
    repeatY: 14,
  });

  // 5. Warm red-terracotta miniature brick facade + mortar recess bump map
  const [brickCanvas, bCtx] = makeCanvas(256, 256);
  const [brickBumpCanvas, bbCtx] = makeCanvas(256, 256);
  bCtx.fillStyle = '#DDD3C3'; // mortar
  bCtx.fillRect(0, 0, 256, 256);
  bbCtx.fillStyle = '#303030'; // recessed mortar
  bbCtx.fillRect(0, 0, 256, 256);
  const bw = 32;
  const bh = 16;
  for (let row = 0; row < 16; row++) {
    const offset = (row % 2) * (bw / 2);
    for (let col = -1; col < 9; col++) {
      const hueJitter = ((row * 11 + col * 7) % 5) - 2;
      bCtx.fillStyle = `rgb(${186 + hueJitter * 7}, ${95 + hueJitter * 5}, ${68 + hueJitter * 4})`;
      bCtx.fillRect(col * bw + offset + 1.5, row * bh + 1.5, bw - 3, bh - 3);

      const bv = 208 + hueJitter * 8;
      bbCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
      bbCtx.fillRect(col * bw + offset + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }
  const brickWall = finalizeTexture(brickCanvas, maxAnisotropy, {
    repeatX: 2.5,
    repeatY: 2.0,
  });
  const brickBump = finalizeTexture(brickBumpCanvas, maxAnisotropy, {
    repeatX: 2.5,
    repeatY: 2.0,
    srgb: false,
  });

  // 6. Crisp photovoltaic solar panel grid
  const [solarCanvas, solCtx] = makeCanvas(256, 256);
  solCtx.fillStyle = '#1B3358';
  solCtx.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      solCtx.fillStyle = (r + c) % 2 === 0 ? '#214170' : '#183054';
      solCtx.fillRect(c * 64 + 4, r * 42 + 3, 56, 36);
    }
  }
  solCtx.strokeStyle = 'rgba(203, 224, 248, 0.68)';
  solCtx.lineWidth = 2;
  for (let c = 1; c < 4; c++) {
    solCtx.beginPath();
    solCtx.moveTo(c * 64, 0);
    solCtx.lineTo(c * 64, 256);
    solCtx.stroke();
  }
  for (let r = 1; r < 6; r++) {
    solCtx.beginPath();
    solCtx.moveTo(0, r * 42);
    solCtx.lineTo(256, r * 42);
    solCtx.stroke();
  }
  const solarPanel = finalizeTexture(solarCanvas, maxAnisotropy);

  // 7. Ribbed dark charcoal rubber conveyor belt
  const [beltCanvas, bltCtx] = makeCanvas(128, 256);
  bltCtx.fillStyle = '#333A45';
  bltCtx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 24) {
    bltCtx.fillStyle = '#242A33';
    bltCtx.fillRect(0, y, 128, 6);
    bltCtx.fillStyle = '#475161';
    bltCtx.fillRect(0, y + 6, 128, 3);
  }
  bltCtx.strokeStyle = 'rgba(255,255,255,0.16)';
  bltCtx.lineWidth = 3;
  for (let y = 16; y < 256; y += 64) {
    bltCtx.beginPath();
    bltCtx.moveTo(42, y + 10);
    bltCtx.lineTo(64, y);
    bltCtx.lineTo(86, y + 10);
    bltCtx.stroke();
  }
  const conveyorBelt = finalizeTexture(beltCanvas, maxAnisotropy, {
    repeatX: 1,
    repeatY: 16,
  });

  // 8. Classical analog rotunda clock dial (clean face — hands are real-time 3D meshes!)
  const [clockCanvas, cCtx] = makeCanvas(256, 256);
  cCtx.fillStyle = '#FAF6EB';
  cCtx.beginPath();
  cCtx.arc(128, 128, 122, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.strokeStyle = '#9C7B47';
  cCtx.lineWidth = 10;
  cCtx.stroke();
  // Subtle 60-minute outer graduation ring
  cCtx.strokeStyle = '#94A3B8';
  for (let m = 0; m < 60; m++) {
    if (m % 5 === 0) continue;
    const a = (m / 60) * Math.PI * 2;
    cCtx.lineWidth = 1.6;
    cCtx.beginPath();
    cCtx.moveTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98);
    cCtx.lineTo(128 + Math.cos(a) * 106, 128 + Math.sin(a) * 106);
    cCtx.stroke();
  }
  // Crisp 12-hour indices
  cCtx.strokeStyle = '#1E293B';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cCtx.lineWidth = i % 3 === 0 ? 7 : 3.5;
    cCtx.beginPath();
    cCtx.moveTo(128 + Math.cos(a) * (i % 3 === 0 ? 83 : 89), 128 + Math.sin(a) * (i % 3 === 0 ? 83 : 89));
    cCtx.lineTo(128 + Math.cos(a) * 107, 128 + Math.sin(a) * 107);
    cCtx.stroke();
  }
  const clockFace = finalizeTexture(clockCanvas, maxAnisotropy);
  clockFace.wrapS = THREE.ClampToEdgeWrapping;
  clockFace.wrapT = THREE.ClampToEdgeWrapping;

  // 9. Gemini Celestial Sapphire-Cyan-Gold Stained-Glass Rose Window (with 4-point Gemini Star motif)
  const makeGeminiStainedGlass = () => {
    const [cv, ctx] = makeCanvas(512, 512);
    ctx.clearRect(0, 0, 512, 512);
    const grad = ctx.createRadialGradient(256, 256, 16, 256, 256, 244);
    grad.addColorStop(0, '#F0F9FF');
    grad.addColorStop(0.32, '#7DD3FC');
    grad.addColorStop(0.65, '#3B82F6');
    grad.addColorStop(0.88, '#4F46E5');
    grad.addColorStop(1, '#1E1B4B');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(256, 256, 242, 0, Math.PI * 2);
    ctx.fill();

    // Subtle concentric celestial rings & golden astrolabe mullions
    ctx.strokeStyle = 'rgba(254, 243, 199, 0.88)';
    ctx.lineWidth = 6;
    for (const r of [92, 152, 204, 238]) {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.lineWidth = i % 4 === 0 ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(a) * 60, 256 + Math.sin(a) * 60);
      ctx.lineTo(256 + Math.cos(a) * 238, 256 + Math.sin(a) * 238);
      ctx.stroke();

      ctx.fillStyle =
        i % 2 === 0 ? 'rgba(254, 240, 138, 0.78)' : 'rgba(186, 230, 253, 0.7)';
      ctx.beginPath();
      ctx.arc(
        256 + Math.cos(a + Math.PI / 16) * 176,
        256 + Math.sin(a + Math.PI / 16) * 176,
        13,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Center radiant Gemini 4-point sparkle emblem
    ctx.save();
    ctx.translate(256, 256);
    const starGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 128);
    starGrad.addColorStop(0, '#FFFFFF');
    starGrad.addColorStop(0.55, '#BAE6FD');
    starGrad.addColorStop(1, '#818CF8');
    ctx.fillStyle = starGrad;
    ctx.beginPath();
    ctx.moveTo(0, -124);
    ctx.quadraticCurveTo(18, -18, 124, 0);
    ctx.quadraticCurveTo(18, 18, 0, 124);
    ctx.quadraticCurveTo(-18, 18, -124, 0);
    ctx.quadraticCurveTo(-18, -18, 0, -124);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#FEF08A';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    const tex = finalizeTexture(cv, maxAnisotropy);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  };

  // 10. Emerald-Teal-Gold Botanical Crystal Wheel for QA & RSI Sanctuary
  const makeEmeraldStainedGlass = () => {
    const [cv, ctx] = makeCanvas(512, 512);
    ctx.clearRect(0, 0, 512, 512);
    const grad = ctx.createRadialGradient(256, 256, 20, 256, 256, 242);
    grad.addColorStop(0, '#ECFDF5');
    grad.addColorStop(0.45, '#5EEAD4');
    grad.addColorStop(0.8, '#0D9488');
    grad.addColorStop(1, '#115E59');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(256, 256, 242, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 248, 220, 0.88)';
    ctx.lineWidth = 6;
    for (const r of [72, 136, 194, 236]) {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.lineWidth = i % 2 === 0 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(a) * 44, 256 + Math.sin(a) * 44);
      ctx.lineTo(256 + Math.cos(a) * 238, 256 + Math.sin(a) * 238);
      ctx.stroke();

      ctx.fillStyle =
        i % 2 === 0 ? 'rgba(209, 250, 229, 0.82)' : 'rgba(254, 240, 138, 0.55)';
      ctx.beginPath();
      ctx.arc(
        256 + Math.cos(a + Math.PI / 16) * 165,
        256 + Math.sin(a + Math.PI / 16) * 165,
        14,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    const tex = finalizeTexture(cv, maxAnisotropy);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  };

  const stainedGlassGemini = makeGeminiStainedGlass();
  const stainedGlassBlue = makeEmeraldStainedGlass();

  // 11. Parcel shipping label
  const [labelCanvas, lCtx] = makeCanvas(128, 96);
  lCtx.fillStyle = '#FFFFFF';
  lCtx.fillRect(0, 0, 128, 96);
  lCtx.fillStyle = '#1E293B';
  lCtx.fillRect(10, 12, 72, 10);
  lCtx.fillStyle = '#64748B';
  lCtx.fillRect(10, 30, 96, 6);
  lCtx.fillRect(10, 42, 64, 6);
  lCtx.fillStyle = '#0F172A';
  for (let x = 10; x < 116; x += 6) {
    lCtx.fillRect(x, 58, x % 12 === 0 ? 3 : 2, 26);
  }
  const parcelLabel = finalizeTexture(labelCanvas, maxAnisotropy);
  parcelLabel.wrapS = THREE.ClampToEdgeWrapping;
  parcelLabel.wrapT = THREE.ClampToEdgeWrapping;

  // 12. QA Cloud Mascot ">_" glowing terminal face
  const [faceCanvas, fCtx] = makeCanvas(256, 160);
  fCtx.clearRect(0, 0, 256, 160);
  fCtx.strokeStyle = '#FFFFFF';
  fCtx.lineWidth = 16;
  fCtx.lineCap = 'round';
  fCtx.lineJoin = 'round';
  fCtx.beginPath();
  fCtx.moveTo(64, 48);
  fCtx.lineTo(116, 82);
  fCtx.lineTo(64, 116);
  fCtx.stroke();
  fCtx.beginPath();
  fCtx.moveTo(136, 118);
  fCtx.lineTo(192, 118);
  fCtx.stroke();
  const cloudTerminalFace = finalizeTexture(faceCanvas, maxAnisotropy);
  cloudTerminalFace.wrapS = THREE.ClampToEdgeWrapping;
  cloudTerminalFace.wrapT = THREE.ClampToEdgeWrapping;

  // 13. Soft radial contact shadow decal
  const [shadowCanvas, shCtx] = makeCanvas(128, 128);
  const sGrad = shCtx.createRadialGradient(64, 64, 10, 64, 64, 62);
  sGrad.addColorStop(0, 'rgba(22, 42, 24, 0.34)');
  sGrad.addColorStop(0.65, 'rgba(22, 42, 24, 0.16)');
  sGrad.addColorStop(1, 'rgba(22, 42, 24, 0)');
  shCtx.fillStyle = sGrad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadow = finalizeTexture(shadowCanvas, maxAnisotropy);
  contactShadow.wrapS = THREE.ClampToEdgeWrapping;
  contactShadow.wrapT = THREE.ClampToEdgeWrapping;

  // 14. Velvety feathered warm radial streetlamp glow pool (zero harsh circle edge, zero z-fighting!)
  const [glowCanvas, glCtx] = makeCanvas(128, 128);
  const glGrad = glCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
  glGrad.addColorStop(0, 'rgba(254, 240, 165, 0.92)');
  glGrad.addColorStop(0.35, 'rgba(252, 211, 77, 0.48)');
  glGrad.addColorStop(0.7, 'rgba(245, 158, 11, 0.14)');
  glGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
  glCtx.fillStyle = glGrad;
  glCtx.fillRect(0, 0, 128, 128);
  const warmGlowDisc = finalizeTexture(glowCanvas, maxAnisotropy);
  warmGlowDisc.wrapS = THREE.ClampToEdgeWrapping;
  warmGlowDisc.wrapT = THREE.ClampToEdgeWrapping;

  const all = [
    meadowDay,
    meadowSnow,
    courtyardTiles,
    tileBump,
    gravelRoad,
    brickWall,
    brickBump,
    solarPanel,
    conveyorBelt,
    clockFace,
    stainedGlassGemini,
    stainedGlassBlue,
    parcelLabel,
    cloudTerminalFace,
    contactShadow,
    warmGlowDisc,
  ];

  return {
    meadowDay,
    meadowSnow,
    courtyardTiles,
    tileBump,
    gravelRoad,
    brickWall,
    brickBump,
    solarPanel,
    conveyorBelt,
    clockFace,
    stainedGlassGemini,
    stainedGlassBlue,
    parcelLabel,
    cloudTerminalFace,
    contactShadow,
    warmGlowDisc,
    dispose: () => {
      for (const tex of all) {
        tex.dispose();
      }
    },
  };
}
