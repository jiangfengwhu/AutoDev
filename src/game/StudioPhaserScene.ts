import Phaser from 'phaser';
import type { StudioRoomId } from '../lib/studioTheme';
import {
  PLAYER_SPAWN_WORLD,
  STUDIO_WORLD_ROOMS,
  TILE_SIZE,
  WORLD_COLS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_WIDTH,
  findNearbyInteractableRoom,
  getCorridorRouteWaypoints,
  getRoomAtWorldPoint,
  isWalkableWorldPoint,
  type FacingDir,
  type RoomZoneRect,
} from './studioWorldData';
import { registerStudioPixelTextures } from './spriteGenerator';
import { soundEngine } from './soundEngine';

export interface LiveStudioWorldSnapshot {
  mode: 'title' | 'playing' | 'paused' | 'room';
  activeQuestRoomId: StudioRoomId;
  roomStates: Record<
    StudioRoomId,
    {
      speech: string;
      metricLabel: string;
      isBusy: boolean;
      hasAlert: boolean;
    }
  >;
  wallMetrics: {
    successRateText: string;
    tokensText: string;
    deliveredCount: number;
    runningCount: number;
  };
  activeDataFlows: Array<{ from: StudioRoomId; to: StudioRoomId; color: number }>;
}

export interface StudioPhaserCallbacks {
  onNearbyRoomChange: (roomId: StudioRoomId | null) => void;
  onEnterRoom: (roomId: StudioRoomId) => void;
  onPlayerPositionChange?: (pos: { x: number; y: number; roomId: StudioRoomId | null }) => void;
}

interface NpcEntity {
  room: RoomZoneRect;
  sprite: Phaser.GameObjects.Sprite;
  badgeText: Phaser.GameObjects.Text;
  badgeBg: Phaser.GameObjects.Graphics;
  statusTag: Phaser.GameObjects.Text;
  highlightRing: Phaser.GameObjects.Graphics;
}

interface FlowOrb {
  graphic: Phaser.GameObjects.Arc;
  waypoints: Array<{ x: number; y: number }>;
  segmentIdx: number;
  t: number;
  speed: number;
}

interface DustParticle {
  graphic: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class StudioPhaserScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private facing: FacingDir = PLAYER_SPAWN_WORLD.facing;
  private keysPressed = new Set<string>();
  private walkTarget: { x: number; y: number; enterRoomId?: StudioRoomId } | null = null;
  private targetRing!: Phaser.GameObjects.Graphics;
  private targetRingAlpha = 0;

  private npcs = new Map<StudioRoomId, NpcEntity>();
  private nearbyRoomId: StudioRoomId | null = null;
  private wallScreenTexts: {
    rate?: Phaser.GameObjects.Text;
    tokens?: Phaser.GameObjects.Text;
    delivered?: Phaser.GameObjects.Text;
    status?: Phaser.GameObjects.Text;
  } = {};

  private flowOrbs: FlowOrb[] = [];
  private dustPool: DustParticle[] = [];
  private dustCursor = 0;
  private distanceMovedAccum = 0;
  private tourPhase = 0;

  private snapshot: LiveStudioWorldSnapshot;
  private callbacks: StudioPhaserCallbacks;

  private onKeyDownBound?: (e: KeyboardEvent) => void;
  private onKeyUpBound?: (e: KeyboardEvent) => void;
  private onBlurBound?: () => void;

  constructor(initialSnapshot: LiveStudioWorldSnapshot, callbacks: StudioPhaserCallbacks) {
    super({ key: 'StudioPhaserScene' });
    this.snapshot = initialSnapshot;
    this.callbacks = callbacks;
  }

  public updateSnapshot(next: LiveStudioWorldSnapshot): void {
    const prevMode = this.snapshot.mode;
    this.snapshot = next;

    if (!this.scene || !this.scene.isActive()) return;

    if (prevMode !== next.mode) {
      this.keysPressed.clear();
      this.walkTarget = null;
      if (next.mode === 'playing' && this.player) {
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setZoom(this.computeIdealZoom());
      } else if (next.mode === 'title') {
        this.cameras.main.stopFollow();
      }
    }

    this.refreshWallScreenTelemetry();
    this.refreshNpcBadges();
    this.rebuildFlowOrbs();
  }

  public teleportNearRoom(roomId: StudioRoomId): void {
    const room = STUDIO_WORLD_ROOMS.find((r) => r.roomId === roomId);
    if (!room || !this.player) return;
    this.walkTarget = null;
    this.player.setPosition(room.interactCol * TILE_SIZE, room.interactRow * TILE_SIZE);
    this.facing = room.rowStart < 10 ? 'up' : 'down';
    this.player.setFrame(this.getIdleFrame(this.facing));
    this.syncNearbyRoom();
  }

  private computeIdealZoom(): number {
    const w = this.scale.width || 1280;
    const h = this.scale.height || 720;
    const fitX = w / WORLD_WIDTH;
    const fitY = h / WORLD_HEIGHT;
    return Math.max(0.92, Math.min(1.38, Math.max(fitX, fitY) * 1.04));
  }

  create(): void {
    registerStudioPixelTextures(this);

    this.cameras.main.setBackgroundColor('#0B0F18');
    this.cameras.main.setBounds(-48, -48, WORLD_WIDTH + 96, WORLD_HEIGHT + 96);

    // 1. Render architectural floorplan, walls, furniture & ambient lamps
    this.drawStudioArchitecture();

    // 2. Render live in-world Command Hall wall big-screen telemetry
    this.createInWorldBigScreen();

    // 3. Spawn 6 animated studio NPCs with proximity rings & live quest markers
    this.createStudioNpcs();

    // 4. Click-to-walk ground reticle & pooled dust particles (Zero-GC ring buffer)
    this.targetRing = this.add.graphics().setDepth(15);
    this.initParticlePool();

    // 5. Spawn playable Tech Lead avatar in wide central corridor
    this.playerShadow = this.add
      .ellipse(PLAYER_SPAWN_WORLD.x, PLAYER_SPAWN_WORLD.y + 13, 22, 8, 0x000000, 0.35)
      .setDepth(19);
    this.player = this.add
      .sprite(PLAYER_SPAWN_WORLD.x, PLAYER_SPAWN_WORLD.y, 'char-player', 4)
      .setScale(1.35)
      .setDepth(20);

    // 6. Camera setup
    const zoom = this.computeIdealZoom();
    this.cameras.main.setZoom(zoom);
    if (this.snapshot.mode === 'playing') {
      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    } else {
      this.cameras.main.centerOn(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.48);
    }

    // 7. Pointer interaction: click floor to walk, click room/NPC to walk & enter
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.snapshot.mode !== 'playing') return;
      soundEngine.unlock();
      const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      // Check if clicking directly near an NPC or inside a room
      const clickedRoom = getRoomAtWorldPoint(worldPt.x, worldPt.y);
      if (clickedRoom) {
        const npcDist = Math.hypot(
          worldPt.x - clickedRoom.npcCol * TILE_SIZE,
          worldPt.y - clickedRoom.npcRow * TILE_SIZE
        );
        // Clicking directly on an NPC enters immediately if close, or walks up & enters
        if (npcDist < 52) {
          const playerDist = Math.hypot(
            this.player.x - clickedRoom.npcCol * TILE_SIZE,
            this.player.y - clickedRoom.npcRow * TILE_SIZE
          );
          if (playerDist < 120) {
            soundEngine.playDoorTransition();
            this.callbacks.onEnterRoom(clickedRoom.roomId);
            return;
          }
          this.walkTarget = {
            x: clickedRoom.interactCol * TILE_SIZE,
            y: clickedRoom.interactRow * TILE_SIZE,
            enterRoomId: clickedRoom.roomId,
          };
          this.targetRingAlpha = 1;
          soundEngine.playUiClick();
          return;
        }
      }

      if (isWalkableWorldPoint(worldPt.x, worldPt.y)) {
        this.walkTarget = { x: worldPt.x, y: worldPt.y };
        this.targetRingAlpha = 1;
        soundEngine.playUiHover();
      } else if (clickedRoom) {
        this.walkTarget = {
          x: clickedRoom.interactCol * TILE_SIZE,
          y: clickedRoom.interactRow * TILE_SIZE,
        };
        this.targetRingAlpha = 1;
      }
    });

    // 8. Window-level WASD / Arrow keyboard listener with blur hygiene
    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (this.snapshot.mode !== 'playing') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const code = e.code;
      if (
        code === 'KeyW' ||
        code === 'KeyA' ||
        code === 'KeyS' ||
        code === 'KeyD' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight'
      ) {
        soundEngine.unlock();
        this.keysPressed.add(code);
        this.walkTarget = null;
      } else if (code === 'KeyE' && this.nearbyRoomId) {
        e.preventDefault();
        soundEngine.playDoorTransition();
        this.callbacks.onEnterRoom(this.nearbyRoomId);
      }
    };

    this.onKeyUpBound = (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    };

    this.onBlurBound = () => {
      this.keysPressed.clear();
      this.walkTarget = null;
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);

    this.scale.on('resize', () => {
      if (this.cameras?.main) {
        this.cameras.main.setZoom(this.computeIdealZoom());
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onKeyDownBound) window.removeEventListener('keydown', this.onKeyDownBound);
      if (this.onKeyUpBound) window.removeEventListener('keyup', this.onKeyUpBound);
      if (this.onBlurBound) window.removeEventListener('blur', this.onBlurBound);
    });

    this.refreshWallScreenTelemetry();
    this.refreshNpcBadges();
    this.rebuildFlowOrbs();
    this.syncNearbyRoom();
  }

  private drawStudioArchitecture(): void {
    const texKey = 'studio-floorplan-baked-v2';
    if (!this.textures.exists(texKey)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);

      // Outer deep studio night surround
      g.fillStyle(0x111827, 1);
      g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Central Grand Corridor (warm sunlit honey-oak planks, rows 9..13)
      for (let r = 9; r < 13; r += 1) {
        for (let c = 1; c < WORLD_COLS - 1; c += 1) {
          const shade = (r + c) % 2 === 0 ? 0x5c4330 : 0x523b29;
          g.fillStyle(shade, 1);
          g.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          g.lineStyle(1, 0x3b291c, 0.55);
          g.strokeRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }

      // Warm brass workflow guide track inlaid along corridor center
      g.fillStyle(0x3a2a1e, 0.85);
      g.fillRect(TILE_SIZE * 2, TILE_SIZE * 10.75, WORLD_WIDTH - TILE_SIZE * 4, TILE_SIZE * 0.5);
      g.lineStyle(2, 0xf59e0b, 0.65);
      g.lineBetween(TILE_SIZE * 2.5, TILE_SIZE * 11, WORLD_WIDTH - TILE_SIZE * 2.5, TILE_SIZE * 11);

      // Central Reception Carpet at spawn point (cols 15.8..20.2, rows 10..12)
      g.fillStyle(0x24344d, 1);
      g.fillRoundedRect(15.8 * TILE_SIZE, 10.05 * TILE_SIZE, 4.4 * TILE_SIZE, 1.9 * TILE_SIZE, 6);
      g.lineStyle(2, 0xfbbf24, 0.85);
      g.strokeRoundedRect(
        15.8 * TILE_SIZE + 4,
        10.05 * TILE_SIZE + 4,
        4.4 * TILE_SIZE - 8,
        1.9 * TILE_SIZE - 8,
        4
      );

      // Draw each of the 6 distinct rooms with vibrant, cozy 16-bit architectural palettes
      const roomFloorColors: Record<RoomZoneRect['floorTheme'], [number, number]> = {
        command: [0x26354d, 0x202e44],
        architect: [0x223b54, 0x1d3349],
        archive: [0x45352a, 0x3d2e24],
        coding: [0x1c3a37, 0x17312e],
        approval: [0x33294d, 0x2b2242],
        quality: [0x402638, 0x372030],
      };

      for (const room of STUDIO_WORLD_ROOMS) {
        const [c1, c2] = roomFloorColors[room.floorTheme];
        const rx = room.colStart * TILE_SIZE;
        const ry = room.rowStart * TILE_SIZE;
        const rw = (room.colEnd - room.colStart) * TILE_SIZE;
        const rh = (room.rowEnd - room.rowStart) * TILE_SIZE;

        // Room checkered floor tiles
        for (let r = room.rowStart; r < room.rowEnd; r += 1) {
          for (let c = room.colStart; c < room.colEnd; c += 1) {
            g.fillStyle((r + c) % 2 === 0 ? c1 : c2, 1);
            g.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        }

        // Cozy warm overhead desk lamp pool around each NPC workstation
        const npcX = room.npcCol * TILE_SIZE;
        const npcY = room.npcRow * TILE_SIZE;
        g.fillStyle(0xfef3c7, 0.08);
        g.fillCircle(npcX, npcY, 92);
        g.fillStyle(room.accentNum, 0.09);
        g.fillCircle(npcX, npcY, 56);

        // Back wall strip with architectural molding & bright accent trim
        g.fillStyle(0x2d3a54, 1);
        g.fillRect(rx, ry, rw, TILE_SIZE * 1.45);
        g.fillStyle(0x1b2436, 1);
        g.fillRect(rx, ry + TILE_SIZE * 1.35, rw, 5);
        g.fillStyle(room.accentNum, 0.92);
        g.fillRect(rx + 6, ry + TILE_SIZE * 1.45 - 3, rw - 12, 3);

        // Crisp room perimeter walls
        g.lineStyle(4, 0x64748b, 1);
        g.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);

        // Wide illuminated oak doorway threshold facing central corridor
        const doorX = (room.doorCol - 1.7) * TILE_SIZE;
        const doorY = room.rowStart < 10 ? ry + rh - 7 : ry - 3;
        g.fillStyle(0x6b4f38, 1);
        g.fillRect(doorX, doorY, TILE_SIZE * 3.4, 12);
        g.fillStyle(room.accentNum, 0.95);
        g.fillRect(doorX + 6, doorY + 5, TILE_SIZE * 3.4 - 12, 2);

        // Room-specific furniture & props baked right into the static layer
        this.drawRoomProps(g, room);
      }

      // Outer thick architectural studio frame with warm brass accent
      g.lineStyle(6, 0x64748b, 1);
      g.strokeRect(
        TILE_SIZE - 2,
        TILE_SIZE - 2,
        WORLD_WIDTH - TILE_SIZE * 2 + 4,
        WORLD_HEIGHT - TILE_SIZE * 2 + 4
      );
      g.lineStyle(2, 0xf59e0b, 0.5);
      g.strokeRect(
        TILE_SIZE + 2,
        TILE_SIZE + 2,
        WORLD_WIDTH - TILE_SIZE * 2 - 4,
        WORLD_HEIGHT - TILE_SIZE * 2 - 4
      );

      // Decorative potted plants & warm corridor floor lamps
      const plantCols = [2.4, 11.4, 12.6, 23.4, 24.6, 33.6];
      for (const pc of plantCols) {
        const px = pc * TILE_SIZE;
        const py = 9.55 * TILE_SIZE;
        g.fillStyle(0xfef3c7, 0.08);
        g.fillCircle(px, py - 4, 24);
        g.fillStyle(0x9a5b32, 1);
        g.fillRect(px - 6, py - 2, 12, 10);
        g.fillStyle(0x10b981, 1);
        g.fillCircle(px, py - 6, 9);
        g.fillStyle(0x6ee7b7, 0.95);
        g.fillCircle(px - 3, py - 9, 4);
      }

      // Bake the entire static architecture into a single texture for O(1) frame rendering
      g.generateTexture(texKey, WORLD_WIDTH, WORLD_HEIGHT);
      g.destroy();
    }

    this.add.image(0, 0, texKey).setOrigin(0, 0).setDepth(1);

    // Diegetic brass room nameplates above every doorway
    for (const room of STUDIO_WORLD_ROOMS) {
      const ry = room.rowStart * TILE_SIZE;
      const rh = (room.rowEnd - room.rowStart) * TILE_SIZE;
      const plateY = room.rowStart < 10 ? ry + rh - 26 : ry + 8;
      this.add
        .text(room.doorCol * TILE_SIZE, plateY, `[${room.hotkey}] ${room.roomCode} · ${room.roomName}`, {
          fontFamily: '"JetBrains Mono", "Noto Sans SC", monospace',
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#FEF3C7',
          backgroundColor: '#131B2E',
          padding: { x: 7, y: 3 },
        })
        .setOrigin(0.5, 0)
        .setDepth(6);
    }
  }

  private drawRoomProps(g: Phaser.GameObjects.Graphics, room: RoomZoneRect): void {
    const rx = room.colStart * TILE_SIZE;
    const ry = room.rowStart * TILE_SIZE;
    const npcX = room.npcCol * TILE_SIZE;
    const npcY = room.npcRow * TILE_SIZE;

    // Warm oak workstation desk directly in front of each NPC
    g.fillStyle(0x7c5334, 1);
    g.fillRoundedRect(npcX - 46, npcY - 9, 92, 28, 4);
    g.lineStyle(2, 0xb07c4f, 0.95);
    g.strokeRoundedRect(npcX - 46, npcY - 9, 92, 28, 4);

    // Glowing monitor + warm desk lamp + coffee mug on desk
    g.fillStyle(0x0f172a, 1);
    g.fillRect(npcX - 20, npcY - 6, 40, 16);
    g.fillStyle(room.accentNum, 0.95);
    g.fillRect(npcX - 18, npcY - 4, 36, 12);
    // Warm amber desk lamp on left edge of desk
    g.fillStyle(0xfbbf24, 1);
    g.fillCircle(npcX - 34, npcY + 2, 5);
    // White coffee mug on right edge of desk
    g.fillStyle(0xf8fafc, 1);
    g.fillRect(npcX + 28, npcY - 1, 6, 7);

    // Room-specific landmark props
    if (room.floorTheme === 'command') {
      // Server racks on left wall with bright status LEDs
      for (let i = 0; i < 3; i += 1) {
        const sy = ry + 64 + i * 44;
        g.fillStyle(0x1e293b, 1);
        g.fillRoundedRect(rx + 14, sy, 32, 36, 3);
        g.lineStyle(1, 0x475569, 1);
        g.strokeRoundedRect(rx + 14, sy, 32, 36, 3);
        g.fillStyle(0x34d399, 1);
        g.fillRect(rx + 19, sy + 8, 6, 4);
        g.fillStyle(0x38bdf8, 1);
        g.fillRect(rx + 29, sy + 8, 6, 4);
        g.fillStyle(0xfbbf24, 1);
        g.fillRect(rx + 19, sy + 18, 16, 4);
      }
    } else if (room.floorTheme === 'architect') {
      // Illuminated Blueprint drafting whiteboard on north wall
      g.fillStyle(0x0f304f, 1);
      g.fillRoundedRect(rx + 64, ry + 10, 250, 36, 4);
      g.lineStyle(2, 0x38bdf8, 0.95);
      g.strokeRoundedRect(rx + 64, ry + 10, 250, 36, 4);
      g.fillStyle(0x7dd3fc, 0.9);
      g.fillRect(rx + 88, ry + 20, 38, 14);
      g.fillRect(rx + 168, ry + 20, 38, 14);
      g.fillRect(rx + 248, ry + 20, 38, 14);
      g.lineStyle(2, 0xfbbf24, 1);
      g.lineBetween(rx + 126, ry + 27, rx + 168, ry + 27);
      g.lineBetween(rx + 206, ry + 27, rx + 248, ry + 27);
    } else if (room.floorTheme === 'archive') {
      // Warm mahogany archive bookshelves with colorful book spines
      for (let i = 0; i < 4; i += 1) {
        const bx = rx + 22 + i * 78;
        g.fillStyle(0x6e4427, 1);
        g.fillRoundedRect(bx, ry + 10, 64, 34, 3);
        g.lineStyle(1, 0xa16a3f, 1);
        g.strokeRoundedRect(bx, ry + 10, 64, 34, 3);
        g.fillStyle(0xfbbf24, 0.95);
        g.fillRect(bx + 6, ry + 16, 12, 20);
        g.fillStyle(0x38bdf8, 0.95);
        g.fillRect(bx + 22, ry + 16, 12, 20);
        g.fillStyle(0x34d399, 0.95);
        g.fillRect(bx + 38, ry + 16, 12, 20);
      }
    } else if (room.floorTheme === 'coding') {
      // Dual curved ultra-wide coding monitors + glowing terminal lines
      g.fillStyle(0x065f46, 0.95);
      g.fillRoundedRect(npcX - 72, npcY - 6, 24, 20, 3);
      g.fillStyle(0x6ee7b7, 1);
      g.fillRect(npcX - 68, npcY - 1, 16, 2);
      g.fillRect(npcX - 68, npcY + 4, 12, 2);
      g.fillRect(npcX - 68, npcY + 9, 14, 2);
    } else if (room.floorTheme === 'approval') {
      // Strategic conference table + glowing holographic preview emitter
      g.fillStyle(0x43306b, 1);
      g.fillRoundedRect(npcX - 68, npcY + 30, 136, 36, 8);
      g.lineStyle(2, 0xc4b5fd, 0.9);
      g.strokeRoundedRect(npcX - 68, npcY + 30, 136, 36, 8);
      g.fillStyle(0x38bdf8, 0.75);
      g.fillCircle(npcX, npcY + 48, 12);
      g.fillStyle(0xe0f2fe, 0.95);
      g.fillCircle(npcX, npcY + 48, 5);
    } else if (room.floorTheme === 'quality') {
      // RSI self-evolution crystal chamber on right side
      g.fillStyle(0x521f3a, 1);
      g.fillRoundedRect(rx + 254, ry + 92, 66, 78, 8);
      g.lineStyle(2, 0xfda4af, 0.95);
      g.strokeRoundedRect(rx + 254, ry + 92, 66, 78, 8);
      g.fillStyle(0xfb7185, 0.75);
      g.fillCircle(rx + 287, ry + 131, 20);
      g.fillStyle(0xfef3c7, 0.95);
      g.fillCircle(rx + 287, ry + 131, 8);
    }
  }

  private createInWorldBigScreen(): void {
    const cmd = STUDIO_WORLD_ROOMS[0]; // RM-01 Command Hall
    const sx = cmd.colStart * TILE_SIZE + 54;
    const sy = cmd.rowStart * TILE_SIZE + 8;
    const sw = 252;
    const sh = 68;

    const frame = this.add.graphics().setDepth(4);
    frame.fillStyle(0x0c1322, 1);
    frame.fillRoundedRect(sx, sy, sw, sh, 6);
    frame.lineStyle(2, 0xfbbf24, 0.95);
    frame.strokeRoundedRect(sx, sy, sw, sh, 6);
    frame.fillStyle(0xf59e0b, 1);
    frame.fillRect(sx + 4, sy + 2, sw - 8, 3);

    this.add
      .text(sx + 10, sy + 8, '指挥大厅 · 7日效能大屏', {
        fontFamily: '"JetBrains Mono", "Noto Sans SC", monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#FDE68A',
      })
      .setDepth(5);

    this.wallScreenTexts.rate = this.add
      .text(sx + 10, sy + 25, '成功率 --', {
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#6EE7B7',
      })
      .setDepth(5);

    this.wallScreenTexts.tokens = this.add
      .text(sx + 116, sy + 25, '算力 --', {
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#DDD6FE',
      })
      .setDepth(5);

    this.wallScreenTexts.delivered = this.add
      .text(sx + 10, sy + 45, '交付 0 需求', {
        fontFamily: '"JetBrains Mono", "Noto Sans SC", monospace',
        fontSize: '10px',
        color: '#F8FAFC',
      })
      .setDepth(5);

    this.wallScreenTexts.status = this.add
      .text(sx + 116, sy + 45, '全部通道就绪', {
        fontFamily: '"JetBrains Mono", "Noto Sans SC", monospace',
        fontSize: '10px',
        color: '#7DD3FC',
      })
      .setDepth(5);
  }

  private refreshWallScreenTelemetry(): void {
    const m = this.snapshot.wallMetrics;
    this.wallScreenTexts.rate?.setText(`成功率 ${m.successRateText}`);
    this.wallScreenTexts.tokens?.setText(`算力 ${m.tokensText}`);
    this.wallScreenTexts.delivered?.setText(`交付 ${m.deliveredCount} 需求`);
    this.wallScreenTexts.status?.setText(
      m.runningCount > 0 ? `后台 ${m.runningCount} 执行中` : '全部通道就绪'
    );
  }

  private createStudioNpcs(): void {
    for (const room of STUDIO_WORLD_ROOMS) {
      const nx = room.npcCol * TILE_SIZE;
      const ny = room.npcRow * TILE_SIZE - 14;

      const highlightRing = this.add.graphics().setDepth(8);
      const sprite = this.add
        .sprite(nx, ny, `char-npc-${room.roomId}`, 0)
        .setScale(1.32)
        .setDepth(12)
        .setInteractive({ useHandCursor: true });
      sprite.play(`char-npc-${room.roomId}-idle`);

      // Subtle hover feedback
      sprite.on('pointerover', () => {
        if (this.snapshot.mode === 'playing') {
          sprite.setScale(1.42);
        }
      });
      sprite.on('pointerout', () => {
        sprite.setScale(1.32);
      });

      const badgeBg = this.add.graphics().setDepth(24);
      const badgeText = this.add
        .text(nx, ny - 36, '!', {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#0C0F16',
        })
        .setOrigin(0.5)
        .setDepth(25);

      const statusTag = this.add
        .text(nx, ny + 26, `${room.npcName}`, {
          fontFamily: '"Noto Sans SC", sans-serif',
          fontSize: '10px',
          color: '#E2E8F0',
          backgroundColor: 'rgba(12, 16, 25, 0.85)',
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 0)
        .setDepth(14);

      this.npcs.set(room.roomId, {
        room,
        sprite,
        badgeBg,
        badgeText,
        statusTag,
        highlightRing,
      });
    }
  }

  private refreshNpcBadges(): void {
    for (const [roomId, npc] of this.npcs.entries()) {
      const state = this.snapshot.roomStates[roomId];
      const isQuestTarget = this.snapshot.activeQuestRoomId === roomId;
      const nx = npc.sprite.x;
      const ny = npc.sprite.y - 36;

      npc.badgeBg.clear();
      if (state?.isBusy) {
        npc.badgeBg.fillStyle(0x38bdf8, 1);
        npc.badgeBg.fillRoundedRect(nx - 22, ny - 9, 44, 18, 5);
        npc.badgeText.setText('RUN').setColor('#0C0F16').setVisible(true);
      } else if (isQuestTarget || state?.hasAlert) {
        npc.badgeBg.fillStyle(0xf59e0b, 1);
        npc.badgeBg.fillCircle(nx, ny, 9);
        npc.badgeText.setText('!').setColor('#0C0F16').setVisible(true);
      } else {
        npc.badgeText.setVisible(false);
      }

      npc.statusTag.setText(`${npc.room.npcName} · ${state?.metricLabel ?? ''}`);
    }
  }

  private rebuildFlowOrbs(): void {
    for (const orb of this.flowOrbs) {
      orb.graphic.destroy();
    }
    this.flowOrbs = [];

    for (const flow of this.snapshot.activeDataFlows) {
      const waypoints = getCorridorRouteWaypoints(flow.from, flow.to);
      if (waypoints.length < 2) continue;
      const graphic = this.add
        .circle(waypoints[0].x, waypoints[0].y, 5, flow.color, 0.95)
        .setDepth(16);
      this.flowOrbs.push({
        graphic,
        waypoints,
        segmentIdx: 0,
        t: 0,
        speed: 170,
      });
    }
  }

  private initParticlePool(): void {
    for (let i = 0; i < 24; i += 1) {
      const graphic = this.add
        .rectangle(-100, -100, 4, 4, 0xfde68a, 0)
        .setDepth(11);
      this.dustPool.push({ graphic, vx: 0, vy: 0, life: 0, maxLife: 0.35 });
    }
  }

  private spawnDust(x: number, y: number, color = 0xfde68a): void {
    const p = this.dustPool[this.dustCursor];
    this.dustCursor = (this.dustCursor + 1) % this.dustPool.length;
    p.graphic.setPosition(x + (Math.random() - 0.5) * 8, y + 12);
    p.graphic.setFillStyle(color, 0.75);
    p.vx = (Math.random() - 0.5) * 24;
    p.vy = -12 - Math.random() * 14;
    p.life = 0.32;
    p.maxLife = 0.32;
  }

  private getIdleFrame(dir: FacingDir): number {
    if (dir === 'down') return 0;
    if (dir === 'up') return 4;
    if (dir === 'left') return 8;
    return 12;
  }

  private syncNearbyRoom(): void {
    const near = findNearbyInteractableRoom(this.player.x, this.player.y, 60);
    const nextRoomId = near?.room.roomId ?? null;
    if (nextRoomId !== this.nearbyRoomId) {
      this.nearbyRoomId = nextRoomId;
      this.callbacks.onNearbyRoomChange(nextRoomId);
    }

    // Highlight proximity ring around nearby NPC
    for (const [roomId, npc] of this.npcs.entries()) {
      npc.highlightRing.clear();
      if (roomId === nextRoomId && this.snapshot.mode === 'playing') {
        npc.highlightRing.lineStyle(2, npc.room.accentNum, 0.85);
        npc.highlightRing.strokeEllipse(npc.sprite.x, npc.sprite.y + 14, 42, 18);
      }
    }
  }

  update(time: number, deltaMs: number): void {
    // Clamp dt <= 0.05s per game craft rules
    const dt = Math.min(deltaMs / 1000, 0.05);

    // Gentle floating bob on NPC quest badges
    const bobOffset = Math.sin(time * 0.0055) * 3;
    for (const npc of this.npcs.values()) {
      npc.badgeText.setY(npc.sprite.y - 36 + bobOffset);
      npc.badgeBg.setY(bobOffset);
    }

    // Animate workflow data orbs moving along studio corridor
    for (const orb of this.flowOrbs) {
      const a = orb.waypoints[orb.segmentIdx];
      const b = orb.waypoints[orb.segmentIdx + 1];
      if (!a || !b) {
        orb.segmentIdx = 0;
        orb.t = 0;
        continue;
      }
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      orb.t += (orb.speed * dt) / dist;
      if (orb.t >= 1) {
        orb.t = 0;
        orb.segmentIdx += 1;
        if (orb.segmentIdx >= orb.waypoints.length - 1) {
          orb.segmentIdx = 0;
        }
      }
      const curA = orb.waypoints[orb.segmentIdx];
      const curB = orb.waypoints[orb.segmentIdx + 1] ?? curA;
      orb.graphic.setPosition(
        Phaser.Math.Linear(curA.x, curB.x, orb.t),
        Phaser.Math.Linear(curA.y, curB.y, orb.t)
      );
    }

    // Update pooled footstep particles
    for (const p of this.dustPool) {
      if (p.life > 0) {
        p.life = Math.max(0, p.life - dt);
        p.graphic.x += p.vx * dt;
        p.graphic.y += p.vy * dt;
        p.graphic.setAlpha((p.life / p.maxLife) * 0.7);
      }
    }

    // Fade click-to-walk ring
    if (this.targetRingAlpha > 0 && this.walkTarget) {
      this.targetRingAlpha = Math.max(0, this.targetRingAlpha - dt * 1.4);
      this.targetRing.clear();
      this.targetRing.lineStyle(2, 0xf59e0b, this.targetRingAlpha);
      this.targetRing.strokeCircle(
        this.walkTarget.x,
        this.walkTarget.y,
        6 + (1 - this.targetRingAlpha) * 14
      );
    } else if (this.targetRingAlpha > 0) {
      this.targetRingAlpha = 0;
      this.targetRing.clear();
    }

    // Title mode: Live World Camera Tour panning smoothly over the animated studio
    if (this.snapshot.mode === 'title') {
      this.tourPhase += dt * 0.22;
      const cx = WORLD_WIDTH * 0.5 + Math.cos(this.tourPhase) * 140;
      const cy = WORLD_HEIGHT * 0.48 + Math.sin(this.tourPhase * 0.8) * 65;
      this.cameras.main.centerOn(cx, cy);
      return;
    }

    if (this.snapshot.mode !== 'playing') {
      return;
    }

    // Player Movement (Keyboard WASD/Arrows OR Click-to-Walk)
    let vx = 0;
    let vy = 0;
    const speed = 215;

    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) vx -= 1;
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) vx += 1;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) vy -= 1;
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) vy += 1;

    if (vx === 0 && vy === 0 && this.walkTarget) {
      const dx = this.walkTarget.x - this.player.x;
      const dy = this.walkTarget.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) {
        const roomToEnter = this.walkTarget.enterRoomId;
        this.walkTarget = null;
        if (roomToEnter) {
          soundEngine.playDoorTransition();
          this.callbacks.onEnterRoom(roomToEnter);
          return;
        }
      } else {
        vx = dx / dist;
        vy = dy / dist;
      }
    }

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx = (vx / len) * speed * dt;
      vy = (vy / len) * speed * dt;

      if (Math.abs(vx) > Math.abs(vy)) {
        this.facing = vx < 0 ? 'left' : 'right';
      } else {
        this.facing = vy < 0 ? 'up' : 'down';
      }

      let moved = false;
      const nextX = this.player.x + vx;
      if (isWalkableWorldPoint(nextX, this.player.y)) {
        this.player.x = nextX;
        moved = true;
      }
      const nextY = this.player.y + vy;
      if (isWalkableWorldPoint(this.player.x, nextY)) {
        this.player.y = nextY;
        moved = true;
      }

      if (moved) {
        const animKey = `char-player-walk-${this.facing}`;
        if (this.player.anims.currentAnim?.key !== animKey) {
          this.player.play(animKey, true);
        }
        this.playerShadow.setPosition(this.player.x, this.player.y + 13);
        this.distanceMovedAccum += Math.hypot(vx, vy);
        if (this.distanceMovedAccum >= 38) {
          this.distanceMovedAccum = 0;
          this.spawnDust(this.player.x, this.player.y);
          soundEngine.playFootstep();
        }
        this.syncNearbyRoom();
      } else {
        this.walkTarget = null;
        this.player.anims.stop();
        this.player.setFrame(this.getIdleFrame(this.facing));
      }
    } else {
      if (this.player.anims.isPlaying) {
        this.player.anims.stop();
        this.player.setFrame(this.getIdleFrame(this.facing));
      }
    }
  }
}
