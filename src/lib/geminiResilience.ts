/**
 * Pure, testable resilience utilities for Gemini API calls:
 * - Detects transient upstream failures (503 UNAVAILABLE / high demand, 429 rate limits, 5xx, network resets)
 * - Retries with exponential backoff + jitter
 * - Falls back seamlessly across real Gemini models (never mocked outputs)
 * - Formats raw Google API JSON error payloads into clean Simplified Chinese user messages
 */

export interface GeminiRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

export interface GeminiModelFallbackOptions extends GeminiRetryOptions {
  retriesPerModel?: number;
  onFallback?: (info: { fromModel: string; toModel: string; error: unknown }) => void;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ParsedApiErrorBody {
  code?: number;
  status?: string;
  message?: string;
}

function extractRawErrorText(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err ?? '');
}

function tryParseEmbeddedApiError(raw: string): ParsedApiErrorBody | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      error?: ParsedApiErrorBody;
      code?: number;
      status?: string;
      message?: string;
    };
    const inner = parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed;
    if (!inner || typeof inner !== 'object') return null;
    return {
      code: typeof inner.code === 'number' ? inner.code : undefined,
      status: typeof inner.status === 'string' ? inner.status : undefined,
      message: typeof inner.message === 'string' ? inner.message : undefined,
    };
  } catch {
    return null;
  }
}

export function extractErrorStatusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.status === 'number') return rec.status;
    if (typeof rec.statusCode === 'number') return rec.statusCode;
    if (typeof rec.code === 'number') return rec.code;
  }
  const raw = extractRawErrorText(err);
  const embedded = tryParseEmbeddedApiError(raw);
  if (embedded?.code) return embedded.code;
  const codeMatch = raw.match(/\b(401|403|404|408|429|500|502|503|504)\b/);
  return codeMatch ? Number(codeMatch[1]) : undefined;
}

export function isTransientGeminiError(err: unknown): boolean {
  const code = extractErrorStatusCode(err);
  if (code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504) {
    return true;
  }
  const raw = extractRawErrorText(err);
  const embedded = tryParseEmbeddedApiError(raw);
  const haystack = `${raw} ${embedded?.status || ''} ${embedded?.message || ''}`.toLowerCase();

  return (
    haystack.includes('unavailable') ||
    haystack.includes('high demand') ||
    haystack.includes('overloaded') ||
    haystack.includes('temporarily unavailable') ||
    haystack.includes('resource_exhausted') ||
    haystack.includes('rate limit') ||
    haystack.includes('too many requests') ||
    haystack.includes('deadline_exceeded') ||
    haystack.includes('internal error') ||
    haystack.includes('econnreset') ||
    haystack.includes('etimedout') ||
    haystack.includes('econnrefused') ||
    haystack.includes('socket hang up') ||
    haystack.includes('fetch failed') ||
    haystack.includes('network error')
  );
}

export function formatFriendlyGeminiError(err: unknown, fallbackLabel = 'AI 模型调用失败'): string {
  const raw = extractRawErrorText(err).trim();
  const embedded = tryParseEmbeddedApiError(raw);
  const code = extractErrorStatusCode(err);
  const haystack = `${raw} ${embedded?.status || ''} ${embedded?.message || ''}`.toLowerCase();

  if (
    code === 503 ||
    haystack.includes('unavailable') ||
    haystack.includes('high demand') ||
    haystack.includes('overloaded')
  ) {
    return 'Gemini 模型当前访问高峰暂时繁忙（503），系统已自动重试并尝试切换备用模型，请等待 10–30 秒后重试。';
  }

  if (code === 429 || haystack.includes('resource_exhausted') || haystack.includes('rate limit')) {
    return 'Gemini API 触发临时限流保护（429），请稍候 15–30 秒后再试。';
  }

  if (code === 401 || code === 403 || haystack.includes('api_key_invalid') || haystack.includes('permission_denied')) {
    return 'Gemini API 鉴权失败，请检查服务端 GEMINI_API_KEY 配置是否有效。';
  }

  if (code === 500 || code === 502 || code === 504 || haystack.includes('deadline_exceeded')) {
    return `Gemini 上游服务出现临时抖动（${code ?? '5xx'}），系统已自动重试，请稍后再试。`;
  }

  if (
    haystack.includes('econnreset') ||
    haystack.includes('etimedout') ||
    haystack.includes('fetch failed') ||
    haystack.includes('socket hang up')
  ) {
    return '连接 Gemini 服务网络超时或中断，请稍后重试。';
  }

  if (embedded?.message) {
    return `${fallbackLabel}：${embedded.message}`;
  }

  if (!raw) {
    return fallbackLabel;
  }

  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

export async function withGeminiRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: GeminiRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 8000);
  const sleepFn = options.sleepFn ?? DEFAULT_SLEEP;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const canRetry = attempt < maxAttempts && isTransientGeminiError(err);
      if (!canRetry) {
        throw err;
      }
      const expDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      options.onRetry?.({ attempt, maxAttempts, delayMs: expDelay, error: err });
      if (expDelay > 0) {
        await sleepFn(expDelay);
      }
    }
  }

  throw lastError;
}

export async function withGeminiModelFallback<T>(
  models: string[],
  fn: (model: string, attempt: number) => Promise<T>,
  options: GeminiModelFallbackOptions = {}
): Promise<{ value: T; model: string }> {
  if (models.length === 0) {
    throw new Error('未配置可用的 Gemini 模型列表');
  }

  const retriesPerModel = Math.max(1, options.retriesPerModel ?? options.maxAttempts ?? 2);
  let lastError: unknown;

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    try {
      const value = await withGeminiRetry((attempt) => fn(model, attempt), {
        maxAttempts: retriesPerModel,
        baseDelayMs: options.baseDelayMs ?? 1600,
        maxDelayMs: options.maxDelayMs ?? 7000,
        sleepFn: options.sleepFn,
        onRetry: options.onRetry,
      });
      return { value, model };
    } catch (err) {
      lastError = err;
      const nextModel = models[i + 1];
      if (nextModel && isTransientGeminiError(err)) {
        options.onFallback?.({ fromModel: model, toModel: nextModel, error: err });
        continue;
      }
      throw new Error(formatFriendlyGeminiError(err));
    }
  }

  throw new Error(formatFriendlyGeminiError(lastError));
}
