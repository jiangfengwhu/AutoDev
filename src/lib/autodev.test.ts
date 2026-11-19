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

test('validatePrdInput enforces non-empty repo, title, and detailed PRD content', () => {
  const emptyRes = validatePrdInput({
    repoFullName: '',
    prdTitle: 'ab',
    prdContent: 'too short',
  });
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.errors.repoFullName);
  assert.ok(emptyRes.errors.prdTitle);
  assert.ok(emptyRes.errors.prdContent);

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

  const parsedSpec = JSON.parse(artifacts.specJsonContent);
  assert.equal(parsedSpec.runId, 'run-001');
  assert.equal(parsedSpec.e2eTestPath, 'tests/e2e/run-001.spec.ts');
  assert.equal(parsedSpec.archivedSpecPath, 'docs/iterations/run-001-spec.json');
  assert.equal(parsedSpec.tasks.length, 1);
  assert.ok(artifacts.prdMdContent.includes('退款后优惠券是否返还未定义'));
  assert.ok(artifacts.e2eTestContent.includes('AUTODEV-READONLY-TEST-CONTRACT'));
  assert.ok(artifacts.prBody.includes('TASK-1'));
  assert.ok(artifacts.prBody.includes('tests/e2e/run-001.spec.ts'));

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

test('buildAgyRunnerWorkflowYaml locks self-hosted vps-agy runner, owner actor guard, and e2e hash check', async () => {
  const {
    AUTODEV_LIVE_LOG_ISSUE_TITLE,
    buildAgyRunnerWorkflowYaml,
    buildCloudflareDeployWorkflowYaml,
    DEFAULT_CLOUDFLARE_TECH_STACK,
    FIXED_TARGET_REPO,
    resolveEffectiveTechStack,
  } = await import('./workflowBuilder');
  assert.equal(FIXED_TARGET_REPO.fullName, 'jiangfengwhu/atd-v1');
  const yaml = buildAgyRunnerWorkflowYaml('jiangfengwhu');
  assert.ok(yaml.includes('runs-on: [self-hosted, linux, x64, vps-agy]'));
  assert.ok(yaml.includes("github.actor == 'jiangfengwhu'"));
  assert.ok(yaml.includes('group: autodev-agy-single-queue'));
  assert.ok(yaml.includes('e2e_test_path:'));
  assert.ok(yaml.includes('revision_note:'));
  assert.ok(yaml.includes('uses: actions/checkout@v7'));
  assert.ok(yaml.includes("'--print=' + prompt"));
  assert.ok(!yaml.includes('--mode auto'), 'Must remove deprecated unsupported --mode auto flag');
  assert.ok(!yaml.includes('agy --print \\'));
  assert.ok(yaml.includes('sha256sum'));
  assert.ok(yaml.includes("find tests/e2e -type f -name '*.spec.ts'"));
  assert.ok(yaml.includes('sha256sum -c'));
  assert.ok(yaml.includes('issues: write'));
  assert.ok(yaml.includes('echo "Workspace CWD: $(pwd)"'));
  assert.ok(yaml.includes(AUTODEV_LIVE_LOG_ISSUE_TITLE));
  assert.ok(yaml.includes("<<'COMMENT_EOF'"));
  assert.ok(yaml.includes('--body-file /tmp/autodev-pr-summary.md'));
  assert.ok(!yaml.includes('BODY="### AutoDev'));

  // Verify embedded Outer-Loop Harness JS script has valid ESM syntax and core invariants
  const harnessMatch = yaml.match(/<<'OUTER_HARNESS_EOF'\n([\s\S]*?)\n\s*OUTER_HARNESS_EOF/);
  assert.ok(harnessMatch, 'Expected embedded Outer-Loop Harness script');
  const harnessCode = harnessMatch[1].replace(/^ {10}/gm, '');
  assert.ok(harnessCode.includes('process.cwd()'));
  assert.ok(harnessCode.includes('AUTODEV-LIVE-LOG:'));
  assert.ok(harnessCode.includes('.autodev-agent-done.json'));
  assert.ok(harnessCode.includes('.autodev-verify-feedback.md'));
  assert.ok(harnessCode.includes('killProcessGroup'));
  assert.ok(harnessCode.includes('runDeterministicVerification'));
  assert.ok(harnessCode.includes('DO NOT run `npx playwright test`'));
  assert.ok(harnessCode.includes("'--output-format', 'stream-json'"));
  assert.ok(yaml.includes('npm ci --no-audit --no-fund'));
  assert.ok(yaml.includes("ROUND_TIMEOUT_MINUTES: '9'"));
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
  assert.ok(runnerCode.includes('invokeAgyAsync') && !runnerCode.includes('spawnSync'), 'Must use async spawn to keep event loop alive');
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
  assert.ok(agyYaml.includes('OUTER_HARNESS_EOF'));
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

  // 5. autodev-agy.yml includes Outer-Loop Harness, Sentinel Watchdog, 4-Gate Deterministic Verifier, id: agy, CI=true, and session_mode
  const { buildAgyRunnerWorkflowYaml } = await import('./workflowBuilder');
  const yaml = buildAgyRunnerWorkflowYaml('jiangfengwhu');
  assert.ok(yaml.includes('id: agy'));
  assert.ok(yaml.includes('session_mode:'));
  assert.ok(yaml.includes('resume_session_id:'));
  assert.ok(yaml.includes("CI: 'true'"));
  assert.ok(yaml.includes("PLAYWRIGHT_HTML_OPEN: 'never'"));
  assert.ok(yaml.includes("MAX_ROUNDS: '3'"));
  assert.ok(yaml.includes("ROUND_TIMEOUT_MINUTES: '9'"));
  assert.ok(yaml.includes('Execute AGY Outer-Loop Harness'));
  assert.ok(yaml.includes('steps.agy.outputs.rounds_executed'));
  assert.ok(yaml.includes('steps.agy.outputs.passed_count'));
});


