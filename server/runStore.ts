import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  AgySessionSnapshot,
  DraftPrResult,
  MergedReleaseResult,
  PipelineRun,
  PipelineRunStatus,
  PreviewDeployment,
  ReworkDispatchResult,
} from '../src/types/autodev';

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const STORE_FILE = path.join(DATA_DIR, 'runs-v1.json');
const LEGACY_TMP_FILE = path.join(os.tmpdir(), 'autodev-studio-runs-v1.json');

let runsCache: PipelineRun[] | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadRunsFromDisk(): PipelineRun[] {
  if (runsCache !== null) {
    return runsCache;
  }
  try {
    const fileToRead = fs.existsSync(STORE_FILE)
      ? STORE_FILE
      : fs.existsSync(LEGACY_TMP_FILE)
        ? LEGACY_TMP_FILE
        : null;
    if (fileToRead) {
      const raw = fs.readFileSync(fileToRead, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        runsCache = parsed as PipelineRun[];
        if (fileToRead === LEGACY_TMP_FILE) {
          persistRuns(runsCache);
        }
        return runsCache;
      }
    }
  } catch {
    // Ignore corrupt file and start fresh
  }
  runsCache = [];
  return runsCache;
}

function persistRuns(runs: PipelineRun[]): void {
  runsCache = runs;
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(runs, null, 2), 'utf-8');
  } catch {
    // Non-fatal if storage is read-only
  }
}

export function listRuns(): PipelineRun[] {
  return [...loadRunsFromDisk()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getRunById(id: string): PipelineRun | undefined {
  return loadRunsFromDisk().find((r) => r.id === id);
}

export function saveRun(run: PipelineRun): PipelineRun {
  const existing = loadRunsFromDisk();
  const filtered = existing.filter((r) => r.id !== run.id);
  const updated = [run, ...filtered].slice(0, 50);
  persistRuns(updated);
  return run;
}

export function attachDraftPrToRun(runId: string, draftPr: DraftPrResult): PipelineRun | undefined {
  const existing = loadRunsFromDisk();
  const idx = existing.findIndex((r) => r.id === runId);
  if (idx === -1) return undefined;

  const updatedRun: PipelineRun = {
    ...existing[idx],
    status: 'pr_created',
    draftPr,
  };
  const next = [...existing];
  next[idx] = updatedRun;
  persistRuns(next);
  return updatedRun;
}

export function attachPreviewDeploymentToRun(
  runId: string,
  previewDeployment: PreviewDeployment
): PipelineRun | undefined {
  const existing = loadRunsFromDisk();
  const idx = existing.findIndex((r) => r.id === runId);
  if (idx === -1) return undefined;

  const updatedRun: PipelineRun = {
    ...existing[idx],
    previewDeployment,
  };
  const next = [...existing];
  next[idx] = updatedRun;
  persistRuns(next);
  return updatedRun;
}

export function updateRunReview(
  runId: string,
  patch: {
    checkedCriteriaIds?: string[];
    status?: PipelineRunStatus;
    approvalNote?: string;
    approvedAt?: string;
    mergedRelease?: MergedReleaseResult;
    lastRework?: ReworkDispatchResult;
  }
): PipelineRun | undefined {
  const existing = loadRunsFromDisk();
  const idx = existing.findIndex((r) => r.id === runId);
  if (idx === -1) return undefined;

  const updatedRun: PipelineRun = {
    ...existing[idx],
    ...(patch.checkedCriteriaIds !== undefined
      ? { checkedCriteriaIds: patch.checkedCriteriaIds }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.approvalNote !== undefined ? { approvalNote: patch.approvalNote } : {}),
    ...(patch.approvedAt !== undefined ? { approvedAt: patch.approvedAt } : {}),
    ...(patch.mergedRelease !== undefined ? { mergedRelease: patch.mergedRelease } : {}),
    ...(patch.lastRework !== undefined ? { lastRework: patch.lastRework } : {}),
  };
  const next = [...existing];
  next[idx] = updatedRun;
  persistRuns(next);
  return updatedRun;
}

export function attachAgySessionToRun(
  params: { runId?: string; branchName?: string },
  session: AgySessionSnapshot
): PipelineRun | undefined {
  const existing = loadRunsFromDisk();
  const idx = existing.findIndex(
    (r) =>
      (params.runId && r.id === params.runId) ||
      (params.branchName && r.draftPr?.branchName === params.branchName)
  );
  if (idx === -1) return undefined;

  const prev = existing[idx].lastAgySession;
  if (
    prev?.actionsRunId &&
    session.actionsRunId &&
    prev.actionsRunId > session.actionsRunId
  ) {
    return existing[idx];
  }

  const nextConsecutiveReuse =
    session.exitCode !== 0
      ? 0
      : session.reused && prev && prev.branchName === session.branchName
        ? prev.consecutiveReuseCount + 1
        : 0;

  const updatedRun: PipelineRun = {
    ...existing[idx],
    lastAgySession: {
      ...session,
      consecutiveReuseCount: nextConsecutiveReuse,
    },
  };
  const next = [...existing];
  next[idx] = updatedRun;
  persistRuns(next);
  return updatedRun;
}


