import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  MapPin,
  X,
  XCircle,
} from 'lucide-react';
import type { AnalysisJob, BackgroundTask, NavSectionId } from '../types/autodev';
import { FACTORY_STATIONS, type FactoryStationId } from '../lib/factoryPipelineState';

interface BackgroundTasksPanelProps {
  open: boolean;
  onClose: () => void;
  tasks: BackgroundTask[];
  runningAnalysisJob: AnalysisJob | null;
  repoFullName?: string;
  onFocusOpsBuilding?: () => void;
  onNavigateToRoom: (room: NavSectionId, task?: BackgroundTask) => void;
}

const ROOM_ID_TO_STATION: Record<string, FactoryStationId> = {
  environment: 'ST-00',
  prd: 'ST-01',
  pipeline: 'ST-02',
  quality: 'ST-03',
  approval: 'ST-04',
  requirements: 'ST-05',
};

type QueueFilter = 'all' | 'running' | 'completed' | 'failed';

function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function BackgroundTasksPanel({
  open,
  onClose,
  tasks,
  runningAnalysisJob,
  repoFullName,
  onFocusOpsBuilding,
  onNavigateToRoom,
}: BackgroundTasksPanelProps) {
  const [filter, setFilter] = useState<QueueFilter>('all');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const runningCount =
    tasks.filter((t) => t.status === 'running').length +
    (runningAnalysisJob?.status === 'running' ? 1 : 0);

  const filteredTasks = useMemo(() => {
    if (filter === 'all') return tasks;
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const showRunningAnalysis =
    runningAnalysisJob?.status === 'running' &&
    (filter === 'all' || filter === 'running');

  if (!open) return null;

  return (
    <div
      data-testid="background-tasks-modal"
      role="dialog"
      aria-modal="true"
      aria-label="车间后台作业队列"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
    >
      {/* Translucent Cleanroom scrim */}
      <div
        className="absolute inset-0 bg-[#0F172A]/22"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sleek Frosted-White Cleanroom Glass Modal */}
      <div
        className="village-pavilion-enter cleanroom-glass-shell relative z-10 flex flex-col w-full max-w-[880px] h-[78vh] max-h-[720px] rounded-[24px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimal Title + Close Bar */}
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#E2E8F0]/85 bg-white/84">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-[15px] font-bold text-[#0F172A] tracking-tight">
              车间后台作业队列
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                runningCount > 0
                  ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]'
                  : 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: runningCount > 0 ? '#2563EB' : '#059669',
                }}
              />
              <span>
                {runningCount > 0 ? `${runningCount} 项执行中` : '队列空闲'}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭后台作业队列"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0] bg-white text-[#475569] shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable Cleanroom Task Stream */}
        <main className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2.5 bg-[#F6F8FA]/68">
          {showRunningAnalysis && runningAnalysisJob && (
            <button
              type="button"
              onClick={() => {
                onNavigateToRoom('prd');
                onClose();
              }}
              className="w-full text-left rounded-[14px] border border-[#93C5FD] bg-white/95 p-3.5 space-y-1.5 shadow-[0_4px_16px_-6px_rgba(37,99,235,0.16)] hover:border-[#2563EB] transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-[#0F172A] truncate">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB] shrink-0" />
                  <span className="truncate">
                    架构策划：{runningAnalysisJob.prdTitle}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] font-bold text-[#2563EB] shrink-0">
                  ST-01 架构策划部
                </span>
              </div>
              <p className="text-[11.5px] text-[#475569] leading-relaxed">
                正在 Instabox VPS AGY 后台执行单对话架构规划与盲测评审…
              </p>
            </button>
          )}

          {filteredTasks.length === 0 && !showRunningAnalysis ? (
            <div className="rounded-[18px] border border-[#E2E8F0] bg-white/88 py-14 px-6 text-center space-y-2 shadow-[0_6px_20px_-10px_rgba(15,23,42,0.08)]">
              <Clock className="h-7 w-7 text-[#94A3B8] mx-auto" />
              <div className="text-[13.5px] font-semibold text-[#1E293B]">
                {filter === 'all' ? '当前暂无后台运行任务' : '该筛选条件下暂无记录'}
              </div>
              <p className="text-[11.5px] text-[#64748B] max-w-[360px] mx-auto leading-relaxed">
                触发 Draft PR 创建、Cloudflare 预览部署、一键上线合并、RSI 同步归因或仓库重置时，会自动在此实时追踪。
              </p>
            </div>
          ) : (
            filteredTasks.map((task) => {
              const stationId = ROOM_ID_TO_STATION[task.roomId];
              const stationMeta = stationId ? FACTORY_STATIONS[stationId] : null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    onNavigateToRoom(task.roomId, task);
                    onClose();
                  }}
                  className={`w-full text-left rounded-[14px] border p-3.5 space-y-1.5 transition-colors cursor-pointer shadow-[0_4px_14px_-6px_rgba(15,23,42,0.08)] ${
                    task.status === 'running'
                      ? 'border-[#93C5FD] bg-[#EFF6FF]/75 hover:border-[#2563EB]'
                      : task.status === 'failed'
                      ? 'border-[#FECACA] bg-[#FEF2F2]/85 hover:border-[#DC2626]'
                      : 'border-[#E2E8F0] bg-white/94 hover:border-[#CBD5E1]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {task.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB] shrink-0" />
                      ) : task.status === 'completed' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#059669] shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-[#DC2626] shrink-0" />
                      )}
                      <span className="text-[12.5px] font-semibold text-[#0F172A] truncate">
                        {task.title}
                      </span>
                    </div>
                    <span className="font-mono text-[10.5px] text-[#64748B] tabular-nums shrink-0">
                      {formatTime(task.updatedAt)}
                    </span>
                  </div>

                  <p
                    className={`text-[11.5px] leading-relaxed break-words ${
                      task.status === 'failed' ? 'text-[#B91C1C]' : 'text-[#475569]'
                    }`}
                  >
                    {task.status === 'failed'
                      ? task.error || task.progressMessage
                      : task.summary || task.progressMessage}
                  </p>

                  {stationMeta && (
                    <div className="pt-0.5 flex items-center justify-between text-[10.5px] font-mono text-[#64748B]">
                      <span className="text-[#2563EB] font-semibold">
                        {stationMeta.stationId} · {stationMeta.title}
                      </span>
                      <span>进入部门工作台 →</span>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </main>

        {/* Compact Bottom Filter & Action Bar */}
        <footer className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-t border-[#E2E8F0]/85 bg-white/86">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { id: 'all', label: '全部' },
                { id: 'running', label: '运行中' },
                { id: 'completed', label: '已完成' },
                { id: 'failed', label: '异常' },
              ] as Array<{ id: QueueFilter; label: string }>
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-[9px] border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#0F172A] text-white border-[#0F172A]'
                      : 'bg-transparent text-[#64748B] border-transparent hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
            {repoFullName && (
              <span className="hidden md:inline-flex items-center gap-1 ml-2 font-mono text-[10.5px] text-[#64748B]">
                <GitBranch className="h-3 w-3 text-[#059669]" />
                <span>{repoFullName}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onFocusOpsBuilding && (
              <button
                type="button"
                onClick={() => {
                  onFocusOpsBuilding();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#334155] shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors cursor-pointer"
              >
                <MapPin className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>定位算力遥测站</span>
              </button>
            )}
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
