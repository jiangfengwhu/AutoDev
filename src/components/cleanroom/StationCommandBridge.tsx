import type { CSSProperties } from 'react';
import {
  Activity,
  ChevronRight,
  Cpu,
  Plus,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import {
  FACTORY_STATIONS,
  type FactoryPipelineSnapshot,
  type FactoryStationId,
  type RackLedItem,
  type StationLedState,
} from '../../lib/factoryPipelineState';
import { formatTokenCount } from '../../lib/overviewMetrics';
import { WorkpiecePod } from './ConveyorConnectors';

interface StationCommandBridgeProps {
  snapshot: FactoryPipelineSnapshot;
  isSelected: boolean;
  onSelectStation: (stationId: FactoryStationId) => void;
  onOpenNewPrd: () => void;
  onOpenEnvironment: () => void;
}

function getLedBadgeStyles(led: StationLedState): {
  dot: string;
  pill: string;
} {
  switch (led) {
    case 'running':
      return {
        dot: 'bg-[#2563EB] shadow-[0_0_8px_rgba(37,99,235,0.7)]',
        pill: 'text-[#1D4ED8] bg-[#EFF6FF] border-[#BFDBFE]',
      };
    case 'waiting':
      return {
        dot: 'bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.65)]',
        pill: 'text-[#B45309] bg-[#FFFBEB] border-[#FDE68A]',
      };
    case 'passed':
      return {
        dot: 'bg-[#059669] shadow-[0_0_8px_rgba(5,150,105,0.55)]',
        pill: 'text-[#047857] bg-[#ECFDF5] border-[#A7F3D0]',
      };
    case 'rework':
      return {
        dot: 'bg-[#DC2626] shadow-[0_0_8px_rgba(220,38,38,0.65)]',
        pill: 'text-[#B91C1C] bg-[#FEF2F2] border-[#FECACA]',
      };
    default:
      return {
        dot: 'bg-[#94A3B8]',
        pill: 'text-[#475569] bg-[#F8FAFC] border-[#E2E8F0]',
      };
  }
}

function getRackLedDotClass(tone: RackLedItem['tone']): string {
  switch (tone) {
    case 'emerald':
      return 'bg-[#10B981] shadow-[0_0_6px_rgba(16,185,129,0.75)]';
    case 'blue':
      return 'bg-[#3B82F6] shadow-[0_0_6px_rgba(59,130,246,0.75)]';
    case 'amber':
      return 'bg-[#F59E0B] shadow-[0_0_6px_rgba(245,158,11,0.75)]';
    default:
      return 'bg-[#94A3B8]/60';
  }
}

/**
 * ST-00 指挥大厅（林工）— Top Suspended Command Bridge
 * Left: Compact PRD Intake + Engine Settings controls & active phase readout.
 * Center: High-precision bright wall telemetry dashboard (7-day Success Rate + 7-day Token trend).
 * Right: Brushed silver 16-LED server rack heartbeat matrix.
 */
export function StationCommandBridge({
  snapshot,
  isSelected,
  onSelectStation,
  onOpenNewPrd,
  onOpenEnvironment,
}: StationCommandBridgeProps) {
  const meta = FACTORY_STATIONS['ST-00'];
  const state = snapshot.stationStates['ST-00'];
  const ledStyle = getLedBadgeStyles(state.led);

  const series = snapshot.st00.dailySeries;
  const maxTokensK = Math.max(10, ...series.map((d) => d.tokensK));

  // Build full-width crisp SVG line & area path for 7-day Success Rate (0–100%)
  const chartW = 360;
  const chartH = 54;
  const padX = 12;
  const padY = 6;
  const stepX = series.length > 1 ? (chartW - padX * 2) / (series.length - 1) : 0;

  const ratePoints = series.map((d, i) => {
    const x = padX + i * stepX;
    const clamped = Math.max(0, Math.min(100, d.successRate));
    const y = chartH - padY - (clamped / 100) * (chartH - padY * 2);
    return { x, y, label: d.label, val: clamped };
  });

  const rateLinePath = ratePoints
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const rateAreaPath =
    ratePoints.length > 1
      ? `${rateLinePath} L ${ratePoints[ratePoints.length - 1].x.toFixed(1)} ${(chartH - padY).toFixed(1)} L ${ratePoints[0].x.toFixed(1)} ${(chartH - padY).toFixed(1)} Z`
      : '';

  return (
    <section
      data-testid="station-ST-00"
      className={`cleanroom-station-card overflow-hidden ${
        isSelected ? 'ring-2 ring-[#2563EB]/40 border-[#2563EB]/60' : ''
      }`}
    >
      {/* Top Minimal Industrial Nameplate Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[#E2E8F0] bg-[#F8FAFC]/90">
        <button
          type="button"
          onClick={() => onSelectStation('ST-00')}
          className="flex items-center gap-2.5 text-left group cursor-pointer"
        >
          <span className="font-mono text-[11px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#0F172A] text-white">
            {meta.stationId}
          </span>
          <span className="text-[13px] font-bold text-[#0F172A] group-hover:text-[#2563EB] transition-colors">
            {meta.title}
          </span>
          <span className="text-[12px] text-[#64748B]">
            · {meta.departmentCode}（{meta.departmentMission}）
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8] group-hover:text-[#2563EB] group-hover:translate-x-0.5 transition-all" />
        </button>

        <div className="flex items-center gap-2.5">
          {snapshot.workpiece && (
            <div className="hidden md:block">
              <WorkpiecePod workpiece={snapshot.workpiece} compact />
            </div>
          )}
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium ${ledStyle.pill}`}
          >
            <span className={`h-2 w-2 rounded-full ${ledStyle.dot}`} />
            <span>{state.statusText}</span>
          </div>
        </div>
      </div>

      {/* Main 3-Zone Command Bridge Interior */}
      <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr_284px] divide-y lg:divide-y-0 lg:divide-x divide-[#E2E8F0]">
        {/* Zone 1 (Left): PRD Intake Port & Engine Configuration Triggers */}
        <div className="p-3.5 flex flex-col justify-between gap-3 bg-white">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#64748B] whitespace-nowrap">
                INTAKE · 需求投放口
              </span>
              <span className="font-mono text-[10px] text-[#2563EB] font-semibold shrink-0">
                {snapshot.mode === 'demo' ? 'SIM-LOOP' : 'LIVE'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="btn-intake-prd"
                onClick={onOpenNewPrd}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-3 py-2 text-[12px] font-semibold shadow-sm transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>投放 PRD</span>
              </button>
              <button
                type="button"
                data-testid="btn-engine-settings"
                onClick={onOpenEnvironment}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-[#334155] px-2.5 py-2 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#475569]" />
                <span>环境与引擎</span>
              </button>
            </div>
          </div>

          {/* Live pipeline phase descriptor */}
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-2 space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-bold text-[#0F172A] truncate">
                {snapshot.phaseLabel}
              </span>
              <span className="font-mono text-[10px] text-[#64748B] tabular-nums shrink-0">
                归档 {snapshot.st00.deliveredCount}
              </span>
            </div>
            <p className="text-[11px] text-[#475569] leading-snug line-clamp-2">
              {snapshot.phaseDescription}
            </p>
          </div>
        </div>

        {/* Zone 2 (Center): Cleanroom Wall Real-Time Telemetry Dashboard */}
        <div
          onClick={() => onSelectStation('ST-00')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-00');
            }
          }}
          className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white hover:bg-[#F8FAFC]/60 transition-colors cursor-pointer"
        >
          {/* Metric Chart A: 7-Day Task Success Rate */}
          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFD] px-3 py-2.5 flex flex-col justify-between">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#475569]">
                <Activity className="h-3.5 w-3.5 text-[#059669]" />
                <span>近 7 日任务成功率</span>
              </div>
              <span
                data-testid="st00-success-rate"
                className="font-mono text-[18px] font-bold text-[#0F172A] tabular-nums leading-none"
              >
                {snapshot.st00.successRatePct !== null
                  ? `${Math.round(snapshot.st00.successRatePct)}%`
                  : '--'}
              </span>
            </div>

            <div className="mt-1.5">
              <div className="relative h-[54px] w-full">
                <svg
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  preserveAspectRatio="none"
                  className="w-full h-full overflow-visible"
                  aria-label="近 7 日任务成功率趋势"
                >
                  <defs>
                    <linearGradient id="cleanroomRateFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#059669" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="10" x2={chartW} y2="10" stroke="#E2E8F0" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1="30" x2={chartW} y2="30" stroke="#E2E8F0" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1="48" x2={chartW} y2="48" stroke="#E2E8F0" vectorEffect="non-scaling-stroke" />
                  {rateAreaPath && <path d={rateAreaPath} fill="url(#cleanroomRateFill)" />}
                  {rateLinePath && (
                    <path
                      d={rateLinePath}
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {/* Unstretched HTML data-point dots aligned cleanly over SVG */}
                {ratePoints.map((pt, idx) => (
                  <span
                    key={idx}
                    style={{
                      left: `${(pt.x / chartW) * 100}%`,
                      top: `${(pt.y / chartH) * 100}%`,
                    }}
                    className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-2 border-[#059669] ${
                      idx === ratePoints.length - 1 ? 'h-2 w-2' : 'h-1.5 w-1.5'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between font-mono text-[9px] text-[#94A3B8] tabular-nums mt-0.5">
                {series.map((d, idx) => (
                  <span key={idx}>{d.label}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Metric Chart B: 7-Day Token Consumption */}
          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFD] px-3 py-2.5 flex flex-col justify-between">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#475569]">
                <Cpu className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>近 7 日 Token 消耗</span>
              </div>
              <span
                data-testid="st00-total-tokens"
                className="font-mono text-[18px] font-bold text-[#0F172A] tabular-nums leading-none"
              >
                {formatTokenCount(snapshot.st00.totalTokens)}
              </span>
            </div>

            <div className="mt-1.5">
              <div className="h-[54px] flex items-end justify-between gap-1.5 pt-2 pb-0.5 border-b border-[#E2E8F0]">
                {series.map((d, idx) => {
                  const pct = Math.max(8, Math.round((d.tokensK / maxTokensK) * 100));
                  const isToday = idx === series.length - 1;
                  return (
                    <div
                      key={idx}
                      className="flex-1 h-full flex flex-col justify-end items-center"
                      title={`${d.label}: ${d.tokensK}K Tokens`}
                    >
                      <div
                        className={`w-full max-w-[18px] rounded-t-[3px] transition-all duration-300 ${
                          isToday ? 'bg-[#2563EB]' : 'bg-[#93C5FD]'
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between font-mono text-[9px] text-[#94A3B8] tabular-nums mt-0.5">
                {series.map((d, idx) => (
                  <span key={idx}>{d.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Zone 3 (Right): Brushed Silver 16-LED Server Rack Heartbeat Matrix */}
        <div
          onClick={() => onSelectStation('ST-00')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-00');
            }
          }}
          className="p-3.5 bg-[#F8FAFC]/70 hover:bg-[#F1F5F9]/80 transition-colors cursor-pointer flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
              <Server className="h-3 w-3 text-[#64748B]" />
              <span>RACK TELEMETRY · 16-CH</span>
            </span>
            <span className="font-mono text-[10px] text-[#059669] font-semibold tabular-nums">
              ONLINE
            </span>
          </div>

          <div
            className="cleanroom-rack-panel rounded-lg p-1.5 grid grid-cols-4 gap-1"
            data-testid="st00-rack-leds"
          >
            {snapshot.st00.rackLeds.map((led) => {
              const style = {
                '--led-dur': `${led.durationSec.toFixed(2)}s`,
                '--led-delay': `${led.delaySec.toFixed(2)}s`,
              } as CSSProperties;

              return (
                <div
                  key={led.id}
                  className="flex items-center justify-center gap-1 rounded bg-white/85 border border-[#CBD5E1]/70 px-1 py-1"
                >
                  <span
                    style={style}
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${getRackLedDotClass(led.tone)} ${
                      led.tone !== 'slate' ? 'rack-led-blink' : ''
                    }`}
                  />
                  <span className="font-mono text-[9px] font-semibold text-[#334155] tracking-tight whitespace-nowrap">
                    {led.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
