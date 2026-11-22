import { useEffect, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  MapPin,
  X,
} from 'lucide-react';
import {
  FACTORY_STATIONS,
  type FactoryPipelineSnapshot,
  type FactoryStationId,
} from '../../lib/factoryPipelineState';

interface DepartmentPavilionModalProps {
  stationId: FactoryStationId | null;
  snapshot: FactoryPipelineSnapshot;
  repoFullName: string;
  onSelectStation: (stationId: FactoryStationId) => void;
  onFocusBuilding: (stationId: FactoryStationId) => void;
  onClose: () => void;
  children: ReactNode;
}

const DEPARTMENT_ORDER: FactoryStationId[] = [
  'ST-00',
  'ST-01',
  'ST-02',
  'ST-03',
  'ST-04',
  'ST-05',
];

export function DepartmentPavilionModal({
  stationId,
  snapshot,
  repoFullName,
  onSelectStation,
  onFocusBuilding,
  onClose,
  children,
}: DepartmentPavilionModalProps) {
  useEffect(() => {
    if (!stationId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stationId, onClose]);

  if (!stationId) return null;

  const meta = FACTORY_STATIONS[stationId];
  const currentIndex = DEPARTMENT_ORDER.indexOf(stationId);
  const prevStation =
    DEPARTMENT_ORDER[
      (currentIndex - 1 + DEPARTMENT_ORDER.length) % DEPARTMENT_ORDER.length
    ];
  const nextStation =
    DEPARTMENT_ORDER[(currentIndex + 1) % DEPARTMENT_ORDER.length];

  return (
    <div
      data-testid="department-pavilion-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${meta.title} 工作台`}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
    >
      {/* Translucent Cleanroom scrim */}
      <div
        className="absolute inset-0 bg-[#0F172A]/22"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sleek Frosted-White Cleanroom Glass Modal — directly shows operational workspace without 3D header clutter */}
      <div className="village-pavilion-enter cleanroom-glass-shell relative z-10 flex flex-col w-full max-w-[1200px] h-[88vh] max-h-[856px] rounded-[24px] overflow-hidden">
        {/* Floating minimal top-right close button */}
        <button
          type="button"
          data-testid="pavilion-close"
          onClick={onClose}
          aria-label="关闭部门工作台"
          className="absolute top-3.5 right-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0] bg-white/92 text-[#475569] shadow-[0_4px_14px_-2px_rgba(15,23,42,0.12)] hover:bg-white hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Operational Department Workspace */}
        <main
          data-testid="pavilion-workspace"
          className="flex-1 min-w-0 min-h-0 overflow-y-auto px-5 pt-5 pb-6 sm:px-7 sm:pt-6 village-pavilion-surface bg-[#F6F8FA]/68"
        >
          {children}
        </main>

        {/* Compact Bottom Action Console */}
        <footer
          data-testid="pavilion-bottom-console"
          className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-2.5 border-t border-[#E2E8F0]/85 bg-white/86"
        >
          <div className="flex items-center gap-2.5 min-w-0 text-[11.5px] text-[#475569]">
            <span className="font-mono text-[11px] font-bold text-[#2563EB]">
              {meta.stationId}
            </span>
            <span className="font-semibold text-[#0F172A]">{meta.title}</span>
            <span className="text-[#CBD5E1]">|</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#334155] truncate">
              <GitBranch className="h-3.5 w-3.5 text-[#059669] shrink-0" />
              <span className="truncate">{repoFullName}</span>
            </span>
            <span className="hidden sm:inline text-[#CBD5E1]">·</span>
            <span className="hidden sm:inline font-mono text-[11px] text-[#64748B] whitespace-nowrap">
              {snapshot.mode === 'demo' ? '演练演示' : '真实产线'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="pavilion-focus-camera"
              onClick={() => {
                onFocusBuilding(stationId);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#334155] shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors cursor-pointer whitespace-nowrap"
            >
              <MapPin className="h-3.5 w-3.5 text-[#2563EB]" />
              <span>镜头定位</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectStation(prevStation)}
              className="inline-flex items-center gap-1 rounded-[10px] border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#334155] shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:border-[#CBD5E1] hover:text-[#0F172A] transition-colors cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>{FACTORY_STATIONS[prevStation].title}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectStation(nextStation)}
              className="inline-flex items-center gap-1 rounded-[10px] border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#334155] shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:border-[#CBD5E1] hover:text-[#0F172A] transition-colors cursor-pointer"
            >
              <span>{FACTORY_STATIONS[nextStation].title}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#2563EB] px-3.5 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_6px_16px_-4px_rgba(37,99,235,0.36)] hover:bg-[#1D4ED8] transition-colors cursor-pointer"
            >
              <span>返回全景</span>
              <span className="font-mono text-[10px] opacity-80">ESC</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
