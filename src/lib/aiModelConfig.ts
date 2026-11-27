import { SHUSHENG_BASE_URL, SHUSHENG_DEFAULT_MODEL } from './shushengProtocol.ts';

export const DEFAULT_GEMINI_PRIMARY_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_DECISION_MODEL = 'gemini-decision-1';

export const DEFAULT_BACKUP_PROVIDER_NAME = '书生·端砚';
export const DEFAULT_BACKUP_BASE_URL = SHUSHENG_BASE_URL;
export const DEFAULT_BACKUP_MODEL = SHUSHENG_DEFAULT_MODEL;

export const AI_MODEL_ID_REGEX = /^[a-zA-Z0-9._:/-]{1,80}$/;

export interface AiModelConfigPersisted {
  geminiPrimaryModel: string;
  geminiFallbackModel: string;
  geminiDecisionModel: string;
  backupEnabled: boolean;
  backupProviderName: string;
  backupBaseUrl: string;
  backupModel: string;
  updatedAt: string;
}

export interface AiModelConfigPublicResponse extends AiModelConfigPersisted {
  backupApiKeyConfigured: boolean;
  backupApiKeySource: 'custom' | 'env' | 'none';
  backupApiKeyEnvName: 'AUTODEV_BACKUP_API_KEY' | 'SHUSHENG_APIKEY' | null;
  backupApiKeyMasked: string | null;
  defaults: {
    geminiPrimaryModel: string;
    geminiFallbackModel: string;
    geminiDecisionModel: string;
    backupProviderName: string;
    backupBaseUrl: string;
    backupModel: string;
  };
}

export interface AiModelConfigUpdateInput {
  geminiPrimaryModel?: string;
  geminiFallbackModel?: string;
  geminiDecisionModel?: string;
  backupEnabled?: boolean;
  backupProviderName?: string;
  backupBaseUrl?: string;
  backupModel?: string;
  backupApiKey?: string;
  clearBackupApiKey?: boolean;
}

export function isValidAiModelId(value: unknown): value is string {
  return typeof value === 'string' && AI_MODEL_ID_REGEX.test(value.trim());
}

function isPrivateOrRestrictedHostname(rawHostname: string): boolean {
  const host = rawHostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((n) => Number(n));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  // IPv6 literal check (block ULA fc00::/7, link-local fe80::/10, IPv4-mapped loopback/private)
  if (host.includes(':')) {
    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.includes('127.') ||
      host.includes('169.254.') ||
      host.includes('10.') ||
      host.includes('192.168.') ||
      host.startsWith('::ffff:')
    ) {
      return true;
    }
    return false;
  }

  // Require public-looking FQDN (at least one dot)
  if (!host.includes('.')) {
    return true;
  }

  return false;
}

/**
 * Strictly validates an OpenAI-compatible API Base URL against SSRF and malformed schemes.
 * Only public HTTPS endpoints without embedded credentials are permitted.
 */
export function validateBackupBaseUrl(
  rawUrl: string
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, error: '备用模型 Base URL 不能为空' };
  }
  if (trimmed.length > 300) {
    return { ok: false, error: '备用模型 Base URL 长度超出限制（最多 300 字符）' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: '备用模型 Base URL 格式无效，请输入完整的 https:// 地址' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: '出于安全要求，备用模型 Base URL 必须使用 https:// 协议' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Base URL 中不得包含内嵌账号或密码凭证' };
  }
  if (isPrivateOrRestrictedHostname(parsed.hostname)) {
    return { ok: false, error: 'Base URL 指向受限或内网地址，仅允许公网 HTTPS API 端点' };
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const normalized = `${parsed.origin}${cleanPath}`;
  return { ok: true, normalized };
}

export function maskApiKeyForDisplay(rawKey: string | null | undefined): string | null {
  const key = (rawKey || '').trim();
  if (!key) return null;
  if (key.length <= 8) {
    return `${key.slice(0, 2)}••••`;
  }
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function normalizeAiModelConfigPatch(
  current: AiModelConfigPersisted,
  patch: AiModelConfigUpdateInput
):
  | { ok: true; next: AiModelConfigPersisted }
  | { ok: false; error: string } {
  const geminiPrimaryModel =
    patch.geminiPrimaryModel !== undefined
      ? patch.geminiPrimaryModel.trim()
      : current.geminiPrimaryModel;
  const geminiFallbackModel =
    patch.geminiFallbackModel !== undefined
      ? patch.geminiFallbackModel.trim()
      : current.geminiFallbackModel;
  const geminiDecisionModel =
    patch.geminiDecisionModel !== undefined
      ? patch.geminiDecisionModel.trim()
      : current.geminiDecisionModel;
  const backupModel =
    patch.backupModel !== undefined ? patch.backupModel.trim() : current.backupModel;

  if (!isValidAiModelId(geminiPrimaryModel)) {
    return { ok: false, error: 'Gemini 主模型名称格式无效（仅支持字母、数字、._:/-）' };
  }
  if (!isValidAiModelId(geminiFallbackModel)) {
    return { ok: false, error: 'Gemini 备用模型名称格式无效（仅支持字母、数字、._:/-）' };
  }
  if (!isValidAiModelId(geminiDecisionModel)) {
    return { ok: false, error: 'Gemini 决策门控模型名称格式无效（仅支持字母、数字、._:/-）' };
  }
  if (!isValidAiModelId(backupModel)) {
    return { ok: false, error: 'OpenAI 兼容备用模型名称格式无效（仅支持字母、数字、._:/-）' };
  }

  let backupBaseUrl = current.backupBaseUrl;
  if (patch.backupBaseUrl !== undefined) {
    const validatedUrl = validateBackupBaseUrl(patch.backupBaseUrl);
    if (!validatedUrl.ok) {
      return { ok: false, error: validatedUrl.error };
    }
    backupBaseUrl = validatedUrl.normalized;
  }

  const backupProviderName =
    patch.backupProviderName !== undefined
      ? patch.backupProviderName.trim().slice(0, 40) || DEFAULT_BACKUP_PROVIDER_NAME
      : current.backupProviderName;

  const backupEnabled =
    typeof patch.backupEnabled === 'boolean' ? patch.backupEnabled : current.backupEnabled;

  return {
    ok: true,
    next: {
      geminiPrimaryModel,
      geminiFallbackModel,
      geminiDecisionModel,
      backupEnabled,
      backupProviderName,
      backupBaseUrl,
      backupModel,
      updatedAt: new Date().toISOString(),
    },
  };
}
