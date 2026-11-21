import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  History,
  Loader2,
  MessageSquare,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AnalysisJob,
  CodingAgentOutputSnapshot,
  PipelineRun,
} from '../types/autodev';
import type { TestExecutionReport } from '../lib/rsiEngine';
import type { AuditLogEntry } from '../lib/requirementsBoard';
import { formatTokenCount } from '../lib/overviewMetrics';
import { STUDIO_IMAGES } from '../lib/studioTheme';

interface RequirementReportPayload {
  id: string;
  generatedAt: string;
  run: PipelineRun | null;
  job: AnalysisJob | null;
  codingOutput: CodingAgentOutputSnapshot | null;
  testReports: TestExecutionReport[];
  auditEvents: AuditLogEntry[];
}

interface RequirementReportModalProps {
  requirementId: string;
  onClose: () => void;
  onSuccessToast?: (message: string, title?: string) => void;
  onErrorToast?: (message: string, title?: string) => void;
}

type ReportTab = 'coding' | 'plan' | 'tests' | 'timeline';

function formatFullDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function buildStandaloneMarkdownReport(payload: RequirementReportPayload): string {
  const { run, job, codingOutput, testReports, auditEvents } = payload;
  const title = run?.prdTitle || job?.prdTitle || payload.id;
  const repo = run?.repoFullName || job?.repoFullName || '';
  const branch = run?.draftPr?.branchName || run?.defaultBranch || job?.defaultBranch || 'main';
  const lines: string[] = [];

  lines.push(`# 需求交付完整报告：${title}`);
  lines.push('');
  lines.push(`- **需求 ID**：\`${payload.id}\``);
  lines.push(`- **目标仓库**：\`${repo}\``);
  lines.push(`- **需求分支**：\`${branch}\``);
  lines.push(`- **报告生成时间**：${formatFullDateTime(payload.generatedAt)}`);
  if (run?.draftPr) {
    lines.push(`- **GitHub PR**：[#${run.draftPr.prNumber}](${run.draftPr.prUrl})`);
  }
  if (run?.previewDeployment?.url) {
    lines.push(`- **Preview 预览地址**：${run.previewDeployment.url}`);
  }
  if (run?.productionDeployment?.url) {
    lines.push(`- **生产发布地址**：${run.productionDeployment.url}`);
  }
  if (run?.mergedRelease) {
    lines.push(
      `- **合入主分支**：\`${run.mergedRelease.baseBranch}\` @ \`${run.mergedRelease.mergeCommitSha.slice(0, 7)}\` (${formatFullDateTime(run.mergedRelease.mergedAt)})`
    );
  }
  const planTokens = run?.planTokenUsage?.totalTokens ?? job?.tokenUsage?.totalTokens ?? 0;
  const codingTokens = codingOutput?.tokenUsage?.totalTokens ?? 0;
  if (planTokens + codingTokens > 0) {
    lines.push(
      `- **Token 算力消耗**：总计 ${formatTokenCount(planTokens + codingTokens)}（规划 ${formatTokenCount(planTokens)} · 编码 ${formatTokenCount(codingTokens)}）`
    );
  }
  lines.push('');

  lines.push('## 1. Coding Agent 最终交付输出');
  lines.push('');
  if (codingOutput?.content) {
    if (codingOutput.model || codingOutput.commitSha || codingOutput.repairRounds !== undefined) {
      lines.push(
        `> 模型：\`${codingOutput.model || 'VPS AGY'}\` · Commit：\`${codingOutput.commitSha ? codingOutput.commitSha.slice(0, 7) : '—'}\` · 自动修复轮次：${codingOutput.repairRounds ?? 0} · 采集时间：${formatFullDateTime(codingOutput.capturedAt)}`
      );
      lines.push('');
    }
    lines.push(codingOutput.content.trim());
  } else {
    lines.push('_当前需求尚未产生 Coding Agent 最终输出记录。_');
  }
  lines.push('');

  lines.push('## 2. 原始 PRD 需求正文');
  lines.push('');
  lines.push((run?.prdContent || job?.prdContent || '（无正文）').trim());
  lines.push('');

  if (run?.architect) {
    lines.push('## 3. 架构设计与原子任务树');
    lines.push('');
    lines.push(run.architect.architectureSummary || '—');
    lines.push('');
    if (run.architect.techDecisions.length > 0) {
      lines.push('### 关键技术决策');
      run.architect.techDecisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
      lines.push('');
    }
    if (run.architect.apiContracts.length > 0) {
      lines.push('### 公开接口契约');
      lines.push('| 方法 | 路径 | 职责 | 请求结构 | 响应结构 |');
      lines.push('| --- | --- | --- | --- | --- |');
      run.architect.apiContracts.forEach((api) => {
        lines.push(
          `| ${api.method} | \`${api.path}\` | ${api.summary} | \`${api.requestSchema}\` | \`${api.responseSchema}\` |`
        );
      });
      lines.push('');
    }
    if (run.architect.tasks.length > 0) {
      const checked = new Set(run.checkedCriteriaIds ?? []);
      lines.push('### 原子开发任务与验收标准');
      run.architect.tasks.forEach((task) => {
        lines.push(`#### ${task.id} · ${task.title} (${task.module}, 复杂度 ${task.estimatedComplexity})`);
        lines.push(task.description);
        task.acceptanceCriteria.forEach((ac, idx) => {
          const done = checked.has(`${task.id}::${idx}`);
          lines.push(`- [${done ? 'x' : ' '}] ${ac}`);
        });
        lines.push('');
      });
    }
  }

  lines.push('## 4. 独立盲测与验证报告');
  lines.push('');
  if (testReports.length > 0) {
    testReports.forEach((rep) => {
      lines.push(
        `### ${rep.workflowName} · ${rep.status.toUpperCase()} (${rep.passed}/${rep.total} 通过, ${rep.failed} 失败, ${rep.skipped} 跳过)`
      );
      lines.push(
        `- 执行时间：${formatFullDateTime(rep.executedAt)} · 耗时 ${(rep.durationMs / 1000).toFixed(1)}s${rep.repairRounds ? ` · 自动修复 ${rep.repairRounds} 轮` : ''}`
      );
      if (rep.summary) lines.push(`- 摘要：${rep.summary}`);
      if (rep.cases.length > 0) {
        rep.cases.forEach((c) => {
          lines.push(`  - [${c.status.toUpperCase()}] ${c.title}${c.error ? ` — ${c.error}` : ''}`);
        });
      }
      lines.push('');
    });
  } else {
    lines.push('_暂无测试执行报告。_');
    lines.push('');
  }

  if (run?.qaCritic?.finalE2eTestCode) {
    lines.push('### 终版隔离 E2E 盲测脚本');
    lines.push('```ts');
    lines.push(run.qaCritic.finalE2eTestCode.trim());
    lines.push('```');
    lines.push('');
  }

  lines.push('## 5. 全链路操作审计时间线');
  lines.push('');
  if (auditEvents.length > 0) {
    auditEvents.forEach((ev) => {
      lines.push(
        `- **${formatFullDateTime(ev.timestamp)}** · \`${ev.label}\` (${ev.actor}) — ${ev.detail}`
      );
    });
  } else {
    lines.push('_暂无审计事件记录。_');
  }
  lines.push('');

  return lines.join('\n');
}

export function RequirementReportModal({
  requirementId,
  onClose,
  onSuccessToast,
  onErrorToast,
}: RequirementReportModalProps) {
  const [report, setReport] = useState<RequirementReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('coding');
  const [copiedMd, setCopiedMd] = useState(false);
  const [copiedCoding, setCopiedCoding] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId)}/report`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `加载需求报告失败 (${res.status})`);
      }
      const typed = data as RequirementReportPayload;
      setReport(typed);
      // If coding output is absent but plan exists, keep coding tab selectable with clear hint, or auto-focus coding if present
      if (!typed.codingOutput && typed.run?.architect) {
        setActiveTab('coding');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载完整需求报告失败';
      setError(msg);
      onErrorToast?.(msg, '报告加载失败');
    } finally {
      setLoading(false);
    }
  }, [requirementId, onErrorToast]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const markdownContent = useMemo(
    () => (report ? buildStandaloneMarkdownReport(report) : ''),
    [report]
  );

  const handleCopyMarkdown = async () => {
    if (!markdownContent) return;
    try {
      await navigator.clipboard.writeText(markdownContent);
      setCopiedMd(true);
      onSuccessToast?.('完整 Markdown 需求报告已复制到剪贴板', '已复制');
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      onErrorToast?.('当前浏览器环境不支持剪贴板写入', '复制失败');
    }
  };

  const handleCopyCodingOutput = async () => {
    if (!report?.codingOutput?.content) return;
    try {
      await navigator.clipboard.writeText(report.codingOutput.content);
      setCopiedCoding(true);
      setTimeout(() => setCopiedCoding(false), 1800);
    } catch {
      onErrorToast?.('复制 Coding Agent 输出失败', '复制失败');
    }
  };

  const handleDownloadMarkdown = () => {
    if (!markdownContent || !report) return;
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `requirement-report-${report.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const run = report?.run ?? null;
  const job = report?.job ?? null;
  const title = run?.prdTitle || job?.prdTitle || requirementId;
  const checkedSet = useMemo(
    () => new Set(run?.checkedCriteriaIds ?? []),
    [run?.checkedCriteriaIds]
  );
  const totalCriteria = useMemo(
    () => (run?.architect.tasks ?? []).reduce((sum, t) => sum + t.acceptanceCriteria.length, 0),
    [run?.architect.tasks]
  );
  const planTokens = run?.planTokenUsage?.totalTokens ?? job?.tokenUsage?.totalTokens ?? 0;
  const codingTokens =
    report?.codingOutput?.tokenUsage?.totalTokens ??
    report?.testReports[0]?.tokenUsage?.totalTokens ??
    0;
  const combinedTokens = planTokens + codingTokens;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`完整需求报告：${title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1060px] max-h-[90vh] flex flex-col rounded-lg border border-[#30363D] bg-[#0D1117] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-[#30363D] bg-[#161B22] flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-4 w-4 text-[#58A6FF] shrink-0" />
              <h2 className="text-[16px] font-semibold text-[#F0F6FC] truncate">
                {title}
              </h2>
              <span className="font-mono text-[11px] text-[#8B949E] shrink-0">
                {requirementId}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#8B949E] tabular-nums">
              <span>{run?.repoFullName || job?.repoFullName || '—'}</span>
              {run?.draftPr?.branchName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-[#58A6FF]">
                    <GitBranch className="h-3 w-3" />
                    {run.draftPr.branchName}
                  </span>
                </>
              )}
              {combinedTokens > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#A371F7]">
                    算力 {formatTokenCount(combinedTokens)} Tokens
                  </span>
                </>
              )}
              {report?.generatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>生成于 {formatFullDateTime(report.generatedAt)}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!report || loading}
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors"
            >
              {copiedMd ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#3FB950]" />
                  <span>已复制 MD</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>复制 Markdown</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={!report || loading}
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>导出 .md</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭需求报告"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#30363D] bg-[#21262D] text-[#8B949E] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="px-5 pt-2.5 border-b border-[#30363D] bg-[#161B22]/60 flex items-center gap-5 overflow-x-auto">
          {(
            [
              {
                id: 'coding',
                label: 'Coding Agent 最终回复',
                badge: report?.codingOutput ? '已采集' : '待生成',
              },
              {
                id: 'plan',
                label: 'PRD 与规划方案',
                badge: run?.architect ? `${run.architect.tasks.length} 任务` : '—',
              },
              {
                id: 'tests',
                label: '盲测与验证报告',
                badge: `${report?.testReports.length ?? 0}`,
              },
              {
                id: 'timeline',
                label: '发布与审计时间线',
                badge: `${report?.auditEvents.length ?? 0}`,
              },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`pb-2.5 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  active
                    ? 'border-[#F78166] text-[#F0F6FC]'
                    : 'border-transparent text-[#8B949E] hover:text-[#C9D1D9]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                  ({tab.badge})
                </span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-[13px] text-[#8B949E]">
              <Loader2 className="h-5 w-5 animate-spin text-[#58A6FF]" />
              <span>正在汇总完整需求报告与 Coding Agent 交付输出…</span>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 p-4 text-[13px] text-[#FFDCD7] flex items-start gap-2.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#F85149]" />
              <span>{error}</span>
            </div>
          ) : report ? (
            <>
              {/* TAB 1: Coding Agent Final Delivery Output */}
              {activeTab === 'coding' && (
                <div className="space-y-4">
                  {/* Delivery Summary Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-md border border-[#30363D] bg-[#161B22] p-3">
                      <div className="text-[11px] text-[#8B949E]">Coding Agent 模型</div>
                      <div className="mt-1 font-mono text-[12px] font-medium text-[#F0F6FC] truncate">
                        {report.codingOutput?.model || job?.agyModel || 'VPS AGY'}
                      </div>
                    </div>
                    <div className="rounded-md border border-[#30363D] bg-[#161B22] p-3">
                      <div className="text-[11px] text-[#8B949E]">最近交付 Commit</div>
                      <div className="mt-1 font-mono text-[12px] font-medium text-[#58A6FF]">
                        {report.codingOutput?.commitSha
                          ? report.codingOutput.commitSha.slice(0, 7)
                          : run?.mergedRelease?.mergeCommitSha
                            ? run.mergedRelease.mergeCommitSha.slice(0, 7)
                            : '—'}
                      </div>
                    </div>
                    <div className="rounded-md border border-[#30363D] bg-[#161B22] p-3">
                      <div className="text-[11px] text-[#8B949E]">自动修复反馈轮次</div>
                      <div className="mt-1 font-mono text-[12px] font-medium text-[#F0F6FC] tabular-nums">
                        {report.codingOutput?.repairRounds !== undefined
                          ? `${report.codingOutput.repairRounds} 轮`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-md border border-[#30363D] bg-[#161B22] p-3">
                      <div className="text-[11px] text-[#8B949E]">Token 消耗（规划 / 编码）</div>
                      <div className="mt-1 font-mono text-[12px] font-medium text-[#A371F7] tabular-nums">
                        {combinedTokens > 0
                          ? `${formatTokenCount(planTokens)} / ${formatTokenCount(codingTokens)}`
                          : '待采集'}
                      </div>
                    </div>
                  </div>

                  {/* Coding Agent Final Chat Window Delivery Card */}
                  <div className="rounded-xl border border-[#2A3548] bg-[#0D121D] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#253042] bg-[#141B28] flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={STUDIO_IMAGES.coder}
                          alt="陈汐 — Coding Agent 工程师"
                          referrerPolicy="no-referrer"
                          className="h-8 w-8 rounded-lg object-cover border border-[#34D399]/40 bg-[#1B2433] shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-[#F8FAFC]">
                            <MessageSquare className="h-3.5 w-3.5 text-[#34D399] shrink-0" />
                            <span>陈汐 · Coding Agent 聊天窗口最终回复</span>
                          </div>
                          <div className="text-[11px] font-mono text-[#8E9DB5]">
                            仅展示任务完成时发送给用户的最终交付说明（非 Actions 终端日志）
                            {report.codingOutput?.capturedAt && (
                              <span> · {formatFullDateTime(report.codingOutput.capturedAt)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {report.codingOutput?.actionsUrl && (
                          <a
                            href={report.codingOutput.actionsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-[#38BDF8] hover:underline whitespace-nowrap"
                          >
                            <span>查看原始 Actions #{report.codingOutput.actionsRunId}</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {report.codingOutput?.content && (
                          <button
                            type="button"
                            onClick={handleCopyCodingOutput}
                            className="inline-flex items-center gap-1 rounded-md border border-[#2D384D] bg-[#1B2230] px-2.5 py-1 text-[11px] text-[#CBD5E1] hover:bg-[#253044] hover:text-[#F8FAFC] whitespace-nowrap"
                          >
                            {copiedCoding ? (
                              <>
                                <Check className="h-3 w-3 text-[#34D399]" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>复制回复</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {report.codingOutput?.content ? (
                      <div className="p-4 sm:p-5 bg-[#0B0F18]">
                        <div className="rounded-xl border border-[#263246] bg-[#131A27] p-4 sm:p-5 shadow-inner">
                          <pre className="text-[13px] leading-relaxed text-[#E8EEF7] whitespace-pre-wrap break-words font-sans max-h-[460px] overflow-y-auto">
                            {report.codingOutput.content}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center space-y-2 text-[13px] text-[#94A3B8]">
                        <div>本次运行未捕获到 Coding Agent 发送到聊天窗口的最终总结消息。</div>
                        <div className="text-[12px] text-[#64748B]">
                          原始 GitHub Actions 执行日志请点击右上角 Actions 链接查看；新一次 VPS AGY 编码完成后，Agent 的最终聊天答复会自动归档于此。
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: Full PRD & Architecture Plan */}
              {activeTab === 'plan' && (
                <div className="space-y-5">
                  <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[13px] font-semibold text-[#F0F6FC]">原始 PRD 需求正文</h3>
                      {run?.planUpdatedAt && (
                        <span className="font-mono text-[11px] text-[#58A6FF]">
                          规划已人工修订 · {formatFullDateTime(run.planUpdatedAt)}
                        </span>
                      )}
                    </div>
                    <pre className="text-[12.5px] leading-relaxed text-[#C9D1D9] whitespace-pre-wrap break-words font-sans bg-[#0D1117] border border-[#21262D] rounded p-3.5">
                      {run?.prdContent || job?.prdContent || '（暂无正文）'}
                    </pre>
                  </div>

                  {run?.architect ? (
                    <>
                      <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 space-y-3">
                        <h3 className="text-[13px] font-semibold text-[#F0F6FC]">技术架构与决策</h3>
                        <p className="text-[12.5px] text-[#C9D1D9] leading-relaxed whitespace-pre-line">
                          {run.architect.architectureSummary}
                        </p>
                        {run.architect.techDecisions.length > 0 && (
                          <ul className="pt-2 border-t border-[#21262D] space-y-1.5 text-[12px] text-[#C9D1D9]">
                            {run.architect.techDecisions.map((d, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className="font-mono text-[11px] text-[#58A6FF] mt-0.5 tabular-nums">
                                  0{idx + 1}.
                                </span>
                                <span>{d}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {run.architect.apiContracts.length > 0 && (
                        <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                          <div className="px-4 py-2.5 border-b border-[#30363D] text-[13px] font-semibold text-[#F0F6FC]">
                            公开接口契约 ({run.architect.apiContracts.length})
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-[12px]">
                              <thead>
                                <tr className="border-b border-[#30363D] bg-[#0D1117] text-[#8B949E]">
                                  <th className="py-2 px-3 font-medium">接口</th>
                                  <th className="py-2 px-3 font-medium">职责</th>
                                  <th className="py-2 px-3 font-medium">请求</th>
                                  <th className="py-2 px-3 font-medium">响应</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#21262D]">
                                {run.architect.apiContracts.map((api) => (
                                  <tr key={api.id}>
                                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                                      <span className="text-[#58A6FF] font-semibold mr-1.5">
                                        {api.method}
                                      </span>
                                      <span className="text-[#F0F6FC]">{api.path}</span>
                                    </td>
                                    <td className="py-2.5 px-3 text-[#C9D1D9]">{api.summary}</td>
                                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#8B949E]">
                                      {api.requestSchema}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#8B949E]">
                                      {api.responseSchema}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-[#30363D] flex items-center justify-between text-[13px] font-semibold text-[#F0F6FC]">
                          <span>原子任务与验收标准 ({run.architect.tasks.length})</span>
                          <span className="font-mono text-[11px] font-normal text-[#8B949E] tabular-nums">
                            已验收 {checkedSet.size}/{totalCriteria}
                          </span>
                        </div>
                        <div className="divide-y divide-[#21262D]">
                          {run.architect.tasks.map((task) => (
                            <div key={task.id} className="p-4 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[12px] font-semibold text-[#58A6FF]">
                                    {task.id}
                                  </span>
                                  <span className="text-[13px] font-semibold text-[#F0F6FC]">
                                    {task.title}
                                  </span>
                                </div>
                                <span className="font-mono text-[11px] text-[#8B949E]">
                                  {task.module} · 复杂度 {task.estimatedComplexity}
                                </span>
                              </div>
                              <p className="text-[12px] text-[#8B949E]">{task.description}</p>
                              <ul className="space-y-1 text-[12px] text-[#C9D1D9]">
                                {task.acceptanceCriteria.map((ac, idx) => {
                                  const isChecked = checkedSet.has(`${task.id}::${idx}`);
                                  return (
                                    <li key={idx} className="flex items-start gap-2">
                                      <CheckCircle2
                                        className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                                          isChecked ? 'text-[#3FB950]' : 'text-[#6E7681]'
                                        }`}
                                      />
                                      <span className={isChecked ? 'text-[#F0F6FC]' : 'text-[#8B949E]'}>
                                        {ac}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-[#30363D] bg-[#161B22] p-6 text-center text-[13px] text-[#8B949E]">
                      该需求尚未完成架构规划，暂无任务拆解方案。
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Blind E2E & Verification Reports */}
              {activeTab === 'tests' && (
                <div className="space-y-5">
                  {report.testReports.length > 0 ? (
                    report.testReports.map((rep) => (
                      <div
                        key={rep.id}
                        className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-[#30363D] flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <ShieldCheck
                              className={`h-4 w-4 ${
                                rep.status === 'passed'
                                  ? 'text-[#3FB950]'
                                  : rep.status === 'partial'
                                    ? 'text-[#D29922]'
                                    : 'text-[#F85149]'
                              }`}
                            />
                            <span className="font-semibold text-[#F0F6FC]">{rep.workflowName}</span>
                            <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                              通过 {rep.passed} / 失败 {rep.failed} / 跳过 {rep.skipped}
                            </span>
                            {rep.repairRounds !== undefined && rep.repairRounds > 0 && (
                              <span className="font-mono text-[11px] text-[#58A6FF]">
                                · 自动修复 {rep.repairRounds} 轮
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 font-mono text-[11px] text-[#8B949E] tabular-nums">
                            <span>{formatFullDateTime(rep.executedAt)}</span>
                            {rep.actionsUrl && (
                              <a
                                href={rep.actionsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[#58A6FF] hover:underline"
                              >
                                <span>Actions</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="p-4 space-y-3">
                          <p className="text-[12px] text-[#C9D1D9]">{rep.summary}</p>
                          {rep.cases.length > 0 && (
                            <div className="rounded-md border border-[#30363D] divide-y divide-[#21262D] bg-[#0D1117]">
                              {rep.cases.map((tc, idx) => (
                                <div key={idx} className="px-3.5 py-2.5 text-[12px] space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {tc.status === 'passed' ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-[#3FB950] shrink-0" />
                                      ) : tc.status === 'failed' ? (
                                        <XCircle className="h-3.5 w-3.5 text-[#F85149] shrink-0" />
                                      ) : (
                                        <Clock className="h-3.5 w-3.5 text-[#8B949E] shrink-0" />
                                      )}
                                      <span className="text-[#F0F6FC] truncate">{tc.title}</span>
                                    </div>
                                    {tc.durationMs !== undefined && (
                                      <span className="font-mono text-[11px] text-[#8B949E] tabular-nums shrink-0">
                                        {(tc.durationMs / 1000).toFixed(2)}s
                                      </span>
                                    )}
                                  </div>
                                  {tc.error && (
                                    <pre className="text-[11px] font-mono text-[#FF7B72] whitespace-pre-wrap break-all pl-5">
                                      {tc.error}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-[#30363D] bg-[#161B22] p-8 text-center text-[13px] text-[#8B949E]">
                      暂无自动化盲测或构建验证报告。
                    </div>
                  )}

                  {run?.qaCritic?.finalE2eTestCode && (
                    <div className="rounded-md border border-[#30363D] bg-[#010409] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-[#30363D] bg-[#161B22] flex items-center gap-2 text-[12px] font-semibold text-[#F0F6FC]">
                        <FileCode2 className="h-3.5 w-3.5 text-[#58A6FF]" />
                        <span>终版只读 E2E 盲测脚本（Vault 隔离）</span>
                      </div>
                      <pre className="p-4 max-h-[280px] overflow-auto font-mono text-[11.5px] leading-relaxed text-[#C9D1D9]">
                        {run.qaCritic.finalE2eTestCode}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: Release Metadata & Audit Timeline */}
              {activeTab === 'timeline' && (
                <div className="space-y-4">
                  <div className="rounded-md border border-[#30363D] bg-[#161B22] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                    <div className="flex items-center justify-between gap-2 bg-[#0D1117] border border-[#21262D] rounded px-3 py-2">
                      <span className="text-[#8B949E] inline-flex items-center gap-1.5">
                        <GitPullRequest className="h-3.5 w-3.5 text-[#58A6FF]" />
                        GitHub PR
                      </span>
                      {run?.draftPr ? (
                        <a
                          href={run.draftPr.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[#58A6FF] hover:underline inline-flex items-center gap-1"
                        >
                          #{run.draftPr.prNumber}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-[#6E7681]">未创建</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 bg-[#0D1117] border border-[#21262D] rounded px-3 py-2">
                      <span className="text-[#8B949E] inline-flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-[#3FB950]" />
                        Preview 预览
                      </span>
                      {run?.previewDeployment?.url ? (
                        <a
                          href={run.previewDeployment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[#3FB950] hover:underline inline-flex items-center gap-1 truncate max-w-[220px]"
                        >
                          <span className="truncate">{run.previewDeployment.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[#6E7681]">未部署</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 bg-[#0D1117] border border-[#21262D] rounded px-3 py-2">
                      <span className="text-[#8B949E] inline-flex items-center gap-1.5">
                        <GitMerge className="h-3.5 w-3.5 text-[#A371F7]" />
                        合入主分支
                      </span>
                      {run?.mergedRelease ? (
                        <a
                          href={run.mergedRelease.commitUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[#AFF5B4] hover:underline inline-flex items-center gap-1"
                        >
                          {run.mergedRelease.baseBranch}@{run.mergedRelease.mergeCommitSha.slice(0, 7)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-[#6E7681]">未合入</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 bg-[#0D1117] border border-[#21262D] rounded px-3 py-2">
                      <span className="text-[#8B949E] inline-flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-[#58A6FF]" />
                        生产环境
                      </span>
                      {run?.productionDeployment?.url ? (
                        <a
                          href={run.productionDeployment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[#58A6FF] hover:underline inline-flex items-center gap-1 truncate max-w-[220px]"
                        >
                          <span className="truncate">{run.productionDeployment.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[#6E7681]">未上线</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[#30363D] flex items-center gap-2 text-[13px] font-semibold text-[#F0F6FC]">
                      <History className="h-4 w-4 text-[#58A6FF]" />
                      <span>全链路操作审计时间线 ({report.auditEvents.length})</span>
                    </div>
                    {report.auditEvents.length > 0 ? (
                      <div className="divide-y divide-[#21262D] bg-[#0D1117]">
                        {report.auditEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className="px-4 py-3 flex items-start justify-between gap-4 text-[12px]"
                          >
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5">
                                {ev.status === 'success' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-[#3FB950] shrink-0" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-[#F85149] shrink-0" />
                                )}
                                <span className="font-medium text-[#F0F6FC]">{ev.label}</span>
                                <span className="text-[#8B949E]">· {ev.actor}</span>
                              </div>
                              <div className="text-[#C9D1D9] break-words">{ev.detail}</div>
                            </div>
                            <span className="font-mono text-[11px] text-[#8B949E] tabular-nums shrink-0">
                              {formatFullDateTime(ev.timestamp)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-6 text-center text-[12px] text-[#8B949E]">
                        暂无审计记录。
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
