import fs from 'fs';
import path from 'path';
import type { IncomingHttpHeaders } from 'http';
import type { FeishuIntegrationStatus } from '../src/types/autodev.ts';
import {
  buildFeishuStageCard,
  timingSafeStringEqual,
  type FeishuStageNotificationPayload,
} from '../src/lib/feishuProtocol.ts';
import { scheduleGitHubStateSync } from './githubStateStore.ts';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const FEISHU_STATE_FILE = path.join(DATA_DIR, 'feishu-state-v1.json');

export const FEISHU_EVENTS_CALLBACK_PATH = '/api/feishu/events';
export const FEISHU_CARD_CALLBACK_PATH = '/api/feishu/card-action';

interface PersistedFeishuState {
  lastActiveChatId?: string;
  updatedAt?: string;
}

let cachedTenantToken: { token: string; expiresAtMs: number } | null = null;
let cachedFeishuState: PersistedFeishuState | null = null;
let lastPushStatus: { ok: boolean; kind: string; reason?: string; at: string } | null = null;
const processedEventIds = new Map<string, number>();
const EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const FEISHU_FETCH_TIMEOUT_MS = 8_000;

async function feishuFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEISHU_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function readEnv(key: string): string {
  return (process.env[key] || '').trim();
}

function getFeishuConfig() {
  const appId = readEnv('FEISHU_APP_ID');
  const appSecret = readEnv('FEISHU_APP_SECRET');
  const verificationToken = readEnv('FEISHU_VERIFICATION_TOKEN');
  const appBaseUrl = readEnv('APP_URL');

  return {
    appId,
    appSecret,
    verificationToken,
    appBaseUrl,
  };
}

function loadFeishuState(): PersistedFeishuState {
  if (cachedFeishuState !== null) return cachedFeishuState;
  try {
    if (fs.existsSync(FEISHU_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FEISHU_STATE_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        cachedFeishuState = parsed as PersistedFeishuState;
        return cachedFeishuState;
      }
    }
  } catch {
    // ignore corrupt local state
  }
  cachedFeishuState = {};
  return cachedFeishuState;
}

function persistFeishuState(next: PersistedFeishuState): void {
  cachedFeishuState = next;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FEISHU_STATE_FILE, JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    // non-fatal on ephemeral filesystems
  }
  scheduleGitHubStateSync('feishu', next);
}

export function reloadFeishuStateFromDisk(): void {
  cachedFeishuState = null;
  loadFeishuState();
}

export function rememberFeishuActiveChat(chatId: string): void {
  const clean = chatId.trim();
  if (!clean) return;
  if (loadFeishuState().lastActiveChatId === clean) return;
  persistFeishuState({
    lastActiveChatId: clean,
    updatedAt: new Date().toISOString(),
  });
}

export function getFeishuTargetChatId(preferredChatId?: string): string {
  const preferred = (preferredChatId || '').trim();
  if (preferred) return preferred;
  return loadFeishuState().lastActiveChatId || '';
}

export function getFeishuAppBaseUrl(): string {
  return getFeishuConfig().appBaseUrl;
}

export function isFeishuChatAllowed(_chatId?: string): boolean {
  return true;
}

export function isDuplicateFeishuEvent(eventId?: string): boolean {
  if (!eventId) return false;
  const now = Date.now();
  // Prune expired entries opportunistically
  for (const [key, exp] of processedEventIds.entries()) {
    if (exp <= now) processedEventIds.delete(key);
  }
  if (processedEventIds.has(eventId)) {
    return true;
  }
  processedEventIds.set(eventId, now + EVENT_DEDUPE_TTL_MS);
  return false;
}

export function getFeishuIntegrationStatus(): FeishuIntegrationStatus {
  const cfg = getFeishuConfig();
  const hasAppCredentials = Boolean(cfg.appId && cfg.appSecret);
  const hasVerificationToken = Boolean(cfg.verificationToken);
  const activeChat = getFeishuTargetChatId();

  return {
    configured: hasAppCredentials && hasVerificationToken,
    hasAppCredentials,
    hasVerificationToken,
    hasEncryptKey: false,
    hasDefaultChatId: false,
    hasActiveChat: Boolean(activeChat),
    eventsCallbackPath: FEISHU_EVENTS_CALLBACK_PATH,
    cardCallbackPath: FEISHU_CARD_CALLBACK_PATH,
    lastPushOk: lastPushStatus?.ok,
    lastPushError: lastPushStatus && !lastPushStatus.ok ? lastPushStatus.reason : undefined,
    lastPushAt: lastPushStatus?.at,
    checkedAt: new Date().toISOString(),
  };
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const val = headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0];
  return typeof val === 'string' ? val : undefined;
}

/**
 * Verifies & decrypts an incoming Feishu webhook request (Events or Card Action Callback).
 * Fails closed when credentials/tokens are not configured on the server.
 */
export function verifyAndDecodeFeishuWebhook(params: {
  rawBody: string;
  body: unknown;
  headers: IncomingHttpHeaders;
}):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; statusCode: number; error: string; code: string } {
  const cfg = getFeishuConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return {
      ok: false,
      statusCode: 503,
      code: 'FEISHU_NOT_CONFIGURED',
      error: '服务端尚未配置 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量',
    };
  }
  if (!cfg.verificationToken) {
    return {
      ok: false,
      statusCode: 503,
      code: 'FEISHU_AUTH_NOT_CONFIGURED',
      error: '服务端必须配置 FEISHU_VERIFICATION_TOKEN 才能启用飞书回调',
    };
  }

  const rawObj =
    params.body && typeof params.body === 'object'
      ? (params.body as Record<string, unknown>)
      : null;
  if (!rawObj) {
    return {
      ok: false,
      statusCode: 400,
      code: 'INVALID_BODY',
      error: '无效的飞书回调请求体',
    };
  }

  const decodedPayload: Record<string, unknown> = rawObj;
  const header =
    decodedPayload.header && typeof decodedPayload.header === 'object'
      ? (decodedPayload.header as Record<string, unknown>)
      : null;
  const incomingToken =
    (typeof header?.token === 'string' ? header.token : '') ||
    (typeof decodedPayload.token === 'string' ? decodedPayload.token : '');

  if (!incomingToken || !timingSafeStringEqual(incomingToken, cfg.verificationToken)) {
    return {
      ok: false,
      statusCode: 403,
      code: 'FEISHU_BAD_TOKEN',
      error: '飞书 Verification Token 校验失败',
    };
  }

  return { ok: true, payload: decodedPayload };
}

async function getTenantAccessToken(): Promise<string> {
  const cfg = getFeishuConfig();
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  }

  const now = Date.now();
  if (cachedTenantToken && cachedTenantToken.expiresAtMs > now + 5 * 60 * 1000) {
    return cachedTenantToken.token;
  }

  const res = await feishuFetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: cfg.appId,
      app_secret: cfg.appSecret,
    }),
  });

  const data = (await res.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  } | null;

  if (!res.ok || !data || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(
      `获取飞书 tenant_access_token 失败：${data?.msg || `HTTP ${res.status}`}`
    );
  }

  const expireSec = typeof data.expire === 'number' && data.expire > 60 ? data.expire : 7200;
  cachedTenantToken = {
    token: data.tenant_access_token,
    expiresAtMs: now + expireSec * 1000,
  };
  return cachedTenantToken.token;
}

/**
 * Fallback discovery: if neither FEISHU_DEFAULT_CHAT_ID nor a remembered active chat exists,
 * query the bot's joined chats via GET /im/v1/chats so Web-initiated tasks can still notify Feishu.
 */
async function discoverBotChatIdFallback(): Promise<string> {
  try {
    const token = await getTenantAccessToken();
    const res = await feishuFetch(`${FEISHU_API_BASE}/im/v1/chats?page_size=20`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = (await res.json().catch(() => null)) as {
      code?: number;
      data?: { items?: Array<{ chat_id?: string }> };
    } | null;
    if (!res.ok || !data || data.code !== 0) {
      return '';
    }
    const items = data.data?.items || [];
    for (const item of items) {
      const candidate = (item.chat_id || '').trim();
      if (candidate && isFeishuChatAllowed(candidate)) {
        rememberFeishuActiveChat(candidate);
        return candidate;
      }
    }
    return '';
  } catch {
    return '';
  }
}

export async function sendFeishuCardMessage(
  chatId: string,
  card: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const cleanChatId = chatId.trim();
  if (!cleanChatId) {
    return { ok: false, error: '缺少飞书目标会话 chat_id' };
  }
  try {
    const token = await getTenantAccessToken();
    const res = await feishuFetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        receive_id: cleanChatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string };
    } | null;

    if (!res.ok || !data || data.code !== 0) {
      return {
        ok: false,
        error: `飞书发送卡片失败 (code=${data?.code ?? res.status})：${data?.msg || `HTTP ${res.status}`}`,
      };
    }
    return { ok: true, messageId: data.data?.message_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '飞书发送卡片异常',
    };
  }
}

export async function replyFeishuCardMessage(
  messageId: string,
  card: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const cleanMsgId = messageId.trim();
  if (!cleanMsgId) {
    return { ok: false, error: '缺少飞书待回复消息 message_id' };
  }
  try {
    const token = await getTenantAccessToken();
    const res = await feishuFetch(
      `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(cleanMsgId)}/reply`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          msg_type: 'interactive',
          content: JSON.stringify(card),
        }),
      }
    );
    const data = (await res.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string };
    } | null;

    if (!res.ok || !data || data.code !== 0) {
      return {
        ok: false,
        error: `飞书回复卡片失败 (code=${data?.code ?? res.status})：${data?.msg || `HTTP ${res.status}`}`,
      };
    }
    return { ok: true, messageId: data.data?.message_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '飞书回复卡片异常',
    };
  }
}

/**
 * Best-effort stage completion/failure notification pushed to Feishu with next-step action buttons.
 * Never throws so pipeline operations are never blocked by Feishu network issues.
 */
export async function notifyFeishuStageEvent(
  payload: FeishuStageNotificationPayload
): Promise<{ sent: boolean; reason?: string; chatId?: string }> {
  const cfg = getFeishuConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return { sent: false, reason: 'feishu_not_configured' };
  }

  let targetChatId = getFeishuTargetChatId(payload.chatId);
  if (!targetChatId) {
    targetChatId = await discoverBotChatIdFallback();
  }
  if (!targetChatId) {
    const reason = '未找到目标飞书群 chat_id：请在飞书群内 @机器人 一次绑定活跃群';
    lastPushStatus = {
      ok: false,
      kind: payload.kind,
      reason,
      at: new Date().toISOString(),
    };
    console.warn(`[AutoDev Feishu] Skip ${payload.kind}: ${reason}`);
    return { sent: false, reason };
  }

  const card = buildFeishuStageCard({
    ...payload,
    chatId: targetChatId,
    appBaseUrl: payload.appBaseUrl || cfg.appBaseUrl || undefined,
  });

  const sentRes = await sendFeishuCardMessage(targetChatId, card);
  lastPushStatus = {
    ok: sentRes.ok,
    kind: payload.kind,
    reason: sentRes.ok ? undefined : sentRes.error,
    at: new Date().toISOString(),
  };
  if (!sentRes.ok) {
    console.warn(`[AutoDev Feishu] Failed to push ${payload.kind} card to ${targetChatId}:`, sentRes.error);
    return { sent: false, reason: sentRes.error, chatId: targetChatId };
  }
  return { sent: true, chatId: targetChatId };
}
