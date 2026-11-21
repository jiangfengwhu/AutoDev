import type {
  AnalysisJob,
  GitHubActionRun,
  OpenAutodevPrSummary,
  PipelineRun,
  RepoContextSnapshot,
  SingleTaskLockReason,
  SingleTaskLockStatus,
} from '../types/autodev';

export interface IterationArtifactPaths {
  specJsonPath: string;
  prdMdPath: string;
  archivedSpecPath: string;
  archivedPrdPath: string;
  e2eTestPath: string;
  e2eVaultPath: string;
  e2eVaultMetaPath: string;
}

export function sanitizeIterationSlug(runId: string): string {
  const cleaned = runId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'iteration';
}

export function buildIterationArtifactPaths(runId: string): IterationArtifactPaths {
  const slug = sanitizeIterationSlug(runId);
  return {
    specJsonPath: 'docs/spec.json',
    prdMdPath: 'docs/prd.md',
    archivedSpecPath: `docs/iterations/${slug}-spec.json`,
    archivedPrdPath: `docs/iterations/${slug}-prd.md`,
    e2eTestPath: `tests/e2e/${slug}.spec.ts`,
    e2eVaultPath: `.autodev-e2e-vault/${slug}/e2e.spec.ts`,
    e2eVaultMetaPath: `.autodev-e2e-vault/${slug}/meta.json`,
  };
}

export function buildPreviewResourceNames(
  prodWorkerName: string,
  prodD1Name?: string
): {
  previewWorkerName: string;
  previewD1Name?: string;
} {
  const cleanWorker = prodWorkerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'app';

  const previewWorkerName = cleanWorker.endsWith('-preview')
    ? cleanWorker
    : `${cleanWorker}-preview`;

  if (!prodD1Name || !prodD1Name.trim()) {
    return { previewWorkerName };
  }

  const cleanD1 = prodD1Name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const previewD1Name = cleanD1.endsWith('-preview')
    ? cleanD1
    : `${cleanD1}-preview`;

  return { previewWorkerName, previewD1Name };
}

export function evaluateSingleTaskLock(input: {
  runningAnalysisJob?: { id: string; prdTitle: string } | null;
  openAutodevPrs: OpenAutodevPrSummary[];
  activeActionRuns: Array<{ id: number; name: string; headBranch: string; htmlUrl: string }>;
  repoContext?: RepoContextSnapshot | null;
  checkedAt?: string;
}): SingleTaskLockStatus {
  const reasons: SingleTaskLockReason[] = [];

  if (input.runningAnalysisJob) {
    reasons.push({
      kind: 'analysis_running',
      title: `后台正在分析需求「${input.runningAnalysisJob.prdTitle}」`,
      detail: '请等待当前三智能体分析完成后再发起下一轮迭代。',
    });
  }

  if (input.activeActionRuns.length > 0) {
    const firstRun = input.activeActionRuns[0];
    reasons.push({
      kind: 'actions_running',
      title: `VPS Runner 正在执行「${firstRun.name}」`,
      detail: `分支 ${firstRun.headBranch} 正在运行中（共 ${input.activeActionRuns.length} 个活跃工作流），需等待结束或手动取消。`,
      url: firstRun.htmlUrl,
    });
  }

  if (input.openAutodevPrs.length > 0) {
    const firstPr = input.openAutodevPrs[0];
    reasons.push({
      kind: 'open_pr',
      title: `存在未合入的迭代 PR #${firstPr.number}（${firstPr.title}）`,
      detail: `分支 ${firstPr.headBranch} 尚未合入 ${firstPr.baseBranch}。为保证下一轮迭代基于最新 main 上下文，请先验收合并或关闭该 PR。`,
      url: firstPr.htmlUrl,
      prNumber: firstPr.number,
      branchName: firstPr.headBranch,
    });
  }

  return {
    locked: reasons.length > 0,
    reasons,
    openAutodevPrs: input.openAutodevPrs,
    activeActionCount: input.activeActionRuns.length,
    runningAnalysisJobId: input.runningAnalysisJob?.id,
    repoContext: input.repoContext ?? undefined,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

export function formatRepoContextForPrompt(
  snapshot: RepoContextSnapshot,
  audience: 'architect' | 'qa'
): string {
  if (snapshot.isEmptyRepo) {
    return [
      '=== 目标仓库实时代码上下文 ===',
      `仓库 ${snapshot.repoFullName} (${snapshot.branch}) 当前为空仓库（首次从零构建）。`,
    ].join('\n');
  }

  const lines: string[] = [
    `=== 目标仓库实时代码上下文（${snapshot.repoFullName}@${snapshot.branch} · commit ${snapshot.headSha.slice(0, 7)}）===`,
    `说明：该仓库已包含 ${snapshot.totalFiles} 个文件，请基于现有代码做**增量迭代**，严禁破坏已有功能、既有数据库迁移或历史回归测试。`,
  ];

  if (snapshot.existingE2eTests.length > 0) {
    lines.push(
      '',
      `已有回归测试文件（严禁覆盖或破坏，本轮新测试将归档到独立文件）：`,
      ...snapshot.existingE2eTests.map((p) => `- ${p}`)
    );
  }

  if (snapshot.existingMigrations.length > 0) {
    lines.push(
      '',
      `已有 D1 数据库迁移脚本（如需改表，必须按递增编号新增迁移文件，严禁修改旧迁移）：`,
      ...snapshot.existingMigrations.map((m) => `- ${m.path}`)
    );
    if (audience === 'architect') {
      for (const m of snapshot.existingMigrations.slice(-3)) {
        lines.push(`--- ${m.path} ---`, m.snippet);
      }
    }
  }

  if (snapshot.previousSpecSummary) {
    lines.push('', '上一轮已合入的规格摘要（docs/spec.json）：', snapshot.previousSpecSummary);
  }

  if (audience === 'architect') {
    if (snapshot.packageJsonSnippet) {
      lines.push('', '当前 package.json：', snapshot.packageJsonSnippet);
    }
    if (snapshot.wranglerConfigSnippet) {
      lines.push('', '当前 wrangler 配置：', snapshot.wranglerConfigSnippet);
    }
    if (snapshot.fileTree.length > 0) {
      lines.push('', '当前仓库关键文件树（已过滤依赖目录）：', ...snapshot.fileTree.map((p) => `- ${p}`));
    }
  } else {
    // QA Spec / Critic only receive public structure & existing contracts/routes, preserving implementation isolation
    const publicPaths = snapshot.fileTree.filter(
      (p) =>
        p.startsWith('docs/') ||
        p.startsWith('tests/') ||
        p.startsWith('migrations/') ||
        p === 'wrangler.toml' ||
        p === 'wrangler.jsonc'
    );
    if (publicPaths.length > 0) {
      lines.push('', '现有公开契约/测试/迁移文件清单：', ...publicPaths.map((p) => `- ${p}`));
    }
  }

  return lines.join('\n');
}

export function buildRevisionFeedbackMarkdown(params: {
  runId: string;
  prdTitle: string;
  prNumber?: number;
  approvalNote: string;
  uncheckedCriteria: string[];
  timestamp?: string;
}): string {
  const ts = params.timestamp || new Date().toISOString();
  const uncheckedSection =
    params.uncheckedCriteria.length > 0
      ? params.uncheckedCriteria.map((c) => `- [ ] ${c}`).join('\n')
      : '- （审批人未勾选具体未通过项，请重点依据上方退回意见排查修复）';

  return [
    `# AutoDev 验收退回修订指令`,
    ``,
    `- **Run ID**: \`${params.runId}\``,
    `- **需求标题**: ${params.prdTitle}`,
    ...(params.prNumber ? [`- **PR 编号**: #${params.prNumber}`] : []),
    `- **退回时间**: ${ts}`,
    ``,
    `## 审批人修改意见（必须逐项修复）`,
    ``,
    params.approvalNote.trim() || '请重新核验功能实现、接口返回与前端交互体验，确保全部验收标准通过。',
    ``,
    `## 当前尚未勾选通过的验收项`,
    ``,
    uncheckedSection,
    ``,
    `## 返工执行要求`,
    `1. 优先修复上述退回意见及未通过的验收项，切勿破坏既有已通过的功能。`,
    `2. 严格依据需求规格与接口契约修复实现，不得篡改或绕过验收流程。`,
    `3. 修复后确保构建、类型检查通过，并直接提交推送到当前特性分支。`,
    ``,
  ].join('\n');
}

/**
 * Strictly filters GitHub Actions runs to only those belonging to the currently selected requirement.
 */
export function filterActionRunsForPipelineRun(
  actionRuns: GitHubActionRun[],
  activeRun: PipelineRun | null,
  relatedJobs: AnalysisJob[] = []
): GitHubActionRun[] {
  if (!activeRun) return [];

  const targetBranch = activeRun.draftPr?.branchName?.trim();
  const prNumber = activeRun.draftPr?.prNumber;
  const linkedPlanActionRunIds = new Set<number>();
  const linkedJobIds = new Set<string>();

  for (const job of relatedJobs) {
    if (job.runId === activeRun.id || job.run?.id === activeRun.id) {
      linkedJobIds.add(job.id);
      if (job.planActionsRunId) {
        linkedPlanActionRunIds.add(job.planActionsRunId);
      }
    }
  }

  return actionRuns.filter((ar) => {
    if (ar.pipelineRunId && ar.pipelineRunId === activeRun.id) return true;
    if (ar.jobId && linkedJobIds.has(ar.jobId)) return true;
    if (linkedPlanActionRunIds.has(ar.id)) return true;
    if (prNumber && ar.prNumber && ar.prNumber === prNumber) return true;
    if (targetBranch) {
      if (ar.targetBranch && ar.targetBranch === targetBranch) return true;
      if (ar.headBranch && ar.headBranch === targetBranch) return true;
    }
    return false;
  });
}
