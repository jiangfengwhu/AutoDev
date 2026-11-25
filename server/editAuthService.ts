import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { scheduleGitHubStateSync } from './githubStateStore.ts';

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const AUTH_STORE_FILE = path.join(DATA_DIR, 'edit-auth-v1.json');

// Precomputed salted scrypt hash for the initial out-of-the-box passcode so no plaintext secret sits in code.
// Production deployments should set process.env.AUTODEV_EDIT_PASSWORD (which always overrides this fallback).
const DEFAULT_SCRYPT_SALT = 'autodev_edit_default_v1_9f4b2c7e1a8d';
const DEFAULT_SCRYPT_HASH =
  '0b7067f86a1c3fcbf0e95638a4239e3eb302df6a84c7dfeecce851f9df3cd4166d6168cbff81c3de3d800a19e52e89506cdc0628dd09a095a81117f8f4c65669';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_FAILURES = 10;

export type EditPasswordSource = 'env' | 'stored' | 'default';

export interface StoredEditAuthRecord {
  version: 1;
  algorithm: 'scrypt';
  salt: string;
  hash: string;
  updatedAt: string;
}

export interface EditAuthMeta {
  source: EditPasswordSource;
  canChangePassword: boolean;
  envVarName: 'AUTODEV_EDIT_PASSWORD';
  updatedAt: string | null;
}

interface TokenPayload {
  sub: 'autodev-edit';
  jti: string;
  iat: number;
  exp: number;
}

// Signing key: read from env if provided, else cryptographically strong per-process secret in memory
const SESSION_SIGNING_KEY = (() => {
  const envKey = process.env.AUTODEV_AUTH_SECRET?.trim();
  return envKey && envKey.length >= 16 ? Buffer.from(envKey, 'utf-8') : crypto.randomBytes(32);
})();

let storedAuthCache: StoredEditAuthRecord | null | undefined = undefined;
let minTokenIssuedAtMs = 0;
const revokedJtis = new Map<string, number>();
const failedUnlockAttempts = new Map<string, number[]>();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStoredAuth(): StoredEditAuthRecord | null {
  if (storedAuthCache !== undefined) return storedAuthCache;
  try {
    if (!fs.existsSync(AUTH_STORE_FILE)) {
      storedAuthCache = null;
      return null;
    }
    const raw = fs.readFileSync(AUTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoredEditAuthRecord>;
    if (
      parsed &&
      parsed.algorithm === 'scrypt' &&
      typeof parsed.salt === 'string' &&
      typeof parsed.hash === 'string' &&
      parsed.salt.length >= 8 &&
      /^[0-9a-f]{128}$/i.test(parsed.hash)
    ) {
      storedAuthCache = {
        version: 1,
        algorithm: 'scrypt',
        salt: parsed.salt,
        hash: parsed.hash.toLowerCase(),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
      return storedAuthCache;
    }
  } catch {
    // Corrupted or unreadable file falls back cleanly
  }
  storedAuthCache = null;
  return null;
}

export function reloadEditAuthFromDisk(): void {
  storedAuthCache = undefined;
  loadStoredAuth();
}

function timingSafeHexEqual(hexA: string, hexB: string): boolean {
  const bufA = Buffer.from(hexA, 'hex');
  const bufB = Buffer.from(hexB, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyAgainstScrypt(candidate: string, salt: string, expectedHex: string): boolean {
  const derived = crypto.scryptSync(candidate, salt, 64).toString('hex');
  return timingSafeHexEqual(derived, expectedHex);
}

function verifyAgainstEnvSecret(candidate: string, envSecret: string): boolean {
  const a = crypto.createHash('sha256').update(candidate, 'utf-8').digest();
  const b = crypto.createHash('sha256').update(envSecret, 'utf-8').digest();
  return crypto.timingSafeEqual(a, b);
}

export function getEditAuthMeta(): EditAuthMeta {
  const envSecret = process.env.AUTODEV_EDIT_PASSWORD?.trim();
  if (envSecret) {
    return {
      source: 'env',
      canChangePassword: false,
      envVarName: 'AUTODEV_EDIT_PASSWORD',
      updatedAt: null,
    };
  }
  const stored = loadStoredAuth();
  if (stored) {
    return {
      source: 'stored',
      canChangePassword: true,
      envVarName: 'AUTODEV_EDIT_PASSWORD',
      updatedAt: stored.updatedAt,
    };
  }
  return {
    source: 'default',
    canChangePassword: true,
    envVarName: 'AUTODEV_EDIT_PASSWORD',
    updatedAt: null,
  };
}

export function verifyEditPassword(candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 256) {
    return false;
  }
  const envSecret = process.env.AUTODEV_EDIT_PASSWORD?.trim();
  if (envSecret) {
    return verifyAgainstEnvSecret(candidate, envSecret);
  }
  const stored = loadStoredAuth();
  if (stored) {
    return verifyAgainstScrypt(candidate, stored.salt, stored.hash);
  }
  return verifyAgainstScrypt(candidate, DEFAULT_SCRYPT_SALT, DEFAULT_SCRYPT_HASH);
}

export function changeEditPassword(
  currentPassword: string,
  nextPassword: string
): { ok: true; token: string; expiresAt: string; meta: EditAuthMeta } | { ok: false; error: string; statusCode: number } {
  const envSecret = process.env.AUTODEV_EDIT_PASSWORD?.trim();
  if (envSecret) {
    return {
      ok: false,
      statusCode: 400,
      error: '当前密码由环境变量 AUTODEV_EDIT_PASSWORD 托管，请在部署 Secrets / 环境变量中更新',
    };
  }
  if (!verifyEditPassword(currentPassword)) {
    return { ok: false, statusCode: 401, error: '当前密码不正确' };
  }
  const trimmedNext = nextPassword.trim();
  if (trimmedNext.length < 6 || trimmedNext.length > 128) {
    return { ok: false, statusCode: 400, error: '新密码长度需在 6 ~ 128 个字符之间' };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(trimmedNext, salt, 64).toString('hex');
  const record: StoredEditAuthRecord = {
    version: 1,
    algorithm: 'scrypt',
    salt,
    hash,
    updatedAt: new Date().toISOString(),
  };

  ensureDataDir();
  const serialized = JSON.stringify(record, null, 2);
  fs.writeFileSync(AUTH_STORE_FILE, serialized, 'utf-8');
  storedAuthCache = record;
  scheduleGitHubStateSync('auth', record);

  // Invalidate any previously issued session tokens and mint a fresh one
  minTokenIssuedAtMs = Date.now();
  const session = issueEditSessionToken();
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    meta: getEditAuthMeta(),
  };
}

function signTokenPayload(payloadB64: string): string {
  return crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(payloadB64, 'utf-8')
    .digest('base64url');
}

export function issueEditSessionToken(nowMs = Date.now()): {
  token: string;
  expiresAt: string;
  jti: string;
} {
  const jti = crypto.randomBytes(16).toString('hex');
  const payload: TokenPayload = {
    sub: 'autodev-edit',
    jti,
    iat: nowMs,
    exp: nowMs + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = signTokenPayload(payloadB64);
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: new Date(payload.exp).toISOString(),
    jti,
  };
}

function pruneRevokedJtis(nowMs: number): void {
  if (revokedJtis.size < 64) return;
  for (const [jti, exp] of revokedJtis.entries()) {
    if (exp <= nowMs) revokedJtis.delete(jti);
  }
}

export function verifyEditSessionToken(
  token: string | null | undefined,
  nowMs = Date.now()
): { valid: boolean; expiresAt?: string; jti?: string } {
  if (!token || typeof token !== 'string') return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return { valid: false };

  const expectedSig = signTokenPayload(payloadB64);
  const sigBuf = Buffer.from(sigB64, 'utf-8');
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    ) as Partial<TokenPayload>;
    if (
      payload.sub !== 'autodev-edit' ||
      typeof payload.jti !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return { valid: false };
    }
    if (payload.exp <= nowMs) return { valid: false };
    if (payload.iat < minTokenIssuedAtMs) return { valid: false };
    if (revokedJtis.has(payload.jti)) return { valid: false };
    return {
      valid: true,
      expiresAt: new Date(payload.exp).toISOString(),
      jti: payload.jti,
    };
  } catch {
    return { valid: false };
  }
}

export function revokeEditSessionToken(token: string | null | undefined): void {
  const verified = verifyEditSessionToken(token);
  if (verified.valid && verified.jti) {
    const expMs = verified.expiresAt ? Date.parse(verified.expiresAt) : Date.now() + TOKEN_TTL_MS;
    revokedJtis.set(verified.jti, expMs);
    pruneRevokedJtis(Date.now());
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/);
  return match ? match[1] : null;
}

export function checkUnlockRateLimit(
  clientKey: string,
  nowMs = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  const timestamps = (failedUnlockAttempts.get(clientKey) ?? []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  failedUnlockAttempts.set(clientKey, timestamps);
  if (timestamps.length >= RATE_LIMIT_MAX_FAILURES) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (nowMs - oldest)) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordUnlockFailure(clientKey: string, nowMs = Date.now()): void {
  const timestamps = (failedUnlockAttempts.get(clientKey) ?? []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(nowMs);
  failedUnlockAttempts.set(clientKey, timestamps);
}

export function clearUnlockFailures(clientKey: string): void {
  failedUnlockAttempts.delete(clientKey);
}
