import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskLayers,
  generateBranchName,
  parseRepoFullName,
  validatePrdInput,
} from './taskGraph';
import { computeLineDiff } from './lineDiff';
import {
  buildBootstrapReadmeContent,
  buildPrArtifacts,
  ensureReadOnlyTestHeader,
  isEmptyGitHubRepoError,
} from './specBuilder';
import type { AtomicTask, PipelineRun } from '../types/autodev';

test('parseRepoFullName accepts valid owner/repo slugs and rejects invalid ones', () => {
  assert.deepEqual(parseRepoFullName('acme-org/checkout-api'), {
    owner: 'acme-org',
    name: 'checkout-api',
    fullName: 'acme-org/checkout-api',
  });
  assert.equal(parseRepoFullName('invalid-no-slash'), null);
  assert.equal(parseRepoFullName('a/b/c'), null);
  assert.equal(parseRepoFullName('../secret'), null);
  assert.equal(parseRepoFullName('   '), null);
});

test('validatePrdInput enforces non-empty repo, title, and non-empty PRD content without 30-char limit', () => {
  const emptyRes = validatePrdInput({
    repoFullName: '',
    prdTitle: 'ab',
    prdContent: '   ',
  });
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.errors.repoFullName);
  assert.ok(emptyRes.errors.prdTitle);
  assert.ok(emptyRes.errors.prdContent);

  const shortPrdRes = validatePrdInput({
    repoFullName: 'acme/billing-web',
    prdTitle: '深色模式',
    prdContent: '加一个夜间模式开关',
  });
  assert.equal(shortPrdRes.valid, true);
  assert.deepEqual(shortPrdRes.errors, {});

  const validRes = validatePrdInput({
    repoFullName: 'acme/billing-web',
    prdTitle: '支持多币种发票导出',
    prdContent:
      '用户可以在账单详情页选择 USD/EUR/CNY 币种生成 PDF 发票，系统需在 3 秒内返回下载链接并记录审计日志。',
  });
  assert.equal(validRes.valid, true);
  assert.deepEqual(validRes.errors, {});
});

test('generateBranchName produces UTC timestamped autodev feature branch', () => {
  const fixedDate = new Date('2026-11-18T08:05:09Z');
  assert.equal(generateBranchName(fixedDate), 'autodev/feat-20261118-080509');
});

test('buildTaskLayers orders DAG waves topologically and flags cycles/missing deps', () => {
  const dagTasks: AtomicTask[] = [
    {
      id: 'T1',
      title: 'Schema migration',
      module: 'db',
      description: 'Add invoice table',
      dependsOn: [],
      acceptanceCriteria: ['Migration runs idempotently'],
      estimatedComplexity: 'S',
    },
    {
      id: 'T2',
      title: 'API endpoint',
      module: 'api',
      description: 'POST /invoices',
      dependsOn: ['T1'],
      acceptanceCriteria: ['Returns 201'],
      estimatedComplexity: 'M',
    },
    {
      id: 'T3',
      title: 'Frontend button',
      module: 'web',
      description: 'Export button',
      dependsOn: ['T2', 'T_MISSING'],
      acceptanceCriteria: ['Downloads PDF'],
      estimatedComplexity: 'S',
    },
  ];

  const layered = buildTaskLayers(dagTasks);
  assert.equal(layered.hasCycle, false);
  assert.equal(layered.layers.length, 3);
  assert.deepEqual(
    layered.layers.map((w) => w.map((t) => t.id)),
    [['T1'], ['T2'], ['T3']]
  );
  assert.deepEqual(layered.missingDependencies, [
    { taskId: 'T3', missingDepId: 'T_MISSING' },
  ]);

  const cyclicTasks: AtomicTask[] = [
    { ...dagTasks[0], id: 'A', dependsOn: ['B'] },
    { ...dagTasks[1], id: 'B', dependsOn: ['A'] },
  ];
  const cycleRes = buildTaskLayers(cyclicTasks);
  assert.equal(cycleRes.hasCycle, true);
  assert.deepEqual(cycleRes.cycleTaskIds.sort(), ['A', 'B']);
});

test('computeLineDiff accurately detects added, removed, and unchanged lines', () => {
  const before = ['import { test } from "@playwright/test";', 'test("basic", () => {});'].join(
    '\n'
  );
  const after = [
    'import { test, expect } from "@playwright/test";',
    'test("basic", () => {});',
    'test("boundary", () => { expect(1).toBe(1); });',
  ].join('\n');

  const diff = computeLineDiff(before, after);
  assert.equal(diff.stats.unchanged, 1);
  assert.equal(diff.stats.removed, 1);
  assert.equal(diff.stats.added, 2);
  assert.equal(
    diff.lines.filter((l) => l.type === 'added').some((l) => l.content.includes('boundary')),
    true
  );
});

test('buildPrArtifacts serializes docs/spec.json, docs/prd.md, and read-only tests/e2e.spec.ts', () => {
  const sampleRun: PipelineRun = {
    id: 'run-001',
    createdAt: '2026-11-18T10:00:00.000Z',
    repoFullName: 'acme/checkout',
    defaultBranch: 'main',
    prdTitle: '优惠券核销与防重放',
    prdContent: '用户输入优惠码后系统校验有效期与单用户使用上限，并在并发提交下保证幂等扣减。',
    status: 'analyzed',
    architect: {
      ambiguities: [
        {
          id: 'AMB-1',
          severity: 'high',
          title: '退款后优惠券是否返还未定义',
          detail: 'PRD 未说明订单全额退款时优惠券配额是否恢复。',
          clarificationSuggestion: '明确仅未过期优惠券在全额退款后自动退回。',
        },
      ],
      architectureSummary: '采用幂等键 + 原子扣减事务设计。',
      techDecisions: ['使用 Idempotency-Key HTTP Header'],
      apiContracts: [
        {
          id: 'API-1',
          method: 'POST',
          path: '/api/coupons/redeem',
          summary: '核销优惠券',
          requestSchema: '{ code: string, orderId: string }',
          responseSchema: '{ redeemed: boolean, discountCents: number }',
          errorCodes: ['400', '409', '422'],
        },
      ],
      tasks: [
        {
          id: 'TASK-1',
          title: '实现优惠券核销接口',
          module: 'backend',
          description: '校验并原子扣减优惠券库存',
          dependsOn: [],
          acceptanceCriteria: ['重复提交返回 409', '过期券返回 422'],
          estimatedComplexity: 'M',
        },
      ],
    },
    qaSpec: {
      apiTestChecklist: [],
      e2eTestCode: 'test("redeem", async () => {});',
      coverageNotes: ['Covers happy path'],
    },
    qaCritic: {
      reviewSummary: '补充并发重复点击与非法字符输入用例。',
      findings: [
        {
          id: 'CRIT-1',
          category: 'concurrency',
          severity: 'high',
          issue: '缺少双击重复提交断言',
          recommendation: '并发触发两次提交并验证仅成功一次',
        },
      ],
      finalApiTestChecklist: [],
      finalE2eTestCode: 'import { test, expect } from "@playwright/test";\ntest("redeem", async () => { expect(true).toBe(true); });',
    },
  };

  const artifacts = buildPrArtifacts(sampleRun);
  assert.equal(artifacts.specJsonPath, 'docs/spec.json');
  assert.equal(artifacts.prdMdPath, 'docs/prd.md');
  assert.equal(artifacts.archivedSpecPath, 'docs/iterations/run-001-spec.json');
  assert.equal(artifacts.archivedPrdPath, 'docs/iterations/run-001-prd.md');
  assert.equal(artifacts.e2eTestPath, 'tests/e2e/run-001.spec.ts');
  assert.equal(artifacts.e2eVaultPath, '.autodev-e2e-vault/run-001/e2e.spec.ts');

  const parsedSpec = JSON.parse(artifacts.specJsonContent);
  assert.equal(parsedSpec.runId, 'run-001');
  assert.equal(parsedSpec.e2eTestPath, 'tests/e2e/run-001.spec.ts');
  assert.equal(parsedSpec.e2eVaultPath, '.autodev-e2e-vault/run-001/e2e.spec.ts');
  assert.equal(parsedSpec.blindE2eVerification, false);
  assert.equal(parsedSpec.archivedSpecPath, 'docs/iterations/run-001-spec.json');
  assert.equal(parsedSpec.tasks.length, 1);
  assert.ok(artifacts.prdMdContent.includes('退款后优惠券是否返还未定义'));
  assert.ok(artifacts.e2eTestContent.includes('AUTODEV-READONLY-TEST-CONTRACT'));
  assert.ok(artifacts.prBody.includes('TASK-1'));
  assert.ok(artifacts.prBody.includes('tests/e2e/run-001.spec.ts'), 'PR body should transparently expose committed E2E test path');

  // Idempotent read-only header
  const doubleWrapped = ensureReadOnlyTestHeader(
    artifacts.e2eTestContent,
    sampleRun.id,
    sampleRun.prdTitle
  );
  assert.equal(
    doubleWrapped.split('AUTODEV-READONLY-TEST-CONTRACT').length - 1,
    1
  );
});

test('isEmptyGitHubRepoError detects empty repo 409/404 errors and builds bootstrap README', () => {
  assert.equal(
    isEmptyGitHubRepoError('GitHub API 错误 (409): Git Repository is empty.'),
    true
  );
  assert.equal(
    isEmptyGitHubRepoError('GitHub API 错误 (404): Not Found'),
    true
  );
  assert.equal(
    isEmptyGitHubRepoError('GitHub API 错误 (401): Bad credentials'),
    false
  );

  const readme = buildBootstrapReadmeContent('jiangfengwhu', 'atd-v1');
  assert.ok(readme.includes('# atd-v1'));
  assert.ok(readme.includes('jiangfengwhu/atd-v1'));
});

test('buildAgyRunnerWorkflowYaml enforces direct-wait no-timeout self-push, blind E2E vault isolation, Gemini 4 + --mode, and valid runner script', async () => {
  const {
    AGY_AGENT_MODES,
    AGY_AVAILABLE_MODELS,
    AUTODEV_LIVE_LOG_ISSUE_TITLE,
    DEFAULT_AGY_MODE,
    DEFAULT_AGY_MODEL,
    buildAgyRunnerWorkflowYaml,
    buildCloudflareDeployWorkflowYaml,
    DEFAULT_CLOUDFLARE_TECH_STACK,
    FIXED_TARGET_REPO,
    resolveEffectiveTechStack,
  } = await import('./workflowBuilder');
  assert.equal(FIXED_TARGET_REPO.fullName, 'jiangfengwhu/atd-v1');
  assert.equal(DEFAULT_AGY_MODEL, 'gemini-4-neon-high');
  assert.equal(DEFAULT_AGY_MODE, 'auto');
  assert.ok(AGY_AVAILABLE_MODELS.some((m) => m.id === 'gemini-4-neon-high'));
  assert.ok(AGY_AVAILABLE_MODELS.some((m) => m.id === 'gemini-4-hydrogen-high'));
  assert.ok(AGY_AVAILABLE_MODELS.some((m) => m.id === 'claude-opus-5-5-high'));
  assert.ok(AGY_AGENT_MODES.some((m) => m.id === 'auto') && AGY_AGENT_MODES.some((m) => m.id === 'accept-edits'));

  const yaml = buildAgyRunnerWorkflowYaml('jiangfengwhu');
  assert.ok(yaml.includes('runs-on: [self-hosted, linux, x64, vps-agy]'));
  assert.ok(yaml.includes("github.actor == 'jiangfengwhu'"));
  assert.ok(yaml.includes('group: autodev-agy-single-queue'));
  assert.ok(yaml.includes('timeout-minutes: 180'));
  assert.ok(yaml.includes('agy_mode:'));
  assert.ok(yaml.includes('e2e_test_path:'));
  assert.ok(yaml.includes('revision_note:'));
  assert.ok(yaml.includes('uses: actions/checkout@v7'));
  assert.ok(yaml.includes("'--print=' + prompt"));
  assert.ok(!yaml.includes("'--print-timeout'"), 'Must NOT pass --print-timeout CLI arg on AGY coding runs');
  assert.ok(yaml.includes("args.push('--mode', requestedMode)"));
  assert.ok(yaml.includes("args.push('--conversation', resumeId)"));
  assert.ok(yaml.includes('issues: write'));
  assert.ok(yaml.includes('echo "Workspace CWD: $(pwd)"'));
  assert.ok(yaml.includes(AUTODEV_LIVE_LOG_ISSUE_TITLE));
  assert.ok(yaml.includes("<<'COMMENT_EOF'"));
  assert.ok(yaml.includes('--body-file /tmp/autodev-pr-summary.md'));
  assert.ok(!yaml.includes('BODY="### AutoDev'));

  // Verify embedded Direct-Wait & Transparent E2E Verification JS script has valid ESM syntax and core invariants
  const harnessMatch = yaml.match(/<<'BLIND_RUNNER_EOF'\n([\s\S]*?)\n\s*BLIND_RUNNER_EOF/);
  assert.ok(harnessMatch, 'Expected embedded AGY direct-wait runner script');
  const harnessCode = harnessMatch[1].replace(/^ {10}/gm, '');
  assert.ok(harnessCode.includes('process.cwd()'));
  assert.ok(harnessCode.includes('AUTODEV-LIVE-LOG:'));
  assert.ok(!harnessCode.includes('skip-worktree'), 'Must NOT hide tests/e2e with skip-worktree after removing blind isolation');
  assert.ok(!harnessCode.includes('hydrateVaultE2eTests'), 'Must NOT hydrate blind vault tests; E2E tests live transparently in repo');
  assert.ok(harnessCode.includes('const activeE2ePath ='), 'Must bind activeE2ePath from ACTIVE_E2E_PATH');
  assert.ok(!harnessCode.includes('e2eTestPath'), 'Must NOT reference undefined e2eTestPath identifier');
  assert.ok(harnessCode.includes('buildRepairFeedbackPrompt') && harnessCode.includes('while (verify && !verify.allPassed && repairRounds < maxRepairRounds)'), 'Must feed verification failures back to original AGY session for bounded root-cause auto-repair');
  assert.ok(harnessCode.includes('ev.result?.conversation_id') && yaml.includes('max_repair_rounds:'), 'Must capture nested conversation_id and expose max_repair_rounds input');
  assert.ok(harnessCode.includes('root-cause auto-repair'), 'Must guide AGY to triage application bug vs test script defect');
  assert.ok(harnessCode.includes('git push origin HEAD:'), 'Must instruct AGY to push directly and keep idempotent fallback');
  assert.ok(harnessCode.includes('detectAndResolveAgyCapabilities'), 'Must sync VPS agy models & agents');
  assert.ok(harnessCode.includes("'--output-format', 'stream-json'"));
  assert.ok(yaml.includes('npm ci --no-audit --no-fund'));
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const tmpPath = '/tmp/test-autodev-outer-harness-check.mjs';
  fs.writeFileSync(tmpPath, harnessCode, 'utf-8');
  try {
    execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }

  const def = resolveEffectiveTechStack('');
  assert.equal(def.isDefaultCloudflare, true);
  assert.equal(def.stack, DEFAULT_CLOUDFLARE_TECH_STACK);

  const custom = resolveEffectiveTechStack('Next.js + Supabase');
  assert.equal(custom.isDefaultCloudflare, false);
  assert.equal(custom.stack, 'Next.js + Supabase');

  const deployYaml = buildCloudflareDeployWorkflowYaml('jiangfengwhu');
  assert.ok(deployYaml.includes('runs-on: [self-hosted, linux, x64, vps-agy]'));
  assert.ok(deployYaml.includes("github.actor == 'jiangfengwhu'"));
  assert.ok(deployYaml.includes('group: autodev-cf-deploy-single-queue'));
  assert.ok(deployYaml.includes('d1 migrations apply'));
  assert.ok(deployYaml.includes('wrangler deploy'));
  assert.ok(deployYaml.includes('CLOUDFLARE_API_TOKEN'));
});

test('prdDraftStorage saves, loads, filters, and clears PRD drafts in StorageLike', async () => {
  const {
    PRD_DRAFT_STORAGE_KEY,
    clearPrdDraft,
    hasPrdDraftContent,
    loadPrdDraft,
    savePrdDraft,
  } = await import('./prdDraftStorage');

  const map = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };

  assert.equal(hasPrdDraftContent({ prdTitle: '  ', techStackHint: '', prdContent: '' }), false);
  assert.equal(loadPrdDraft(mockStorage), null);

  // Empty draft should not persist
  assert.equal(
    savePrdDraft(
      { repoFullName: 'jiangfengwhu/atd-v1', prdTitle: '', techStackHint: '', prdContent: '   ' },
      mockStorage
    ),
    null
  );
  assert.equal(map.has(PRD_DRAFT_STORAGE_KEY), false);

  // Valid draft persists and restores accurately
  const fixedNow = new Date('2026-11-19T08:00:00.000Z');
  const saved = savePrdDraft(
    {
      repoFullName: 'jiangfengwhu/atd-v1',
      prdTitle: '自动化草稿备份',
      techStackHint: 'Cloudflare D1',
      prdContent: '利用 localStorage 定期备份 PRD 草稿。',
    },
    mockStorage,
    fixedNow
  );
  assert.ok(saved);
  assert.equal(saved.savedAt, '2026-11-19T08:00:00.000Z');

  const loaded = loadPrdDraft(mockStorage, 'jiangfengwhu/atd-v1');
  assert.equal(loaded?.prdTitle, '自动化草稿备份');
  assert.equal(loaded?.techStackHint, 'Cloudflare D1');
  assert.equal(loaded?.prdContent, '利用 localStorage 定期备份 PRD 草稿。');
  assert.equal(loadPrdDraft(mockStorage, 'other/repo'), null);

  clearPrdDraft(mockStorage);
  assert.equal(loadPrdDraft(mockStorage), null);
});

test('iterationContext helpers isolate preview resources, evaluate single-task locks, and format prompts', async () => {
  const {
    buildIterationArtifactPaths,
    buildPreviewResourceNames,
    buildRevisionFeedbackMarkdown,
    evaluateSingleTaskLock,
    formatRepoContextForPrompt,
    sanitizeIterationSlug,
  } = await import('./iterationContext');

  assert.equal(sanitizeIterationSlug('Run_2026/11#01'), 'run-2026-11-01');
  assert.deepEqual(buildIterationArtifactPaths('run-iter-2'), {
    specJsonPath: 'docs/spec.json',
    prdMdPath: 'docs/prd.md',
    archivedSpecPath: 'docs/iterations/run-iter-2-spec.json',
    archivedPrdPath: 'docs/iterations/run-iter-2-prd.md',
    e2eTestPath: 'tests/e2e/run-iter-2.spec.ts',
    e2eVaultPath: '.autodev-e2e-vault/run-iter-2/e2e.spec.ts',
    e2eVaultMetaPath: '.autodev-e2e-vault/run-iter-2/meta.json',
  });

  // Preview resource isolation
  assert.deepEqual(buildPreviewResourceNames('atd-v1-app', 'atd-v1-db'), {
    previewWorkerName: 'atd-v1-app-preview',
    previewD1Name: 'atd-v1-db-preview',
  });
  assert.deepEqual(buildPreviewResourceNames('atd-v1-app-preview', 'atd-v1-db-preview'), {
    previewWorkerName: 'atd-v1-app-preview',
    previewD1Name: 'atd-v1-db-preview',
  });

  // Single-task serial lock evaluation
  const unlocked = evaluateSingleTaskLock({
    runningAnalysisJob: null,
    openAutodevPrs: [],
    activeActionRuns: [],
    checkedAt: '2026-11-19T00:00:00.000Z',
  });
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.reasons.length, 0);

  const locked = evaluateSingleTaskLock({
    runningAnalysisJob: { id: 'job-1', prdTitle: '订单退款' },
    openAutodevPrs: [
      {
        number: 12,
        title: '[AutoDev] 订单退款',
        headBranch: 'autodev/feat-20261119-010101',
        baseBranch: 'main',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/pull/12',
        draft: true,
        updatedAt: '2026-11-19T00:00:00.000Z',
      },
    ],
    activeActionRuns: [
      {
        id: 999,
        name: 'AutoDev VPS AGY Coding Agent',
        headBranch: 'autodev/feat-20261119-010101',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/999',
      },
    ],
  });
  assert.equal(locked.locked, true);
  assert.equal(locked.reasons.length, 3);
  assert.deepEqual(
    locked.reasons.map((r) => r.kind),
    ['analysis_running', 'actions_running', 'open_pr']
  );

  // Prompt context formatting differentiates architect vs qa audience
  const snapshot = {
    repoFullName: 'jiangfengwhu/atd-v1',
    branch: 'main',
    headSha: 'abcdef1234567890',
    fetchedAt: '2026-11-19T00:00:00.000Z',
    isEmptyRepo: false,
    totalFiles: 18,
    fileTree: ['src/index.ts', 'migrations/0001_init.sql', 'tests/e2e/run-1.spec.ts', 'wrangler.toml'],
    packageJsonSnippet: '{"name":"atd-v1"}',
    wranglerConfigSnippet: 'name = "atd-v1"',
    existingMigrations: [{ path: 'migrations/0001_init.sql', snippet: 'CREATE TABLE items (id TEXT);' }],
    existingE2eTests: ['tests/e2e/run-1.spec.ts'],
    previousSpecSummary: '{"prdTitle":"初始版"}',
  };
  const archPrompt = formatRepoContextForPrompt(snapshot, 'architect');
  assert.ok(archPrompt.includes('abcdef1'));
  assert.ok(archPrompt.includes('CREATE TABLE items'));
  assert.ok(archPrompt.includes('src/index.ts'));

  const qaPrompt = formatRepoContextForPrompt(snapshot, 'qa');
  assert.ok(qaPrompt.includes('tests/e2e/run-1.spec.ts'));
  assert.ok(!qaPrompt.includes('src/index.ts'));

  // Revision feedback markdown
  const md = buildRevisionFeedbackMarkdown({
    runId: 'run-iter-2',
    prdTitle: '权限管理',
    prNumber: 15,
    approvalNote: '删除按钮缺少二次确认弹窗',
    uncheckedCriteria: ['删除操作需弹出确认框'],
    timestamp: '2026-11-19T01:00:00.000Z',
  });
  assert.ok(md.includes('PR #15') || md.includes('#15'));
  assert.ok(md.includes('删除按钮缺少二次确认弹窗'));
  assert.ok(md.includes('- [ ] 删除操作需弹出确认框'));
});

test('buildAgyPlanWorkflowYaml enforces orphan channel branch transport, single queue, workspace cleanup, and valid runner script', async () => {
  const {
    buildAgyPlanWorkflowYaml,
    AUTODEV_PLAN_WORKFLOW_PATH,
    AUTODEV_PLAN_CHANNEL_BRANCH,
  } = await import('./workflowBuilder');
  assert.equal(AUTODEV_PLAN_WORKFLOW_PATH, '.github/workflows/autodev-plan.yml');
  assert.equal(AUTODEV_PLAN_CHANNEL_BRANCH, 'autodev-plan-channel');
  const yaml = buildAgyPlanWorkflowYaml('jiangfengwhu');
  assert.ok(yaml.includes('contents: write'));
  assert.ok(!yaml.includes('issues: write'), 'Must NOT require issues: write PAT scope');
  assert.ok(yaml.includes('group: autodev-agy-single-queue'));
  assert.ok(yaml.includes('runs-on: [self-hosted, linux, x64, vps-agy]'));
  assert.ok(yaml.includes("github.actor == 'jiangfengwhu'"));
  assert.ok(yaml.includes('git checkout -- . && git clean -fd'));
  assert.ok(yaml.includes('channel_branch:'));
  assert.ok(yaml.includes('autodev-plan-channel'));

  // Verify embedded Node.js plan orchestrator script has valid ES module syntax, branch guard, async spawn & fetch retries
  const runnerMatch = yaml.match(/<<'PLAN_RUNNER_EOF'\n([\s\S]*?)\n\s*PLAN_RUNNER_EOF/);
  assert.ok(runnerMatch, 'Expected embedded plan runner script');
  const runnerCode = runnerMatch[1].replace(/^ {10}/gm, '');
  assert.ok(runnerCode.includes('Refusing to write plan artifacts to protected branch'));
  assert.ok(runnerCode.includes('.autodev-plans/'));
  assert.ok(runnerCode.includes("Connection: 'close'"), 'Must close HTTP connections to avoid stale keep-alive sockets');
  assert.ok(runnerCode.includes('invokeAgyAsync') && runnerCode.includes('spawn('), 'Must use async spawn for AGY stage execution');
  assert.ok(runnerCode.includes('AbortSignal.timeout(30000)'));

  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const tmpPath = '/tmp/test-autodev-plan-runner-check.mjs';
  fs.writeFileSync(tmpPath, runnerCode, 'utf-8');
  try {
    execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
});

test('planProtocol builds safe artifact paths, round-trips payloads, and validates 3-stage planning JSON outputs', async () => {
  const {
    AUTODEV_PLAN_CHANNEL_BRANCH,
    extractJsonFromText,
    formatPlanInputComment,
    formatPlanStageOutputComment,
    formatPlanStateComment,
    getPlanArtifactPath,
    parsePlanInputComment,
    parsePlanStageOutputComment,
    parsePlanStateComment,
    validateArchitectOutput,
    validateQaCriticOutput,
    validateQaSpecOutput,
  } = await import('./planProtocol');

  assert.equal(AUTODEV_PLAN_CHANNEL_BRANCH, 'autodev-plan-channel');
  assert.equal(getPlanArtifactPath('job-abc123', 'state.json'), '.autodev-plans/job-abc123/state.json');
  assert.equal(getPlanArtifactPath('job/bad..id', 'input.json'), '.autodev-plans/job_bad..id/input.json');

  const inputComment = formatPlanInputComment({
    jobId: 'job-abc123',
    repoFullName: 'jiangfengwhu/atd-v1',
    baseBranch: 'main',
    prdTitle: '深色模式切换',
    prdContent: '支持用户点击按钮切换主题，包含代码块 ```ts\nconst a = 1;\n``` 与边界测试。',
    effectiveTechStack: 'Cloudflare Workers + React',
    isDefaultCloudflare: true,
    agyModel: 'gemini-3.8-flash-high',
    createdAt: '2026-11-19T00:00:00.000Z',
  });
  const parsedInput = parsePlanInputComment(inputComment);
  assert.equal(parsedInput?.jobId, 'job-abc123');
  assert.ok(parsedInput?.prdContent.includes('const a = 1;'));

  const stateComment = formatPlanStateComment({
    jobId: 'job-abc123',
    status: 'running',
    updatedAt: '2026-11-19T00:01:00.000Z',
    actionsRunId: 555,
    steps: {
      architect: { status: 'completed', durationMs: 12000, message: '完成' },
      qa_spec: { status: 'running', message: '执行中' },
      qa_critic: { status: 'idle' },
    },
    outputFiles: { architect: '.autodev-plans/job-abc123/architect.json' },
  });
  const parsedState = parsePlanStateComment(stateComment);
  assert.equal(parsedState?.outputFiles?.architect, '.autodev-plans/job-abc123/architect.json');
  assert.equal(parsedState?.steps.architect.status, 'completed');

  const archRes = validateArchitectOutput(
    extractJsonFromText(
      'Here is JSON:\n```json\n{"ambiguities":[],"architectureSummary":"基于现有前端组件增量支持主题切换","techDecisions":["使用 CSS 变量"],"apiContracts":[],"tasks":[{"id":"T-1","title":"新增主题切换按钮","module":"client","description":"在侧边栏新增按钮","dependsOn":[],"acceptanceCriteria":["刷新保留状态"],"estimatedComplexity":"S"}]}\n```'
    )
  );
  assert.equal(archRes.ok, true);
  if (archRes.ok) {
    const outComment = formatPlanStageOutputComment('job-abc123', 'architect', archRes.data);
    const roundTripped = parsePlanStageOutputComment<typeof archRes.data>(outComment);
    assert.equal(roundTripped?.tasks[0].id, 'T-1');
  }

  const badArch = validateArchitectOutput({ architectureSummary: 'x', tasks: [] });
  assert.equal(badArch.ok, false);

  const qaSpecRes = validateQaSpecOutput({
    apiTestChecklist: [],
    e2eTestCode: "import { test } from '@playwright/test';",
    coverageNotes: ['Theme toggle'],
  });
  assert.equal(qaSpecRes.ok, true);

  const qaCriticRes = validateQaCriticOutput({
    reviewSummary: '补充持久化和无障碍属性检查',
    findings: [
      {
        id: 'CRIT-1',
        category: 'ui_interaction',
        severity: 'medium',
        issue: '缺少刷新后保持主题断言',
        recommendation: 'reload 后验证 data-theme 属性',
      },
    ],
    finalApiTestChecklist: [],
    finalE2eTestCode: "import { test, expect } from '@playwright/test';",
  });
  assert.equal(qaCriticRes.ok, true);
});

test('overviewMetrics builds 7-day buckets, deduplicates linked plan runs, and computes success/resource trends', async () => {
  const { buildSevenDayOverviewMetrics, classifyWorkflowCategory } = await import('./overviewMetrics');

  assert.equal(classifyWorkflowCategory('AutoDev AGY Plan Pipeline'), 'plan');
  assert.equal(classifyWorkflowCategory('AutoDev Cloudflare Workers Deploy'), 'deploy');
  assert.equal(classifyWorkflowCategory('AutoDev AGY Coding Runner'), 'coding');

  // Fixed reference clock: 2026-11-19T12:00:00+08:00 (2026-11-19T04:00:00Z)
  const fixedNow = new Date('2026-11-19T04:00:00.000Z');
  const metrics = buildSevenDayOverviewMetrics({
    repoFullName: 'jiangfengwhu/atd-v1',
    githubConnected: true,
    now: fixedNow,
    timezoneOffsetMinutes: 480,
    actionRuns: [
      {
        id: 101,
        name: 'AutoDev AGY Plan Pipeline',
        status: 'completed',
        conclusion: 'success',
        headBranch: 'main',
        createdAt: '2026-11-19T01:00:00.000Z', // 2026-11-19 09:00 UTC+8 (4 min)
        updatedAt: '2026-11-19T01:04:00.000Z',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/101',
      },
      {
        id: 102,
        name: 'AutoDev AGY Coding Runner',
        status: 'completed',
        conclusion: 'failure',
        headBranch: 'autodev/feat-1',
        createdAt: '2026-11-19T02:00:00.000Z', // 2026-11-19 10:00 UTC+8 (6 min)
        updatedAt: '2026-11-19T02:06:00.000Z',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/102',
      },
      {
        id: 103,
        name: 'AutoDev Cloudflare Deploy',
        status: 'completed',
        conclusion: 'success',
        headBranch: 'main',
        createdAt: '2026-11-17T03:00:00.000Z', // 2026-11-17 11:00 UTC+8 (2 min)
        updatedAt: '2026-11-17T03:02:00.000Z',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/103',
      },
      {
        id: 99,
        name: 'Old Run Outside 7-Day Window',
        status: 'completed',
        conclusion: 'success',
        headBranch: 'main',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:10:00.000Z',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/99',
      },
    ],
    analysisJobs: [
      // Duplicate of Action Run #101 -> must be deduplicated
      {
        id: 'job-dup',
        createdAt: '2026-11-19T01:00:00.000Z',
        updatedAt: '2026-11-19T01:04:00.000Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '已同步的规划',
        prdContent: 'content',
        executionMode: 'vps_agy',
        planActionsRunId: 101,
        status: 'completed',
        steps: [],
      },
      // Standalone Gemini API plan job on 2026-11-18 -> must be counted
      {
        id: 'job-local',
        createdAt: '2026-11-18T02:00:00.000Z',
        updatedAt: '2026-11-18T02:03:00.000Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '本地规划任务',
        prdContent: 'content',
        executionMode: 'gemini_api',
        status: 'completed',
        steps: [
          {
            id: 'architect',
            label: 'Architect',
            roleTitle: 'Arch',
            status: 'completed',
            durationMs: 120_000, // 2.0 min
          },
        ],
      },
    ],
    pipelineRuns: [
      {
        id: 'run-a',
        createdAt: '2026-11-19T01:10:00.000Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '需求 A',
        prdContent: 'prd',
        status: 'approved',
        architect: {
          ambiguities: [],
          architectureSummary: '',
          techDecisions: [],
          apiContracts: [],
          tasks: [],
        },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: {
          reviewSummary: '',
          findings: [],
          finalApiTestChecklist: [],
          finalE2eTestCode: '',
        },
      },
    ],
  });

  assert.equal(metrics.daily.length, 7);
  assert.equal(metrics.daily[0].dateKey, '2026-11-13');
  assert.equal(metrics.daily[6].dateKey, '2026-11-19');
  // Empty day must have null successRate (never synthetic 0% or 100%)
  assert.equal(metrics.daily[0].successRate, null);

  // 2026-11-19 has 1 succeeded plan (4m) + 1 failed coding (6m) -> 50%
  const today = metrics.daily[6];
  assert.equal(today.total, 2);
  assert.equal(today.succeeded, 1);
  assert.equal(today.failed, 1);
  assert.equal(today.successRate, 50);
  assert.equal(today.planMinutes, 4);
  assert.equal(today.codingMinutes, 6);
  assert.equal(today.planSuccessRate, 100);
  assert.equal(today.codingSuccessRate, 0);

  // 2026-11-18 has standalone local job (2m)
  const yesterday = metrics.daily[5];
  assert.equal(yesterday.planCount, 1);
  assert.equal(yesterday.planMinutes, 2);
  assert.equal(yesterday.successRate, 100);

  // 2026-11-17 has 1 deploy run (2m)
  const twoDaysAgo = metrics.daily[4];
  assert.equal(twoDaysAgo.deployMinutes, 2);
  assert.equal(twoDaysAgo.codingSuccessRate, 100);

  // Summary rollups (4 total runs: 3 succeeded, 1 failed => 75%, total compute = 4+6+2+2 = 14m)
  assert.equal(metrics.summary.totalRuns, 4);
  assert.equal(metrics.summary.succeededRuns, 3);
  assert.equal(metrics.summary.failedRuns, 1);
  assert.equal(metrics.summary.overallSuccessRate, 75);
  assert.equal(metrics.summary.totalComputeMinutes, 14);
  assert.equal(metrics.summary.planComputeMinutes, 6);
  assert.equal(metrics.summary.codingAndDeployMinutes, 8);
  assert.equal(metrics.summary.avgDurationMinutes, 3.5);
  assert.equal(metrics.summary.deliveredPrdCount, 1);
  assert.equal(metrics.summary.approvedPrdCount, 1);
});

test('rsiEngine parses Playwright/TAP/Actions logs, deduplicates rules, formats System Prompts, and aggregates metrics', async () => {
  const {
    aggregateQualityAndRsiMetrics,
    buildRsiGuidelinesMarkdown,
    computePassRate,
    formatRsiPromptBlock,
    mergeOrCreateRsiRule,
    normalizeRuleDedupeKey,
    parseTestMetricsFromLog,
    selectActiveRsiRulesForStage,
  } = await import('./rsiEngine');

  assert.equal(computePassRate(0, 0), null);
  assert.equal(computePassRate(3, 1), 75);

  // 1. Playwright log parsing
  const pwParsed = parseTestMetricsFromLog({
    logText: [
      'Running 5 tests using 2 workers',
      '  1) [chromium] › tests/e2e/run-1.spec.ts:18:5 › user submits form without crash',
      '  4 passed (8.2s)',
      '  1 failed',
    ].join('\n'),
    workflowName: 'AutoDev AGY Coding Runner',
    conclusion: 'failure',
  });
  assert.equal(pwParsed.kind, 'e2e');
  assert.equal(pwParsed.status, 'partial');
  assert.equal(pwParsed.passed, 4);
  assert.equal(pwParsed.failed, 1);
  assert.equal(pwParsed.cases.length, 1);
  assert.ok(pwParsed.cases[0].title.includes('tests/e2e/run-1.spec.ts'));

  // 2. TAP node:test log parsing
  const tapParsed = parseTestMetricsFromLog({
    logText: 'TAP version 13\n# tests 10\n# pass 9\n# fail 1\n# skipped 0\n',
    workflowName: 'Unit Tests',
    conclusion: 'failure',
  });
  assert.equal(tapParsed.kind, 'unit');
  assert.equal(tapParsed.passed, 9);
  assert.equal(tapParsed.failed, 1);

  // 3. GitHub Actions steps fallback parsing
  const stepsParsed = parseTestMetricsFromLog({
    logText: 'No test summary',
    workflowName: 'AutoDev AGY Coding Runner',
    conclusion: 'failure',
    steps: [
      { name: 'Set up job', status: 'completed', conclusion: 'success' },
      { name: 'Checkout PR branch', status: 'completed', conclusion: 'success' },
      { name: 'Run AGY Coding Agent', status: 'completed', conclusion: 'failure' },
      { name: 'Push changes', status: 'completed', conclusion: 'skipped' },
    ],
  });
  assert.equal(stepsParsed.kind, 'build_check');
  assert.equal(stepsParsed.passed, 1);
  assert.equal(stepsParsed.failed, 1);
  assert.equal(stepsParsed.skipped, 1);

  // 4. Rule creation & deduplication merge
  assert.equal(normalizeRuleDedupeKey('D1 Idempotent SQL!!', 'fallback'), 'd1-idempotent-sql');
  const first = mergeOrCreateRsiRule({
    existingRules: [],
    candidate: {
      title: 'D1 SQL 必须幂等',
      targetStage: 'coding',
      severity: 'recommended',
      promptDirective: '所有 CREATE TABLE 语句必须加 IF NOT EXISTS。',
      dedupeKey: 'd1-idempotent-sql',
      rootCauseCategory: 'env_infra',
    },
    incidentId: 'inc-1',
    nowIso: '2026-11-19T01:00:00.000Z',
    newId: 'rsi-1',
  });
  assert.equal(first.action, 'created');
  assert.equal(first.rule.hitCount, 1);

  const merged = mergeOrCreateRsiRule({
    existingRules: first.nextRules,
    candidate: {
      title: 'D1 SQL 必须幂等',
      targetStage: 'coding',
      severity: 'critical',
      promptDirective: '所有 D1 SQL 迁移脚本必须使用 CREATE TABLE IF NOT EXISTS 与 CREATE INDEX IF NOT EXISTS，严禁重复建表报错。',
      dedupeKey: 'd1-idempotent-sql',
      rootCauseCategory: 'env_infra',
    },
    incidentId: 'inc-2',
    nowIso: '2026-11-19T02:00:00.000Z',
    newId: 'rsi-2',
  });
  assert.equal(merged.action, 'merged');
  assert.equal(merged.nextRules.length, 1);
  assert.equal(merged.rule.hitCount, 2);
  assert.equal(merged.rule.severity, 'critical');
  assert.deepEqual(merged.rule.sourceIncidentIds, ['inc-1', 'inc-2']);

  // 5. Stage selection, prompt formatting & markdown guidelines
  const codingSelected = selectActiveRsiRulesForStage(merged.nextRules, 'coding');
  assert.equal(codingSelected.length, 1);
  assert.equal(selectActiveRsiRulesForStage(merged.nextRules, 'architect').length, 0);

  const promptBlock = formatRsiPromptBlock(merged.nextRules, 'coding');
  assert.ok(promptBlock.includes('RSI 系统自进化强约束规则'));
  assert.ok(promptBlock.includes('[CRITICAL]'));

  const guidelinesMd = buildRsiGuidelinesMarkdown(merged.nextRules);
  assert.ok(guidelinesMd.includes('AutoDev RSI Engineering Guardrails'));
  assert.ok(guidelinesMd.includes('CREATE TABLE IF NOT EXISTS'));

  // 6. Aggregation metrics
  const agg = aggregateQualityAndRsiMetrics({
    testReports: [
      {
        id: 'tr-1',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 5001,
        workflowName: 'AutoDev AGY',
        branch: 'autodev/feat-1',
        kind: 'e2e',
        status: 'partial',
        total: 5,
        passed: 4,
        failed: 1,
        skipped: 0,
        passRate: 80,
        durationMs: 12_000,
        executedAt: '2026-11-19T02:00:00.000Z',
        summary: '4/5',
        cases: [],
      },
    ],
    incidents: [
      {
        id: 'inc-1',
        sourceRefKey: 'actions:5001',
        source: 'test_failure',
        repoFullName: 'jiangfengwhu/atd-v1',
        title: 'E2E 失败',
        errorSummary: 'D1 migration failed',
        rawEvidence: 'table already exists',
        occurredAt: '2026-11-19T02:00:00.000Z',
        analysisStatus: 'analyzed',
        attribution: {
          rootCauseCategory: 'env_infra',
          rootCauseSummary: '重复建表',
          shouldCodifyAsRule: true,
          decisionRationale: '通用 D1 约束',
          confidence: 0.92,
          analyzedAt: '2026-11-19T02:01:00.000Z',
          model: 'gemini-4-hydrogen',
        },
      },
      {
        id: 'inc-2',
        sourceRefKey: 'actions:5002',
        source: 'ci_env_error',
        repoFullName: 'jiangfengwhu/atd-v1',
        title: '临时网络超时',
        errorSummary: 'ETIMEDOUT',
        rawEvidence: 'ETIMEDOUT',
        occurredAt: '2026-11-19T02:05:00.000Z',
        analysisStatus: 'analyzed',
        attribution: {
          rootCauseCategory: 'env_infra',
          rootCauseSummary: '临时网络抖动',
          shouldCodifyAsRule: false,
          decisionRationale: '偶发网络故障，不污染 Prompt',
          confidence: 0.88,
          analyzedAt: '2026-11-19T02:06:00.000Z',
          model: 'gemini-4-hydrogen',
        },
      },
    ],
    rules: merged.nextRules,
  });

  assert.equal(agg.summary.overallTestPassRate, 80);
  assert.equal(agg.summary.analyzedIncidents, 2);
  assert.equal(agg.summary.codifiedIncidents, 1);
  assert.equal(agg.summary.ignoredTransientIncidents, 1);
  assert.equal(agg.summary.activeRulesCount, 1);
  const envBucket = agg.rootCauseDistribution.find((d) => d.category === 'env_infra');
  assert.equal(envBucket?.count, 2);
  assert.equal(envBucket?.codifiedCount, 1);

  // 7. Embedded Outer-Loop Harness inside autodev-agy.yml references RSI guidelines and structured test verification
  const { buildAgyRunnerWorkflowYaml } = await import('./workflowBuilder');
  const agyYaml = buildAgyRunnerWorkflowYaml('jiangfengwhu');
  assert.ok(agyYaml.includes('docs/rsi-guidelines.md'));
  assert.ok(agyYaml.includes('BLIND_RUNNER_EOF'));
  assert.ok(agyYaml.includes('.autodev-test-reports/'));
});

test('requirementsBoard unifies runs, standalone jobs, audit logs, and test reports with 7-day activity breakdown', async () => {
  const { buildRequirementsBoardData, resolveRequirementStatus } = await import(
    './requirementsBoard'
  );

  const fixedNow = new Date('2026-11-19T04:00:00.000Z'); // 2026-11-19 12:00 UTC+8
  const baseRun: PipelineRun = {
    id: 'run-req-1',
    createdAt: '2026-11-19T01:00:00.000Z',
    repoFullName: 'jiangfengwhu/atd-v1',
    defaultBranch: 'main',
    prdTitle: '新增工单状态筛选',
    prdContent: '支持按待处理、处理中、已完成筛选工单并导出 CSV。',
    status: 'changes_requested',
    checkedCriteriaIds: ['T-1::0'],
    draftPr: {
      prUrl: 'https://github.com/jiangfengwhu/atd-v1/pull/21',
      prNumber: 21,
      branchName: 'autodev/feat-20261119-010000',
      baseBranch: 'main',
      commitSha: '1234567',
      filesCommitted: ['docs/spec.json'],
      createdAt: '2026-11-19T01:10:00.000Z',
    },
    lastRework: {
      dispatched: true,
      branchName: 'autodev/feat-20261119-010000',
      feedbackFilePath: 'docs/revision-feedback.md',
      dispatchedAt: '2026-11-19T02:00:00.000Z',
      note: '筛选后分页计数需重置为第 1 页',
    },
    architect: {
      ambiguities: [],
      architectureSummary: '增量扩展筛选接口',
      techDecisions: [],
      apiContracts: [],
      tasks: [
        {
          id: 'T-1',
          title: '筛选接口与分页',
          module: 'api',
          description: '支持 status 参数',
          dependsOn: [],
          acceptanceCriteria: ['按状态过滤正确', '切换筛选重置页码'],
          estimatedComplexity: 'S',
        },
      ],
    },
    qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
    qaCritic: {
      reviewSummary: '',
      findings: [],
      finalApiTestChecklist: [],
      finalE2eTestCode: '',
    },
  };

  const mergedRun: PipelineRun = {
    ...baseRun,
    id: 'run-req-2',
    createdAt: '2026-11-18T02:00:00.000Z',
    prdTitle: '支持深色主题持久化',
    status: 'approved',
    checkedCriteriaIds: ['T-1::0', 'T-1::1'],
    lastRework: undefined,
    draftPr: {
      ...baseRun.draftPr!,
      prNumber: 20,
      branchName: 'autodev/feat-20261118-020000',
      createdAt: '2026-11-18T02:10:00.000Z',
    },
    mergedRelease: {
      mergedAt: '2026-11-18T03:00:00.000Z',
      mergeCommitSha: 'abcdef1234567890',
      baseBranch: 'main',
      prNumber: 20,
      prUrl: 'https://github.com/jiangfengwhu/atd-v1/pull/20',
      commitUrl: 'https://github.com/jiangfengwhu/atd-v1/commit/abcdef1234567890',
      mergeMethod: 'squash',
      branchDeleted: true,
    },
  };

  assert.equal(resolveRequirementStatus(baseRun), 'changes_requested');
  assert.equal(resolveRequirementStatus(mergedRun), 'merged');

  const board = buildRequirementsBoardData({
    runs: [baseRun, mergedRun],
    jobs: [
      {
        id: 'job-linked',
        createdAt: '2026-11-19T00:55:00.000Z',
        updatedAt: '2026-11-19T01:00:00.000Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '新增工单状态筛选',
        prdContent: baseRun.prdContent,
        executionMode: 'vps_agy',
        agyModel: 'gemini-3.8-flash-high',
        status: 'completed',
        runId: 'run-req-1',
        steps: [],
      },
      {
        id: 'job-failed-standalone',
        createdAt: '2026-11-19T03:00:00.000Z',
        updatedAt: '2026-11-19T03:02:00.000Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '导出 PDF 报表（规划中断）',
        prdContent: '需要导出 PDF 报表',
        executionMode: 'vps_agy',
        status: 'error',
        error: 'Runner temporarily unavailable',
        steps: [],
      },
    ],
    auditLogs: [
      {
        id: 'aud-live-1',
        timestamp: '2026-11-19T02:00:00.000Z',
        category: 'approval',
        action: 'revision_requested',
        label: '退回修订（原分支返工）',
        actor: '验收审批人',
        repoFullName: 'jiangfengwhu/atd-v1',
        runId: 'run-req-1',
        prdTitle: '新增工单状态筛选',
        branch: 'autodev/feat-20261119-010000',
        prNumber: 21,
        status: 'success',
        detail: '在原分支 autodev/feat-20261119-010000 退回返工',
      },
    ],
    testReports: [
      {
        id: 'tr-branch-21',
        repoFullName: 'jiangfengwhu/atd-v1',
        workflowName: 'AutoDev AGY',
        branch: 'autodev/feat-20261119-010000',
        kind: 'e2e',
        status: 'partial',
        total: 4,
        passed: 3,
        failed: 1,
        skipped: 0,
        passRate: 75,
        durationMs: 10_000,
        executedAt: '2026-11-19T01:40:00.000Z',
        summary: '3/4 passed',
        cases: [],
      },
    ],
    now: fixedNow,
    timezoneOffsetMinutes: 480,
  });

  // 2 runs + 1 standalone failed job = 3 total requirements (linked job deduplicated!)
  assert.equal(board.summary.totalRequirements, 3);
  assert.equal(board.summary.deliveredCount, 1);
  assert.equal(board.summary.mergedCount, 1);
  assert.equal(board.summary.reworkRequestedCount, 1);
  assert.equal(board.summary.failedAnalysisCount, 1);
  assert.equal(board.summary.firstPassAcceptanceRatePct, 50); // 1 first-pass merged / 2 reviewed
  assert.equal(board.dailyActivity.length, 7);

  const req1 = board.requirements.find((r) => r.id === 'run-req-1');
  assert.ok(req1);
  assert.equal(req1.branchName, 'autodev/feat-20261119-010000');
  assert.equal(req1.lastReworkBranch, 'autodev/feat-20261119-010000');
  assert.equal(req1.acceptanceProgressPct, 50);
  assert.equal(req1.latestTestPassRate, 75);
  assert.ok(req1.auditEvents.some((e) => e.id === 'aud-live-1'));

  const failedStandalone = board.requirements.find((r) => r.id === 'job-failed-standalone');
  assert.equal(failedStandalone?.status, 'analysis_failed');
});

test('decideAgySessionPolicy enforces conditional reuse only on clean exit < 2 times and resets on timeout/error', async () => {
  const { decideAgySessionPolicy, MAX_CONSECUTIVE_AGY_SESSION_REUSE } = await import(
    './sessionReuse'
  );
  assert.equal(MAX_CONSECUTIVE_AGY_SESSION_REUSE, 2);

  // 1. No previous session -> fresh
  const firstRun = decideAgySessionPolicy({ targetBranch: 'autodev/feat-1' });
  assert.equal(firstRun.mode, 'fresh');
  assert.equal(firstRun.resumeSessionId, undefined);

  // 2. Clean exit (exitCode 0) on same branch with reuse count < 2 -> resume
  const cleanResume = decideAgySessionPolicy({
    targetBranch: 'autodev/feat-1',
    lastAgySession: {
      sessionId: 'sess-clean-001',
      branchName: 'autodev/feat-1',
      exitCode: 0,
      reused: false,
      updatedAt: '2026-11-19T03:00:00.000Z',
      consecutiveReuseCount: 0,
    },
  });
  assert.equal(cleanResume.mode, 'resume');
  assert.equal(cleanResume.resumeSessionId, 'sess-clean-001');

  // 3. Timeout exit (exitCode 3) -> auto-reset to fresh to avoid polluted context
  const afterTimeout = decideAgySessionPolicy({
    targetBranch: 'autodev/feat-1',
    lastAgySession: {
      sessionId: 'sess-timeout-002',
      branchName: 'autodev/feat-1',
      exitCode: 3,
      reused: false,
      updatedAt: '2026-11-19T03:10:00.000Z',
      consecutiveReuseCount: 0,
    },
  });
  assert.equal(afterTimeout.mode, 'fresh');
  assert.equal(afterTimeout.resumeSessionId, undefined);

  // 4. Consecutive reuse limit reached (2) -> auto-reset
  const afterCap = decideAgySessionPolicy({
    targetBranch: 'autodev/feat-1',
    lastAgySession: {
      sessionId: 'sess-old-003',
      branchName: 'autodev/feat-1',
      exitCode: 0,
      reused: true,
      updatedAt: '2026-11-19T03:20:00.000Z',
      consecutiveReuseCount: 2,
    },
  });
  assert.equal(afterCap.mode, 'fresh');

  // 5. Force fresh override
  const forcedFresh = decideAgySessionPolicy({
    targetBranch: 'autodev/feat-1',
    forceFresh: true,
    lastAgySession: {
      sessionId: 'sess-clean-001',
      branchName: 'autodev/feat-1',
      exitCode: 0,
      reused: false,
      updatedAt: '2026-11-19T03:00:00.000Z',
      consecutiveReuseCount: 0,
    },
  });
  assert.equal(forcedFresh.mode, 'fresh');
});

test('RSI anti-bloat discipline enforces candidate promotion, char/rule budgets, 30-day decay, and Decisions gate routing', async () => {
  const {
    RSI_BUDGET_LIMITS,
    applyRsiLifecycleHygiene,
    clampDirectiveLength,
    computeRsiPromptBudgetUsage,
    evaluateRsiDecisionOutcome,
    mergeOrCreateRsiRule,
    selectActiveRsiRulesForStage,
  } = await import('./rsiEngine');

  // 1. Per-rule directive clamping
  const longText = '规则正文'.repeat(60);
  const clamped = clampDirectiveLength(longText);
  assert.ok(clamped.length <= RSI_BUDGET_LIMITS.maxDirectiveChars);

  // 2. Two-tier candidate creation and automatic promotion on 2nd hit
  const cand1 = mergeOrCreateRsiRule({
    existingRules: [],
    candidate: {
      title: 'Playwright 禁用交互报告器',
      targetStage: 'coding',
      severity: 'recommended',
      promptDirective: '运行 Playwright 测试时必须设置 CI=true 与 PLAYWRIGHT_HTML_OPEN=never。',
      dedupeKey: 'pw-no-open',
      rootCauseCategory: 'ci_workflow',
    },
    incidentId: 'inc-a',
    nowIso: '2026-11-19T01:00:00.000Z',
    newId: 'rsi-cand-1',
    initialStatus: 'candidate',
  });
  assert.equal(cand1.rule.status, 'candidate');
  assert.equal(selectActiveRsiRulesForStage(cand1.nextRules, 'coding').length, 0);

  const cand2 = mergeOrCreateRsiRule({
    existingRules: cand1.nextRules,
    candidate: {
      title: 'Playwright 禁用交互报告器',
      targetStage: 'coding',
      severity: 'recommended',
      promptDirective: '运行 Playwright 测试时必须设置 CI=true 与 PLAYWRIGHT_HTML_OPEN=never。',
      dedupeKey: 'pw-no-open',
      rootCauseCategory: 'ci_workflow',
    },
    incidentId: 'inc-b',
    nowIso: '2026-11-19T02:00:00.000Z',
    newId: 'rsi-cand-2',
    explicitMergeRuleId: 'rsi-cand-1',
  });
  assert.equal(cand2.action, 'merged');
  assert.equal(cand2.rule.hitCount, 2);
  assert.equal(cand2.rule.status, 'active', 'Candidate must auto-promote to active on 2nd hit');

  // 3. Decisions gate outcome evaluator
  const discardDecision = evaluateRsiDecisionOutcome({
    model: 'gemini-decision-1',
    evaluatedAt: '2026-11-19T03:00:00.000Z',
    generalizableProb: 0.25,
    duplicateProb: 0.1,
    generalityScore: 0.8,
    chosenAction: 'discard_edge_case',
    actionConfidence: 0.82,
  });
  assert.equal(discardDecision.shouldCodifyAsRule, false);
  assert.equal(discardDecision.outcome, 'discarded');

  const mergeDecision = evaluateRsiDecisionOutcome({
    model: 'gemini-decision-1',
    evaluatedAt: '2026-11-19T03:00:00.000Z',
    generalizableProb: 0.88,
    duplicateProb: 0.85,
    generalityScore: 2.5,
    chosenAction: 'merge_existing',
    actionConfidence: 0.79,
    matchedRuleId: 'rsi-cand-1',
    matchedRuleConfidence: 0.72,
  });
  assert.equal(mergeDecision.shouldCodifyAsRule, true);
  assert.equal(mergeDecision.outcome, 'merged');
  assert.equal(mergeDecision.mergeTargetRuleId, 'rsi-cand-1');

  const candidateDecision = evaluateRsiDecisionOutcome({
    model: 'gemini-decision-1',
    evaluatedAt: '2026-11-19T03:00:00.000Z',
    generalizableProb: 0.76,
    duplicateProb: 0.12,
    generalityScore: 2.1,
    chosenAction: 'create_candidate',
    actionConfidence: 0.7,
  });
  assert.equal(candidateDecision.shouldCodifyAsRule, true);
  assert.equal(candidateDecision.outcome, 'candidate_created');
  assert.equal(candidateDecision.initialStatus, 'candidate');

  // 4. 30-day stale decay + hard char budget enforcement
  const manyRules = Array.from({ length: 14 }, (_, idx) => ({
    id: `rsi-bulk-${idx}`,
    title: `规则 ${idx}`,
    targetStage: 'coding' as const,
    severity: idx < 3 ? ('critical' as const) : ('recommended' as const),
    status: 'active' as const,
    promptDirective: `约束 ${idx}：${'请保持迁移幂等与契约对齐并避免长时间阻塞进程退出。'.repeat(3)}`,
    dedupeKey: `bulk-${idx}`,
    rootCauseCategory: 'env_infra' as const,
    hitCount: idx === 13 ? 1 : 3,
    appliedCount: 0,
    sourceIncidentIds: [],
    createdAt: idx === 13 ? '2026-09-01T00:00:00.000Z' : '2026-11-18T00:00:00.000Z',
    updatedAt: idx === 13 ? '2026-09-01T00:00:00.000Z' : '2026-11-18T00:00:00.000Z',
  }));
  const cleaned = applyRsiLifecycleHygiene(manyRules, '2026-11-19T00:00:00.000Z');
  assert.equal(
    cleaned.find((r) => r.id === 'rsi-bulk-13')?.status,
    'archived',
    'Rule idle > 30 days should be auto-archived'
  );
  const selectedCoding = selectActiveRsiRulesForStage(cleaned, 'coding');
  assert.ok(selectedCoding.length <= RSI_BUDGET_LIMITS.codingMaxRules);
  const budget = computeRsiPromptBudgetUsage(cleaned);
  assert.ok(budget.codingCharsUsed <= RSI_BUDGET_LIMITS.codingMaxChars);
  assert.equal(budget.archivedRulesCount, 1);

  // 5. autodev-agy.yml includes Direct-Wait No-Timeout Self-Push, Blind E2E Vault, id: agy, CI=true, agy_mode, and session_mode
  const { buildAgyPlanWorkflowYaml, buildAgyRunnerWorkflowYaml } = await import('./workflowBuilder');
  const yaml = buildAgyRunnerWorkflowYaml('jiangfengwhu');
  assert.ok(yaml.includes('id: agy'));
  assert.ok(yaml.includes('session_mode:'));
  assert.ok(yaml.includes('resume_session_id:'));
  assert.ok(yaml.includes('agy_mode:'));
  assert.ok(yaml.includes("CI: 'true'"));
  assert.ok(yaml.includes("PLAYWRIGHT_HTML_OPEN: 'never'"));
  assert.ok(!yaml.includes("'--print-timeout'"));
  assert.ok(yaml.includes('Execute VPS AGY Coding (No Timeout + Direct Push) & Blind Independent E2E Verification'));
  assert.ok(yaml.includes('steps.agy.outputs.passed_count'));

  const planYaml = buildAgyPlanWorkflowYaml('jiangfengwhu');
  assert.ok(!planYaml.includes("'--print-timeout'"), 'Plan workflow must also wait naturally without --print-timeout CLI arg');
  assert.ok(planYaml.includes('.or(') && planYaml.includes('.first()'), 'Plan workflow must enforce Playwright strict-mode .or().first() guardrail');
});

test('buildRsiEvolutionTrend computes chronological pass rate, 3-run rolling average, and cumulative adopted System Prompts', async () => {
  const { buildRsiEvolutionTrend } = await import('./rsiEngine');
  const trend = buildRsiEvolutionTrend(
    [
      {
        id: 'rep-3',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 303,
        workflowName: 'AutoDev AGY',
        branch: 'autodev/feat-3',
        kind: 'e2e',
        status: 'passed',
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        passRate: 100,
        durationMs: 12000,
        executedAt: '2026-11-19T06:00:00.000Z',
        summary: '10/10',
        cases: [],
      },
      {
        id: 'rep-1',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 301,
        workflowName: 'AutoDev AGY',
        branch: 'autodev/feat-1',
        kind: 'e2e',
        status: 'partial',
        total: 10,
        passed: 4,
        failed: 6,
        skipped: 0,
        passRate: 40,
        durationMs: 15000,
        executedAt: '2026-11-19T02:00:00.000Z',
        summary: '4/10',
        cases: [],
      },
      {
        id: 'rep-2',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 302,
        workflowName: 'AutoDev AGY',
        branch: 'autodev/feat-2',
        kind: 'e2e',
        status: 'partial',
        total: 10,
        passed: 7,
        failed: 3,
        skipped: 0,
        passRate: 70,
        durationMs: 13000,
        executedAt: '2026-11-19T04:00:00.000Z',
        summary: '7/10',
        cases: [],
      },
    ],
    [
      {
        id: 'r-1',
        title: 'Strict mode',
        targetStage: 'qa_spec',
        severity: 'critical',
        status: 'active',
        promptDirective: 'Always add .first() to .or()',
        dedupeKey: 'pw-strict',
        rootCauseCategory: 'test_assertion',
        hitCount: 2,
        appliedCount: 3,
        sourceIncidentIds: ['inc-1'],
        createdAt: '2026-11-19T02:30:00.000Z',
        updatedAt: '2026-11-19T02:30:00.000Z',
      },
      {
        id: 'r-2',
        title: 'Candidate not yet adopted',
        targetStage: 'coding',
        severity: 'recommended',
        status: 'candidate',
        promptDirective: 'Pending candidate',
        dedupeKey: 'cand-1',
        rootCauseCategory: 'env_infra',
        hitCount: 1,
        appliedCount: 0,
        sourceIncidentIds: ['inc-2'],
        createdAt: '2026-11-19T03:00:00.000Z',
        updatedAt: '2026-11-19T03:00:00.000Z',
      },
      {
        id: 'r-3',
        title: 'D1 idempotent',
        targetStage: 'coding',
        severity: 'critical',
        status: 'active',
        promptDirective: 'IF NOT EXISTS',
        dedupeKey: 'd1-idem',
        rootCauseCategory: 'env_infra',
        hitCount: 2,
        appliedCount: 2,
        sourceIncidentIds: ['inc-3'],
        createdAt: '2026-11-19T05:00:00.000Z',
        updatedAt: '2026-11-19T05:00:00.000Z',
      },
    ]
  );

  assert.equal(trend.length, 3);
  assert.equal(trend[0].id, 'rep-1');
  assert.equal(trend[0].passRatePct, 40);
  assert.equal(trend[0].rollingSuccessRatePct, 40);
  assert.equal(trend[0].adoptedPromptsCumulative, 0);

  assert.equal(trend[1].id, 'rep-2');
  assert.equal(trend[1].passRatePct, 70);
  assert.equal(trend[1].rollingSuccessRatePct, 55);
  assert.equal(trend[1].adoptedPromptsCumulative, 1);
  assert.equal(trend[1].newlyAdoptedPrompts, 1);

  assert.equal(trend[2].id, 'rep-3');
  assert.equal(trend[2].passRatePct, 100);
  assert.equal(trend[2].rollingSuccessRatePct, 70);
  assert.equal(trend[2].adoptedPromptsCumulative, 2);
  assert.equal(trend[2].newlyAdoptedPrompts, 1);
});

test('filterActionRunsForPipelineRun isolates GitHub Actions runs strictly to the selected requirement', async () => {
  const { filterActionRunsForPipelineRun } = await import('./iterationContext');
  const activeRun: PipelineRun = {
    id: 'run-target',
    createdAt: '2026-11-19T01:00:00.000Z',
    repoFullName: 'jiangfengwhu/atd-v1',
    defaultBranch: 'main',
    prdTitle: '搜索功能',
    prdContent: '支持关键字搜索',
    status: 'pr_created',
    draftPr: {
      prUrl: 'https://github.com/jiangfengwhu/atd-v1/pull/8',
      prNumber: 8,
      branchName: 'autodev/feat-target',
      baseBranch: 'main',
      commitSha: '1111111',
      filesCommitted: ['docs/spec.json'],
      createdAt: '2026-11-19T01:05:00.000Z',
    },
    architect: {
      ambiguities: [],
      architectureSummary: '',
      techDecisions: [],
      apiContracts: [],
      tasks: [],
    },
    qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
    qaCritic: {
      reviewSummary: '',
      findings: [],
      finalApiTestChecklist: [],
      finalE2eTestCode: '',
    },
  };

  const runs = [
    {
      id: 1001,
      name: 'AutoDev AGY Plan Pipeline',
      status: 'completed',
      conclusion: 'success',
      headBranch: 'main',
      createdAt: '2026-11-19T01:00:00.000Z',
      updatedAt: '2026-11-19T01:02:00.000Z',
      htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/1001',
    },
    {
      id: 1002,
      name: 'AutoDev AGY Coding Runner',
      status: 'completed',
      conclusion: 'success',
      headBranch: 'main',
      targetBranch: 'autodev/feat-target',
      createdAt: '2026-11-19T01:10:00.000Z',
      updatedAt: '2026-11-19T01:20:00.000Z',
      htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/1002',
    },
    {
      id: 1003,
      name: 'AutoDev AGY Coding Runner',
      status: 'completed',
      conclusion: 'failure',
      headBranch: 'main',
      targetBranch: 'autodev/feat-other',
      pipelineRunId: 'run-other',
      prNumber: 7,
      createdAt: '2026-11-19T00:10:00.000Z',
      updatedAt: '2026-11-19T00:20:00.000Z',
      htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/1003',
    },
    {
      id: 1004,
      name: 'AutoDev AGY Coding Runner',
      status: 'in_progress',
      conclusion: null,
      headBranch: 'main',
      prNumber: 8,
      createdAt: '2026-11-19T01:30:00.000Z',
      updatedAt: '2026-11-19T01:31:00.000Z',
      htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/1004',
    },
  ];

  const relatedJobs = [
    {
      id: 'job-target',
      createdAt: '2026-11-19T01:00:00.000Z',
      updatedAt: '2026-11-19T01:02:00.000Z',
      repoFullName: 'jiangfengwhu/atd-v1',
      defaultBranch: 'main',
      prdTitle: '搜索功能',
      prdContent: '支持关键字搜索',
      executionMode: 'vps_agy' as const,
      planActionsRunId: 1001,
      status: 'completed' as const,
      runId: 'run-target',
      steps: [],
    },
  ];

  const filtered = filterActionRunsForPipelineRun(runs, activeRun, relatedJobs);
  assert.deepEqual(
    filtered.map((r) => r.id),
    [1001, 1002, 1004]
  );
  assert.equal(filterActionRunsForPipelineRun(runs, null, relatedJobs).length, 0);
});

test('single-turn unified AGY planning workflow & coding workflow capture codingFinalOutput and tokenUsage', async () => {
  const { buildAgyPlanWorkflowYaml, buildAgyRunnerWorkflowYaml } = await import(
    './workflowBuilder'
  );
  const planYaml = buildAgyPlanWorkflowYaml('jiangfengwhu');
  assert.ok(planYaml.includes('runUnifiedPlanStage'), 'Plan workflow must run single-turn unified AGY planning');
  assert.ok(planYaml.includes('plan-bundle.json'), 'Plan workflow must write unified plan-bundle.json');
  assert.ok(planYaml.includes("mode: 'unified_single_turn'"), 'Plan workflow must mark state mode as unified_single_turn');
  assert.ok(planYaml.includes('tokenUsage'), 'Plan workflow must record tokenUsage in state.json');

  const codingYaml = buildAgyRunnerWorkflowYaml('jiangfengwhu');
  assert.ok(codingYaml.includes('codingFinalOutput'), 'Coding workflow must publish codingFinalOutput in test report');
  assert.ok(codingYaml.includes('tokenUsage'), 'Coding workflow must publish tokenUsage in test report');
});

test('overviewMetrics computes reported and estimated Token consumption and formats human-readable counts', async () => {
  const {
    buildSevenDayOverviewMetrics,
    estimateTokensFromMinutes,
    formatTokenCount,
  } = await import('./overviewMetrics');

  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(850), '850');
  assert.equal(formatTokenCount(14_200), '14.2K');
  assert.equal(formatTokenCount(1_350_000), '1.35M');
  assert.ok(estimateTokensFromMinutes('plan', 2).totalTokens > 0);

  const fixedNow = new Date('2026-11-19T04:00:00.000Z');
  const metrics = buildSevenDayOverviewMetrics({
    repoFullName: 'jiangfengwhu/atd-v1',
    githubConnected: true,
    now: fixedNow,
    timezoneOffsetMinutes: 480,
    actionRuns: [
      {
        id: 201,
        name: 'AutoDev AGY Plan Pipeline',
        status: 'completed',
        conclusion: 'success',
        headBranch: 'main',
        createdAt: '2026-11-19T01:00:00.000Z',
        updatedAt: '2026-11-19T01:02:00.000Z',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/201',
      },
      {
        id: 202,
        name: 'AutoDev AGY Coding Runner',
        status: 'completed',
        conclusion: 'success',
        headBranch: 'autodev/feat-202',
        createdAt: '2026-11-19T02:00:00.000Z',
        updatedAt: '2026-11-19T02:05:00.000Z',
        htmlUrl: 'https://github.com/jiangfengwhu/atd-v1/actions/runs/202',
      },
    ],
    analysisJobs: [
      {
        id: 'job-plan-201',
        createdAt: '2026-11-19T01:00:00.000Z',
        updatedAt: '2026-11-19T01:02:00.000Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: 'Token 统计',
        prdContent: '按 token 统计算力消耗',
        executionMode: 'vps_agy',
        planMode: 'unified_single_turn',
        planActionsRunId: 201,
        status: 'completed',
        tokenUsage: {
          inputTokens: 18_000,
          outputTokens: 6_000,
          totalTokens: 24_000,
          source: 'reported',
        },
        steps: [],
      },
    ],
    pipelineRuns: [],
    testReports: [
      {
        id: 'rep-202',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 202,
        workflowName: 'AutoDev AGY Coding Runner',
        branch: 'autodev/feat-202',
        kind: 'e2e',
        status: 'passed',
        total: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        passRate: 100,
        durationMs: 25_000,
        executedAt: '2026-11-19T02:05:00.000Z',
        summary: '3/3 passed',
        cases: [],
        tokenUsage: {
          inputTokens: 52_000,
          outputTokens: 14_000,
          totalTokens: 66_000,
          source: 'reported',
        },
      },
    ],
  });

  assert.equal(metrics.summary.planTokens, 24_000);
  assert.equal(metrics.summary.codingTokens, 66_000);
  assert.equal(metrics.summary.totalTokens, 90_000);
  assert.equal(metrics.summary.reportedTokenRuns, 2);
  assert.equal(metrics.summary.estimatedTokenRuns, 0);
});

test('requirementsBoard exposes codingFinalOutput preview, token rollup, and plan_edited audit label', async () => {
  const { AUDIT_ACTION_LABELS, buildRequirementsBoardData } = await import(
    './requirementsBoard'
  );
  assert.equal(AUDIT_ACTION_LABELS.plan_edited, '编辑需求规划方案');

  const run: PipelineRun = {
    id: 'run-output-1',
    createdAt: '2026-11-19T01:00:00.000Z',
    repoFullName: 'jiangfengwhu/atd-v1',
    defaultBranch: 'main',
    prdTitle: '新增完整需求报告',
    prdContent: '支持在需求看板查看 Coding Agent 最终交付输出和完整报告。',
    status: 'pr_created',
    planTokenUsage: {
      inputTokens: 10_000,
      outputTokens: 4_000,
      totalTokens: 14_000,
      source: 'reported',
    },
    latestCodingOutput: {
      content: '已完成需求报告接口与前端模态框，全部 Playwright 盲测通过。',
      commitSha: '998877665544',
      repairRounds: 1,
      capturedAt: '2026-11-19T01:30:00.000Z',
      tokenUsage: {
        inputTokens: 40_000,
        outputTokens: 12_000,
        totalTokens: 52_000,
        source: 'reported',
      },
    },
    architect: {
      ambiguities: [],
      architectureSummary: 'summary',
      techDecisions: [],
      apiContracts: [],
      tasks: [],
    },
    qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
    qaCritic: {
      reviewSummary: '',
      findings: [],
      finalApiTestChecklist: [],
      finalE2eTestCode: '',
    },
  };

  const board = buildRequirementsBoardData({
    runs: [run],
    jobs: [],
    auditLogs: [],
    testReports: [],
  });
  const item = board.requirements[0];
  assert.equal(item.hasCodingOutput, true);
  assert.ok(item.latestCodingOutputPreview?.includes('已完成需求报告接口'));
  assert.equal(item.latestCodingCommitSha, '998877665544');
  assert.equal(item.repairRounds, 1);
  assert.equal(item.totalTokens, 66_000);
});

test('codingChatOutput extracts clean final chat message and strictly rejects raw GitHub Actions terminal logs', async () => {
  const {
    extractCleanAssistantChatFromComment,
    looksLikeRawActionsLog,
    sanitizeCodingChatOutput,
  } = await import('./codingChatOutput');

  // 1. Raw GitHub Actions log must be rejected (never leaked into Coding Agent chat preview)
  const rawActionsLog = [
    '2026-11-20T07:10:00Z [agy:session] id=sess-123 mode=fresh',
    '[agy:tool] bash npm ci && npm run build',
    '> atd-v1@1.0.0 build',
    '> vite build',
    '✓ built in 2.31s',
    '[autodev-test-harness] Running blind E2E tests...',
    '4 passed (6.1s)',
  ].join('\n');
  assert.equal(looksLikeRawActionsLog(rawActionsLog), true);
  assert.equal(sanitizeCodingChatOutput(rawActionsLog), undefined);

  // 2. Clean final chat reply sent to user must be preserved intact
  const cleanChatReply =
    '已完成深色主题持久化与设置弹窗开发：\n1. 新增 localStorage + 服务端同步配置\n2. 全部 6 条 Playwright 盲测用例通过，无回归。';
  assert.equal(looksLikeRawActionsLog(cleanChatReply), false);
  assert.equal(sanitizeCodingChatOutput(cleanChatReply), cleanChatReply);

  // 3. Dedicated AUTODEV-FINAL-CHAT marker inside live PR comment takes highest priority
  const commentWithMarker = [
    '<!-- AUTODEV-AGY-LIVE-LOG -->',
    '### Coding Runner Live Stream',
    '<!-- AUTODEV-FINAL-CHAT-START -->',
    '已完成全部功能开发与单测修复，详情如下：\n- 新增 `/api/tasks` 后台任务队列\n- 验收页面已接入预览部署',
    '<!-- AUTODEV-FINAL-CHAT-END -->',
    '```text',
    '[agy:tool] run_command npm test',
    '```',
  ].join('\n');
  const extractedFromMarker = extractCleanAssistantChatFromComment(commentWithMarker, rawActionsLog);
  assert.ok(extractedFromMarker && extractedFromMarker.includes('已完成全部功能开发与单测修复'));
  assert.ok(extractedFromMarker && !extractedFromMarker.includes('[agy:tool]'));

  // 4. [agy:result] JSON payload fallback
  const commentWithResultJson = [
    '[agy:tool] edit src/App.tsx',
    `[agy:result] ${JSON.stringify({ response: '所有改动已提交并推送到目标分支，Playwright 测试全部通过。' })}`,
  ].join('\n');
  const extractedFromResult = extractCleanAssistantChatFromComment(
    commentWithResultJson,
    commentWithResultJson
  );
  assert.equal(
    extractedFromResult,
    '所有改动已提交并推送到目标分支，Playwright 测试全部通过。'
  );

  // 5. Trailing [agy] assistant lines after the last [agy:tool] line
  const commentWithTrailingAssistant = [
    '[agy:tool] bash npm run build',
    '[agy] 已完成登录页重构并修复移动端导航溢出问题。',
    '[agy] 所有自动化检查均已通过。',
  ].join('\n');
  const extractedTrailing = extractCleanAssistantChatFromComment(
    commentWithTrailingAssistant,
    commentWithTrailingAssistant
  );
  assert.equal(
    extractedTrailing,
    '已完成登录页重构并修复移动端导航溢出问题。\n所有自动化检查均已通过。'
  );

  // 6. Pure Actions terminal output with no assistant chat reply returns undefined
  const extractedPureActions = extractCleanAssistantChatFromComment(rawActionsLog, rawActionsLog);
  assert.equal(extractedPureActions, undefined);
});

test('backgroundTaskStore runs detached tasks, deduplicates active dedupeKey, and records completion/failure', async () => {
  const {
    clearBackgroundTasksForTest,
    enqueueBackgroundTask,
    getBackgroundTaskById,
    listBackgroundTasks,
  } = await import('../../server/backgroundTaskStore');

  clearBackgroundTasksForTest();

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const { task: task1, deduplicated: d1 } = enqueueBackgroundTask({
    kind: 'rsi_sync',
    title: '同步测试报告',
    roomId: 'quality',
    initialMessage: '准备同步测试报告…',
    dedupeKey: 'test-sync-1',
    executor: async ({ setProgress }) => {
      setProgress('正在拉取远端测试报告…');
      await firstGate;
      return {
        summary: '已同步 3 份报告',
        result: { count: 3 },
      };
    },
  });

  assert.equal(d1, false);
  assert.equal(task1.status, 'running');

  // Same dedupeKey while running returns the existing running task
  const { task: task1Dup, deduplicated: d2 } = enqueueBackgroundTask({
    kind: 'rsi_sync',
    title: '同步测试报告（重复）',
    roomId: 'quality',
    initialMessage: '准备同步…',
    dedupeKey: 'test-sync-1',
    executor: async () => ({ summary: 'should not run' }),
  });
  assert.equal(d2, true);
  assert.equal(task1Dup.id, task1.id);

  // Complete task1
  releaseFirst();
  await new Promise((r) => setTimeout(r, 30));

  const finished1 = getBackgroundTaskById(task1.id);
  assert.equal(finished1?.status, 'completed');
  assert.equal(finished1?.progressMessage, '已同步 3 份报告');
  assert.deepEqual(finished1?.result, { count: 3 });

  // Failed task captures error cleanly without crashing process
  const { task: task2 } = enqueueBackgroundTask({
    kind: 'deploy_preview',
    title: '预览部署失败测试',
    roomId: 'approval',
    initialMessage: '准备部署预览…',
    executor: async () => {
      throw new Error('Cloudflare API 502');
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  const finished2 = getBackgroundTaskById(task2.id);
  assert.equal(finished2?.status, 'failed');
  assert.equal(finished2?.error, 'Cloudflare API 502');
  assert.equal(listBackgroundTasks().length, 2);

  clearBackgroundTasksForTest();
});

test('studioWorldData: spawn point, corridor, and all 6 room interaction spots are walkable while walls & desks block movement', async () => {
  const {
    PLAYER_SPAWN_WORLD,
    STUDIO_WORLD_ROOMS,
    TILE_SIZE,
    isWalkableWorldPoint,
    getRoomAtWorldPoint,
    findNearbyInteractableRoom,
    getCorridorRouteWaypoints,
  } = await import('../game/studioWorldData');

  assert.equal(isWalkableWorldPoint(PLAYER_SPAWN_WORLD.x, PLAYER_SPAWN_WORLD.y), true);
  assert.equal(isWalkableWorldPoint(PLAYER_SPAWN_WORLD.x + 120, PLAYER_SPAWN_WORLD.y), true);
  assert.equal(isWalkableWorldPoint(PLAYER_SPAWN_WORLD.x - 120, PLAYER_SPAWN_WORLD.y), true);
  assert.equal(isWalkableWorldPoint(PLAYER_SPAWN_WORLD.x, PLAYER_SPAWN_WORLD.y - 64), true);

  assert.equal(isWalkableWorldPoint(8, PLAYER_SPAWN_WORLD.y), false);
  assert.equal(isWalkableWorldPoint(12 * TILE_SIZE, 5 * TILE_SIZE), false);
  assert.equal(isWalkableWorldPoint(24 * TILE_SIZE, 16 * TILE_SIZE), false);

  assert.equal(STUDIO_WORLD_ROOMS.length, 6);
  for (const room of STUDIO_WORLD_ROOMS) {
    const doorX = room.doorCol * TILE_SIZE;
    const doorY = room.doorRow * TILE_SIZE;
    const interactX = room.interactCol * TILE_SIZE;
    const interactY = room.interactRow * TILE_SIZE;

    assert.equal(
      isWalkableWorldPoint(doorX, doorY),
      true,
      `Doorway for ${room.roomCode} should be walkable`
    );
    assert.equal(
      isWalkableWorldPoint(interactX, interactY),
      true,
      `Interaction spot for ${room.roomCode} should be walkable`
    );
    assert.equal(
      isWalkableWorldPoint(room.npcCol * TILE_SIZE, room.npcRow * TILE_SIZE),
      false,
      `NPC desk center for ${room.roomCode} should block walking through`
    );

    const inside = getRoomAtWorldPoint(interactX, interactY);
    assert.equal(inside?.roomId, room.roomId);

    const nearby = findNearbyInteractableRoom(interactX, interactY);
    assert.equal(nearby?.room.roomId, room.roomId);
  }

  const route = getCorridorRouteWaypoints('prd', 'approval');
  assert.equal(route.length, 4);
  assert.equal(route[1].y, 11 * TILE_SIZE);
  assert.equal(route[2].y, 11 * TILE_SIZE);
});

test('studioWorldData: computeStudioProgression derives real XP, level, and active main quest from workflow state', async () => {
  const { computeStudioProgression } = await import('../game/studioWorldData');

  const fresh = computeStudioProgression({
    runs: [],
    analysisJob: null,
    backgroundTasks: [],
    status: {
      github: { connected: true, repos: [] },
      cloudflare: { connected: true },
      gemini: { configured: true },
    } as never,
  });
  assert.equal(fresh.level, 1);
  assert.equal(fresh.totalXp, 0);
  assert.equal(fresh.activeQuest.targetRoomId, 'prd');

  const disconnected = computeStudioProgression({
    runs: [],
    analysisJob: null,
    backgroundTasks: [],
    status: {
      github: { connected: false, repos: [] },
      cloudflare: { connected: false },
      gemini: { configured: false },
    } as never,
  });
  assert.equal(disconnected.activeQuest.targetRoomId, 'environment');
  assert.equal(disconnected.activeQuest.isUrgent, true);

  const activeWithDelivered = computeStudioProgression({
    runs: [
      {
        id: 'run-delivered',
        createdAt: '2026-11-20T00:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '已上线需求',
        prdContent: '内容',
        status: 'approved',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 1, prUrl: 'https://github.com/x', branchName: 'autodev/feat-1', baseBranch: 'main', commitSha: 'abc', filesCommitted: [], createdAt: '2026-11-20T00:00:00Z' },
        mergedRelease: { prNumber: 1, prUrl: 'https://github.com/x', mergeCommitSha: 'def', commitUrl: 'https://github.com/c', baseBranch: 'main', mergeMethod: 'squash', mergedAt: '2026-11-20T01:00:00Z' },
      },
      {
        id: 'run-preview-ready',
        createdAt: '2026-11-21T00:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '待验收需求',
        prdContent: '内容',
        status: 'pr_created',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 2, prUrl: 'https://github.com/x2', branchName: 'autodev/feat-2', baseBranch: 'main', commitSha: 'abc2', filesCommitted: [], createdAt: '2026-11-21T00:00:00Z' },
        previewDeployment: { url: 'https://preview.pages.dev', workerName: 'atd-v1-pr2', branchName: 'autodev/feat-2', deployedAt: '2026-11-21T00:10:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: {
      github: { connected: true, repos: [] },
      cloudflare: { connected: true },
      gemini: { configured: true },
    } as never,
  });

  assert.equal(activeWithDelivered.deliveredCount, 1);
  assert.ok(activeWithDelivered.totalXp >= 400);
  assert.ok(activeWithDelivered.level >= 2);
  assert.equal(activeWithDelivered.activeQuest.targetRoomId, 'approval');
  assert.equal(activeWithDelivered.activeQuest.isUrgent, true);
});

test('factoryPipelineState: deriveRealFactorySnapshot maps real telemetry, rack LEDs, rework loop, approval, and delivered states', async () => {
  const { buildRackLeds, deriveRealFactorySnapshot, FACTORY_STATIONS } = await import(
    './factoryPipelineState'
  );

  // Verify department-only naming across all 6 departments (no person names)
  assert.equal(FACTORY_STATIONS['ST-00'].title, '指挥调度中心');
  assert.equal(FACTORY_STATIONS['ST-01'].title, '架构策划部');
  assert.equal(FACTORY_STATIONS['ST-02'].title, 'Gemini 编码圣殿');
  assert.equal(FACTORY_STATIONS['ST-03'].title, '质检进化圣殿');
  assert.equal(FACTORY_STATIONS['ST-04'].title, '验收签批部');
  assert.equal(FACTORY_STATIONS['ST-05'].title, '项目档案部');

  // 16 staggered rack LEDs reflecting live connectivity
  const leds = buildRackLeds(
    {
      github: { connected: true, repos: [] },
      cloudflare: { connected: false },
      gemini: { configured: true },
    } as never,
    1
  );
  assert.equal(leds.length, 16);
  assert.equal(leds.find((l) => l.label === 'GH01')?.tone, 'emerald');
  assert.equal(leds.find((l) => l.label === 'CFW1')?.tone, 'slate');
  assert.equal(leds.find((l) => l.label === 'AGY1')?.tone, 'blue');

  // Rework loop activation when run has changes_requested
  const reworkSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-rework',
        createdAt: '2026-11-21T00:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '订单返工需求',
        prdContent: '内容',
        status: 'changes_requested',
        architect: {
          ambiguities: [
            { id: 'a1', title: '并发锁范围', severity: 'high', detail: '锁粒度未明确', clarificationSuggestion: '按订单ID加锁' },
          ],
          architectureSummary: 'summary',
          techDecisions: ['幂等锁'],
          apiContracts: [],
          tasks: [
            { id: 'T1', title: '锁表', module: 'db', description: 'd', dependsOn: [], acceptanceCriteria: ['c1'], estimatedComplexity: 'S' },
          ],
        },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 77, prUrl: 'https://github.com/x/77', branchName: 'autodev/feat-77', baseBranch: 'main', commitSha: 'aaa', filesCommitted: [], createdAt: '2026-11-21T00:00:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: { github: { connected: true, repos: [] }, cloudflare: { connected: true }, gemini: { configured: true } } as never,
    overviewMetrics: {
      repoFullName: 'jiangfengwhu/atd-v1',
      daily: [{ dateKey: '2026-11-21', label: '今日', total: 5, succeeded: 2, failed: 3, successRate: 40, totalTokens: 519000 }],
      summary: { overallSuccessRate: 40, totalTokens: 519000, avgDurationMinutes: 4.5 },
    } as never,
    rsiReports: [],
    rsiRules: [],
  });

  assert.equal(reworkSnap.tracks.reworkSt03ToSt02, 'rework');
  assert.equal(reworkSnap.stationStates['ST-02'].led, 'rework');
  assert.equal(reworkSnap.st02.isSparking, true);
  assert.equal(reworkSnap.workpiece?.location, 'rework_3_2');
  assert.equal(reworkSnap.st00.successRatePct, 40);
  assert.equal(reworkSnap.st00.totalTokens, 519000);
  assert.equal(reworkSnap.st01.p0Count, 1);

  // Historical delivered runs without active celebration return cleanly to idle ST-00 with zero lingering workpiece
  const deliveredRun = {
    id: 'run-done',
    createdAt: '2026-11-20T00:00:00Z',
    repoFullName: 'jiangfengwhu/atd-v1',
    defaultBranch: 'main',
    prdTitle: '已归档功能',
    prdContent: '内容',
    status: 'approved' as const,
    architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
    qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
    qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
    draftPr: { prNumber: 88, prUrl: 'https://github.com/x/88', branchName: 'autodev/feat-88', baseBranch: 'main', commitSha: 'bbb', filesCommitted: [], createdAt: '2026-11-20T00:00:00Z' },
    mergedRelease: { prNumber: 88, prUrl: 'https://github.com/x/88', mergeCommitSha: 'ccc', commitUrl: 'https://github.com/c', baseBranch: 'main', mergeMethod: 'squash' as const, mergedAt: '2026-11-20T01:00:00Z' },
  };
  const idleAfterDeliveredSnap = deriveRealFactorySnapshot({
    runs: [deliveredRun],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
  });
  assert.equal(idleAfterDeliveredSnap.activeStationId, 'ST-00');
  assert.equal(idleAfterDeliveredSnap.workpiece, null);
  assert.equal(idleAfterDeliveredSnap.justDelivered, false);
  assert.equal(idleAfterDeliveredSnap.st05.deliveredCount, 1);

  // Live in-session delivery (celebratingDeliveredRunId set) enters ST-05 archive + triggers celebration
  const deliveredSnap = deriveRealFactorySnapshot({
    runs: [deliveredRun],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
    celebratingDeliveredRunId: 'run-done',
  });
  assert.equal(deliveredSnap.activeStationId, 'ST-05');
  assert.equal(deliveredSnap.justDelivered, true);
  assert.equal(deliveredSnap.st05.deliveredCount, 1);
  assert.equal(deliveredSnap.st05.activeDrawerIndex, 0);
  assert.equal(deliveredSnap.tracks.st04ToSt05, 'passed');
});

test('factoryPipelineState: getDemoFactorySnapshot drives all 8 closed-loop stages with sparks, rework loop, stamp, and archive drawer', async () => {
  const { DEMO_PIPELINE_PHASES, getDemoFactorySnapshot } = await import(
    './factoryPipelineState'
  );
  assert.equal(DEMO_PIPELINE_PHASES.length, 8);

  // Phase 1: Coding Round 1 -> sparks active, rework dormant
  const p1 = getDemoFactorySnapshot(1);
  assert.equal(p1.st02.isSparking, true);
  assert.equal(p1.tracks.reworkSt03ToSt02, 'idle');
  assert.equal(p1.workpiece?.location, 'ST-02');

  // Phase 3: REWORK LOOP -> red conduit active, workpiece rides rework_3_2
  const p3 = getDemoFactorySnapshot(3);
  assert.equal(p3.tracks.reworkSt03ToSt02, 'rework');
  assert.equal(p3.workpiece?.location, 'rework_3_2');
  assert.equal(p3.st03.cells.some((c) => c.status === 'fail'), true);

  // Phase 4: Coding Round 2 -> sparks active with Round 2 diff patch
  const p4 = getDemoFactorySnapshot(4);
  assert.equal(p4.st02.isSparking, true);
  assert.equal(p4.st02.repairRound, 2);
  assert.ok(p4.st02.diffLines.some((l) => l.text.includes('idempotencyKey')));

  // Phase 6: ST-04 Awaiting approval -> manual stamp slams emerald APPROVED immediately
  const p6Waiting = getDemoFactorySnapshot(6, { manualStampTriggered: false });
  assert.equal(p6Waiting.st04.isAwaitingApproval, true);
  assert.equal(p6Waiting.st04.isApprovedStamped, false);
  const p6Stamped = getDemoFactorySnapshot(6, { manualStampTriggered: true });
  assert.equal(p6Stamped.st04.isAwaitingApproval, false);
  assert.equal(p6Stamped.st04.isApprovedStamped, true);
  assert.equal(p6Stamped.tracks.st04ToSt05, 'active');

  // Phase 7: ST-05 Archive -> drawer 0 slides open, count increments to 13
  const p7 = getDemoFactorySnapshot(7);
  assert.equal(p7.st05.activeDrawerIndex, 0);
  assert.equal(p7.st05.deliveredCount, 13);
  assert.equal(p7.workpiece?.location, 'ST-05');
});

test('villageConfig: zero-crossing conveyors, state-driven parcel journey, 4-season cycle, and demo/real HUD derivation work cleanly', async () => {
  const {
    CONVEYOR_JUNCTIONS,
    CONVEYOR_TRACKS,
    PARCEL_ROUTE_SEGMENTS,
    WORKSHOPS,
    computeStageJourneyProgress,
    createSeededRandom,
    deriveVillageHudState,
    evaluateAtmosphere,
    samplePolylinePoint,
  } = await import('../scene/villageConfig');
  const { getDemoFactorySnapshot, deriveRealFactorySnapshot } = await import(
    './factoryPipelineState'
  );

  // 1. 3 west cottages (SPEC/GATE/ARCHIVE) + 1 standalone NE telemetry station (BG-OPS, no conveyor) + 0 junction houses + 6 direct zero-crossing tracks
  assert.equal(WORKSHOPS.length, 4);
  assert.deepEqual(
    WORKSHOPS.map((w) => w.id),
    ['ST-01', 'ST-04', 'ST-05', 'BG-OPS']
  );
  assert.equal(WORKSHOPS.find((w) => w.id === 'BG-OPS')?.conveyorId, '');
  assert.equal(CONVEYOR_JUNCTIONS.length, 0);
  assert.equal(CONVEYOR_TRACKS.length, 6);
  assert.deepEqual(PARCEL_ROUTE_SEGMENTS['track-st01-hub'], ['track-st01-hub']);
  assert.deepEqual(PARCEL_ROUTE_SEGMENTS['track-st05-hub'], ['track-st05-hub']);
  for (const tid of ['track-st01-hub', 'track-st04-hub', 'track-st05-hub']) {
    const t = CONVEYOR_TRACKS.find((item) => item.id === tid);
    assert.ok(t, `Missing track ${tid}`);
    assert.equal(t.points[0].x, -12.65);
    assert.equal(t.points[0].y, 0.62);
  }

  // 2. State-driven one-shot parcel journey eases during transit and docks cleanly at rest
  const midTransit = computeStageJourneyProgress(1.0, 0.1, 0.9, 2.0);
  assert.equal(midTransit.inTransit, true);
  assert.ok(midTransit.progress > 0.45 && midTransit.progress < 0.55);
  const docked = computeStageJourneyProgress(3.0, 0.1, 0.9, 2.0);
  assert.equal(docked.inTransit, false);
  assert.equal(docked.progress, 0.9);

  // 3. Deterministic Mulberry32 PRNG produces identical sequences for the same seed
  const r1 = createSeededRandom(42);
  const r2 = createSeededRandom(42);
  assert.equal(r1(), r2());
  assert.equal(r1(), r2());

  // 4. Curved conveyor spline point & normalized tangent
  const track = CONVEYOR_TRACKS[0];
  const mid = samplePolylinePoint(track.points, 0.5);
  const tanLen = Math.hypot(mid.tangent.x, mid.tangent.y, mid.tangent.z);
  assert.ok(Math.abs(tanLen - 1) < 1e-4);
  assert.ok(Math.abs(mid.position.y - 0.62) < 1e-4);

  // 5. 4-Season Atmosphere presets & continuous cycle interpolation
  const day = evaluateAtmosphere('day', 0);
  assert.equal(day.nightFactor, 0);
  assert.equal(day.snowFactor, 0);
  const night = evaluateAtmosphere('night', 0);
  assert.equal(night.nightFactor, 1);
  const snow = evaluateAtmosphere('snow', 0);
  assert.equal(snow.snowFactor, 1);
  const cycleLate = evaluateAtmosphere('cycle', 29);
  assert.ok(cycleLate.snowFactor >= 0 && cycleLate.snowFactor <= 1);

  // 6. Demo mode Phase 0 transits once then docks cleanly & marks ST-01 as working
  const hudP0Moving = deriveVillageHudState(getDemoFactorySnapshot(0), 1.5, 0.8);
  assert.equal(hudP0Moving.comicBurst.visible, true);
  assert.equal(hudP0Moving.comicBurst.anchorBuilding, 'ST-01');
  assert.equal(hudP0Moving.hasActiveTransit, true);
  assert.deepEqual(hudP0Moving.workingBuildingIds, ['ST-01']);
  assert.ok(hudP0Moving.parcels.some((p) => p.isHero && p.trackId === 'track-st01-hub' && p.inTransit));

  const hudP0Docked = deriveVillageHudState(getDemoFactorySnapshot(0), 5.0, 4.0);
  assert.equal(hudP0Docked.hasActiveTransit, false);
  assert.ok(hudP0Docked.parcels.every((p) => !p.inTransit));

  // Demo Phase 3 (rework loop): ONLY AI-CODER works on rework repair (never dual AI-CLOUD + AI-CODER)
  const hudP3 = deriveVillageHudState(getDemoFactorySnapshot(3), 4.0, 1.0);
  assert.equal(hudP3.reworkActive, true);
  assert.equal(hudP3.comicBurst.visible, true);
  assert.equal(hudP3.comicBurst.tone, 'red');
  assert.equal(hudP3.comicBurst.anchorBuilding, 'AI-CLOUD');
  assert.equal(hudP3.terminal.anchorBuilding, 'AI-CLOUD');
  assert.deepEqual(hudP3.workingBuildingIds, ['AI-CODER']);

  // Demo Phase 7: 2-leg transit into ST-05 vault -> parcel disappears & village celebration triggers
  const hudP7Transit = deriveVillageHudState(getDemoFactorySnapshot(7), 9.0, 2.2);
  assert.equal(hudP7Transit.hasActiveTransit, true);
  assert.equal(hudP7Transit.parcels.length, 1);
  assert.equal(hudP7Transit.parcels[0].trackId, 'track-st05-hub');
  assert.equal(hudP7Transit.celebrationActive, false);

  const hudP7Celebrate = deriveVillageHudState(getDemoFactorySnapshot(7), 12.0, 4.2);
  assert.equal(hudP7Celebrate.activePipelinesCount, 1);
  assert.equal(hudP7Celebrate.sanctuaryCelebrate, 'coder');
  assert.equal(hudP7Celebrate.hasActiveTransit, false);
  assert.equal(hudP7Celebrate.parcels.length, 0);
  assert.equal(hudP7Celebrate.celebrationActive, true);
  assert.deepEqual(hudP7Celebrate.workingBuildingIds, ['ST-05']);

  // 7. Real production idle snapshot has ZERO phantom looping parcels & hides floating terminal card
  const realIdleSnap = deriveRealFactorySnapshot({
    runs: [],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
  });
  const realIdleHud = deriveVillageHudState(realIdleSnap, 2.0, 2.0);
  assert.equal(realIdleHud.parcels.length, 0);
  assert.equal(realIdleHud.hasActiveTransit, false);
  assert.equal(realIdleHud.terminal.visible, false);

  // 8. Real production active run drives a single state-linked parcel & marks active working buildings
  const realActiveSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-live-1',
        createdAt: '2026-11-21T00:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '实时状态需求',
        prdContent: '内容',
        status: 'changes_requested',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 91, prUrl: 'https://github.com/x/91', branchName: 'autodev/feat-91', baseBranch: 'main', commitSha: 'ddd', filesCommitted: [], createdAt: '2026-11-21T00:00:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
  });
  const realActiveMoving = deriveVillageHudState(realActiveSnap, 1.0, 0.8);
  assert.equal(realActiveMoving.parcels.length, 1);
  assert.equal(realActiveMoving.parcels[0].trackId, 'track-rework-loop');
  assert.equal(realActiveMoving.hasActiveTransit, true);
  assert.equal(realActiveMoving.terminal.visible, false);
  assert.deepEqual(realActiveMoving.workingBuildingIds, ['AI-CODER']);
  assert.equal(realActiveMoving.workingStageLabel, '返工修复中');
  assert.equal(realActiveMoving.comicBurst.visible, false);
  const realActiveDocked = deriveVillageHudState(realActiveSnap, 5.0, 4.0);
  assert.equal(realActiveDocked.hasActiveTransit, false);

  // 9. Fresh PR with older unrelated failed RSI report must stay in normal ST-02 coding (NO false QA interception popup!)
  const freshPrSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-fresh-pr',
        createdAt: '2026-11-22T02:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '全新需求 PR',
        prdContent: '内容',
        status: 'pr_created',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 92, prUrl: 'https://github.com/x/92', branchName: 'autodev/feat-92', baseBranch: 'main', commitSha: 'eee', filesCommitted: [], createdAt: '2026-11-22T02:01:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [
      {
        id: 'rep-old-failed',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 555,
        workflowName: 'AutoDev AGY Coding Runner',
        branch: 'autodev/feat-old-88',
        prNumber: 88,
        kind: 'e2e',
        status: 'failed',
        total: 10,
        passed: 9,
        failed: 1,
        skipped: 0,
        passRate: 90,
        durationMs: 12000,
        executedAt: '2026-11-21T23:00:00Z',
        summary: '9/10',
        cases: [],
      },
    ],
    rsiRules: [],
  });
  assert.equal(freshPrSnap.activeStationId, 'ST-02');
  assert.equal(freshPrSnap.tracks.reworkSt03ToSt02, 'idle');
  const freshPrHud = deriveVillageHudState(freshPrSnap, 1.0, 0.8);
  assert.deepEqual(freshPrHud.workingBuildingIds, ['AI-CODER']);
  assert.equal(freshPrHud.workingStageLabel, '编码开发中');
  assert.equal(freshPrHud.reworkActive, false);
  assert.equal(freshPrHud.comicBurst.visible, false);

  // 10. Running create_draft_pr background task displays "创建 PR 中" instead of "架构规划中"
  const creatingPrSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-planned-1',
        createdAt: '2026-11-22T03:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '待建 PR 需求',
        prdContent: '内容',
        status: 'analyzed',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [
      {
        id: 'bg-pr-1',
        kind: 'create_draft_pr',
        title: '创建 Draft PR',
        roomId: 'prd',
        status: 'running',
        progressMessage: '正在提交文档并创建 Draft PR…',
        startedAt: '2026-11-22T03:01:00Z',
        updatedAt: '2026-11-22T03:01:02Z',
      },
    ],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
  });
  assert.equal(creatingPrSnap.activeStationId, 'ST-01');
  assert.equal(creatingPrSnap.stationStates['ST-01'].statusText, '创建 PR 中');
  const creatingPrHud = deriveVillageHudState(creatingPrSnap, 1.0, 0.5);
  assert.deepEqual(creatingPrHud.workingBuildingIds, ['ST-01']);
  assert.equal(creatingPrHud.workingStageLabel, '创建 PR 中');

  // 11. After QA interception, when coding runner resumes (activeCodingActionRunning=true), ONLY AI-CODER works
  const reworkCodingSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-rework-active',
        createdAt: '2026-11-22T04:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '返工再编码需求',
        prdContent: '内容',
        status: 'pr_created',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 95, prUrl: 'https://github.com/x/95', branchName: 'autodev/feat-95', baseBranch: 'main', commitSha: 'fff', filesCommitted: [], createdAt: '2026-11-22T04:01:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [
      {
        id: 'rep-95-fail',
        repoFullName: 'jiangfengwhu/atd-v1',
        actionsRunId: 595,
        workflowName: 'AutoDev AGY Coding Runner',
        branch: 'autodev/feat-95',
        prNumber: 95,
        kind: 'e2e',
        status: 'failed',
        total: 10,
        passed: 9,
        failed: 1,
        skipped: 0,
        passRate: 90,
        durationMs: 15000,
        executedAt: '2026-11-22T04:05:00Z',
        summary: '9/10',
        cases: [],
      },
    ],
    rsiRules: [],
    activeCodingActionRunning: true,
  });
  assert.equal(reworkCodingSnap.activeStationId, 'ST-02');
  assert.equal(reworkCodingSnap.stationStates['ST-03'].led, 'idle');
  const reworkCodingHud = deriveVillageHudState(reworkCodingSnap, 1.0, 0.5);
  assert.deepEqual(reworkCodingHud.workingBuildingIds, ['AI-CODER']);
  assert.equal(reworkCodingHud.comicBurst.visible, false);

  // 12. AutoDev Plan Pipeline workflow commits channel JSON files sequentially & enforces PM/QA non-technical acceptance criteria
  const { buildAgyPlanWorkflowYaml } = await import('./workflowBuilder');
  const planYaml = buildAgyPlanWorkflowYaml('jiangfengwhu');
  assert.ok(!planYaml.includes('Promise.all([\n          postStageOutput'));
  assert.ok(planYaml.includes("await postStageOutput('architect'"));
  assert.ok(planYaml.includes("await postStageOutput('qa_spec'"));
  assert.ok(planYaml.includes("await postStageOutput('qa_critic'"));
  assert.ok(planYaml.includes('ACCEPTANCE CRITERIA RULE'));

  // 13. Coding Runner success (without previewDeployment) auto-transitions to ST-04 with 2-leg conveyor animation
  const codingDoneSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-coding-done',
        createdAt: '2026-11-22T05:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '编码完成自动签批',
        prdContent: '内容',
        status: 'pr_created',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 99, prUrl: 'https://github.com/x/99', branchName: 'autodev/feat-99', baseBranch: 'main', commitSha: '999', filesCommitted: [], createdAt: '2026-11-22T05:01:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
    activeCodingActionRunning: false,
    latestCodingActionConclusion: 'success',
  });
  assert.equal(codingDoneSnap.activeStationId, 'ST-04');
  assert.equal(codingDoneSnap.st04.isAwaitingApproval, true);
  const st04Leg1 = deriveVillageHudState(codingDoneSnap, 1.0, 0.5);
  assert.equal(st04Leg1.hasActiveTransit, true);
  assert.equal(st04Leg1.parcels[0].trackId, 'track-hub-coder');
  const st04Leg2 = deriveVillageHudState(codingDoneSnap, 2.5, 2.2);
  assert.equal(st04Leg2.hasActiveTransit, true);
  assert.equal(st04Leg2.parcels[0].trackId, 'track-st04-hub');
  const st04Docked = deriveVillageHudState(codingDoneSnap, 6.0, 4.0);
  assert.equal(st04Docked.hasActiveTransit, false);
  assert.deepEqual(st04Docked.workingBuildingIds, ['ST-04']);

  // 14. Live in-session launch animates ST-04 -> ST-00 -> ST-05 vault -> hides parcel -> celebrates -> completes cleanly
  const liveLaunchSnap = deriveRealFactorySnapshot({
    runs: [
      {
        id: 'run-live-launch',
        createdAt: '2026-11-22T06:00:00Z',
        repoFullName: 'jiangfengwhu/atd-v1',
        defaultBranch: 'main',
        prdTitle: '上线庆祝需求',
        prdContent: '内容',
        status: 'approved',
        architect: { ambiguities: [], architectureSummary: '', techDecisions: [], apiContracts: [], tasks: [] },
        qaSpec: { apiTestChecklist: [], e2eTestCode: '', coverageNotes: [] },
        qaCritic: { reviewSummary: '', findings: [], finalApiTestChecklist: [], finalE2eTestCode: '' },
        draftPr: { prNumber: 100, prUrl: 'https://github.com/x/100', branchName: 'autodev/feat-100', baseBranch: 'main', commitSha: '100', filesCommitted: [], createdAt: '2026-11-22T06:01:00Z' },
        mergedRelease: { prNumber: 100, prUrl: 'https://github.com/x/100', mergeCommitSha: '101', commitUrl: 'https://github.com/101', baseBranch: 'main', mergeMethod: 'squash', mergedAt: '2026-11-22T06:10:00Z' },
      },
    ],
    analysisJob: null,
    backgroundTasks: [],
    status: null,
    overviewMetrics: null,
    rsiReports: [],
    rsiRules: [],
    celebratingDeliveredRunId: 'run-live-launch',
  });
  const launchLeg1 = deriveVillageHudState(liveLaunchSnap, 1.0, 0.5);
  assert.equal(launchLeg1.hasActiveTransit, true);
  assert.equal(launchLeg1.parcels[0].trackId, 'track-st04-hub');
  assert.equal(launchLeg1.celebrationActive, false);
  const launchLeg2 = deriveVillageHudState(liveLaunchSnap, 2.5, 2.2);
  assert.equal(launchLeg2.hasActiveTransit, true);
  assert.equal(launchLeg2.parcels[0].trackId, 'track-st05-hub');
  const launchCelebrate = deriveVillageHudState(liveLaunchSnap, 5.0, 4.5);
  assert.equal(launchCelebrate.hasActiveTransit, false);
  assert.equal(launchCelebrate.parcels.length, 0);
  assert.equal(launchCelebrate.celebrationActive, true);
  assert.equal(launchCelebrate.celebrationDone, false);
  const launchFinished = deriveVillageHudState(liveLaunchSnap, 11.0, 9.5);
  assert.equal(launchFinished.celebrationActive, false);
  assert.equal(launchFinished.celebrationDone, true);
  assert.equal(launchFinished.parcels.length, 0);
});




