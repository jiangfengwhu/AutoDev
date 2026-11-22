import type { MouseEvent } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Flame,
  Lock,
  Maximize2,
  Stamp,
  Terminal,
} from 'lucide-react';
import {
  FACTORY_STATIONS,
  type FactoryPipelineSnapshot,
  type FactoryStationId,
  type StationLedState,
} from '../../lib/factoryPipelineState';
import {
  HorizontalConveyor,
  SerpentineTransferDeck,
  WorkpiecePod,
} from './ConveyorConnectors';
import { SparkCanvas } from './SparkCanvas';

interface StationPodsRowProps {
  snapshot: FactoryPipelineSnapshot;
  selectedStationId: FactoryStationId | null;
  onSelectStation: (stationId: FactoryStationId) => void;
  onZoomPreview: () => void;
  onQuickApproveStamp: () => void;
  onOpenLatestReport: () => void;
}

function getStationCardModifier(led: StationLedState, selected: boolean): string {
  const base = 'cleanroom-station-card';
  const stateMod =
    led === 'running'
      ? 'cleanroom-station-running'
      : led === 'waiting'
        ? 'cleanroom-station-waiting'
        : led === 'passed'
          ? 'cleanroom-station-passed'
          : led === 'rework'
            ? 'cleanroom-station-rework'
            : '';
  const selectedMod = selected ? 'ring-2 ring-[#2563EB]/45' : '';
  return `${base} ${stateMod} ${selectedMod}`.trim();
}

function getLedIndicator(led: StationLedState): { dot: string; text: string } {
  switch (led) {
    case 'running':
      return {
        dot: 'bg-[#2563EB] shadow-[0_0_8px_rgba(37,99,235,0.75)] animate-pulse',
        text: 'text-[#1D4ED8]',
      };
    case 'waiting':
      return {
        dot: 'bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.75)] animate-pulse',
        text: 'text-[#B45309]',
      };
    case 'passed':
      return {
        dot: 'bg-[#059669] shadow-[0_0_7px_rgba(5,150,105,0.6)]',
        text: 'text-[#047857]',
      };
    case 'rework':
      return {
        dot: 'bg-[#DC2626] shadow-[0_0_8px_rgba(220,38,38,0.75)] animate-pulse',
        text: 'text-[#B91C1C]',
      };
    default:
      return {
        dot: 'bg-[#94A3B8]',
        text: 'text-[#64748B]',
      };
  }
}

function StationNameplate({
  stationId,
  led,
  statusText,
}: {
  stationId: FactoryStationId;
  led: StationLedState;
  statusText: string;
}) {
  const meta = FACTORY_STATIONS[stationId];
  const indicator = getLedIndicator(led);

  return (
    <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-[#E2E8F0] bg-[#F8FAFC]/90">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10.5px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#0F172A] text-white shrink-0">
          {meta.stationId}
        </span>
        <span className="text-[13px] font-bold text-[#0F172A] truncate">
          {meta.title}
        </span>
        <span className="text-[11.5px] text-[#64748B] whitespace-nowrap shrink-0">
          · {meta.departmentCode}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`h-2 w-2 rounded-full ${indicator.dot}`} />
        <span className={`font-mono text-[10.5px] font-semibold whitespace-nowrap ${indicator.text}`}>
          {statusText}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8]" />
      </div>
    </div>
  );
}

/**
 * Core Serpentine Dual-Row Production Pipeline:
 * Upper Trunk Row (L -> R): ST-01 周明 ══► ST-02 陈汐 ══► ST-03 顾航
 * Middle Transfer Deck:     REWORK LOOP (ST-03 -> ST-02) & DELIVERY LINE (ST-03 -> ST-04)
 * Lower Delivery Row (L -> R): ST-04 沈岚 ══► ST-05 陆瑶
 */
export function StationPodsRow({
  snapshot,
  selectedStationId,
  onSelectStation,
  onZoomPreview,
  onQuickApproveStamp,
  onOpenLatestReport,
}: StationPodsRowProps) {
  const stopAnd = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="space-y-0">
      {/* ===================================================================
          UPPER TRUNK LINE: ST-01 (周明) ══► ST-02 (陈汐) ══► ST-03 (顾航)
         =================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_52px_1fr_52px_1fr] items-stretch gap-3 xl:gap-0">
        {/* ---------------- ST-01 架构策划室 · 周明 ---------------- */}
        <article
          data-testid="station-ST-01"
          role="button"
          tabIndex={0}
          onClick={() => onSelectStation('ST-01')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-01');
            }
          }}
          className={`${getStationCardModifier(
            snapshot.stationStates['ST-01'].led,
            selectedStationId === 'ST-01'
          )} flex flex-col overflow-hidden cursor-pointer`}
        >
          <StationNameplate
            stationId="ST-01"
            led={snapshot.stationStates['ST-01'].led}
            statusText={snapshot.stationStates['ST-01'].statusText}
          />

          <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
            {snapshot.workpiece?.location === 'ST-01' && (
              <div>
                <WorkpiecePod workpiece={snapshot.workpiece} compact />
              </div>
            )}

            {/* Micro-scene: Left Mini Dual-Monitor SVG DAG + Right Aluminum Sticky Whiteboard */}
            <div className="grid grid-cols-1 sm:grid-cols-[1.02fr_1fr] gap-2.5 flex-1">
              {/* Mini Dual-Monitor DAG Architecture Screen */}
              <div className="rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-2 flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-1 mb-1.5">
                  <span className="font-mono text-[9.5px] font-semibold text-[#475569]">
                    DAG SPEC MONITOR
                  </span>
                  <span className="font-mono text-[9.5px] text-[#2563EB] tabular-nums">
                    {snapshot.st01.taskCount || 4} 节点
                  </span>
                </div>

                {/* Hairline SVG DAG diagram */}
                <svg
                  viewBox="0 0 204 94"
                  className="w-full h-[94px]"
                  aria-label="需求架构 DAG 节点图"
                >
                  {/* Clean orthogonal PCB edges */}
                  <path
                    d="M 94 24 L 110 24 M 48 38 L 48 54 M 94 68 L 110 68 M 156 38 L 156 54"
                    fill="none"
                    stroke={
                      snapshot.stationStates['ST-01'].led === 'running'
                        ? '#2563EB'
                        : snapshot.stationStates['ST-01'].led === 'passed'
                          ? '#059669'
                          : '#94A3B8'
                    }
                    strokeWidth="1.4"
                    className={
                      snapshot.stationStates['ST-01'].led === 'running'
                        ? 'conveyor-flow-forward'
                        : undefined
                    }
                  />
                  {/* 4 DAG Nodes */}
                  {[
                    { x: 2, y: 10, node: snapshot.st01.dagNodes[0] },
                    { x: 110, y: 10, node: snapshot.st01.dagNodes[1] },
                    { x: 2, y: 54, node: snapshot.st01.dagNodes[2] },
                    { x: 110, y: 54, node: snapshot.st01.dagNodes[3] },
                  ].map(({ x, y, node }, idx) => {
                    const active = node?.active;
                    const done = node?.done;
                    const border = active
                      ? '#2563EB'
                      : done
                        ? '#059669'
                        : '#CBD5E1';
                    const fill = active
                      ? '#EFF6FF'
                      : done
                        ? '#ECFDF5'
                        : '#FFFFFF';
                    return (
                      <g key={node?.id || idx} transform={`translate(${x}, ${y})`}>
                        <rect
                          width="92"
                          height="28"
                          rx="5"
                          fill={fill}
                          stroke={border}
                          strokeWidth="1.2"
                        />
                        <circle
                          cx="9"
                          cy="14"
                          r="2.6"
                          fill={active ? '#2563EB' : done ? '#059669' : '#94A3B8'}
                        />
                        <text
                          x="16"
                          y="17"
                          fontSize="8.5"
                          fontFamily="JetBrains Mono, sans-serif"
                          fill="#1E293B"
                          fontWeight="600"
                        >
                          {(node?.label || `NODE-0${idx + 1}`).slice(0, 8)}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                <div className="flex items-center justify-between pt-1 border-t border-[#E2E8F0] font-mono text-[9.5px] text-[#64748B]">
                  <span>docs/spec.json</span>
                  <span className="tabular-nums">P0 歧义 {snapshot.st01.p0Count}</span>
                </div>
              </div>

              {/* Aluminum-Framed Pastel Macaron Sticky Whiteboard */}
              <div className="rounded-lg border-2 border-[#CBD5E1] bg-white p-2 shadow-inner flex flex-col justify-between">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[9.5px] font-semibold text-[#64748B]">
                    SPEC WHITEBOARD
                  </span>
                  <span className="h-1.5 w-6 rounded-full bg-[#E2E8F0]" />
                </div>

                <div className="grid grid-cols-2 gap-1.5 flex-1">
                  {snapshot.st01.stickyNotes.slice(0, 4).map((note) => {
                    const palette =
                      note.color === 'yellow'
                        ? 'bg-[#FEF9C3] border-[#FDE047]/70 text-[#713F12]'
                        : note.color === 'green'
                          ? 'bg-[#DCFCE7] border-[#86EFAC]/70 text-[#14532D]'
                          : 'bg-[#DBEAFE] border-[#93C5FD]/70 text-[#1E3A8A]';
                    return (
                      <div
                        key={note.id}
                        style={{ transform: `rotate(${note.tiltDeg}deg)` }}
                        className={`rounded border p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] flex flex-col justify-between ${palette}`}
                      >
                        <span className="font-mono text-[8.5px] font-bold uppercase opacity-80">
                          {note.tag}
                        </span>
                        <p className="text-[10px] font-medium leading-tight line-clamp-2 mt-0.5">
                          {note.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* Conveyor ST-01 ══► ST-02 */}
        <HorizontalConveyor state={snapshot.tracks.st01ToSt02} label="SPEC" />

        {/* ---------------- ST-02 代码车间 · 陈汐 ---------------- */}
        <article
          data-testid="station-ST-02"
          role="button"
          tabIndex={0}
          onClick={() => onSelectStation('ST-02')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-02');
            }
          }}
          className={`${getStationCardModifier(
            snapshot.stationStates['ST-02'].led,
            selectedStationId === 'ST-02'
          )} relative flex flex-col overflow-hidden cursor-pointer`}
        >
          <StationNameplate
            stationId="ST-02"
            led={snapshot.stationStates['ST-02'].led}
            statusText={snapshot.stationStates['ST-02'].statusText}
          />

          <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5 relative">
            <div className="flex items-center justify-between gap-2">
              {snapshot.workpiece?.location === 'ST-02' ? (
                <WorkpiecePod workpiece={snapshot.workpiece} compact />
              ) : (
                <span className="font-mono text-[10.5px] text-[#64748B] truncate">
                  {snapshot.st02.branchName}
                </span>
              )}
              {snapshot.st02.isSparking && (
                <span
                  data-testid="st02-spark-badge"
                  className="inline-flex items-center gap-1 rounded bg-[#FEF3C7] border border-[#FCD34D] px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-[#B45309] shrink-0"
                >
                  <Flame className="h-3 w-3 text-[#D97706]" />
                  <span>加工中 R{Math.max(1, snapshot.st02.repairRound)}</span>
                </span>
              )}
            </div>

            {/* Dual Compact Dark-Graphite Terminals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
              {/* Left Screen: Business Code Diff */}
              <div className="rounded-lg border border-[#1E293B] bg-[#0F172A] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-2 py-1 border-b border-[#1E293B] bg-[#1E293B]/70">
                  <span className="inline-flex items-center gap-1 font-mono text-[9px] text-[#94A3B8]">
                    <Terminal className="h-2.5 w-2.5 text-[#38BDF8]" />
                    DIFF STREAM
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#38BDF8]" />
                  </span>
                </div>
                <div className="relative h-[108px] overflow-hidden px-2 py-1.5 font-mono text-[9.5px] leading-[1.45]">
                  <div
                    className={
                      snapshot.st02.isSparking
                        ? 'terminal-scroll-track-fast space-y-0.5'
                        : 'space-y-0.5'
                    }
                  >
                    {[...snapshot.st02.diffLines, ...snapshot.st02.diffLines].map(
                      (line, idx) => (
                        <div
                          key={idx}
                          className={`truncate rounded px-1 ${
                            line.type === 'add'
                              ? 'bg-[#059669]/20 text-[#6EE7B7]'
                              : line.type === 'del'
                                ? 'bg-[#DC2626]/20 text-[#FCA5A5]'
                                : 'text-[#94A3B8]'
                          }`}
                        >
                          {line.text}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Right Screen: Build & Smoke Test Logs */}
              <div className="rounded-lg border border-[#1E293B] bg-[#0F172A] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-2 py-1 border-b border-[#1E293B] bg-[#1E293B]/70">
                  <span className="font-mono text-[9px] text-[#94A3B8]">
                    BUILD &amp; SMOKE
                  </span>
                  <span className="font-mono text-[8.5px] text-[#38BDF8] truncate max-w-[78px]">
                    {snapshot.st02.modelName}
                  </span>
                </div>
                <div className="relative h-[108px] overflow-hidden px-2 py-1.5 font-mono text-[9.5px] leading-[1.45]">
                  <div
                    className={
                      snapshot.st02.isSparking
                        ? 'terminal-scroll-track space-y-1'
                        : 'space-y-1'
                    }
                  >
                    {[...snapshot.st02.smokeLogs, ...snapshot.st02.smokeLogs].map(
                      (log, idx) => (
                        <div
                          key={idx}
                          className={`truncate ${
                            log.includes('OK') || log.includes('passed') || log.includes('verified')
                              ? 'text-[#34D399]'
                              : log.includes('agy')
                                ? 'text-[#38BDF8]'
                                : 'text-[#CBD5E1]'
                          }`}
                        >
                          {log}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Restrained 60fps micro-spark particle overlay (active ONLY during coding/repair) */}
            <SparkCanvas
              active={snapshot.st02.isSparking}
              intensity={snapshot.stationStates['ST-02'].led === 'rework' ? 'rework' : 'normal'}
            />
          </div>
        </article>

        {/* Conveyor ST-02 ══► ST-03 */}
        <HorizontalConveyor state={snapshot.tracks.st02ToSt03} label="BUILD" />

        {/* ---------------- ST-03 质检与进化实验室 · 顾航 ---------------- */}
        <article
          data-testid="station-ST-03"
          role="button"
          tabIndex={0}
          onClick={() => onSelectStation('ST-03')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-03');
            }
          }}
          className={`${getStationCardModifier(
            snapshot.stationStates['ST-03'].led,
            selectedStationId === 'ST-03'
          )} flex flex-col overflow-hidden cursor-pointer`}
        >
          <StationNameplate
            stationId="ST-03"
            led={snapshot.stationStates['ST-03'].led}
            statusText={snapshot.stationStates['ST-03'].statusText}
          />

          <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
            {snapshot.workpiece?.location === 'ST-03' && (
              <div>
                <WorkpiecePod workpiece={snapshot.workpiece} compact />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.05fr] gap-2.5 flex-1">
              {/* Left: Precision Blind-Test Case Matrix + tests/ Vault Lock */}
              <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFD] p-2 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-[#334155]">
                    <Lock className="h-2.5 w-2.5 text-[#059669]" />
                    {snapshot.st03.testsLockLabel}
                  </span>
                  <span className="font-mono text-[10px] font-bold text-[#0F172A] tabular-nums">
                    {snapshot.st03.passRateText}
                  </span>
                </div>

                {/* 2x4 Test Matrix Grid */}
                <div className="grid grid-cols-2 gap-1">
                  {snapshot.st03.cells.map((cell) => {
                    const cls =
                      cell.status === 'pass'
                        ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                        : cell.status === 'fail'
                          ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                          : cell.status === 'running'
                            ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8] animate-pulse'
                            : 'bg-white border-[#E2E8F0] text-[#94A3B8]';
                    const dot =
                      cell.status === 'pass'
                        ? 'bg-[#059669]'
                        : cell.status === 'fail'
                          ? 'bg-[#DC2626]'
                          : cell.status === 'running'
                            ? 'bg-[#2563EB]'
                            : 'bg-[#CBD5E1]';
                    return (
                      <div
                        key={cell.id}
                        className={`flex items-center justify-between rounded border px-1.5 py-1 font-mono text-[9px] font-semibold ${cls}`}
                      >
                        <span>{cell.label}</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Self-Evolution RSI Rule Analysis Terminal */}
              <div className="rounded-lg border border-[#CBD5E1] bg-[#F1F5F9]/80 p-2 flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-[#CBD5E1]/70 pb-1 mb-1.5">
                  <span className="font-mono text-[9px] font-bold text-[#334155]">
                    RSI 规则进化终端
                  </span>
                  <span className="font-mono text-[8.5px] text-[#2563EB] font-semibold">
                    AUTO-LEARN
                  </span>
                </div>

                <div className="space-y-1.5 flex-1">
                  {snapshot.st03.rsiRules.slice(0, 3).map((rule) => (
                    <div
                      key={rule.code}
                      className={`rounded border px-2 py-1.5 ${
                        rule.isNew
                          ? 'border-[#2563EB]/45 bg-[#EFF6FF]'
                          : 'border-[#E2E8F0] bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[9px] font-bold text-[#1D4ED8]">
                          {rule.code}
                        </span>
                        {rule.isNew && (
                          <span className="font-mono text-[8px] font-bold uppercase text-[#DC2626]">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[#334155] leading-snug line-clamp-2 mt-0.5">
                        {rule.title}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>

      {/* ===================================================================
          MID TRANSFER DECK: REWORK LOOP (ST-03 -> ST-02) + DELIVERY LINE
         =================================================================== */}
      <SerpentineTransferDeck
        reworkState={snapshot.tracks.reworkSt03ToSt02}
        deliveryState={snapshot.tracks.st03ToSt04}
        workpiece={snapshot.workpiece}
      />

      {/* ===================================================================
          LOWER DELIVERY LINE: ST-04 (沈岚) ══► ST-05 (陆瑶)
         =================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_52px_1fr] items-stretch gap-3 xl:gap-0">
        {/* ---------------- ST-04 验收会议室 · 沈岚 ---------------- */}
        <article
          data-testid="station-ST-04"
          role="button"
          tabIndex={0}
          onClick={() => onSelectStation('ST-04')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-04');
            }
          }}
          className={`${getStationCardModifier(
            snapshot.stationStates['ST-04'].led,
            selectedStationId === 'ST-04'
          )} flex flex-col overflow-hidden cursor-pointer`}
        >
          <StationNameplate
            stationId="ST-04"
            led={snapshot.stationStates['ST-04'].led}
            statusText={snapshot.stationStates['ST-04'].statusText}
          />

          <div className="p-3.5 flex-1 grid grid-cols-1 md:grid-cols-[1.15fr_1fr] gap-3">
            {/* Left: Live Cloudflare Preview Mini-Browser Display (Click to Zoom) */}
            <div className="rounded-lg border border-[#CBD5E1] bg-white overflow-hidden flex flex-col shadow-xs">
              {/* Browser Window Top Bar */}
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="flex items-center gap-1 shrink-0">
                  <span className="h-2 w-2 rounded-full bg-[#F87171]" />
                  <span className="h-2 w-2 rounded-full bg-[#FBBF24]" />
                  <span className="h-2 w-2 rounded-full bg-[#34D399]" />
                </div>
                <div className="flex-1 truncate rounded bg-white border border-[#E2E8F0] px-2 py-0.5 font-mono text-[9.5px] text-[#475569]">
                  {snapshot.st04.previewUrl || 'https://preview.atd-v1.pages.dev'}
                </div>
                <button
                  type="button"
                  data-testid="st04-zoom-preview"
                  onClick={stopAnd(onZoomPreview)}
                  className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:text-[#2563EB] px-1.5 py-0.5 text-[10px] font-medium text-[#475569] transition-colors shrink-0 cursor-pointer"
                  title="放大实时预览"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>放大</span>
                </button>
              </div>

              {/* Clean miniature UI preview canvas */}
              <div
                onClick={stopAnd(onZoomPreview)}
                className="relative flex-1 min-h-[118px] bg-gradient-to-br from-[#F8FAFC] via-white to-[#EFF6FF]/60 p-3 flex flex-col justify-between group"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-[#2563EB]">
                      CLOUDFLARE PREVIEW
                    </span>
                    {snapshot.st04.prNumber && (
                      <span className="font-mono text-[9.5px] text-[#64748B]">
                        PR #{snapshot.st04.prNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] font-bold text-[#0F172A] truncate">
                    {snapshot.st04.previewTitle}
                  </div>
                  {/* Miniature clean wireframe UI blocks representing rendered preview */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <div className="rounded border border-[#E2E8F0] bg-white p-1.5 space-y-1">
                      <div className="h-1.5 w-8 rounded bg-[#CBD5E1]" />
                      <div className="h-3 w-12 rounded bg-[#EFF6FF] border border-[#BFDBFE]" />
                    </div>
                    <div className="rounded border border-[#E2E8F0] bg-white p-1.5 space-y-1">
                      <div className="h-1.5 w-9 rounded bg-[#CBD5E1]" />
                      <div className="h-3 w-10 rounded bg-[#ECFDF5] border border-[#A7F3D0]" />
                    </div>
                    <div className="rounded border border-[#E2E8F0] bg-white p-1.5 space-y-1">
                      <div className="h-1.5 w-7 rounded bg-[#CBD5E1]" />
                      <div className="h-3 w-11 rounded bg-[#F8FAFC] border border-[#E2E8F0]" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 text-[10px] font-mono text-[#64748B]">
                  <span className="truncate">{snapshot.st04.previewSubtitle}</span>
                  <span className="inline-flex items-center gap-0.5 text-[#2563EB] group-hover:underline shrink-0">
                    查看实景
                    <ExternalLink className="h-2.5 w-2.5" />
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Tactile Physical Approval Stamp Deck */}
            <div
              className={`relative rounded-lg border p-3 flex flex-col justify-between transition-colors ${
                snapshot.st04.isAwaitingApproval
                  ? 'border-[#F59E0B]/60 bg-[#FFFBEB]/70'
                  : snapshot.st04.isApprovedStamped
                    ? 'border-[#059669]/45 bg-[#ECFDF5]/60'
                    : 'border-[#E2E8F0] bg-[#F8FAFC]'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                    APPROVAL DECK · 签批门禁台
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-[#64748B] tabular-nums">
                    验收 {snapshot.st04.criteriaChecked}/{snapshot.st04.criteriaTotal || 4}
                  </span>
                </div>

                {snapshot.workpiece?.location === 'ST-04' && (
                  <div className="pt-1">
                    <WorkpiecePod workpiece={snapshot.workpiece} compact />
                  </div>
                )}
              </div>

              {/* Crisp Emerald Mechanical Ink Stamp Overlay when Approved */}
              <div className="my-2 flex items-center justify-center min-h-[48px]">
                {snapshot.st04.isApprovedStamped ? (
                  <div
                    data-testid="st04-approved-stamp"
                    className="approval-stamp-slam inline-flex flex-col items-center rounded-md border-2 border-[#059669] bg-white/90 px-3.5 py-1.5 text-[#059669] shadow-sm"
                  >
                    <span className="font-mono text-[12px] font-extrabold tracking-[0.16em] leading-none">
                      APPROVED
                    </span>
                    <span className="text-[10px] font-bold tracking-widest mt-0.5">
                      准予上线 · 沈岚签批
                    </span>
                  </div>
                ) : (
                  <div className="text-center text-[11px] text-[#64748B]">
                    {snapshot.st04.isAwaitingApproval
                      ? 'Preview 实景校验就绪，等待点击签批放行'
                      : '待质检通过后解锁签批放行'}
                  </div>
                )}
              </div>

              <button
                type="button"
                data-testid="st04-approve-btn"
                onClick={stopAnd(onQuickApproveStamp)}
                className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  snapshot.st04.isAwaitingApproval
                    ? 'bg-[#D97706] hover:bg-[#B45309] text-white shadow-sm'
                    : snapshot.st04.isApprovedStamped
                      ? 'bg-[#059669] hover:bg-[#047857] text-white'
                      : 'border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-[#334155]'
                }`}
              >
                <Stamp className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {snapshot.st04.isApprovedStamped
                    ? '已盖章签批 · 查看详情'
                    : snapshot.mode === 'demo'
                      ? '一键签批盖章（演练）'
                      : '进入签批与合并上线'}
                </span>
              </button>
            </div>
          </div>
        </article>

        {/* Conveyor ST-04 ══► ST-05 */}
        <HorizontalConveyor state={snapshot.tracks.st04ToSt05} label="RELEASE" />

        {/* ---------------- ST-05 项目档案室 · 陆瑶 ---------------- */}
        <article
          data-testid="station-ST-05"
          role="button"
          tabIndex={0}
          onClick={() => onSelectStation('ST-05')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectStation('ST-05');
            }
          }}
          className={`${getStationCardModifier(
            snapshot.stationStates['ST-05'].led,
            selectedStationId === 'ST-05'
          )} flex flex-col overflow-hidden cursor-pointer`}
        >
          <StationNameplate
            stationId="ST-05"
            led={snapshot.stationStates['ST-05'].led}
            statusText={snapshot.stationStates['ST-05'].statusText}
          />

          <div className="p-3.5 flex-1 grid grid-cols-1 md:grid-cols-[0.95fr_1.15fr] gap-3">
            {/* Left: 3-Tier Clean White Steel Archive Cabinet */}
            <div className="rounded-lg border border-[#CBD5E1] bg-gradient-to-b from-[#F8FAFC] to-[#EEF2F6] p-2.5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-[#475569]">
                  STEEL ARCHIVE · 档案钢柜
                </span>
                <span className="font-mono text-[10px] font-bold text-[#059669] tabular-nums">
                  {snapshot.st05.deliveredCount} 卷
                </span>
              </div>

              <div className="space-y-1.5">
                {[
                  { idx: 0, slot: 'ARC-2026-Q4', label: '最新交付归档' },
                  { idx: 1, slot: 'ARC-SPEC-DB', label: '规格与 Diff 库' },
                  { idx: 2, slot: 'ARC-QA-LOG', label: '盲测审计留痕' },
                ].map((drawer) => {
                  const isOpen = snapshot.st05.activeDrawerIndex === drawer.idx;
                  return (
                    <div
                      key={drawer.slot}
                      data-testid={`st05-drawer-${drawer.idx}`}
                      data-open={isOpen ? 'true' : 'false'}
                      className={`rounded-md border px-2.5 py-2 transition-all duration-300 ${
                        isOpen
                          ? 'translate-x-1.5 border-[#059669]/55 bg-white shadow-[0_4px_12px_-4px_rgba(5,150,105,0.28)]'
                          : 'border-[#CBD5E1] bg-white/95 shadow-[inset_0_1px_0_#FFFFFF]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              isOpen ? 'bg-[#059669] shadow-[0_0_6px_#059669]' : 'bg-[#CBD5E1]'
                            }`}
                          />
                          <span className="font-mono text-[9px] font-bold text-[#334155]">
                            {drawer.slot}
                          </span>
                        </div>
                        {/* Silver metallic drawer pull bar */}
                        <span className="h-1.5 w-8 rounded-full bg-gradient-to-b from-[#CBD5E1] to-[#94A3B8]" />
                      </div>
                      <div className="mt-1 text-[10px] text-[#64748B] truncate">
                        {drawer.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Delivery Report Summary Desk Card */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFD] p-3 flex flex-col justify-between gap-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                    <FileText className="h-3 w-3 text-[#2563EB]" />
                    <span>交付复盘报告台</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-[#059669]">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>{snapshot.st05.latestPassRateText}</span>
                  </span>
                </div>

                {snapshot.workpiece?.location === 'ST-05' && (
                  <WorkpiecePod workpiece={snapshot.workpiece} compact />
                )}

                <div className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-2 space-y-1">
                  <div className="text-[12px] font-bold text-[#0F172A] truncate">
                    {snapshot.st05.latestTitle}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-[#F1F5F9] font-mono text-[10px] tabular-nums">
                    <div>
                      <div className="text-[#94A3B8] text-[9px]">耗时</div>
                      <div className="font-semibold text-[#0F172A]">
                        {snapshot.st05.latestDurationText}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#94A3B8] text-[9px]">返工修复</div>
                      <div className="font-semibold text-[#0F172A]">
                        {snapshot.st05.latestRepairRounds} 轮
                      </div>
                    </div>
                    <div>
                      <div className="text-[#94A3B8] text-[9px]">已交付</div>
                      <div className="font-semibold text-[#059669]">
                        {snapshot.st05.deliveredCount} 项
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                data-testid="st05-open-report-btn"
                onClick={stopAnd(onOpenLatestReport)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white hover:border-[#2563EB]/60 hover:bg-[#EFF6FF] hover:text-[#1D4ED8] px-3 py-2 text-[12px] font-semibold text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span>查阅完整交付报告</span>
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
