import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type {
  AgentStepId,
  AgentStepState,
  AnalysisExecutionMode,
  AnalysisJob,
  ArchitectOutput,
  PipelineRun,
  QaCriticOutput,
  QaSpecOutput,
} from '../src/types/autodev';
import {
  runArchitectAgent,
  runQaCriticAgent,
  runQaSpecAgent,
} from './agentOrchestrator';
import {
  cancelGitHubActionRun,
  dispatchAgyPlanWorkflow,
  ensurePlanChannelBranch,
  fetchRepoContextSnapshot,
  findLatestPlanActionRun,
  readPlanChannelJson,
  upsertPlanChannelJson,
} from './githubService';
import { parseRepoFullName } from '../src/lib/taskGraph';
import {
  DEFAULT_AGY_MODE,
  DEFAULT_AGY_MODEL,
  resolveEffectiveTechStack,
} from '../src/lib/workflowBuilder';
import {
  AUTODEV_PLAN_CHANNEL_BRANCH,
  getPlanArtifactPath,
  type PlanInputPayload,
  type PlanRemoteState,
  validateArchitectOutput,
  validateQaCriticOutput,
  validateQaSpecOutput,
} from '../src/lib/planProtocol';
import { saveRun } from './runStore';
import { formatRsiPromptBlock } from '../src/lib/rsiEngine';
import { listAllRsiRules, recordRulesAppliedForStage } from './rsiStore';
import { captureAndReflectIncident } from './rsiService';
import { scheduleGitHubStateSync } from './githubStateStore';

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs-v1.json');
const LEGACY_TMP_JOBS_FILE = path.join(os.tmpdir(), 'autodev-studio-jobs-v1.json');

const DEFAULT_AGY_PLAN_MODEL = DEFAULT_AGY_MODEL;
const DEFAULT_AGY_PLAN_MODE = DEFAULT_AGY_MODE;
const PLAN_POLL_INTERVAL_MS = 8000;
const PLAN_HARD_TIMEOUT_MS = 95 * 60 * 1000;

let jobsCache: AnalysisJob[] | null = null;
const activeVpsPollers = new Set<string>();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createInitialSteps(): AgentStepState[] {
  return [
    {
      id: 'architect',
      label: '01. Architect Agent',
      roleTitle: '读取仓库真实代码 · 增量架构 · 任务树',
      status: 'idle',
    },
    {
      id: 'qa_spec',
      label: '02. QA Spec Agent',
      roleTitle: '结合现有路由与历史测试 · Playwright 初版',
      status: 'idle',
    },
    {
      id: 'qa_critic',
      label: '03. QA Critic Agent',
      roleTitle: '边界异常评审 · 锁定独立只读回归测试集',
      status: 'idle',
    },
  ];
}

function loadJobs(): AnalysisJob[] {
  if (jobsCache !== null) return jobsCache;
  try {
    const fileToRead = fs.existsSync(JOBS_FILE)
      ? JOBS_FILE
      : fs.existsSync(LEGACY_TMP_JOBS_FILE)
        ? LEGACY_TMP_JOBS_FILE
        : null;
    if (fileToRead) {
      const raw = fs.readFileSync(fileToRead, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Recover interrupted in-process Gemini jobs; keep dispatched VPS AGY jobs resumable!
        let needsPersist = fileToRead === LEGACY_TMP_JOBS_FILE;
        jobsCache = (parsed as AnalysisJob[]).map((j) => {
          if (j.status === 'running') {
            if (j.executionMode === 'vps_agy' && j.planChannelBranch) {
              return j;
            }
            needsPersist = true;
            return {
              ...j,
              status: 'error',
              error: '服务端曾重启，上次分析任务已中断，请重新发起。',
              steps: j.steps.map((s) =>
                s.status === 'running'
                  ? { ...s, status: 'error', detail: '服务端重启导致中断' }
                  : s
              ),
            };
          }
          if (j.status === 'error' && j.steps.some((s) => s.status === 'running')) {
            needsPersist = true;
            return {
              ...j,
              steps: j.steps.map((s) =>
                s.status === 'running'
                  ? { ...s, status: 'error', detail: '任务已中断' }
                  : s
              ),
            };
          }
          return j;
        });
        if (needsPersist) {
          persistJobs(jobsCache);
        }
        return jobsCache;
      }
    }
  } catch {
    // ignore corrupt cache
  }
  jobsCache = [];
  return jobsCache;
}

function persistJobs(jobs: AnalysisJob[], skipRemoteSync = false): void {
  jobsCache = jobs;
  try {
    ensureDataDir();
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
  } catch {
    // ignore disk errors
  }
  if (!skipRemoteSync) {
    scheduleGitHubStateSync('jobs', jobs);
  }
}

export function reloadJobsFromDisk(): void {
  jobsCache = null;
  loadJobs();
}

function updateJob(jobId: string, updater: (job: AnalysisJob) => AnalysisJob): AnalysisJob | null {
  const all = loadJobs();
  const idx = all.findIndex((j) => j.id === jobId);
  if (idx === -1) return null;
  const updated = updater({
    ...all[idx],
    updatedAt: new Date().toISOString(),
  });
  const next = [...all];
  next[idx] = updated;
  persistJobs(next);
  return updated;
}

export function getAnalysisJobById(jobId: string): AnalysisJob | undefined {
  return loadJobs().find((j) => j.id === jobId);
}

export function getLatestAnalysisJob(): AnalysisJob | undefined {
  const jobs = loadJobs();
  const running = jobs.find((j) => j.status === 'running');
  if (running) return running;
  return [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
}

export function getRunningAnalysisJob(): AnalysisJob | undefined {
  return loadJobs().find((j) => j.status === 'running');
}

export function listAnalysisJobs(): AnalysisJob[] {
  return [...loadJobs()];
}

export function resumeRunningVpsPlanJobs(): void {
  const jobs = loadJobs();
  for (const job of jobs) {
    if (job.status === 'running' && job.executionMode === 'vps_agy' && job.planChannelBranch) {
      void pollVpsAgyPlanJob(job.id);
    }
  }
}

export async function cancelAnalysisJob(jobId: string): Promise<AnalysisJob | null> {
  const existing = getAnalysisJobById(jobId);
  if (!existing) return null;

  if (existing.executionMode === 'vps_agy' && existing.planActionsRunId) {
    const parsed = parseRepoFullName(existing.repoFullName);
    if (parsed) {
      try {
        await cancelGitHubActionRun(parsed.owner, parsed.name, existing.planActionsRunId);
      } catch {
        // Best-effort cancellation on GitHub
      }
    }
  }

  return updateJob(jobId, (j) => ({
    ...j,
    status: 'error',
    error: '已手动取消本次需求规划任务。',
    steps: j.steps.map((s) =>
      s.status === 'running' ? { ...s, status: 'error', message: '已手动取消' } : s
    ),
  }));
}

export function deleteAnalysisJobById(jobId: string): boolean {
  const existing = loadJobs();
  const next = existing.filter((j) => j.id !== jobId);
  if (next.length === existing.length) return false;
  persistJobs(next);
  return true;
}

export function syncRunPlanToLinkedJobs(run: PipelineRun): void {
  const all = loadJobs();
  let changed = false;
  const next = all.map((job) => {
    if (job.runId !== run.id) return job;
    changed = true;
    return {
      ...job,
      prdTitle: run.prdTitle,
      prdContent: run.prdContent,
      techStackHint: run.techStackHint,
      architect: run.architect,
      qaSpec: run.qaSpec,
      qaCritic: run.qaCritic,
      run,
      updatedAt: new Date().toISOString(),
    };
  });
  if (changed) {
    persistJobs(next);
  }
}

export function clearAllAnalysisJobs(): number {
  const prevCount = loadJobs().length;
  persistJobs([]);
  return prevCount;
}

export function createAndStartAnalysisJob(input: {
  repoFullName: string;
  defaultBranch: string;
  prdTitle: string;
  prdContent: string;
  techStackHint?: string;
  agyModel?: string;
  agyMode?: string;
  executionMode?: AnalysisExecutionMode;
}): AnalysisJob {
  const existingRunning = getRunningAnalysisJob();
  if (existingRunning) {
    throw new Error(
      `后台已有需求分析任务正在执行（${existingRunning.prdTitle}），请等待完成后再发起新任务。`
    );
  }

  const hasGitHubToken = Boolean(process.env.GITHUB_TOKEN?.trim());
  const resolvedMode: AnalysisExecutionMode =
    input.executionMode === 'gemini_api'
      ? 'gemini_api'
      : hasGitHubToken
        ? 'vps_agy'
        : 'gemini_api';

  const agyModel = (input.agyModel || DEFAULT_AGY_PLAN_MODEL).trim() || DEFAULT_AGY_PLAN_MODEL;
  const agyMode = (input.agyMode || DEFAULT_AGY_PLAN_MODE).trim() || DEFAULT_AGY_PLAN_MODE;
  const now = new Date().toISOString();
  const jobId = `job-${crypto.randomBytes(4).toString('hex')}`;
  const job: AnalysisJob = {
    id: jobId,
    createdAt: now,
    updatedAt: now,
    repoFullName: input.repoFullName,
    defaultBranch: input.defaultBranch,
    prdTitle: input.prdTitle,
    prdContent: input.prdContent,
    techStackHint: input.techStackHint,
    executionMode: resolvedMode,
    planMode: resolvedMode === 'vps_agy' ? 'unified_single_turn' : 'three_stage',
    agyModel: resolvedMode === 'vps_agy' ? agyModel : undefined,
    agyMode: resolvedMode === 'vps_agy' ? agyMode : undefined,
    status: 'running',
    steps: createInitialSteps(),
  };

  const next = [job, ...loadJobs()].slice(0, 20);
  persistJobs(next);

  if (resolvedMode === 'vps_agy') {
    void executeVpsAgyPlanInBackground(job);
  } else {
    void executeGeminiJobInBackground(job);
  }

  return job;
}

async function executeVpsAgyPlanInBackground(initialJob: AnalysisJob): Promise<void> {
  const jobId = initialJob.id;
  const parsedRepo = parseRepoFullName(initialJob.repoFullName);
  if (!parsedRepo) {
    updateJob(jobId, (j) => ({
      ...j,
      status: 'error',
      error: `无效的目标仓库格式：${initialJob.repoFullName}`,
    }));
    return;
  }

  const { owner, name: repo } = parsedRepo;
  const baseBranch = initialJob.defaultBranch || 'main';
  const agyModel = initialJob.agyModel || DEFAULT_AGY_PLAN_MODEL;
  const agyMode = initialJob.agyMode || DEFAULT_AGY_PLAN_MODE;

  const setStep = (stepId: AgentStepId, patch: Partial<AgentStepState>) => {
    updateJob(jobId, (j) => ({
      ...j,
      steps: j.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    }));
  };

  try {
    setStep('architect', {
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `正在向 Instabox AGY Runner 派发单对话联合规划任务（${agyModel}）…`,
    });

    // Grab lightweight repo context metadata in parallel with ensuring the orphan artifact channel branch
    const [repoContext, channelInfo] = await Promise.all([
      fetchRepoContextSnapshot(owner, repo, baseBranch).catch(() => null),
      ensurePlanChannelBranch(owner, repo, AUTODEV_PLAN_CHANNEL_BRANCH),
    ]);

    if (repoContext) {
      updateJob(jobId, (j) => ({ ...j, repoContext }));
    }

    const techStack = resolveEffectiveTechStack(initialJob.techStackHint);
    const activeRsiRules = listAllRsiRules();
    const rsiArchitect = formatRsiPromptBlock(activeRsiRules, 'architect');
    const rsiQaSpec = formatRsiPromptBlock(activeRsiRules, 'qa_spec');
    const rsiQaCritic = formatRsiPromptBlock(activeRsiRules, 'qa_critic');
    if (rsiArchitect) recordRulesAppliedForStage('architect');
    if (rsiQaSpec) recordRulesAppliedForStage('qa_spec');
    if (rsiQaCritic) recordRulesAppliedForStage('qa_critic');

    const inputPayload: PlanInputPayload = {
      jobId,
      repoFullName: initialJob.repoFullName,
      baseBranch,
      prdTitle: initialJob.prdTitle,
      prdContent: initialJob.prdContent,
      techStackHint: initialJob.techStackHint,
      effectiveTechStack: techStack.stack,
      isDefaultCloudflare: techStack.isDefaultCloudflare,
      agyModel,
      createdAt: initialJob.createdAt,
      rsiSystemPrompts: {
        architect: rsiArchitect,
        qa_spec: rsiQaSpec,
        qa_critic: rsiQaCritic,
      },
    };

    const initialState: PlanRemoteState = {
      jobId,
      status: 'queued',
      mode: 'unified_single_turn',
      updatedAt: new Date().toISOString(),
      model: agyModel,
      steps: {
        architect: { status: 'running', message: '已入队，等待 Instabox AGY Runner 检出最新代码并启动单对话联合规划…' },
        qa_spec: { status: 'idle' },
        qa_critic: { status: 'idle' },
      },
      outputFiles: {},
    };

    // Write input.json first, then state.json sequentially to avoid branch HEAD race conditions on the channel branch
    await upsertPlanChannelJson({
      owner,
      repo,
      channelBranch: channelInfo.branch,
      filePath: getPlanArtifactPath(jobId, 'input.json'),
      data: inputPayload,
      commitMessage: `chore(autodev-plan): write input for ${jobId}`,
    });

    await upsertPlanChannelJson({
      owner,
      repo,
      channelBranch: channelInfo.branch,
      filePath: getPlanArtifactPath(jobId, 'state.json'),
      data: initialState,
      commitMessage: `chore(autodev-plan): initialize state for ${jobId}`,
    });

    const dispatchRes = await dispatchAgyPlanWorkflow({
      owner,
      repo,
      jobId,
      baseBranch,
      channelBranch: channelInfo.branch,
      agyModel,
      agyMode,
    });

    updateJob(jobId, (j) => ({
      ...j,
      planChannelBranch: channelInfo.branch,
      planActionsUrl: dispatchRes.actionsUrl,
      steps: j.steps.map((s) =>
        s.id === 'architect'
          ? {
              ...s,
              status: 'running',
              message: `已派发至 Instabox AGY Runner（${agyModel}），将在单次会话中一次性产出架构、测试与盲测加固方案…`,
            }
          : s
      ),
    }));

    void pollVpsAgyPlanJob(jobId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '派发 Instabox AGY 规划工作流失败';
    updateJob(jobId, (j) => ({
      ...j,
      status: 'error',
      error: errMsg,
      steps: j.steps.map((s) =>
        s.id === 'architect' ? { ...s, status: 'error', message: errMsg } : s
      ),
    }));
    void captureAndReflectIncident({
      sourceRefKey: `plan-dispatch:${jobId}`,
      source: 'plan_error',
      repoFullName: initialJob.repoFullName,
      branch: baseBranch,
      title: `规划派发失败：${initialJob.prdTitle}`,
      errorSummary: errMsg,
      rawEvidence: `Job ID: ${jobId}\nExecution Mode: vps_agy\nModel: ${agyModel}\nError: ${errMsg}`,
    });
  }
}

async function pollVpsAgyPlanJob(jobId: string): Promise<void> {
  if (activeVpsPollers.has(jobId)) return;
  activeVpsPollers.add(jobId);

  const startedWaitMs = Date.now();
  let tickCount = 0;

  try {
    while (true) {
      const current = getAnalysisJobById(jobId);
      if (!current || current.status !== 'running' || !current.planChannelBranch) {
        return;
      }

      if (Date.now() - startedWaitMs > PLAN_HARD_TIMEOUT_MS) {
        updateJob(jobId, (j) => ({
          ...j,
          status: 'error',
          error: 'Instabox AGY 三阶段规划等待超时（超过 26 分钟），请检查 Runner 日志。',
          steps: j.steps.map((s) =>
            s.status === 'running' ? { ...s, status: 'error', message: '规划执行超时' } : s
          ),
        }));
        return;
      }

      const parsedRepo = parseRepoFullName(current.repoFullName);
      if (!parsedRepo) return;
      const { owner, name: repo } = parsedRepo;
      const channelBranch = current.planChannelBranch;
      const statePath = getPlanArtifactPath(jobId, 'state.json');

      try {
        const remote = await readPlanChannelJson<PlanRemoteState>(
          owner,
          repo,
          statePath,
          channelBranch
        );

        if (remote && remote.jobId === jobId && remote.steps) {
          let nextArchitect: ArchitectOutput | undefined = current.architect;
          let nextQaSpec: QaSpecOutput | undefined = current.qaSpec;
          let nextQaCritic: QaCriticOutput | undefined = current.qaCritic;

          // Fetch each newly completed stage's validated JSON output exactly once
          if (!nextArchitect && remote.outputFiles?.architect) {
            const raw = await readPlanChannelJson<unknown>(
              owner,
              repo,
              remote.outputFiles.architect,
              channelBranch
            );
            const check = validateArchitectOutput(raw);
            if (check.ok) {
              nextArchitect = check.data;
            }
          }

          if (!nextQaSpec && remote.outputFiles?.qa_spec) {
            const raw = await readPlanChannelJson<unknown>(
              owner,
              repo,
              remote.outputFiles.qa_spec,
              channelBranch
            );
            const check = validateQaSpecOutput(raw);
            if (check.ok) {
              nextQaSpec = check.data;
            }
          }

          if (!nextQaCritic && remote.outputFiles?.qa_critic) {
            const raw = await readPlanChannelJson<unknown>(
              owner,
              repo,
              remote.outputFiles.qa_critic,
              channelBranch
            );
            const check = validateQaCriticOutput(raw);
            if (check.ok) {
              nextQaCritic = check.data;
            }
          }

          const mergedSteps = current.steps.map((step) => {
            const rs = remote.steps?.[step.id];
            if (!rs) return step;
            return {
              ...step,
              status: rs.status || step.status,
              startedAt: rs.startedAt ?? step.startedAt,
              completedAt: rs.completedAt ?? step.completedAt,
              durationMs: rs.durationMs ?? step.durationMs,
              message: rs.message ?? step.message,
            };
          });

          if (remote.status === 'error') {
            const failMsg = remote.error || 'Instabox AGY 规划执行失败';
            updateJob(jobId, (j) => ({
              ...j,
              status: 'error',
              error: failMsg,
              planActionsRunId: remote.actionsRunId ?? j.planActionsRunId,
              planActionsUrl: remote.actionsUrl ?? j.planActionsUrl,
              architect: nextArchitect ?? j.architect,
              qaSpec: nextQaSpec ?? j.qaSpec,
              qaCritic: nextQaCritic ?? j.qaCritic,
              steps: mergedSteps.map((s) =>
                s.status === 'running' ? { ...s, status: 'error' } : s
              ),
            }));
            void captureAndReflectIncident({
              sourceRefKey: remote.actionsRunId ? `actions:${remote.actionsRunId}` : `plan-remote:${jobId}`,
              source: 'plan_error',
              repoFullName: current.repoFullName,
              branch: current.defaultBranch,
              title: `Instabox AGY 规划异常：${current.prdTitle}`,
              errorSummary: failMsg,
              rawEvidence: `Job ID: ${jobId}\nActions Run: ${remote.actionsRunId || 'N/A'}\nError: ${failMsg}`,
              relatedActionsRunId: remote.actionsRunId,
              relatedActionsUrl: remote.actionsUrl,
            });
            return;
          }

          if (remote.status === 'completed' && nextArchitect && nextQaSpec && nextQaCritic) {
            const runId = `run-${crypto.randomBytes(4).toString('hex')}`;
            const run: PipelineRun = {
              id: runId,
              createdAt: new Date().toISOString(),
              repoFullName: current.repoFullName,
              defaultBranch: current.defaultBranch,
              prdTitle: current.prdTitle,
              prdContent: current.prdContent,
              techStackHint: current.techStackHint,
              repoContext: current.repoContext
                ? {
                    ...current.repoContext,
                    headSha: remote.headSha || current.repoContext.headSha,
                  }
                : undefined,
              architect: nextArchitect,
              qaSpec: nextQaSpec,
              qaCritic: nextQaCritic,
              planTokenUsage: remote.tokenUsage,
              status: 'analyzed',
              checkedCriteriaIds: [],
            };
            saveRun(run);

            updateJob(jobId, (j) => ({
              ...j,
              status: 'completed',
              planMode: remote.mode ?? j.planMode ?? 'unified_single_turn',
              tokenUsage: remote.tokenUsage ?? j.tokenUsage,
              planActionsRunId: remote.actionsRunId ?? j.planActionsRunId,
              planActionsUrl: remote.actionsUrl ?? j.planActionsUrl,
              architect: nextArchitect,
              qaSpec: nextQaSpec,
              qaCritic: nextQaCritic,
              runId: run.id,
              run,
              steps: mergedSteps,
            }));
            return;
          }

          // Progressive update while running
          updateJob(jobId, (j) => ({
            ...j,
            planMode: remote.mode ?? j.planMode,
            tokenUsage: remote.tokenUsage ?? j.tokenUsage,
            planActionsRunId: remote.actionsRunId ?? j.planActionsRunId,
            planActionsUrl: remote.actionsUrl ?? j.planActionsUrl,
            architect: nextArchitect ?? j.architect,
            qaSpec: nextQaSpec ?? j.qaSpec,
            qaCritic: nextQaCritic ?? j.qaCritic,
            steps: mergedSteps,
          }));
        }

        // Periodically inspect GitHub Actions run status to catch external cancellation/crash
        tickCount += 1;
        if (tickCount % 3 === 1) {
          const actionRun = await findLatestPlanActionRun(owner, repo, current.createdAt);
          if (actionRun) {
            updateJob(jobId, (j) => ({
              ...j,
              planActionsRunId: actionRun.id,
              planActionsUrl: actionRun.htmlUrl,
            }));
            if (
              actionRun.status === 'completed' &&
              actionRun.conclusion &&
              actionRun.conclusion !== 'success'
            ) {
              const latestRemote = await readPlanChannelJson<PlanRemoteState>(
                owner,
                repo,
                statePath,
                channelBranch
              ).catch(() => null);
              const failReason =
                latestRemote?.error ||
                `GitHub Actions 规划任务异常结束（conclusion: ${actionRun.conclusion}），请点击查看 Actions 日志。`;
              updateJob(jobId, (j) => ({
                ...j,
                status: 'error',
                error: failReason,
                planActionsRunId: actionRun.id,
                planActionsUrl: actionRun.htmlUrl,
                steps: j.steps.map((s) =>
                  s.status === 'running' ? { ...s, status: 'error', message: failReason } : s
                ),
              }));
              return;
            }
          }
        }
      } catch {
        // Ignore transient network errors and retry on next tick
      }

      await new Promise((r) => setTimeout(r, PLAN_POLL_INTERVAL_MS));
    }
  } finally {
    activeVpsPollers.delete(jobId);
  }
}

async function executeGeminiJobInBackground(initialJob: AnalysisJob): Promise<void> {
  const jobId = initialJob.id;
  const runId = `run-${crypto.randomBytes(4).toString('hex')}`;
  let currentStep: AgentStepId = 'architect';

  const setStep = (stepId: AgentStepId, patch: Partial<AgentStepState>) => {
    updateJob(jobId, (j) => ({
      ...j,
      steps: j.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    }));
  };

  try {
    currentStep = 'architect';
    const t1 = Date.now();
    setStep('architect', {
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `正在拉取 ${initialJob.defaultBranch} 最新代码上下文与已有迁移脚本…`,
    });

    const parsedRepo = parseRepoFullName(initialJob.repoFullName);
    const repoContext = parsedRepo
      ? await fetchRepoContextSnapshot(parsedRepo.owner, parsedRepo.name, initialJob.defaultBranch)
      : null;

    if (repoContext) {
      updateJob(jobId, (j) => ({ ...j, repoContext }));
      setStep('architect', {
        message: repoContext.isEmptyRepo
          ? '目标仓库为空，正在从零设计架构与任务树…'
          : `已同步 ${repoContext.branch}@${repoContext.headSha.slice(0, 7)}（${repoContext.totalFiles} 个文件 / ${repoContext.existingMigrations.length} 个迁移），正在增量架构拆解…`,
      });
    } else {
      setStep('architect', {
        message: '正在审查 PRD 漏洞并拆解 Cloudflare 全栈任务树…',
      });
    }

    const agentInput = {
      repoFullName: initialJob.repoFullName,
      defaultBranch: initialJob.defaultBranch,
      prdTitle: initialJob.prdTitle,
      prdContent: initialJob.prdContent,
      techStackHint: initialJob.techStackHint,
      repoContext: repoContext ?? undefined,
    };

    const architect = await runArchitectAgent(agentInput);
    const d1 = Date.now() - t1;
    updateJob(jobId, (j) => ({
      ...j,
      architect,
      steps: j.steps.map((s) =>
        s.id === 'architect'
          ? {
              ...s,
              status: 'completed',
              completedAt: new Date().toISOString(),
              durationMs: d1,
              message: `完成 · 识别 ${architect.ambiguities.length} 项歧义、${architect.tasks.length} 项任务`,
            }
          : s
      ),
    }));

    currentStep = 'qa_spec';
    const t2 = Date.now();
    setStep('qa_spec', {
      status: 'running',
      startedAt: new Date().toISOString(),
      message: '正在根据接口契约与仓库现状生成独立 Playwright E2E 测试集…',
    });
    const qaSpec = await runQaSpecAgent(agentInput, architect.apiContracts);
    const d2 = Date.now() - t2;
    updateJob(jobId, (j) => ({
      ...j,
      qaSpec,
      steps: j.steps.map((s) =>
        s.id === 'qa_spec'
          ? {
              ...s,
              status: 'completed',
              completedAt: new Date().toISOString(),
              durationMs: d2,
              message: `完成 · 生成 ${qaSpec.apiTestChecklist.length} 条接口用例`,
            }
          : s
      ),
    }));

    currentStep = 'qa_critic';
    const t3 = Date.now();
    setStep('qa_critic', {
      status: 'running',
      startedAt: new Date().toISOString(),
      message: '正在评审边界异常与交互死角并锁定本轮独立回归测试集…',
    });
    const qaCritic = await runQaCriticAgent(agentInput, architect.apiContracts, qaSpec);
    const d3 = Date.now() - t3;

    const run: PipelineRun = {
      id: runId,
      createdAt: new Date().toISOString(),
      repoFullName: initialJob.repoFullName,
      defaultBranch: initialJob.defaultBranch,
      prdTitle: initialJob.prdTitle,
      prdContent: initialJob.prdContent,
      techStackHint: initialJob.techStackHint,
      repoContext: repoContext ?? undefined,
      architect,
      qaSpec,
      qaCritic,
      status: 'analyzed',
      checkedCriteriaIds: [],
    };
    saveRun(run);

    updateJob(jobId, (j) => ({
      ...j,
      status: 'completed',
      qaCritic,
      runId: run.id,
      run,
      steps: j.steps.map((s) =>
        s.id === 'qa_critic'
          ? {
              ...s,
              status: 'completed',
              completedAt: new Date().toISOString(),
              durationMs: d3,
              message: `完成 · 提出 ${qaCritic.findings.length} 项加固意见`,
            }
          : s
      ),
    }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '多智能体执行失败';
    updateJob(jobId, (j) => ({
      ...j,
      status: 'error',
      error: errMsg,
      steps: j.steps.map((s) =>
        s.id === currentStep ? { ...s, status: 'error', message: errMsg } : s
      ),
    }));
    void captureAndReflectIncident({
      sourceRefKey: `plan-gemini:${jobId}`,
      source: 'plan_error',
      repoFullName: initialJob.repoFullName,
      branch: initialJob.defaultBranch,
      title: `Gemini 规划阶段异常 (${currentStep})：${initialJob.prdTitle}`,
      errorSummary: errMsg,
      rawEvidence: `Job ID: ${jobId}\nStage: ${currentStep}\nError: ${errMsg}`,
    });
  }
}
