export const SHUSHENG_BASE_URL = 'https://discovery-api.intern-ai.org.cn/v1';
export const SHUSHENG_DEFAULT_MODEL = 'intern-s2';
export const SHUSHENG_FALLBACK_MODEL = 'intern-latest';
export const SHUSHENG_MODEL_ID_REGEX = /^[a-zA-Z0-9._:/-]{1,80}$/;

export interface ShushengChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ShushengChatPayload {
  model: string;
  messages: ShushengChatMessage[];
  temperature: number;
  max_tokens?: number;
  stream: false;
  response_format?: { type: 'json_object' };
}

export function isValidShushengModelId(model: unknown): model is string {
  return typeof model === 'string' && SHUSHENG_MODEL_ID_REGEX.test(model.trim());
}

/**
 * Safely extracts sorted unique model IDs from an OpenAI-compatible GET /v1/models payload.
 */
export function parseShushengModelsResponse(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const rawList = (data as { data?: unknown }).data;
  if (!Array.isArray(rawList)) return [];

  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';
    if (!id || !SHUSHENG_MODEL_ID_REGEX.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models.sort((a, b) => a.localeCompare(b));
}

/**
 * Picks the best available model for Shusheng Duanyan API calls,
 * preferring an explicitly requested valid model, then `intern-s2`, then `intern-latest`,
 * then any `intern-` model, then the first discovered model.
 */
export function selectPreferredShushengModel(
  availableModels: string[],
  preferredModel?: string
): string {
  const cleanPreferred = preferredModel?.trim();
  if (cleanPreferred && isValidShushengModelId(cleanPreferred)) {
    if (availableModels.length === 0 || availableModels.includes(cleanPreferred)) {
      return cleanPreferred;
    }
  }
  if (availableModels.includes(SHUSHENG_DEFAULT_MODEL)) {
    return SHUSHENG_DEFAULT_MODEL;
  }
  if (availableModels.includes(SHUSHENG_FALLBACK_MODEL)) {
    return SHUSHENG_FALLBACK_MODEL;
  }
  const internCandidate = availableModels.find((m) => m.toLowerCase().startsWith('intern'));
  if (internCandidate) {
    return internCandidate;
  }
  return availableModels[0] || SHUSHENG_DEFAULT_MODEL;
}

/**
 * Builds an OpenAI-compatible Chat Completions request body for 书生·端砚平台.
 */
export function buildShushengChatPayload(params: {
  model: string;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  requireJsonObject?: boolean;
}): ShushengChatPayload {
  const temperature =
    typeof params.temperature === 'number' && Number.isFinite(params.temperature)
      ? Math.min(1.5, Math.max(0, params.temperature))
      : 0.2;

  const systemText = params.requireJsonObject
    ? [
        params.systemInstruction.trim(),
        '输出格式硬性要求：只返回一个合法的 JSON 对象，不要包含 Markdown 代码块标记（不要 ```json），不要附带额外解释文本。',
      ]
        .filter(Boolean)
        .join('\n\n')
    : params.systemInstruction.trim();

  const messages: ShushengChatMessage[] = [];
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }
  messages.push({ role: 'user', content: params.prompt });

  const payload: ShushengChatPayload = {
    model: params.model,
    messages,
    temperature,
    stream: false,
  };

  if (typeof params.maxTokens === 'number' && Number.isFinite(params.maxTokens) && params.maxTokens > 0) {
    payload.max_tokens = Math.round(params.maxTokens);
  }
  if (params.requireJsonObject) {
    payload.response_format = { type: 'json_object' };
  }

  return payload;
}

/**
 * Removes <think>...</think> reasoning sections emitted by reasoning models before JSON extraction.
 */
export function stripThinkingBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Extracts and parses a JSON object from model output, tolerating <think> blocks,
 * ```json code fences, and leading/trailing prose.
 */
export function extractJsonFromShushengContent<T = Record<string, unknown>>(rawText: string): T {
  const cleaned = stripThinkingBlocks(String(rawText || ''));
  if (!cleaned) {
    throw new Error('书生·端砚模型返回空响应');
  }

  // 1. Direct parse fast-path
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object') {
      return direct as T;
    }
  } catch {
    // fall through to fence / brace extraction
  }

  // 2. Markdown code fence extraction (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === 'object') {
        return parsed as T;
      }
    } catch {
      // continue to balanced brace scan
    }
  }

  // 3. Balanced top-level JSON object extraction
  const startIdx = cleaned.indexOf('{');
  if (startIdx >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIdx; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = cleaned.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') {
              return parsed as T;
            }
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('书生·端砚模型返回内容不是合法的 JSON 结构');
}

export function isTransientShushengStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function formatShushengError(
  status: number | null,
  rawBody: string,
  contextLabel = '书生·端砚 API 调用失败'
): string {
  const safeBody = String(rawBody || '').trim();
  let upstreamMessage = '';
  if (safeBody) {
    try {
      const parsed = JSON.parse(safeBody) as {
        error?: { message?: string } | string;
        message?: string;
        detail?: string;
      };
      if (typeof parsed.error === 'string') {
        upstreamMessage = parsed.error;
      } else if (parsed.error && typeof parsed.error.message === 'string') {
        upstreamMessage = parsed.error.message;
      } else if (typeof parsed.message === 'string') {
        upstreamMessage = parsed.message;
      } else if (typeof parsed.detail === 'string') {
        upstreamMessage = parsed.detail;
      }
    } catch {
      upstreamMessage = safeBody.slice(0, 180);
    }
  }

  if (status === 401 || status === 403) {
    return `${contextLabel}：SHUSHENG_APIKEY 鉴权失败（HTTP ${status}），请在 AI Studio Settings > Secrets 核对密钥有效性。`;
  }
  if (status === 429) {
    return `${contextLabel}：书生·端砚平台触发请求频率限制（HTTP 429，默认约 30 RPM），请稍后重试。`;
  }
  if (status !== null && status >= 500) {
    return `${contextLabel}：书生·端砚上游服务暂时繁忙（HTTP ${status}），请稍后重试。`;
  }
  if (status === null && /abort|timeout/i.test(safeBody)) {
    return `${contextLabel}：连接书生·端砚平台超时，请检查网络后重试。`;
  }

  const suffix = upstreamMessage ? `：${upstreamMessage.slice(0, 180)}` : status ? `（HTTP ${status}）` : '';
  return `${contextLabel}${suffix}`;
}
