import { useEffect, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CloudSnow,
  FilePlus2,
  Grid2x2,
  Layers,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipForward,
  Sun,
  Sunset,
} from 'lucide-react';
import {
  DEMO_PIPELINE_PHASES,
  FACTORY_STATIONS,
  type FactoryMode,
  type FactoryStationId,
} from '../../lib/factoryPipelineState';
import type {
  AtmospherePresetId,
  CameraPresetId,
} from '../../scene/villageConfig';

interface VillageBottomDockProps {
  factoryMode: FactoryMode;
  cameraPreset: CameraPresetId | null;
  atmospherePreset: AtmospherePresetId;
  runningTasksCount: number;
  demoPhaseIndex: number;
  demoPlaying: boolean;
  onSelectCameraPreset: (preset: CameraPresetId) => void;
  onSelectAtmosphere: (preset: AtmospherePresetId) => void;
  onOpenStation: (stationId: FactoryStationId) => void;
  onOpenTasks: () => void;
  onDemoSelectPhase: (index: number) => void;
  onDemoTogglePlay: () => void;
  onDemoNextStep: () => void;
  onDemoReplay: () => void;
}

const CAMERA_BUTTONS: Array<{ id: CameraPresetId; label: string }> = [
  { id: 'overview', label: '全景' },
  { id: 'follow', label: '跟随' },
  { id: 'sanctuary_coder', label: 'Gemini 圣殿' },
  { id: 'sanctuary_cloud', label: '质检圣殿' },
  { id: 'rotunda', label: '中枢穹顶' },
];

const ATMO_BUTTONS: Array<{
  id: AtmospherePresetId;
  label: string;
  icon: typeof Sun;
}> = [
  { id: 'day', label: '晴', icon: Sun },
  { id: 'sunset', label: '暮', icon: Sunset },
  { id: 'night', label: '夜', icon: Moon },
  { id: 'snow', label: '雪', icon: CloudSnow },
  { id: 'cycle', label: '四季', icon: RefreshCw },
];

const QUICK_STATIONS: FactoryStationId[] = [
  'ST-00',
  'ST-01',
  'ST-02',
  'ST-03',
  'ST-04',
  'ST-05',
];

export function VillageBottomDock({
  factoryMode,
  cameraPreset,
  atmospherePreset,
  runningTasksCount,
  demoPhaseIndex,
  demoPlaying,
  onSelectCameraPreset,
  onSelectAtmosphere,
  onOpenStation,
  onOpenTasks,
  onDemoSelectPhase,
  onDemoTogglePlay,
  onDemoNextStep,
  onDemoReplay,
}: VillageBottomDockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [stationsPopoverOpen, setStationsPopoverOpen] = useState(false);

  // 'H' keyboard shortcut toggles HUD dock per threejs skill ergonomics
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT')
      );
      if (!isTyping && (e.key === 'h' || e.key === 'H')) {
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (collapsed) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20">
        <button
          type="button"
          data-testid="dock-expand-btn"
          onClick={() => setCollapsed(false)}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/96 border border-[#CBD5E1] px-4 py-1.5 text-[12px] font-semibold text-[#0F172A] shadow-[0_8px_24px_rgba(15,23,42,0.16)] hover:bg-white cursor-pointer"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          <span>展开镜头与工位栏</span>
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="village-bottom-dock"
      className="fixed bottom-3.5 left-1/2 -translate-x-1/2 z-20 max-w-[96vw] flex flex-col items-center gap-1.5"
    >
      {/* On-demand 6-Department Quick-Jump Popover */}
      {stationsPopoverOpen && (
        <div
          data-testid="stations-popover"
          className="rounded-2xl bg-white/95 border border-white/85 px-3 py-2 shadow-[0_18px_40px_-10px_rgba(15,23,42,0.18),0_4px_12px_rgba(15,23,42,0.06)] flex flex-wrap items-center justify-center gap-1.5"
        >
          {QUICK_STATIONS.map((sid) => {
            const meta = FACTORY_STATIONS[sid];
            return (
              <button
                key={sid}
                type="button"
                data-testid={`quick-station-${sid}`}
                onClick={() => {
                  setStationsPopoverOpen(false);
                  onOpenStation(sid);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]/80 px-2.5 py-1 text-[11.5px] font-semibold text-[#1E293B] hover:border-[#2563EB] hover:bg-[#EFF6FF] hover:text-[#1D4ED8] transition-colors cursor-pointer whitespace-nowrap"
              >
                <span className="font-mono text-[10px] text-[#64748B]">{sid}</span>
                <span>{meta.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Demo Closed-Loop Compact Strip (only in Demo Mode) */}
      {factoryMode === 'demo' && (
        <div
          data-testid="demo-control-bar"
          className="rounded-full bg-white/96 border border-[#BFDBFE] px-2.5 py-1 shadow-[0_8px_22px_rgba(15,23,42,0.14)] flex items-center gap-1 overflow-x-auto max-w-[94vw]"
        >
          {DEMO_PIPELINE_PHASES.map((phase) => {
            const active = phase.index === demoPhaseIndex;
            const isRework = phase.id === 'qa_fail' || phase.id === 'rework_loop';
            return (
              <button
                key={phase.id}
                type="button"
                data-testid={`demo-step-${phase.index}`}
                onClick={() => onDemoSelectPhase(phase.index)}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? isRework
                      ? 'bg-[#DC2626] text-white'
                      : 'bg-[#2563EB] text-white'
                    : 'text-[#475569] hover:bg-[#F1F5F9]'
                }`}
              >
                {String(phase.index + 1).padStart(2, '0')} {phase.shortLabel}
              </button>
            );
          })}
          <div className="h-3.5 w-px bg-[#CBD5E1] mx-0.5 shrink-0" />
          <button
            type="button"
            data-testid="demo-play-toggle"
            onClick={onDemoTogglePlay}
            title={demoPlaying ? '暂停演练' : '继续演练'}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE] cursor-pointer shrink-0"
          >
            {demoPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <button
            type="button"
            data-testid="demo-next-step"
            onClick={onDemoNextStep}
            title="下一阶段"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#F8FAFC] text-[#334155] hover:bg-[#E2E8F0] cursor-pointer shrink-0"
          >
            <SkipForward className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDemoReplay}
            title="重新播放"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#F8FAFC] text-[#334155] hover:bg-[#E2E8F0] cursor-pointer shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Sleek Single-Line Floating Pill Dock */}
      <div className="rounded-full bg-white/96 border border-[#CBD5E1] px-3 py-1.5 shadow-[0_10px_28px_rgba(15,23,42,0.16)] flex items-center gap-2 overflow-x-auto max-w-[95vw]">
        {/* Camera Views */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Camera className="h-3.5 w-3.5 text-[#64748B] mr-1" />
          {CAMERA_BUTTONS.map((cam) => {
            const active = cameraPreset === cam.id;
            return (
              <button
                key={cam.id}
                type="button"
                data-testid={`cam-preset-${cam.id}`}
                onClick={() => onSelectCameraPreset(cam.id)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#0F172A] text-white'
                    : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                }`}
              >
                {cam.label}
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-[#E2E8F0] shrink-0" />

        {/* Time-of-Day & 4-Season Presets */}
        <div className="flex items-center gap-0.5 shrink-0">
          {ATMO_BUTTONS.map((item) => {
            const Icon = item.icon;
            const active = atmospherePreset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`atmo-preset-${item.id}`}
                onClick={() => onSelectAtmosphere(item.id)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-[#E2E8F0] shrink-0" />

        {/* Quick Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="dock-new-prd"
            onClick={() => onOpenStation('ST-01')}
            className="inline-flex items-center gap-1 rounded-full bg-[#059669] px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-[#047857] transition-colors cursor-pointer whitespace-nowrap"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span>投放 PRD</span>
          </button>

          <button
            type="button"
            data-testid="dock-stations-toggle"
            onClick={() => setStationsPopoverOpen((o) => !o)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              stationsPopoverOpen
                ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
            }`}
          >
            <Grid2x2 className="h-3.5 w-3.5" />
            <span>各部门</span>
          </button>

          <button
            type="button"
            data-testid="btn-bg-tasks"
            onClick={onOpenTasks}
            title="后台运行任务"
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold cursor-pointer whitespace-nowrap ${
              runningTasksCount > 0
                ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="font-mono tabular-nums">{runningTasksCount}</span>
          </button>

          <button
            type="button"
            data-testid="dock-collapse-btn"
            onClick={() => {
              setStationsPopoverOpen(false);
              setCollapsed(true);
            }}
            title="收起控制栏 (快捷键 H)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] hover:text-[#0F172A] cursor-pointer"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
