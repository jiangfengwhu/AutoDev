import { useEffect, useState } from 'react';
import { Volume2, VolumeX, Play } from 'lucide-react';
import { STUDIO_IMAGES } from '../lib/studioTheme';
import { soundEngine } from '../game/soundEngine';

interface GameTitleScreenProps {
  repoFullName: string;
  studioLevel: number;
  deliveredCount: number;
  muted: boolean;
  onStartGame: () => void;
  onToggleMute: () => void;
}

export function GameTitleScreen({
  repoFullName,
  studioLevel,
  deliveredCount,
  muted,
  onStartGame,
  onToggleMute,
}: GameTitleScreenProps) {
  const [artLoaded, setArtLoaded] = useState(true);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        soundEngine.unlock();
        soundEngine.playQuestAccept();
        onStartGame();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStartGame]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-between overflow-hidden select-none bg-[#080C15]">
      {/* Right-aligned full-richness 16-bit pixel-art studio night scene (no double-exposure ghosting) */}
      {artLoaded && (
        <div className="pointer-events-none absolute inset-0">
          <img
            src={STUDIO_IMAGES.titleArt}
            alt="AutoDev Studio 像素风研发工作室夜景"
            referrerPolicy="no-referrer"
            onError={() => setArtLoaded(false)}
            className="w-full h-full object-cover object-right opacity-92"
          />
        </div>
      )}

      {/* Clean horizontal dark atmospheric vignette keeping left 42% calm for title typography */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(94deg, rgba(8,12,21,0.98) 0%, rgba(8,12,21,0.92) 34%, rgba(8,12,21,0.52) 56%, rgba(8,12,21,0.12) 82%, rgba(8,12,21,0.34) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28"
        style={{
          background: 'linear-gradient(180deg, rgba(8,12,21,0) 0%, rgba(8,12,21,0.95) 100%)',
        }}
      />

      {/* Top subtle repo & studio rank ribbon */}
      <div className="relative z-10 flex items-center justify-between px-8 pt-7 sm:px-14">
        <div className="flex items-center gap-3 text-xs font-mono tracking-wider text-[#94A3B8]">
          <span className="text-[#F59E0B] font-semibold">LV.{studioLevel}</span>
          <span>·</span>
          <span>{repoFullName}</span>
          {deliveredCount > 0 && (
            <>
              <span>·</span>
              <span className="text-[#34D399]">已交付 {deliveredCount} 项需求</span>
            </>
          )}
        </div>
      </div>

      {/* Main Title Lockup & Actions — anchored cleanly in the calm left negative space */}
      <div className="relative z-10 flex-1 flex items-center px-8 sm:px-14 lg:px-20">
        <div className="max-w-xl">
          {/* Bespoke Inline SVG RPG Guild Emblem */}
          <div className="mb-5 flex items-center gap-4">
            <svg
              width="54"
              height="54"
              viewBox="0 0 54 54"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              className="shrink-0 drop-shadow-[0_6px_16px_rgba(245,158,11,0.3)]"
            >
              <path
                d="M27 3L48 11V28C48 39.8 38.6 47.4 27 51C15.4 47.4 6 39.8 6 28V11L27 3Z"
                fill="#141C2E"
                stroke="#F59E0B"
                strokeWidth="2.5"
              />
              <path
                d="M27 8L43 14.2V27.6C43 36.8 35.8 42.9 27 45.8C18.2 42.9 11 36.8 11 27.6V14.2L27 8Z"
                fill="#0D1422"
                stroke="#FDE68A"
                strokeOpacity="0.35"
                strokeWidth="1.2"
              />
              <path
                d="M20 22L15 27L20 32M34 22L39 27L34 32M29.5 19L24.5 35"
                stroke="#34D399"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="text-xs font-mono uppercase tracking-[0.22em] text-[#FBBF24]">
              AUTODEV STUDIO · 研发工坊模拟器
            </div>
          </div>

          <h1
            className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight text-[#F8FAFC] leading-[1.08]"
            style={{ textShadow: '0 4px 24px rgba(0,0,0,0.75)' }}
          >
            软件研发物语
          </h1>

          <p className="mt-4 text-base sm:text-lg text-[#CBD5E1] leading-relaxed max-w-md">
            亲手走进六大职能研发室，指挥架构师、编码 Agent 与质量进化实验室，把真实 PRD 一步步交付上线。
          </p>

          {/* Maximum 2 clean actions */}
          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <button
              type="button"
              data-start="true"
              onClick={(e) => {
                e.currentTarget.blur();
                soundEngine.unlock();
                soundEngine.playQuestAccept();
                onStartGame();
              }}
              className="rpg-btn-primary inline-flex items-center gap-2.5 px-7 py-3.5 rounded-lg text-base font-bold tracking-wide cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>进入工作室</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                soundEngine.unlock();
                onToggleMute();
              }}
              className="rpg-btn-secondary inline-flex items-center gap-2 px-4 py-3.5 rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              {muted ? <VolumeX className="w-4 h-4 text-[#94A3B8]" /> : <Volume2 className="w-4 h-4 text-[#F59E0B]" />}
              <span>{muted ? '音效：关' : '音效：开'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom flat single-line control hint strip */}
      <div className="relative z-10 px-8 pb-6 sm:px-14 flex items-center justify-between text-xs font-mono text-[#94A3B8]">
        <div className="truncate">
          WASD / 方向键 移动 · 点击地板走动 · E 进入工位 · 1–6 快速传送 · M 音效 · Esc 菜单
        </div>
        <div className="hidden sm:block shrink-0 text-[#64748B]">
          按 Enter 或 Space 开始
        </div>
      </div>
    </div>
  );
}
