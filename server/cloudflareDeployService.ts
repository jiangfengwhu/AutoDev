import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PreviewDeployment } from '../src/types/autodev.ts';
import { buildPreviewResourceNames } from '../src/lib/iterationContext.ts';
import {
  buildTargetRepoNpmEnv,
  formatDeployCommandError,
  stripAnsi,
  type TargetRepoExecPhase,
} from '../src/lib/deploySanitizer.ts';
import { postGitHubPrComment } from './githubService.ts';

const execFileAsync = promisify(execFile);
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const TMP_PREFIX = 'autodev-cf-preview-';

interface CfEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

/**
 * Reads actual container memory limit from Linux cgroup v2/v1 (Cloud Run uses cgroups,
 * while os.totalmem() may report the underlying host VM RAM).
 */
function detectContainerMemoryBytes(): number {
  const candidates = [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf-8').trim();
      if (!raw || raw === 'max') continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 64 * 1024 * 1024 && parsed < 1024 * 1024 * 1024 * 1024) {
        return parsed;
      }
    } catch {
      // ignore non-Linux or restricted procfs
    }
  }
  return os.totalmem();
}

/**
 * Cleans up any stale temp directories left behind by a previously OOM-killed deploy
 * so Cloud Run's in-memory /tmp tmpfs does not accumulate leaked node_modules.
 */
function pruneStaleTmpDirs(): void {
  try {
    const tmpRoot = os.tmpdir();
    const now = Date.now();
    for (const entry of fs.readdirSync(tmpRoot)) {
      if (!entry.startsWith(TMP_PREFIX)) continue;
      const fullPath = path.join(tmpRoot, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > 10 * 60 * 1000) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      } catch {
        // ignore concurrent deletion
      }
    }
  } catch {
    // non-fatal
  }
}

async function cfApi<T>(
  token: string,
  apiPath: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${CLOUDFLARE_API_BASE}${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let parsed: CfEnvelope<T> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as CfEnvelope<T>) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok || !parsed?.success) {
    const detail =
      parsed?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API 错误 (${res.status}): ${detail}`);
  }
  return parsed.result as T;
}

async function ensureD1Database(
  token: string,
  accountId: string,
  databaseName: string
): Promise<{ id: string; name: string; created: boolean }> {
  try {
    const existing = await cfApi<Array<{ uuid: string; name: string }>>(
      token,
      `/accounts/${encodeURIComponent(accountId)}/d1/database`
    );
    const found = (existing || []).find((db) => db.name === databaseName);
    if (found) {
      return { id: found.uuid, name: found.name, created: false };
    }
    const created = await cfApi<{ uuid: string; name: string }>(
      token,
      `/accounts/${encodeURIComponent(accountId)}/d1/database`,
      {
        method: 'POST',
        body: JSON.stringify({ name: databaseName }),
      }
    );
    return { id: created.uuid, name: created.name, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('10000') || msg.includes('(401)') || msg.includes('(403)')) {
      throw new Error(
        `当前 CLOUDFLARE_API_TOKEN 缺少 D1 数据库权限，无法自动创建/绑定数据库「${databaseName}」。\n` +
          `请在 Cloudflare Dashboard -> My Profile -> API Tokens 为该 Token 勾选以下权限后重试：\n` +
          `1) Account -> Workers Scripts -> Edit\n` +
          `2) Account -> D1 -> Edit\n` +
          `3) Account -> Account Settings -> Read`
      );
    }
    throw err;
  }
}

async function getWorkersSubdomain(token: string, accountId: string): Promise<string | null> {
  try {
    const res = await cfApi<{ subdomain?: string }>(
      token,
      `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`
    );
    return res?.subdomain || null;
  } catch {
    return null;
  }
}

async function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
  timeoutMs = 300_000,
  phase: TargetRepoExecPhase = 'wrangler',
  options?: { containerMemoryBytes?: number; npmCacheDir?: string }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 12 * 1024 * 1024,
      env: buildTargetRepoNpmEnv(process.env, phase, extraEnv, options),
    });
    return { stdout: stripAnsi(stdout ?? ''), stderr: stripAnsi(stderr ?? '') };
  } catch (err) {
    throw new Error(formatDeployCommandError(err, `命令执行失败：${cmd} ${args.join(' ')}`));
  }
}

export async function deployBranchPreviewToCloudflare(params: {
  owner: string;
  repo: string;
  branchName: string;
  workerNameOverride?: string;
  prNumber?: number;
  mode?: 'preview' | 'production';
}): Promise<{ deployment: PreviewDeployment; deployLogTail: string }> {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const ghToken = process.env.GITHUB_TOKEN?.trim();

  if (!cfToken || !cfAccountId) {
    throw new Error(
      '服务端未配置 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID，无法执行 Cloudflare Workers 预览部署。'
    );
  }

  const { owner, repo, branchName, workerNameOverride, prNumber } = params;
  const isIsolatedPreview =
    params.mode ? params.mode === 'preview' : branchName !== 'main' && branchName !== 'master';

  pruneStaleTmpDirs();

  const containerMemoryBytes = detectContainerMemoryBytes();
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  const tarballPath = path.join(tmpBase, 'repo.tar.gz');
  const npmCacheDir = path.join(tmpBase, 'npm-cache');
  const workDir = path.join(tmpBase, 'src');
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // 1. Download GitHub branch tarball and immediately delete archive after extracting to save tmpfs RAM
    const tarUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/tarball/${encodeURIComponent(branchName)}`;
    const tarHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AutoDev-Studio-Control-Plane',
    };
    if (ghToken) {
      tarHeaders.Authorization = `Bearer ${ghToken}`;
    }

    const tarRes = await fetch(tarUrl, { headers: tarHeaders, redirect: 'follow' });
    if (!tarRes.ok) {
      throw new Error(`拉取分支 ${branchName} 代码压缩包失败 (HTTP ${tarRes.status})`);
    }
    const tarBuf = Buffer.from(await tarRes.arrayBuffer());
    fs.writeFileSync(tarballPath, tarBuf);

    await runCmd('tar', ['-xzf', tarballPath, '-C', workDir, '--strip-components=1'], tmpBase);
    fs.rmSync(tarballPath, { force: true });

    // 2. Inspect wrangler.toml
    const wranglerTomlPath = path.join(workDir, 'wrangler.toml');
    if (!fs.existsSync(wranglerTomlPath)) {
      throw new Error(
        `分支 ${branchName} 根目录未找到 wrangler.toml，请确认 AGY 已完成 Cloudflare Workers 构建并推送到该分支。`
      );
    }

    let toml = fs.readFileSync(wranglerTomlPath, 'utf-8');
    const nameMatch = toml.match(/^\s*name\s*=\s*"([^"]+)"/m);
    const baseProdWorkerName = (nameMatch?.[1] || repo)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');

    const d1NameMatch = toml.match(/database_name\s*=\s*"([^"]+)"/);
    const d1IdMatch = toml.match(/database_id\s*=\s*"([^"]+)"/);

    const previewNames = buildPreviewResourceNames(baseProdWorkerName, d1NameMatch?.[1]);

    const workerName = workerNameOverride?.trim()
      ? workerNameOverride
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
      : isIsolatedPreview
        ? previewNames.previewWorkerName
        : baseProdWorkerName;

    // Rewrite worker name in temp wrangler.toml for isolated preview deploys
    if (nameMatch && workerName !== nameMatch[1]) {
      toml = toml.replace(/^(\s*name\s*=\s*)"[^"]+"/m, `$1"${workerName}"`);
    }

    // Auto-provision D1 database:
    // - In isolated preview mode, ALWAYS isolate into <dbName>-preview so production D1 is never mutated!
    // - In production mode, auto-provision if wrangler.toml has a placeholder UUID.
    let d1DatabaseName: string | undefined;
    let d1DatabaseId: string | undefined;
    let migrationsApplied = false;

    if (d1NameMatch) {
      const targetD1Name =
        isIsolatedPreview && previewNames.previewD1Name
          ? previewNames.previewD1Name
          : d1NameMatch[1];
      d1DatabaseName = targetD1Name;

      const currentId = d1IdMatch?.[1] || '';
      const isPlaceholder =
        !currentId ||
        /^0+(-0+)*$/.test(currentId) ||
        currentId.toLowerCase().includes('placeholder') ||
        currentId.toLowerCase().includes('replace');

      if (isIsolatedPreview || isPlaceholder) {
        const ensured = await ensureD1Database(cfToken, cfAccountId, targetD1Name);
        d1DatabaseId = ensured.id;
        toml = toml.replace(
          /database_name\s*=\s*"[^"]+"/,
          `database_name = "${targetD1Name}"`
        );
        if (d1IdMatch) {
          toml = toml.replace(
            /database_id\s*=\s*"[^"]+"/,
            `database_id = "${ensured.id}"`
          );
        } else {
          toml = toml.replace(
            /(database_name\s*=\s*"[^"]+")/,
            `$1\ndatabase_id = "${ensured.id}"`
          );
        }
      } else {
        d1DatabaseId = currentId;
      }
    }

    fs.writeFileSync(wranglerTomlPath, toml, 'utf-8');

    // 3. Install dependencies & build frontend assets with aggressive tmpfs RAM cleanup
    const cfEnv = {
      CLOUDFLARE_API_TOKEN: cfToken,
      CLOUDFLARE_ACCOUNT_ID: cfAccountId,
      WRANGLER_SEND_METRICS: 'false',
    };

    const execOpts = { containerMemoryBytes, npmCacheDir };

    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const hasLock = fs.existsSync(path.join(workDir, 'package-lock.json'));
      const runCleanInstall = async () => {
        fs.rmSync(path.join(workDir, 'package-lock.json'), { force: true });
        fs.rmSync(path.join(workDir, 'node_modules'), { recursive: true, force: true });
        fs.rmSync(npmCacheDir, { recursive: true, force: true });
        await runCmd(
          'npm',
          ['install', '--include=dev', '--no-audit', '--no-fund', '--progress=false', '--loglevel=error'],
          workDir,
          cfEnv,
          300_000,
          'install',
          execOpts
        );
      };

      try {
        await runCmd(
          'npm',
          hasLock
            ? ['ci', '--include=dev', '--no-audit', '--no-fund', '--progress=false', '--loglevel=error']
            : ['install', '--include=dev', '--no-audit', '--no-fund', '--progress=false', '--loglevel=error'],
          workDir,
          cfEnv,
          300_000,
          'install',
          execOpts
        );
      } catch (installErr) {
        const msg = installErr instanceof Error ? installErr.message : '';
        // Do not retry blindly if killed by OOM (SIGKILL) — fail fast with clear OOM diagnostics
        if (msg.includes('SIGKILL') || msg.includes('137')) {
          throw installErr;
        }
        // Fallback: clear package-lock if lockfile misses platform optional deps
        await runCleanInstall();
      }

      // Sanity check: ensure devDependencies (e.g. vite) were actually installed
      const declaredVite = Boolean(pkg?.devDependencies?.vite || pkg?.dependencies?.vite);
      if (declaredVite && !fs.existsSync(path.join(workDir, 'node_modules', 'vite', 'package.json'))) {
        await runCleanInstall();
      }

      // Immediately purge npm cache directory from /tmp tmpfs BEFORE starting Vite build!
      // Reclaims ~100-250 MiB of RAM on Cloud Run containers.
      fs.rmSync(npmCacheDir, { recursive: true, force: true });

      if (pkg?.scripts?.['build:client']) {
        await runCmd('npm', ['run', 'build:client'], workDir, cfEnv, 240_000, 'build', {
          containerMemoryBytes,
        });
      } else if (pkg?.scripts?.build) {
        await runCmd('npm', ['run', 'build'], workDir, cfEnv, 240_000, 'build', {
          containerMemoryBytes,
        });
      }

      // Free any build cache before wrangler bundles & uploads Worker
      fs.rmSync(path.join(workDir, 'node_modules', '.vite'), { recursive: true, force: true });
      fs.rmSync(path.join(workDir, 'node_modules', '.cache'), { recursive: true, force: true });
    }

    // Resolve wrangler CLI (prefer local node_modules/.bin/wrangler)
    const localWrangler = path.join(workDir, 'node_modules', '.bin', 'wrangler');
    const runWrangler = async (args: string[]) => {
      if (fs.existsSync(localWrangler)) {
        return runCmd(localWrangler, args, workDir, cfEnv, 240_000, 'wrangler', {
          containerMemoryBytes,
        });
      }
      return runCmd('npx', ['--yes', 'wrangler', ...args], workDir, cfEnv, 240_000, 'wrangler', {
        containerMemoryBytes,
      });
    };

    // 4. Apply D1 migrations remotely if migrations/ directory exists
    const migrationsDir = path.join(workDir, 'migrations');
    if (d1DatabaseName && fs.existsSync(migrationsDir)) {
      const sqlFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
      if (sqlFiles.length > 0) {
        await runWrangler(['d1', 'migrations', 'apply', d1DatabaseName, '--remote']);
        migrationsApplied = true;
      }
    }

    // 5. Deploy to Cloudflare Workers!
    const deployArgs = ['deploy', '--name', workerName];
    const deployRes = await runWrangler(deployArgs);
    const combinedOutput = `${deployRes.stdout}\n${deployRes.stderr}`.trim();

    // Parse live https://*.workers.dev URL from wrangler output
    const urlMatch = combinedOutput.match(/https:\/\/[a-zA-Z0-9._-]+\.workers\.dev\b/);
    let liveUrl = urlMatch?.[0] || '';
    if (!liveUrl) {
      const subdomain = await getWorkersSubdomain(cfToken, cfAccountId);
      if (subdomain) {
        liveUrl = `https://${workerName}.${subdomain}.workers.dev`;
      } else {
        throw new Error(`wrangler deploy 完成但未能解析 workers.dev 网址。\n${combinedOutput.slice(-600)}`);
      }
    }

    const deployment: PreviewDeployment = {
      url: liveUrl,
      workerName,
      branchName,
      deployedAt: new Date().toISOString(),
      d1DatabaseName,
      d1DatabaseId,
      migrationsApplied,
      commitSha: crypto.createHash('sha1').update(`${branchName}:${Date.now()}`).digest('hex').slice(0, 7),
      isIsolatedPreview,
    };

    // 6. Best-effort comment on Draft PR with clickable preview URL
    if (prNumber && ghToken) {
      try {
        await postGitHubPrComment({
          owner,
          repo,
          prNumber,
          body: [
            `### AutoDev Studio — Cloudflare Workers ${isIsolatedPreview ? '隔离预览环境' : '生产环境'}已就绪`,
            `- **在线验收网址**: ${liveUrl}`,
            `- **Worker 名称**: \`${workerName}\`${isIsolatedPreview ? '（独立预览实例，不影响线上正式环境）' : ''}`,
            `- **部署分支**: \`${branchName}\``,
            ...(d1DatabaseName
              ? [
                  `- **Cloudflare D1 数据库**: \`${d1DatabaseName}\`（${
                    migrationsApplied ? '迁移已自动执行' : '已绑定'
                  }${isIsolatedPreview ? ' · 预览隔离库' : ''}）`,
                ]
              : []),
            `- **部署时间**: ${deployment.deployedAt}`,
          ].join('\n'),
        });
      } catch {
        // Non-fatal
      }
    }

    return {
      deployment,
      deployLogTail: combinedOutput.split('\n').slice(-35).join('\n'),
    };
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

/**
 * Uploads or updates a Cloudflare Worker secret binding via the Cloudflare Workers REST API.
 */
export async function putCloudflareWorkerSecret(params: {
  workerName: string;
  secretName: string;
  secretValue: string;
}): Promise<{ ok: true; workerName: string; secretName: string }> {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!cfToken || !cfAccountId) {
    throw new Error('服务端未配置 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID，无法写入 Worker Secret。');
  }
  await cfApi(
    cfToken,
    `/accounts/${encodeURIComponent(cfAccountId)}/workers/scripts/${encodeURIComponent(params.workerName)}/secrets`,
    {
      method: 'PUT',
      body: JSON.stringify({
        name: params.secretName,
        text: params.secretValue,
        type: 'secret_text',
      }),
    }
  );
  return { ok: true, workerName: params.workerName, secretName: params.secretName };
}

let cachedWorkerSubdomain: string | null = null;

export async function resolveCloudflareWorkerUrl(workerName: string): Promise<string | null> {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!cfToken || !cfAccountId) return null;
  if (!cachedWorkerSubdomain) {
    cachedWorkerSubdomain = await getWorkersSubdomain(cfToken, cfAccountId);
  }
  if (!cachedWorkerSubdomain) return null;
  return `https://${workerName}.${cachedWorkerSubdomain}.workers.dev`;
}

