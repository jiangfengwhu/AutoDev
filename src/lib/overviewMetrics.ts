import type {
  AnalysisJob,
  GitHubActionRun,
  PipelineRun,
  TokenUsageSummary,
} from '../types/autodev';
import type { TestExecutionReport } from './rsiEngine';

export type OverviewTaskCategory = 'plan' | 'coding' | 'deploy';
export type OverviewFilterScope = 'all' | 'plan' | 'coding';

export interface OverviewDailyBucket {
  dateKey: string; // YYYY-MM-DD
  label: string; // MM-DD
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  successRate: number | null; // 0..100 or null when no completed tasks on that day
  planCount: number;
  planSucceeded: number;
  planFailed: number;
  planSuccessRate: number | null;
  codingCount: number;
  codingSucceeded: number;
  codingFailed: number;
  codingSuccessRate: number | null;
  planMinutes: number;
  codingMinutes: number;
  deployMinutes: number;
  totalMinutes: number;
  planTokens: number;
  codingTokens: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reportedTokenRuns: number;
}

export interface OverviewSummaryMetrics {
  windowDays: number;
  totalRuns: number;
  completedRuns: number;
  succeededRuns: number;
  failedRuns: number;
  runningRuns: number;
  overallSuccessRate: number | null;
  totalComputeMinutes: number;
  planComputeMinutes: number;
  codingAndDeployMinutes: number;
  avgDurationMinutes: number | null;
  totalTokens: number;
  planTokens: number;
  codingTokens: number;
  inputTokens: number;
  outputTokens: number;
  avgTokensPerRun: number | null;
  reportedTokenRuns: number;
  estimatedTokenRuns: number;
  deliveredPrdCount: number;
  approvedPrdCount: number;
}

export interface SevenDayOverviewMetrics {
  repoFullName: string;
  generatedAt: string;
  timezoneOffsetMinutes: number;
  githubConnected: boolean;
  summary: OverviewSummaryMetrics;
  daily: OverviewDailyBucket[];
}

export function classifyWorkflowCategory(name: string): OverviewTaskCategory {
  const lower = (name || '').toLowerCase();
  if (lower.includes('plan') || lower.includes('prd') || lower.includes('architect')) {
    return 'plan';
  }
  if (lower.includes('deploy') || lower.includes('cloudflare') || lower.includes('release')) {
    return 'deploy';
  }
  return 'coding';
}

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) {
    const val = tokens / 1_000_000;
    return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    const val = tokens / 1_000;
    return `${val >= 100 ? Math.round(val) : val.toFixed(1)}K`;
  }
  return `${Math.round(tokens)}`;
}

export function estimateTokensFromMinutes(
  category: OverviewTaskCategory,
  durationMinutes: number
): TokenUsageSummary {
  if (category === 'deploy' || durationMinutes <= 0) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      source: 'estimated',
    };
  }
  // Empirically calibrated average token throughput for AGY agent loops:
  // Plan: ~14K tokens/min (repo read + structured JSON plan)
  // Coding: ~22K tokens/min (multi-turn code read/edit + test feedback)
  const ratePerMin = category === 'plan' ? 14_000 : 22_000;
  const totalTokens = Math.max(0, Math.round(durationMinutes * ratePerMin));
  const inputTokens = Math.round(totalTokens * 0.72);
  const outputTokens = Math.max(0, totalTokens - inputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    source: 'estimated',
  };
}

function toOffsetDateKey(isoOrMs: string | number, tzOffsetMinutes: number): string | null {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + tzOffsetMinutes * 60_000);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeRate(succeeded: number, failed: number): number | null {
  const finished = succeeded + failed;
  if (finished <= 0) return null;
  return Math.round((succeeded / finished) * 100);
}

interface NormalizedExecutionRecord {
  dateKey: string;
  category: OverviewTaskCategory;
  outcome: 'success' | 'failure' | 'running';
  durationMinutes: number;
  tokenUsage: TokenUsageSummary;
}

export function buildSevenDayOverviewMetrics(params: {
  repoFullName: string;
  actionRuns: GitHubActionRun[];
  analysisJobs: AnalysisJob[];
  pipelineRuns: PipelineRun[];
  testReports?: TestExecutionReport[];
  githubConnected: boolean;
  now?: Date;
  timezoneOffsetMinutes?: number;
}): SevenDayOverviewMetrics {
  const now = params.now ?? new Date();
  const tzOffsetMinutes = params.timezoneOffsetMinutes ?? 480; // Asia/Shanghai (UTC+8)
  const windowDays = 7;

  // Build ordered 7-day skeleton from (today - 6d) to today
  const bucketsByKey = new Map<string, OverviewDailyBucket>();
  const orderedKeys: string[] = [];
  const nowMs = now.getTime();

  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const dayMs = nowMs - offset * 86_400_000;
    const dateKey = toOffsetDateKey(dayMs, tzOffsetMinutes)!;
    if (!bucketsByKey.has(dateKey)) {
      orderedKeys.push(dateKey);
      bucketsByKey.set(dateKey, {
        dateKey,
        label: dateKey.slice(5), // MM-DD
        total: 0,
        succeeded: 0,
        failed: 0,
        running: 0,
        successRate: null,
        planCount: 0,
        planSucceeded: 0,
        planFailed: 0,
        planSuccessRate: null,
        codingCount: 0,
        codingSucceeded: 0,
        codingFailed: 0,
        codingSuccessRate: null,
        planMinutes: 0,
        codingMinutes: 0,
        deployMinutes: 0,
        totalMinutes: 0,
        planTokens: 0,
        codingTokens: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reportedTokenRuns: 0,
      });
    }
  }

  // Build lookup indexes for reported token usage by Actions Run ID
  const tokenUsageByActionRunId = new Map<number, TokenUsageSummary>();
  for (const report of params.testReports || []) {
    if (report.actionsRunId && report.tokenUsage && report.tokenUsage.totalTokens > 0) {
      tokenUsageByActionRunId.set(report.actionsRunId, report.tokenUsage);
    }
  }
  for (const run of params.pipelineRuns) {
    if (
      run.latestCodingOutput?.actionsRunId &&
      run.latestCodingOutput.tokenUsage &&
      run.latestCodingOutput.tokenUsage.totalTokens > 0 &&
      !tokenUsageByActionRunId.has(run.latestCodingOutput.actionsRunId)
    ) {
      tokenUsageByActionRunId.set(
        run.latestCodingOutput.actionsRunId,
        run.latestCodingOutput.tokenUsage
      );
    }
  }
  for (const job of params.analysisJobs) {
    if (job.planActionsRunId && job.tokenUsage && job.tokenUsage.totalTokens > 0) {
      tokenUsageByActionRunId.set(job.planActionsRunId, job.tokenUsage);
    }
  }

  const records: NormalizedExecutionRecord[] = [];
  const seenActionRunIds = new Set<number>();

  // 1. Ingest real GitHub Actions workflow runs
  for (const run of params.actionRuns) {
    seenActionRunIds.add(run.id);
    const dateKey = toOffsetDateKey(run.createdAt, tzOffsetMinutes);
    if (!dateKey || !bucketsByKey.has(dateKey)) continue;

    const category = classifyWorkflowCategory(run.name);
    let outcome: 'success' | 'failure' | 'running' = 'running';
    if (run.status === 'completed') {
      outcome = run.conclusion === 'success' ? 'success' : 'failure';
    }

    const startMs = Date.parse(run.createdAt);
    const endMs =
      run.status === 'completed' && run.updatedAt
        ? Date.parse(run.updatedAt)
        : Math.min(nowMs, startMs + 60_000);
    const rawMins =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? (endMs - startMs) / 60_000
        : 0;
    // Clamp runaway stale runs to 120 minutes to prevent chart distortion
    const durationMinutes = Math.min(120, Math.max(0, rawMins));

    const reportedUsage = tokenUsageByActionRunId.get(run.id);
    const tokenUsage = reportedUsage ?? estimateTokensFromMinutes(category, durationMinutes);

    records.push({
      dateKey,
      category,
      outcome,
      durationMinutes,
      tokenUsage,
    });
  }

  // 2. Ingest local AnalysisJobs not already represented by a GitHub Actions plan run
  for (const job of params.analysisJobs) {
    if (job.planActionsRunId && seenActionRunIds.has(job.planActionsRunId)) {
      continue;
    }
    const dateKey = toOffsetDateKey(job.createdAt, tzOffsetMinutes);
    if (!dateKey || !bucketsByKey.has(dateKey)) continue;

    const outcome: 'success' | 'failure' | 'running' =
      job.status === 'completed' ? 'success' : job.status === 'error' ? 'failure' : 'running';

    const stepMs = (job.steps || []).reduce(
      (sum, step) =>
        sum + (typeof step.durationMs === 'number' && step.durationMs > 0 ? step.durationMs : 0),
      0
    );
    let durationMinutes = stepMs / 60_000;
    if (durationMinutes <= 0) {
      const startMs = Date.parse(job.createdAt);
      const endMs = Date.parse(job.updatedAt || job.createdAt);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        durationMinutes = (endMs - startMs) / 60_000;
      }
    }
    durationMinutes = Math.min(60, Math.max(0, durationMinutes));

    const tokenUsage =
      job.tokenUsage && job.tokenUsage.totalTokens > 0
        ? job.tokenUsage
        : estimateTokensFromMinutes('plan', durationMinutes);

    records.push({
      dateKey,
      category: 'plan',
      outcome,
      durationMinutes,
      tokenUsage,
    });
  }

  let reportedTokenRuns = 0;
  let estimatedTokenRuns = 0;

  // Aggregate records into daily buckets
  for (const rec of records) {
    const b = bucketsByKey.get(rec.dateKey);
    if (!b) continue;

    b.total += 1;
    if (rec.outcome === 'success') b.succeeded += 1;
    else if (rec.outcome === 'failure') b.failed += 1;
    else b.running += 1;

    if (rec.tokenUsage.totalTokens > 0) {
      if (rec.tokenUsage.source === 'reported') {
        b.reportedTokenRuns += 1;
        reportedTokenRuns += 1;
      } else {
        estimatedTokenRuns += 1;
      }
      b.inputTokens += rec.tokenUsage.inputTokens;
      b.outputTokens += rec.tokenUsage.outputTokens;
      b.totalTokens += rec.tokenUsage.totalTokens;
    }

    if (rec.category === 'plan') {
      b.planCount += 1;
      if (rec.outcome === 'success') b.planSucceeded += 1;
      else if (rec.outcome === 'failure') b.planFailed += 1;
      b.planMinutes += rec.durationMinutes;
      b.planTokens += rec.tokenUsage.totalTokens;
    } else if (rec.category === 'coding') {
      b.codingCount += 1;
      if (rec.outcome === 'success') b.codingSucceeded += 1;
      else if (rec.outcome === 'failure') b.codingFailed += 1;
      b.codingMinutes += rec.durationMinutes;
      b.codingTokens += rec.tokenUsage.totalTokens;
    } else {
      // deploy runs count toward coding/delivery compute & overall success (deploy uses 0 LLM tokens)
      b.codingCount += 1;
      if (rec.outcome === 'success') b.codingSucceeded += 1;
      else if (rec.outcome === 'failure') b.codingFailed += 1;
      b.deployMinutes += rec.durationMinutes;
    }
    b.totalMinutes += rec.durationMinutes;
  }

  let totalRuns = 0;
  let succeededRuns = 0;
  let failedRuns = 0;
  let runningRuns = 0;
  let totalComputeMinutes = 0;
  let planComputeMinutes = 0;
  let codingAndDeployMinutes = 0;
  let totalTokens = 0;
  let planTokens = 0;
  let codingTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const daily: OverviewDailyBucket[] = orderedKeys.map((key) => {
    const b = bucketsByKey.get(key)!;
    b.planMinutes = round1(b.planMinutes);
    b.codingMinutes = round1(b.codingMinutes);
    b.deployMinutes = round1(b.deployMinutes);
    b.totalMinutes = round1(b.planMinutes + b.codingMinutes + b.deployMinutes);
    b.planTokens = Math.round(b.planTokens);
    b.codingTokens = Math.round(b.codingTokens);
    b.totalTokens = Math.round(b.totalTokens);
    b.inputTokens = Math.round(b.inputTokens);
    b.outputTokens = Math.round(b.outputTokens);
    b.successRate = computeRate(b.succeeded, b.failed);
    b.planSuccessRate = computeRate(b.planSucceeded, b.planFailed);
    b.codingSuccessRate = computeRate(b.codingSucceeded, b.codingFailed);

    totalRuns += b.total;
    succeededRuns += b.succeeded;
    failedRuns += b.failed;
    runningRuns += b.running;
    totalComputeMinutes += b.totalMinutes;
    planComputeMinutes += b.planMinutes;
    codingAndDeployMinutes += b.codingMinutes + b.deployMinutes;
    totalTokens += b.totalTokens;
    planTokens += b.planTokens;
    codingTokens += b.codingTokens;
    inputTokens += b.inputTokens;
    outputTokens += b.outputTokens;

    return b;
  });

  const completedRuns = succeededRuns + failedRuns;
  const aiTokenRuns = reportedTokenRuns + estimatedTokenRuns;
  const recentPrds = params.pipelineRuns.filter((r) => {
    const k = toOffsetDateKey(r.createdAt, tzOffsetMinutes);
    return Boolean(k && bucketsByKey.has(k));
  });
  const approvedPrdCount = recentPrds.filter(
    (r) => r.status === 'approved' || Boolean(r.mergedRelease)
  ).length;

  return {
    repoFullName: params.repoFullName,
    generatedAt: now.toISOString(),
    timezoneOffsetMinutes: tzOffsetMinutes,
    githubConnected: params.githubConnected,
    summary: {
      windowDays,
      totalRuns,
      completedRuns,
      succeededRuns,
      failedRuns,
      runningRuns,
      overallSuccessRate: computeRate(succeededRuns, failedRuns),
      totalComputeMinutes: round1(totalComputeMinutes),
      planComputeMinutes: round1(planComputeMinutes),
      codingAndDeployMinutes: round1(codingAndDeployMinutes),
      avgDurationMinutes:
        completedRuns > 0 ? round1(totalComputeMinutes / completedRuns) : null,
      totalTokens: Math.round(totalTokens),
      planTokens: Math.round(planTokens),
      codingTokens: Math.round(codingTokens),
      inputTokens: Math.round(inputTokens),
      outputTokens: Math.round(outputTokens),
      avgTokensPerRun: aiTokenRuns > 0 ? Math.round(totalTokens / aiTokenRuns) : null,
      reportedTokenRuns,
      estimatedTokenRuns,
      deliveredPrdCount: recentPrds.length,
      approvedPrdCount,
    },
    daily,
  };
}

