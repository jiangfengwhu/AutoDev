import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Monitor,
  Plus,
  Sparkles,
} from 'lucide-react';
import type {
  AnalysisJob,
  BackgroundTask,
  IntegrationsStatusResponse,
  PipelineRun,
  SelectedTargetRepo,
} from '../types/autodev';
import {
  formatTokenCount,
  type SevenDayOverviewMetrics,
} from '../lib/overviewMetrics';
import {
  STUDIO_IMAGES,
  STUDIO_ROOMS,
  type StudioRoomId,
} from '../lib/studioTheme';

interface StudioOfficeMapProps {
  selectedRepo: SelectedTargetRepo;
  status: IntegrationsStatusResponse | null;
  runs: PipelineRun[];
  analysisJob: AnalysisJob | null;
  backgroundTasks: BackgroundTask[];
  isRequirementInProgress: boolean;
  onEnterRoom: (roomId: StudioRoomId) => void;
  onOpenNewPrd: () => void;
  onOpenTasksDrawer: () => void;
}

export function buildRoomLiveState(params: {
  roomId: StudioRoomId;
  runs: PipelineRun[];
  analysisJob: AnalysisJob | null;
  backgroundTasks: BackgroundTask[];
  status: IntegrationsStatusResponse | null;
}): { speech: string; metricLabel: string; isBusy: boolean } {
  const { roomId, runs, analysisJob, backgroundTasks, status } = params;
  const runningRoomTasks = backgroundTasks.filter(
    (t) => t.status === 'running' && t.roomId === roomId
  );

  if (runningRoomTasks.length > 0) {
    return {
      speech: runningRoomTasks[0].progressMessage,
      metricLabel: `${runningRoomTasks.length} 项后台执行中`,
      isBusy: true,
    };
  }

  const activeDraftRun = runs.find(
    (r) => !r.mergedRelease && r.status !== 'approved'
  );
  const deliveredCount = runs.filter(
    (r) => Boolean(r.mergedRelease) || r.status === 'approved'
  ).length;
  const pendingApprovalCount = runs.filter(
    (r) => Boolean(r.draftPr) && !r.mergedRelease && r.status !== 'approved'
  ).length;

  switch (roomId) {
    case 'environment': {
      const ghOk = status?.github.connected;
      const cfOk = status?.cloudflare.connected;
      const onlineCount = [ghOk, cfOk, status?.gemini.configured].filter(Boolean).length;
      return {
        speech:
          onlineCount === 3
            ? '大屏遥测正常，GitHub、Cloudflare 与 AI 引擎全线就绪。'
            : `已接入 ${onlineCount}/3 核心引擎，可进大厅检查连接状态与大屏指标。`,
        metricLabel: `${onlineCount}/3 引擎在线`,
        isBusy: false,
      };
    }
    case 'prd': {
      if (analysisJob?.status === 'running') {
        return {
          speech: `正在单对话联合拆解「${analysisJob.prdTitle}」的架构与盲测集…`,
          metricLabel: 'AGY 规划中',
          isBusy: true,
        };
      }
      const analyzedAwaitingPr = runs.find(
        (r) => r.status === 'analyzed' && !r.draftPr && !r.mergedRelease
      );
      if (analyzedAwaitingPr) {
        return {
          speech: `「${analyzedAwaitingPr.prdTitle}」规划已出炉，支持在线修订后创建 Draft PR。`,
          metricLabel: '待建 Draft PR',
          isBusy: false,
        };
      }
      return {
        speech: '蓝图白板已清空，随时可以把新需求交给我和 QA 一起拆解。',
        metricLabel: '白板待命',
        isBusy: false,
      };
    }
    case 'requirements': {
      return {
        speech:
          runs.length > 0
            ? `档案柜已归档 ${runs.length} 份需求卷宗，可查阅 Coding Agent 最终回复与完整报告。`
            : '档案柜目前为空，发起首个需求后将自动整理全链路档案与报告。',
        metricLabel: `${runs.length} 份卷宗`,
        isBusy: false,
      };
    }
    case 'pipeline': {
      if (activeDraftRun?.draftPr) {
        return {
          speech: `双屏工位正在跟进「${activeDraftRun.prdTitle}」(${activeDraftRun.draftPr.branchName})。`,
          metricLabel: `PR #${activeDraftRun.draftPr.prNumber}`,
          isBusy: false,
        };
      }
      return {
        speech: '双屏工位待命中，创建 Draft PR 后我会在此接管 VPS AGY 编码与盲测修复。',
        metricLabel: `${runs.filter((r) => Boolean(r.draftPr)).length} 次交付`,
        isBusy: false,
      };
    }
    case 'approval': {
      if (pendingApprovalCount > 0) {
        return {
          speech: `会议室有 ${pendingApprovalCount} 个需求待验收预览，验收通过可一键合并上线。`,
          metricLabel: `${pendingApprovalCount} 项待审批`,
          isBusy: false,
        };
      }
      return {
        speech:
          deliveredCount > 0
            ? `已累计签发上线 ${deliveredCount} 个需求，会议室暂清闲。`
            : '等待代码车间推送预览环境后，在此逐条核验并批准上线。',
        metricLabel: `${deliveredCount} 已上线`,
        isBusy: false,
      };
    }
    case 'quality': {
      return {
        speech: '盲测监控与 RSI 规则书架持续运转，失败自动归因并反哺下一轮规划。',
        metricLabel: 'RSI 自进化',
        isBusy: false,
      };
    }
  }
}

export function StudioOfficeMap({
  selectedRepo,
  status,
  runs,
  analysisJob,
  backgroundTasks,
  isRequirementInProgress,
  onEnterRoom,
  onOpenNewPrd,
  onOpenTasksDrawer,
}: StudioOfficeMapProps) {
  const [hoveredRoomId, setHoveredRoomId] = useState<StudioRoomId | null>(null);
  const [floorplanError, setFloorplanError] = useState(false);
  const [avatarErrors, setAvatarErrors] = useState<Record<string, boolean>>({});
  const [overview, setOverview] = useState<SevenDayOverviewMetrics | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/overview/metrics?repo=${encodeURIComponent(selectedRepo.fullName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setOverview(data as SevenDayOverviewMetrics);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedRepo.fullName, runs.length]);

  const runningBackgroundCount =
    backgroundTasks.filter((t) => t.status === 'running').length +
    (analysisJob?.status === 'running' ? 1 : 0);

  const focusedRoom = hoveredRoomId
    ? STUDIO_ROOMS.find((r) => r.id === hoveredRoomId) ?? STUDIO_ROOMS[0]
    : STUDIO_ROOMS[0];
  const focusedLive = buildRoomLiveState({
    roomId: focusedRoom.id,
    runs,
    analysisJob,
    backgroundTasks,
    status,
  });

  const summary = overview?.summary;

  return (
    <div className="space-y-8">
      {/* Studio Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[12px] font-mono text-[#FBBF24]">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AUTODEV VIRTUAL SOFTWARE STUDIO</span>
            <span aria-hidden="true" className="text-[#4B5870]">·</span>
            <span className="text-[#94A3B8]">{selectedRepo.fullName}</span>
          </div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold tracking-tight text-[#F8FAFC] leading-tight">
            数字研发工作室全景
          </h1>
          <p className="text-[13.5px] text-[#94A3B8] max-w-[680px]">
            点击平面图中的任意办公室或下方角色工位即可步入对应工作区；所有耗时操作均在服务端后台执行，切换房间不会中断。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {runningBackgroundCount > 0 && (
            <button
              type="button"
              onClick={onOpenTasksDrawer}
              className="inline-flex items-center gap-2 rounded-lg border border-[#F59E0B]/45 bg-[#F59E0B]/12 px-3.5 py-2 text-[13px] font-medium text-[#FDE68A] hover:bg-[#F59E0B]/20 transition-colors whitespace-nowrap"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FBBF24]" />
              <span className="tabular-nums">{runningBackgroundCount} 项后台任务运行中</span>
            </button>
          )}
          {!isRequirementInProgress && (
            <button
              type="button"
              onClick={onOpenNewPrd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F59E0B] px-4 py-2 text-[13px] font-semibold text-[#0C0F16] hover:bg-[#FBBF24] transition-colors whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>走进策划室 · 新建需求</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive Architectural Floorplan + Wall Big-Screen Telemetry Column */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left 8 Cols: Interactive Isometric Studio Cutaway */}
        <div className="xl:col-span-8 rounded-2xl border border-[#263042] bg-[#121722] overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-[#222B3B] bg-[#151B28] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#F8FAFC]">
              <span>工作室三维平面图</span>
              <span aria-hidden="true" className="text-[#4B5870]">·</span>
              <span className="text-[12px] font-normal text-[#94A3B8]">
                点击房间标牌直接进入对应工作区
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#7E8FA6] tabular-nums">
              6 间功能办公室 · 全员在岗
            </span>
          </div>

          <div className="relative aspect-video w-full bg-[#0E131D] overflow-hidden select-none">
            {!floorplanError ? (
              <img
                src={STUDIO_IMAGES.floorplan}
                alt="AutoDev 数字研发工作室六大功能办公室三维平面图"
                referrerPolicy="no-referrer"
                onError={() => setFloorplanError(true)}
                className="h-full w-full object-cover opacity-90"
              />
            ) : (
              <div className="h-full w-full studio-blueprint-floor flex items-center justify-center text-[#94A3B8] text-[13px]">
                AutoDev 工作室平面图
              </div>
            )}

            {/* Subtle vignette so interactive room pins stay crisp & high contrast */}
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0C0F16]/85 via-transparent to-[#0C0F16]/25"
              aria-hidden="true"
            />

            {/* 6 Interactive Spatial Room Pins */}
            {STUDIO_ROOMS.map((room) => {
              const live = buildRoomLiveState({
                roomId: room.id,
                runs,
                analysisJob,
                backgroundTasks,
                status,
              });
              const isHovered = hoveredRoomId === room.id;

              return (
                <button
                  key={room.id}
                  type="button"
                  onMouseEnter={() => setHoveredRoomId(room.id)}
                  onFocus={() => setHoveredRoomId(room.id)}
                  onClick={() => onEnterRoom(room.id)}
                  style={{
                    left: `${room.hotspot.leftPct}%`,
                    top: `${room.hotspot.topPct}%`,
                  }}
                  className={`group absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2.5 py-1.5 text-left transition-all duration-200 backdrop-blur-md shadow-lg ${
                    isHovered || live.isBusy
                      ? 'bg-[#111723]/95 border-[#FBBF24] scale-[1.04] z-20'
                      : 'bg-[#101521]/88 border-[#344259] hover:border-[#FBBF24]/80 z-10'
                  }`}
                >
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <div className="relative h-6 w-6 shrink-0 rounded-lg overflow-hidden border border-white/15 bg-[#1C2433]">
                      {!avatarErrors[room.id] ? (
                        <img
                          src={room.avatarUrl}
                          alt={room.characterName}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setAvatarErrors((prev) => ({ ...prev, [room.id]: true }))
                          }
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-[#F8FAFC]">
                          {room.avatarFallbackInitials}
                        </span>
                      )}
                    </div>
                    <div className="leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11.5px] font-semibold text-[#F8FAFC]">
                          {room.shortNavLabel}
                        </span>
                        {live.isBusy && (
                          <Loader2 className="h-3 w-3 animate-spin text-[#FBBF24]" />
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-[#94A3B8] tabular-nums">
                        {room.characterName} · {live.metricLabel}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Live Room Speech Bar pinned cleanly at bottom of the floorplan */}
            <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-[#2C374C] bg-[#0F141F]/92 backdrop-blur-md px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2.5 text-[12px]">
                <span className={`font-mono text-[11px] font-semibold shrink-0 ${focusedRoom.accentTextClass}`}>
                  {focusedRoom.roomCode} {focusedRoom.shortNavLabel}
                </span>
                <span aria-hidden="true" className="text-[#4B5870]">·</span>
                <span className="text-[#E2E8F0] truncate">
                  {focusedRoom.characterName}：「{focusedLive.speech}」
                </span>
              </div>
              <button
                type="button"
                onClick={() => onEnterRoom(focusedRoom.id)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#FBBF24] hover:text-[#FDE68A] whitespace-nowrap shrink-0 self-end sm:self-auto"
              >
                <span>进入{focusedRoom.shortNavLabel}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right 4 Cols: Command Hall Wall Big-Screen Live Monitor */}
        <div className="xl:col-span-4 rounded-2xl border border-[#2B3548] studio-bigscreen-bezel p-5 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#222B3B]">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-[#FBBF24]" />
                <h2 className="font-display text-[15px] font-semibold text-[#F8FAFC]">
                  办公室数据大屏
                </h2>
              </div>
              <span className="font-mono text-[11px] text-[#34D399]">LIVE 7D</span>
            </div>

            {/* Wall Big-Screen Metric Tiles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#222B3B] bg-[#101520] p-3.5">
                <div className="text-[11px] text-[#8E9DB5]">近 7 日成功率</div>
                <div className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums text-[#34D399]">
                  {summary?.overallSuccessRate !== null && summary?.overallSuccessRate !== undefined
                    ? `${summary.overallSuccessRate}%`
                    : '—'}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-[#6E7E97] tabular-nums">
                  成功 {summary?.succeededRuns ?? 0} / 总 {summary?.totalRuns ?? 0}
                </div>
              </div>

              <div className="rounded-xl border border-[#222B3B] bg-[#101520] p-3.5">
                <div className="text-[11px] text-[#8E9DB5]">近 7 日算力 Token</div>
                <div className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums text-[#38BDF8]">
                  {summary ? formatTokenCount(summary.totalTokens) : '0'}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-[#6E7E97] tabular-nums">
                  规划 {summary ? formatTokenCount(summary.planTokens) : '0'}
                </div>
              </div>

              <div className="rounded-xl border border-[#222B3B] bg-[#101520] p-3.5">
                <div className="text-[11px] text-[#8E9DB5]">本周需求交付</div>
                <div className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums text-[#F8FAFC]">
                  {summary?.deliveredPrdCount ?? 0}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-[#6E7E97] tabular-nums">
                  已上线 {summary?.approvedPrdCount ?? 0} 项
                </div>
              </div>

              <div className="rounded-xl border border-[#222B3B] bg-[#101520] p-3.5">
                <div className="text-[11px] text-[#8E9DB5]">单次平均耗时</div>
                <div className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums text-[#FBBF24]">
                  {summary?.avgDurationMinutes !== null && summary?.avgDurationMinutes !== undefined
                    ? `${summary.avgDurationMinutes.toFixed(1)}m`
                    : '—'}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-[#6E7E97] tabular-nums">
                  已完成 {summary?.completedRuns ?? 0} 次
                </div>
              </div>
            </div>

            {/* Connected Engine Rack Summary */}
            <div className="rounded-xl border border-[#222B3B] bg-[#0F141F] p-3.5 space-y-2 text-[12px]">
              <div className="text-[11px] font-mono text-[#7E8FA6]">机房引擎状态</div>
              <div className="flex items-center justify-between">
                <span className="text-[#CBD5E1]">GitHub Actions 沙箱</span>
                <span className={`font-mono text-[11px] ${status?.github.connected ? 'text-[#34D399]' : 'text-[#FBBF24]'}`}>
                  {status?.github.connected ? '在线' : '待检'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#CBD5E1]">Cloudflare Workers</span>
                <span className={`font-mono text-[11px] ${status?.cloudflare.connected ? 'text-[#34D399]' : 'text-[#FBBF24]'}`}>
                  {status?.cloudflare.connected ? '在线' : '待检'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#CBD5E1]">AI 多智能体引擎</span>
                <span className={`font-mono text-[11px] ${status?.gemini.configured ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                  {status?.gemini.configured ? '就绪' : '未配置'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onEnterRoom('environment')}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/12 px-4 py-2.5 text-[13px] font-semibold text-[#FDE68A] hover:bg-[#F59E0B]/20 transition-colors"
          >
            <span>进入指挥大厅 · 展开完整大屏</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* 6 Office Rooms Directory Grid */}
      <section aria-label="六大功能办公室与角色工位" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-[18px] font-semibold text-[#F8FAFC]">
              办公室工位与资料分布
            </h2>
            <p className="text-[12.5px] text-[#8E9DB5]">
              每个房间由专属角色负责并存放对应的研发资料，点击任意工位卡片即可步入工作。
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[12px] text-[#34D399]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>后台异步队列已启用</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {STUDIO_ROOMS.map((room) => {
            const live = buildRoomLiveState({
              roomId: room.id,
              runs,
              analysisJob,
              backgroundTasks,
              status,
            });
            return (
              <div
                key={room.id}
                onMouseEnter={() => setHoveredRoomId(room.id)}
                className={`group rounded-2xl border bg-[#131924] p-5 flex flex-col justify-between gap-4 transition-all duration-200 hover:-translate-y-0.5 ${
                  live.isBusy
                    ? 'border-[#F59E0B]/55'
                    : 'border-[#253042] hover:border-[#3A4A66]'
                }`}
              >
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative h-12 w-12 shrink-0 rounded-xl overflow-hidden border border-[#324056] bg-[#1C2433]">
                        {!avatarErrors[room.id] ? (
                          <img
                            src={room.avatarUrl}
                            alt={`${room.characterName} — ${room.characterRole}`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setAvatarErrors((prev) => ({ ...prev, [room.id]: true }))
                            }
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center font-display text-[16px] font-bold text-[#F8FAFC]">
                            {room.avatarFallbackInitials}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono text-[10.5px] font-semibold ${room.accentTextClass}`}>
                            {room.roomCode}
                          </span>
                          <span className="text-[11px] text-[#8E9DB5] truncate">
                            {room.characterName} · {room.characterRole}
                          </span>
                        </div>
                        <h3 className="font-display text-[15px] font-semibold text-[#F8FAFC] truncate mt-0.5">
                          {room.roomName}
                        </h3>
                      </div>
                    </div>

                    <span className="font-mono text-[11px] tabular-nums text-[#94A3B8] shrink-0">
                      {live.metricLabel}
                    </span>
                  </div>

                  {/* Character Live Speech Note */}
                  <div className="rounded-xl border border-[#222B3B] bg-[#0D111A] px-3.5 py-2.5 text-[12px] text-[#CBD5E1] leading-relaxed">
                    「{live.speech}」
                  </div>

                  {/* Stored Artifacts in this room */}
                  <p className="text-[11.5px] text-[#7E8FA6] leading-relaxed">
                    室内资料：{room.storedArtifacts}
                  </p>
                </div>

                <div className="pt-2 border-t border-[#1F2736] flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-[#94A3B8]">{room.moduleName}</span>
                  <button
                    type="button"
                    onClick={() => onEnterRoom(room.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#2D384D] bg-[#1A2230] px-3 py-1.5 text-[12px] font-medium text-[#E2E8F0] hover:bg-[#242F42] hover:text-[#F8FAFC] transition-colors whitespace-nowrap"
                  >
                    <span>进入办公室</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
