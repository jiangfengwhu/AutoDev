import crypto from 'crypto';
import type {
  DraftPrResult,
  GitHubActionRun,
  GitHubIntegrationStatus,
  GitHubRepo,
  GitHubSelfHostedRunner,
  OpenAutodevPrSummary,
  RepoContextSnapshot,
  RepoMigrationSnippet,
} from '../src/types/autodev';
import type { PrArtifacts } from '../src/lib/specBuilder';
import { buildBootstrapReadmeContent, isEmptyGitHubRepoError } from '../src/lib/specBuilder';
import { generateBranchName } from '../src/lib/taskGraph';
import {
  AUTODEV_DEPLOY_WORKFLOW_PATH,
  AUTODEV_LIVE_LOG_ISSUE_TITLE,
  AUTODEV_PLAN_CHANNEL_BRANCH,
  AUTODEV_PLAN_WORKFLOW_PATH,
  AUTODEV_WORKFLOW_PATH,
  buildAgyPlanWorkflowYaml,
  buildAgyRunnerWorkflowYaml,
  buildCloudflareDeployWorkflowYaml,
} from '../src/lib/workflowBuilder';

const GITHUB_API_BASE = 'https://api.github.com';
const syncedWorkflowFingerprints = new Map<string, string>();

function getGitHubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'AutoDev-Studio-Control-Plane',
    'Content-Type': 'application/json',
  };
}

async function githubRequest<T>(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      ...getGitHubHeaders(token),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!response.ok) {
    const errMsg =
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`GitHub API 错误 (${response.status}): ${errMsg}`);
  }

  return parsed as T;
}

interface RawGitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

interface RawGitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

export async function checkGitHubIntegration(): Promise<GitHubIntegrationStatus> {
  const checkedAt = new Date().toISOString();
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!token) {
    return {
      configured: false,
      connected: false,
      error: '未检测到服务端环境变量 GITHUB_TOKEN，请在 Secrets 面板配置具有 repo 权限的 GitHub Token。',
      repos: [],
      checkedAt,
    };
  }

  try {
    const [rawUser, rawRepos] = await Promise.all([
      githubRequest<RawGitHubUser>(token, '/user'),
      githubRequest<RawGitHubRepo[]>(
        token,
        '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'
      ),
    ]);

    const repos: GitHubRepo[] = rawRepos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      private: repo.private,
      defaultBranch: repo.default_branch || 'main',
      htmlUrl: repo.html_url,
      description: repo.description,
      language: repo.language,
      updatedAt: repo.updated_at,
      canPush: Boolean(
        repo.permissions?.push || repo.permissions?.maintain || repo.permissions?.admin
      ),
    }));

    return {
      configured: true,
      connected: true,
      user: {
        login: rawUser.login,
        name: rawUser.name,
        avatarUrl: rawUser.avatar_url,
        htmlUrl: rawUser.html_url,
      },
      repos,
      checkedAt,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : 'GitHub 连通性校验失败',
      repos: [],
      checkedAt,
    };
  }
}

export async function createSpecDraftPr(params: {
  owner: string;
  repo: string;
  baseBranch?: string;
  artifacts: PrArtifacts;
}): Promise<DraftPrResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error(
      '服务端未配置 GITHUB_TOKEN，无法向 GitHub 创建分支与 Draft PR。请在 Secrets 面板添加具备 repo 写入权限的 GITHUB_TOKEN。'
    );
  }

  const { owner, repo, artifacts } = params;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // 1. Resolve repository default branch
  const repoMeta = await githubRequest<{ default_branch: string }>(token, repoPath);
  const baseBranch = params.baseBranch?.trim() || repoMeta.default_branch || 'main';

  // 2. Get HEAD commit SHA & base tree SHA (auto-bootstrap if repository is empty)
  let baseCommitSha: string;
  let baseTreeSha: string;
  let initializedEmptyRepo = false;

  try {
    const refData = await githubRequest<{ object: { sha: string } }>(
      token,
      `${repoPath}/git/ref/heads/${encodeURIComponent(baseBranch)}`
    );
    baseCommitSha = refData.object.sha;

    const baseCommit = await githubRequest<{ tree: { sha: string } }>(
      token,
      `${repoPath}/git/commits/${baseCommitSha}`
    );
    baseTreeSha = baseCommit.tree.sha;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!isEmptyGitHubRepoError(errMsg)) {
      throw err;
    }

    // Empty repository: bootstrap base branch with an initial README.md commit via Contents API
    const readmeContent = buildBootstrapReadmeContent(owner, repo);
    const bootstrapRes = await githubRequest<{
      commit: { sha: string; tree?: { sha: string } };
    }>(token, `${repoPath}/contents/README.md`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore(autodev): initialize base branch README',
        content: Buffer.from(readmeContent, 'utf-8').toString('base64'),
        branch: baseBranch,
      }),
    });

    baseCommitSha = bootstrapRes.commit.sha;
    if (bootstrapRes.commit.tree?.sha) {
      baseTreeSha = bootstrapRes.commit.tree.sha;
    } else {
      const baseCommit = await githubRequest<{ tree: { sha: string } }>(
        token,
        `${repoPath}/git/commits/${baseCommitSha}`
      );
      baseTreeSha = baseCommit.tree.sha;
    }
    initializedEmptyRepo = true;
  }

  // 4. Create blobs for latest pointers + archived iteration specs + non-overwriting read-only E2E test
  const filesToCommit = [
    { path: artifacts.specJsonPath, content: artifacts.specJsonContent },
    { path: artifacts.archivedSpecPath, content: artifacts.specJsonContent },
    { path: artifacts.prdMdPath, content: artifacts.prdMdContent },
    { path: artifacts.archivedPrdPath, content: artifacts.prdMdContent },
    { path: artifacts.e2eTestPath, content: artifacts.e2eTestContent },
  ];

  const blobEntries = await Promise.all(
    filesToCommit.map(async (file) => {
      const blob = await githubRequest<{ sha: string }>(token, `${repoPath}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: file.content,
          encoding: 'utf-8',
        }),
      });
      return {
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      };
    })
  );

  // 5. Create new tree
  const newTree = await githubRequest<{ sha: string }>(token, `${repoPath}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobEntries,
    }),
  });

  // 6. Create atomic commit
  const newCommit = await githubRequest<{ sha: string }>(token, `${repoPath}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `chore(autodev): add spec and read-only e2e contract for ${artifacts.prTitle.replace('[AutoDev Spec] ', '')}`,
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  });

  // 7. Create new feature branch (with collision fallback)
  let branchName = generateBranchName(new Date());
  try {
    await githubRequest<{ ref: string }>(token, `${repoPath}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      }),
    });
  } catch (refErr) {
    const msg = refErr instanceof Error ? refErr.message : '';
    if (msg.includes('Reference already exists')) {
      branchName = `${branchName}-${Math.random().toString(16).slice(2, 6)}`;
      await githubRequest<{ ref: string }>(token, `${repoPath}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: newCommit.sha,
        }),
      });
    } else {
      throw refErr;
    }
  }

  // 8. Create Draft PR (brief pause for GitHub git-ref propagation + 422 retry/draft fallback)
  await new Promise((resolve) => setTimeout(resolve, 450));

  const createPull = (draft: boolean) =>
    githubRequest<{ html_url: string; number: number }>(token, `${repoPath}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: artifacts.prTitle,
        head: branchName,
        base: baseBranch,
        body: artifacts.prBody,
        draft,
      }),
    });

  let pr: { html_url: string; number: number };
  try {
    pr = await createPull(true);
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (msg.includes('(422)')) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      try {
        pr = await createPull(true);
      } catch {
        pr = await createPull(false);
      }
    } else if (msg.includes('(403)')) {
      throw new Error(
        `规格分支 ${branchName} 已推送成功，但创建 Pull Request 权限不足（403）。请确认 GITHUB_TOKEN 具备 Pull requests: Read and write 权限。原始错误：${msg}`
      );
    } else {
      throw firstErr;
    }
  }

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
    branchName,
    baseBranch,
    commitSha: newCommit.sha,
    filesCommitted: filesToCommit.map((f) => f.path),
    e2eTestPath: artifacts.e2eTestPath,
    archivedSpecPath: artifacts.archivedSpecPath,
    createdAt: new Date().toISOString(),
    initializedEmptyRepo,
  };
}

export async function listGitHubActionRuns(
  owner: string,
  repo: string,
  perPage = 10
): Promise<{ connected: boolean; runs: GitHubActionRun[]; error?: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return {
      connected: false,
      runs: [],
      error: '未配置 GITHUB_TOKEN，暂无法拉取 GitHub Actions 运行记录。',
    };
  }

  try {
    const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const clampedPerPage = Math.max(1, Math.min(100, Math.floor(perPage)));
    const data = await githubRequest<{
      workflow_runs?: Array<{
        id: number;
        name: string;
        head_branch: string;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
        updated_at: string;
      }>;
    }>(token, `${repoPath}/actions/runs?per_page=${clampedPerPage}`);

    const runs: GitHubActionRun[] = (data.workflow_runs || []).map((r) => ({
      id: r.id,
      name: r.name,
      headBranch: r.head_branch,
      status: r.status,
      conclusion: r.conclusion,
      htmlUrl: r.html_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return { connected: true, runs };
  } catch (err) {
    return {
      connected: false,
      runs: [],
      error: err instanceof Error ? err.message : '拉取 GitHub Actions 运行记录失败',
    };
  }
}

export async function postPrApprovalComment(params: {
  owner: string;
  repo: string;
  prNumber: number;
  decision: 'approved' | 'changes_requested';
  note: string;
}): Promise<{ synced: boolean; error?: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return { synced: false, error: '未配置 GITHUB_TOKEN，审批结果仅记录在控制面。' };
  }

  const label =
    params.decision === 'approved' ? '验收通过 · 批准上线' : '退回修订 · 请求修改';
  const body = [
    `### AutoDev Studio 验收审批记录`,
    `- 审批结论：**${label}**`,
    `- 审批意见：${params.note || '无附加备注'}`,
  ].join('\n');

  try {
    const repoPath = `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`;
    await githubRequest(token, `${repoPath}/issues/${params.prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    return { synced: true };
  } catch (err) {
    return {
      synced: false,
      error: err instanceof Error ? err.message : '同步审批评论到 GitHub PR 失败',
    };
  }
}

export async function postGitHubPrComment(params: {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}): Promise<void> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return;
  const repoPath = `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`;
  await githubRequest(token, `${repoPath}/issues/${params.prNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: params.body }),
  });
}

export async function mergeDraftPrToMain(params: {
  owner: string;
  repo: string;
  prNumber: number;
  commitTitle?: string;
  commitMessage?: string;
  mergeMethod?: 'squash' | 'merge' | 'rebase';
}): Promise<{
  merged: boolean;
  release?: {
    mergedAt: string;
    mergeCommitSha: string;
    baseBranch: string;
    prNumber: number;
    prUrl: string;
    commitUrl: string;
    mergeMethod: 'squash' | 'merge' | 'rebase';
    alreadyMerged?: boolean;
    branchDeleted?: boolean;
  };
  error?: string;
}> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return { merged: false, error: '服务端未配置 GITHUB_TOKEN，无法自动合并 PR 到 main 分支。' };
  }

  const { owner, repo, prNumber } = params;
  const mergeMethod = params.mergeMethod || 'squash';
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    const pr = await githubRequest<{
      node_id: string;
      draft: boolean;
      merged: boolean;
      state: string;
      title: string;
      html_url: string;
      merge_commit_sha: string | null;
      merged_at: string | null;
      base: { ref: string };
      head?: { ref?: string };
    }>(token, `${repoPath}/pulls/${prNumber}`);

    const baseBranch = pr.base?.ref || 'main';
    const headBranch = pr.head?.ref || '';
    const prUrl = pr.html_url || `https://github.com/${owner}/${repo}/pull/${prNumber}`;

    if (pr.merged) {
      const sha = pr.merge_commit_sha || '';
      const branchDeleted =
        headBranch && headBranch.startsWith('autodev/')
          ? await deleteBranchRef(owner, repo, headBranch)
          : false;
      return {
        merged: true,
        release: {
          mergedAt: pr.merged_at || new Date().toISOString(),
          mergeCommitSha: sha,
          baseBranch,
          prNumber,
          prUrl,
          commitUrl: sha ? `https://github.com/${owner}/${repo}/commit/${sha}` : prUrl,
          mergeMethod,
          alreadyMerged: true,
          branchDeleted,
        },
      };
    }

    if (pr.state !== 'open') {
      return { merged: false, error: `PR #${prNumber} 当前状态为 ${pr.state}，无法合并。` };
    }

    // 1. Convert Draft PR to Ready for Review via GitHub GraphQL API
    if (pr.draft && pr.node_id) {
      const gqlRes = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AutoDev-Studio-Control-Plane',
        },
        body: JSON.stringify({
          query: `mutation($pullRequestId: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
              pullRequest { id isDraft }
            }
          }`,
          variables: { pullRequestId: pr.node_id },
        }),
      });
      const gqlJson = (await gqlRes.json().catch(() => ({}))) as {
        errors?: Array<{ message: string }>;
      };
      if (!gqlRes.ok || (gqlJson.errors && gqlJson.errors.length > 0)) {
        const errMsg =
          gqlJson.errors?.map((e) => e.message).join('; ') || `GraphQL HTTP ${gqlRes.status}`;
        return {
          merged: false,
          error: `解除 Draft PR 状态失败：${errMsg}`,
        };
      }
      // Give GitHub a brief moment to update mergeable state after Ready transition
      await new Promise((r) => setTimeout(r, 900));
    }

    // 2. Merge PR into base branch (retry once if GitHub is still recalculating mergeability)
    const doMerge = () =>
      githubRequest<{ sha: string; merged: boolean; message: string }>(
        token,
        `${repoPath}/pulls/${prNumber}/merge`,
        {
          method: 'PUT',
          body: JSON.stringify({
            commit_title: params.commitTitle || `${pr.title} (#${prNumber})`,
            commit_message:
              params.commitMessage || 'Approved and merged via AutoDev Studio Release Gate.',
            merge_method: mergeMethod,
          }),
        }
      );

    let mergeRes: { sha: string; merged: boolean; message: string };
    try {
      mergeRes = await doMerge();
    } catch (firstErr) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      if (firstMsg.includes('(405)') || firstMsg.includes('not mergeable')) {
        await new Promise((r) => setTimeout(r, 1500));
        mergeRes = await doMerge();
      } else {
        throw firstErr;
      }
    }

    if (!mergeRes.merged) {
      return { merged: false, error: mergeRes.message || `PR #${prNumber} 合并未成功` };
    }

    // 3. Auto-cleanup merged autodev/* feature branch so branch list stays clean
    const branchDeleted =
      headBranch && headBranch.startsWith('autodev/')
        ? await deleteBranchRef(owner, repo, headBranch)
        : false;

    return {
      merged: true,
      release: {
        mergedAt: new Date().toISOString(),
        mergeCommitSha: mergeRes.sha,
        baseBranch,
        prNumber,
        prUrl,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${mergeRes.sha}`,
        mergeMethod,
        branchDeleted,
      },
    };
  } catch (err) {
    return {
      merged: false,
      error: err instanceof Error ? err.message : `合并 PR #${prNumber} 失败`,
    };
  }
}

export async function listSelfHostedRunners(
  owner: string,
  repo: string
): Promise<{
  connected: boolean;
  runners: GitHubSelfHostedRunner[];
  workflowExists: boolean;
  workflowUrl?: string;
  deployWorkflowExists: boolean;
  deployWorkflowUrl?: string;
  branches: string[];
  error?: string;
}> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return {
      connected: false,
      runners: [],
      workflowExists: false,
      deployWorkflowExists: false,
      branches: [],
      error: '未配置 GITHUB_TOKEN，暂无法探测 Self-Hosted Runner 状态。',
    };
  }

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let workflowExists = false;
  let workflowUrl: string | undefined;
  let deployWorkflowExists = false;
  let deployWorkflowUrl: string | undefined;
  let branches: string[] = [];

  try {
    const wfFile = await githubRequest<{ html_url?: string }>(
      token,
      `${repoPath}/contents/${AUTODEV_WORKFLOW_PATH}`
    );
    workflowExists = true;
    workflowUrl = wfFile.html_url;
  } catch {
    workflowExists = false;
  }

  try {
    const deployFile = await githubRequest<{ html_url?: string }>(
      token,
      `${repoPath}/contents/${AUTODEV_DEPLOY_WORKFLOW_PATH}`
    );
    deployWorkflowExists = true;
    deployWorkflowUrl = deployFile.html_url;
  } catch {
    deployWorkflowExists = false;
  }

  try {
    const rawBranches = await githubRequest<Array<{ name: string }>>(
      token,
      `${repoPath}/branches?per_page=30`
    );
    branches = rawBranches.map((b) => b.name);
  } catch {
    branches = [];
  }

  try {
    const data = await githubRequest<{
      runners?: Array<{
        id: number;
        name: string;
        os: string;
        status: string;
        busy: boolean;
        labels?: Array<{ name: string }>;
      }>;
    }>(token, `${repoPath}/actions/runners`);

    const runners: GitHubSelfHostedRunner[] = (data.runners || []).map((r) => ({
      id: r.id,
      name: r.name,
      os: r.os,
      status: r.status,
      busy: Boolean(r.busy),
      labels: (r.labels || []).map((l) => l.name),
    }));

    return {
      connected: true,
      runners,
      workflowExists,
      workflowUrl,
      deployWorkflowExists,
      deployWorkflowUrl,
      branches,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : '';
    const friendlyError = rawMsg.includes('(403)')
      ? '当前 GITHUB_TOKEN 缺少仓库 Administration 权限，暂无法通过 API 读取 Self-Hosted Runner 列表。请在 GitHub Token 权限中开启 Administration (Read/Write)、Pull requests (Read/Write)、Workflows (Read/Write) 与 Actions (Read/Write)。'
      : rawMsg || '拉取 Self-Hosted Runner 列表失败';
    return {
      connected: false,
      runners: [],
      workflowExists,
      workflowUrl,
      deployWorkflowExists,
      deployWorkflowUrl,
      branches,
      error: friendlyError,
    };
  }
}

async function upsertRepoFile(params: {
  token: string;
  repoPath: string;
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  content: string;
  createMessage: string;
  updateMessage: string;
}): Promise<{
  path: string;
  commitSha: string;
  htmlUrl: string;
  updated: boolean;
  skipped?: boolean;
}> {
  const { token, repoPath, owner, repo, baseBranch, filePath, content, createMessage, updateMessage } =
    params;

  let existingSha: string | undefined;
  let existingHtmlUrl: string | undefined;
  let existingContent: string | undefined;
  try {
    const existing = await githubRequest<{
      sha: string;
      content?: string;
      encoding?: string;
      html_url?: string;
    }>(token, `${repoPath}/contents/${filePath}?ref=${encodeURIComponent(baseBranch)}`);
    existingSha = existing.sha;
    existingHtmlUrl = existing.html_url;
    if (existing.content && existing.encoding === 'base64') {
      existingContent = Buffer.from(existing.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    }
  } catch {
    existingSha = undefined;
  }

  // Skip commit when remote file content already matches template verbatim
  if (existingSha && existingContent !== undefined && existingContent === content) {
    return {
      path: filePath,
      commitSha: existingSha,
      htmlUrl:
        existingHtmlUrl || `https://github.com/${owner}/${repo}/blob/${baseBranch}/${filePath}`,
      updated: false,
      skipped: true,
    };
  }

  const res = await githubRequest<{
    commit: { sha: string };
    content?: { html_url?: string };
  }>(token, `${repoPath}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: existingSha ? updateMessage : createMessage,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: baseBranch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  return {
    path: filePath,
    commitSha: res.commit.sha,
    htmlUrl:
      res.content?.html_url || `https://github.com/${owner}/${repo}/blob/${baseBranch}/${filePath}`,
    updated: Boolean(existingSha),
    skipped: false,
  };
}

export async function syncAgyWorkflowFile(params: {
  owner: string;
  repo: string;
  baseBranch?: string;
}): Promise<{
  path: string;
  commitSha: string;
  htmlUrl: string;
  updated: boolean;
  skipped?: boolean;
  deployWorkflow: {
    path: string;
    commitSha: string;
    htmlUrl: string;
    updated: boolean;
    skipped?: boolean;
  };
  planWorkflow: {
    path: string;
    commitSha: string;
    htmlUrl: string;
    updated: boolean;
    skipped?: boolean;
  };
}> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法写入 GitHub Actions Workflow 文件。');
  }

  const { owner, repo } = params;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repoMeta = await githubRequest<{ default_branch: string }>(token, repoPath);
  const baseBranch = params.baseBranch?.trim() || repoMeta.default_branch || 'main';

  try {
    const agyRes = await upsertRepoFile({
      token,
      repoPath,
      owner,
      repo,
      baseBranch,
      filePath: AUTODEV_WORKFLOW_PATH,
      content: buildAgyRunnerWorkflowYaml(owner),
      createMessage: 'chore(autodev): add VPS AGY self-hosted runner workflow',
      updateMessage: 'chore(autodev): update VPS AGY self-hosted runner workflow',
    });

    const deployRes = await upsertRepoFile({
      token,
      repoPath,
      owner,
      repo,
      baseBranch,
      filePath: AUTODEV_DEPLOY_WORKFLOW_PATH,
      content: buildCloudflareDeployWorkflowYaml(owner),
      createMessage: 'chore(autodev): add Cloudflare Workers auto-deploy workflow',
      updateMessage: 'chore(autodev): update Cloudflare Workers auto-deploy workflow',
    });

    const planRes = await upsertRepoFile({
      token,
      repoPath,
      owner,
      repo,
      baseBranch,
      filePath: AUTODEV_PLAN_WORKFLOW_PATH,
      content: buildAgyPlanWorkflowYaml(owner),
      createMessage: 'chore(autodev): add Instabox AGY 3-stage planning workflow',
      updateMessage: 'chore(autodev): update Instabox AGY 3-stage planning workflow',
    });

    return {
      ...agyRes,
      deployWorkflow: deployRes,
      planWorkflow: planRes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('workflow') || msg.includes('(403)') || msg.includes('(404)')) {
      throw new Error(
        `写入 Workflow 失败（需要 GITHUB_TOKEN 具备 workflow 权限）。原始错误：${msg}`
      );
    }
    throw err;
  }
}

export async function ensureWorkflowsUpToDate(params: {
  owner: string;
  repo: string;
  baseBranch?: string;
}): Promise<{ synced: boolean; changed: boolean }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return { synced: false, changed: false };
  }

  const baseBranch = params.baseBranch?.trim() || 'main';
  const cacheKey = `${params.owner.toLowerCase()}/${params.repo.toLowerCase()}@${baseBranch}`;
  const fingerprint = crypto
    .createHash('sha256')
    .update(buildAgyRunnerWorkflowYaml(params.owner))
    .update('\n---\n')
    .update(buildCloudflareDeployWorkflowYaml(params.owner))
    .update('\n---\n')
    .update(buildAgyPlanWorkflowYaml(params.owner))
    .digest('hex');

  if (syncedWorkflowFingerprints.get(cacheKey) === fingerprint) {
    return { synced: true, changed: false };
  }

  const result = await syncAgyWorkflowFile({
    owner: params.owner,
    repo: params.repo,
    baseBranch,
  });

  syncedWorkflowFingerprints.set(cacheKey, fingerprint);
  const changed =
    !result.skipped || !result.deployWorkflow.skipped || !result.planWorkflow.skipped;
  return { synced: true, changed };
}

export async function ensurePlanChannelBranch(
  owner: string,
  repo: string,
  channelBranch = AUTODEV_PLAN_CHANNEL_BRANCH
): Promise<{ branch: string; created: boolean }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法初始化规划产物通道分支。');
  }
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    await githubRequest<{ object: { sha: string } }>(
      token,
      `${repoPath}/git/ref/heads/${encodeURIComponent(channelBranch)}`
    );
    return { branch: channelBranch, created: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('(404)')) {
      throw err;
    }
  }

  // Create an isolated orphan branch (parents: []) using only Contents: write permission
  const blob = await githubRequest<{ sha: string }>(token, `${repoPath}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({
      content: '# AutoDev Plan Artifacts Channel\n\nDedicated orphan branch for AutoDev Studio Instabox AGY 3-stage planning JSON artifacts.\n',
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
          sha: blob.sha,
        },
      ],
    }),
  });

  const commit = await githubRequest<{ sha: string }>(token, `${repoPath}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: 'chore(autodev-plan): initialize orphan plan artifact channel',
      tree: tree.sha,
      parents: [],
    }),
  });

  try {
    await githubRequest(token, `${repoPath}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${channelBranch}`,
        sha: commit.sha,
      }),
    });
    return { branch: channelBranch, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Reference already exists') || msg.includes('(422)')) {
      return { branch: channelBranch, created: false };
    }
    throw err;
  }
}

export async function upsertPlanChannelJson(params: {
  owner: string;
  repo: string;
  channelBranch?: string;
  filePath: string;
  data: unknown;
  commitMessage: string;
}): Promise<{ path: string; sha: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN');
  }
  const channelBranch = params.channelBranch || AUTODEV_PLAN_CHANNEL_BRANCH;
  const repoPath = `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`;
  const encodedPath = params.filePath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');

  let existingSha: string | undefined;
  try {
    const existing = await githubRequest<{ sha: string }>(
      token,
      `${repoPath}/contents/${encodedPath}?ref=${encodeURIComponent(channelBranch)}`
    );
    existingSha = existing.sha;
  } catch {
    existingSha = undefined;
  }

  const contentB64 = Buffer.from(JSON.stringify(params.data, null, 2), 'utf-8').toString('base64');
  const body: Record<string, string> = {
    message: params.commitMessage,
    content: contentB64,
    branch: channelBranch,
  };
  if (existingSha) body.sha = existingSha;

  const updated = await githubRequest<{ content?: { sha?: string; path?: string } }>(
    token,
    `${repoPath}/contents/${encodedPath}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
  );

  return {
    path: updated.content?.path || params.filePath,
    sha: updated.content?.sha || existingSha || '',
  };
}

export async function readPlanChannelJson<T>(
  owner: string,
  repo: string,
  filePath: string,
  channelBranch = AUTODEV_PLAN_CHANNEL_BRANCH
): Promise<T | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN');
  }
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const encodedPath = filePath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  try {
    const res = await githubRequest<{ content?: string; encoding?: string }>(
      token,
      `${repoPath}/contents/${encodedPath}?ref=${encodeURIComponent(channelBranch)}`,
      { cache: 'no-store' }
    );
    if (!res.content) return null;
    const decoded =
      res.encoding === 'base64'
        ? Buffer.from(res.content.replace(/\n/g, ''), 'base64').toString('utf-8')
        : res.content;
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

export async function dispatchAgyPlanWorkflow(params: {
  owner: string;
  repo: string;
  jobId: string;
  baseBranch?: string;
  channelBranch?: string;
  agyModel?: string;
}): Promise<{ dispatched: boolean; model: string; actionsUrl: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法派发 Instabox AGY 规划工作流。');
  }

  const { owner, repo, jobId } = params;
  const baseBranch = params.baseBranch?.trim() || 'main';
  const channelBranch = params.channelBranch?.trim() || AUTODEV_PLAN_CHANNEL_BRANCH;
  const agyModel = params.agyModel?.trim() || 'gemini-3.8-flash-high';
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // Ensure autodev-plan.yml is synced on baseBranch before dispatching
  const syncState = await ensureWorkflowsUpToDate({ owner, repo, baseBranch });
  if (syncState.changed) {
    await new Promise((r) => setTimeout(r, 1800));
  }

  await githubRequest<null>(
    token,
    `${repoPath}/actions/workflows/autodev-plan.yml/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: baseBranch,
        inputs: {
          job_id: jobId,
          base_branch: baseBranch,
          channel_branch: channelBranch,
          agy_model: agyModel,
        },
      }),
    }
  );

  return {
    dispatched: true,
    model: agyModel,
    actionsUrl: `https://github.com/${owner}/${repo}/actions/workflows/autodev-plan.yml`,
  };
}

export async function findLatestPlanActionRun(
  owner: string,
  repo: string,
  createdAfterIso: string
): Promise<{
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
} | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const data = await githubRequest<{
      workflow_runs?: Array<{
        id: number;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
      }>;
    }>(token, `${repoPath}/actions/workflows/autodev-plan.yml/runs?per_page=10`);

    const thresholdMs = new Date(createdAfterIso).getTime() - 15_000;
    const match = (data.workflow_runs || []).find(
      (r) => new Date(r.created_at).getTime() >= thresholdMs
    );
    if (!match) return null;
    return {
      id: match.id,
      status: match.status,
      conclusion: match.conclusion,
      htmlUrl: match.html_url,
    };
  } catch {
    return null;
  }
}

export async function dispatchAgyWorkflow(params: {
  owner: string;
  repo: string;
  prBranch: string;
  prNumber?: number;
  runId?: string;
  e2eTestPath?: string;
  revisionNote?: string;
  agyModel?: string;
  baseBranch?: string;
  sessionMode?: 'fresh' | 'resume';
  resumeSessionId?: string;
}): Promise<{ dispatched: boolean; branch: string; model: string; actionsUrl: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法触发 GitHub Actions Workflow。');
  }

  const {
    owner,
    repo,
    prBranch,
    prNumber,
    runId,
    e2eTestPath,
    revisionNote,
    sessionMode,
    resumeSessionId,
  } = params;
  const agyModel = params.agyModel?.trim() || 'gemini-3.8-flash-high';
  const baseBranch = params.baseBranch?.trim() || 'main';
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // Auto-sync latest workflow YAML before dispatch (idempotent; skips commit if unchanged)
  try {
    const syncState = await ensureWorkflowsUpToDate({ owner, repo, baseBranch });
    if (syncState.changed) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (syncErr) {
    console.warn('[AutoDev] Auto workflow sync skipped before AGY dispatch:', syncErr);
  }

  const fullInputs: Record<string, string> = {
    pr_branch: prBranch,
    pr_number: prNumber ? String(prNumber) : '',
    run_id: runId || '',
    e2e_test_path: e2eTestPath || '',
    revision_note: (revisionNote || '').slice(0, 1500),
    agy_model: agyModel,
    session_mode: sessionMode || 'fresh',
    resume_session_id: resumeSessionId || '',
  };

  try {
    await githubRequest<null>(
      token,
      `${repoPath}/actions/workflows/autodev-agy.yml/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: baseBranch,
          inputs: fullInputs,
        }),
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback if target repo has not yet synced the newest workflow YAML with extra inputs
    if (msg.includes('(422)') && msg.includes('Unexpected inputs')) {
      await githubRequest<null>(
        token,
        `${repoPath}/actions/workflows/autodev-agy.yml/dispatches`,
        {
          method: 'POST',
          body: JSON.stringify({
            ref: baseBranch,
            inputs: {
              pr_branch: prBranch,
              pr_number: prNumber ? String(prNumber) : '',
              run_id: runId || '',
              agy_model: agyModel,
            },
          }),
        }
      );
    } else {
      throw err;
    }
  }

  return {
    dispatched: true,
    branch: prBranch,
    model: agyModel,
    actionsUrl: `https://github.com/${owner}/${repo}/actions/workflows/autodev-agy.yml`,
  };
}

export async function dispatchCloudflareDeployWorkflow(params: {
  owner: string;
  repo: string;
  targetBranch?: string;
  workerName?: string;
  baseBranch?: string;
}): Promise<{ dispatched: boolean; targetBranch: string; actionsUrl: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法触发 Cloudflare 自动部署 Workflow。');
  }

  const { owner, repo, workerName } = params;
  const baseBranch = params.baseBranch?.trim() || 'main';
  const targetBranch = params.targetBranch?.trim() || baseBranch;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // Auto-sync latest Cloudflare deploy workflow YAML before dispatch
  try {
    const syncState = await ensureWorkflowsUpToDate({ owner, repo, baseBranch });
    if (syncState.changed) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (syncErr) {
    console.warn('[AutoDev] Auto workflow sync skipped before Cloudflare dispatch:', syncErr);
  }

  await githubRequest<null>(
    token,
    `${repoPath}/actions/workflows/autodev-deploy-cf.yml/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: baseBranch,
        inputs: {
          target_branch: targetBranch,
          worker_name: workerName?.trim() || '',
        },
      }),
    }
  );

  return {
    dispatched: true,
    targetBranch,
    actionsUrl: `https://github.com/${owner}/${repo}/actions/workflows/autodev-deploy-cf.yml`,
  };
}

export async function cancelGitHubActionRun(
  owner: string,
  repo: string,
  runId: number
): Promise<{ cancelled: boolean; runId: number }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('未配置 GITHUB_TOKEN，无法取消运行中的 GitHub Actions 任务。');
  }
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  await githubRequest<unknown>(token, `${repoPath}/actions/runs/${runId}/cancel`, {
    method: 'POST',
  });
  return { cancelled: true, runId };
}

export interface LiveAgyStreamSnapshot {
  statusLabel: string;
  workspace?: string;
  branch?: string;
  model?: string;
  elapsed?: string;
  updatedAt?: string;
  changedFiles?: string;
  output?: string;
  rawBody: string;
}

function parseLiveAgyComment(body: string, fallbackUpdatedAt?: string): LiveAgyStreamSnapshot {
  const getField = (label: string): string | undefined => {
    const match = body.match(new RegExp(`^- ${label}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : undefined;
  };
  let blocks = Array.from(body.matchAll(/~~~~text\n([\s\S]*?)\n~~~~/g)).map((m) => m[1]);
  if (blocks.length === 0) {
    blocks = Array.from(body.matchAll(/```text\n([\s\S]*?)\n```/g)).map((m) => m[1]);
  }
  return {
    statusLabel: getField('Status') || 'RUNNING',
    workspace: getField('Workspace'),
    branch: getField('Branch'),
    model: getField('Model'),
    elapsed: getField('Elapsed'),
    updatedAt: getField('Updated') || fallbackUpdatedAt,
    changedFiles: blocks[0],
    output: blocks[1],
    rawBody: body,
  };
}

async function fetchLiveAgyStreamForRun(
  token: string,
  repoPath: string,
  runId: number
): Promise<LiveAgyStreamSnapshot | null> {
  try {
    const issues = await githubRequest<
      Array<{ number: number; title: string; comments?: number; pull_request?: unknown }>
    >(token, `${repoPath}/issues?state=open&per_page=30`);
    const trackingIssue = issues.find(
      (i) => !i.pull_request && i.title === AUTODEV_LIVE_LOG_ISSUE_TITLE
    );
    if (!trackingIssue) return null;

    const totalComments = Number(trackingIssue.comments || 0);
    const lastPage = Math.max(1, Math.ceil((totalComments || 1) / 100));
    const pagesToCheck = lastPage > 1 ? [lastPage, lastPage - 1] : [1];
    const marker = `<!-- AUTODEV-LIVE-LOG:${runId} -->`;

    for (const page of pagesToCheck) {
      const comments = await githubRequest<
        Array<{ id: number; body?: string; updated_at?: string }>
      >(token, `${repoPath}/issues/${trackingIssue.number}/comments?per_page=100&page=${page}`);
      const matched = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));
      if (matched?.body) {
        return parseLiveAgyComment(matched.body, matched.updated_at);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface GitHubActionJobDetail {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  runnerName: string | null;
  htmlUrl: string;
  steps: Array<{
    number: number;
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  logTail?: string;
}

export async function getGitHubActionRunDetail(
  owner: string,
  repo: string,
  runId: number
): Promise<{
  jobs: GitHubActionJobDetail[];
  liveAgyStream: LiveAgyStreamSnapshot | null;
}> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('未配置 GITHUB_TOKEN');
  }

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [jobsData, liveAgyStream] = await Promise.all([
    githubRequest<{
      jobs?: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        runner_name: string | null;
        html_url: string;
        steps?: Array<{
          number: number;
          name: string;
          status: string;
          conclusion: string | null;
        }>;
      }>;
    }>(token, `${repoPath}/actions/runs/${runId}/jobs`),
    fetchLiveAgyStreamForRun(token, repoPath, runId),
  ]);

  const jobs: GitHubActionJobDetail[] = await Promise.all(
    (jobsData.jobs || []).map(async (job) => {
      let logTail: string | undefined;
      if (job.status === 'completed') {
        try {
          const logRes = await fetch(`${GITHUB_API_BASE}${repoPath}/actions/jobs/${job.id}/logs`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'AutoDev-Studio-Control-Plane',
            },
            redirect: 'follow',
          });
          if (logRes.ok) {
            const fullText = await logRes.text();
            const lines = fullText.split('\n');
            logTail = lines.slice(-120).join('\n');
          }
        } catch {
          // non-fatal
        }
      }

      return {
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        runnerName: job.runner_name,
        htmlUrl: job.html_url,
        steps: (job.steps || []).map((s) => ({
          number: s.number,
          name: s.name,
          status: s.status,
          conclusion: s.conclusion,
        })),
        logTail,
      };
    })
  );

  return { jobs, liveAgyStream };
}

export async function getBranchDeployPipelineStatus(
  owner: string,
  repo: string,
  branch: string
): Promise<{
  connected: boolean;
  latestRun: {
    id: number;
    name: string;
    headBranch: string;
    status: string;
    conclusion: string | null;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      number: number;
      name: string;
      status: string;
      conclusion: string | null;
    }>;
  } | null;
  recentRuns: GitHubActionRun[];
  error?: string;
}> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return {
      connected: false,
      latestRun: null,
      recentRuns: [],
      error: '未配置 GITHUB_TOKEN',
    };
  }

  try {
    const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const data = await githubRequest<{
      workflow_runs?: Array<{
        id: number;
        name: string;
        path?: string;
        head_branch: string;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
        updated_at: string;
      }>;
    }>(token, `${repoPath}/actions/runs?per_page=20`);

    const rawRuns = data.workflow_runs || [];
    const recentRuns: GitHubActionRun[] = rawRuns.slice(0, 8).map((r) => ({
      id: r.id,
      name: r.name,
      headBranch: r.head_branch,
      status: r.status,
      conclusion: r.conclusion,
      htmlUrl: r.html_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const isDeployWorkflow = (r: { name: string; path?: string }) =>
      /deploy|pages|cloudflare|wrangler/i.test(`${r.name} ${r.path || ''}`);

    // Priority: deploy workflow on target branch -> any deploy workflow -> any workflow on target branch -> latest workflow
    const chosen =
      rawRuns.find((r) => isDeployWorkflow(r) && r.head_branch === branch) ??
      rawRuns.find((r) => isDeployWorkflow(r)) ??
      rawRuns.find((r) => r.head_branch === branch) ??
      rawRuns[0] ??
      null;

    if (!chosen) {
      return {
        connected: true,
        latestRun: null,
        recentRuns,
      };
    }

    let steps: Array<{
      number: number;
      name: string;
      status: string;
      conclusion: string | null;
    }> = [];

    try {
      const jobsRes = await githubRequest<{
        jobs?: Array<{
          steps?: Array<{
            number: number;
            name: string;
            status: string;
            conclusion: string | null;
          }>;
        }>;
      }>(token, `${repoPath}/actions/runs/${chosen.id}/jobs`);
      const firstJob = jobsRes.jobs?.[0];
      if (firstJob?.steps) {
        steps = firstJob.steps.map((s) => ({
          number: s.number,
          name: s.name,
          status: s.status,
          conclusion: s.conclusion,
        }));
      }
    } catch {
      // non-fatal if step detail unavailable
    }

    return {
      connected: true,
      latestRun: {
        id: chosen.id,
        name: chosen.name,
        headBranch: chosen.head_branch,
        status: chosen.status,
        conclusion: chosen.conclusion,
        htmlUrl: chosen.html_url,
        createdAt: chosen.created_at,
        updatedAt: chosen.updated_at,
        steps,
      },
      recentRuns,
    };
  } catch (err) {
    return {
      connected: false,
      latestRun: null,
      recentRuns: [],
      error: err instanceof Error ? err.message : '拉取部署流水线状态失败',
    };
  }
}

export async function deleteBranchRef(
  owner: string,
  repo: string,
  branchName: string
): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token || !branchName || branchName === 'main' || branchName === 'master') {
    return false;
  }
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}${repoPath}/git/refs/heads/${encodeURIComponent(branchName)}`,
      {
        method: 'DELETE',
        headers: getGitHubHeaders(token),
      }
    );
    return res.ok || res.status === 422 || res.status === 404;
  } catch {
    return false;
  }
}

export async function listOpenAutodevPrs(
  owner: string,
  repo: string
): Promise<OpenAutodevPrSummary[]> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return [];

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const rawPrs = await githubRequest<
      Array<{
        number: number;
        title: string;
        html_url: string;
        draft?: boolean;
        updated_at: string;
        head: { ref: string };
        base: { ref: string };
      }>
    >(token, `${repoPath}/pulls?state=open&per_page=20&sort=updated&direction=desc`);

    return (rawPrs || [])
      .filter(
        (pr) =>
          pr.head?.ref?.startsWith('autodev/') ||
          pr.title?.startsWith('[AutoDev Spec]')
      )
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        htmlUrl: pr.html_url,
        draft: Boolean(pr.draft),
        updatedAt: pr.updated_at,
      }));
  } catch {
    return [];
  }
}

async function fetchRepoFileText(
  token: string,
  repoPath: string,
  filePath: string,
  ref: string,
  maxChars = 4000
): Promise<string | undefined> {
  try {
    const encodedPath = filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const file = await githubRequest<{ content?: string; encoding?: string }>(
      token,
      `${repoPath}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
    );
    if (!file.content) return undefined;
    const decoded =
      file.encoding === 'base64'
        ? Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf-8')
        : file.content;
    return decoded.length > maxChars
      ? `${decoded.slice(0, maxChars)}\n... (已截断)`
      : decoded;
  } catch {
    return undefined;
  }
}

export async function fetchRepoContextSnapshot(
  owner: string,
  repo: string,
  branch = 'main'
): Promise<RepoContextSnapshot | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const fetchedAt = new Date().toISOString();

  try {
    let headSha = '';
    try {
      const refData = await githubRequest<{ object: { sha: string } }>(
        token,
        `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`
      );
      headSha = refData.object.sha;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isEmptyGitHubRepoError(msg)) {
        return {
          repoFullName: `${owner}/${repo}`,
          branch,
          headSha: '',
          fetchedAt,
          isEmptyRepo: true,
          totalFiles: 0,
          fileTree: [],
          existingMigrations: [],
          existingE2eTests: [],
        };
      }
      throw err;
    }

    const treeData = await githubRequest<{
      tree?: Array<{ path: string; type: string }>;
    }>(token, `${repoPath}/git/trees/${headSha}?recursive=1`);

    const allBlobs = (treeData.tree || [])
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
      .map((entry) => entry.path);

    const filteredTree = allBlobs
      .filter(
        (p) =>
          !p.startsWith('node_modules/') &&
          !p.startsWith('dist/') &&
          !p.startsWith('.git/') &&
          !p.endsWith('package-lock.json') &&
          !p.endsWith('pnpm-lock.yaml')
      )
      .slice(0, 120);

    const existingE2eTests = allBlobs
      .filter((p) => p === 'tests/e2e.spec.ts' || (p.startsWith('tests/e2e/') && p.endsWith('.spec.ts')))
      .sort();

    const migrationPaths = allBlobs
      .filter((p) => p.startsWith('migrations/') && p.endsWith('.sql'))
      .sort();

    const wranglerFile = allBlobs.find(
      (p) => p === 'wrangler.toml' || p === 'wrangler.jsonc' || p === 'wrangler.json'
    );
    const hasPackageJson = allBlobs.includes('package.json');
    const hasPreviousSpec = allBlobs.includes('docs/spec.json');

    const [packageJsonSnippet, wranglerConfigSnippet, previousSpecRaw, migrationSnippets] =
      await Promise.all([
        hasPackageJson
          ? fetchRepoFileText(token, repoPath, 'package.json', headSha, 2600)
          : Promise.resolve(undefined),
        wranglerFile
          ? fetchRepoFileText(token, repoPath, wranglerFile, headSha, 2000)
          : Promise.resolve(undefined),
        hasPreviousSpec
          ? fetchRepoFileText(token, repoPath, 'docs/spec.json', headSha, 8000)
          : Promise.resolve(undefined),
        Promise.all(
          migrationPaths.slice(-4).map(async (migPath): Promise<RepoMigrationSnippet> => ({
            path: migPath,
            snippet:
              (await fetchRepoFileText(token, repoPath, migPath, headSha, 1800)) ||
              '-- (unable to read migration content)',
          }))
        ),
      ]);

    let previousSpecSummary: string | undefined;
    if (previousSpecRaw) {
      try {
        const parsed = JSON.parse(previousSpecRaw) as {
          prdTitle?: string;
          runId?: string;
          architecture?: { summary?: string };
          apiContracts?: Array<{ method: string; path: string; summary: string }>;
        };
        const apiLines = (parsed.apiContracts || [])
          .slice(0, 12)
          .map((api) => `  - ${api.method} ${api.path} (${api.summary})`)
          .join('\n');
        previousSpecSummary = [
          `- 上一轮需求: ${parsed.prdTitle || '(未命名)'} (runId: ${parsed.runId || 'unknown'})`,
          parsed.architecture?.summary
            ? `- 上一轮架构摘要: ${parsed.architecture.summary.slice(0, 500)}`
            : '',
          apiLines ? `- 既有接口契约:\n${apiLines}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      } catch {
        previousSpecSummary = previousSpecRaw.slice(0, 1000);
      }
    }

    return {
      repoFullName: `${owner}/${repo}`,
      branch,
      headSha,
      fetchedAt,
      isEmptyRepo: allBlobs.length === 0,
      totalFiles: allBlobs.length,
      fileTree: filteredTree,
      packageJsonSnippet,
      wranglerConfigSnippet,
      existingMigrations: migrationSnippets,
      existingE2eTests,
      previousSpecSummary,
    };
  } catch {
    return null;
  }
}

export async function commitRevisionFeedbackToBranch(params: {
  owner: string;
  repo: string;
  branchName: string;
  markdownContent: string;
  prNumber?: number;
}): Promise<{ path: string; commitSha: string; htmlUrl: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法写入退回修改指令文件。');
  }
  const repoPath = `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`;
  const res = await upsertRepoFile({
    token,
    repoPath,
    owner: params.owner,
    repo: params.repo,
    baseBranch: params.branchName,
    filePath: 'docs/revision-feedback.md',
    content: params.markdownContent,
    createMessage: `chore(autodev): add revision feedback for PR #${params.prNumber || ''}`.trim(),
    updateMessage: `chore(autodev): update revision feedback for PR #${params.prNumber || ''}`.trim(),
  });
  return {
    path: res.path,
    commitSha: res.commitSha,
    htmlUrl: res.htmlUrl,
  };
}

export async function commitRsiGuidelinesToBranch(params: {
  owner: string;
  repo: string;
  branchName: string;
  markdownContent: string;
}): Promise<{ path: string; commitSha: string; htmlUrl: string; skipped?: boolean }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('服务端未配置 GITHUB_TOKEN，无法写入 RSI 自进化编码约束文档。');
  }
  const repoPath = `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`;
  const res = await upsertRepoFile({
    token,
    repoPath,
    owner: params.owner,
    repo: params.repo,
    baseBranch: params.branchName,
    filePath: 'docs/rsi-guidelines.md',
    content: params.markdownContent,
    createMessage: 'chore(autodev-rsi): inject active RSI engineering guardrails',
    updateMessage: 'chore(autodev-rsi): sync active RSI engineering guardrails',
  });
  return {
    path: res.path,
    commitSha: res.commitSha,
    htmlUrl: res.htmlUrl,
    skipped: res.skipped,
  };
}
