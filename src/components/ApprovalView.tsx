import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Globe,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type { PipelineRun } from '../types/autodev';
import type { TestExecutionReport } from '../lib/rsiEngine';
import { ensureReadOnlyTestHeader } from '../lib/specBuilder';
import { buildIterationArtifactPaths } from '../lib/iterationContext';
import { decideAgySessionPolicy } from '../lib/sessionReuse';

interface ApprovalViewProps {
  runs: PipelineRun[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onRunUpdated: (run: PipelineRun) => void;
  onGoToNewPrd: () => void;
  onGoToQuality?: () => void;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

export function ApprovalView({
  runs,
  selectedRunId,
  onSelectRun,
  onRunUpdated,
  onGoToNewPrd,
  onGoToQuality,
  onErrorToast,
  onSuccessToast,
}: ApprovalViewProps) {
  const activeRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;

  const [approvalNote, setApprovalNote] = useState(activeRun?.approvalNote ?? '');
  const [syncToGitHub, setSyncToGitHub] = useState(true);
  const [mergePrToMain, setMergePrToMain] = useState(true);
  const [autoReworkViaAgy, setAutoReworkViaAgy] = useState(true);
  const [forceFreshSession, setForceFreshSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [deployBranch, setDeployBranch] = useState(
    activeRun?.draftPr?.branchName || activeRun?.defaultBranch || 'main'
  );
  const [deployingPreview, setDeployingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deployingCf, setDeployingCf] = useState(false);
  const [deployFeedback, setDeployFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    actionsUrl?: string;
  } | null>(null);
  const [latestTestReport, setLatestTestReport] = useState<TestExecutionReport | null>(null);

  useEffect(() => {
    if (!activeRun) return;
    setApprovalNote(activeRun.approvalNote ?? '');
    setDeployBranch(activeRun.draftPr?.branchName || activeRun.defaultBranch || 'main');
    setPreviewError(null);
  }, [activeRun?.id, activeRun?.draftPr?.branchName]);

  useEffect(() => {
    if (!activeRun) {
      setLatestTestReport(null);
      return;
    }
    let cancelled = false;
    fetch('/api/rsi/state')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { testReports?: TestExecutionReport[] } | null) => {
        if (cancelled || !json?.testReports) return;
        const branch = activeRun.draftPr?.branchName;
        const matched =
          json.testReports.find((r) => r.pipelineRunId === activeRun.id) ??
          (branch ? json.testReports.find((r) => r.branch === branch) : undefined) ??
          json.testReports[0] ??
          null;
        setLatestTestReport(matched);
      })
      .catch(() => {
        // non-fatal
      });
    return () => {
      cancelled = true;
    };
  }, [activeRun?.id, activeRun?.draftPr?.branchName]);

  const allCriteria = useMemo(() => {
    if (!activeRun) return [];
    return activeRun.architect.tasks.flatMap((task) =>
      task.acceptanceCriteria.map((criterion, idx) => ({
        id: `${task.id}::${idx}`,
        taskId: task.id,
        taskTitle: task.title,
        text: criterion,
      }))
    );
  }, [activeRun]);

  const checkedSet = useMemo(
    () => new Set(activeRun?.checkedCriteriaIds ?? []),
    [activeRun?.checkedCriteriaIds]
  );

  const predictedSessionPolicy = useMemo(() => {
    if (!activeRun?.draftPr) return null;
    return decideAgySessionPolicy({
      targetBranch: activeRun.draftPr.branchName,
      lastAgySession: activeRun.lastAgySession,
      forceFresh: forceFreshSession,
    });
  }, [activeRun?.draftPr?.branchName, activeRun?.lastAgySession, forceFreshSession]);

  const handleToggleCriterion = async (criterionId: string) => {
    if (!activeRun) return;
    const nextSet = new Set(checkedSet);
    if (nextSet.has(criterionId)) {
      nextSet.delete(criterionId);
    } else {
      nextSet.add(criterionId);
    }
    const nextIds = Array.from(nextSet);

    onRunUpdated({ ...activeRun, checkedCriteriaIds: nextIds });

    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(activeRun.id)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkedCriteriaIds: nextIds }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.run) onRunUpdated(data.run);
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '保存核验勾选状态失败',
        '同步失败'
      );
    }
  };

  const handleDecision = async (decision: 'approved' | 'changes_requested') => {
    if (!activeRun) return;
    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(activeRun.id)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkedCriteriaIds: Array.from(checkedSet),
          decision,
          approvalNote: approvalNote.trim(),
          syncToGitHub: Boolean(syncToGitHub && activeRun.draftPr),
          mergePrToMain: Boolean(decision === 'approved' && mergePrToMain && activeRun.draftPr),
          autoReworkViaAgy: Boolean(
            decision === 'changes_requested' && autoReworkViaAgy && activeRun.draftPr
          ),
          forceFreshSession: Boolean(
            decision === 'changes_requested' && forceFreshSession
          ),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `提交审批失败 (${res.status})`);
      }
      if (data.run) {
        onRunUpdated(data.run);
      }

      if (decision === 'approved' && data.mergeResult && !data.mergeResult.merged) {
        const msg = `审批已记录，但合并 PR 失败：${data.mergeResult.error || '请检查冲突或分支保护规则'}`;
        setFeedback({ type: 'error', text: msg });
        onErrorToast(msg, 'PR 合并失败');
      } else if (
        decision === 'changes_requested' &&
        data.reworkResult &&
        !data.reworkResult.dispatched
      ) {
        const msg = `已退回修订，但自动派发 AGY 返工失败：${data.reworkResult.error || '请检查 Runner 与工作流配置'}`;
        setFeedback({ type: 'error', text: msg });
        onErrorToast(msg, '自动返工派发失败');
      } else {
        const mergeMsg =
          decision === 'approved' && data.mergeResult?.merged
            ? data.mergeResult.alreadyMerged
              ? `，PR 已合入 ${data.mergeResult.baseBranch || 'main'}`
              : `，已 Squash Merge 合入 ${data.mergeResult.baseBranch || 'main'}（${(data.mergeResult.mergeCommitSha || '').slice(0, 7)}）${data.mergeResult.branchDeleted ? '并自动清理特性分支' : ''}`
            : '';
        const sessionTag =
          data.reworkResult?.sessionMode === 'resume' && data.reworkResult?.resumeSessionId
            ? `（复用会话 ${data.reworkResult.resumeSessionId}）`
            : data.reworkResult?.dispatched
              ? '（全新会话）'
              : '';
        const reworkMsg =
          decision === 'changes_requested' && data.reworkResult?.dispatched
            ? `，已写入 ${data.reworkResult.feedbackFilePath} 并自动派发 VPS AGY 返工修复${sessionTag}`
            : '';
        const rsiMsg =
          decision === 'changes_requested' && data.rsiIncidentId
            ? '，并已进入 RSI 失败归因闭环'
            : '';
        const syncMsg = data.githubSync
          ? data.githubSync.synced
            ? '，已同步至 PR 评论。'
            : `（${data.githubSync.error || '未同步至 GitHub'}）`
          : '。';
        const text = `${decision === 'approved' ? '验收通过并批准上线' : '已退回修订'}${mergeMsg}${reworkMsg}${rsiMsg}${syncMsg}`;
        setFeedback({ type: 'success', text });
        onSuccessToast(text, decision === 'approved' ? '发布审批完成' : '已退回并进入 RSI 归因');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '审批提交失败';
      setFeedback({ type: 'error', text: msg });
      onErrorToast(msg, '审批提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectPreviewDeploy = async () => {
    if (!activeRun) return;
    setDeployingPreview(true);
    setPreviewError(null);
    try {
      const targetBranch =
        deployBranch.trim() || activeRun.draftPr?.branchName || activeRun.defaultBranch || 'main';
      const res = await fetch('/api/cloudflare/deploy-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: activeRun.id,
          repoFullName: activeRun.repoFullName,
          branchName: targetBranch,
          prNumber: activeRun.draftPr?.prNumber,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `预览部署失败 (${res.status})`);
      }
      if (data.run) {
        onRunUpdated(data.run);
      } else if (data.deployment) {
        onRunUpdated({ ...activeRun, previewDeployment: data.deployment });
      }
      if (data.deployment?.url) {
        onSuccessToast(data.deployment.url, '预览环境已就绪');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cloudflare Workers 预览部署失败';
      setPreviewError(msg);
      onErrorToast(msg, '预览部署失败');
    } finally {
      setDeployingPreview(false);
    }
  };

  const handleDispatchCloudflareDeploy = async () => {
    if (!activeRun) return;
    setDeployingCf(true);
    setDeployFeedback(null);
    try {
      const targetBranch =
        deployBranch.trim() || activeRun.draftPr?.branchName || activeRun.defaultBranch || 'main';
      const res = await fetch('/api/github/dispatch-deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: activeRun.repoFullName,
          targetBranch,
          baseBranch: activeRun.defaultBranch || 'main',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `触发部署失败 (${res.status})`);
      }
      const msg = `已派发部署任务至 ${data.targetBranch}`;
      setDeployFeedback({
        type: 'success',
        text: msg,
        actionsUrl: data.actionsUrl,
      });
      onSuccessToast(msg, '已触发 Actions 部署');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '触发 Cloudflare 部署失败';
      setDeployFeedback({ type: 'error', text: msg });
      onErrorToast(msg, '触发部署失败');
    } finally {
      setDeployingCf(false);
    }
  };

  if (!activeRun) {
    return (
      <div className="space-y-6">
        <div className="pb-4 border-b border-[#30363D]">
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC]">
            验收与上线审批
          </h1>
        </div>

        <div className="rounded-md border border-[#30363D] bg-[#161B22] p-12 text-center space-y-4">
          <div className="text-[15px] font-semibold text-[#F0F6FC]">
            暂无待验收的需求
          </div>
          <button
            type="button"
            onClick={onGoToNewPrd}
            className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>前往新建需求</span>
          </button>
        </div>
      </div>
    );
  }

  const readOnlyE2e = ensureReadOnlyTestHeader(
    activeRun.qaCritic.finalE2eTestCode,
    activeRun.id,
    activeRun.prdTitle
  );

  return (
    <div className="space-y-6">
      {/* Header + Run Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#30363D]">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#F0F6FC]">
          验收与上线审批
        </h1>

        <div className="flex items-center gap-3">
          <label htmlFor="approval-run-select" className="text-[12px] text-[#8B949E] whitespace-nowrap">
            当前需求
          </label>
          <select
            id="approval-run-select"
            value={activeRun.id}
            onChange={(e) => {
              onSelectRun(e.target.value);
              const next = runs.find((r) => r.id === e.target.value);
              setApprovalNote(next?.approvalNote ?? '');
              setDeployBranch(next?.draftPr?.branchName || next?.defaultBranch || 'main');
              setFeedback(null);
              setPreviewError(null);
            }}
            className="rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-1.5 text-[13px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none max-w-[280px]"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.prdTitle}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Overview Bar */}
      <div className="rounded-md border border-[#30363D] bg-[#161B22] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[15px] font-semibold text-[#F0F6FC]">{activeRun.prdTitle}</div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8B949E] font-mono tabular-nums">
            <span>{activeRun.repoFullName}</span>
            <span aria-hidden="true">·</span>
            <span>
              已核验 {checkedSet.size}/{allCriteria.length}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {activeRun.mergedRelease
                ? `已合入 ${activeRun.mergedRelease.baseBranch} (${activeRun.mergedRelease.mergeCommitSha.slice(0, 7)})`
                : activeRun.status === 'approved'
                  ? '已批准上线'
                  : activeRun.status === 'changes_requested'
                    ? '退回修订'
                    : activeRun.draftPr
                      ? `Draft PR #${activeRun.draftPr.prNumber}`
                      : '待建 PR'}
            </span>
          </div>
        </div>

        {activeRun.draftPr && (
          <a
            href={activeRun.draftPr.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-2 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-[#58A6FF]" />
            <span>GitHub PR #{activeRun.draftPr.prNumber}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Compact Automated Test Verification Summary */}
      <div className="rounded-md border border-[#30363D] bg-[#161B22] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-[12px] min-w-0">
          <Activity className="h-4 w-4 text-[#58A6FF] shrink-0" />
          <span className="font-semibold text-[#F0F6FC]">自动化测试校验</span>
          <span aria-hidden="true" className="text-[#6E7681]">·</span>
          {latestTestReport ? (
            <span className="font-mono tabular-nums text-[#C9D1D9]">
              <span className="text-[#3FB950]">{latestTestReport.passed} 通过</span>
              {' / '}
              <span className={latestTestReport.failed > 0 ? 'text-[#F85149]' : 'text-[#8B949E]'}>
                {latestTestReport.failed} 失败
              </span>
              {latestTestReport.passRate !== null && (
                <span className="ml-2 text-[#58A6FF]">({latestTestReport.passRate}%)</span>
              )}
              <span className="ml-2 text-[#8B949E]">· {latestTestReport.branch}</span>
            </span>
          ) : (
            <span className="text-[#8B949E]">
              尚未同步测试执行报告，退回修订时问题也将自动进入 RSI 归因闭环
            </span>
          )}
        </div>
        {onGoToQuality && (
          <button
            type="button"
            onClick={onGoToQuality}
            className="text-[12px] font-medium text-[#58A6FF] hover:underline whitespace-nowrap shrink-0"
          >
            查看测试看板与 RSI 规则
          </button>
        )}
      </div>

      {/* Online Acceptance Environment (Cloudflare Workers Preview URL) */}
      <section
        aria-label="在线验收环境"
        className="rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-3"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#F0F6FC]">
              <Globe className="h-4 w-4 text-[#3FB950] shrink-0" />
              <span>在线验收环境</span>
              {activeRun.previewDeployment?.isIsolatedPreview && (
                <span className="font-mono text-[11px] font-normal text-[#58A6FF]">
                  · 隔离预览（不影响生产）
                </span>
              )}
            </div>
            {activeRun.previewDeployment ? (
              <div className="space-y-1">
                <a
                  href={activeRun.previewDeployment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[13px] font-medium text-[#58A6FF] hover:underline break-all inline-block"
                >
                  {activeRun.previewDeployment.url}
                </a>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#8B949E]">
                  <span>Worker: {activeRun.previewDeployment.workerName}</span>
                  <span>分支: {activeRun.previewDeployment.branchName}</span>
                  {activeRun.previewDeployment.d1DatabaseName && (
                    <span className="inline-flex items-center gap-1">
                      <Database className="h-3 w-3 text-[#58A6FF]" />
                      D1: {activeRun.previewDeployment.d1DatabaseName}
                      {activeRun.previewDeployment.migrationsApplied ? ' (已迁移)' : ''}
                    </span>
                  )}
                  <span>
                    {new Date(activeRun.previewDeployment.deployedAt).toLocaleTimeString('zh-CN', {
                      hour12: false,
                    })}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-[#8B949E]">
                尚未生成在线验收环境（非主干分支将自动部署至独立 <code className="font-mono">-preview</code> Worker 与预览 D1）
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {activeRun.previewDeployment && (
              <a
                href={activeRun.previewDeployment.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] transition-colors whitespace-nowrap"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>打开验收页面</span>
              </a>
            )}
            <button
              type="button"
              disabled={deployingPreview}
              onClick={handleDirectPreviewDeploy}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-colors whitespace-nowrap disabled:opacity-50 ${
                activeRun.previewDeployment
                  ? 'border border-[#30363D] bg-[#21262D] text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC]'
                  : 'bg-[#238636] border border-[#3FB950]/30 text-[#F0F6FC] hover:bg-[#2EA043]'
              }`}
            >
              {deployingPreview ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>正在部署…</span>
                </>
              ) : (
                <>
                  <Cloud className="h-4 w-4" />
                  <span>
                    {activeRun.previewDeployment
                      ? '更新隔离预览环境'
                      : '一键部署隔离预览环境'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {deployingPreview && (
          <div
            role="status"
            className="rounded-md border border-[#58A6FF]/40 bg-[#1F6FEB]/10 px-3.5 py-2.5 text-[12px] text-[#79C0FF] flex items-center gap-2.5"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>
              正在拉取 <code className="font-mono">{deployBranch}</code> 并发布至 Cloudflare Workers…
            </span>
          </div>
        )}

        {previewError && (
          <div
            role="alert"
            className="rounded-md border border-[#F85149]/40 bg-[#F85149]/10 px-3.5 py-2.5 text-[12px] text-[#FFDCD7] whitespace-pre-wrap"
          >
            {previewError}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Acceptance Criteria Checklist */}
        <section
          aria-label="验收标准核对表"
          className="lg:col-span-7 rounded-md border border-[#30363D] bg-[#161B22] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-[#30363D] flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[#F0F6FC]">
              验收标准清单
            </h2>
            <span className="font-mono text-[12px] tabular-nums text-[#58A6FF]">
              {checkedSet.size}/{allCriteria.length}
            </span>
          </div>
          <div className="divide-y divide-[#21262D] max-h-[460px] overflow-y-auto bg-[#0D1117]">
            {allCriteria.map((item) => {
              const checked = checkedSet.has(item.id);
              return (
                <label
                  key={item.id}
                  className="flex items-start gap-3 px-5 py-3.5 cursor-pointer hover:bg-[#161B22] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleCriterion(item.id)}
                    className="mt-1 h-4 w-4 rounded border-[#30363D] bg-[#0D1117] accent-[#238636]"
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div
                      className={`text-[13px] ${
                        checked ? 'text-[#8B949E] line-through' : 'text-[#F0F6FC]'
                      }`}
                    >
                      {item.text}
                    </div>
                    <div className="text-[11px] text-[#8B949E] font-mono">
                      {item.taskId} · {item.taskTitle}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        {/* Approval Gate Form */}
        <section
          aria-label="上线审批决策"
          className="lg:col-span-5 rounded-md border border-[#30363D] bg-[#161B22] p-5 space-y-4"
        >
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#F0F6FC]">
            <ShieldCheck className="h-4 w-4 text-[#58A6FF]" />
            <span>上线审批</span>
          </div>

          <div>
            <label
              htmlFor="approval-note-input"
              className="block text-[12px] font-medium text-[#F0F6FC] mb-1.5"
            >
              审批备注
            </label>
            <textarea
              id="approval-note-input"
              rows={4}
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="输入发布说明或退回修改意见…"
              className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-2 text-[13px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
            />
          </div>

          {activeRun.mergedRelease && (
            <div className="rounded-md border border-[#3FB950]/40 bg-[#2EA043]/10 px-3.5 py-2.5 text-[12px] text-[#AFF5B4] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <GitMerge className="h-3.5 w-3.5 shrink-0 text-[#3FB950]" />
                <span className="truncate">
                  PR #{activeRun.mergedRelease.prNumber} 已合入{' '}
                  <code className="font-mono">{activeRun.mergedRelease.baseBranch}</code>（
                  <code className="font-mono">
                    {activeRun.mergedRelease.mergeCommitSha.slice(0, 7)}
                  </code>
                  ）
                  {activeRun.mergedRelease.branchDeleted ? ' · 已清理特性分支' : ''}
                </span>
              </div>
              <a
                href={activeRun.mergedRelease.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline shrink-0"
              >
                <span>Commit</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {activeRun.lastRework && !activeRun.mergedRelease && (
            <div className="rounded-md border border-[#D29922]/40 bg-[#D29922]/10 px-3.5 py-2.5 text-[12px] text-[#F2CC60] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {activeRun.lastRework.dispatched
                      ? `已派发 AGY 返工 · ${activeRun.lastRework.feedbackFilePath}${
                          activeRun.lastRework.sessionMode === 'resume' &&
                          activeRun.lastRework.resumeSessionId
                            ? `（复用会话 ${activeRun.lastRework.resumeSessionId}）`
                            : '（全新会话）'
                        }`
                      : `返工派发失败：${activeRun.lastRework.error || '未知错误'}`}
                  </span>
                </div>
                {activeRun.lastRework.actionsUrl && (
                  <a
                    href={activeRun.lastRework.actionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline shrink-0"
                  >
                    <span>Actions</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {activeRun.lastRework.sessionReason && (
                <div className="text-[11px] font-mono text-[#E3B341]/90 pl-5">
                  会话策略：{activeRun.lastRework.sessionReason}
                </div>
              )}
            </div>
          )}

          {activeRun.draftPr && (
            <div className="space-y-2">
              {!activeRun.mergedRelease && (
                <>
                  <label className="flex items-start gap-2 text-[12px] text-[#C9D1D9] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mergePrToMain}
                      onChange={(e) => setMergePrToMain(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded accent-[#238636]"
                    />
                    <span>
                      批准时合并 PR #{activeRun.draftPr.prNumber} 至{' '}
                      <code className="font-mono text-[#58A6FF]">
                        {activeRun.defaultBranch || 'main'}
                      </code>{' '}
                      并自动清理特性分支
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-[12px] text-[#C9D1D9] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoReworkViaAgy}
                      onChange={(e) => setAutoReworkViaAgy(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded accent-[#D29922]"
                    />
                    <span>
                      退回修订时在原需求分支{' '}
                      <code className="font-mono text-[#58A6FF]">
                        {activeRun.draftPr.branchName}
                      </code>{' '}
                      写入 <code className="font-mono text-[#58A6FF]">docs/revision-feedback.md</code> 并直接派发 VPS AGY 增量返工（不新建分支）
                    </span>
                  </label>
                  {autoReworkViaAgy && predictedSessionPolicy && (
                    <div className="ml-5 rounded border border-[#30363D] bg-[#0D1117] px-3 py-2 space-y-1.5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5 font-mono">
                        <span className="text-[#8B949E]">返工 AGY 会话策略：</span>
                        <span
                          className={
                            predictedSessionPolicy.mode === 'resume'
                              ? 'text-[#3FB950] font-semibold'
                              : 'text-[#58A6FF] font-semibold'
                          }
                        >
                          {predictedSessionPolicy.mode === 'resume'
                            ? `复用会话 ${predictedSessionPolicy.resumeSessionId}`
                            : '全新纯净会话'}
                        </span>
                      </div>
                      <p className="text-[#8B949E] leading-relaxed">
                        {predictedSessionPolicy.reason}
                      </p>
                      <label className="flex items-center gap-2 text-[#C9D1D9] cursor-pointer pt-0.5">
                        <input
                          type="checkbox"
                          checked={forceFreshSession}
                          onChange={(e) => setForceFreshSession(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-[#58A6FF]"
                        />
                        <span>强制重置全新 AGY Session（不复用历史上下文）</span>
                      </label>
                    </div>
                  )}
                </>
              )}
              <label className="flex items-center gap-2 text-[12px] text-[#8B949E] cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncToGitHub}
                  onChange={(e) => setSyncToGitHub(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-[#238636]"
                />
                <span>同步评论至 PR #{activeRun.draftPr.prNumber}</span>
              </label>
            </div>
          )}

          {feedback && (
            <div
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={`rounded-md border px-3.5 py-2.5 text-[12px] ${
                feedback.type === 'success'
                  ? 'border-[#3FB950]/40 bg-[#2EA043]/10 text-[#AFF5B4]'
                  : 'border-[#F85149]/40 bg-[#F85149]/10 text-[#FFDCD7]'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDecision('approved')}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-[#238636] border border-[#3FB950]/30 px-4 py-2 text-[13px] font-medium text-[#F0F6FC] hover:bg-[#2EA043] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : activeRun.draftPr && !activeRun.mergedRelease && mergePrToMain ? (
                <GitMerge className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <span>
                {activeRun.mergedRelease
                  ? '更新审批备注'
                  : activeRun.draftPr && mergePrToMain
                    ? `批准并合并至 ${activeRun.defaultBranch || 'main'}`
                    : '验收通过并批准上线'}
              </span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDecision('changes_requested')}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-2 text-[13px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>退回修订</span>
            </button>
          </div>

          {/* Actions Workflow Deploy */}
          <div className="pt-4 border-t border-[#30363D] space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#F0F6FC]">
              <Cloud className="h-4 w-4 text-[#58A6FF]" />
              <span>Actions 部署到 Cloudflare</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={deployBranch}
                onChange={(e) => setDeployBranch(e.target.value)}
                aria-label="部署目标分支"
                placeholder="main 或 autodev/feat-*"
                className="flex-1 rounded-md border border-[#30363D] bg-[#0D1117] px-3 py-1.5 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
              />
              <button
                type="button"
                disabled={deployingCf}
                onClick={handleDispatchCloudflareDeploy}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3.5 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {deployingCf ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>派发中…</span>
                  </>
                ) : (
                  <>
                    <Cloud className="h-3.5 w-3.5" />
                    <span>触发 Actions 部署</span>
                  </>
                )}
              </button>
            </div>
            {deployFeedback && (
              <div
                role={deployFeedback.type === 'error' ? 'alert' : 'status'}
                className={`rounded-md border px-3.5 py-2.5 text-[12px] flex items-center justify-between gap-2 ${
                  deployFeedback.type === 'success'
                    ? 'border-[#3FB950]/40 bg-[#2EA043]/10 text-[#AFF5B4]'
                    : 'border-[#F85149]/40 bg-[#F85149]/10 text-[#FFDCD7]'
                }`}
              >
                <span>{deployFeedback.text}</span>
                {deployFeedback.actionsUrl && (
                  <a
                    href={deployFeedback.actionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline shrink-0"
                  >
                    <span>查看</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Read-Only E2E Contract Reference */}
      <section className="rounded-md border border-[#30363D] bg-[#010409] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#30363D] bg-[#161B22] flex items-center justify-between text-[12px]">
          <span className="font-mono font-medium text-[#F0F6FC]">
            {activeRun.draftPr?.e2eTestPath || buildIterationArtifactPaths(activeRun.id).e2eTestPath}
          </span>
          <span className="text-[#8B949E]">只读测试契约</span>
        </div>
        <pre className="p-4 max-h-[300px] overflow-auto font-mono text-[12px] leading-relaxed text-[#C9D1D9]">
          {readOnlyE2e}
        </pre>
      </section>
    </div>
  );
}
