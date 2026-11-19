import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  cancelGitHubActionRun,
  checkGitHubIntegration,
  commitRevisionFeedbackToBranch,
  commitRsiGuidelinesToBranch,
  createSpecDraftPr,
  dispatchAgyWorkflow,
  dispatchCloudflareDeployWorkflow,
  ensureWorkflowsUpToDate,
  fetchRepoContextSnapshot,
  getGitHubActionRunDetail,
  listGitHubActionRuns,
  listOpenAutodevPrs,
  listSelfHostedRunners,
  mergeDraftPrToMain,
  postPrApprovalComment,
  syncAgyWorkflowFile,
} from './server/githubService';
import { checkCloudflareIntegration } from './server/cloudflareService';
import { deployBranchPreviewToCloudflare } from './server/cloudflareDeployService';
import {
  GEMINI_AGENT_MODEL,
  runArchitectAgent,
  runQaCriticAgent,
  runQaSpecAgent,
} from './server/agentOrchestrator';
import {
  attachDraftPrToRun,
  attachPreviewDeploymentToRun,
  getRunById,
  listRuns,
  saveRun,
  updateRunReview,
} from './server/runStore';
import {
  cancelAnalysisJob,
  createAndStartAnalysisJob,
  getAnalysisJobById,
  getLatestAnalysisJob,
  getRunningAnalysisJob,
  listAnalysisJobs,
  resumeRunningVpsPlanJobs,
} from './server/analysisJobStore';
import {
  createManualRsiRule,
  deleteRsiRule,
  getRsiState,
  listAllRsiRules,
  recordRulesAppliedForStage,
  updateRsiRule,
} from './server/rsiStore';
import {
  captureAndReflectIncident,
  consolidateRsiRulesWithGemini,
  runAttributionForIncident,
  syncRepoTestReportsAndFailures,
} from './server/rsiService';
import { appendAuditLog, listAuditLogs } from './server/auditLogStore';
import { parseRepoFullName, validatePrdInput } from './src/lib/taskGraph';
import { buildPrArtifacts } from './src/lib/specBuilder';
import {
  buildRevisionFeedbackMarkdown,
  evaluateSingleTaskLock,
} from './src/lib/iterationContext';
import { buildSevenDayOverviewMetrics } from './src/lib/overviewMetrics';
import { buildRequirementsBoardData } from './src/lib/requirementsBoard';
import { decideAgySessionPolicy } from './src/lib/sessionReuse';
import {
  aggregateQualityAndRsiMetrics,
  buildRsiGuidelinesMarkdown,
  computeRsiPromptBudgetUsage,
  formatRsiPromptBlock,
  type FailureIncidentSource,
  type RsiRootCauseCategory,
  type RsiRuleSeverity,
  type RsiRuleStatus,
  type RsiTargetStage,
} from './src/lib/rsiEngine';
import { FIXED_TARGET_REPO } from './src/lib/workflowBuilder';
import type {
  AnalysisSseEvent,
  IntegrationsStatusResponse,
  PipelineRun,
  ReworkDispatchResult,
} from './src/types/autodev';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Module 1: Environment connectivity status
  app.get('/api/integrations/status', async (_req, res) => {
    const [github, cloudflare] = await Promise.all([
      checkGitHubIntegration(),
      checkCloudflareIntegration(),
    ]);

    const payload: IntegrationsStatusResponse = {
      github,
      cloudflare,
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        model: GEMINI_AGENT_MODEL,
        checkedAt: new Date().toISOString(),
      },
    };

    res.json(payload);
  });

  // List stored pipeline runs
  app.get('/api/runs', (_req, res) => {
    res.json({ runs: listRuns() });
  });

  // Module 1: 7-day global R&D efficiency overview metrics (real GitHub Actions + local jobs/runs)
  app.get('/api/overview/metrics', async (req, res) => {
    const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '缺少有效的 repo 参数（owner/repo）' });
      return;
    }

    try {
      const actionsRes = await listGitHubActionRuns(parsed.owner, parsed.name, 100);
      const metrics = buildSevenDayOverviewMetrics({
        repoFullName: parsed.fullName,
        actionRuns: actionsRes.runs,
        analysisJobs: listAnalysisJobs(),
        pipelineRuns: listRuns(),
        githubConnected: actionsRes.connected,
      });
      res.json(metrics);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '拉取最近 7 日研发效能指标失败',
      });
    }
  });

  // Helper to build full RSI & Test Quality dashboard payload
  function buildRsiDashboardPayload() {
    const state = getRsiState();
    const aggregated = aggregateQualityAndRsiMetrics(state);
    return {
      ...state,
      ...aggregated,
      budget: computeRsiPromptBudgetUsage(state.rules),
      effectivePrompts: {
        architect: formatRsiPromptBlock(state.rules, 'architect'),
        qa_spec: formatRsiPromptBlock(state.rules, 'qa_spec'),
        qa_critic: formatRsiPromptBlock(state.rules, 'qa_critic'),
        coding: formatRsiPromptBlock(state.rules, 'coding'),
      },
    };
  }

  // Module 3: Requirements Board (historical requirements, status funnel, KPIs & manual audit logs)
  app.get('/api/requirements/board', (_req, res) => {
    const payload = buildRequirementsBoardData({
      runs: listRuns(),
      jobs: listAnalysisJobs(),
      auditLogs: listAuditLogs(),
      testReports: getRsiState().testReports,
    });
    res.json(payload);
  });

  // Module 6: Quality visualization & RSI state
  app.get('/api/rsi/state', (_req, res) => {
    res.json(buildRsiDashboardPayload());
  });

  // Module 5: Sync real completed GitHub Actions test reports & auto-attribute failures via Gemini RSI
  app.post('/api/rsi/sync', async (req, res) => {
    const repoParam = String(req.body?.repoFullName || req.query.repo || FIXED_TARGET_REPO.fullName);
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '无效的目标仓库标识（owner/repo）' });
      return;
    }

    const rawLimit = req.body?.autoAnalyzeLimit;
    const autoAnalyzeLimit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.max(0, Math.min(10, Math.floor(rawLimit)))
        : 4;

    try {
      const syncResult = await syncRepoTestReportsAndFailures(parsed.owner, parsed.name, {
        autoAnalyzeLimit,
      });
      appendAuditLog({
        category: 'quality',
        action: 'rsi_sync_triggered',
        repoFullName: parsed.fullName,
        detail: `同步 ${syncResult.syncedReportsCount} 份测试报告，新增 ${syncResult.newIncidentsCount} 条异常，完成 ${syncResult.analyzedCount} 次 AI 归因`,
      });
      res.json({
        syncResult,
        state: buildRsiDashboardPayload(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '同步测试报告与失败归因失败',
      });
    }
  });

  // Module 5: Manually record an incident (test/env/acceptance issue) and immediately run RSI reflection
  app.post('/api/rsi/incidents', async (req, res) => {
    const {
      repoFullName,
      source,
      title,
      errorSummary,
      rawEvidence,
      branch,
      relatedRunId,
    } = req.body ?? {};
    const cleanTitle = String(title ?? '').trim();
    const cleanSummary = String(errorSummary ?? '').trim();
    if (cleanTitle.length < 3 || cleanSummary.length < 5) {
      res.status(400).json({ error: '请填写事件标题与错误详情（至少 5 个字符）。' });
      return;
    }

    const validSources: FailureIncidentSource[] = [
      'test_failure',
      'ci_env_error',
      'plan_error',
      'deploy_error',
      'manual_acceptance',
      'manual_report',
    ];
    const resolvedSource: FailureIncidentSource = validSources.includes(source)
      ? source
      : 'manual_report';

    try {
      const result = await captureAndReflectIncident({
        sourceRefKey: `manual:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
        source: resolvedSource,
        repoFullName: String(repoFullName || FIXED_TARGET_REPO.fullName),
        title: cleanTitle,
        errorSummary: cleanSummary,
        rawEvidence: String(rawEvidence || cleanSummary),
        branch: branch ? String(branch).trim() : undefined,
        relatedRunId: relatedRunId ? String(relatedRunId) : undefined,
        waitForAnalysis: true,
      });

      appendAuditLog({
        category: 'quality',
        action: 'rsi_incident_reported',
        repoFullName: String(repoFullName || FIXED_TARGET_REPO.fullName),
        runId: relatedRunId ? String(relatedRunId) : undefined,
        branch: branch ? String(branch).trim() : undefined,
        detail: `手动上报异常「${cleanTitle}」${
          result.incident.attribution?.shouldCodifyAsRule ? '（已沉淀为 RSI 规则）' : ''
        }`,
      });

      res.status(201).json({
        ...result,
        state: buildRsiDashboardPayload(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '记录并归因异常事件失败',
      });
    }
  });

  // Module 5: Trigger or re-run Gemini RSI attribution + gemini-decision-1 gate for a specific incident
  app.post('/api/rsi/incidents/:id/analyze', async (req, res) => {
    try {
      const result = await runAttributionForIncident(req.params.id);
      res.json({
        ...result,
        state: buildRsiDashboardPayload(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'RSI 归因分析失败',
      });
    }
  });

  // Module 5: AI distillation & consolidation of RSI rules to prevent System Prompt bloat
  app.post('/api/rsi/consolidate', async (_req, res) => {
    try {
      const consolidation = await consolidateRsiRulesWithGemini();
      appendAuditLog({
        category: 'quality',
        action: 'rsi_rule_mutated',
        repoFullName: FIXED_TARGET_REPO.fullName,
        detail: `AI 蒸馏压缩 RSI 规则：${consolidation.beforeCount} 条 -> ${consolidation.afterCount} 条（${consolidation.summary}）`,
      });
      res.json({
        consolidation,
        state: buildRsiDashboardPayload(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'AI 蒸馏压缩 RSI 规则失败',
      });
    }
  });

  // Module 5: Manually add an RSI System Prompt rule
  app.post('/api/rsi/rules', (req, res) => {
    const { title, targetStage, severity, promptDirective, rootCauseCategory } = req.body ?? {};
    const cleanTitle = String(title ?? '').trim();
    const cleanDirective = String(promptDirective ?? '').trim();
    if (cleanTitle.length < 2 || cleanDirective.length < 8) {
      res.status(400).json({ error: '请填写规则标题与完整的 System Prompt 指令内容。' });
      return;
    }

    const validStages: RsiTargetStage[] = ['all', 'architect', 'qa_spec', 'qa_critic', 'coding'];
    const validSeverities: RsiRuleSeverity[] = ['critical', 'recommended'];
    const validCats: RsiRootCauseCategory[] = [
      'test_assertion',
      'env_infra',
      'contract_mismatch',
      'ui_ux_acceptance',
      'build_typecheck',
      'ci_workflow',
    ];

    const rule = createManualRsiRule({
      title: cleanTitle,
      targetStage: validStages.includes(targetStage) ? targetStage : 'all',
      severity: validSeverities.includes(severity) ? severity : 'recommended',
      promptDirective: cleanDirective,
      rootCauseCategory: validCats.includes(rootCauseCategory) ? rootCauseCategory : 'env_infra',
    });

    appendAuditLog({
      category: 'quality',
      action: 'rsi_rule_mutated',
      repoFullName: FIXED_TARGET_REPO.fullName,
      detail: `新增 RSI 规则「${rule.title}」（阶段：${rule.targetStage}）`,
    });

    res.status(201).json({
      rule,
      state: buildRsiDashboardPayload(),
    });
  });

  // Module 5: Toggle or edit an RSI System Prompt rule
  app.patch('/api/rsi/rules/:id', (req, res) => {
    const { title, targetStage, severity, status, promptDirective, rootCauseCategory } =
      req.body ?? {};
    const patch: {
      title?: string;
      targetStage?: RsiTargetStage;
      severity?: RsiRuleSeverity;
      status?: RsiRuleStatus;
      promptDirective?: string;
      rootCauseCategory?: RsiRootCauseCategory;
    } = {};

    if (typeof title === 'string' && title.trim()) patch.title = title;
    if (typeof promptDirective === 'string' && promptDirective.trim()) {
      patch.promptDirective = promptDirective;
    }
    if (
      status === 'active' ||
      status === 'candidate' ||
      status === 'paused' ||
      status === 'archived'
    ) {
      patch.status = status;
    }
    if (severity === 'critical' || severity === 'recommended') patch.severity = severity;
    if (['all', 'architect', 'qa_spec', 'qa_critic', 'coding'].includes(targetStage)) {
      patch.targetStage = targetStage;
    }
    if (
      [
        'test_assertion',
        'env_infra',
        'contract_mismatch',
        'ui_ux_acceptance',
        'build_typecheck',
        'ci_workflow',
      ].includes(rootCauseCategory)
    ) {
      patch.rootCauseCategory = rootCauseCategory;
    }

    const updated = updateRsiRule(req.params.id, patch);
    if (!updated) {
      res.status(404).json({ error: '未找到对应的 RSI 规则' });
      return;
    }
    const statusLabelMap: Record<RsiRuleStatus, string> = {
      active: '生效中',
      candidate: '待观察',
      paused: '已暂停',
      archived: '已归档',
    };
    appendAuditLog({
      category: 'quality',
      action: 'rsi_rule_mutated',
      repoFullName: FIXED_TARGET_REPO.fullName,
      detail: `更新 RSI 规则「${updated.title}」（状态：${statusLabelMap[updated.status]}）`,
    });
    res.json({
      rule: updated,
      state: buildRsiDashboardPayload(),
    });
  });

  // Module 5: Delete an RSI System Prompt rule
  app.delete('/api/rsi/rules/:id', (req, res) => {
    const deleted = deleteRsiRule(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: '未找到对应的 RSI 规则' });
      return;
    }
    appendAuditLog({
      category: 'quality',
      action: 'rsi_rule_mutated',
      repoFullName: FIXED_TARGET_REPO.fullName,
      detail: `删除 RSI 规则 (${req.params.id})`,
    });
    res.json({
      deleted: true,
      state: buildRsiDashboardPayload(),
    });
  });

  // Single-task lock & live main-branch repository context helper
  async function computeIterationLockStatus(owner: string, repo: string, branch = 'main') {
    const runningJob = getRunningAnalysisJob();
    const [openAutodevPrs, actionsRes, repoContext] = await Promise.all([
      listOpenAutodevPrs(owner, repo),
      listGitHubActionRuns(owner, repo),
      fetchRepoContextSnapshot(owner, repo, branch),
    ]);
    const activeActionRuns = (actionsRes.runs || []).filter(
      (r) => r.status === 'in_progress' || r.status === 'queued'
    );
    return evaluateSingleTaskLock({
      runningAnalysisJob: runningJob
        ? { id: runningJob.id, prdTitle: runningJob.prdTitle }
        : null,
      openAutodevPrs,
      activeActionRuns: activeActionRuns.map((r) => ({
        id: r.id,
        name: r.name,
        headBranch: r.headBranch,
        htmlUrl: r.htmlUrl,
      })),
      repoContext,
    });
  }

  // Module 2: Query single-task serial lock + live main context snapshot
  app.get('/api/github/iteration-lock', async (req, res) => {
    const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
    const branchParam = String(req.query.branch || FIXED_TARGET_REPO.defaultBranch).trim() || 'main';
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '缺少有效的 repo 参数（owner/repo）' });
      return;
    }

    try {
      const lockStatus = await computeIterationLockStatus(parsed.owner, parsed.name, branchParam);
      res.json(lockStatus);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '拉取迭代门禁与仓库上下文失败',
      });
    }
  });

  // Module 2: Background server-side 3-Agent analysis jobs (runs on Instabox VPS AGY via autodev-plan.yml)
  app.post('/api/agents/jobs', async (req, res) => {
    const {
      repoFullName,
      defaultBranch,
      prdTitle,
      prdContent,
      techStackHint,
      agyModel,
      executionMode,
      forceOverride,
    } = req.body ?? {};
    const validation = validatePrdInput({
      repoFullName: String(repoFullName ?? ''),
      prdTitle: String(prdTitle ?? ''),
      prdContent: String(prdContent ?? ''),
    });

    if (!validation.valid) {
      res.status(400).json({
        error: '需求表单校验未通过，请补充完整标题与 PRD 正文。',
        fieldErrors: validation.errors,
      });
      return;
    }

    const parsedRepo = parseRepoFullName(String(repoFullName))!;
    const resolvedBranch = String(defaultBranch || 'main').trim() || 'main';

    // Single-task serial lock check (guarantees max 1 active iteration so main context stays fresh)
    if (!forceOverride) {
      try {
        const lockStatus = await computeIterationLockStatus(
          parsedRepo.owner,
          parsedRepo.name,
          resolvedBranch
        );
        if (lockStatus.locked) {
          const primaryReason = lockStatus.reasons[0];
          res.status(409).json({
            error: `当前仓库存在进行中的迭代任务（${primaryReason.title}）。请先完成合并/关闭当前任务后再启动下一轮，以确保基于最新 main 代码上下文迭代。`,
            lockStatus,
          });
          return;
        }
      } catch {
        // Non-fatal if GitHub API temporarily unreachable; analysisJobStore still enforces local lock
      }
    }

    try {
      const job = createAndStartAnalysisJob({
        repoFullName: parsedRepo.fullName,
        defaultBranch: resolvedBranch,
        prdTitle: String(prdTitle).trim(),
        prdContent: String(prdContent).trim(),
        techStackHint: techStackHint ? String(techStackHint).trim() : undefined,
        agyModel: agyModel ? String(agyModel).trim() : undefined,
        executionMode: executionMode === 'gemini_api' ? 'gemini_api' : 'vps_agy',
      });
      appendAuditLog({
        category: 'planning',
        action: 'prd_analysis_started',
        repoFullName: job.repoFullName,
        jobId: job.id,
        prdTitle: job.prdTitle,
        branch: job.defaultBranch,
        detail: `发起需求三阶段规划（引擎：${
          job.executionMode === 'gemini_api' ? 'Gemini API' : 'Instabox VPS AGY'
        }${job.agyModel ? ` / ${job.agyModel}` : ''}）`,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : '无法启动分析任务',
      });
    }
  });

  app.get('/api/agents/jobs/latest', (_req, res) => {
    res.json({ job: getLatestAnalysisJob() ?? null });
  });

  app.get('/api/agents/jobs/:id', (req, res) => {
    const job = getAnalysisJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: '未找到该分析任务' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/agents/jobs/:id/cancel', async (req, res) => {
    const cancelled = await cancelAnalysisJob(req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: '未找到该分析任务' });
      return;
    }
    appendAuditLog({
      category: 'planning',
      action: 'prd_analysis_cancelled',
      repoFullName: cancelled.repoFullName,
      jobId: cancelled.id,
      prdTitle: cancelled.prdTitle,
      branch: cancelled.defaultBranch,
      detail: `手动取消进行中的规划任务「${cancelled.prdTitle}」`,
    });
    res.json({ job: cancelled });
  });

  // Legacy SSE endpoint kept cleanly without liveLogStore dependency
  app.post('/api/agents/analyze', async (req, res) => {
    const { repoFullName, defaultBranch, prdTitle, prdContent, techStackHint } = req.body ?? {};

    const validation = validatePrdInput({
      repoFullName: String(repoFullName ?? ''),
      prdTitle: String(prdTitle ?? ''),
      prdContent: String(prdContent ?? ''),
    });

    if (!validation.valid) {
      res.status(400).json({
        error: '输入校验未通过',
        fieldErrors: validation.errors,
      });
      return;
    }

    const parsedRepo = parseRepoFullName(String(repoFullName))!;
    const resolvedBranch = String(defaultBranch || 'main').trim() || 'main';
    const runId = `run-${crypto.randomBytes(4).toString('hex')}`;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: AnalysisSseEvent) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    const agentInput = {
      repoFullName: parsedRepo.fullName,
      defaultBranch: resolvedBranch,
      prdTitle: String(prdTitle).trim(),
      prdContent: String(prdContent).trim(),
      techStackHint: techStackHint ? String(techStackHint).trim() : undefined,
    };

    let currentStep: 'architect' | 'qa_spec' | 'qa_critic' = 'architect';

    try {
      // Step 1: Architect Agent
      currentStep = 'architect';
      const t1 = Date.now();
      sendEvent({
        type: 'step_start',
        step: 'architect',
        message: 'Architect Agent 正在审查 PRD 逻辑漏洞并生成架构方案与任务依赖树…',
        timestamp: new Date().toISOString(),
      });
      const architect = await runArchitectAgent(agentInput);
      const d1 = Date.now() - t1;
      sendEvent({
        type: 'step_complete',
        step: 'architect',
        durationMs: d1,
        data: architect,
        timestamp: new Date().toISOString(),
      });

      // Step 2: QA Spec Agent
      currentStep = 'qa_spec';
      const t2 = Date.now();
      sendEvent({
        type: 'step_start',
        step: 'qa_spec',
        message: 'QA Spec Agent 正在基于 PRD 与公开接口契约编写初版 Playwright E2E 测试集…',
        timestamp: new Date().toISOString(),
      });
      const qaSpec = await runQaSpecAgent(agentInput, architect.apiContracts);
      const d2 = Date.now() - t2;
      sendEvent({
        type: 'step_complete',
        step: 'qa_spec',
        durationMs: d2,
        data: qaSpec,
        timestamp: new Date().toISOString(),
      });

      // Step 3: QA Critic Agent
      currentStep = 'qa_critic';
      const t3 = Date.now();
      sendEvent({
        type: 'step_start',
        step: 'qa_critic',
        message: 'QA Critic Agent 正在严格评审边界条件并产出终版只读测试集…',
        timestamp: new Date().toISOString(),
      });
      const qaCritic = await runQaCriticAgent(agentInput, architect.apiContracts, qaSpec);
      const d3 = Date.now() - t3;
      sendEvent({
        type: 'step_complete',
        step: 'qa_critic',
        durationMs: d3,
        data: qaCritic,
        timestamp: new Date().toISOString(),
      });

      const run: PipelineRun = {
        id: runId,
        createdAt: new Date().toISOString(),
        repoFullName: parsedRepo.fullName,
        defaultBranch: resolvedBranch,
        prdTitle: agentInput.prdTitle,
        prdContent: agentInput.prdContent,
        techStackHint: agentInput.techStackHint,
        architect,
        qaSpec,
        qaCritic,
        status: 'analyzed',
        checkedCriteriaIds: [],
      };

      saveRun(run);
      sendEvent({
        type: 'pipeline_complete',
        run,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '多智能体执行失败';
      sendEvent({
        type: 'error',
        step: currentStep,
        message: errMsg,
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // Module 2 -> GitHub: Commit versioned specs & non-overwriting tests/e2e/<runId>.spec.ts & create Draft PR
  app.post('/api/github/create-draft-pr', async (req, res) => {
    try {
      const { runId, runPayload, baseBranch, forceOverride } = req.body ?? {};
      let run: PipelineRun | undefined = runId ? getRunById(String(runId)) : undefined;

      if (!run && runPayload && typeof runPayload === 'object') {
        run = saveRun(runPayload as PipelineRun);
      }

      if (!run) {
        res.status(404).json({ error: '未找到对应的需求分析记录，请重新执行架构分析。' });
        return;
      }

      const parsedRepo = parseRepoFullName(run.repoFullName);
      if (!parsedRepo) {
        res.status(400).json({ error: `无效的目标仓库格式：${run.repoFullName}` });
        return;
      }

      if (!forceOverride) {
        const openPrs = await listOpenAutodevPrs(parsedRepo.owner, parsedRepo.name);
        if (openPrs.length > 0) {
          res.status(409).json({
            error: `仓库已有未合入的迭代 PR #${openPrs[0].number}（${openPrs[0].headBranch}），单任务串行模式下请先完成或关闭该 PR 再创建新 Draft PR。`,
            openPr: openPrs[0],
          });
          return;
        }
      }

      const artifacts = buildPrArtifacts(run);
      const draftPr = await createSpecDraftPr({
        owner: parsedRepo.owner,
        repo: parsedRepo.name,
        baseBranch: baseBranch ? String(baseBranch) : run.defaultBranch,
        artifacts,
      });

      // Auto-inject active RSI engineering guardrails into the PR branch for VPS AGY Coding Runner
      const rsiGuidelinesMd = buildRsiGuidelinesMarkdown(listAllRsiRules());
      if (rsiGuidelinesMd) {
        try {
          await commitRsiGuidelinesToBranch({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            branchName: draftPr.branchName,
            markdownContent: rsiGuidelinesMd,
          });
          recordRulesAppliedForStage('coding');
        } catch (rsiErr) {
          console.warn('[AutoDev RSI] Failed to write docs/rsi-guidelines.md on Draft PR:', rsiErr);
        }
      }

      const updatedRun = attachDraftPrToRun(run.id, draftPr) || {
        ...run,
        status: 'pr_created' as const,
        draftPr,
      };

      appendAuditLog({
        category: 'planning',
        action: 'draft_pr_created',
        repoFullName: run.repoFullName,
        runId: run.id,
        prdTitle: run.prdTitle,
        branch: draftPr.branchName,
        prNumber: draftPr.prNumber,
        detail: `创建规格 Draft PR #${draftPr.prNumber}（特性分支 ${draftPr.branchName}，提交 ${draftPr.commitSha.slice(0, 7)}）`,
      });

      res.json({
        draftPr,
        run: updatedRun,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '创建 GitHub Draft PR 失败',
      });
    }
  });

  // Module 3: Query recent GitHub Actions workflow runs for selected repo
  app.get('/api/github/actions-runs', async (req, res) => {
    const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '缺少有效的 repo 参数（owner/repo）' });
      return;
    }

    const result = await listGitHubActionRuns(parsed.owner, parsed.name);
    res.json(result);
  });

  // Module 3: Inspect jobs & log tail for a specific GitHub Actions run
  app.get('/api/github/actions-runs/:runId', async (req, res) => {
    try {
      const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
      const parsed = parseRepoFullName(repoParam);
      const runId = Number(req.params.runId);
      if (!parsed || !Number.isFinite(runId)) {
        res.status(400).json({ error: '无效的 repo 或 runId 参数' });
        return;
      }

      const detail = await getGitHubActionRunDetail(parsed.owner, parsed.name, runId);
      res.json(detail);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '拉取 Actions 日志失败',
      });
    }
  });

  // Module 3: Cancel an in-progress or queued GitHub Actions run
  app.post('/api/github/actions-runs/:runId/cancel', async (req, res) => {
    try {
      const repoParam = String(req.body?.repoFullName || req.query.repo || FIXED_TARGET_REPO.fullName);
      const parsed = parseRepoFullName(repoParam);
      const runId = Number(req.params.runId);
      if (!parsed || !Number.isFinite(runId)) {
        res.status(400).json({ error: '无效的 repo 或 runId 参数' });
        return;
      }

      const result = await cancelGitHubActionRun(parsed.owner, parsed.name, runId);
      appendAuditLog({
        category: 'execution',
        action: 'actions_run_cancelled',
        repoFullName: parsed.fullName,
        detail: `手动取消 GitHub Actions 任务 #${runId}`,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '取消 GitHub Actions 任务失败',
      });
    }
  });

  // Module 1 & 3: Query Self-Hosted Runners, workflow presence, and branches for target repo
  app.get('/api/github/runners', async (req, res) => {
    const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '缺少有效的 repo 参数（owner/repo）' });
      return;
    }

    const result = await listSelfHostedRunners(parsed.owner, parsed.name);
    res.json({
      repoFullName: parsed.fullName,
      ...result,
    });
  });

  // Module 1: Commit or update .github/workflows/autodev-agy.yml on target repo default branch
  app.post('/api/github/setup-workflow', async (req, res) => {
    try {
      const repoParam = String(req.body?.repoFullName || FIXED_TARGET_REPO.fullName);
      const baseBranch = req.body?.baseBranch ? String(req.body.baseBranch) : undefined;
      const parsed = parseRepoFullName(repoParam);
      if (!parsed) {
        res.status(400).json({ error: '无效的仓库标识（owner/repo）' });
        return;
      }

      const result = await syncAgyWorkflowFile({
        owner: parsed.owner,
        repo: parsed.name,
        baseBranch,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '同步 AGY Workflow 文件失败',
      });
    }
  });

  // Module 3: Dispatch VPS Self-Hosted Runner AGY workflow on a PR/feature branch
  app.post('/api/github/dispatch-agy', async (req, res) => {
    try {
      const {
        repoFullName,
        prBranch,
        prNumber,
        runId,
        e2eTestPath,
        revisionNote,
        agyModel,
        baseBranch,
        forceFreshSession,
      } = req.body ?? {};
      const parsed = parseRepoFullName(String(repoFullName || FIXED_TARGET_REPO.fullName));
      if (!parsed) {
        res.status(400).json({ error: '无效的目标仓库标识（owner/repo）' });
        return;
      }
      const cleanBranch = String(prBranch || '').trim();
      if (!cleanBranch) {
        res.status(400).json({ error: '请先选择要交由 VPS AGY 执行的目标分支（如 autodev/feat-*）' });
        return;
      }

      // Sync latest active RSI coding guidelines into target PR branch before VPS AGY runs
      const rsiGuidelinesMd = buildRsiGuidelinesMarkdown(listAllRsiRules());
      if (rsiGuidelinesMd && cleanBranch !== 'main' && cleanBranch !== 'master') {
        try {
          await commitRsiGuidelinesToBranch({
            owner: parsed.owner,
            repo: parsed.name,
            branchName: cleanBranch,
            markdownContent: rsiGuidelinesMd,
          });
          recordRulesAppliedForStage('coding');
        } catch (rsiErr) {
          console.warn('[AutoDev RSI] Failed to sync docs/rsi-guidelines.md before dispatch:', rsiErr);
        }
      }

      const linkedRun =
        (runId ? getRunById(String(runId)) : undefined) ??
        listRuns().find((r) => r.draftPr?.branchName === cleanBranch);
      const sessionPolicy = decideAgySessionPolicy({
        targetBranch: cleanBranch,
        lastAgySession: linkedRun?.lastAgySession,
        forceFresh: forceFreshSession === true,
      });

      const result = await dispatchAgyWorkflow({
        owner: parsed.owner,
        repo: parsed.name,
        prBranch: cleanBranch,
        prNumber: prNumber ? Number(prNumber) : undefined,
        runId: runId ? String(runId) : linkedRun?.id,
        e2eTestPath: e2eTestPath ? String(e2eTestPath) : undefined,
        revisionNote: revisionNote ? String(revisionNote) : undefined,
        agyModel: agyModel ? String(agyModel) : undefined,
        baseBranch: baseBranch ? String(baseBranch) : undefined,
        sessionMode: sessionPolicy.mode,
        resumeSessionId: sessionPolicy.resumeSessionId,
      });

      appendAuditLog({
        category: 'execution',
        action: 'agy_coding_dispatched',
        repoFullName: parsed.fullName,
        runId: linkedRun?.id || (runId ? String(runId) : undefined),
        prdTitle: linkedRun?.prdTitle,
        branch: cleanBranch,
        prNumber: prNumber ? Number(prNumber) : linkedRun?.draftPr?.prNumber,
        detail: `派发 VPS AGY 在分支 ${cleanBranch} 执行编码（模型：${result.model} · ${
          sessionPolicy.mode === 'resume'
            ? `复用会话 ${sessionPolicy.resumeSessionId}`
            : '全新会话'
        }）`,
      });

      res.json({
        ...result,
        sessionMode: sessionPolicy.mode,
        resumeSessionId: sessionPolicy.resumeSessionId,
        sessionReason: sessionPolicy.reason,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '触发 VPS AGY Workflow 失败',
      });
    }
  });

  // Module 4: Trigger Cloudflare Workers wrangler deploy workflow via VPS Self-Hosted Runner
  app.post('/api/github/dispatch-deploy', async (req, res) => {
    try {
      const { repoFullName, targetBranch, workerName, baseBranch } = req.body ?? {};
      const parsed = parseRepoFullName(String(repoFullName || FIXED_TARGET_REPO.fullName));
      if (!parsed) {
        res.status(400).json({ error: '无效的目标仓库标识（owner/repo）' });
        return;
      }

      const result = await dispatchCloudflareDeployWorkflow({
        owner: parsed.owner,
        repo: parsed.name,
        targetBranch: targetBranch ? String(targetBranch) : undefined,
        workerName: workerName ? String(workerName) : undefined,
        baseBranch: baseBranch ? String(baseBranch) : undefined,
      });

      appendAuditLog({
        category: 'execution',
        action: 'cf_actions_deploy_dispatched',
        repoFullName: parsed.fullName,
        branch: result.targetBranch,
        detail: `派发 Actions 部署分支 ${result.targetBranch} 到 Cloudflare Workers`,
      });

      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '触发 Cloudflare Workers 部署失败',
      });
    }
  });

  // Module 4: Direct server-side Cloudflare Workers preview deployment (auto-creates D1, applies migrations, returns live workers.dev URL)
  app.post('/api/cloudflare/deploy-preview', async (req, res) => {
    try {
      const { runId, repoFullName, branchName, workerName, prNumber } = req.body ?? {};
      const existingRun = runId ? getRunById(String(runId)) : undefined;
      const resolvedRepo = String(
        repoFullName || existingRun?.repoFullName || FIXED_TARGET_REPO.fullName
      );
      const parsed = parseRepoFullName(resolvedRepo);
      if (!parsed) {
        res.status(400).json({ error: '无效的目标仓库标识（owner/repo）' });
        return;
      }

      const resolvedBranch = String(
        branchName || existingRun?.draftPr?.branchName || existingRun?.defaultBranch || 'main'
      ).trim();
      if (!resolvedBranch) {
        res.status(400).json({ error: '请指定要部署的目标分支' });
        return;
      }

      const resolvedPrNumber = prNumber
        ? Number(prNumber)
        : existingRun?.draftPr?.prNumber;

      const deployMode: 'preview' | 'production' =
        resolvedBranch === 'main' || resolvedBranch === 'master' ? 'production' : 'preview';

      const { deployment, deployLogTail } = await deployBranchPreviewToCloudflare({
        owner: parsed.owner,
        repo: parsed.name,
        branchName: resolvedBranch,
        workerNameOverride: workerName ? String(workerName) : undefined,
        prNumber: resolvedPrNumber,
        mode: deployMode,
      });

      const updatedRun = existingRun
        ? attachPreviewDeploymentToRun(existingRun.id, deployment)
        : undefined;

      appendAuditLog({
        category: 'execution',
        action: 'preview_deployed',
        repoFullName: parsed.fullName,
        runId: existingRun?.id,
        prdTitle: existingRun?.prdTitle,
        branch: resolvedBranch,
        prNumber: resolvedPrNumber,
        detail: `部署${deployment.isIsolatedPreview ? '隔离预览' : '生产'} Worker ${deployment.workerName} (${deployment.url})`,
      });

      res.json({
        deployment,
        deployLogTail,
        run: updatedRun,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Cloudflare Workers 预览部署失败';
      const { runId, repoFullName, branchName } = req.body ?? {};
      void captureAndReflectIncident({
        sourceRefKey: `deploy-preview:${String(branchName || 'main')}:${Date.now()}`,
        source: 'deploy_error',
        repoFullName: String(repoFullName || FIXED_TARGET_REPO.fullName),
        title: `Cloudflare 预览部署失败（${String(branchName || 'main')}）`,
        errorSummary: errMsg,
        rawEvidence: errMsg,
        relatedRunId: runId ? String(runId) : undefined,
        branch: branchName ? String(branchName) : undefined,
      }).catch(() => {});

      res.status(502).json({
        error: errMsg,
      });
    }
  });

  // Module 4: Save acceptance criteria progress, approval decision, optional auto-merge + branch cleanup, and optional rework dispatch
  app.patch('/api/runs/:id/review', async (req, res) => {
    const runId = req.params.id;
    const {
      checkedCriteriaIds,
      decision,
      approvalNote,
      syncToGitHub,
      mergePrToMain,
      autoReworkViaAgy,
      agyModel,
      forceFreshSession,
    } = req.body ?? {};

    const existing = getRunById(runId);
    if (!existing) {
      res.status(404).json({ error: '未找到该需求记录' });
      return;
    }

    const patch: Parameters<typeof updateRunReview>[1] = {};
    if (Array.isArray(checkedCriteriaIds)) {
      patch.checkedCriteriaIds = checkedCriteriaIds.map(String);
    }
    if (decision === 'approved' || decision === 'changes_requested') {
      patch.status = decision;
      patch.approvalNote = String(approvalNote ?? '');
      patch.approvedAt = new Date().toISOString();
    }

    let updated = updateRunReview(runId, patch);
    let githubSync: { synced: boolean; error?: string } | undefined;
    let mergeResult:
      | {
          merged: boolean;
          alreadyMerged?: boolean;
          mergeCommitSha?: string;
          baseBranch?: string;
          commitUrl?: string;
          branchDeleted?: boolean;
          error?: string;
        }
      | undefined;
    let reworkResult: ReworkDispatchResult | undefined;

    const shouldMerge =
      decision === 'approved' &&
      mergePrToMain !== false &&
      Boolean(updated?.draftPr);

    if (shouldMerge && updated?.draftPr) {
      const parsed = parseRepoFullName(updated.repoFullName);
      if (parsed) {
        const resMerge = await mergeDraftPrToMain({
          owner: parsed.owner,
          repo: parsed.name,
          prNumber: updated.draftPr.prNumber,
          commitTitle: `feat(autodev): ${updated.prdTitle} (#${updated.draftPr.prNumber})`,
          commitMessage: String(approvalNote || 'Approved and merged via AutoDev Studio'),
          mergeMethod: 'squash',
        });
        if (resMerge.merged && resMerge.release) {
          updated = updateRunReview(runId, { mergedRelease: resMerge.release });
          mergeResult = {
            merged: true,
            alreadyMerged: resMerge.release.alreadyMerged,
            mergeCommitSha: resMerge.release.mergeCommitSha,
            baseBranch: resMerge.release.baseBranch,
            commitUrl: resMerge.release.commitUrl,
            branchDeleted: resMerge.release.branchDeleted,
          };
        } else {
          mergeResult = {
            merged: false,
            error: resMerge.error || 'PR 合并失败',
          };
        }
      }
    }

    // Closed-loop rework: commit docs/revision-feedback.md to PR branch and dispatch AGY Runner
    const shouldRework =
      decision === 'changes_requested' &&
      autoReworkViaAgy === true &&
      Boolean(updated?.draftPr);

    if (shouldRework && updated?.draftPr) {
      const parsed = parseRepoFullName(updated.repoFullName);
      if (parsed) {
        const checkedSet = new Set(updated.checkedCriteriaIds ?? []);
        const uncheckedCriteria = updated.architect.tasks.flatMap((task) =>
          task.acceptanceCriteria
            .map((text, idx) => ({ id: `${task.id}::${idx}`, label: `[${task.id}] ${text}` }))
            .filter((item) => !checkedSet.has(item.id))
            .map((item) => item.label)
        );
        const cleanNote = String(approvalNote ?? '').trim();
        const feedbackMd = buildRevisionFeedbackMarkdown({
          runId: updated.id,
          prdTitle: updated.prdTitle,
          prNumber: updated.draftPr.prNumber,
          approvalNote: cleanNote,
          uncheckedCriteria,
        });

        const draftPrBranch = updated.draftPr.branchName;
        const draftPrNumber = updated.draftPr.prNumber;
        const draftPrE2ePath = updated.draftPr.e2eTestPath;

        try {
          const commitRes = await commitRevisionFeedbackToBranch({
            owner: parsed.owner,
            repo: parsed.name,
            branchName: draftPrBranch,
            markdownContent: feedbackMd,
            prNumber: draftPrNumber,
          });
          const activeCodingRules = listAllRsiRules();
          const rsiMarkdown = buildRsiGuidelinesMarkdown(activeCodingRules);
          if (rsiMarkdown) {
            await commitRsiGuidelinesToBranch({
              owner: parsed.owner,
              repo: parsed.name,
              branchName: draftPrBranch,
              markdownContent: rsiMarkdown,
            }).catch((err) => {
              console.warn('Non-blocking RSI guidelines sync on rework failed:', err);
            });
            recordRulesAppliedForStage('coding');
          }
          const sessionPolicy = decideAgySessionPolicy({
            targetBranch: draftPrBranch,
            lastAgySession: updated.lastAgySession,
            forceFresh: forceFreshSession === true,
          });
          const dispatchRes = await dispatchAgyWorkflow({
            owner: parsed.owner,
            repo: parsed.name,
            prBranch: draftPrBranch,
            prNumber: draftPrNumber,
            runId: updated.id,
            e2eTestPath: draftPrE2ePath,
            revisionNote:
              cleanNote ||
              `共有 ${uncheckedCriteria.length} 项验收标准未勾选，请按 docs/revision-feedback.md 修复。`,
            agyModel: agyModel ? String(agyModel) : undefined,
            baseBranch: updated.defaultBranch || 'main',
            sessionMode: sessionPolicy.mode,
            resumeSessionId: sessionPolicy.resumeSessionId,
          });
          reworkResult = {
            dispatched: true,
            branchName: draftPrBranch,
            feedbackFilePath: commitRes.path,
            feedbackCommitSha: commitRes.commitSha,
            actionsUrl: dispatchRes.actionsUrl,
            dispatchedAt: new Date().toISOString(),
            note: cleanNote,
            sessionMode: sessionPolicy.mode,
            resumeSessionId: sessionPolicy.resumeSessionId,
            sessionReason: sessionPolicy.reason,
          };
          updated = updateRunReview(runId, { lastRework: reworkResult });
        } catch (err) {
          reworkResult = {
            dispatched: false,
            branchName: draftPrBranch,
            feedbackFilePath: 'docs/revision-feedback.md',
            dispatchedAt: new Date().toISOString(),
            note: cleanNote,
            error: err instanceof Error ? err.message : '自动派发 VPS AGY 返工失败',
          };
        }
      }
    }

    if (
      syncToGitHub &&
      (decision === 'approved' || decision === 'changes_requested') &&
      updated?.draftPr
    ) {
      const parsed = parseRepoFullName(updated.repoFullName);
      if (parsed) {
        let noteWithExtras = String(approvalNote ?? '').trim();
        if (mergeResult?.merged) {
          noteWithExtras = `${noteWithExtras || '验收通过'}\n\n已自动解除 Draft 状态并 Squash Merge 合入 \`${
            mergeResult.baseBranch || 'main'
          }\`（Commit: \`${(mergeResult.mergeCommitSha || '').slice(0, 7)}\`${
            mergeResult.branchDeleted ? '，已自动清理临时特性分支' : ''
          }）。`;
        } else if (reworkResult?.dispatched) {
          noteWithExtras = `${noteWithExtras || '退回修订'}\n\n已将修改指令写入 \`${
            reworkResult.feedbackFilePath
          }\` 并自动派发 VPS AGY 在分支 \`${reworkResult.branchName}\` 执行增量修复。`;
        }
        githubSync = await postPrApprovalComment({
          owner: parsed.owner,
          repo: parsed.name,
          prNumber: updated.draftPr.prNumber,
          decision,
          note: noteWithExtras,
        });
      }
    }

    let rsiIncidentId: string | undefined;
    if (decision === 'changes_requested' && updated) {
      const checkedSet = new Set(updated.checkedCriteriaIds ?? []);
      const uncheckedCriteria = updated.architect.tasks.flatMap((task) =>
        task.acceptanceCriteria
          .map((text, idx) => ({ id: `${task.id}::${idx}`, label: `[${task.id}] ${text}` }))
          .filter((item) => !checkedSet.has(item.id))
          .map((item) => item.label)
      );
      const cleanNote = String(approvalNote ?? '').trim();
      const summaryParts = [
        cleanNote || '人工验收未通过，退回修订',
        uncheckedCriteria.length > 0 ? `未勾选验收项 ${uncheckedCriteria.length} 条` : '',
      ].filter(Boolean);

      try {
        const captured = await captureAndReflectIncident({
          sourceRefKey: `manual-acceptance:${updated.id}:${Date.now()}`,
          source: 'manual_acceptance',
          repoFullName: updated.repoFullName,
          title: `人工验收退回：${updated.prdTitle}`,
          errorSummary: summaryParts.join(' · '),
          rawEvidence: [
            `需求标题: ${updated.prdTitle}`,
            `PR 编号: ${updated.draftPr ? `#${updated.draftPr.prNumber}` : '无'}`,
            `退回修改意见:\n${cleanNote || '(未填写文字意见)'}`,
            uncheckedCriteria.length > 0
              ? `\n未通过的验收标准:\n${uncheckedCriteria.map((c) => `- ${c}`).join('\n')}`
              : '',
          ].join('\n'),
          relatedRunId: updated.id,
          branch: updated.draftPr?.branchName || updated.defaultBranch,
          waitForAnalysis: false,
        });
        rsiIncidentId = captured.incident.id;
      } catch {
        // non-fatal
      }
    }

    if (updated) {
      if (decision === 'approved') {
        appendAuditLog({
          category: 'approval',
          action: 'release_approved',
          actor: '验收审批人',
          repoFullName: updated.repoFullName,
          runId: updated.id,
          prdTitle: updated.prdTitle,
          branch: updated.draftPr?.branchName || updated.defaultBranch,
          prNumber: updated.draftPr?.prNumber,
          status: mergeResult && !mergeResult.merged ? 'failed' : 'success',
          detail: mergeResult?.merged
            ? `验收通过并合入 ${mergeResult.baseBranch || 'main'}（Commit ${(mergeResult.mergeCommitSha || '').slice(0, 7)}）`
            : mergeResult?.error
              ? `验收通过但合并 PR 失败：${mergeResult.error}`
              : `验收通过并批准上线${approvalNote ? `：${String(approvalNote).trim()}` : ''}`,
        });
      } else if (decision === 'changes_requested') {
        const origBranch = updated.draftPr?.branchName || updated.defaultBranch;
        appendAuditLog({
          category: 'approval',
          action: 'revision_requested',
          actor: '验收审批人',
          repoFullName: updated.repoFullName,
          runId: updated.id,
          prdTitle: updated.prdTitle,
          branch: origBranch,
          prNumber: updated.draftPr?.prNumber,
          status: reworkResult && !reworkResult.dispatched ? 'failed' : 'success',
          detail: reworkResult?.dispatched
            ? `退回修订：已在原需求分支 ${origBranch} 写入 docs/revision-feedback.md 并派发 VPS AGY 返工（${
                reworkResult.sessionMode === 'resume' && reworkResult.resumeSessionId
                  ? `复用会话 ${reworkResult.resumeSessionId}`
                  : '全新会话'
              }）${approvalNote ? `（意见：${String(approvalNote).trim()}）` : ''}`
            : `人工验收退回修订（原分支 ${origBranch}）${
                approvalNote ? `：${String(approvalNote).trim()}` : ''
              }`,
        });
      } else if (Array.isArray(checkedCriteriaIds)) {
        const total = updated.architect.tasks.reduce(
          (acc, t) => acc + t.acceptanceCriteria.length,
          0
        );
        appendAuditLog({
          category: 'approval',
          action: 'acceptance_checklist_updated',
          actor: '验收审批人',
          repoFullName: updated.repoFullName,
          runId: updated.id,
          prdTitle: updated.prdTitle,
          branch: updated.draftPr?.branchName || updated.defaultBranch,
          prNumber: updated.draftPr?.prNumber,
          detail: `更新验收标准勾选进度：${checkedCriteriaIds.length}/${total}`,
        });
      }
    }

    res.json({ run: updated, githubSync, mergeResult, reworkResult, rsiIncidentId });
  });

  // Vite middleware in dev, static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoDev Studio server running on http://0.0.0.0:${PORT}`);
    resumeRunningVpsPlanJobs();
    if (process.env.GITHUB_TOKEN?.trim()) {
      ensureWorkflowsUpToDate({
        owner: FIXED_TARGET_REPO.owner,
        repo: FIXED_TARGET_REPO.name,
        baseBranch: FIXED_TARGET_REPO.defaultBranch,
      })
        .then((res) => {
          if (res.changed) {
            console.log(
              `[AutoDev] Auto-synced latest workflows to ${FIXED_TARGET_REPO.fullName}@${FIXED_TARGET_REPO.defaultBranch}`
            );
          }
        })
        .catch((err) => {
          console.warn('[AutoDev] Background workflow auto-sync skipped:', err?.message || err);
        });
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start AutoDev Studio server:', err);
  process.exit(1);
});
