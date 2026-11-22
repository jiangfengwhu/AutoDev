import { STUDIO_ROOM_MAP, type StudioRoomId } from '../lib/studioTheme';

interface GameSceneTransitionProps {
  transitionKey: number;
  targetRoomId: StudioRoomId | 'overworld' | null;
}

export function GameSceneTransition({
  transitionKey,
  targetRoomId,
}: GameSceneTransitionProps) {
  if (!targetRoomId || transitionKey === 0) return null;

  const isOverworld = targetRoomId === 'overworld';
  const room = !isOverworld ? STUDIO_ROOM_MAP[targetRoomId] : null;

  return (
    <div
      key={transitionKey}
      aria-hidden="true"
      className="rpg-shutter-overlay pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#080C15]/92"
    >
      <div className="flex flex-col items-center gap-2 text-center px-6">
        <div
          className="font-mono text-xs font-bold tracking-[0.26em] uppercase"
          style={{ color: room ? room.accentHex : '#F59E0B' }}
        >
          {room ? `${room.roomCode} · ENTERING STATION` : 'STUDIO OVERWORLD'}
        </div>
        <div className="font-display text-2xl sm:text-3xl font-extrabold text-[#F8FAFC]">
          {room ? room.roomName : '返回研发工作室大厅'}
        </div>
      </div>
    </div>
  );
}
