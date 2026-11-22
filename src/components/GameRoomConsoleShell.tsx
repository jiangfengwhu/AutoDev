import type { CSSProperties, ReactNode } from 'react';
import { Activity, ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import {
  STUDIO_IMAGES,
  STUDIO_ROOMS,
  STUDIO_ROOM_MAP,
  type StudioRoomId,
} from '../lib/studioTheme';
import type { BackgroundTask } from '../types/autodev';
import { soundEngine } from '../game/soundEngine';

interface GameRoomConsoleShellProps {
  roomId: StudioRoomId;
  statusSpeech: string;
  isBusy: boolean;
  repoFullName: string;
  studioLevel: number;
  backgroundTasks: BackgroundTask[];
  muted: boolean;
  onToggleMute: () => void;
  onSwitchRoom: (roomId: StudioRoomId) => void;
  onExitToOverworld: () => void;
  onOpenTasksDrawer: () => void;
  children: ReactNode;
}

export function GameRoomConsoleShell({
  roomId,
  statusSpeech,
  isBusy,
  repoFullName,
  studioLevel,
  backgroundTasks,
  muted,
  onToggleMute,
  onSwitchRoom,
  onExitToOverworld,
  onOpenTasksDrawer,
  children,
}: GameRoomConsoleShellProps) {
  const room = STUDIO_ROOM_MAP[roomId];
  const runningTasksCount = backgroundTasks.filter((t) => t.status === 'running').length;

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-[#080C15]">
      {/* Architectural workstation drafting-desk outer atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src={STUDIO_IMAGES.roomConsoleBg}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-20"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 0%, rgba(245,158,11,0.08), rgba(8,12,21,0.94) 55%, rgba(6,9,16,0.98) 100%)',
          }}
        />
      </div>

      {/* Main In-Game Tactical RPG Workstation Console Frame */}
      <div className="relative z-10 flex-1 flex flex-col max-w-[1440px] w-full mx-auto p-2.5 sm:p-4 min-h-0">
        <div className="rpg-console-frame flex-1 flex flex-col rounded-xl overflow-hidden min-h-0">
          {/* Top Console Brass Titlebar & Quick Room Tabs */}
          <div className="shrink-0 bg-[#101625] border-b-2 border-[#2C3A57] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playDoorTransition();
                  onExitToOverworld();
                }}
                className="rpg-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>返回大厅</span>
                <span className="rpg-keycap ml-0.5">Esc</span>
              </button>

              <div className="hidden md:flex items-center gap-2 text-xs font-mono text-[#94A3B8] pl-1">
                <span className="text-[#FBBF24] font-bold">LV.{studioLevel}</span>
                <span>·</span>
                <span className="truncate max-w-[180px]">{repoFullName}</span>
              </div>
            </div>

            {/* Compact Single-Row Room Switcher (1..6) */}
            <nav
              aria-label="工位快速切换"
              className="flex items-center gap-1 overflow-x-auto max-w-full"
            >
              {STUDIO_ROOMS.map((item) => {
                const active = item.id === roomId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (!active) {
                        soundEngine.playDoorTransition();
                        onSwitchRoom(item.id);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 border transition-colors ${
                      active
                        ? 'bg-[#1D2840] border-[#F59E0B] text-[#FEF3C7]'
                        : 'bg-[#0D1320] border-[#293652] text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#475A82]'
                    }`}
                  >
                    <span className="font-mono text-[10px] text-[#F59E0B]">{item.hotkey}</span>
                    <span>{item.shortNavLabel}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right Utility Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playUiClick();
                  onOpenTasksDrawer();
                }}
                className={`rpg-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  runningTasksCount > 0 ? 'border-[#38BDF8] text-[#7DD3FC]' : ''
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  后台{runningTasksCount > 0 ? ` (${runningTasksCount})` : ''}
                </span>
              </button>

              <button
                type="button"
                aria-label={muted ? '开启音效' : '静音'}
                onClick={() => onToggleMute()}
                className="rpg-btn-secondary inline-flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer shrink-0"
              >
                {muted ? (
                  <VolumeX className="w-3.5 h-3.5 text-[#94A3B8]" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-[#F59E0B]" />
                )}
              </button>
            </div>
          </div>

          {/* NPC Workstation Dialogue Strip — grounds every room inside the RPG world */}
          <div
            className="shrink-0 px-4 py-3 border-b border-[#25324B] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            style={{
              background:
                'linear-gradient(90deg, rgba(22,30,49,0.95) 0%, rgba(15,21,36,0.92) 60%, rgba(13,18,30,0.95) 100%)',
            }}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <button
                type="button"
                onClick={() => soundEngine.playDialogueBlip()}
                title="点击与角色打招呼"
                className="relative shrink-0 rounded-lg overflow-hidden border-2 cursor-pointer"
                style={{ borderColor: room.accentHex }}
              >
                <img
                  src={room.avatarUrl}
                  alt={room.characterName}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 object-cover block"
                />
              </button>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="font-mono text-xs font-bold tracking-wide"
                    style={{ color: room.accentHex }}
                  >
                    {room.roomCode}
                  </span>
                  <h1 className="font-display text-base sm:text-lg font-bold text-[#F8FAFC] truncate">
                    {room.roomName}
                  </h1>
                  <span className="text-xs font-mono text-[#94A3B8]">
                    · {room.characterName}（{room.characterRole}）
                  </span>
                  {isBusy && (
                    <span className="font-mono text-[11px] font-bold text-[#38BDF8]">
                      · 作业中
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs sm:text-sm text-[#CBD5E1] truncate">
                  “{statusSpeech}”
                </p>
              </div>
            </div>

            <div className="hidden lg:block text-right shrink-0 max-w-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                STATION ARCHIVE · 室内存放资料
              </div>
              <div className="text-xs text-[#94A3B8] truncate mt-0.5">{room.storedArtifacts}</div>
            </div>
          </div>

          {/* Scrollable RPG-Styled Room Workstation Content */}
          <div
            className="rpg-room-surface flex-1 overflow-y-auto px-4 sm:px-6 py-5"
            style={{ '--rpg-accent': room.accentHex } as CSSProperties}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
