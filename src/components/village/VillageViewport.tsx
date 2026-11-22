import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CloudSnow,
  Moon,
  Sparkles,
  Sun,
  Sunset,
} from 'lucide-react';
import type {
  FactoryMode,
  FactoryPipelineSnapshot,
  FactoryStationId,
} from '../../lib/factoryPipelineState';
import {
  VillageSceneController,
  type VillageProjectedOverlay,
} from '../../scene/VillageSceneController';
import type {
  AtmospherePresetId,
  CameraPresetId,
  VillageBuildingId,
} from '../../scene/villageConfig';

interface VillageViewportProps {
  snapshot: FactoryPipelineSnapshot;
  repoFullName: string;
  factoryMode: FactoryMode;
  atmospherePreset: AtmospherePresetId;
  cameraPreset: CameraPresetId | null;
  cameraPresetNonce: number;
  runningTasksCount?: number;
  focusBuildingId?: VillageBuildingId | null;
  focusBuildingNonce?: number;
  showBuildingLabels?: boolean;
  paused?: boolean;
  onSelectStation: (stationId: FactoryStationId) => void;
  onSelectBackgroundTasks: () => void;
  onSwitchMode: (mode: FactoryMode) => void;
  onUserOrbitStart: () => void;
  onCelebrationComplete?: () => void;
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function formatLocalClockState(now: Date): { clockText: string; dateText: string } {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = WEEKDAY_CN[now.getDay()] ?? '';
  return {
    clockText: `${hh}:${mm}`,
    dateText: `${month}月${day}日 ${weekday}`,
  };
}

function WeatherGlyph({
  icon,
}: {
  icon: 'sun' | 'sunset' | 'moon' | 'snow' | 'leaf';
}) {
  switch (icon) {
    case 'sunset':
      return <Sunset className="h-4 w-4 text-[#F97316]" />;
    case 'moon':
      return <Moon className="h-4 w-4 text-[#6366F1]" />;
    case 'snow':
      return <CloudSnow className="h-4 w-4 text-[#0EA5E9]" />;
    default:
      return <Sun className="h-4 w-4 text-[#F59E0B]" />;
  }
}

export function VillageViewport({
  snapshot,
  repoFullName,
  factoryMode,
  atmospherePreset,
  cameraPreset,
  cameraPresetNonce,
  runningTasksCount = 0,
  focusBuildingId,
  focusBuildingNonce,
  showBuildingLabels = true,
  paused = false,
  onSelectStation,
  onSelectBackgroundTasks,
  onSwitchMode,
  onUserOrbitStart,
  onCelebrationComplete,
}: VillageViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<VillageSceneController | null>(null);
  const [overlay, setOverlay] = useState<VillageProjectedOverlay | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 1440, h: 900 });
  const [localClock, setLocalClock] = useState(() => formatLocalClockState(new Date()));

  const callbacksRef = useRef({
    onSelectStation,
    onSelectBackgroundTasks,
    onUserOrbitStart,
    onCelebrationComplete,
  });
  callbacksRef.current = {
    onSelectStation,
    onSelectBackgroundTasks,
    onUserOrbitStart,
    onCelebrationComplete,
  };

  useEffect(() => {
    const updateSize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Real-time local clock & date ticker for top-right card
  useEffect(() => {
    const tick = () => setLocalClock(formatLocalClockState(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Mount Three.js scene once
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const controller = new VillageSceneController(el, snapshot, {
      onSelectBuilding: (stationId: FactoryStationId, buildingId: VillageBuildingId) => {
        if (buildingId === 'BG-OPS') {
          callbacksRef.current.onSelectBackgroundTasks();
          return;
        }
        callbacksRef.current.onSelectStation(stationId);
      },
      onOverlayUpdate: (nextOverlay) => {
        setOverlay(nextOverlay);
      },
      onUserOrbitStart: () => {
        callbacksRef.current.onUserOrbitStart();
      },
      onCelebrationComplete: () => {
        callbacksRef.current.onCelebrationComplete?.();
      },
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync live snapshot & background running count into imperative controller
  useEffect(() => {
    controllerRef.current?.updateSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    controllerRef.current?.setRunningTasksCount(runningTasksCount);
  }, [runningTasksCount]);

  // Sync atmosphere preset
  useEffect(() => {
    controllerRef.current?.setAtmospherePreset(atmospherePreset);
  }, [atmospherePreset]);

  // Trigger camera preset fly-to whenever preset or nonce changes
  useEffect(() => {
    if (cameraPreset) {
      controllerRef.current?.setCameraPreset(cameraPreset);
    }
  }, [cameraPreset, cameraPresetNonce]);

  // Trigger camera focus fly-to for a specific department building
  useEffect(() => {
    if (focusBuildingId && focusBuildingNonce) {
      controllerRef.current?.focusBuilding(focusBuildingId);
    }
  }, [focusBuildingId, focusBuildingNonce]);

  // Pause 3D redraws while frosted-glass modals cover the viewport
  useEffect(() => {
    controllerRef.current?.setPaused(paused);
  }, [paused]);

  const atmo = overlay?.atmosphere;
  const hud = overlay?.hud;
  const isNight = (atmo?.nightFactor ?? 0) > 0.55;

  // Clamp floating AI terminal speech bubble neatly beside the active AI sanctuary
  const terminalPos = (() => {
    if (!overlay?.terminalAnchor?.visible) return null;
    const bubbleW = 310;
    const bubbleH = 190;
    const rawX = overlay.terminalAnchor.x - bubbleW - 56;
    const clampedX = Math.max(20, Math.min(viewportSize.w - bubbleW - 24, rawX));
    const rawY = overlay.terminalAnchor.y - bubbleH * 0.55;
    const clampedY = Math.max(96, Math.min(viewportSize.h - bubbleH - 110, rawY));
    return { x: clampedX, y: clampedY };
  })();

  return (
    <div
      data-testid="village-viewport"
      className="relative w-screen h-screen overflow-hidden select-none bg-[#B6DCF6]"
    >
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="village-canvas-mount"
        className="absolute inset-0 w-full h-full"
      />

      {/* =====================================================================
          3D-PROJECTED IN-WORLD DIEGETIC OVERLAYS (Parcels, Comic Burst, Terminal)
         ===================================================================== */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
        {/* Clickable building nameplate + active working stage indicator */}
        {overlay?.stationTags.map((tag) => {
          if (!tag.visible) return null;
          const occludedByTerminal =
            Boolean(hud?.terminal.visible && terminalPos) &&
            tag.buildingId === hud?.terminal.anchorBuilding;
          const showLabel =
            tag.hovered ||
            (!occludedByTerminal && showBuildingLabels);
          if (!showLabel) return null;
          return (
            <button
              key={tag.buildingId}
              type="button"
              data-testid={`station-tag-${tag.buildingId}`}
              data-working={tag.isWorking ? 'true' : 'false'}
              onClick={() =>
                tag.buildingId === 'BG-OPS'
                  ? onSelectBackgroundTasks()
                  : onSelectStation(tag.stationId)
              }
              style={{
                transform: `translate3d(${Math.round(tag.x)}px, ${Math.round(
                  tag.y
                )}px, 0) translate(-50%, -100%)`,
              }}
              className={`pointer-events-auto absolute top-0 left-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-all cursor-pointer whitespace-nowrap shadow-[0_6px_18px_-4px_rgba(15,23,42,0.14)] ${
                tag.hovered
                  ? 'bg-[#0F172A] text-white border-[#0F172A] z-20'
                  : tag.isWorking
                  ? 'bg-white/96 text-[#0F172A] border-[#93C5FD] ring-2 ring-[#2563EB]/20 z-20'
                  : isNight
                  ? 'bg-[#0F172A]/88 text-[#F8FAFC] border-white/15'
                  : 'bg-white/92 text-[#1E293B] border-[#E2E8F0]'
              }`}
            >
              {tag.isWorking && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563EB]" />
                </span>
              )}
              <span className="font-mono text-[9.5px] opacity-75">
                {tag.departmentBadge}
              </span>
              <span>{tag.label}</span>
              {tag.isWorking && tag.workingLabel && (
                <span className="ml-0.5 rounded-full bg-[#EFF6FF] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#1D4ED8]">
                  {tag.workingLabel}
                </span>
              )}
            </button>
          );
        })}

        {/* Floating White Parcel Status Pills (Video 00:09–00:53 aesthetic) */}
        {hud?.parcels.map((parcel) => {
          const coord = overlay?.parcelCoords[parcel.id];
          if (!coord || !coord.visible) return null;
          // Keep non-hero pills tucked out of top/bottom HUD zones
          if (coord.y < 84 || coord.y > viewportSize.h - 115) return null;
          return (
            <div
              key={parcel.id}
              data-testid={parcel.isHero ? 'hero-parcel-pill' : undefined}
              style={{
                transform: `translate3d(${Math.round(coord.x)}px, ${Math.round(
                  coord.y - 14
                )}px, 0) translate(-50%, -100%)`,
              }}
              className={`absolute top-0 left-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-[0_6px_18px_rgba(15,23,42,0.14)] whitespace-nowrap ${
                parcel.isHero
                  ? 'bg-white border-[#E2E8F0] text-[#0F172A]'
                  : 'bg-white/94 border-[#E2E8F0] text-[#334155]'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: parcel.accentColor }}
              />
              <span className="text-[11px] font-semibold max-w-[148px] truncate">
                {parcel.label}
              </span>
              <span className="text-[10px] font-medium text-[#64748B]">
                · {parcel.statusText}
              </span>
            </div>
          );
        })}

        {/* Comic Starburst Callout ("叮! 新需求进入产线!" — Video 00:06–00:08) */}
        {hud?.comicBurst.visible && overlay?.comicAnchor.visible && (
          <div
            data-testid="village-comic-burst"
            style={{
              transform: `translate3d(${Math.round(
                overlay.comicAnchor.x
              )}px, ${Math.round(overlay.comicAnchor.y - 12)}px, 0) translate(-50%, -100%)`,
            }}
            className="absolute top-0 left-0 z-20"
          >
            <div className="relative flex items-center justify-center px-5 py-2.5">
              <svg
                viewBox="0 0 220 74"
                className="absolute inset-0 w-full h-full drop-shadow-[0_6px_14px_rgba(15,23,42,0.22)]"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon
                  points="14,12 42,4 66,11 102,2 134,11 174,4 204,14 218,36 202,58 176,68 136,61 104,72 68,61 36,68 12,54 2,34"
                  fill={
                    hud.comicBurst.tone === 'red'
                      ? '#FEE2E2'
                      : hud.comicBurst.tone === 'emerald'
                      ? '#D1FAE5'
                      : '#FEF08A'
                  }
                  stroke={
                    hud.comicBurst.tone === 'red'
                      ? '#DC2626'
                      : hud.comicBurst.tone === 'emerald'
                      ? '#059669'
                      : '#D97706'
                  }
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className={`relative z-10 text-[12px] font-extrabold tracking-tight whitespace-nowrap ${
                  hud.comicBurst.tone === 'red'
                    ? 'text-[#991B1B]'
                    : hud.comicBurst.tone === 'emerald'
                    ? 'text-[#065F46]'
                    : 'text-[#78350F]'
                }`}
              >
                {hud.comicBurst.text}
              </span>
            </div>
          </div>
        )}

        {/* Luxury 3D Obsidian & Brushed-Brass Floating AI Telemetry Capsule */}
        {hud?.terminal.visible && terminalPos && (
          <div
            data-testid="sanctuary-terminal-bubble"
            style={{
              transform: `translate3d(${Math.round(terminalPos.x)}px, ${Math.round(
                terminalPos.y
              )}px, 0)`,
              boxShadow:
                '0 28px 60px -10px rgba(7, 12, 24, 0.56), 0 10px 24px -6px rgba(7, 12, 24, 0.36)',
            }}
            onClick={() =>
              onSelectStation(
                hud.terminal.anchorBuilding === 'AI-CODER' ? 'ST-02' : 'ST-03'
              )
            }
            className="pointer-events-auto absolute top-0 left-0 w-[322px] rounded-[20px] text-[#E6EEF8] cursor-pointer group overflow-visible"
          >
            {/* Right-pointing beveled obsidian speech tail toward the AI Sanctuary */}
            <div
              aria-hidden="true"
              style={{
                background: 'linear-gradient(135deg, #1B2436 0%, #101726 100%)',
              }}
              className="absolute -right-[6px] top-1/2 -translate-y-1/2 z-0 w-3.5 h-3.5 rotate-45 border-t border-r border-white/[0.18]"
            />

            {/* Clipped Obsidian Inner Shell — sleek optical glass rim, zero harsh bottom ledge */}
            <div
              style={{
                background:
                  'linear-gradient(160deg, #1E283D 0%, #121A2B 52%, #0B101C 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.16)',
              }}
              className="relative z-10 rounded-[20px] border border-white/[0.14] group-hover:border-white/[0.28] transition-colors overflow-hidden"
            >
              {/* Subtle top prismatic specular bar clipped seamlessly inside the rounded bezel */}
              <div
                aria-hidden="true"
                className="h-[3px] w-full"
                style={{
                  background:
                    hud.terminal.statusTone === 'rework'
                      ? 'linear-gradient(90deg, #EF4444 0%, #F59E0B 55%, #FCA5A5 100%)'
                      : hud.terminal.statusTone === 'passed'
                      ? 'linear-gradient(90deg, #10B981 0%, #34D399 55%, #A7F3D0 100%)'
                      : hud.terminal.statusTone === 'waiting'
                      ? 'linear-gradient(90deg, #D97706 0%, #FBBF24 55%, #FDE68A 100%)'
                      : hud.terminal.anchorBuilding === 'AI-CODER'
                      ? 'linear-gradient(90deg, #3B82F6 0%, #818CF8 50%, #38BDF8 100%)'
                      : 'linear-gradient(90deg, #14B8A6 0%, #34D399 55%, #67E8F9 100%)',
                }}
              />

              <div className="p-3.5 space-y-2.5">
              {/* Machined Header Bar with Sculpted Emblem */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.14] shrink-0"
                    style={{
                      background:
                        hud.terminal.anchorBuilding === 'AI-CODER'
                          ? 'linear-gradient(145deg, rgba(59,130,246,0.34), rgba(129,140,248,0.22))'
                          : 'linear-gradient(145deg, rgba(16,185,129,0.32), rgba(45,212,191,0.2))',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)',
                    }}
                  >
                    {hud.terminal.anchorBuilding === 'AI-CODER' ? (
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
                        <path
                          d="M10 2 Q11.3 8.4 18 10 Q11.3 11.6 10 18 Q8.7 11.6 2 10 Q8.7 8.4 10 2 Z"
                          fill="#93C5FD"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
                        <polygon points="10,2.5 16.5,10 10,17.5 3.5,10" fill="#5EEAD4" />
                      </svg>
                    )}
                  </span>
                  <span className="text-[12.5px] font-bold tracking-wide text-[#F8FAFC] truncate">
                    {hud.terminal.agentName}
                  </span>
                </div>

                <span
                  className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap ${
                    hud.terminal.statusTone === 'rework'
                      ? 'bg-[#EF4444]/20 border-[#F87171]/35 text-[#FECACA]'
                      : hud.terminal.statusTone === 'passed'
                      ? 'bg-[#10B981]/18 border-[#34D399]/35 text-[#A7F3D0]'
                      : hud.terminal.statusTone === 'waiting'
                      ? 'bg-[#F59E0B]/18 border-[#FBBF24]/35 text-[#FDE68A]'
                      : 'bg-[#3B82F6]/20 border-[#60A5FA]/35 text-[#BFDBFE]'
                  }`}
                >
                  {hud.terminal.statusBadge}
                </span>
              </div>

              {/* Recessed Dark-Glass Inner Telemetry Readout Well */}
              <div
                className="rounded-[12px] border border-white/[0.08] bg-[#070B14]/88 px-3 py-2.5 space-y-1.5 font-mono text-[11px] leading-relaxed tracking-[0.01em]"
                style={{
                  boxShadow:
                    'inset 0 2px 10px rgba(0, 0, 0, 0.68), 0 1px 0 rgba(255, 255, 255, 0.06)',
                }}
              >
                {hud.terminal.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`truncate ${
                      line.tone === 'pass'
                        ? 'text-[#6EE7B7]'
                        : line.tone === 'error'
                        ? 'text-[#FCA5A5]'
                        : line.tone === 'warn'
                        ? 'text-[#FCD34D]'
                        : line.tone === 'info'
                        ? 'text-[#E8F0FA]'
                        : 'text-[#94A3B8]'
                    }`}
                  >
                    {line.text}
                  </div>
                ))}
              </div>

              {/* Sculpted Luminous Footer Summary Plaque */}
              {hud.terminal.summaryPill && (
                <div
                  className="rounded-[11px] border border-[#34D399]/35 px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#A7F3D0]"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(16,185,129,0.22) 0%, rgba(5,150,105,0.14) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(167,243,208,0.2)',
                  }}
                >
                  <Check className="h-3.5 w-3.5 text-[#34D399] shrink-0" />
                  <span className="truncate">
                    {hud.terminal.summaryPill.replace(/^✓\s*/, '')}
                  </span>
                </div>
              )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Festive Launch Celebration Banner (auto-hides when celebration completes) */}
      {hud?.celebrationActive && (
        <div
          data-testid="village-celebration-banner"
          className="pointer-events-none fixed top-5 left-1/2 -translate-x-1/2 z-30 village-pavilion-enter"
        >
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#6EE7B7] bg-white/95 px-5 py-2.5 shadow-[0_16px_40px_-10px_rgba(5,150,105,0.34)]">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#ECFDF5] text-[#059669]">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-bold tracking-tight text-[#065F46] whitespace-nowrap">
              {hud.celebrationLabel || '需求已成功上线归档'}
            </span>
            <span className="text-[11.5px] font-medium text-[#047857] whitespace-nowrap">
              · 自动研发村全闭环交付达成
            </span>
          </div>
        </div>
      )}

      {/* =====================================================================
          TOP-LEFT MINIMAL PIPELINE COUNTER PILL (Video 00:34–00:53)
         ===================================================================== */}
      <div className="fixed top-4 left-4 z-20 flex flex-col gap-2">
        <button
          type="button"
          data-testid="village-pipeline-counter"
          onClick={() => onSelectStation('ST-00')}
          className="inline-flex items-center gap-2.5 rounded-2xl bg-white/96 border border-[#E2E8F0] px-4 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.12)] hover:bg-white transition-colors cursor-pointer text-left"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[#10B981] shrink-0" />
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[22px] font-extrabold leading-none text-[#0F172A] tabular-nums">
              {hud?.activePipelinesCount ?? 1}
            </span>
            <span className="text-[12.5px] font-semibold text-[#334155]">
              条流水线运转中
            </span>
          </div>
        </button>

        <div className="inline-flex items-center gap-2 rounded-xl bg-white/92 border border-[#E2E8F0] px-3 py-1.5 shadow-[0_4px_14px_rgba(15,23,42,0.08)] text-[11px] text-[#475569]">
          <span className="font-bold text-[#0F172A]">AutoDev Studio</span>
          <span className="text-[#CBD5E1]">|</span>
          <span className="font-mono text-[10.5px] text-[#2563EB] font-semibold">
            {repoFullName}
          </span>
          <span className="text-[#CBD5E1]">·</span>
          <span className="font-mono text-[10.5px] tabular-nums">
            成功率{' '}
            {snapshot.st00.successRatePct !== null
              ? `${snapshot.st00.successRatePct}%`
              : '--'}
          </span>
        </div>
      </div>

      {/* =====================================================================
          TOP-RIGHT MINIMAL CLOCK & WEATHER CARD + MODE SWITCH (Video 00:01–00:53)
         ===================================================================== */}
      <div className="fixed top-4 right-4 z-20 flex flex-col items-end gap-2">
        <div
          data-testid="village-weather-card"
          className="rounded-2xl bg-white/94 border border-white/80 px-4 py-2.5 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.05)] min-w-[176px]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span
              data-testid="live-local-time"
              className="font-mono text-[26px] font-bold tracking-tight leading-none text-[#0F172A] tabular-nums"
            >
              {localClock.clockText}
            </span>
            <span
              data-testid="live-local-date"
              className="text-[11px] font-medium text-[#64748B]"
            >
              {localClock.dateText}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-[#475569]">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <WeatherGlyph icon={atmo?.weatherIcon ?? 'sun'} />
              <span>自动研发村 · {atmo?.weatherText ?? '晴'}</span>
            </span>
            <span className="font-mono font-bold text-[#0F172A] tabular-nums">
              {atmo?.tempText ?? '26°'}
            </span>
          </div>
        </div>

        {/* Crisp Segmented Mode Toggle: [真实产线 / 演练演示] */}
        <div
          role="group"
          aria-label="产线视图模式切换"
          className="inline-flex items-center rounded-xl border border-white/80 bg-white/94 p-1 shadow-[0_10px_28px_-8px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.05)]"
        >
          <button
            type="button"
            data-testid="mode-switch-real"
            onClick={() => onSwitchMode('real')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              factoryMode === 'real'
                ? 'bg-[#0F172A] text-white'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                factoryMode === 'real' ? 'bg-[#34D399]' : 'bg-[#94A3B8]'
              }`}
            />
            <span>真实产线</span>
          </button>
          <button
            type="button"
            data-testid="mode-switch-demo"
            onClick={() => onSwitchMode('demo')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              factoryMode === 'demo'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            <span>演练演示</span>
          </button>
        </div>
      </div>
    </div>
  );
}
