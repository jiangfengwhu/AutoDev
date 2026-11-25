// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/**
 * Strips ANSI terminal escape codes (colors, cursor sequences) so error details
 * stay clean and valid in Web UI toasts, audit logs, and Feishu interactive cards.
 */
export function stripAnsi(input: string): string {
  if (!input) return '';
  return input
    .replace(ANSI_ESCAPE_RE, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

const NPM_PROD_FILTER_ENV_KEYS = [
  'NODE_ENV',
  'npm_config_production',
  'NPM_CONFIG_PRODUCTION',
  'npm_config_omit',
  'NPM_CONFIG_OMIT',
  'npm_config_only',
  'NPM_CONFIG_ONLY',
  'YARN_PRODUCTION',
] as const;

export type TargetRepoExecPhase = 'install' | 'build' | 'wrangler';

/**
 * Computes a conservative V8 --max-old-space-size (in MiB) for child npm/vite/wrangler processes
 * so they trigger garbage collection early instead of getting SIGKILLed by Cloud Run's OOM killer.
 */
export function computeSafeNodeHeapMb(
  containerMemoryBytes: number,
  phase: TargetRepoExecPhase
): number {
  const containerMb = Math.floor(containerMemoryBytes / (1024 * 1024));
  if (!Number.isFinite(containerMb) || containerMb <= 0) {
    return phase === 'install' ? 320 : 384;
  }
  if (containerMb <= 600) {
    // 512 MiB Cloud Run container: leave room for control plane + tmpfs node_modules
    return phase === 'install' ? 224 : 256;
  }
  if (containerMb <= 1152) {
    // 1 GiB Cloud Run container
    return phase === 'install' ? 320 : 448;
  }
  const ratio = phase === 'install' ? 0.35 : 0.45;
  return Math.max(384, Math.min(1536, Math.floor(containerMb * ratio)));
}

/**
 * Builds an isolated environment map for executing npm / Vite / Wrangler commands
 * against a target repository inside a production Cloud Run container.
 *
 * Crucially:
 * - During `install`, Cloud Run's own `NODE_ENV=production` is stripped and overridden to
 *   `development` (without setting deprecated `npm_config_production`, avoiding npm v10+ warnings),
 *   so `--include=dev` installs `vite`, `@vitejs/plugin-react`, `typescript`, and `wrangler`.
 * - Caps V8 heap (`NODE_OPTIONS`), libuv threads, and esbuild Go threads (`GOMAXPROCS`) to
 *   prevent OOM `SIGKILL` spikes inside memory-constrained Cloud Run containers.
 */
export function buildTargetRepoNpmEnv(
  baseEnv: Record<string, string | undefined>,
  phase: TargetRepoExecPhase,
  extraEnv: Record<string, string> = {},
  options?: { containerMemoryBytes?: number; npmCacheDir?: string }
): Record<string, string> {
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  for (const key of NPM_PROD_FILTER_ENV_KEYS) {
    delete cleanEnv[key];
  }

  cleanEnv.CI = 'true';
  cleanEnv.NO_COLOR = '1';
  cleanEnv.FORCE_COLOR = '0';
  cleanEnv.UV_THREADPOOL_SIZE = '2';

  const heapMb = computeSafeNodeHeapMb(
    options?.containerMemoryBytes ?? 1024 * 1024 * 1024,
    phase
  );
  const existingNodeOpts = (cleanEnv.NODE_OPTIONS || '')
    .replace(/--max-old-space-size=\d+/g, '')
    .trim();
  cleanEnv.NODE_OPTIONS = [existingNodeOpts, `--max-old-space-size=${heapMb}`]
    .filter(Boolean)
    .join(' ');

  if (options?.npmCacheDir) {
    cleanEnv.npm_config_cache = options.npmCacheDir;
  }

  if (phase === 'install') {
    cleanEnv.NODE_ENV = 'development';
    cleanEnv.npm_config_audit = 'false';
    cleanEnv.npm_config_fund = 'false';
    cleanEnv.npm_config_progress = 'false';
    cleanEnv.npm_config_maxsockets = '4';
  } else if (phase === 'build') {
    cleanEnv.NODE_ENV = 'production';
    cleanEnv.GOMAXPROCS = '2';
  } else {
    cleanEnv.WRANGLER_SEND_METRICS = 'false';
  }

  return {
    ...cleanEnv,
    ...extraEnv,
  };
}

/**
 * Formats a child_process execFile error with ANSI codes stripped, explicit OOM / timeout signal
 * diagnostics, and combined stderr + stdout tail so root causes are never hidden.
 */
export function formatDeployCommandError(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') {
    return stripAnsi(String(err || fallback)) || fallback;
  }
  const e = err as {
    message?: string;
    stderr?: string;
    stdout?: string;
    signal?: string | null;
    killed?: boolean;
    code?: number | string | null;
  };
  const stderrClean = stripAnsi(typeof e.stderr === 'string' ? e.stderr : '');
  const stdoutClean = stripAnsi(typeof e.stdout === 'string' ? e.stdout : '');
  const msgClean = stripAnsi(typeof e.message === 'string' ? e.message : '');

  const signal = typeof e.signal === 'string' && e.signal ? e.signal : '';
  const codeNum = typeof e.code === 'number' ? e.code : null;

  let diagnosticHint = '';
  if (signal === 'SIGKILL' || codeNum === 137) {
    diagnosticHint =
      '[进程被系统强制终止 SIGKILL/137：Cloud Run 容器内存不足 OOM，请在 Cloud Run 服务配置中将内存调大至 1Gi/2Gi]';
  } else if (e.killed && signal === 'SIGTERM') {
    diagnosticHint =
      '[命令执行超时被终止 SIGTERM：可能是容器后台 CPU 限频或依赖下载过慢，建议在 Cloud Run 开启「始终分配 CPU」或重试]';
  } else if (signal) {
    diagnosticHint = `[进程收到终止信号 ${signal}]`;
  } else if (codeNum !== null && codeNum !== 0) {
    diagnosticHint = `[退出码 ${codeNum}]`;
  }

  const combinedLines: string[] = [];
  if (stderrClean) {
    combinedLines.push(
      ...stderrClean
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(-14)
    );
  }
  if (stdoutClean) {
    const outTail = stdoutClean
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .slice(-10);
    for (const line of outTail) {
      if (!combinedLines.includes(line)) {
        combinedLines.push(line);
      }
    }
  }

  const firstLine = msgClean.split(/\r?\n/)[0] || fallback;
  const header = diagnosticHint ? `${firstLine} ${diagnosticHint}` : firstLine;
  const tail = combinedLines.slice(-16).join('\n');

  if (tail && !header.includes(tail.slice(0, 60))) {
    return `${header}\n${tail}`.slice(0, 1400);
  }
  return header.slice(0, 1400);
}
