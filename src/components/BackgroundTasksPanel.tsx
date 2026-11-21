import { CheckCircle2, Clock, Loader2, X, XCircle } from 'lucide-react';
import type { AnalysisJob, BackgroundTask, NavSectionId } from '../types/autodev';
import { STUDIO_ROOM_MAP, type StudioRoomId } from '../lib/studioTheme';

interface BackgroundTasksPanelProps {
  open: boolean;
  onClose: () => void;
  tasks: BackgroundTask[];
  runningAnalysisJob: AnalysisJob | null;
  onNavigateToRoom: (room: NavSectionId) => void;
}

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
  onNavigateToRoom,
}: BackgroundTasksPanelProps) {
  if (!open) return null;

  const runningCount =
    tasks.filter((t) => t.status === 'running').length +
    (runningAnalysisJob?.status === 'running' ? 1 : 0);

  return (
    <div
      role="dialog"
      aria-label="后台运行任务中心"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] h-full bg-[#121722] border-l border-[#283245] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#263042] flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-[#F8FAFC]">
              工作室后台任务板
            </h2>
            <p className="mt-0.5 text-[11px] text-[#94A3B8]">
              全部耗时操作均在服务端异步执行，切换房间或关闭页面不会中断
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭后台任务板"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#2C374B] bg-[#1A2130] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#232C3F] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-2.5 border-b border-[#1E2636] bg-[#0E131D] flex items-center justify-between text-[11px] font-mono tabular-nums text-[#94A3B8]">
          <span>进行中 {runningCount} 项</span>
          <span>最近记录 {tasks.length} 条</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {runningAnalysisJob?.status === 'running' && (
            <button
              type="button"
              onClick={() => {
                onNavigateToRoom('prd');
                onClose();
              }}
              className="w-full text-left rounded-xl border border-[#38BDF8]/40 bg-[#172234] p-3.5 space-y-1.5 hover:border-[#38BDF8]/70 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#F8FAFC] truncate">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#38BDF8] shrink-0" />
                  <span className="truncate">架构策划：{runningAnalysisJob.prdTitle}</span>
                </span>
                <span className="font-mono text-[10px] text-[#38BDF8] shrink-0">架构策划室</span>
              </div>
              <p className="text-[11px] text-[#B8C4D4] leading-relaxed">
                正在 Instabox VPS AGY 后台执行单对话架构规划与盲测评审…
              </p>
            </button>
          )}

          {tasks.length === 0 && runningAnalysisJob?.status !== 'running' ? (
            <div className="py-16 text-center space-y-2">
              <Clock className="h-7 w-7 text-[#4B5870] mx-auto" />
              <div className="text-[13px] font-medium text-[#CBD5E1]">
                当前暂无后台运行任务
              </div>
              <p className="text-[11px] text-[#7E8FA6] max-w-[260px] mx-auto leading-relaxed">
                触发 Draft PR 创建、预览部署、一键上线合并、RSI 同步归因或清库重置时，会自动在此实时追踪。
              </p>
            </div>
          ) : (
            tasks.map((task) => {
              const roomMeta =
                task.roomId !== 'studio' ? STUDIO_ROOM_MAP[task.roomId as StudioRoomId] : null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    onNavigateToRoom(task.roomId);
                    onClose();
                  }}
                  className={`w-full text-left rounded-xl border p-3.5 space-y-1.5 transition-colors ${
                    task.status === 'running'
                      ? 'border-[#F59E0B]/45 bg-[#1B1F2B] hover:border-[#F59E0B]/70'
                      : task.status === 'failed'
                        ? 'border-[#FB7185]/35 bg-[#1D1720] hover:border-[#FB7185]/60'
                        : 'border-[#263042] bg-[#161C28] hover:border-[#36435A]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {task.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FBBF24] shrink-0" />
                      ) : task.status === 'completed' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#34D399] shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-[#FB7185] shrink-0" />
                      )}
                      <span className="text-[12px] font-semibold text-[#F8FAFC] truncate">
                        {task.title}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[#7E8FA6] tabular-nums shrink-0">
                      {formatTime(task.updatedAt)}
                    </span>
                  </div>

                  <p
                    className={`text-[11px] leading-relaxed break-words ${
                      task.status === 'failed' ? 'text-[#FDA4AF]' : 'text-[#94A3B8]'
                    }`}
                  >
                    {task.status === 'failed'
                      ? task.error || task.progressMessage
                      : task.summary || task.progressMessage}
                  </p>

                  {roomMeta && (
                    <div className="pt-0.5 flex items-center justify-between text-[10px] font-mono text-[#7E8FA6]">
                      <span className={roomMeta.accentTextClass}>
                        {roomMeta.roomCode} · {roomMeta.shortNavLabel}
                      </span>
                      <span>点击进入房间 →</span>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
