import {
  Activity,
  Compass,
  Pause,
  PlusCircle,
  Volume2,
  VolumeX,
  ArrowRight,
  Music,
} from 'lucide-react';
import { STUDIO_IMAGES, STUDIO_ROOMS, STUDIO_ROOM_MAP, type StudioRoomId } from '../lib/studioTheme';
import type { StudioProgressionState } from '../game/studioWorldData';
import type { BackgroundTask } from '../types/autodev';
import { soundEngine } from '../game/soundEngine';

interface GameHudOverlayProps {
  repoFullName: string;
  progression: StudioProgressionState;
  nearbyRoomId: StudioRoomId | null;
  roomSpeeches: Record<StudioRoomId, { speech: string; metricLabel: string; isBusy: boolean }>;
  backgroundTasks: BackgroundTask[];
  isRequirementInProgress: boolean;
  muted: boolean;
  bgmEnabled: boolean;
  onToggleMute: () => void;
  onToggleBgm: () => void;
  onOpenPause: () => void;
  onOpenTasksDrawer: () => void;
  onEnterRoom: (roomId: StudioRoomId) => void;
  onTeleportToRoom: (roomId: StudioRoomId) => void;
  onOpenNewPrd: () => void;
}

export function GameHudOverlay({
  repoFullName,
  progression,
  nearbyRoomId,
  roomSpeeches,
  backgroundTasks,
  isRequirementInProgress,
  muted,
  bgmEnabled,
  onToggleMute,
  onToggleBgm,
  onOpenPause,
  onOpenTasksDrawer,
  onEnterRoom,
  onTeleportToRoom,
  onOpenNewPrd,
}: GameHudOverlayProps) {
  const runningTasksCount = backgroundTasks.filter((t) => t.status === 'running').length;
  const nearbyMeta = nearbyRoomId ? STUDIO_ROOM_MAP[nearbyRoomId] : null;
  const nearbyState = nearbyRoomId ? roomSpeeches[nearbyRoomId] : null;
  const questTargetMeta = STUDIO_ROOM_MAP[progression.activeQuest.targetRoomId];

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-3.5 sm:p-4 select-none">
      {/* TOP BAR: Compact corner clusters leaving >= 85% open playfield */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left: Studio Guild Rank + Real XP + Active Main Quest */}
        <div className="pointer-events-auto flex flex-col gap-2 max-w-[360px]">
          <div className="rpg-hud-panel-brass rounded-lg px-3 py-2 flex items-center gap-3">
            <img
              src={STUDIO_IMAGES.guildEmblem}
              alt="AutoDev Studio 徽章"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-md object-cover border border-[#F59E0B]/60 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-[#FBBF24] whitespace-nowrap">
                  LV.{progression.level} · {progression.rankTitle}
                </span>
                <span className="font-mono text-[11px] text-[#94A3B8] tabular-nums whitespace-nowrap">
                  {progression.xpInCurrentLevel}/{progression.xpForNextLevel} XP
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-sm bg-[#090D16] border border-[#334155] overflow-hidden">
                <div
                  className="h-full bg-[#F59E0B] transition-all duration-300"
                  style={{ width: `${Math.max(8, progression.xpProgressPct)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-mono text-[#94A3B8]">
                <span className="truncate">{repoFullName}</span>
                <span className="text-[#34D399] whitespace-nowrap tabular-nums">
                  交付 {progression.deliveredCount}
                </span>
              </div>
            </div>
          </div>

          {/* Active Main Quest Tracker (clickable to jump straight to target room) */}
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              soundEngine.playUiClick();
              onTeleportToRoom(progression.activeQuest.targetRoomId);
              onEnterRoom(progression.activeQuest.targetRoomId);
            }}
            className="rpg-hud-panel rounded-lg px-3 py-2 text-left hover:border-[#F59E0B] transition-colors cursor-pointer group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#FBBF24]">
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span>主线任务 {progression.activeQuest.stageIndex}/{progression.activeQuest.totalStages}</span>
                <span className="text-[#64748B]">·</span>
                <span className="text-[#E2E8F0]">{progression.activeQuest.stageLabel}</span>
              </span>
              <span className="font-mono text-[10px] text-[#38BDF8] group-hover:text-[#FBBF24] whitespace-nowrap">
                前往 {questTargetMeta.roomCode} →
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[#F8FAFC] truncate">
              {progression.activeQuest.questTitle}
            </div>
          </button>
        </div>

        {/* Top-Right: Compact Action & System Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              soundEngine.playUiClick();
              onOpenNewPrd();
            }}
            className="rpg-btn-primary inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{isRequirementInProgress ? '策划室' : '新建需求'}</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              soundEngine.playUiClick();
              onOpenTasksDrawer();
            }}
            className={`rpg-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
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
            tabIndex={-1}
            aria-label={bgmEnabled ? '关闭背景音乐' : '开启背景音乐'}
            title={bgmEnabled ? '关闭背景音乐' : '开启背景音乐'}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleBgm();
            }}
            className={`rpg-btn-secondary inline-flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer shrink-0 ${
              bgmEnabled && !muted ? 'border-[#34D399]/70 text-[#34D399]' : 'text-[#94A3B8]'
            }`}
          >
            <Music className="w-4 h-4" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label={muted ? '开启音效' : '静音'}
            title="音效开关 (M)"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="rpg-btn-secondary inline-flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer shrink-0"
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-[#94A3B8]" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#F59E0B]" />
            )}
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label="暂停与控制说明"
            title="菜单 (Esc / P)"
            onClick={(e) => {
              e.currentTarget.blur();
              soundEngine.playUiClick();
              onOpenPause();
            }}
            className="rpg-btn-secondary inline-flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer shrink-0"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* BOTTOM AREA: Proximity RPG Dialogue Box + Single-Row Room Quick Teleport Dock */}
      <div className="flex flex-col items-center gap-2.5">
        {nearbyMeta && nearbyState && (
          <div className="pointer-events-auto rpg-dialogue-box w-full max-w-2xl rounded-xl px-4 py-3 flex items-center gap-3.5">
            <img
              src={nearbyMeta.avatarUrl}
              alt={nearbyMeta.characterName}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-lg object-cover border-2 shrink-0"
              style={{ borderColor: nearbyMeta.accentHex }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="font-bold text-[#F8FAFC]">{nearbyMeta.characterName}</span>
                <span className="text-[#64748B]">·</span>
                <span style={{ color: nearbyMeta.accentHex }}>
                  {nearbyMeta.roomCode} {nearbyMeta.shortNavLabel}
                </span>
                <span className="text-[#64748B]">·</span>
                <span className="text-[#94A3B8] truncate">{nearbyState.metricLabel}</span>
              </div>
              <p className="mt-1 text-sm text-[#E2E8F0] leading-snug line-clamp-2">
                “{nearbyState.speech}”
              </p>
            </div>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                soundEngine.playDoorTransition();
                onEnterRoom(nearbyMeta.id);
              }}
              className="rpg-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
            >
              <span className="rpg-keycap !bg-[#0B0F18] !text-[#FBBF24] !border-[#92400E]">E</span>
              <span>进入{nearbyMeta.shortNavLabel}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Compact Single-Row 6-Room Quick Teleport Hotbar */}
        <div className="pointer-events-auto rpg-hud-panel rounded-xl px-2 py-1.5 flex items-center gap-1 overflow-x-auto max-w-full">
          {STUDIO_ROOMS.map((room) => {
            const st = roomSpeeches[room.id];
            const isNear = nearbyRoomId === room.id;
            const isQuest = progression.activeQuest.targetRoomId === room.id;
            return (
              <button
                key={room.id}
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  soundEngine.playDoorTransition();
                  onTeleportToRoom(room.id);
                  onEnterRoom(room.id);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 border transition-colors ${
                  isNear
                    ? 'bg-[#1F2A40] border-[#F59E0B] text-[#FEF3C7]'
                    : isQuest
                      ? 'bg-[#182135] border-[#F59E0B]/50 text-[#F8FAFC] hover:border-[#F59E0B]'
                      : 'bg-transparent border-transparent text-[#CBD5E1] hover:bg-[#192235] hover:border-[#35435E]'
                }`}
              >
                <span className="rpg-keycap">{room.hotkey}</span>
                <span>{room.shortNavLabel}</span>
                {st?.isBusy && (
                  <span className="font-mono text-[10px] font-bold text-[#38BDF8]">RUN</span>
                )}
                {!st?.isBusy && isQuest && (
                  <span className="font-mono text-[10px] font-bold text-[#F59E0B]">!</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
