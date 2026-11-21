import type {
  CloudflareIntegrationStatus,
  CloudflareKvNamespace,
  CloudflareWorker,
  CloudflareWorkflow,
} from '../src/types/autodev';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
  result?: T;
}

function maskAccountId(accountId: string): string {
  if (accountId.length <= 8) {
    return `${accountId.slice(0, 2)}***${accountId.slice(-2)}`;
  }
  return `${accountId.slice(0, 4)}…${accountId.slice(-4)}`;
}

async function cfRequest<T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<CloudflareEnvelope<T>> {
  const response = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let parsed: CloudflareEnvelope<T> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as CloudflareEnvelope<T>;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok || !parsed?.success) {
    const cfErr =
      parsed?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ||
      `HTTP ${response.status}`;
    throw new Error(`Cloudflare API 错误 (${response.status}): ${cfErr}`);
  }

  return parsed;
}

export async function checkCloudflareIntegration(): Promise<CloudflareIntegrationStatus> {
  const checkedAt = new Date().toISOString();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (!token || !accountId) {
    const missing: string[] = [];
    if (!token) missing.push('CLOUDFLARE_API_TOKEN');
    if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
    return {
      configured: false,
      connected: false,
      error: `未检测到服务端环境变量 ${missing.join('、')}，请在 Secrets 面板完成配置。`,
      workers: [],
      workflows: [],
      kvNamespaces: [],
      checkedAt,
    };
  }

  const encodedAccount = encodeURIComponent(accountId);
  const warnings: string[] = [];
  let tokenStatus: string | undefined;

  // Verify token validity first (support both account-owned and user-owned API tokens)
  try {
    const verifyRes = await cfRequest<{ status?: string }>(
      token,
      `/accounts/${encodedAccount}/tokens/verify`
    );
    tokenStatus = verifyRes.result?.status || 'active';
  } catch {
    try {
      const userVerify = await cfRequest<{ status?: string }>(token, `/user/tokens/verify`);
      tokenStatus = userVerify.result?.status || 'active';
    } catch (verifyErr) {
      return {
        configured: true,
        connected: false,
        accountIdMasked: maskAccountId(accountId),
        error:
          verifyErr instanceof Error
            ? verifyErr.message
            : 'Cloudflare API Token 校验失败',
        workers: [],
        workflows: [],
        kvNamespaces: [],
        checkedAt,
      };
    }
  }

  // Fetch Workers, Workflows, and KV Namespaces in parallel
  const [workersRes, workflowsRes, kvRes] = await Promise.allSettled([
    cfRequest<Array<{ id: string; modified_on?: string; usage_model?: string }>>(
      token,
      `/accounts/${encodedAccount}/workers/scripts`
    ),
    cfRequest<
      Array<{
        name: string;
        script_name?: string;
        class_name?: string;
        created_on?: string;
        modified_on?: string;
      }>
    >(token, `/accounts/${encodedAccount}/workflows`),
    cfRequest<Array<{ id: string; title: string; supports_url_encoding?: boolean }>>(
      token,
      `/accounts/${encodedAccount}/storage/kv/namespaces?per_page=50`
    ),
  ]);

  let workers: CloudflareWorker[] = [];
  let workflows: CloudflareWorkflow[] = [];
  let kvNamespaces: CloudflareKvNamespace[] = [];

  if (workersRes.status === 'fulfilled' && Array.isArray(workersRes.value.result)) {
    workers = workersRes.value.result.map((w) => ({
      id: w.id,
      name: w.id,
      modifiedOn: w.modified_on,
      usageModel: w.usage_model,
    }));
  } else if (workersRes.status === 'rejected') {
    warnings.push(`Workers 列表拉取受限：${workersRes.reason?.message || '权限不足'}`);
  }

  if (workflowsRes.status === 'fulfilled' && Array.isArray(workflowsRes.value.result)) {
    workflows = workflowsRes.value.result.map((wf) => ({
      name: wf.name,
      scriptName: wf.script_name,
      className: wf.class_name,
      createdOn: wf.created_on,
      modifiedOn: wf.modified_on,
    }));
  } else if (workflowsRes.status === 'rejected') {
    warnings.push(`Workflows 列表拉取受限：${workflowsRes.reason?.message || '权限不足'}`);
  }

  if (kvRes.status === 'fulfilled' && Array.isArray(kvRes.value.result)) {
    kvNamespaces = kvRes.value.result.map((kv) => ({
      id: kv.id,
      title: kv.title,
      supportsUrlEncoding: kv.supports_url_encoding,
    }));
  } else if (kvRes.status === 'rejected') {
    warnings.push(`KV Namespaces 列表拉取受限：${kvRes.reason?.message || '权限不足'}`);
  }

  const allFailed =
    workersRes.status === 'rejected' &&
    workflowsRes.status === 'rejected' &&
    kvRes.status === 'rejected';

  if (allFailed) {
    return {
      configured: true,
      connected: false,
      accountIdMasked: maskAccountId(accountId),
      tokenStatus,
      error: `Token 有效但无法读取 Account (${maskAccountId(accountId)}) 资源，请确认 CLOUDFLARE_ACCOUNT_ID 及 Token 权限（Workers Scripts / Workflows / Workers KV Storage Read）。`,
      warnings,
      workers: [],
      workflows: [],
      kvNamespaces: [],
      checkedAt,
    };
  }

  return {
    configured: true,
    connected: true,
    accountIdMasked: maskAccountId(accountId),
    tokenStatus,
    warnings: warnings.length > 0 ? warnings : undefined,
    workers,
    workflows,
    kvNamespaces,
    checkedAt,
  };
}

interface RawPagesProject {
  name: string;
  subdomain?: string;
  source?: {
    config?: {
      repo_name?: string;
      owner?: string;
    };
  };
}

interface RawPagesDeployment {
  id: string;
  url?: string;
  environment?: string;
  created_on?: string;
  deployment_trigger?: {
    metadata?: {
      branch?: string;
    };
  };
  latest_stage?: {
    name?: string;
    status?: string;
  };
}

export async function getCloudflareDeploymentStatus(params: {
  repoName: string;
  branchName: string;
  workerNameOverride?: string;
}): Promise<{
  pages: {
    connected: boolean;
    projectName?: string;
    latestDeployment: {
      id: string;
      projectName: string;
      url: string;
      environment: string;
      branch?: string;
      status: string;
      stageName?: string;
      createdOn?: string;
    } | null;
    error?: string;
  };
  worker: {
    connected: boolean;
    deployment: {
      workerName: string;
      url: string;
      modifiedOn?: string;
      branchName?: string;
    } | null;
    error?: string;
  };
}> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (!token || !accountId) {
    const err = '未配置 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID';
    return {
      pages: { connected: false, latestDeployment: null, error: err },
      worker: { connected: false, deployment: null, error: err },
    };
  }

  const encodedAccount = encodeURIComponent(accountId);
  const normalizedRepo = params.repoName.toLowerCase();
  const preferredWorkerName = (params.workerNameOverride || params.repoName).toLowerCase();

  // Query Cloudflare Pages & Workers in parallel
  const [pagesResult, workersResult, subdomainResult] = await Promise.allSettled([
    cfRequest<RawPagesProject[]>(token, `/accounts/${encodedAccount}/pages/projects`),
    cfRequest<Array<{ id: string; modified_on?: string }>>(
      token,
      `/accounts/${encodedAccount}/workers/scripts`
    ),
    cfRequest<{ subdomain?: string }>(token, `/accounts/${encodedAccount}/workers/subdomain`),
  ]);

  // 1. Parse Cloudflare Pages
  let pages: {
    connected: boolean;
    projectName?: string;
    latestDeployment: {
      id: string;
      projectName: string;
      url: string;
      environment: string;
      branch?: string;
      status: string;
      stageName?: string;
      createdOn?: string;
    } | null;
    error?: string;
  } = {
    connected: false,
    latestDeployment: null,
  };

  if (pagesResult.status === 'fulfilled' && Array.isArray(pagesResult.value.result)) {
    pages.connected = true;
    const projects = pagesResult.value.result;
    const matchedProject =
      projects.find(
        (p) =>
          p.name.toLowerCase() === normalizedRepo ||
          p.source?.config?.repo_name?.toLowerCase() === normalizedRepo
      ) ?? projects[0];

    if (matchedProject) {
      pages.projectName = matchedProject.name;
      try {
        const depsRes = await cfRequest<RawPagesDeployment[]>(
          token,
          `/accounts/${encodedAccount}/pages/projects/${encodeURIComponent(matchedProject.name)}/deployments?per_page=10`
        );
        const deps = Array.isArray(depsRes.result) ? depsRes.result : [];
        const matchedDep =
          deps.find((d) => d.deployment_trigger?.metadata?.branch === params.branchName) ??
          deps[0];
        if (matchedDep) {
          pages.latestDeployment = {
            id: matchedDep.id,
            projectName: matchedProject.name,
            url:
              matchedDep.url ||
              (matchedProject.subdomain ? `https://${matchedProject.subdomain}` : ''),
            environment: matchedDep.environment || 'preview',
            branch: matchedDep.deployment_trigger?.metadata?.branch,
            status: matchedDep.latest_stage?.status || 'success',
            stageName: matchedDep.latest_stage?.name,
            createdOn: matchedDep.created_on,
          };
        }
      } catch (depErr) {
        pages.error = depErr instanceof Error ? depErr.message : '读取 Pages 部署记录失败';
      }
    }
  } else if (pagesResult.status === 'rejected') {
    const msg = pagesResult.reason instanceof Error ? pagesResult.reason.message : '';
    pages = {
      connected: false,
      latestDeployment: null,
      error: msg.includes('401') || msg.includes('403') ? 'Token 未开通 Pages 读取权限' : msg,
    };
  }

  // 2. Parse Cloudflare Workers
  let worker: {
    connected: boolean;
    deployment: {
      workerName: string;
      url: string;
      modifiedOn?: string;
      branchName?: string;
    } | null;
    error?: string;
  } = {
    connected: false,
    deployment: null,
  };

  if (workersResult.status === 'fulfilled' && Array.isArray(workersResult.value.result)) {
    worker.connected = true;
    const scripts = workersResult.value.result;
    const matchedScript =
      scripts.find((s) => s.id.toLowerCase() === preferredWorkerName) ??
      scripts.find((s) => s.id.toLowerCase() === normalizedRepo) ??
      null;

    const subdomain =
      subdomainResult.status === 'fulfilled' ? subdomainResult.value.result?.subdomain : undefined;

    if (matchedScript && subdomain) {
      worker.deployment = {
        workerName: matchedScript.id,
        url: `https://${matchedScript.id}.${subdomain}.workers.dev`,
        modifiedOn: matchedScript.modified_on,
        branchName: params.branchName,
      };
    }
  } else if (workersResult.status === 'rejected') {
    worker = {
      connected: false,
      deployment: null,
      error:
        workersResult.reason instanceof Error ? workersResult.reason.message : '读取 Workers 状态失败',
    };
  }

  return { pages, worker };
}

const DEFAULT_ATD_D1_NAMES = ['community_db', 'community_db-preview'];

export async function wipeCloudflareD1Databases(
  targetNames: string[] = DEFAULT_ATD_D1_NAMES
): Promise<{
  connected: boolean;
  databases: Array<{
    name: string;
    uuid: string;
    droppedTables: string[];
    error?: string;
  }>;
  error?: string;
}> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    return {
      connected: false,
      databases: [],
      error: '未配置 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID',
    };
  }

  const normalizedTargets = Array.from(
    new Set(targetNames.map((n) => n.trim()).filter(Boolean))
  );
  if (normalizedTargets.length === 0) {
    return {
      connected: true,
      databases: [],
      error: '安全保护：必须显式指定要清理的目标 D1 数据库名称，禁止全账号通配清空。',
    };
  }

  const encodedAccount = encodeURIComponent(accountId);
  try {
    const listRes = await cfRequest<Array<{ uuid: string; name: string }>>(
      token,
      `/accounts/${encodedAccount}/d1/database`
    );
    const allDbs = Array.isArray(listRes.result) ? listRes.result : [];
    const targetDbs = allDbs.filter((db) => normalizedTargets.includes(db.name));

    const results: Array<{
      name: string;
      uuid: string;
      droppedTables: string[];
      error?: string;
    }> = [];

    for (const db of targetDbs) {
      const droppedTables: string[] = [];
      try {
        const queryUrl = `/accounts/${encodedAccount}/d1/database/${encodeURIComponent(db.uuid)}/query`;
        const tablesRes = await cfRequest<
          Array<{ results?: Array<{ name?: string }> }>
        >(token, queryUrl, {
          method: 'POST',
          body: JSON.stringify({
            sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';",
          }),
        });

        const tableNames = (tablesRes.result?.[0]?.results || [])
          .map((row) => String(row.name || '').trim())
          .filter(Boolean);

        if (tableNames.length > 0) {
          const dropStatements = tableNames.map(
            (t) => `DROP TABLE IF EXISTS "${t.replace(/"/g, '""')}";`
          );
          try {
            await cfRequest<unknown>(token, queryUrl, {
              method: 'POST',
              body: JSON.stringify({
                sql: ['PRAGMA foreign_keys = OFF;', 'PRAGMA defer_foreign_keys = ON;', ...dropStatements].join(' '),
              }),
            });
            droppedTables.push(...tableNames);
          } catch {
            // Fallback: iteratively drop tables in dependency-tolerant passes
            let remaining = [...tableNames];
            for (let pass = 0; pass < tableNames.length + 1 && remaining.length > 0; pass++) {
              const nextRemaining: string[] = [];
              let droppedThisPass = 0;
              for (const table of remaining) {
                try {
                  await cfRequest<unknown>(token, queryUrl, {
                    method: 'POST',
                    body: JSON.stringify({
                      sql: `PRAGMA defer_foreign_keys = ON; DROP TABLE IF EXISTS "${table.replace(/"/g, '""')}";`,
                    }),
                  });
                  droppedTables.push(table);
                  droppedThisPass++;
                } catch {
                  nextRemaining.push(table);
                }
              }
              if (droppedThisPass === 0) break;
              remaining = nextRemaining;
            }
            if (remaining.length > 0) {
              throw new Error(`以下表未能删除（可能存在外键约束）：${remaining.join(', ')}`);
            }
          }
        }

        results.push({ name: db.name, uuid: db.uuid, droppedTables });
      } catch (dbErr) {
        results.push({
          name: db.name,
          uuid: db.uuid,
          droppedTables,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }
    }

    return { connected: true, databases: results };
  } catch (err) {
    return {
      connected: false,
      databases: [],
      error: err instanceof Error ? err.message : '清理 Cloudflare D1 数据库失败',
    };
  }
}


