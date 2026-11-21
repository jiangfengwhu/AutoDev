import {
  Activity,
  GitBranch,
  Loader2,
  Map,
  Plus,
} from 'lucide-react';
import type {
  AnalysisJob,
  BackgroundTask,
  NavSectionId,
  SelectedTargetRepo,
} from '../types/autodev';
import { STUDIO_ROOMS } from '../lib/studioTheme';

interface StudioNavigationShellProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  selectedRepo: SelectedTargetRepo;
  backgroundTasks: BackgroundTask[];
  analysisJob: AnalysisJob | null;
  isRequirementInProgress: boolean;
  onOpenNewPrd: () => void;
  onOpenTasksDrawer: () => void;
}

export function StudioNavigationShell({
  activeSection,
  onSelectSection,
  selectedRepo,
  backgroundTasks,
  analysisJob,
  isRequirementInProgress,
  onOpenNewPrd,
  onOpenTasksDrawer,
}: StudioNavigationShellProps) {
  const runningTasks = backgroundTasks.filter((t) => t.status === 'running');
  const totalRunning =
    runningTasks.length + (analysisJob?.status === 'running' ? 1 : 0);

  const isRoomBusy = (roomId: NavSectionId): boolean => {
    if (roomId === 'prd' && analysisJob?.status === 'running') return true;
    return runningTasks.some((t) => t.roomId === roomId);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[#242D3F] bg-[#101520]/95 backdrop-blur-md">
      {/* Primary Top Bar: 3-Zone Contract */}
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        {/* Left: Brand Wordmark + Target Repo */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectSection('studio')}
            className="flex items-center gap-2.5 text-left group whitespace-nowrap shrink-0"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F59E0B] text-[#0C0F16] font-display font-bold text-[13px] tracking-tight">
              AD
            </div>
            <div className="leading-tight">
              <div className="font-display text-[14.5px] font-bold tracking-tight text-[#F8FAFC] group-hover:text-[#FBBF24] transition-colors">
                AutoDev Studio
              </div>
              <div className="hidden sm:block font-mono text-[10px] text-[#7E8FA6]">
                软件研发工作室
              </div>
            </div>
          </button>

          <div className="hidden lg:flex items-center gap-1.5 pl-3 border-l border-[#253042] text-[11.5px] font-mono text-[#8E9DB5] max-w-[220px]">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
            <span className="truncate">{selectedRepo.fullName}</span>
          </div>
        </div>

        {/* Right: Background Tasks Trigger + Primary New PRD CTA */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenTasksDrawer}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              totalRunning > 0
                ? 'border-[#F59E0B]/50 bg-[#F59E0B]/12 text-[#FDE68A] hover:bg-[#F59E0B]/20'
                : 'border-[#2A3448] bg-[#182030] text-[#CBD5E1] hover:bg-[#222B3F] hover:text-[#F8FAFC]'
            }`}
          >
            {totalRunning > 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FBBF24]" />
            ) : (
              <Activity className="h-3.5 w-3.5 text-[#7E8FA6]" />
            )}
            <span className="tabular-nums">
              {totalRunning > 0 ? `后台运行 ${totalRunning}` : '后台任务'}
            </span>
          </button>

          {activeSection !== 'prd' && !isRequirementInProgress && (
            <button
              type="button"
              onClick={onOpenNewPrd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F59E0B] px-3.5 py-1.5 text-[12px] font-semibold text-[#0C0F16] hover:bg-[#FBBF24] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建需求</span>
            </button>
          )}
        </div>
      </div>

      {/* Office Corridor Navigation Strip: Walk between rooms in 1 click */}
      <nav
        aria-label="办公室走廊导航"
        className="border-t border-[#1D2535] bg-[#0D111A]/90"
      >
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto py-1.5">
          <button
            type="button"
            aria-current={activeSection === 'studio' ? 'page' : undefined}
            onClick={() => onSelectSection('studio')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'studio'
                ? 'bg-[#1D2536] text-[#FBBF24] border border-[#F59E0B]/40'
                : 'text-[#94A3B8] hover:bg-[#171E2C] hover:text-[#F8FAFC] border border-transparent'
            }`}
          >
            <Map className="h-3.5 w-3.5" />
            <span>办公室全景</span>
          </button>

          <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#242D3F] shrink-0" />

          {STUDIO_ROOMS.map((room) => {
            const active = activeSection === room.id;
            const busy = isRoomBusy(room.id);
            return (
              <button
                key={room.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectSection(room.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors whitespace-nowrap shrink-0 border ${
                  active
                    ? 'bg-[#1D2536] text-[#F8FAFC] border-[#394865]'
                    : 'border-transparent text-[#94A3B8] hover:bg-[#171E2C] hover:text-[#E2E8F0]'
                }`}
              >
                <span className={`font-mono text-[10px] ${active ? room.accentTextClass : 'text-[#64748B]'}`}>
                  {room.roomCode.replace('RM-', '')}
                </span>
                <span>{room.shortNavLabel}</span>
                {busy && (
                  <Loader2 className="h-3 w-3 animate-spin text-[#FBBF24] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
