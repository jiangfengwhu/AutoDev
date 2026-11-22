import type Phaser from 'phaser';

export interface PixelCharPalette {
  skin: string;
  hair: string;
  shirt: string;
  shirtShade: string;
  pants: string;
  accent: string;
  glasses?: boolean;
  headphones?: boolean;
}

export const PLAYER_PALETTE: PixelCharPalette = {
  skin: '#F4C6A0',
  hair: '#242B3D',
  shirt: '#F59E0B',
  shirtShade: '#B45309',
  pants: '#1E293B',
  accent: '#FDE68A',
  glasses: true,
};

export const NPC_PALETTES: Record<string, PixelCharPalette> = {
  environment: {
    skin: '#F0BC94',
    hair: '#334155',
    shirt: '#D97706',
    shirtShade: '#92400E',
    pants: '#1E293B',
    accent: '#FBBF24',
  },
  prd: {
    skin: '#F5C7A3',
    hair: '#3B2820',
    shirt: '#0284C7',
    shirtShade: '#075985',
    pants: '#1E293B',
    accent: '#38BDF8',
    glasses: true,
  },
  requirements: {
    skin: '#F7CCB0',
    hair: '#4A2C2A',
    shirt: '#CA8A04',
    shirtShade: '#854D0E',
    pants: '#312E81',
    accent: '#FDE68A',
    glasses: true,
  },
  pipeline: {
    skin: '#F3C5A2',
    hair: '#1E293B',
    shirt: '#059669',
    shirtShade: '#065F46',
    pants: '#0F172A',
    accent: '#34D399',
    headphones: true,
  },
  approval: {
    skin: '#F7CBB2',
    hair: '#94A3B8',
    shirt: '#7C3AED',
    shirtShade: '#4C1D95',
    pants: '#1E1B4B',
    accent: '#C4B5FD',
  },
  quality: {
    skin: '#D69E78',
    hair: '#271916',
    shirt: '#E11D48',
    shirtShade: '#9F1239',
    pants: '#1E293B',
    accent: '#FDA4AF',
  },
};

function drawPixelCharFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  palette: PixelCharPalette,
  dir: 'down' | 'up' | 'left' | 'right',
  stepFrame: number
): void {
  // Ground oval shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
  ctx.fillRect(ox + 7, oy + 27, 18, 4);
  ctx.fillRect(ox + 9, oy + 26, 14, 6);

  const bob = stepFrame === 1 || stepFrame === 3 ? -1 : 0;
  const leftLegOffset = stepFrame === 1 ? -2 : stepFrame === 3 ? 2 : 0;
  const rightLegOffset = -leftLegOffset;

  // Legs / shoes
  ctx.fillStyle = palette.pants;
  ctx.fillRect(ox + 10, oy + 22 + Math.min(0, leftLegOffset), 5, 6);
  ctx.fillRect(ox + 17, oy + 22 + Math.min(0, rightLegOffset), 5, 6);
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(ox + 10, oy + 26 + Math.min(0, leftLegOffset), 5, 2);
  ctx.fillRect(ox + 17, oy + 26 + Math.min(0, rightLegOffset), 5, 2);

  // Torso (shirt + collar/trim)
  ctx.fillStyle = '#0B0F18';
  ctx.fillRect(ox + 8, oy + 13 + bob, 16, 11);
  ctx.fillStyle = palette.shirt;
  ctx.fillRect(ox + 9, oy + 14 + bob, 14, 9);
  ctx.fillStyle = palette.shirtShade;
  ctx.fillRect(ox + 9, oy + 20 + bob, 14, 3);
  // Badge / lanyard highlight
  ctx.fillStyle = palette.accent;
  ctx.fillRect(ox + 15, oy + 15 + bob, 2, 4);

  // Arms swing
  const armSwing = stepFrame === 1 ? 1 : stepFrame === 3 ? -1 : 0;
  ctx.fillStyle = palette.shirt;
  ctx.fillRect(ox + 6, oy + 15 + bob + armSwing, 3, 6);
  ctx.fillRect(ox + 23, oy + 15 + bob - armSwing, 3, 6);
  ctx.fillStyle = palette.skin;
  ctx.fillRect(ox + 6, oy + 20 + bob + armSwing, 3, 2);
  ctx.fillRect(ox + 23, oy + 20 + bob - armSwing, 3, 2);

  // Head outline
  ctx.fillStyle = '#0B0F18';
  ctx.fillRect(ox + 8, oy + 3 + bob, 16, 12);

  // Face / Hair depending on facing direction
  if (dir === 'up') {
    ctx.fillStyle = palette.hair;
    ctx.fillRect(ox + 9, oy + 4 + bob, 14, 10);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(ox + 12, oy + 6 + bob, 8, 1);
  } else {
    ctx.fillStyle = palette.skin;
    ctx.fillRect(ox + 9, oy + 5 + bob, 14, 9);
    // Hair top & bangs
    ctx.fillStyle = palette.hair;
    ctx.fillRect(ox + 9, oy + 4 + bob, 14, 4);
    ctx.fillRect(ox + 8, oy + 5 + bob, 2, 5);
    ctx.fillRect(ox + 22, oy + 5 + bob, 2, 5);

    // Eyes
    ctx.fillStyle = '#0F172A';
    if (dir === 'down') {
      ctx.fillRect(ox + 11, oy + 9 + bob, 2, 2);
      ctx.fillRect(ox + 19, oy + 9 + bob, 2, 2);
    } else if (dir === 'left') {
      ctx.fillRect(ox + 10, oy + 9 + bob, 2, 2);
      ctx.fillRect(ox + 15, oy + 9 + bob, 2, 2);
    } else {
      ctx.fillRect(ox + 15, oy + 9 + bob, 2, 2);
      ctx.fillRect(ox + 20, oy + 9 + bob, 2, 2);
    }

    // Optional pixel glasses
    if (palette.glasses && dir === 'down') {
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(ox + 10, oy + 8 + bob, 4, 1);
      ctx.fillRect(ox + 18, oy + 8 + bob, 4, 1);
      ctx.fillRect(ox + 14, oy + 9 + bob, 4, 1);
    }
  }

  // Optional headphones
  if (palette.headphones) {
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(ox + 7, oy + 6 + bob, 2, 5);
    ctx.fillRect(ox + 23, oy + 6 + bob, 2, 5);
    ctx.fillRect(ox + 9, oy + 2 + bob, 14, 2);
  }
}

/**
 * Generates crisp 16-bit pixel-art spritesheets and tile textures directly inside
 * Phaser's TextureManager so every character & prop has razor-sharp pixel art
 * and smooth 4-frame animations with zero broken assets.
 */
export function registerStudioPixelTextures(scene: Phaser.Scene): void {
  const dirs: Array<'down' | 'up' | 'left' | 'right'> = ['down', 'up', 'left', 'right'];

  const createCharacterSheet = (key: string, palette: PixelCharPalette) => {
    if (scene.textures.exists(key)) return;
    const width = 32 * 4;
    const height = 32 * 4;
    const canvasTex = scene.textures.createCanvas(key, width, height);
    if (!canvasTex) return;
    const ctx = canvasTex.getContext();
    ctx.imageSmoothingEnabled = false;

    dirs.forEach((dir, rowIdx) => {
      for (let colIdx = 0; colIdx < 4; colIdx += 1) {
        drawPixelCharFrame(ctx, colIdx * 32, rowIdx * 32, palette, dir, colIdx);
      }
    });
    canvasTex.refresh();

    // Register individual 32x32 frame rectangles for Phaser animation manager
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        canvasTex.add(r * 4 + c, 0, c * 32, r * 32, 32, 32);
      }
    }

    dirs.forEach((dir, r) => {
      const animKey = `${key}-walk-${dir}`;
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({
          key: animKey,
          frames: [0, 1, 2, 3].map((c) => ({ key, frame: r * 4 + c })),
          frameRate: 8,
          repeat: -1,
        });
      }
    });

    const idleKey = `${key}-idle`;
    if (!scene.anims.exists(idleKey)) {
      scene.anims.create({
        key: idleKey,
        frames: [
          { key, frame: 0 },
          { key, frame: 1 },
        ],
        frameRate: 2.5,
        repeat: -1,
      });
    }
  };

  createCharacterSheet('char-player', PLAYER_PALETTE);
  for (const [roomId, palette] of Object.entries(NPC_PALETTES)) {
    createCharacterSheet(`char-npc-${roomId}`, palette);
  }

  // Soft glowing particle dot texture
  if (!scene.textures.exists('fx-spark')) {
    const spark = scene.textures.createCanvas('fx-spark', 8, 8);
    if (spark) {
      const ctx = spark.getContext();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(2, 2, 4, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(1, 2, 6, 4);
      ctx.fillRect(2, 1, 4, 6);
      spark.refresh();
    }
  }
}
