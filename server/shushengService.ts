import type { ShushengIntegrationStatus } from '../src/types/autodev.ts';
import {
  buildShushengChatPayload,
  extractJsonFromShushengContent,
  formatShushengError,
  isTransientShushengStatus,
  isValidShushengModelId,
  parseShushengModelsResponse,
  selectPreferredShushengModel,
} from '../src/lib/shushengProtocol.ts';
import { validateBackupBaseUrl } from '../src/lib/aiModelConfig.ts';
import {
  getAiModelConfig,
  resolveEffectiveBackupApiKey,
} from './aiModelConfigStore.ts';

const STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes to protect RPM quotas
const FORCE_REFRESH_COOLDOWN_MS = 10_000;
const MODELS_PROBE_TIMEOUT_MS = 8_000;
const CHAT_TIMEOUT_MS = 45_000;

let cachedStatus: {
  value: ShushengIntegrationStatus;
  fetchedAtMs: number;
  configFingerprint: string;
} | null = null;
let statusInFlight: Promise<ShushengIntegrationStatus> | null = null;

function getBackupRuntimeContext(override?: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  providerName?: string;
}) {
  const cfg = getAiModelConfig();
  const resolvedKey = resolveEffectiveBackupApiKey();

  const rawBaseUrl = override?.baseUrl?.trim() || cfg.backupBaseUrl;
  const validatedUrl = validateBackupBaseUrl(rawBaseUrl);
  const baseUrl = validatedUrl.ok ? validatedUrl.normalized : cfg.backupBaseUrl;

  const model =
    override?.model?.trim() && isValidShushengModelId(override.model.trim())
      ? override.model.trim()
      : cfg.backupModel;

  const apiKey = override?.apiKey?.trim() || resolvedKey.apiKey;
  const providerName = override?.providerName?.trim() || cfg.backupProviderName || '书生·端砚';

  return {
    enabled: cfg.backupEnabled,
    providerName,
    baseUrl,
    baseUrlValid: validatedUrl.ok,
    baseUrlError: validatedUrl.ok ? undefined : validatedUrl.error,
    model,
    apiKey,
    apiKeySource: override?.apiKey?.trim() ? ('custom' as const) : resolvedKey.source,
  };
}

export function invalidateShushengStatusCache(): void {
  cachedStatus = null;
}

export function isShushengConfigured(): boolean {
  const ctx = getBackupRuntimeContext();
  return Boolean(ctx.enabled && ctx.apiKey && ctx.baseUrlValid);
}

/**
 * Checks connectivity and available models on the configured OpenAI-compatible backup provider (`GET /v1/models`).
 * Defaults to 书生·端砚 (`https://discovery-api.intern-ai.org.cn/v1`) and caches results for 5 minutes.
 */
export async function checkShushengIntegrationStatus(
  forceRefresh = false,
  override?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    providerName?: string;
  }
): Promise<ShushengIntegrationStatus> {
  const ctx = getBackupRuntimeContext(override);
  const checkedAt = new Date().toISOString();
  const isOverrideCall = Boolean(override && (override.baseUrl || override.apiKey || override.model));

  if (!ctx.baseUrlValid) {
    return {
      configured: Boolean(ctx.apiKey),
      connected: false,
      enabled: ctx.enabled,
      providerName: ctx.providerName,
      baseUrl: ctx.baseUrl,
      defaultModel: ctx.model,
      availableModels: [],
      apiKeySource: ctx.apiKeySource,
      error: ctx.baseUrlError || '备用模型 Base URL 格式无效',
      checkedAt,
    };
  }

  if (!ctx.apiKey) {
    return {
      configured: false,
      connected: false,
      enabled: ctx.enabled,
      providerName: ctx.providerName,
      baseUrl: ctx.baseUrl,
      defaultModel: ctx.model,
      availableModels: [],
      apiKeySource: 'none',
      error: '服务端未配置备用引擎 API Key（可配置 SHUSHENG_APIKEY / AUTODEV_BACKUP_API_KEY 或在 ST-00 模型配置中填入）',
      checkedAt,
    };
  }

  const fingerprint = `${ctx.providerName}|${ctx.baseUrl}|${ctx.model}|${ctx.apiKeySource}|${ctx.enabled}`;
  const now = Date.now();
  if (!isOverrideCall && cachedStatus && cachedStatus.configFingerprint === fingerprint) {
    const ageMs = now - cachedStatus.fetchedAtMs;
    if (!forceRefresh && ageMs < STATUS_CACHE_TTL_MS) {
      return cachedStatus.value;
    }
    if (forceRefresh && ageMs < FORCE_REFRESH_COOLDOWN_MS) {
      return cachedStatus.value;
    }
  }

  if (!isOverrideCall && statusInFlight) {
    return statusInFlight;
  }

  const probePromise = (async () => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODELS_PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(`${ctx.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ctx.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const rawText = await response.text();

      if (!response.ok) {
        const failedStatus: ShushengIntegrationStatus = {
          configured: true,
          connected: false,
          enabled: ctx.enabled,
          providerName: ctx.providerName,
          baseUrl: ctx.baseUrl,
          defaultModel: ctx.model,
          availableModels: [],
          apiKeySource: ctx.apiKeySource,
          latencyMs,
          error: formatShushengError(response.status, rawText, `${ctx.providerName}连通性探测失败`),
          checkedAt: new Date().toISOString(),
        };
        if (!isOverrideCall) {
          cachedStatus = { value: failedStatus, fetchedAtMs: Date.now(), configFingerprint: fingerprint };
        }
        return failedStatus;
      }

      let parsedJson: unknown = null;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        parsedJson = null;
      }

      const availableModels = parseShushengModelsResponse(parsedJson);
      const defaultModel = selectPreferredShushengModel(availableModels, ctx.model);

      const okStatus: ShushengIntegrationStatus = {
        configured: true,
        connected: true,
        enabled: ctx.enabled,
        providerName: ctx.providerName,
        baseUrl: ctx.baseUrl,
        defaultModel,
        availableModels,
        apiKeySource: ctx.apiKeySource,
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
      if (!isOverrideCall) {
        cachedStatus = { value: okStatus, fetchedAtMs: Date.now(), configFingerprint: fingerprint };
      }
      return okStatus;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errMsg = err instanceof Error ? err.message : String(err);
      const failedStatus: ShushengIntegrationStatus = {
        configured: true,
        connected: false,
        enabled: ctx.enabled,
        providerName: ctx.providerName,
        baseUrl: ctx.baseUrl,
        defaultModel: ctx.model,
        availableModels: [],
        apiKeySource: ctx.apiKeySource,
        latencyMs,
        error: formatShushengError(null, errMsg, `${ctx.providerName}连通性探测失败`),
        checkedAt: new Date().toISOString(),
      };
      if (!isOverrideCall) {
        cachedStatus = { value: failedStatus, fetchedAtMs: Date.now(), configFingerprint: fingerprint };
      }
      return failedStatus;
    } finally {
      clearTimeout(timer);
      if (!isOverrideCall) {
        statusInFlight = null;
      }
    }
  })();

  if (!isOverrideCall) {
    statusInFlight = probePromise;
  }
  return probePromise;
}

interface ShushengChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveCandidateModels(preferredModel?: string): Promise<string[]> {
  const ctx = getBackupRuntimeContext();
  const targetModel = preferredModel?.trim() || ctx.model;

  let discovered: string[] = cachedStatus?.value.baseUrl === ctx.baseUrl
    ? cachedStatus.value.availableModels
    : [];
  if (discovered.length === 0 && isShushengConfigured()) {
    const status = await checkShushengIntegrationStatus(false).catch(() => null);
    if (status?.connected && status.availableModels.length > 0) {
      discovered = status.availableModels;
    }
  }

  const primary = isValidShushengModelId(targetModel)
    ? targetModel
    : selectPreferredShushengModel(discovered);
  const candidates = [primary];

  const fallbackPool =
    discovered.length > 0
      ? [
          ...['intern-s2', 'qwen3.8-27b', 'deepseek-v4.1-flash-1017', 'glm-5.3'].filter((m) =>
            discovered.includes(m)
          ),
          ...discovered,
        ]
      : [];

  for (const fallback of fallbackPool) {
    if (isValidShushengModelId(fallback) && !candidates.includes(fallback)) {
      candidates.push(fallback);
    }
    if (candidates.length >= 2) break;
  }
  return candidates;
}

/**
 * Generates a validated JSON object using the configured OpenAI-compatible backup provider (`/v1/chat/completions`).
 * Supports automatic retry on 429/5xx, automatic fallback if `response_format` is rejected,
 * and robust JSON extraction across reasoning tags and markdown code fences.
 */
export async function generateShushengStructuredJson<T>(params: {
  systemInstruction: string;
  prompt: string;
  schemaHint?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  onChunk?: (chunkText: string) => void;
}): Promise<{
  value: T;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}> {
  const ctx = getBackupRuntimeContext();
  if (!ctx.enabled) {
    throw new Error('备用 OpenAI 兼容模型已在配置中停用。');
  }
  if (!ctx.baseUrlValid) {
    throw new Error(ctx.baseUrlError || '备用模型 Base URL 无效');
  }
  if (!ctx.apiKey) {
    throw new Error('服务端未配置备用引擎 API Key，无法调用备用 OpenAI 兼容模型。');
  }

  const fullSystem = [
    params.systemInstruction.trim(),
    params.schemaHint ? `请严格按照以下 JSON 字段结构输出（所有必需字段均需存在）：\n${params.schemaHint}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const candidateModels = await resolveCandidateModels(params.model);
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    let useJsonFormat = true;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) {
        await sleep(1200 * Math.pow(2, attempt - 2));
      }

      const payload = buildShushengChatPayload({
        model,
        systemInstruction: fullSystem,
        prompt: params.prompt,
        temperature: params.temperature ?? 0.2,
        maxTokens: params.maxTokens ?? 4096,
        requireJsonObject: useJsonFormat,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

      try {
        const response = await fetch(`${ctx.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${ctx.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const rawBody = await response.text();
        if (!response.ok) {
          if (
            response.status === 400 &&
            useJsonFormat &&
            /response_format|json_object/i.test(rawBody)
          ) {
            useJsonFormat = false;
            continue;
          }

          const formatted = new Error(
            formatShushengError(response.status, rawBody, `${ctx.providerName} API 调用失败`)
          );
          lastError = formatted;
          if (isTransientShushengStatus(response.status) && attempt < 3) {
            continue;
          }
          if (!isTransientShushengStatus(response.status) && response.status !== 404) {
            throw formatted;
          }
          break;
        }

        const data = JSON.parse(rawBody) as ShushengChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content ?? '';
        if (!content.trim()) {
          throw new Error(`${ctx.providerName}模型返回空内容`);
        }

        params.onChunk?.(content);
        const value = extractJsonFromShushengContent<T>(content);

        return {
          value,
          model: data.model || model,
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError =
          err instanceof Error && (message.includes(ctx.providerName) || message.includes('书生'))
            ? err
            : new Error(formatShushengError(null, message, `${ctx.providerName} API 调用失败`));

        const looksTransient =
          /429|500|502|503|504|abort|timeout|econnreset|fetch failed|暂时繁忙|频率限制|超时/i.test(
            message
          );
        if (looksTransient && attempt < 3) {
          continue;
        }
        if (!looksTransient) {
          throw lastError;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }

  throw lastError || new Error(`${ctx.providerName} API 调用失败，请稍后重试。`);
}

/**
 * Performs a lightweight live Chat Completions ping against the configured (or candidate) OpenAI-compatible provider.
 */
export async function pingShushengChat(override?: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  providerName?: string;
}): Promise<{
  ok: boolean;
  model: string;
  baseUrl: string;
  reply: string;
  latencyMs: number;
  error?: string;
}> {
  const ctx = getBackupRuntimeContext(override);
  if (!ctx.baseUrlValid) {
    return {
      ok: false,
      model: ctx.model,
      baseUrl: ctx.baseUrl,
      reply: '',
      latencyMs: 0,
      error: ctx.baseUrlError || 'Base URL 无效',
    };
  }
  if (!ctx.apiKey) {
    return {
      ok: false,
      model: ctx.model,
      baseUrl: ctx.baseUrl,
      reply: '',
      latencyMs: 0,
      error: '服务端未配置备用引擎 API Key',
    };
  }

  const targetModel = ctx.model;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const payload = buildShushengChatPayload({
      model: targetModel,
      systemInstruction: '你是一个连通性测试助手，请用最简短的一句话回复。',
      prompt: '请仅回复 OK',
      temperature: 0,
      maxTokens: 32,
      requireJsonObject: false,
    });

    const response = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const rawBody = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        model: targetModel,
        baseUrl: ctx.baseUrl,
        reply: '',
        latencyMs,
        error: formatShushengError(response.status, rawBody, `${ctx.providerName}对话探测失败`),
      };
    }

    const data = JSON.parse(rawBody) as ShushengChatCompletionResponse;
    const reply = (data.choices?.[0]?.message?.content ?? '').trim().slice(0, 120);
    return {
      ok: Boolean(reply),
      model: data.model || targetModel,
      baseUrl: ctx.baseUrl,
      reply: reply || 'OK',
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      model: targetModel,
      baseUrl: ctx.baseUrl,
      reply: '',
      latencyMs: Date.now() - startedAt,
      error: formatShushengError(
        null,
        err instanceof Error ? err.message : String(err),
        `${ctx.providerName}对话探测失败`
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}
