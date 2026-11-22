import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { FIXED_TARGET_REPO } from '../src/lib/workflowBuilder.ts';
import { parseRepoFullName } from '../src/lib/taskGraph.ts';
import { githubRequest } from './githubService.ts';

export const AUTODEV_STATE_BRANCH = 'autodev-state';

export type PersistedStateKey = 'runs' | 'jobs' | 'auditLogs' | 'rsi';

const STATE_FILE_MAP: Record<
  PersistedStateKey,
  { localFile: string; remotePath: string }
> = {
  runs: {
    localFile: 'runs-v1.json',
    remotePath: '.autodev-state/runs-v1.json',
  },
  jobs: {
    localFile: 'jobs-v1.json',
    remotePath: '.autodev-state/jobs-v1.json',
  },
  auditLogs: {
    localFile: 'audit-logs-v1.json',
    remotePath: '.autodev-state/audit-logs-v1.json',
  },
  rsi: {
    localFile: 'rsi-state-v1.json',
    remotePath: '.autodev-state/rsi-state-v1.json',
  },
};

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const FLUSH_DEBOUNCE_MS = 4500;

export interface GitHubStatePersistenceStatus {
  enabled: boolean;
  repoFullName: string;
  branch: string;
  hydrated: boolean;
  hydratedAt: string | null;
  lastSyncedAt: string | null;
  lastCommitSha: string | null;
  pendingKeys: PersistedStateKey[];
  syncing: boolean;
  lastError: string | null;
  totalFlushes: number;
  coalescedWritesSaved: number;
}

const pendingPayloads = new Map<PersistedStateKey, string>();
const lastCommittedHashes = new Map<PersistedStateKey, string>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeFlushPromise: Promise<void> | null = null;
let hydrated = false;
let hydratedAt: string | null = null;
let lastSyncedAt: string | null = null;
let lastCommitSha: string | null = null;
let lastError: string | null = null;
let totalFlushes = 0;
let coalescedWritesSaved = 0;
let configuredRepoFullName: string = FIXED_TARGET_REPO.fullName;

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function ensureLocalDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getRepoTarget(): { owner: string; repo: string; token: string } | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  const parsed = parseRepoFullName(configuredRepoFullName);
  if (!parsed) return null;
  return { owner: parsed.owner, repo: parsed.name, token };
}

export function getGitHubStatePersistenceStatus(): GitHubStatePersistenceStatus {
  return {
    enabled: Boolean(process.env.GITHUB_TOKEN?.trim()),
    repoFullName: configuredRepoFullName,
    branch: AUTODEV_STATE_BRANCH,
    hydrated,
    hydratedAt,
    lastSyncedAt,
    lastCommitSha,
    pendingKeys: Array.from(pendingPayloads.keys()),
    syncing: activeFlushPromise !== null,
    lastError,
    totalFlushes,
    coalescedWritesSaved,
  };
}

async function ensureStateBranchExists(
  token: string,
  owner: string,
  repo: string
): Promise<{ headSha: string; treeSha: string; created: boolean }> {
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const ref = await githubRequest<{ object: { sha: string } }>(
      token,
      `${repoPath}/git/ref/heads/${encodeURIComponent(AUTODEV_STATE_BRANCH)}`,
      { cache: 'no-store' }
    );
    const commit = await githubRequest<{ tree: { sha: string } }>(
      token,
      `${repoPath}/git/commits/${ref.object.sha}`
    );
    return { headSha: ref.object.sha, treeSha: commit.tree.sha, created: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('(404)')) {
      throw err;
    }
  }

  // Create an isolated orphan branch (parents: []) exclusively for AutoDev control-plane state
  const readmeBlob = await githubRequest<{ sha: string }>(token, `${repoPath}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({
      content:
        '# AutoDev Control-Plane State Branch\n\nDedicated orphan branch storing AutoDev Studio runs, planning jobs, audit logs, and RSI self-evolution rules.\nDo not merge into main.\n',
      encoding: 'utf-8',
    }),
  });

  const tree = await githubRequest<{ sha: string }>(token, `${repoPath}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      tree: [
        {
          path: 'README.md',
          mode: '100644',
          type: 'blob',
          sha: readmeBlob.sha,
        },
      ],
    }),
  });

  const commit = await githubRequest<{ sha: string }>(token, `${repoPath}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: 'chore(autodev-state): initialize persistent state orphan branch',
      tree: tree.sha,
      parents: [],
    }),
  });

  try {
    await githubRequest(token, `${repoPath}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${AUTODEV_STATE_BRANCH}`,
        sha: commit.sha,
      }),
    });
    return { headSha: commit.sha, treeSha: tree.sha, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Reference already exists') || msg.includes('(422)')) {
      const ref = await githubRequest<{ object: { sha: string } }>(
        token,
        `${repoPath}/git/ref/heads/${encodeURIComponent(AUTODEV_STATE_BRANCH)}`,
        { cache: 'no-store' }
      );
      const existingCommit = await githubRequest<{ tree: { sha: string } }>(
        token,
        `${repoPath}/git/commits/${ref.object.sha}`
      );
      return {
        headSha: ref.object.sha,
        treeSha: existingCommit.tree.sha,
        created: false,
      };
    }
    throw err;
  }
}

/**
 * Hydrate all 4 control-plane stores from GitHub orphan branch `autodev-state` on startup.
 * Uses Git Trees + Blobs (minimal API calls) and writes into `.autodev-data/` local cache.
 */
export async function hydrateGitHubStateStores(options?: {
  repoFullName?: string;
  onReloadStores?: () => void;
}): Promise<{
  hydrated: boolean;
  restoredKeys: PersistedStateKey[];
  createdBranch: boolean;
  error?: string;
}> {
  if (options?.repoFullName) {
    configuredRepoFullName = options.repoFullName;
  }

  const target = getRepoTarget();
  if (!target) {
    return {
      hydrated: false,
      restoredKeys: [],
      createdBranch: false,
      error: '未配置 GITHUB_TOKEN，跳过远端状态恢复',
    };
  }

  const { owner, repo, token } = target;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    const branchInfo = await ensureStateBranchExists(token, owner, repo);
    const treeData = await githubRequest<{
      tree?: Array<{ path: string; type: string; sha: string }>;
    }>(token, `${repoPath}/git/trees/${branchInfo.treeSha}?recursive=1`, {
      cache: 'no-store',
    });

    const blobMap = new Map<string, string>();
    for (const entry of treeData.tree || []) {
      if (entry.type === 'blob') {
        blobMap.set(entry.path, entry.sha);
      }
    }

    ensureLocalDataDir();
    const restoredKeys: PersistedStateKey[] = [];

    const keys = Object.keys(STATE_FILE_MAP) as PersistedStateKey[];
    await Promise.all(
      keys.map(async (key) => {
        const meta = STATE_FILE_MAP[key];
        const blobSha = blobMap.get(meta.remotePath);
        if (!blobSha) return;

        const blob = await githubRequest<{ content?: string; encoding?: string }>(
          token,
          `${repoPath}/git/blobs/${blobSha}`
        );
        if (!blob.content) return;

        const decoded =
          blob.encoding === 'base64'
            ? Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf-8')
            : blob.content;

        // Validate JSON before overwriting local file
        JSON.parse(decoded);

        const localPath = path.join(DATA_DIR, meta.localFile);
        fs.writeFileSync(localPath, decoded, 'utf-8');
        lastCommittedHashes.set(key, sha256(decoded));
        restoredKeys.push(key);
      })
    );

    hydrated = true;
    hydratedAt = new Date().toISOString();
    lastCommitSha = branchInfo.headSha;
    lastError = null;
    if (restoredKeys.length > 0) {
      lastSyncedAt = hydratedAt;
    }

    options?.onReloadStores?.();

    return {
      hydrated: true,
      restoredKeys,
      createdBranch: branchInfo.created,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    return {
      hydrated: false,
      restoredKeys: [],
      createdBranch: false,
      error: msg,
    };
  }
}

/**
 * Queue a state file for coalesced, debounced atomic commit to `autodev-state`.
 * Skips redundant writes whose content SHA-256 matches the last committed snapshot.
 */
export function scheduleGitHubStateSync(key: PersistedStateKey, data: unknown): void {
  if (!process.env.GITHUB_TOKEN?.trim()) return;
  const serialized = JSON.stringify(data, null, 2);
  const digest = sha256(serialized);

  if (lastCommittedHashes.get(key) === digest && !pendingPayloads.has(key)) {
    return;
  }

  if (pendingPayloads.has(key)) {
    coalescedWritesSaved += 1;
  }
  pendingPayloads.set(key, serialized);

  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushGitHubStateNow('debounced');
  }, FLUSH_DEBOUNCE_MS);
}

async function performAtomicCommit(
  snapshotEntries: Array<[PersistedStateKey, string]>,
  reason: string
): Promise<void> {
  const target = getRepoTarget();
  if (!target || snapshotEntries.length === 0) return;

  const { owner, repo, token } = target;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // Filter out entries that haven't actually changed since last commit
  const changedEntries = snapshotEntries.filter(
    ([key, content]) => lastCommittedHashes.get(key) !== sha256(content)
  );
  if (changedEntries.length === 0) {
    return;
  }

  // Create blobs in parallel once (blobs are content-addressed so safe across retry)
  const blobEntries = await Promise.all(
    changedEntries.map(async ([key, content]) => {
      const blob = await githubRequest<{ sha: string }>(token, `${repoPath}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          encoding: 'utf-8',
        }),
      });
      return {
        key,
        content,
        remotePath: STATE_FILE_MAP[key].remotePath,
        blobSha: blob.sha,
      };
    })
  );

  // Retry once on fast-forward conflict (422)
  for (let attempt = 0; attempt < 2; attempt++) {
    const branchInfo = await ensureStateBranchExists(token, owner, repo);

    const newTree = await githubRequest<{ sha: string }>(token, `${repoPath}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: branchInfo.treeSha,
        tree: blobEntries.map((item) => ({
          path: item.remotePath,
          mode: '100644',
          type: 'blob',
          sha: item.blobSha,
        })),
      }),
    });

    const changedKeysLabel = blobEntries.map((item) => item.key).join(', ');
    const newCommit = await githubRequest<{ sha: string }>(token, `${repoPath}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `chore(autodev-state): sync ${changedKeysLabel} (${reason})`,
        tree: newTree.sha,
        parents: [branchInfo.headSha],
      }),
    });

    try {
      await githubRequest(
        token,
        `${repoPath}/git/refs/heads/${encodeURIComponent(AUTODEV_STATE_BRANCH)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            sha: newCommit.sha,
            force: false,
          }),
        }
      );

      for (const item of blobEntries) {
        lastCommittedHashes.set(item.key, sha256(item.content));
      }
      lastSyncedAt = new Date().toISOString();
      lastCommitSha = newCommit.sha;
      lastError = null;
      totalFlushes += 1;
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && (msg.includes('(422)') || msg.includes('fast forward'))) {
        continue;
      }
      throw err;
    }
  }
}

/**
 * Flush all queued dirty state files into ONE single atomic commit on `autodev-state`.
 */
export async function flushGitHubStateNow(reason = 'manual'): Promise<GitHubStatePersistenceStatus> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (activeFlushPromise) {
    await activeFlushPromise;
    if (pendingPayloads.size === 0) {
      return getGitHubStatePersistenceStatus();
    }
  }

  const snapshot = Array.from(pendingPayloads.entries());
  if (snapshot.length === 0) {
    return getGitHubStatePersistenceStatus();
  }

  // Clear taken snapshot keys before async work; any new writes arriving mid-flush will re-add cleanly
  for (const [key] of snapshot) {
    pendingPayloads.delete(key);
  }

  const run = (async () => {
    try {
      await performAtomicCommit(snapshot, reason);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      // Re-queue failed snapshot entries if newer payloads haven't superseded them
      for (const [key, content] of snapshot) {
        if (!pendingPayloads.has(key)) {
          pendingPayloads.set(key, content);
        }
      }
    } finally {
      activeFlushPromise = null;
    }
  })();

  activeFlushPromise = run;
  await run;

  // If more writes arrived while flushing, drain them once
  if (pendingPayloads.size > 0 && !lastError) {
    return flushGitHubStateNow(`${reason}-drain`);
  }

  return getGitHubStatePersistenceStatus();
}

/**
 * Force snapshot all 4 local files and push them to `autodev-state` immediately.
 */
export async function forcePushAllLocalStateToGitHub(
  snapshots: Record<PersistedStateKey, unknown>,
  reason = 'force-sync'
): Promise<GitHubStatePersistenceStatus> {
  const keys = Object.keys(snapshots) as PersistedStateKey[];
  for (const key of keys) {
    pendingPayloads.set(key, JSON.stringify(snapshots[key], null, 2));
    // Clear cached hash so even empty reset snapshots are guaranteed written if branch has old data
    lastCommittedHashes.delete(key);
  }
  return flushGitHubStateNow(reason);
}
