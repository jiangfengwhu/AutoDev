import { Play, RotateCcw, Volume2, VolumeX, Music, Keyboard } from 'lucide-react';
import type { StudioProgressionState } from '../game/studioWorldData';
import { soundEngine } from '../game/soundEngine';

interface GamePauseModalProps {
  open: boolean;
  repoFullName: string;
  progression: StudioProgressionState;
  runningTasksCount: number;
  muted: boolean;
  bgmEnabled: boolean;
  onResume: () => void;
  onReturnToTitle: () => void;
  onToggleMute: () => void;
  onToggleBgm: () => void;
}

export function GamePauseModal({
  open,
  repoFullName,
  progression,
  runningTasksCount,
  muted,
  bgmEnabled,
  onResume,
  onReturnToTitle,
  onToggleMute,
  onToggleBgm,
}: GamePauseModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#060911]/82 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="游戏菜单与控制说明"
    >
      <div className="rpg-hud-panel-brass w-full max-w-md rounded-xl p-6 text-[#E2E8F0]">
        <div className="flex items-center justify-between border-b border-[#334155] pb-3.5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-[#FBBF24]">
              STUDIO MENU · 暂停菜单
            </div>
            <h2 className="font-display text-xl font-bold text-[#F8FAFC] mt-0.5">
              AutoDev Studio
            </h2>
          </div>
          <div className="text-right font-mono text-xs">
            <div className="text-[#FBBF24] font-bold">LV.{progression.level}</div>
            <div className="text-[#94A3B8] text-[11px]">{repoFullName}</div>
          </div>
        </div>

        {/* Studio progress snapshot */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center font-mono">
          <div className="rounded-lg bg-[#0D1320] border border-[#2A3650] py-2 px-2">
            <div className="text-[10px] text-[#94A3B8]">已交付需求</div>
            <div className="text-base font-bold text-[#34D399] tabular-nums mt-0.5">
              {progression.deliveredCount}
            </div>
          </div>
          <div className="rounded-lg bg-[#0D1320] border border-[#2A3650] py-2 px-2">
            <div className="text-[10px] text-[#94A3B8]">累计经验</div>
            <div className="text-base font-bold text-[#FBBF24] tabular-nums mt-0.5">
              {progression.totalXp}
            </div>
          </div>
          <div className="rounded-lg bg-[#0D1320] border border-[#2A3650] py-2 px-2">
            <div className="text-[10px] text-[#94A3B8]">后台任务</div>
            <div className="text-base font-bold text-[#38BDF8] tabular-nums mt-0.5">
              {runningTasksCount}
            </div>
          </div>
        </div>

        {/* Audio settings */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-[#0D1320] border border-[#2A3650] px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-sm text-[#E2E8F0]">
              {muted ? (
                <VolumeX className="w-4 h-4 text-[#94A3B8]" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#F59E0B]" />
              )}
              <span>交互音效与脚步声</span>
            </div>
            <button
              type="button"
              onClick={() => onToggleMute()}
              className="rpg-btn-secondary px-3 py-1 rounded text-xs font-semibold cursor-pointer"
            >
              {muted ? '已静音' : '开启'}
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-[#0D1320] border border-[#2A3650] px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-sm text-[#E2E8F0]">
              <Music className="w-4 h-4 text-[#34D399]" />
              <span>工作室 16-bit 背景音乐</span>
            </div>
            <button
              type="button"
              onClick={() => onToggleBgm()}
              className="rpg-btn-secondary px-3 py-1 rounded text-xs font-semibold cursor-pointer"
            >
              {bgmEnabled && !muted ? '播放中' : '关闭'}
            </button>
          </div>
        </div>

        {/* Controls reference */}
        <div className="mt-4 rounded-lg bg-[#0B101C] border border-[#26324B] p-3">
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#94A3B8] mb-2">
            <Keyboard className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>操作键位</span>
          </div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs text-[#CBD5E1]">
            <div className="flex items-center gap-2">
              <span className="rpg-keycap">WASD</span>
              <span>人物移动</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rpg-keycap">E</span>
              <span>进入附近工位</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rpg-keycap">1-6</span>
              <span>快速传送房间</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rpg-keycap">M</span>
              <span>切换静音</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rpg-keycap">Esc</span>
              <span>返回/暂停</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rpg-keycap">点击</span>
              <span>地板走动 / 角色</span>
            </div>
          </div>
        </div>

        {/* Primary actions */}
        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiClick();
              onResume();
            }}
            className="rpg-btn-primary flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>继续游玩</span>
          </button>
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiClick();
              onReturnToTitle();
            }}
            className="rpg-btn-secondary inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>返回标题</span>
          </button>
        </div>
      </div>
    </div>
  );
}
