import {
  Activity,
  CheckSquare,
  ClipboardList,
  FileCode2,
  GitBranch,
  Layers,
  ServerCog,
  X,
} from 'lucide-react';
import type { NavSectionId, SelectedTargetRepo } from '../types/autodev';

interface SidebarProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  selectedRepo: SelectedTargetRepo | null;
  runCount: number;
  isAnalyzingJob?: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSectionId;
  index: string;
  label: string;
  icon: typeof ServerCog;
}> = [
  { id: 'environment', index: '1', label: '环境与引擎装配', icon: ServerCog },
  { id: 'prd', index: '2', label: '新建需求 (PRD)', icon: FileCode2 },
  { id: 'requirements', index: '3', label: '需求看板', icon: ClipboardList },
  { id: 'pipeline', index: '4', label: '全自动流水线看板', icon: Layers },
  { id: 'approval', index: '5', label: '验收与上线审批', icon: CheckSquare },
  { id: 'quality', index: '6', label: '质量与自进化 (RSI)', icon: Activity },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  selectedRepo,
  runCount,
  isAnalyzingJob,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col bg-[#010409] border-r border-[#30363D]">
      {/* Brand Header */}
      <div className="flex h-14 items-center justify-between px-4 border-b border-[#30363D] bg-[#161B22]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#238636] text-[#F0F6FC] font-semibold text-xs tracking-tight border border-[#3FB950]/40">
            AD
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-[#F0F6FC] whitespace-nowrap truncate">
            AutoDev Studio
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="关闭导航菜单"
          className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-[#8B949E] hover:bg-[#21262D] hover:text-[#F0F6FC] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary Navigation */}
      <nav aria-label="主导航" className="flex-1 px-3 py-4 space-y-1">
        <div className="px-2.5 pb-2 text-[11px] font-semibold text-[#8B949E]">
          自动化工作区
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors whitespace-nowrap border ${
                isActive
                  ? 'bg-[#161B22] text-[#F0F6FC] border-[#30363D]'
                  : 'border-transparent text-[#8B949E] hover:bg-[#161B22]/70 hover:text-[#C9D1D9]'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-[#58A6FF]' : 'text-[#6E7681]'
                  }`}
                />
                <span className="truncate">
                  {item.index}. {item.label}
                </span>
              </span>
              {item.id === 'prd' && isAnalyzingJob && (
                <span className="font-mono text-[11px] text-[#58A6FF] shrink-0">
                  运行中
                </span>
              )}
              {item.id === 'pipeline' && runCount > 0 && (
                <span className="font-mono text-[11px] tabular-nums text-[#8B949E] shrink-0">
                  {runCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bound Target Repo Context */}
      <div className="p-3 border-t border-[#30363D]">
        <div className="px-1.5">
          <div className="text-[11px] font-medium text-[#8B949E] mb-1">
            目标仓库
          </div>
          {selectedRepo ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[12px] font-mono text-[#F0F6FC] truncate">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#58A6FF]" />
                <span className="truncate" title={selectedRepo.fullName}>
                  {selectedRepo.fullName}
                </span>
              </div>
              <div className="text-[11px] text-[#8B949E] flex items-center gap-1.5">
                <span className="font-mono">{selectedRepo.defaultBranch}</span>
                <span aria-hidden="true">·</span>
                <span>{selectedRepo.isLiveGitHub ? 'GitHub 已绑定' : '未连接'}</span>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[#8B949E]">
              尚未选定目标仓库
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[256px] shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[272px] max-w-[82vw] h-full">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
