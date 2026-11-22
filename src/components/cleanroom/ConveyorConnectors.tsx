import type {
  ConveyorSegmentState,
  FactoryWorkpiecePod,
  StationLedState,
} from '../../lib/factoryPipelineState';

function getTrackStroke(state: ConveyorSegmentState): string {
  switch (state) {
    case 'active':
      return '#2563EB';
    case 'passed':
      return '#059669';
    case 'rework':
      return '#DC2626';
    default:
      return '#CBD5E1';
  }
}

function getLedColor(tone: StationLedState): string {
  switch (tone) {
    case 'running':
      return 'bg-[#2563EB] shadow-[0_0_8px_rgba(37,99,235,0.65)]';
    case 'waiting':
      return 'bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.65)]';
    case 'passed':
      return 'bg-[#059669] shadow-[0_0_8px_rgba(5,150,105,0.55)]';
    case 'rework':
      return 'bg-[#DC2626] shadow-[0_0_8px_rgba(220,38,38,0.65)]';
    default:
      return 'bg-[#94A3B8]';
  }
}

export function WorkpiecePod({
  workpiece,
  compact = false,
}: {
  workpiece: FactoryWorkpiecePod;
  compact?: boolean;
}) {
  const toneBorder =
    workpiece.tone === 'running'
      ? 'border-[#2563EB]/50 bg-[#EFF6FF] text-[#1E3A8A]'
      : workpiece.tone === 'waiting'
        ? 'border-[#D97706]/50 bg-[#FFFBEB] text-[#92400E]'
        : workpiece.tone === 'passed'
          ? 'border-[#059669]/45 bg-[#ECFDF5] text-[#065F46]'
          : workpiece.tone === 'rework'
            ? 'border-[#DC2626]/55 bg-[#FEF2F2] text-[#991B1B]'
            : 'border-[#CBD5E1] bg-white text-[#334155]';

  return (
    <div
      data-testid="workpiece-pod"
      className={`inline-flex items-center gap-2 rounded-lg border shadow-sm transition-all duration-300 ${toneBorder} ${
        compact ? 'px-2.5 py-1' : 'px-3 py-1.5'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${getLedColor(workpiece.tone)} ${
          workpiece.tone === 'running' || workpiece.tone === 'rework' ? 'animate-pulse' : ''
        }`}
      />
      <span className="font-mono text-[11px] font-bold tracking-tight tabular-nums whitespace-nowrap">
        {workpiece.prNumberLabel}
      </span>
      <span className="text-[11px] font-medium truncate max-w-[140px]">
        {workpiece.title}
      </span>
      <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/80 border border-current/15 whitespace-nowrap">
        {workpiece.statusLabel}
      </span>
    </div>
  );
}

interface HorizontalConveyorProps {
  state: ConveyorSegmentState;
  label?: string;
}

/**
 * Dual-rail metallic horizontal SVG conveyor between adjacent stations on desktop,
 * collapsing into a compact vertical rail on narrower screens.
 */
export function HorizontalConveyor({ state, label }: HorizontalConveyorProps) {
  const stroke = getTrackStroke(state);
  const animated = state === 'active' || state === 'rework';

  return (
    <div
      className="flex flex-col items-center justify-center shrink-0 select-none"
      aria-hidden="true"
    >
      {/* Desktop horizontal dual-rail */}
      <div className="hidden xl:flex flex-col items-center justify-center w-[52px]">
        {label && (
          <span className="font-mono text-[9px] font-semibold tracking-wider text-[#94A3B8] mb-1 uppercase">
            {label}
          </span>
        )}
        <svg
          width="52"
          height="32"
          viewBox="0 0 52 32"
          fill="none"
          className="overflow-visible"
        >
          {/* Metallic outer double rails */}
          <line x1="0" y1="9" x2="52" y2="9" stroke="#CBD5E1" strokeWidth="1.5" />
          <line x1="0" y1="23" x2="52" y2="23" stroke="#CBD5E1" strokeWidth="1.5" />
          {/* Inner precision bed */}
          <rect x="0" y="10" width="52" height="12" fill="#F1F5F9" />
          {/* Subtle roller ticks */}
          <line x1="10" y1="10" x2="10" y2="22" stroke="#E2E8F0" strokeWidth="1" />
          <line x1="22" y1="10" x2="22" y2="22" stroke="#E2E8F0" strokeWidth="1" />
          <line x1="34" y1="10" x2="34" y2="22" stroke="#E2E8F0" strokeWidth="1" />
          <line x1="46" y1="10" x2="46" y2="22" stroke="#E2E8F0" strokeWidth="1" />
          {/* Center signal track */}
          <line
            x1="2"
            y1="16"
            x2="44"
            y2="16"
            stroke={stroke}
            strokeWidth={state === 'idle' ? '2' : '2.5'}
            strokeLinecap="round"
            className={animated ? 'conveyor-flow-forward' : undefined}
          />
          {/* Directional chevron tip */}
          <path
            d="M41 11.5L47.5 16L41 20.5"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Mobile / tablet vertical rail */}
      <div className="flex xl:hidden items-center justify-center py-1">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <line x1="8" y1="0" x2="8" y2="28" stroke="#CBD5E1" strokeWidth="1.5" />
          <line x1="20" y1="0" x2="20" y2="28" stroke="#CBD5E1" strokeWidth="1.5" />
          <rect x="9" y="0" width="10" height="28" fill="#F1F5F9" />
          <line
            x1="14"
            y1="2"
            x2="14"
            y2="22"
            stroke={stroke}
            strokeWidth="2.2"
            className={animated ? 'conveyor-flow-forward' : undefined}
          />
          <path
            d="M10.5 19L14 24L17.5 19"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

interface SerpentineTransferDeckProps {
  reworkState: ConveyorSegmentState;
  deliveryState: ConveyorSegmentState;
  workpiece: FactoryWorkpiecePod | null;
}

/**
 * Mid-deck precision SVG conduit connecting the Upper Trunk Row (ST-01 / ST-02 / ST-03)
 * and Lower Delivery Row (ST-04 / ST-05):
 * 1) Dedicated rounded U-shaped REWORK LOOP conduit from ST-03 bottom back to ST-02 bottom.
 * 2) Serpentine DELIVERY LINE rail dropping from ST-03 right-bottom into ST-04 top entry.
 */
export function SerpentineTransferDeck({
  reworkState,
  deliveryState,
  workpiece,
}: SerpentineTransferDeckProps) {
  const isReworkHot = reworkState === 'rework';
  const reworkStroke = isReworkHot ? '#DC2626' : '#CBD5E1';
  const deliveryStroke = getTrackStroke(deliveryState);
  const deliveryAnimated = deliveryState === 'active';
  const showPodOnRework = workpiece?.location === 'rework_3_2';

  return (
    <div className="relative w-full py-1 select-none" data-testid="serpentine-transfer-deck">
      {/* Desktop full-alignment SVG deck */}
      <div className="hidden xl:block relative h-[78px] w-full">
        <svg
          viewBox="0 0 1200 78"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          aria-hidden="true"
        >
          {/* ==============================================================
              1) REWORK LOOP: ST-03 bottom (x=960) -> U-return -> ST-02 bottom (x=600)
              ============================================================== */}
          {/* Metallic outer conduit shell */}
          <path
            d="M 948 0 L 948 36 Q 948 54 930 54 L 618 54 Q 600 54 600 36 L 600 6"
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 948 0 L 948 36 Q 948 54 930 54 L 618 54 Q 600 54 600 36 L 600 6"
            fill="none"
            stroke={isReworkHot ? '#FEF2F2' : '#F8FAFC'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Inner active rework flow dash (right -> left back into ST-02) */}
          <path
            d="M 948 0 L 948 36 Q 948 54 930 54 L 618 54 Q 600 54 600 36 L 600 9"
            fill="none"
            stroke={reworkStroke}
            strokeWidth={isReworkHot ? '2.8' : '1.8'}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isReworkHot ? 'conveyor-flow-forward' : undefined}
          />
          {/* Amber secondary tracer glint during active rework */}
          {isReworkHot && (
            <path
              d="M 948 0 L 948 36 Q 948 54 930 54 L 618 54 Q 600 54 600 36 L 600 9"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="1.5"
              strokeDasharray="3 18"
              className="conveyor-flow-forward"
            />
          )}
          {/* Upward arrowhead entering ST-02 bottom */}
          <path
            d="M 594 13 L 600 4 L 606 13"
            fill="none"
            stroke={reworkStroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* ==============================================================
              2) SERPENTINE DELIVERY LINE: ST-03 right-bottom (x=1085) -> ST-04 top entry (x=295)
              ============================================================== */}
          <path
            d="M 1086 0 L 1086 22 Q 1086 34 1072 34 L 310 34 Q 294 34 294 48 L 294 74"
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 1086 0 L 1086 22 Q 1086 34 1072 34 L 310 34 Q 294 34 294 48 L 294 74"
            fill="none"
            stroke="#F1F5F9"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 1086 0 L 1086 22 Q 1086 34 1072 34 L 310 34 Q 294 34 294 48 L 294 70"
            fill="none"
            stroke={deliveryStroke}
            strokeWidth={deliveryState === 'idle' ? '2' : '2.6'}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={deliveryAnimated ? 'conveyor-flow-forward' : undefined}
          />
          {/* Downward arrowhead entering ST-04 */}
          <path
            d="M 288 65 L 294 74 L 300 65"
            fill="none"
            stroke={deliveryStroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Crisp HTML labels anchored accurately onto the SVG deck (never stretched by viewBox) */}
        <div
          className={`absolute left-[64%] bottom-[10px] -translate-x-1/2 flex items-center gap-2 rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider transition-colors ${
            isReworkHot
              ? 'border-[#DC2626]/55 bg-[#FEF2F2] text-[#DC2626] shadow-sm'
              : 'border-[#CBD5E1] bg-white/95 text-[#64748B]'
          }`}
          data-testid="rework-loop-badge"
          data-active={isReworkHot ? 'true' : 'false'}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isReworkHot ? 'bg-[#DC2626] animate-ping' : 'bg-[#94A3B8]'
            }`}
          />
          <span>REWORK LOOP · 质检返工回流轨</span>
        </div>

        <div
          className={`absolute left-[26%] top-[23px] -translate-x-1/2 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${
            deliveryState === 'passed'
              ? 'border-[#059669]/40 bg-[#ECFDF5] text-[#059669]'
              : deliveryState === 'active'
                ? 'border-[#2563EB]/45 bg-[#EFF6FF] text-[#2563EB]'
                : 'border-[#E2E8F0] bg-white/95 text-[#64748B]'
          }`}
        >
          DELIVERY LINE · 验收交付轨
        </div>

        {/* Workpiece Pod traveling along REWORK LOOP when active */}
        {showPodOnRework && workpiece && (
          <div className="absolute left-[64%] top-1 -translate-x-1/2 z-10">
            <WorkpiecePod workpiece={workpiece} compact />
          </div>
        )}
      </div>

      {/* Compact responsive transfer indicator below xl */}
      <div className="flex xl:hidden flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-white/90 px-3 py-2 text-[11px] font-mono">
        <div
          className={`inline-flex items-center gap-1.5 font-semibold ${
            isReworkHot ? 'text-[#DC2626]' : 'text-[#64748B]'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isReworkHot ? 'bg-[#DC2626] animate-pulse' : 'bg-[#CBD5E1]'
            }`}
          />
          <span>REWORK LOOP (ST-03 → ST-02)</span>
        </div>
        <div className="text-[#475569]">↓ 交付线流向 ST-04 验收会议室</div>
      </div>
    </div>
  );
}
