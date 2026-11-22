import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Phaser from 'phaser';
import type { StudioRoomId } from '../lib/studioTheme';
import {
  StudioPhaserScene,
  type LiveStudioWorldSnapshot,
  type StudioPhaserCallbacks,
} from '../game/StudioPhaserScene';

export interface PhaserStudioHandle {
  teleportNearRoom: (roomId: StudioRoomId) => void;
}

interface PhaserStudioCanvasProps {
  snapshot: LiveStudioWorldSnapshot;
  onNearbyRoomChange: (roomId: StudioRoomId | null) => void;
  onEnterRoom: (roomId: StudioRoomId) => void;
}

export const PhaserStudioCanvas = forwardRef<PhaserStudioHandle, PhaserStudioCanvasProps>(
  function PhaserStudioCanvas({ snapshot, onNearbyRoomChange, onEnterRoom }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const gameRef = useRef<Phaser.Game | null>(null);
    const sceneRef = useRef<StudioPhaserScene | null>(null);
    const snapshotRef = useRef<LiveStudioWorldSnapshot>(snapshot);
    const callbacksRef = useRef<StudioPhaserCallbacks>({
      onNearbyRoomChange,
      onEnterRoom,
    });

    snapshotRef.current = snapshot;
    callbacksRef.current = {
      onNearbyRoomChange,
      onEnterRoom,
    };

    useImperativeHandle(
      ref,
      () => ({
        teleportNearRoom: (roomId: StudioRoomId) => {
          sceneRef.current?.teleportNearRoom(roomId);
        },
      }),
      []
    );

    // Mount Phaser ONCE — React HUD state updates never recreate the canvas
    useEffect(() => {
      const parent = containerRef.current;
      if (!parent) return;

      const scene = new StudioPhaserScene(snapshotRef.current, {
        onNearbyRoomChange: (roomId) => callbacksRef.current.onNearbyRoomChange(roomId),
        onEnterRoom: (roomId) => callbacksRef.current.onEnterRoom(roomId),
      });
      sceneRef.current = scene;

      const game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent,
        width: parent.clientWidth || window.innerWidth,
        height: parent.clientHeight || window.innerHeight,
        backgroundColor: '#111827',
        pixelArt: true,
        antialias: false,
        roundPixels: true,
        fps: {
          target: 30,
          limit: 35,
        },
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [scene],
      });

      gameRef.current = game;

      return () => {
        sceneRef.current = null;
        game.destroy(true);
        gameRef.current = null;
      };
    }, []);

    const isSleepingRef = useRef(false);

    // Push discrete telemetry & mode updates into the live Phaser scene
    useEffect(() => {
      const game = gameRef.current;
      const scene = sceneRef.current;
      if (game && scene?.scene?.isActive()) {
        if (snapshot.mode === 'room' || snapshot.mode === 'title') {
          if (!isSleepingRef.current) {
            game.loop.sleep();
            isSleepingRef.current = true;
          }
        } else if (isSleepingRef.current) {
          game.loop.wake();
          isSleepingRef.current = false;
        }
      }
      scene?.updateSnapshot(snapshot);
    }, [snapshot]);

    return (
      <div
        ref={containerRef}
        className="rpg-canvas-host fixed inset-0 z-0 w-screen h-screen overflow-hidden select-none"
        aria-label="AutoDev Studio 交互式研发工作室游戏场景"
      />
    );
  }
);
