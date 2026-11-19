import type { AnalysisJob, GitHubActionRun, PipelineRun } from '../types/autodev';

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
}

export function buildSevenDayOverviewMetrics(params: {
  repoFullName: string;
  actionRuns: GitHubActionRun[];
  analysisJobs: AnalysisJob[];
  pipelineRuns: PipelineRun[];
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
      });
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

    records.push({
      dateKey,
      category,
      outcome,
      durationMinutes,
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
      (sum, step) => sum + (typeof step.durationMs === 'number' && step.durationMs > 0 ? step.durationMs : 0),
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

    records.push({
      dateKey,
      category: 'plan',
      outcome,
      durationMinutes,
    });
  }

  // Aggregate records into daily buckets
  for (const rec of records) {
    const b = bucketsByKey.get(rec.dateKey);
    if (!b) continue;

    b.total += 1;
    if (rec.outcome === 'success') b.succeeded += 1;
    else if (rec.outcome === 'failure') b.failed += 1;
    else b.running += 1;

    if (rec.category === 'plan') {
      b.planCount += 1;
      if (rec.outcome === 'success') b.planSucceeded += 1;
      else if (rec.outcome === 'failure') b.planFailed += 1;
      b.planMinutes += rec.durationMinutes;
    } else if (rec.category === 'coding') {
      b.codingCount += 1;
      if (rec.outcome === 'success') b.codingSucceeded += 1;
      else if (rec.outcome === 'failure') b.codingFailed += 1;
      b.codingMinutes += rec.durationMinutes;
    } else {
      // deploy runs count toward coding/delivery compute & overall success
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

  const daily: OverviewDailyBucket[] = orderedKeys.map((key) => {
    const b = bucketsByKey.get(key)!;
    b.planMinutes = round1(b.planMinutes);
    b.codingMinutes = round1(b.codingMinutes);
    b.deployMinutes = round1(b.deployMinutes);
    b.totalMinutes = round1(b.planMinutes + b.codingMinutes + b.deployMinutes);
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

    return b;
  });

  const completedRuns = succeededRuns + failedRuns;
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
      deliveredPrdCount: recentPrds.length,
      approvedPrdCount,
    },
    daily,
  };
}
