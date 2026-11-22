import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Factory,
  FileText,
  GitBranch,
  Layers,
  Loader2,
  Maximize2,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  SkipForward,
  Sparkles,
  Stamp,
} from 'lucide-react';
import {
  DEMO_PIPELINE_PHASES,
  FACTORY_STATIONS,
  type FactoryMode,
  type FactoryPipelineSnapshot,
  type FactoryStationId,
  type StationLedState,
} from '../../lib/factoryPipelineState';
import { getStationIndex, STATION_ORDER } from '../../three/cleanroomMath';

export interface CleanroomHudOverlayProps {
  snapshot: FactoryPipelineSnapshot;
  focusedStationId: FactoryStationId;
  factoryMode: FactoryMode;
  autoFollowCamera: boolean;
  repoFullName: string;
  githubConnected: boolean;
  runningTasksCount: number;
  railCollapsed: boolean;
  demoPhaseIndex: number;
  demoPlaying: boolean;
  onSelectStationFocus: (stationId: FactoryStationId) => void;
  onStepStation: (delta: -1 | 1) => void;
  onOpenDrawer: (stationId: FactoryStationId) => void;
  onOpenBgTasks: () => void;
  onSwitchMode: (mode: FactoryMode) => void;
  onToggleAutoFollow: () => void;
  onToggleRailCollapsed: () => void;
  onDemoSelectPhase: (phaseIndex: number) => void;
  onDemoTogglePlay: () => void;
  onDemoNextPhase: () => void;
  onDemoReplay: () => void;
  onZoomPreview: () => void;
  onQuickApproveStamp: () => void;
  onOpenLatestReport: () => void;
}

function getLedBadgeStyle(led: StationLedState): {
  dotClass: string;
  chipClass: string;
} {
  switch (led) {
    case 'running':
      return {
        dotClass: 'bg-[#2563EB]',
        chipClass: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]',
      };
    case 'waiting':
      return {
        dotClass: 'bg-[#D97706]',
        chipClass: 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]',
      };
    case 'passed':
      return {
        dotClass: 'bg-[#059669]',
        chipClass: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]',
      };
    case 'rework':
      return {
        dotClass: 'bg-[#DC2626]',
        chipClass: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]',
      };
    case 'idle':
    default:
      return {
        dotClass: 'bg-[#94A3B8]',
        chipClass: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]',
      };
  }
}

export function CleanroomHudOverlay({
  snapshot,
  focusedStationId,
  factoryMode,
  autoFollowCamera,
  repoFullName,
  githubConnected,
  runningTasksCount,
  railCollapsed,
  demoPhaseIndex,
  demoPlaying,
  onSelectStationFocus,
  onStepStation,
  onOpenDrawer,
  onOpenBgTasks,
  onSwitchMode,
  onToggleAutoFollow,
  onToggleRailCollapsed,
  onDemoSelectPhase,
  onDemoTogglePlay,
  onDemoNextPhase,
  onDemoReplay,
  onZoomPreview,
  onQuickApproveStamp,
  onOpenLatestReport,
}: CleanroomHudOverlayProps) {
  const stationMeta = FACTORY_STATIONS[focusedStationId];
  const stationState = snapshot.stationStates[focusedStationId];
  const badgeStyle = getLedBadgeStyle(stationState.led);
  const focusedIdx = getStationIndex(focusedStationId);
  const isReworkLoopActive = snapshot.tracks.reworkSt03ToSt02 === 'rework';

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {/* =====================================================================
          TOP THIN FLOATING ARCHITECTURAL BAR (Zero backdrop-filter over WebGL)
         ===================================================================== */}
      <header className="absolute top-4 left-4 right-4 sm:top-5 sm:left-5 sm:right-5 flex items-center justify-between gap-3">
        {/* Top-Left: Brand + Focused Studio Nameplate + Compact Active Workpiece */}
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-[#DCE4EE] bg-white/95 px-3.5 py-2 shadow-[0_8px_28px_rgba(15,23,42,0.07)]">
          <div className="h-8 w-8 rounded-lg bg-[#0F172A] text-white flex items-center justify-center shrink-0">
            <Factory className="h-4 w-4" />
          </div>

          <div className="min-w-0 pr-2.5 border-r border-[#E2E8F0]">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[13.5px] font-bold tracking-tight text-[#0F172A] whitespace-nowrap">
                AutoDev Studio
              </h1>
              <span className="hidden md:inline-block font-mono text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                3D CLEANROOM
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-[#64748B]">
              <GitBranch className="h-3 w-3 text-[#2563EB] shrink-0" />
              <span className="truncate max-w-[140px]">{repoFullName}</span>
              <span aria-hidden="true">·</span>
              <span className={githubConnected ? 'text-[#059669] font-semibold' : 'text-[#64748B]'}>
                {githubConnected ? 'LIVE' : 'STANDBY'}
              </span>
            </div>
          </div>

          {/* Focused Single Studio Nameplate */}
          <div className="flex items-center gap-2" data-testid="hud-focused-nameplate">
            <span className="rounded-md bg-[#0F172A] px-2 py-0.5 font-mono text-[11px] font-bold text-white tabular-nums">
              {stationMeta.stationId}
            </span>
            <div className="leading-tight">
              <div className="text-[13px] font-bold text-[#0F172A] whitespace-nowrap">
                {stationMeta.title}
                <span className="mx-1.5 text-[#CBD5E1]">/</span>
                <span className="text-[#334155] font-semibold">{stationMeta.departmentCode}</span>
              </div>
              <div className="text-[10.5px] text-[#64748B] hidden sm:block">
                {stationMeta.roleSubtitle}
              </div>
            </div>
            <span
              className={`ml-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${badgeStyle.chipClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${badgeStyle.dotClass}`} />
              <span>{stationState.statusText}</span>
            </span>
          </div>
        </div>

        {/* Top-Right: Quick Actions + Camera Auto-Follow + [真实产线 / 演练演示] */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[#DCE4EE] bg-white/95 px-2.5 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.07)]">
          <button
            type="button"
            data-testid="btn-hud-new-prd"
            onClick={() => {
              onSelectStationFocus('ST-01');
              onOpenDrawer('ST-01');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white px-2.5 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>投放 PRD</span>
          </button>

          <button
            type="button"
            data-testid="btn-hud-env"
            onClick={() => {
              onSelectStationFocus('ST-00');
              onOpenDrawer('ST-00');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#334155] px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            <Settings2 className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="hidden lg:inline">环境与引擎</span>
          </button>

          <button
            type="button"
            data-testid="btn-bg-tasks"
            onClick={onOpenBgTasks}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
              runningTasksCount > 0
                ? 'border-[#2563EB]/45 bg-[#EFF6FF] text-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#334155]'
            }`}
          >
            {runningTasksCount > 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB]" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-[#64748B]" />
            )}
            <span className="hidden xl:inline">后台任务</span>
            <span className="font-mono text-[11px] font-bold tabular-nums">
              {runningTasksCount}
            </span>
          </button>

          <button
            type="button"
            data-testid="btn-camera-follow"
            onClick={onToggleAutoFollow}
            title="自动跟随工件流转切换镜头"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
              autoFollowCamera
                ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#64748B]'
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">镜头跟随</span>
          </button>

          {/* [真实产线 / 演练演示] Switcher */}
          <div
            role="group"
            aria-label="产线视图模式切换"
            className="inline-flex items-center rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] p-0.5"
          >
            <button
              type="button"
              data-testid="mode-switch-real"
              onClick={() => onSwitchMode('real')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                factoryMode === 'real'
                  ? 'bg-white text-[#0F172A] shadow-xs border border-[#E2E8F0]'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  factoryMode === 'real' ? 'bg-[#059669]' : 'bg-[#94A3B8]'
                }`}
              />
              <span>真实产线</span>
            </button>
            <button
              type="button"
              data-testid="mode-switch-demo"
              onClick={() => onSwitchMode('demo')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                factoryMode === 'demo'
                  ? 'bg-[#2563EB] text-white shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>演练演示</span>
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================================
          TOP-CENTER REWORK ALERT RIBBON (Only when crimson return rail is active)
         ===================================================================== */}
      {isReworkLoopActive && (
        <div
          data-testid="hud-rework-banner"
          className="pointer-events-none absolute top-[74px] left-1/2 -translate-x-1/2 rounded-lg border border-[#FECACA] bg-white/96 px-3.5 py-1.5 shadow-[0_8px_24px_rgba(220,38,38,0.12)] flex items-center gap-2 whitespace-nowrap"
        >
          <span className="h-2 w-2 rounded-full bg-[#DC2626]" />
          <span className="font-mono text-[11px] font-bold tracking-wide text-[#DC2626]">
            REWORK LOOP · 盲测拦截回流
          </span>
          <span className="text-[11.5px] font-medium text-[#334155]">
            ST-03 顾航 → ST-02 陈汐自动修复
          </span>
        </div>
      )}

      {/* =====================================================================
          SUBTLE LEFT / RIGHT EDGE NAVIGATION ARROWS
         ===================================================================== */}
      <button
        type="button"
        data-testid="btn-prev-station"
        disabled={focusedIdx <= 0}
        onClick={() => onStepStation(-1)}
        aria-label="切换到上一间工作室"
        className={`pointer-events-auto absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full border border-[#DCE4EE] bg-white/94 shadow-[0_6px_20px_rgba(15,23,42,0.08)] flex items-center justify-center transition-all ${
          focusedIdx <= 0
            ? 'opacity-30 cursor-not-allowed text-[#94A3B8]'
            : 'hover:bg-white hover:scale-105 text-[#0F172A] cursor-pointer'
        }`}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <button
        type="button"
        data-testid="btn-next-station"
        disabled={focusedIdx >= STATION_ORDER.length - 1}
        onClick={() => onStepStation(1)}
        aria-label="切换到下一间工作室"
        className={`pointer-events-auto absolute right-4 sm:right-5 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full border border-[#DCE4EE] bg-white/94 shadow-[0_6px_20px_rgba(15,23,42,0.08)] flex items-center justify-center transition-all ${
          focusedIdx >= STATION_ORDER.length - 1
            ? 'opacity-30 cursor-not-allowed text-[#94A3B8]'
            : 'hover:bg-white hover:scale-105 text-[#0F172A] cursor-pointer'
        }`}
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* =====================================================================
          BOTTOM-LEFT: COMPACT WORKPIECE TELEMETRY BADGE (Single-row anchored)
         ===================================================================== */}
      <div className="pointer-events-auto hidden 2xl:flex absolute left-5 bottom-5 items-center gap-2 rounded-xl border border-[#DCE4EE] bg-white/94 px-3 py-2 shadow-[0_6px_22px_rgba(15,23,42,0.06)]">
        {snapshot.workpiece ? (
          <>
            <span
              className={`h-2 w-2 rounded-full ${getLedBadgeStyle(snapshot.workpiece.tone).dotClass}`}
            />
            <span className="font-mono text-[11px] font-bold text-[#0F172A]">
              {snapshot.workpiece.prNumberLabel}
            </span>
            <span className="text-[11.5px] font-medium text-[#334155] max-w-[130px] truncate">
              {snapshot.workpiece.title}
            </span>
            <span className="font-mono text-[10.5px] text-[#64748B]">
              · {snapshot.workpiece.statusLabel}
            </span>
          </>
        ) : (
          <span className="font-mono text-[11px] text-[#64748B]">
            ←/→ 运镜 · 拖拽 ±22° 检视
          </span>
        )}
      </div>

      {/* =====================================================================
          BOTTOM-CENTER: COLLAPSIBLE 6-STUDIO CAMERA RAIL (+ COMPACT DEMO BAR)
         ===================================================================== */}
      <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-4 sm:bottom-5 flex flex-col items-center gap-1.5 max-w-[92vw]">
        {factoryMode === 'demo' && !railCollapsed && (
          <div
            data-testid="demo-control-bar"
            className="flex items-center gap-1 rounded-xl border border-[#BFDBFE] bg-white/96 px-2 py-1 shadow-[0_8px_24px_rgba(37,99,235,0.09)] overflow-x-auto max-w-full"
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#1D4ED8] px-1 shrink-0">
              DEMO
            </span>
            {DEMO_PIPELINE_PHASES.map((phase) => {
              const isCurrent = phase.index === demoPhaseIndex;
              const isReworkStep = phase.id === 'qa_fail' || phase.id === 'rework_loop';
              return (
                <button
                  key={phase.id}
                  type="button"
                  data-testid={`demo-step-${phase.index}`}
                  onClick={() => onDemoSelectPhase(phase.index)}
                  className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isCurrent
                      ? isReworkStep
                        ? 'border-[#DC2626] bg-[#DC2626] text-white font-semibold'
                        : 'border-[#2563EB] bg-[#2563EB] text-white font-semibold'
                      : 'border-[#DCE4EE] bg-[#F8FAFC] text-[#334155] hover:border-[#2563EB]/60'
                  }`}
                >
                  {String(phase.index + 1).padStart(2, '0')} {phase.shortLabel}
                </button>
              );
            })}

            <div className="ml-1 flex items-center gap-1 border-l border-[#E2E8F0] pl-1.5 shrink-0">
              <button
                type="button"
                data-testid="demo-play-toggle"
                onClick={onDemoTogglePlay}
                className="inline-flex items-center gap-1 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#1D4ED8] hover:bg-[#DBEAFE] cursor-pointer whitespace-nowrap"
              >
                {demoPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                <span>{demoPlaying ? '暂停' : '播放'}</span>
              </button>
              <button
                type="button"
                data-testid="demo-next-step"
                onClick={onDemoNextPhase}
                className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer whitespace-nowrap"
              >
                <SkipForward className="h-3 w-3" />
                <span>下一步</span>
              </button>
              <button
                type="button"
                onClick={onDemoReplay}
                aria-label="重播演练"
                className="inline-flex items-center justify-center rounded-md border border-[#E2E8F0] bg-white p-1 text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Camera Rail */}
        <div className="flex items-center gap-1 rounded-2xl border border-[#DCE4EE] bg-white/96 px-2 py-1.5 shadow-[0_10px_32px_rgba(15,23,42,0.09)]">
          {!railCollapsed ? (
            <nav
              aria-label="3D 镜头工作室导轨"
              className="flex items-center gap-0.5"
              data-testid="camera-rail"
            >
              {STATION_ORDER.map((sid, idx) => {
                const meta = FACTORY_STATIONS[sid];
                const state = snapshot.stationStates[sid];
                const isFocused = sid === focusedStationId;
                const dotStyle = getLedBadgeStyle(state.led).dotClass;

                return (
                  <div key={sid} className="flex items-center">
                    <button
                      type="button"
                      data-testid={`rail-node-${sid}`}
                      onClick={() => onSelectStationFocus(sid)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11.5px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        isFocused
                          ? 'bg-[#0F172A] text-white shadow-xs'
                          : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${dotStyle}`} />
                      <span className="font-mono text-[10.5px] opacity-85">{sid}</span>
                      <span className="hidden md:inline">{meta.title}</span>
                    </button>
                    {idx < STATION_ORDER.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={`mx-0.5 h-[2px] w-2.5 rounded-full ${
                          idx === 2 && isReworkLoopActive ? 'bg-[#DC2626]' : 'bg-[#E2E8F0]'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </nav>
          ) : (
            <span className="px-2 font-mono text-[11px] font-semibold text-[#475569]">
              {stationMeta.stationId} · {stationMeta.title}
            </span>
          )}

          <button
            type="button"
            data-testid="btn-toggle-rail"
            onClick={onToggleRailCollapsed}
            title={railCollapsed ? '展开镜头导轨 (H)' : '收起镜头导轨 (H)'}
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] hover:text-[#0F172A] cursor-pointer"
          >
            {railCollapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* =====================================================================
          BOTTOM-RIGHT: CONTEXTUAL QUICK ACTION + [展开工位操作面板] (Anchored)
         ===================================================================== */}
      <div className="pointer-events-auto absolute right-4 sm:right-5 bottom-4 sm:bottom-5 flex items-center gap-2">
        {focusedStationId === 'ST-04' && (
          <>
            <button
              type="button"
              data-testid="btn-st04-preview-zoom"
              onClick={onZoomPreview}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE4EE] bg-white/96 hover:bg-white px-2.5 py-2 text-[12px] font-semibold text-[#334155] shadow-[0_8px_24px_rgba(15,23,42,0.07)] cursor-pointer whitespace-nowrap"
            >
              <Maximize2 className="h-3.5 w-3.5 text-[#2563EB]" />
              <span className="hidden lg:inline">放大预览</span>
            </button>
            <button
              type="button"
              data-testid="btn-st04-quick-stamp"
              onClick={onQuickApproveStamp}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white px-3 py-2 text-[12px] font-semibold shadow-[0_8px_24px_rgba(5,150,105,0.22)] cursor-pointer whitespace-nowrap"
            >
              <Stamp className="h-3.5 w-3.5" />
              <span>{snapshot.st04.isApprovedStamped ? '已签批' : '签批盖章'}</span>
            </button>
          </>
        )}

        {focusedStationId === 'ST-05' && (
          <button
            type="button"
            data-testid="btn-st05-open-report"
            onClick={onOpenLatestReport}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#A7F3D0] bg-white/96 hover:bg-[#ECFDF5] px-3 py-2 text-[12px] font-semibold text-[#047857] shadow-[0_8px_24px_rgba(15,23,42,0.07)] cursor-pointer whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>查阅报告</span>
          </button>
        )}

        <button
          type="button"
          data-testid="btn-open-station-drawer"
          onClick={() => onOpenDrawer(focusedStationId)}
          className="inline-flex items-center gap-2 rounded-xl border border-[#0F172A] bg-[#0F172A] hover:bg-[#1E293B] text-white px-3.5 py-2 text-[12px] font-semibold shadow-[0_10px_28px_rgba(15,23,42,0.16)] transition-colors cursor-pointer whitespace-nowrap"
        >
          <PanelRightOpen className="h-4 w-4" />
          <span>展开工位操作面板</span>
        </button>
      </div>
    </div>
  );
}
