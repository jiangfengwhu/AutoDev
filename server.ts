import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import {
  cancelGitHubActionRun,
  checkGitHubIntegration,
  commitRevisionFeedbackToBranch,
  commitRsiGuidelinesToBranch,
  createSpecDraftPr,
  dispatchAgyWorkflow,
  dispatchCloudflareDeployWorkflow,
  ensureWorkflowsUpToDate,
  extractCodingOutputFromLiveLogFallback,
  fetchLiveAgyStreamIndex,
  fetchRepoContextSnapshot,
  getGitHubActionRunDetail,
  getGitHubRateLimitSnapshot,
  invalidateGitHubReadCache,
  listGitHubActionRuns,
  listOpenAutodevPrs,
  listSelfHostedRunners,
  mergeDraftPrToMain,
  postPrApprovalComment,
  readVpsAgyCapabilities,
  resetAutodevRepoArtifacts,
  syncAgyWorkflowFile,
  wipeRepoCodeToScratch,
} from './server/githubService.ts';
import {
  flushGitHubStateNow,
  forcePushAllLocalStateToGitHub,
  getGitHubStatePersistenceStatus,
  hydrateGitHubStateStores,
} from './server/githubStateStore.ts';
import {
  checkCloudflareIntegration,
  wipeCloudflareD1Databases,
} from './server/cloudflareService.ts';
import { deployBranchPreviewToCloudflare } from './server/cloudflareDeployService.ts';
import {
  GEMINI_AGENT_MODEL,
  runArchitectAgent,
  runQaCriticAgent,
  runQaSpecAgent,
} from './server/agentOrchestrator.ts';
import {
  attachDraftPrToRun,
  attachPreviewDeploymentToRun,
  clearAllRuns,
  deleteRunById,
  getRunById,
  listRuns,
  reloadRunsFromDisk,
  saveRun,
  updateRunPlan,
  updateRunReview,
} from './server/runStore.ts';
import {
  cancelAnalysisJob,
  clearAllAnalysisJobs,
  createAndStartAnalysisJob,
  deleteAnalysisJobById,
  getAnalysisJobById,
  getLatestAnalysisJob,
  getRunningAnalysisJob,
  listAnalysisJobs,
  reloadJobsFromDisk,
  resumeRunningVpsPlanJobs,
  syncRunPlanToLinkedJobs,
} from './server/analysisJobStore.ts';
import {
  clearRsiHistory,
  createManualRsiRule,
  deleteIncidentById,
  deleteRsiRule,
  deleteTestReportById,
  getRsiState,
  listAllRsiRules,
  recordRulesAppliedForStage,
  reloadRsiStateFromDisk,
  updateRsiRule,
} from './server/rsiStore.ts';
import {
  captureAndReflectIncident,
  consolidateRsiRulesWithGemini,
  runAttributionForIncident,
  syncRepoTestReportsAndFailures,
} from './server/rsiService.ts';
import {
  appendAuditLog,
  clearAllAuditLogs,
  listAuditLogs,
  reloadAuditLogsFromDisk,
} from './server/auditLogStore.ts';
import {
  enqueueBackgroundTask,
  getBackgroundTaskById,
  listBackgroundTasks,
} from './server/backgroundTaskStore.ts';
import {
  changeEditPassword,
  checkUnlockRateLimit,
  clearUnlockFailures,
  extractBearerToken,
  getEditAuthMeta,
  issueEditSessionToken,
  recordUnlockFailure,
  reloadEditAuthFromDisk,
  revokeEditSessionToken,
  verifyEditPassword,
  verifyEditSessionToken,
} from './server/editAuthService.ts';
import { sanitizeCodingChatOutput } from './src/lib/codingChatOutput.ts';
import { parseRepoFullName, validatePrdInput } from './src/lib/taskGraph.ts';
import { buildPrArtifacts } from './src/lib/specBuilder.ts';
import {
  buildRevisionFeedbackMarkdown,
  evaluateSingleTaskLock,
} from './src/lib/iterationContext.ts';
import { buildSevenDayOverviewMetrics } from './src/lib/overviewMetrics.ts';
import {
  buildRequirementsBoardData,
  synthesizeBaselineAuditEvents,
} from './src/lib/requirementsBoard.ts';
import {
  validateArchitectOutput,
  validateQaCriticOutput,
  validateQaSpecOutput,
} from './src/lib/planProtocol.ts';
import { decideAgySessionPolicy } from './src/lib/sessionReuse.ts';
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
} from './src/lib/rsiEngine.ts';
import {
  AGY_AGENT_MODES,
  AGY_AVAILABLE_MODELS,
  FIXED_TARGET_REPO,
} from './src/lib/workflowBuilder.ts';
import {
  getFeishuAppBaseUrl,
  getFeishuIntegrationStatus,
  isDuplicateFeishuEvent,
  isFeishuChatAllowed,
  notifyFeishuStageEvent,
  reloadFeishuStateFromDisk,
  rememberFeishuActiveChat,
  replyFeishuCardMessage,
  sendFeishuCardMessage,
  verifyAndDecodeFeishuWebhook,
} from './server/feishuService.ts';
import {
  buildFeishuPrdFormCard,
  buildFeishuReworkFormCard,
  buildFeishuStageCard,
  parseFeishuCardCallbackBody,
  parseFeishuEventBody,
} from './src/lib/feishuProtocol.ts';
import type {
  AnalysisSseEvent,
  IntegrationsStatusResponse,
  PipelineRun,
  PreviewDeployment,
  ReworkDispatchResult,
} from './src/types/autodev.ts';

type RequestWithRawBody = express.Request & { rawBody?: string };

const PORT = Number(process.env.PORT || 3000);
const activeAgyCodingWatchers = new Set<string>();

async function startServer() {
  const app = express();
  app.use(
    express.json({
      limit: '4mb',
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf.toString('utf-8');
      },
    })
  );

  // =========================================================================
  // Edit Permission & Write-Guard Middleware (read-only by default until unlocked)
  // =========================================================================
  app.get('/api/auth/status', (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const verified = verifyEditSessionToken(token);
    res.json({
      unlocked: verified.valid,
      expiresAt: verified.expiresAt ?? null,
      meta: getEditAuthMeta(),
    });
  });

  app.post('/api/auth/unlock', (req, res) => {
    const clientKey =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : undefined) ||
      req.ip ||
      'unknown';

    const limit = checkUnlockRateLimit(clientKey);
    if (!limit.allowed) {
      res.status(429).json({
        error: `密码尝试次数过多，请 ${limit.retryAfterSec} 秒后重试`,
        code: 'RATE_LIMITED',
        retryAfterSec: limit.retryAfterSec,
      });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      res.status(400).json({ error: '请输入编辑解锁密码', code: 'EMPTY_PASSWORD' });
      return;
    }

    if (!verifyEditPassword(password)) {
      recordUnlockFailure(clientKey);
      res.status(401).json({ error: '密码错误，无法解锁编辑权限', code: 'INVALID_PASSWORD' });
      return;
    }

    clearUnlockFailures(clientKey);
    const session = issueEditSessionToken();
    res.json({
      unlocked: true,
      token: session.token,
      expiresAt: session.expiresAt,
      meta: getEditAuthMeta(),
    });
  });

  app.post('/api/auth/lock', (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    revokeEditSessionToken(token);
    res.json({
      unlocked: false,
      meta: getEditAuthMeta(),
    });
  });

  // Enforce server-side write authentication on ALL non-GET /api/* mutation routes
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    if (
      req.path === '/auth/unlock' ||
      req.path === '/auth/lock' ||
      req.path === '/feishu/events' ||
      req.path === '/feishu/card-action'
    ) {
      next();
      return;
    }
    const token = extractBearerToken(req.headers.authorization);
    const verified = verifyEditSessionToken(token);
    if (!verified.valid) {
      res.status(403).json({
        error: '当前处于只读锁定状态，请先点击解锁按钮输入编辑密码',
        code: 'EDIT_LOCKED',
      });
      return;
    }
    next();
  });

  app.post('/api/auth/change-password', (req, res) => {
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const nextPassword = typeof req.body?.nextPassword === 'string' ? req.body.nextPassword : '';
    const result = changeEditPassword(currentPassword, nextPassword);
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    res.json({
      unlocked: true,
      token: result.token,
      expiresAt: result.expiresAt,
      meta: result.meta,
    });
  });

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
      feishu: getFeishuIntegrationStatus(),
    };

    res.json(payload);
  });

  // Feishu Bot integration status & callback paths (no secrets exposed)
  app.get('/api/feishu/status', (_req, res) => {
    res.json({ feishu: getFeishuIntegrationStatus() });
  });

  // List stored pipeline runs
  app.get('/api/runs', (_req, res) => {
    res.json({ runs: listRuns() });
  });

  // Global detached server-side background tasks (survives page switches / refresh / disconnect)
  app.get('/api/tasks', (_req, res) => {
    res.json({ tasks: listBackgroundTasks(30) });
  });

  // Lightweight SSE keepalive held open by active browsers while background deploy/build tasks run.
  // Keeps an active HTTP request open on Cloud Run so request-based CPU allocation stays at 100%.
  app.get('/api/tasks/keepalive', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const startedAt = Date.now();
    const maxDurationMs = 4 * 60 * 1000;
    const heartbeat = setInterval(() => {
      const stillRunning = listBackgroundTasks(25).some((t) => t.status === 'running');
      if (!stillRunning || Date.now() - startedAt >= maxDurationMs) {
        clearInterval(heartbeat);
        if (!res.writableEnded) {
          res.write('event: idle\ndata: done\n\n');
          res.end();
        }
        return;
      }
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}\n\n`);
      }
    }, 4000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = getBackgroundTaskById(String(req.params.id || '').trim());
    if (!task) {
      res.status(404).json({ error: '未找到指定后台任务' });
      return;
    }
    res.json({ task });
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
        testReports: getRsiState().testReports,
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

  // Module 3: Standalone Full Requirement Report (PRD + Plan + Coding Agent Final Output + Blind E2E + Audit Timeline)
  app.get('/api/requirements/:id/report', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    const runs = listRuns();
    const jobs = listAnalysisJobs();
    const rsi = getRsiState();

    const matchedRun =
      runs.find((r) => r.id === targetId) ||
      runs.find((r) => jobs.some((j) => j.id === targetId && j.runId === r.id));
    const matchedJob =
      jobs.find((j) => j.id === targetId) ||
      (matchedRun ? jobs.find((j) => j.runId === matchedRun.id) : undefined);

    if (!matchedRun && !matchedJob) {
      res.status(404).json({ error: '未找到指定的需求报告记录' });
      return;
    }

    const branchName = matchedRun?.draftPr?.branchName;
    const matchedReports = rsi.testReports
      .filter(
        (report) =>
          (matchedRun && report.pipelineRunId === matchedRun.id) ||
          (branchName && report.branch === branchName) ||
          (matchedRun?.draftPr?.prNumber && report.prNumber === matchedRun.draftPr.prNumber)
      )
      .sort((a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt));

    const combinedLogs = synthesizeBaselineAuditEvents({
      runs,
      jobs,
      existingAuditLogs: listAuditLogs(),
    });
    const auditEvents = combinedLogs.filter(
      (e) =>
        (matchedRun && e.runId === matchedRun.id) ||
        (matchedJob && e.jobId === matchedJob.id) ||
        (branchName && e.branch === branchName)
    );

    const latestReportWithOutput = matchedReports.find((r) =>
      Boolean(sanitizeCodingChatOutput(r.codingFinalOutput))
    );
    const sanitizedRunOutput = sanitizeCodingChatOutput(matchedRun?.latestCodingOutput?.content);
    const sanitizedReportOutput = sanitizeCodingChatOutput(latestReportWithOutput?.codingFinalOutput);
    let codingOutput =
      matchedRun?.latestCodingOutput && sanitizedRunOutput
        ? { ...matchedRun.latestCodingOutput, content: sanitizedRunOutput }
        : latestReportWithOutput && sanitizedReportOutput
          ? {
              content: sanitizedReportOutput,
              actionsRunId: latestReportWithOutput.actionsRunId,
              actionsUrl: latestReportWithOutput.actionsUrl,
              repairRounds: latestReportWithOutput.repairRounds,
              capturedAt: latestReportWithOutput.executedAt,
              tokenUsage: latestReportWithOutput.tokenUsage,
            }
          : undefined;

    // Fallback for historical runs before structured codingFinalOutput existed: extract clean chat reply only
    if (!codingOutput && matchedRun) {
      const parsedRepo = parseRepoFullName(matchedRun.repoFullName);
      if (parsedRepo) {
        const fallbackText = await extractCodingOutputFromLiveLogFallback(
          parsedRepo.owner,
          parsedRepo.name,
          branchName,
          matchedRun.lastAgySession?.actionsRunId ?? matchedReports[0]?.actionsRunId
        );
        const cleanFallback = sanitizeCodingChatOutput(fallbackText);
        if (cleanFallback) {
          codingOutput = {
            content: cleanFallback,
            actionsRunId: matchedRun.lastAgySession?.actionsRunId ?? matchedReports[0]?.actionsRunId,
            actionsUrl: matchedReports[0]?.actionsUrl,
            repairRounds: matchedReports[0]?.repairRounds,
            capturedAt:
              matchedRun.lastAgySession?.updatedAt ||
              matchedReports[0]?.executedAt ||
              matchedRun.createdAt,
            tokenUsage: matchedReports[0]?.tokenUsage,
          };
        }
      }
    }

    res.json({
      id: matchedRun?.id || matchedJob!.id,
      generatedAt: new Date().toISOString(),
      run: matchedRun || null,
      job: matchedJob || null,
      codingOutput: codingOutput || null,
      testReports: matchedReports,
      auditEvents,
    });
  });

  // Module 2: Save user edits to generated plan (Architect / QA Spec / QA Critic) before Draft PR creation
  app.patch('/api/runs/:id/plan', async (req, res) => {
    const runId = String(req.params.id || '').trim();
    const existing = getRunById(runId);
    if (!existing) {
      res.status(404).json({ error: '未找到指定的需求规划记录' });
      return;
    }

    const body = req.body as {
      prdTitle?: string;
      prdContent?: string;
      techStackHint?: string;
      architect?: unknown;
      qaSpec?: unknown;
      qaCritic?: unknown;
    };

    let nextArchitect = existing.architect;
    if (body.architect !== undefined) {
      const check = validateArchitectOutput(body.architect);
      if (!check.ok) {
        res.status(400).json({ error: `架构规划校验失败：${check.error}` });
        return;
      }
      nextArchitect = check.data;
    }

    let nextQaSpec = existing.qaSpec;
    if (body.qaSpec !== undefined) {
      const check = validateQaSpecOutput(body.qaSpec);
      if (!check.ok) {
        res.status(400).json({ error: `测试规格校验失败：${check.error}` });
        return;
      }
      nextQaSpec = check.data;
    }

    let nextQaCritic = existing.qaCritic;
    if (body.qaCritic !== undefined) {
      const check = validateQaCriticOutput(body.qaCritic);
      if (!check.ok) {
        res.status(400).json({ error: `盲测评审校验失败：${check.error}` });
        return;
      }
      nextQaCritic = check.data;
    }

    const updated = updateRunPlan(runId, {
      prdTitle: typeof body.prdTitle === 'string' && body.prdTitle.trim() ? body.prdTitle.trim() : undefined,
      prdContent: typeof body.prdContent === 'string' && body.prdContent.trim() ? body.prdContent.trim() : undefined,
      techStackHint: typeof body.techStackHint === 'string' ? body.techStackHint.trim() : undefined,
      architect: nextArchitect,
      qaSpec: nextQaSpec,
      qaCritic: nextQaCritic,
    });

    if (!updated) {
      res.status(500).json({ error: '保存需求规划修改失败' });
      return;
    }

    syncRunPlanToLinkedJobs(updated);
    appendAuditLog({
      category: 'planning',
      action: 'plan_edited',
      repoFullName: updated.repoFullName,
      runId: updated.id,
      prdTitle: updated.prdTitle,
      detail: `人工修订规划方案（${updated.architect.tasks.length} 项任务 · ${updated.architect.apiContracts.length} 条 API 契约 · ${updated.qaCritic.finalApiTestChecklist.length} 条测试清单）`,
    });

    const statePersistence = await flushGitHubStateNow(`plan-edited:${runId}`).catch(() => undefined);
    res.json({ run: updated, statePersistence });
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

    const executeSync = async () => {
      const syncResult = await syncRepoTestReportsAndFailures(parsed.owner, parsed.name, {
        autoAnalyzeLimit,
      });
      appendAuditLog({
        category: 'quality',
        action: 'rsi_sync_triggered',
        repoFullName: parsed.fullName,
        detail: `同步 ${syncResult.syncedReportsCount} 份测试报告，新增 ${syncResult.newIncidentsCount} 条异常，完成 ${syncResult.analyzedCount} 次 AI 归因`,
      });
      return {
        syncResult,
        state: buildRsiDashboardPayload(),
      };
    };

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'rsi_sync',
        title: '同步测试报告与 RSI 归因',
        roomId: 'quality',
        repoFullName: parsed.fullName,
        dedupeKey: `rsi_sync:${parsed.fullName}`,
        initialMessage: '正在拉取 GitHub Actions 测试报告并运行 AI 归因…',
        executor: async () => {
          const payload = await executeSync();
          const sr = payload.syncResult;
          return {
            summary: `同步 ${sr.syncedReportsCount} 份测试报告，新增 ${sr.newIncidentsCount} 条异常，完成 ${sr.analyzedCount} 次 AI 归因`,
            result: { syncResult: sr },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeSync();
      res.json(payload);
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

    const executeReportIncident = async () => {
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

      return {
        ...result,
        state: buildRsiDashboardPayload(),
      };
    };

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'rsi_report_incident',
        title: `上报异常并 AI 归因：${cleanTitle.slice(0, 28)}`,
        roomId: 'quality',
        repoFullName: String(repoFullName || FIXED_TARGET_REPO.fullName),
        runId: relatedRunId ? String(relatedRunId) : undefined,
        initialMessage: '正在写入异常记录并执行 RSI 根因归因…',
        executor: async () => {
          const payload = await executeReportIncident();
          const codified = Boolean(payload.incident?.attribution?.shouldCodifyAsRule);
          return {
            summary: codified
              ? `异常「${cleanTitle}」已归因并沉淀为 RSI 规则`
              : `异常「${cleanTitle}」已完成归因评估`,
            result: { incidentId: payload.incident?.id, codified },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeReportIncident();
      res.status(201).json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '记录并归因异常事件失败',
      });
    }
  });

  // Module 5: Trigger or re-run Gemini RSI attribution + gemini-decision-1 gate for a specific incident
  app.post('/api/rsi/incidents/:id/analyze', async (req, res) => {
    const incidentId = String(req.params.id || '').trim();
    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'rsi_analyze',
        title: 'AI 故障归因与规则门控',
        roomId: 'quality',
        dedupeKey: `rsi_analyze:${incidentId}`,
        initialMessage: '正在后台运行 Gemini 归因与门控评估…',
        executor: async () => {
          const result = await runAttributionForIncident(incidentId);
          const outcome = result.incident?.attribution?.appliedOutcome;
          const summary =
            outcome === 'merged' || result.ruleAction === 'merged'
              ? '判定语义重复，已合并强化现有 RSI 规则'
              : outcome === 'candidate_created'
                ? '已写入待观察候选规则池'
                : outcome === 'active_created' || result.ruleAction === 'created'
                  ? '判定为高危通用规则，已立即生效注入'
                  : '判定为一次性偶发故障，未写入长期 Prompt';
          return { summary, result: { incidentId, outcome } };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const result = await runAttributionForIncident(incidentId);
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
  app.post('/api/rsi/consolidate', async (req, res) => {
    const executeConsolidate = async () => {
      const consolidation = await consolidateRsiRulesWithGemini();
      appendAuditLog({
        category: 'quality',
        action: 'rsi_rule_mutated',
        repoFullName: FIXED_TARGET_REPO.fullName,
        detail: `AI 蒸馏压缩 RSI 规则：${consolidation.beforeCount} 条 -> ${consolidation.afterCount} 条（${consolidation.summary}）`,
      });
      return {
        consolidation,
        state: buildRsiDashboardPayload(),
      };
    };

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'rsi_consolidate',
        title: 'AI 蒸馏压缩 RSI 规则库',
        roomId: 'quality',
        dedupeKey: 'rsi_consolidate',
        initialMessage: '正在后台合并去重 RSI 规则指令…',
        executor: async () => {
          const payload = await executeConsolidate();
          const c = payload.consolidation;
          return {
            summary: `规则蒸馏完成：${c.beforeCount} 条 -> ${c.afterCount} 条`,
            result: { consolidation: c },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeConsolidate();
      res.json(payload);
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
      agyMode,
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
        agyMode: agyMode ? String(agyMode).trim() : undefined,
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
        }${job.agyModel ? ` / ${job.agyModel}` : ''}${job.agyMode ? ` / mode:${job.agyMode}` : ''}）`,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : '无法启动分析任务',
      });
    }
  });

  app.get('/api/agents/jobs/latest', (_req, res) => {
    res.json({ job: getLatestAnalysisJob() ?? null, jobs: listAnalysisJobs() });
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

      const targetRun = run;
      const executeCreateDraftPr = async (setProgress?: (msg: string) => void) => {
        setProgress?.('正在写入规格文档、盲测隔离用例并创建特性分支…');
        const artifacts = buildPrArtifacts(targetRun);
        const draftPr = await createSpecDraftPr({
          owner: parsedRepo.owner,
          repo: parsedRepo.name,
          baseBranch: baseBranch ? String(baseBranch) : targetRun.defaultBranch,
          artifacts,
        });

        // Auto-inject active RSI engineering guardrails into the PR branch for VPS AGY Coding Runner
        const rsiGuidelinesMd = buildRsiGuidelinesMarkdown(listAllRsiRules());
        if (rsiGuidelinesMd) {
          setProgress?.(`已创建 PR #${draftPr.prNumber}，正在注入 RSI 工程约束规则…`);
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

        const updatedRun = attachDraftPrToRun(targetRun.id, draftPr) || {
          ...targetRun,
          status: 'pr_created' as const,
          draftPr,
        };

        appendAuditLog({
          category: 'planning',
          action: 'draft_pr_created',
          repoFullName: targetRun.repoFullName,
          runId: targetRun.id,
          prdTitle: targetRun.prdTitle,
          branch: draftPr.branchName,
          prNumber: draftPr.prNumber,
          detail: `创建规格 Draft PR #${draftPr.prNumber}（特性分支 ${draftPr.branchName}，提交 ${draftPr.commitSha.slice(0, 7)}）`,
        });

        void notifyFeishuStageEvent({
          kind: 'draft_pr_created',
          prdTitle: targetRun.prdTitle,
          repoFullName: targetRun.repoFullName,
          runId: targetRun.id,
          branchName: draftPr.branchName,
          prNumber: draftPr.prNumber,
          prUrl: draftPr.prUrl,
          summary: `特性分支 ${draftPr.branchName} 与隔离盲测用例已提交。`,
        });

        return { draftPr, run: updatedRun };
      };

      if (req.body?.async === true) {
        const { task, deduplicated } = enqueueBackgroundTask({
          kind: 'create_draft_pr',
          title: `创建 Draft PR：${targetRun.prdTitle.slice(0, 28)}`,
          roomId: 'prd',
          runId: targetRun.id,
          repoFullName: targetRun.repoFullName,
          dedupeKey: `create_draft_pr:${targetRun.id}`,
          initialMessage: '正在后台提交规格文档并创建 GitHub Draft PR…',
          executor: async ({ setProgress }) => {
            const payload = await executeCreateDraftPr(setProgress);
            return {
              summary: `Draft PR #${payload.draftPr.prNumber} 已创建（分支 ${payload.draftPr.branchName}）`,
              result: { prNumber: payload.draftPr.prNumber, prUrl: payload.draftPr.prUrl, runId: targetRun.id },
            };
          },
        });
        res.status(202).json({ async: true, deduplicated, task });
        return;
      }

      const payload = await executeCreateDraftPr();
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '创建 GitHub Draft PR 失败',
      });
    }
  });

  // Module 3: Query recent GitHub Actions workflow runs enriched with real requirement/branch correlation
  app.get('/api/github/actions-runs', async (req, res) => {
    const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '缺少有效的 repo 参数（owner/repo）' });
      return;
    }

    const [result, streamIndex] = await Promise.all([
      listGitHubActionRuns(parsed.owner, parsed.name, 25),
      fetchLiveAgyStreamIndex(parsed.owner, parsed.name).catch(() => new Map()),
    ]);

    const localRuns = listRuns();
    const localJobs = listAnalysisJobs();
    const reports = getRsiState().testReports;

    const reportByActionId = new Map(
      reports.filter((r) => Boolean(r.actionsRunId)).map((r) => [r.actionsRunId!, r])
    );
    const jobByActionId = new Map(
      localJobs.filter((j) => Boolean(j.planActionsRunId)).map((j) => [j.planActionsRunId!, j])
    );
    const runByBranch = new Map(
      localRuns.filter((r) => Boolean(r.draftPr?.branchName)).map((r) => [r.draftPr!.branchName, r])
    );

    const enrichedRuns = result.runs.map((ar) => {
      const streamMeta = streamIndex.get(ar.id);
      const rep = reportByActionId.get(ar.id);
      const planJob = jobByActionId.get(ar.id);

      let targetBranch = streamMeta?.branch || rep?.branch;
      let pipelineRunId = streamMeta?.pipelineRunId || rep?.pipelineRunId || planJob?.runId;
      let prNumber = rep?.prNumber;
      const jobId = planJob?.id;

      if (!targetBranch && pipelineRunId) {
        const matchedRun = localRuns.find((r) => r.id === pipelineRunId);
        if (matchedRun?.draftPr?.branchName) {
          targetBranch = matchedRun.draftPr.branchName;
          prNumber = prNumber ?? matchedRun.draftPr.prNumber;
        }
      }
      if (!pipelineRunId && targetBranch) {
        const matchedRun = runByBranch.get(targetBranch);
        if (matchedRun) {
          pipelineRunId = matchedRun.id;
          prNumber = prNumber ?? matchedRun.draftPr?.prNumber;
        }
      }
      if (!pipelineRunId && ar.headBranch && ar.headBranch !== 'main' && ar.headBranch !== 'master') {
        const matchedRun = runByBranch.get(ar.headBranch);
        if (matchedRun) {
          pipelineRunId = matchedRun.id;
          targetBranch = targetBranch || ar.headBranch;
          prNumber = prNumber ?? matchedRun.draftPr?.prNumber;
        }
      }

      return {
        ...ar,
        ...(targetBranch ? { targetBranch } : {}),
        ...(pipelineRunId ? { pipelineRunId } : {}),
        ...(jobId ? { jobId } : {}),
        ...(prNumber ? { prNumber } : {}),
      };
    });

    res.json({
      ...result,
      runs: enrichedRuns,
    });
  });

  // Query live VPS AGY capabilities (models + agent modes synced from VPS runner)
  app.get('/api/github/vps-capabilities', async (req, res) => {
    const repoParam = String(req.query.repo || FIXED_TARGET_REPO.fullName);
    const parsed = parseRepoFullName(repoParam);
    const live = parsed ? await readVpsAgyCapabilities(parsed.owner, parsed.name).catch(() => null) : null;

    const mergedModels: Array<{ id: string; label: string }> = [
      ...AGY_AVAILABLE_MODELS.map((m) => ({ id: String(m.id), label: String(m.label) })),
    ];
    if (live?.models?.length) {
      for (const m of live.models) {
        if (!mergedModels.some((x) => x.id === m.id)) {
          mergedModels.unshift({ id: m.id, label: m.label });
        }
      }
    }

    res.json({
      version: live?.version,
      syncedAt: live?.syncedAt,
      models: mergedModels,
      modes: AGY_AGENT_MODES,
      agents: live?.agents || [],
    });
  });

  // GitHub API rate-limit telemetry + autodev-state branch persistence status
  app.get('/api/github/rate-limit', async (req, res) => {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const rateLimit = await getGitHubRateLimitSnapshot(forceRefresh);
    const statePersistence = getGitHubStatePersistenceStatus();
    res.json({
      rateLimit,
      statePersistence,
    });
  });

  // Force sync local state to/from GitHub `autodev-state` orphan branch
  app.post('/api/admin/state/sync', async (req, res) => {
    const direction = String(req.body?.direction || 'push');

    const executeStateSync = async () => {
      if (direction === 'pull') {
        const result = await hydrateGitHubStateStores({
          repoFullName: FIXED_TARGET_REPO.fullName,
          onReloadStores: () => {
            reloadRunsFromDisk();
            reloadJobsFromDisk();
            reloadAuditLogsFromDisk();
            reloadRsiStateFromDisk();
            reloadEditAuthFromDisk();
            reloadFeishuStateFromDisk();
          },
        });
        return {
          ok: result.hydrated,
          direction: 'pull',
          result,
          statePersistence: getGitHubStatePersistenceStatus(),
        };
      }

      const statePersistence = await forcePushAllLocalStateToGitHub(
        {
          runs: listRuns(),
          jobs: listAnalysisJobs(),
          auditLogs: listAuditLogs(),
          rsi: getRsiState(),
        },
        'manual-sync'
      );
      return {
        ok: !statePersistence.lastError,
        direction: 'push',
        statePersistence,
      };
    };

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'state_sync',
        title: '同步状态至 autodev-state 分支',
        roomId: 'environment',
        repoFullName: FIXED_TARGET_REPO.fullName,
        dedupeKey: `state_sync:${direction}`,
        initialMessage: '正在后台推送控制面台账至 GitHub 状态分支…',
        executor: async () => {
          const payload = await executeStateSync();
          if (!payload.ok) {
            throw new Error(payload.statePersistence?.lastError || '状态同步失败');
          }
          return {
            summary: '已将控制面台账全量同步至 GitHub autodev-state 分支',
            result: { direction },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeStateSync();
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '同步 GitHub 状态分支失败',
      });
    }
  });

  // Delete a single pipeline run (and optionally its linked analysis job)
  app.delete('/api/runs/:id', async (req, res) => {
    const runId = String(req.params.id || '').trim();
    const deleted = deleteRunById(runId);
    // Also clean up any analysis job bound exclusively to this runId so it doesn't reappear as orphan
    const linkedJobs = listAnalysisJobs().filter((j) => j.runId === runId);
    for (const j of linkedJobs) {
      deleteAnalysisJobById(j.id);
    }
    if (!deleted && linkedJobs.length === 0) {
      res.status(404).json({ error: '未找到指定流水线记录' });
      return;
    }
    const statePersistence = await flushGitHubStateNow(`delete-run:${runId}`);
    res.json({
      ok: true,
      deletedRunId: runId,
      deletedLinkedJobIds: linkedJobs.map((j) => j.id),
      statePersistence,
    });
  });

  // Delete a single analysis job
  app.delete('/api/agents/jobs/:id', async (req, res) => {
    const jobId = String(req.params.id || '').trim();
    const existing = getAnalysisJobById(jobId);
    if (!existing) {
      res.status(404).json({ error: '未找到指定规划任务记录' });
      return;
    }
    if (existing.status === 'running') {
      await cancelAnalysisJob(jobId).catch(() => null);
    }
    deleteAnalysisJobById(jobId);
    const statePersistence = await flushGitHubStateNow(`delete-job:${jobId}`);
    res.json({
      ok: true,
      deletedJobId: jobId,
      statePersistence,
    });
  });

  // Delete a single RSI test report or incident
  app.delete('/api/rsi/reports/:id', async (req, res) => {
    const reportId = String(req.params.id || '').trim();
    const deleted = deleteTestReportById(reportId);
    if (!deleted) {
      res.status(404).json({ error: '未找到指定测试报告' });
      return;
    }
    const statePersistence = await flushGitHubStateNow(`delete-report:${reportId}`);
    res.json({ ok: true, deletedReportId: reportId, statePersistence });
  });

  app.delete('/api/rsi/incidents/:id', async (req, res) => {
    const incidentId = String(req.params.id || '').trim();
    const deleted = deleteIncidentById(incidentId);
    if (!deleted) {
      res.status(404).json({ error: '未找到指定失败归因事件' });
      return;
    }
    const statePersistence = await flushGitHubStateNow(`delete-incident:${incidentId}`);
    res.json({ ok: true, deletedIncidentId: incidentId, statePersistence });
  });

  // Full clean-slate reset (GitHub PRs & branches + GitHub Actions history + scoped Cloudflare D1 + local & autodev-state branch)
  app.post('/api/admin/reset-all', async (req, res) => {
    const repoParam = String(req.body?.repoFullName || FIXED_TARGET_REPO.fullName);
    const clearState = req.body?.clearState !== false;
    const resetGithubPrsAndBranches = req.body?.resetGithubPrsAndBranches !== false;
    const deleteActionRuns = req.body?.deleteActionRuns !== false;
    const wipeCloudflareD1 = req.body?.wipeCloudflareD1 !== false;
    const wipeRepoCode = req.body?.wipeRepoCode === true;
    const keepRsiRules = req.body?.keepRsiRules === true;
    const rawTargets = Array.isArray(req.body?.d1TargetNames)
      ? req.body.d1TargetNames.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : ['community_db', 'community_db-preview'];
    const parsed = parseRepoFullName(repoParam);
    if (!parsed) {
      res.status(400).json({ error: '无效的目标仓库标识（owner/repo）' });
      return;
    }

    const executeResetAll = async (setProgress?: (msg: string) => void) => {
      setProgress?.('正在清理 GitHub Actions / PR / 分支与 Cloudflare D1…');
      const [githubReset, d1Reset] = await Promise.all([
        resetGithubPrsAndBranches || deleteActionRuns
          ? resetAutodevRepoArtifacts(parsed.owner, parsed.name, {
              resetPrsAndBranches: resetGithubPrsAndBranches,
              deleteActionRuns,
            })
          : Promise.resolve({
              closedPrNumbers: [],
              deletedBranches: [],
              cleanedIssues: [],
              remainingBranches: [],
              deletedActionRuns: 0,
              skippedActiveActionRuns: 0,
              failedActionRunDeletions: 0,
            }),
        wipeCloudflareD1
          ? wipeCloudflareD1Databases(rawTargets)
          : Promise.resolve({ connected: true, databases: [] }),
      ]);

      // Optional danger-zone clean-slate wipe of target repository main branch code
      let repoCodeWipe = null;
      if (wipeRepoCode) {
        setProgress?.(`正在清空 ${parsed.fullName} 主分支业务代码并保留 Workflows…`);
        repoCodeWipe = await wipeRepoCodeToScratch(parsed.owner, parsed.name, 'main');
      }

      let clearedRuns = 0;
      let clearedJobs = 0;
      let clearedAuditLogs = 0;
      let clearedRsi = { clearedReports: 0, clearedIncidents: 0, clearedRules: 0 };
      let statePersistence = getGitHubStatePersistenceStatus();

      if (clearState) {
        setProgress?.('正在清空本地台账并同步 autodev-state 状态分支…');
        clearedRuns = clearAllRuns();
        clearedJobs = clearAllAnalysisJobs();
        clearedAuditLogs = clearAllAuditLogs();
        clearedRsi = clearRsiHistory({ keepRules: keepRsiRules });
        statePersistence = await forcePushAllLocalStateToGitHub(
          {
            runs: listRuns(),
            jobs: listAnalysisJobs(),
            auditLogs: listAuditLogs(),
            rsi: getRsiState(),
          },
          wipeRepoCode ? 'admin-wipe-repo-and-reset' : 'admin-reset-all'
        );
      }

      invalidateGitHubReadCache();

      return {
        ok: true,
        repoFullName: parsed.fullName,
        github: githubReset,
        repoCodeWipe,
        cloudflareD1: d1Reset,
        localHistory: {
          clearedRuns,
          clearedJobs,
          clearedAuditLogs,
          ...clearedRsi,
        },
        statePersistence,
        resetAt: new Date().toISOString(),
      };
    };

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'admin_reset',
        title: wipeRepoCode ? '清空仓库代码并重置环境' : '测试环境一键清库重置',
        roomId: 'environment',
        repoFullName: parsed.fullName,
        dedupeKey: `admin_reset:${parsed.fullName}`,
        initialMessage: '正在后台执行清库与环境重置，可自由切换页面…',
        executor: async ({ setProgress }) => {
          const payload = await executeResetAll(setProgress);
          const parts: string[] = [];
          if (wipeRepoCode) {
            parts.push(`移除 ${payload.repoCodeWipe?.removedFilesCount ?? 0} 个业务文件`);
          }
          if (clearState) parts.push('状态分支已清空');
          if (deleteActionRuns) parts.push(`删除 ${payload.github.deletedActionRuns} 条 Actions`);
          if (resetGithubPrsAndBranches) {
            const issueCount = payload.github.cleanedIssues?.length ?? 0;
            parts.push(
              `关 ${payload.github.closedPrNumbers.length} PR / 删 ${payload.github.deletedBranches.length} 分支` +
                (issueCount > 0 ? ` / 清 ${issueCount} 个追踪 Issue` : '')
            );
          }
          return {
            summary: parts.join(' · ') || '测试环境重置完成',
            result: { wipeRepoCode, resetAt: payload.resetAt },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeResetAll();
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '执行环境全面清理失败',
      });
    }
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
        agyMode,
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
        agyMode: agyMode ? String(agyMode) : undefined,
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
        detail: `派发 VPS AGY 在分支 ${cleanBranch} 执行编码（模型：${result.model} · 模式：${result.mode}）`,
      });

      void watchAgyCodingRunAndNotifyFeishu({
        owner: parsed.owner,
        repo: parsed.name,
        repoFullName: parsed.fullName,
        prBranch: cleanBranch,
        prNumber: prNumber ? Number(prNumber) : linkedRun?.draftPr?.prNumber,
        prUrl: linkedRun?.draftPr?.prUrl,
        runId: linkedRun?.id || (runId ? String(runId) : undefined),
        prdTitle: linkedRun?.prdTitle || cleanBranch,
        dispatchedAtMs: Date.now(),
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

    const executeDeployPreview = async () => {
      try {
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
          action: deployMode === 'production' ? 'production_deployed' : 'preview_deployed',
          repoFullName: parsed.fullName,
          runId: existingRun?.id,
          prdTitle: existingRun?.prdTitle,
          branch: resolvedBranch,
          prNumber: resolvedPrNumber,
          detail: `部署${deployment.isIsolatedPreview ? '隔离预览' : '生产'} Worker ${deployment.workerName} (${deployment.url})`,
        });

        await notifyFeishuStageEvent({
          kind: deployMode === 'production' ? 'production_deployed' : 'preview_deployed',
          prdTitle: existingRun?.prdTitle || resolvedBranch,
          repoFullName: parsed.fullName,
          runId: existingRun?.id,
          branchName: resolvedBranch,
          prNumber: resolvedPrNumber,
          prUrl: existingRun?.draftPr?.prUrl,
          previewUrl: deployMode === 'preview' ? deployment.url : undefined,
          productionUrl: deployMode === 'production' ? deployment.url : undefined,
          summary: `Worker ${deployment.workerName} 已部署上线。`,
        });

        return {
          deployment,
          deployLogTail,
          run: updatedRun,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Cloudflare Workers 预览部署失败';
        void captureAndReflectIncident({
          sourceRefKey: `deploy-preview:${resolvedBranch}:${Date.now()}`,
          source: 'deploy_error',
          repoFullName: parsed.fullName,
          title: `Cloudflare 预览部署失败（${resolvedBranch}）`,
          errorSummary: errMsg,
          rawEvidence: errMsg,
          relatedRunId: existingRun?.id,
          branch: resolvedBranch,
        }).catch(() => {});
        await notifyFeishuStageEvent({
          kind: deployMode === 'production' ? 'production_failed' : 'preview_failed',
          prdTitle: existingRun?.prdTitle || resolvedBranch,
          repoFullName: parsed.fullName,
          runId: existingRun?.id,
          branchName: resolvedBranch,
          prNumber: resolvedPrNumber,
          prUrl: existingRun?.draftPr?.prUrl,
          error: errMsg,
        });
        throw new Error(errMsg);
      }
    };

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'deploy_preview',
        title: `部署 Cloudflare ${deployMode === 'production' ? '生产' : '隔离预览'}（${resolvedBranch}）`,
        roomId: 'approval',
        runId: existingRun?.id,
        repoFullName: parsed.fullName,
        dedupeKey: `deploy_preview:${parsed.fullName}:${resolvedBranch}`,
        initialMessage: `正在后台构建并部署分支 ${resolvedBranch} 到 Cloudflare Workers…`,
        executor: async () => {
          const payload = await executeDeployPreview();
          return {
            summary: `预览环境已就绪：${payload.deployment.url}`,
            result: { url: payload.deployment.url, workerName: payload.deployment.workerName, runId: existingRun?.id },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeDeployPreview();
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Cloudflare Workers 预览部署失败',
      });
    }
  });

  // Shared helper: Deploy or re-deploy production Cloudflare Workers from merged main branch
  async function executeProductionDeploy(params: {
    runId?: string;
    repoFullName?: string;
    branchName?: string;
    workerName?: string;
    actor?: string;
    chatId?: string;
  }) {
    const existingRun = params.runId ? getRunById(String(params.runId)) : undefined;
    const resolvedRepo = String(
      params.repoFullName || existingRun?.repoFullName || FIXED_TARGET_REPO.fullName
    );
    const parsed = parseRepoFullName(resolvedRepo);
    if (!parsed) {
      throw new Error('无效的目标仓库标识（owner/repo）');
    }

    const resolvedBranch = String(
      params.branchName ||
        existingRun?.mergedRelease?.baseBranch ||
        existingRun?.defaultBranch ||
        'main'
    ).trim();

    try {
      const { deployment, deployLogTail } = await deployBranchPreviewToCloudflare({
        owner: parsed.owner,
        repo: parsed.name,
        branchName: resolvedBranch,
        workerNameOverride: params.workerName ? String(params.workerName) : undefined,
        prNumber: existingRun?.draftPr?.prNumber,
        mode: 'production',
      });

      const updatedRun = existingRun
        ? updateRunReview(existingRun.id, { productionDeployment: deployment })
        : undefined;

      appendAuditLog({
        category: 'execution',
        action: 'production_deployed',
        actor: params.actor || '控制面操作员',
        repoFullName: parsed.fullName,
        runId: existingRun?.id,
        prdTitle: existingRun?.prdTitle,
        branch: resolvedBranch,
        prNumber: existingRun?.draftPr?.prNumber,
        detail: `部署正式生产环境 Worker ${deployment.workerName}（${deployment.url}）`,
      });

      await notifyFeishuStageEvent({
        kind: 'production_deployed',
        prdTitle: existingRun?.prdTitle || `${parsed.fullName}@${resolvedBranch}`,
        repoFullName: parsed.fullName,
        runId: existingRun?.id,
        branchName: resolvedBranch,
        prNumber: existingRun?.draftPr?.prNumber,
        prUrl: existingRun?.draftPr?.prUrl,
        productionUrl: deployment.url,
        summary: `生产 Worker ${deployment.workerName} 已重新发布上线。`,
        chatId: params.chatId,
      });

      return { deployment, deployLogTail, run: updatedRun };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Cloudflare 生产环境部署失败';
      appendAuditLog({
        category: 'execution',
        action: 'production_deployed',
        actor: params.actor || '控制面操作员',
        repoFullName: parsed.fullName,
        runId: existingRun?.id,
        prdTitle: existingRun?.prdTitle,
        branch: resolvedBranch,
        prNumber: existingRun?.draftPr?.prNumber,
        status: 'failed',
        detail: `重新部署生产环境失败：${errMsg}`,
      });
      void captureAndReflectIncident({
        sourceRefKey: `deploy-production:${resolvedBranch}:${Date.now()}`,
        source: 'deploy_error',
        repoFullName: parsed.fullName,
        title: `Cloudflare 生产部署失败（${resolvedBranch}）`,
        errorSummary: errMsg,
        rawEvidence: errMsg,
        relatedRunId: existingRun?.id,
        branch: resolvedBranch,
      }).catch(() => {});
      await notifyFeishuStageEvent({
        kind: 'production_failed',
        prdTitle: existingRun?.prdTitle || `${parsed.fullName}@${resolvedBranch}`,
        repoFullName: parsed.fullName,
        runId: existingRun?.id,
        branchName: resolvedBranch,
        prNumber: existingRun?.draftPr?.prNumber,
        prUrl: existingRun?.draftPr?.prUrl,
        error: errMsg,
        chatId: params.chatId,
      });
      throw new Error(errMsg);
    }
  }

  // Module 4: Dedicated Production Cloudflare Workers Deploy / Redeploy endpoint
  app.post('/api/cloudflare/deploy-production', async (req, res) => {
    const { runId, repoFullName, branchName, workerName } = req.body ?? {};
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
      branchName ||
        existingRun?.mergedRelease?.baseBranch ||
        existingRun?.defaultBranch ||
        'main'
    ).trim();

    if (req.body?.async === true) {
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: 'deploy_production',
        title: `部署生产环境（${existingRun?.prdTitle?.slice(0, 22) || resolvedBranch}）`,
        roomId: 'approval',
        runId: existingRun?.id,
        repoFullName: parsed.fullName,
        dedupeKey: `deploy_production:${parsed.fullName}:${resolvedBranch}`,
        initialMessage: `正在后台构建主分支 ${resolvedBranch} 并发布至 Cloudflare 生产环境…`,
        executor: async () => {
          const payload = await executeProductionDeploy({
            runId: existingRun?.id,
            repoFullName: parsed.fullName,
            branchName: resolvedBranch,
            workerName: workerName ? String(workerName) : undefined,
          });
          return {
            summary: `生产环境已上线：${payload.deployment.url}`,
            result: {
              url: payload.deployment.url,
              workerName: payload.deployment.workerName,
              runId: existingRun?.id,
            },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    try {
      const payload = await executeProductionDeploy({
        runId: existingRun?.id,
        repoFullName: parsed.fullName,
        branchName: resolvedBranch,
        workerName: workerName ? String(workerName) : undefined,
      });
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Cloudflare 生产环境部署失败',
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

    const executeReview = async (setProgress?: (msg: string) => void) => {
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
      let productionDeployResult:
        | {
            deployed: boolean;
            deployment?: PreviewDeployment;
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
          setProgress?.(`正在解除 PR #${updated.draftPr.prNumber} Draft 状态并合并至主分支…`);
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

            // Automatically deploy merged main branch to production Cloudflare Workers!
            try {
              const targetProdBranch = resMerge.release.baseBranch || updated?.defaultBranch || 'main';
              setProgress?.(`已合入 ${targetProdBranch}，正在自动部署生产 Cloudflare Workers…`);
              const { deployment } = await deployBranchPreviewToCloudflare({
                owner: parsed.owner,
                repo: parsed.name,
                branchName: targetProdBranch,
                prNumber: updated?.draftPr?.prNumber,
                mode: 'production',
              });
              updated = updateRunReview(runId, { productionDeployment: deployment });
              productionDeployResult = { deployed: true, deployment };
            } catch (prodErr) {
              productionDeployResult = {
                deployed: false,
                error: prodErr instanceof Error ? prodErr.message : '自动部署生产环境失败',
              };
            }
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
          setProgress?.(`正在向原分支 ${updated.draftPr.branchName} 写入返工意见并派发 AGY…`);
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
            }）。${
              productionDeployResult?.deployed && productionDeployResult.deployment
                ? `\n\n已自动部署至 Cloudflare Workers 生产环境：${productionDeployResult.deployment.url}`
                : ''
            }`;
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
              ? `验收通过并合入 ${mergeResult.baseBranch || 'main'}（Commit ${(mergeResult.mergeCommitSha || '').slice(0, 7)}）${
                  productionDeployResult?.deployed && productionDeployResult.deployment
                    ? `，已自动部署生产：${productionDeployResult.deployment.url}`
                    : productionDeployResult?.error
                      ? `（生产自动部署异常：${productionDeployResult.error}）`
                      : ''
                }`
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
              ? `退回修订：已在原需求分支 ${origBranch} 写入 docs/revision-feedback.md 并派发 VPS AGY 修复${
                  approvalNote ? `（意见：${String(approvalNote).trim()}）` : ''
                }`
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

      if (updated) {
        if (decision === 'approved') {
          if (productionDeployResult?.deployed && productionDeployResult.deployment) {
            await notifyFeishuStageEvent({
              kind: 'production_deployed',
              prdTitle: updated.prdTitle,
              repoFullName: updated.repoFullName,
              runId: updated.id,
              branchName: mergeResult?.baseBranch || updated.defaultBranch,
              prNumber: updated.draftPr?.prNumber,
              prUrl: updated.draftPr?.prUrl,
              productionUrl: productionDeployResult.deployment.url,
              summary: `PR 已合入 ${mergeResult?.baseBranch || 'main'} 并自动发布生产环境。`,
            });
          } else if (productionDeployResult && !productionDeployResult.deployed) {
            await notifyFeishuStageEvent({
              kind: 'production_failed',
              prdTitle: updated.prdTitle,
              repoFullName: updated.repoFullName,
              runId: updated.id,
              branchName: mergeResult?.baseBranch || updated.defaultBranch,
              prNumber: updated.draftPr?.prNumber,
              prUrl: updated.draftPr?.prUrl,
              error: productionDeployResult.error || '自动部署生产环境失败',
            });
          } else if (mergeResult && !mergeResult.merged) {
            await notifyFeishuStageEvent({
              kind: 'production_failed',
              prdTitle: updated.prdTitle,
              repoFullName: updated.repoFullName,
              runId: updated.id,
              branchName: updated.draftPr?.branchName || updated.defaultBranch,
              prNumber: updated.draftPr?.prNumber,
              prUrl: updated.draftPr?.prUrl,
              error: `PR 合并失败：${mergeResult.error || '请检查冲突'}`,
            });
          }
        } else if (decision === 'changes_requested' && reworkResult?.dispatched) {
          const parsedReworkRepo = parseRepoFullName(updated.repoFullName);
          await notifyFeishuStageEvent({
            kind: 'rework_dispatched',
            prdTitle: updated.prdTitle,
            repoFullName: updated.repoFullName,
            runId: updated.id,
            branchName: reworkResult.branchName,
            prNumber: updated.draftPr?.prNumber,
            prUrl: updated.draftPr?.prUrl,
            actionsUrl: reworkResult.actionsUrl,
            summary: reworkResult.note || '已按人工修订意见启动自动返工。',
          });
          if (parsedReworkRepo) {
            void watchAgyCodingRunAndNotifyFeishu({
              owner: parsedReworkRepo.owner,
              repo: parsedReworkRepo.name,
              repoFullName: parsedReworkRepo.fullName,
              prBranch: reworkResult.branchName,
              prNumber: updated.draftPr?.prNumber,
              prUrl: updated.draftPr?.prUrl,
              runId: updated.id,
              prdTitle: updated.prdTitle,
              dispatchedAtMs: Date.now(),
            });
          }
        }
      }

      return {
        run: updated,
        githubSync,
        mergeResult,
        productionDeployResult,
        reworkResult,
        rsiIncidentId,
      };
    };

    if (req.body?.async === true && (decision === 'approved' || decision === 'changes_requested')) {
      const isApprove = decision === 'approved';
      const { task, deduplicated } = enqueueBackgroundTask({
        kind: isApprove ? 'approve_release' : 'request_rework',
        title: isApprove
          ? `批准上线并自动发布：${existing.prdTitle.slice(0, 24)}`
          : `退回修订并派发返工：${existing.prdTitle.slice(0, 24)}`,
        roomId: 'approval',
        runId: existing.id,
        repoFullName: existing.repoFullName,
        dedupeKey: `review:${existing.id}:${decision}`,
        initialMessage: isApprove
          ? '正在后台合并 PR 并部署生产环境，可自由切换页面…'
          : '正在后台提交修订意见并派发 AGY 原分支返工…',
        executor: async ({ setProgress }) => {
          const outcome = await executeReview(setProgress);
          if (isApprove && outcome.mergeResult && !outcome.mergeResult.merged) {
            throw new Error(`PR 合并失败：${outcome.mergeResult.error || '请检查冲突'}`);
          }
          if (isApprove && outcome.productionDeployResult && !outcome.productionDeployResult.deployed) {
            throw new Error(`已合并主分支，但生产部署异常：${outcome.productionDeployResult.error || '未知错误'}`);
          }
          if (!isApprove && outcome.reworkResult && !outcome.reworkResult.dispatched) {
            throw new Error(`已记录退回意见，但派发 AGY 返工失败：${outcome.reworkResult.error || '未知错误'}`);
          }
          const summary = isApprove
            ? outcome.productionDeployResult?.deployment?.url
              ? `已合入主分支并上线生产：${outcome.productionDeployResult.deployment.url}`
              : '已验收通过并合入主分支'
            : outcome.reworkResult?.dispatched
              ? `已写入返工指令并派发 AGY 在 ${outcome.reworkResult.branchName} 修复`
              : '已退回修订';
          return {
            summary,
            result: { runId: existing.id, decision },
          };
        },
      });
      res.status(202).json({ async: true, deduplicated, task });
      return;
    }

    const payload = await executeReview();
    res.json(payload);
  });

  // =========================================================================
  // Feishu (Lark) Bot Integration: Coding Completion Watcher + Webhook Routes
  // =========================================================================
  async function watchAgyCodingRunAndNotifyFeishu(params: {
    owner: string;
    repo: string;
    repoFullName: string;
    prBranch: string;
    prNumber?: number;
    prUrl?: string;
    runId?: string;
    prdTitle: string;
    dispatchedAtMs: number;
    chatId?: string;
  }): Promise<void> {
    if (!getFeishuIntegrationStatus().configured) return;
    const key = `${params.owner}/${params.repo}:${params.prBranch}`;
    if (activeAgyCodingWatchers.has(key)) return;
    activeAgyCodingWatchers.add(key);

    const maxWaitMs = 185 * 60 * 1000;
    const pollIntervalMs = 20_000;
    const startedAt = Date.now();
    let trackedActionRunId: number | null = null;

    try {
      while (Date.now() - startedAt < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        try {
          const listRes = await listGitHubActionRuns(params.owner, params.repo, 15);
          type RunEntry = (typeof listRes.runs)[number];
          const matchedById: RunEntry | undefined =
            trackedActionRunId !== null
              ? listRes.runs.find((r) => r.id === trackedActionRunId)
              : undefined;
          const candidate: RunEntry | undefined =
            matchedById ??
            listRes.runs.find((r) => {
              const nameLower = (r.name || '').toLowerCase();
              const isPlan = nameLower.includes('plan');
              const isCoding = !isPlan && (nameLower.includes('agy') || nameLower.includes('coding'));
              const createdMs = Date.parse(r.createdAt);
              return isCoding && Number.isFinite(createdMs) && createdMs >= params.dispatchedAtMs - 15_000;
            });

          if (!candidate) continue;
          trackedActionRunId = candidate.id;

          if (candidate.status === 'completed') {
            await syncRepoTestReportsAndFailures(params.owner, params.repo, {
              autoAnalyzeLimit: 2,
            }).catch(() => null);

            const reports = getRsiState().testReports.filter(
              (rep) =>
                rep.actionsRunId === candidate.id ||
                (params.runId && rep.pipelineRunId === params.runId) ||
                rep.branch === params.prBranch
            );
            const latestRep = reports[0];
            const succeeded = candidate.conclusion === 'success';

            await notifyFeishuStageEvent({
              kind: succeeded ? 'coding_completed' : 'coding_failed',
              prdTitle: params.prdTitle,
              repoFullName: params.repoFullName,
              runId: params.runId,
              branchName: params.prBranch,
              prNumber: params.prNumber,
              prUrl: params.prUrl,
              actionsUrl: candidate.htmlUrl,
              passedTests: latestRep?.passed,
              failedTests: latestRep?.failed,
              summary:
                latestRep?.summary ||
                (succeeded
                  ? 'VPS AGY 已完成代码实现并推送到 PR 分支。'
                  : `GitHub Actions 结束状态：${candidate.conclusion || 'failure'}`),
              error: succeeded
                ? undefined
                : `Actions #${candidate.id} 结束状态：${candidate.conclusion || 'failure'}`,
              chatId: params.chatId,
            });
            return;
          }
        } catch {
          // Ignore transient GitHub polling errors
        }
      }
    } finally {
      activeAgyCodingWatchers.delete(key);
    }
  }

  // Helper: execute Draft PR creation for a run (shared with Feishu card callback)
  async function executeFeishuDraftPrCreation(runId: string, chatId?: string) {
    const targetRun = getRunById(runId);
    if (!targetRun) throw new Error('未找到对应的需求规划记录');
    if (targetRun.draftPr) {
      return { draftPr: targetRun.draftPr, run: targetRun };
    }
    const parsedRepo = parseRepoFullName(targetRun.repoFullName);
    if (!parsedRepo) throw new Error(`无效的目标仓库格式：${targetRun.repoFullName}`);

    const artifacts = buildPrArtifacts(targetRun);
    const draftPr = await createSpecDraftPr({
      owner: parsedRepo.owner,
      repo: parsedRepo.name,
      baseBranch: targetRun.defaultBranch,
      artifacts,
    });

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
      } catch {
        // non-fatal
      }
    }

    const updatedRun = attachDraftPrToRun(targetRun.id, draftPr) || {
      ...targetRun,
      status: 'pr_created' as const,
      draftPr,
    };

    appendAuditLog({
      category: 'planning',
      action: 'draft_pr_created',
      actor: '飞书机器人',
      repoFullName: targetRun.repoFullName,
      runId: targetRun.id,
      prdTitle: targetRun.prdTitle,
      branch: draftPr.branchName,
      prNumber: draftPr.prNumber,
      detail: `通过飞书卡片创建 Draft PR #${draftPr.prNumber}（分支 ${draftPr.branchName}）`,
    });

    await notifyFeishuStageEvent({
      kind: 'draft_pr_created',
      prdTitle: targetRun.prdTitle,
      repoFullName: targetRun.repoFullName,
      runId: targetRun.id,
      branchName: draftPr.branchName,
      prNumber: draftPr.prNumber,
      prUrl: draftPr.prUrl,
      summary: `特性分支 ${draftPr.branchName} 与隔离盲测用例已提交。`,
      chatId,
    });

    return { draftPr, run: updatedRun };
  }

  // Feishu Event Subscription Webhook (URL Verification + @Bot im.message.receive_v1)
  app.post('/api/feishu/events', (req, res) => {
    const rawBody = (req as RequestWithRawBody).rawBody ?? JSON.stringify(req.body ?? {});
    const verified = verifyAndDecodeFeishuWebhook({
      rawBody,
      body: req.body,
      headers: req.headers,
    });
    if (!verified.ok) {
      res.status(verified.statusCode).json({ error: verified.error, code: verified.code });
      return;
    }

    const parsed = parseFeishuEventBody(verified.payload);
    if (parsed.kind === 'url_verification' && parsed.challenge) {
      res.json({ challenge: parsed.challenge });
      return;
    }

    if (isDuplicateFeishuEvent(parsed.eventId)) {
      res.json({ code: 0 });
      return;
    }

    // Respond immediately (<300ms) so Feishu does not retry due to 3s webhook timeout
    res.json({ code: 0 });

    if (parsed.kind !== 'im_message' || !parsed.message || !parsed.message.mentionsBot) {
      return;
    }

    const msg = parsed.message;
    if (!isFeishuChatAllowed(msg.chatId)) {
      return;
    }
    rememberFeishuActiveChat(msg.chatId);

    void (async () => {
      const clean = msg.cleanText.trim();
      const appBaseUrl = getFeishuAppBaseUrl() || undefined;
      const askingStatus = /^(\/status|状态|进度|当前状态)$/i.test(clean);

      if (askingStatus) {
        const runningJob = getRunningAnalysisJob();
        const latestRun = listRuns()[0];
        if (runningJob) {
          const card = buildFeishuStageCard({
            kind: 'rework_dispatched',
            prdTitle: `架构规划进行中 · ${runningJob.prdTitle}`,
            repoFullName: runningJob.repoFullName,
            jobId: runningJob.id,
            actionsUrl: runningJob.planActionsUrl,
            summary: '当前正在执行多智能体架构与盲测规划，完成后会自动推送操作卡片。',
            appBaseUrl,
            chatId: msg.chatId,
          });
          await replyFeishuCardMessage(msg.messageId, card).catch(() =>
            sendFeishuCardMessage(msg.chatId, card)
          );
          return;
        }
        if (latestRun) {
          const stageKind = latestRun.productionDeployment
            ? 'production_deployed'
            : latestRun.mergedRelease
              ? 'production_failed'
              : latestRun.previewDeployment
                ? 'preview_deployed'
                : latestRun.draftPr
                  ? 'draft_pr_created'
                  : 'plan_completed';
          const card = buildFeishuStageCard({
            kind: stageKind,
            prdTitle: latestRun.prdTitle,
            repoFullName: latestRun.repoFullName,
            runId: latestRun.id,
            branchName: latestRun.draftPr?.branchName,
            prNumber: latestRun.draftPr?.prNumber,
            prUrl: latestRun.draftPr?.prUrl,
            previewUrl: latestRun.previewDeployment?.url,
            productionUrl: latestRun.productionDeployment?.url,
            appBaseUrl,
            chatId: msg.chatId,
          });
          await replyFeishuCardMessage(msg.messageId, card).catch(() =>
            sendFeishuCardMessage(msg.chatId, card)
          );
          return;
        }
      }

      // Derive optional prefill from message text after @bot
      let prefillTitle = '';
      let prefillContent = '';
      if (clean && !/^(启动需求|发起需求|新建需求|新需求|需求|start|new)$/i.test(clean)) {
        const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          prefillTitle = lines[0].slice(0, 60);
          prefillContent = lines.slice(1).join('\n');
        } else if (clean.length <= 36) {
          prefillTitle = clean;
        } else {
          prefillTitle = clean.slice(0, 30);
          prefillContent = clean;
        }
      }

      const formCard = buildFeishuPrdFormCard({
        repoFullName: FIXED_TARGET_REPO.fullName,
        chatId: msg.chatId,
        prefillTitle,
        prefillContent,
        appBaseUrl,
      });

      const replyRes = await replyFeishuCardMessage(msg.messageId, formCard);
      if (!replyRes.ok) {
        await sendFeishuCardMessage(msg.chatId, formCard);
      }
    })();
  });

  // Feishu Interactive Card Action Callback (Form Submission & Next-Stage Buttons)
  app.post('/api/feishu/card-action', (req, res) => {
    const rawBody = (req as RequestWithRawBody).rawBody ?? JSON.stringify(req.body ?? {});
    const verified = verifyAndDecodeFeishuWebhook({
      rawBody,
      body: req.body,
      headers: req.headers,
    });
    if (!verified.ok) {
      res.status(verified.statusCode).json({ error: verified.error, code: verified.code });
      return;
    }

    const parsed = parseFeishuCardCallbackBody(verified.payload);
    if (parsed.kind === 'url_verification' && parsed.challenge) {
      res.json({ challenge: parsed.challenge });
      return;
    }

    if (parsed.kind !== 'card_action' || !parsed.actionType) {
      res.json({ toast: { type: 'info', content: '已收到卡片回调' } });
      return;
    }

    const chatId = parsed.chatId || '';
    if (chatId && !isFeishuChatAllowed(chatId)) {
      res.json({ toast: { type: 'error', content: '当前会话未在允许列表中，操作已拒绝' } });
      return;
    }
    if (chatId) {
      rememberFeishuActiveChat(chatId);
    }

    if (parsed.eventId && isDuplicateFeishuEvent(parsed.eventId)) {
      res.json({ toast: { type: 'info', content: '该操作已受理，请勿重复点击' } });
      return;
    }

    const action = parsed.actionType;
    const val = parsed.actionValue;
    const form = parsed.formValue;
    const appBaseUrl = getFeishuAppBaseUrl() || undefined;

    if (action === 'open_prd_form') {
      res.json({ toast: { type: 'info', content: '正在发送需求收集表单卡片…' } });
      if (chatId) {
        void sendFeishuCardMessage(
          chatId,
          buildFeishuPrdFormCard({
            repoFullName: FIXED_TARGET_REPO.fullName,
            chatId,
            appBaseUrl,
          })
        );
      }
      return;
    }

    if (action === 'submit_prd_form') {
      const prdTitle = (form.prd_title || '').trim();
      const prdContent = (form.prd_content || '').trim();
      const techStackHint = (form.tech_stack_hint || '').trim() || undefined;
      const agyModel = (form.agy_model || '').trim() || undefined;
      const repoFullName = (val.repo || FIXED_TARGET_REPO.fullName).trim();

      const check = validatePrdInput({ repoFullName, prdTitle, prdContent });
      if (!check.valid) {
        const firstErr = Object.values(check.errors)[0] || '请完整填写需求标题与 PRD 详情';
        res.json({ toast: { type: 'error', content: firstErr } });
        return;
      }

      const running = getRunningAnalysisJob();
      if (running) {
        res.json({
          toast: {
            type: 'warning',
            content: `已有规划任务「${running.prdTitle}」正在执行，请等待完成后再发起`,
          },
        });
        return;
      }

      try {
        const job = createAndStartAnalysisJob({
          repoFullName,
          defaultBranch: FIXED_TARGET_REPO.defaultBranch,
          prdTitle,
          prdContent,
          techStackHint,
          agyModel,
          executionMode: 'vps_agy',
        });
        appendAuditLog({
          category: 'planning',
          action: 'prd_analysis_started',
          actor: '飞书机器人',
          repoFullName: job.repoFullName,
          jobId: job.id,
          prdTitle: job.prdTitle,
          branch: job.defaultBranch,
          detail: `通过飞书卡片发起需求规划（${job.agyModel || '默认模型'}）`,
        });
        res.json({
          toast: {
            type: 'success',
            content: `已启动「${prdTitle}」架构规划，完成后将自动推送下一步卡片！`,
          },
        });
      } catch (err) {
        res.json({
          toast: {
            type: 'error',
            content: err instanceof Error ? err.message : '启动架构规划失败',
          },
        });
      }
      return;
    }

    if (action === 'create_draft_pr') {
      const runId = (val.run_id || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      if (!run) {
        res.json({ toast: { type: 'error', content: '未找到对应的需求规划记录' } });
        return;
      }
      if (run.draftPr) {
        res.json({
          toast: { type: 'info', content: `Draft PR #${run.draftPr.prNumber} 已创建，无需重复操作` },
        });
        return;
      }
      enqueueBackgroundTask({
        kind: 'create_draft_pr',
        title: `[飞书] 创建 Draft PR：${run.prdTitle.slice(0, 24)}`,
        roomId: 'prd',
        runId: run.id,
        repoFullName: run.repoFullName,
        dedupeKey: `create_draft_pr:${run.id}`,
        initialMessage: '正在后台创建 GitHub Draft PR 并提交规格契约…',
        executor: async () => {
          const outcome = await executeFeishuDraftPrCreation(run.id, chatId);
          return {
            summary: `Draft PR #${outcome.draftPr.prNumber} 已创建`,
            result: { prNumber: outcome.draftPr.prNumber, prUrl: outcome.draftPr.prUrl },
          };
        },
      });
      res.json({
        toast: { type: 'success', content: '已受理创建 Draft PR，完成后将在本群推送编码卡片' },
      });
      return;
    }

    if (action === 'dispatch_agy') {
      const runId = (val.run_id || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      const branch = (val.branch || run?.draftPr?.branchName || '').trim();
      const prNumber = Number(val.pr_number || run?.draftPr?.prNumber || 0) || undefined;
      const parsedRepo = parseRepoFullName(run?.repoFullName || FIXED_TARGET_REPO.fullName);

      if (!parsedRepo || !branch) {
        res.json({ toast: { type: 'error', content: '缺少目标 PR 分支信息，无法派发 AGY 编码' } });
        return;
      }

      res.json({
        toast: { type: 'success', content: `正在向分支 ${branch} 派发 AGY 自动编码，完成后自动通知` },
      });

      void (async () => {
        try {
          const rsiGuidelinesMd = buildRsiGuidelinesMarkdown(listAllRsiRules());
          if (rsiGuidelinesMd && branch !== 'main' && branch !== 'master') {
            await commitRsiGuidelinesToBranch({
              owner: parsedRepo.owner,
              repo: parsedRepo.name,
              branchName: branch,
              markdownContent: rsiGuidelinesMd,
            }).catch(() => {});
            recordRulesAppliedForStage('coding');
          }
          const sessionPolicy = decideAgySessionPolicy({
            targetBranch: branch,
            lastAgySession: run?.lastAgySession,
          });
          const dispatchRes = await dispatchAgyWorkflow({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            prBranch: branch,
            prNumber,
            runId: run?.id,
            e2eTestPath: run?.draftPr?.e2eTestPath,
            baseBranch: run?.defaultBranch || 'main',
            sessionMode: sessionPolicy.mode,
            resumeSessionId: sessionPolicy.resumeSessionId,
          });
          appendAuditLog({
            category: 'execution',
            action: 'agy_coding_dispatched',
            actor: '飞书机器人',
            repoFullName: parsedRepo.fullName,
            runId: run?.id,
            prdTitle: run?.prdTitle,
            branch,
            prNumber,
            detail: `通过飞书卡片派发 VPS AGY 编码（模型：${dispatchRes.model}）`,
          });
          void watchAgyCodingRunAndNotifyFeishu({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            repoFullName: parsedRepo.fullName,
            prBranch: branch,
            prNumber,
            prUrl: run?.draftPr?.prUrl,
            runId: run?.id,
            prdTitle: run?.prdTitle || branch,
            dispatchedAtMs: Date.now(),
            chatId,
          });
        } catch (err) {
          await notifyFeishuStageEvent({
            kind: 'coding_failed',
            prdTitle: run?.prdTitle || branch,
            repoFullName: parsedRepo.fullName,
            runId: run?.id,
            branchName: branch,
            prNumber,
            prUrl: run?.draftPr?.prUrl,
            error: err instanceof Error ? err.message : '派发 AGY 编码流水线失败',
            chatId,
          });
        }
      })();
      return;
    }

    if (action === 'deploy_preview') {
      const runId = (val.run_id || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      const branch = (val.branch || run?.draftPr?.branchName || '').trim();
      const prNumber = Number(val.pr_number || run?.draftPr?.prNumber || 0) || undefined;
      const parsedRepo = parseRepoFullName(run?.repoFullName || FIXED_TARGET_REPO.fullName);

      if (!parsedRepo || !branch) {
        res.json({ toast: { type: 'error', content: '缺少目标分支信息，无法部署隔离预览' } });
        return;
      }

      enqueueBackgroundTask({
        kind: 'deploy_preview',
        title: `[飞书] 部署隔离预览（${branch}）`,
        roomId: 'approval',
        runId: run?.id,
        repoFullName: parsedRepo.fullName,
        dedupeKey: `deploy_preview:${parsedRepo.fullName}:${branch}`,
        initialMessage: `正在后台部署分支 ${branch} 到隔离 Cloudflare Preview…`,
        executor: async () => {
          try {
            const { deployment } = await deployBranchPreviewToCloudflare({
              owner: parsedRepo.owner,
              repo: parsedRepo.name,
              branchName: branch,
              prNumber,
              mode: 'preview',
            });
            if (run) attachPreviewDeploymentToRun(run.id, deployment);
            appendAuditLog({
              category: 'execution',
              action: 'preview_deployed',
              actor: '飞书机器人',
              repoFullName: parsedRepo.fullName,
              runId: run?.id,
              prdTitle: run?.prdTitle,
              branch,
              prNumber,
              detail: `通过飞书卡片部署隔离预览 Worker ${deployment.workerName} (${deployment.url})`,
            });
            await notifyFeishuStageEvent({
              kind: 'preview_deployed',
              prdTitle: run?.prdTitle || branch,
              repoFullName: parsedRepo.fullName,
              runId: run?.id,
              branchName: branch,
              prNumber,
              prUrl: run?.draftPr?.prUrl,
              previewUrl: deployment.url,
              summary: `预览 Worker ${deployment.workerName} 已就绪。`,
              chatId,
            });
            return {
              summary: `预览环境已就绪：${deployment.url}`,
              result: { url: deployment.url, workerName: deployment.workerName },
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : '预览环境部署失败';
            await notifyFeishuStageEvent({
              kind: 'preview_failed',
              prdTitle: run?.prdTitle || branch,
              repoFullName: parsedRepo.fullName,
              runId: run?.id,
              branchName: branch,
              prNumber,
              prUrl: run?.draftPr?.prUrl,
              error: errMsg,
              chatId,
            });
            throw new Error(errMsg);
          }
        },
      });

      res.json({
        toast: { type: 'success', content: '正在后台部署隔离预览环境，完成后将推送预览链接' },
      });
      return;
    }

    if (action === 'approve_release') {
      const runId = (val.run_id || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      if (!run || !run.draftPr) {
        res.json({ toast: { type: 'error', content: '未找到可合并上线的 Draft PR 记录' } });
        return;
      }
      const parsedRepo = parseRepoFullName(run.repoFullName);
      if (!parsedRepo) {
        res.json({ toast: { type: 'error', content: '目标仓库格式无效' } });
        return;
      }

      enqueueBackgroundTask({
        kind: 'approve_release',
        title: `[飞书] 批准上线并发布：${run.prdTitle.slice(0, 22)}`,
        roomId: 'approval',
        runId: run.id,
        repoFullName: run.repoFullName,
        dedupeKey: `review:${run.id}:approved`,
        initialMessage: '正在后台合并 PR 并部署生产环境…',
        executor: async ({ setProgress }) => {
          updateRunReview(run.id, {
            status: 'approved',
            approvalNote: '通过飞书卡片批准上线',
            approvedAt: new Date().toISOString(),
          });
          setProgress?.(`正在合并 PR #${run.draftPr!.prNumber} 到主分支…`);
          const resMerge = await mergeDraftPrToMain({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            prNumber: run.draftPr!.prNumber,
            commitTitle: `feat(autodev): ${run.prdTitle} (#${run.draftPr!.prNumber})`,
            commitMessage: 'Approved and merged via Feishu Bot',
            mergeMethod: 'squash',
          });
          if (!resMerge.merged || !resMerge.release) {
            const errMsg = resMerge.error || 'PR 合并失败';
            await notifyFeishuStageEvent({
              kind: 'production_failed',
              prdTitle: run.prdTitle,
              repoFullName: run.repoFullName,
              runId: run.id,
              branchName: run.draftPr!.branchName,
              prNumber: run.draftPr!.prNumber,
              prUrl: run.draftPr!.prUrl,
              error: `PR 合并失败：${errMsg}`,
              chatId,
            });
            throw new Error(errMsg);
          }

          updateRunReview(run.id, { mergedRelease: resMerge.release });
          appendAuditLog({
            category: 'approval',
            action: 'release_approved',
            actor: '飞书审批人',
            repoFullName: run.repoFullName,
            runId: run.id,
            prdTitle: run.prdTitle,
            branch: resMerge.release.baseBranch,
            prNumber: run.draftPr!.prNumber,
            detail: `通过飞书卡片验收通过并合入 ${resMerge.release.baseBranch}`,
          });

          setProgress?.(`已合入 ${resMerge.release.baseBranch}，正在自动部署生产环境…`);
          const prodRes = await executeProductionDeploy({
            runId: run.id,
            repoFullName: run.repoFullName,
            branchName: resMerge.release.baseBranch || run.defaultBranch || 'main',
            actor: '飞书审批人',
            chatId,
          });
          return {
            summary: `已合入主分支并上线生产：${prodRes.deployment.url}`,
            result: { runId: run.id, url: prodRes.deployment.url },
          };
        },
      });

      res.json({
        toast: { type: 'success', content: '已批准上线，正在后台合并 PR 并部署 Cloudflare 生产环境' },
      });
      return;
    }

    if (action === 'open_rework_form') {
      const runId = (val.run_id || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      if (!run) {
        res.json({ toast: { type: 'error', content: '未找到对应的需求记录' } });
        return;
      }
      res.json({ toast: { type: 'info', content: '已发送退回修订表单，请填写修改意见' } });
      if (chatId) {
        void sendFeishuCardMessage(
          chatId,
          buildFeishuReworkFormCard({
            runId: run.id,
            prdTitle: run.prdTitle,
            prNumber: run.draftPr?.prNumber,
            chatId,
          })
        );
      }
      return;
    }

    if (action === 'submit_rework_form') {
      const runId = (val.run_id || '').trim();
      const note = (form.revision_note || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      if (!run || !run.draftPr) {
        res.json({ toast: { type: 'error', content: '未找到对应的 Draft PR 分支' } });
        return;
      }
      if (!note) {
        res.json({ toast: { type: 'error', content: '请填写具体的修改意见后再提交' } });
        return;
      }
      const parsedRepo = parseRepoFullName(run.repoFullName);
      if (!parsedRepo) {
        res.json({ toast: { type: 'error', content: '目标仓库格式无效' } });
        return;
      }

      enqueueBackgroundTask({
        kind: 'request_rework',
        title: `[飞书] 退回修订并返工：${run.prdTitle.slice(0, 22)}`,
        roomId: 'approval',
        runId: run.id,
        repoFullName: run.repoFullName,
        dedupeKey: `review:${run.id}:changes_requested`,
        initialMessage: '正在写入修订意见并派发 AGY 原分支返工…',
        executor: async () => {
          const draftBranch = run.draftPr!.branchName;
          const draftPrNum = run.draftPr!.prNumber;
          const feedbackMd = buildRevisionFeedbackMarkdown({
            runId: run.id,
            prdTitle: run.prdTitle,
            prNumber: draftPrNum,
            approvalNote: note,
            uncheckedCriteria: [],
          });
          const commitRes = await commitRevisionFeedbackToBranch({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            branchName: draftBranch,
            markdownContent: feedbackMd,
            prNumber: draftPrNum,
          });
          const sessionPolicy = decideAgySessionPolicy({
            targetBranch: draftBranch,
            lastAgySession: run.lastAgySession,
          });
          const dispatchRes = await dispatchAgyWorkflow({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            prBranch: draftBranch,
            prNumber: draftPrNum,
            runId: run.id,
            e2eTestPath: run.draftPr!.e2eTestPath,
            revisionNote: note,
            baseBranch: run.defaultBranch || 'main',
            sessionMode: sessionPolicy.mode,
            resumeSessionId: sessionPolicy.resumeSessionId,
          });
          updateRunReview(run.id, {
            status: 'changes_requested',
            approvalNote: note,
            approvedAt: new Date().toISOString(),
            lastRework: {
              dispatched: true,
              branchName: draftBranch,
              feedbackFilePath: commitRes.path,
              feedbackCommitSha: commitRes.commitSha,
              actionsUrl: dispatchRes.actionsUrl,
              dispatchedAt: new Date().toISOString(),
              note,
              sessionMode: sessionPolicy.mode,
              resumeSessionId: sessionPolicy.resumeSessionId,
              sessionReason: sessionPolicy.reason,
            },
          });
          appendAuditLog({
            category: 'approval',
            action: 'revision_requested',
            actor: '飞书审批人',
            repoFullName: run.repoFullName,
            runId: run.id,
            prdTitle: run.prdTitle,
            branch: draftBranch,
            prNumber: draftPrNum,
            detail: `通过飞书退回修订并派发 AGY 原分支返工：${note}`,
          });
          await notifyFeishuStageEvent({
            kind: 'rework_dispatched',
            prdTitle: run.prdTitle,
            repoFullName: run.repoFullName,
            runId: run.id,
            branchName: draftBranch,
            prNumber: draftPrNum,
            prUrl: run.draftPr!.prUrl,
            actionsUrl: dispatchRes.actionsUrl,
            summary: note,
            chatId,
          });
          void watchAgyCodingRunAndNotifyFeishu({
            owner: parsedRepo.owner,
            repo: parsedRepo.name,
            repoFullName: parsedRepo.fullName,
            prBranch: draftBranch,
            prNumber: draftPrNum,
            prUrl: run.draftPr!.prUrl,
            runId: run.id,
            prdTitle: run.prdTitle,
            dispatchedAtMs: Date.now(),
            chatId,
          });
          return {
            summary: `已派发 AGY 在分支 ${draftBranch} 依据飞书修订意见修复`,
            result: { runId: run.id },
          };
        },
      });

      res.json({
        toast: { type: 'success', content: '已提交修订意见并派发 AGY 返工，完成后将推送新卡片' },
      });
      return;
    }

    if (action === 'redeploy_production') {
      const runId = (val.run_id || '').trim();
      const run = runId ? getRunById(runId) : undefined;
      const branch = run?.mergedRelease?.baseBranch || run?.defaultBranch || 'main';
      const repoFullName = run?.repoFullName || FIXED_TARGET_REPO.fullName;

      enqueueBackgroundTask({
        kind: 'deploy_production',
        title: `[飞书] 重新部署生产环境（${run?.prdTitle?.slice(0, 20) || branch}）`,
        roomId: 'approval',
        runId: run?.id,
        repoFullName,
        dedupeKey: `deploy_production:${repoFullName}:${branch}`,
        initialMessage: `正在后台重新构建并发布主分支 ${branch} 至 Cloudflare 生产环境…`,
        executor: async () => {
          const payload = await executeProductionDeploy({
            runId: run?.id,
            repoFullName,
            branchName: branch,
            actor: '飞书操作员',
            chatId,
          });
          return {
            summary: `生产环境已重新上线：${payload.deployment.url}`,
            result: { url: payload.deployment.url, runId: run?.id },
          };
        },
      });

      res.json({
        toast: { type: 'success', content: '正在后台重新部署 Cloudflare 生产环境，完成后将推送通知' },
      });
      return;
    }

    res.json({ toast: { type: 'info', content: '未识别的卡片操作类型' } });
  });

  // Vite middleware in dev (lazy-loaded so production startup never imports Vite), static build in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
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

  // Bind PORT immediately so Cloud Run / container health probes pass without waiting on external network I/O
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoDev Studio server running on http://0.0.0.0:${PORT}`);

    // Hydrate control-plane state from GitHub orphan branch `autodev-state` asynchronously, then resume jobs
    const hydratePromise = process.env.GITHUB_TOKEN?.trim()
      ? Promise.race([
          hydrateGitHubStateStores({
            repoFullName: FIXED_TARGET_REPO.fullName,
            onReloadStores: () => {
              reloadRunsFromDisk();
              reloadJobsFromDisk();
              reloadAuditLogsFromDisk();
              reloadRsiStateFromDisk();
              reloadEditAuthFromDisk();
              reloadFeishuStateFromDisk();
            },
          }).then((res) => {
            if (res.hydrated) {
              console.log(
                `[AutoDev State] Hydrated from ${FIXED_TARGET_REPO.fullName}@autodev-state (restored: ${res.restoredKeys.join(', ') || 'empty'}${res.createdBranch ? ', initialized branch' : ''})`
              );
            } else if (res.error) {
              console.warn('[AutoDev State] Startup hydration skipped:', res.error);
            }
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 6000)),
        ]).catch((err) => {
          console.warn('[AutoDev State] Startup hydration error:', err?.message || err);
        })
      : Promise.resolve();

    void hydratePromise.finally(() => {
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
  });

  // Flush any pending dirty state to GitHub `autodev-state` on graceful shutdown
  const handleGracefulShutdown = () => {
    void flushGitHubStateNow('shutdown').finally(() => process.exit(0));
  };
  process.once('SIGTERM', handleGracefulShutdown);
  process.once('SIGINT', handleGracefulShutdown);
}

startServer().catch((err) => {
  console.error('Failed to start AutoDev Studio server:', err);
  process.exit(1);
});
