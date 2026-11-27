import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_BACKUP_BASE_URL,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_BACKUP_PROVIDER_NAME,
  DEFAULT_GEMINI_DECISION_MODEL,
  DEFAULT_GEMINI_FALLBACK_MODEL,
  DEFAULT_GEMINI_PRIMARY_MODEL,
  isValidAiModelId,
  maskApiKeyForDisplay,
  normalizeAiModelConfigPatch,
  validateBackupBaseUrl,
  type AiModelConfigPersisted,
  type AiModelConfigPublicResponse,
  type AiModelConfigUpdateInput,
} from '../src/lib/aiModelConfig.ts';
import { scheduleGitHubStateSync } from './githubStateStore.ts';

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const CONFIG_FILE = path.join(DATA_DIR, 'ai-model-config-v1.json');
// Strictly local-only encrypted runtime secret file (NEVER registered in githubStateStore, NEVER pushed to GitHub)
const LOCAL_SECRET_FILE = path.join(DATA_DIR, '.backup-api-key-v1.enc');

function getEnvDefaults() {
  const envPrimary = process.env.AUTODEV_GEMINI_PRIMARY_MODEL?.trim();
  const envFallback = process.env.AUTODEV_GEMINI_FALLBACK_MODEL?.trim();
  const envDecision = process.env.AUTODEV_GEMINI_DECISION_MODEL?.trim();
  const envBaseUrl = process.env.AUTODEV_BACKUP_BASE_URL?.trim();
  const envBackupModel = process.env.AUTODEV_BACKUP_MODEL?.trim();

  const validBaseUrl = envBaseUrl ? validateBackupBaseUrl(envBaseUrl) : null;

  return {
    geminiPrimaryModel:
      envPrimary && isValidAiModelId(envPrimary) ? envPrimary : DEFAULT_GEMINI_PRIMARY_MODEL,
    geminiFallbackModel:
      envFallback && isValidAiModelId(envFallback) ? envFallback : DEFAULT_GEMINI_FALLBACK_MODEL,
    geminiDecisionModel:
      envDecision && isValidAiModelId(envDecision) ? envDecision : DEFAULT_GEMINI_DECISION_MODEL,
    backupProviderName: DEFAULT_BACKUP_PROVIDER_NAME,
    backupBaseUrl:
      validBaseUrl && validBaseUrl.ok ? validBaseUrl.normalized : DEFAULT_BACKUP_BASE_URL,
    backupModel:
      envBackupModel && isValidAiModelId(envBackupModel) ? envBackupModel : DEFAULT_BACKUP_MODEL,
  };
}

function buildDefaultConfig(): AiModelConfigPersisted {
  const defaults = getEnvDefaults();
  return {
    ...defaults,
    backupEnabled: true,
    updatedAt: new Date().toISOString(),
  };
}

function deriveLocalSecretKey(): Buffer {
  const seed =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.SHUSHENG_APIKEY?.trim() ||
    'autodev-local-runtime-seed';
  return crypto
    .createHash('sha256')
    .update(`autodev-backup-key-enc-v1:${seed}`, 'utf-8')
    .digest();
}

function encryptLocalSecret(plainText: string): string {
  const key = deriveLocalSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptLocalSecret(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { v?: number; iv?: string; tag?: string; data?: string };
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) return null;
    const key = deriveLocalSecretKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf-8').trim() || null;
  } catch {
    return null;
  }
}

let cachedConfig: AiModelConfigPersisted | null = null;
let cachedCustomApiKey: string | null | undefined = undefined;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfigFromDisk(): AiModelConfigPersisted {
  const defaults = buildDefaultConfig();
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return defaults;
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AiModelConfigPersisted>;
    const normalized = normalizeAiModelConfigPatch(defaults, parsed);
    if (normalized.ok) {
      return {
        ...normalized.next,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : defaults.updatedAt,
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function loadCustomApiKeyFromDisk(): string | null {
  try {
    if (!fs.existsSync(LOCAL_SECRET_FILE)) return null;
    const raw = fs.readFileSync(LOCAL_SECRET_FILE, 'utf-8');
    return decryptLocalSecret(raw);
  } catch {
    return null;
  }
}

function saveCustomApiKeyToDisk(apiKey: string | null): void {
  cachedCustomApiKey = apiKey;
  try {
    ensureDataDir();
    if (!apiKey) {
      if (fs.existsSync(LOCAL_SECRET_FILE)) {
        fs.unlinkSync(LOCAL_SECRET_FILE);
      }
      return;
    }
    const payload = encryptLocalSecret(apiKey);
    fs.writeFileSync(LOCAL_SECRET_FILE, payload, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.warn('[AutoDev AI Config] Failed to persist local encrypted backup key:', err);
  }
}

function getCustomApiKey(): string | null {
  if (cachedCustomApiKey === undefined) {
    cachedCustomApiKey = loadCustomApiKeyFromDisk();
  }
  return cachedCustomApiKey;
}

export function reloadAiModelConfigFromDisk(): void {
  cachedConfig = loadConfigFromDisk();
}

export function getAiModelConfig(): AiModelConfigPersisted {
  if (!cachedConfig) {
    cachedConfig = loadConfigFromDisk();
  }
  return cachedConfig;
}

export function resolveEffectiveBackupApiKey(): {
  apiKey: string;
  source: 'custom' | 'env' | 'none';
  envName: 'AUTODEV_BACKUP_API_KEY' | 'SHUSHENG_APIKEY' | null;
} {
  const custom = getCustomApiKey();
  if (custom) {
    return { apiKey: custom, source: 'custom', envName: null };
  }
  const genericEnv = process.env.AUTODEV_BACKUP_API_KEY?.trim();
  if (genericEnv) {
    return { apiKey: genericEnv, source: 'env', envName: 'AUTODEV_BACKUP_API_KEY' };
  }
  const shushengEnv = process.env.SHUSHENG_APIKEY?.trim();
  if (shushengEnv) {
    return { apiKey: shushengEnv, source: 'env', envName: 'SHUSHENG_APIKEY' };
  }
  return { apiKey: '', source: 'none', envName: null };
}

export function getPublicAiModelConfig(): AiModelConfigPublicResponse {
  const cfg = getAiModelConfig();
  const keyInfo = resolveEffectiveBackupApiKey();
  return {
    ...cfg,
    backupApiKeyConfigured: Boolean(keyInfo.apiKey),
    backupApiKeySource: keyInfo.source,
    backupApiKeyEnvName: keyInfo.envName,
    backupApiKeyMasked: maskApiKeyForDisplay(keyInfo.apiKey),
    defaults: getEnvDefaults(),
  };
}

export function updateAiModelConfig(
  patch: AiModelConfigUpdateInput
):
  | { ok: true; config: AiModelConfigPublicResponse }
  | { ok: false; error: string } {
  const current = getAiModelConfig();
  const validated = normalizeAiModelConfigPatch(current, patch);
  if (!validated.ok) {
    return validated;
  }

  cachedConfig = validated.next;
  try {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(validated.next, null, 2), 'utf-8');
    // Only non-secret model/URL config is synced to autodev-state branch!
    scheduleGitHubStateSync('aiConfig', validated.next);
  } catch (err) {
    console.warn('[AutoDev AI Config] Failed to persist ai-model-config-v1.json:', err);
  }

  if (patch.clearBackupApiKey === true) {
    saveCustomApiKeyToDisk(null);
  } else if (typeof patch.backupApiKey === 'string' && patch.backupApiKey.trim()) {
    const trimmedKey = patch.backupApiKey.trim();
    if (trimmedKey.length > 512) {
      return { ok: false, error: '备用模型 API Key 长度异常（超出 512 字符限制）' };
    }
    saveCustomApiKeyToDisk(trimmedKey);
  }

  return { ok: true, config: getPublicAiModelConfig() };
}
