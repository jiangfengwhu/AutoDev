import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BACKUP_BASE_URL,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_BACKUP_PROVIDER_NAME,
  DEFAULT_GEMINI_DECISION_MODEL,
  DEFAULT_GEMINI_FALLBACK_MODEL,
  DEFAULT_GEMINI_PRIMARY_MODEL,
  maskApiKeyForDisplay,
  normalizeAiModelConfigPatch,
  validateBackupBaseUrl,
  type AiModelConfigPersisted,
} from './aiModelConfig';

test('validateBackupBaseUrl allows public HTTPS endpoints and strips trailing slashes', () => {
  const ok1 = validateBackupBaseUrl('https://discovery-api.intern-ai.org.cn/v1/');
  assert.equal(ok1.ok, true);
  if (ok1.ok) {
    assert.equal(ok1.normalized, 'https://discovery-api.intern-ai.org.cn/v1');
  }

  const ok2 = validateBackupBaseUrl('https://api.openai.com/v1///');
  assert.equal(ok2.ok, true);
  if (ok2.ok) {
    assert.equal(ok2.normalized, 'https://api.openai.com/v1');
  }
});

test('validateBackupBaseUrl blocks HTTP, localhost, private IPs, metadata IP, and credentials', () => {
  const badUrls = [
    'http://api.openai.com/v1',
    'https://localhost:8080/v1',
    'https://127.0.0.1/v1',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/v1',
    'https://192.168.1.10/v1',
    'https://172.16.0.2/v1',
    'https://[::1]/v1',
    'https://metadata.google.internal/v1',
    'https://user:pass@api.openai.com/v1',
    'https://internal-service/v1',
  ];
  for (const url of badUrls) {
    const res = validateBackupBaseUrl(url);
    assert.equal(res.ok, false, `Expected ${url} to be rejected`);
  }
});

test('normalizeAiModelConfigPatch validates model IDs and merges clean updates', () => {
  const base: AiModelConfigPersisted = {
    geminiPrimaryModel: DEFAULT_GEMINI_PRIMARY_MODEL,
    geminiFallbackModel: DEFAULT_GEMINI_FALLBACK_MODEL,
    geminiDecisionModel: DEFAULT_GEMINI_DECISION_MODEL,
    backupEnabled: true,
    backupProviderName: DEFAULT_BACKUP_PROVIDER_NAME,
    backupBaseUrl: DEFAULT_BACKUP_BASE_URL,
    backupModel: DEFAULT_BACKUP_MODEL,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const updated = normalizeAiModelConfigPatch(base, {
    geminiPrimaryModel: 'gemini-4-neon',
    geminiFallbackModel: 'gemini-3.1-flash-lite',
    backupProviderName: 'DeepSeek OpenAI',
    backupBaseUrl: 'https://api.deepseek.com/v1/',
    backupModel: 'deepseek-chat',
  });
  assert.equal(updated.ok, true);
  if (updated.ok) {
    assert.equal(updated.next.geminiPrimaryModel, 'gemini-4-neon');
    assert.equal(updated.next.backupBaseUrl, 'https://api.deepseek.com/v1');
    assert.equal(updated.next.backupModel, 'deepseek-chat');
    assert.equal(updated.next.backupProviderName, 'DeepSeek OpenAI');
  }

  const badModel = normalizeAiModelConfigPatch(base, {
    backupModel: 'bad model name with space',
  });
  assert.equal(badModel.ok, false);
});

test('maskApiKeyForDisplay masks secrets safely', () => {
  assert.equal(maskApiKeyForDisplay(''), null);
  assert.equal(maskApiKeyForDisplay('sk-1234567890abcd'), 'sk-1••••abcd');
  assert.equal(maskApiKeyForDisplay('short'), 'sh••••');
});

test('.env.example omits optional AI model config vars and keeps SHUSHENG_APIKEY', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const envText = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8');
  assert.match(envText, /^SHUSHENG_APIKEY=$/m);
  for (const optionalKey of [
    'AUTODEV_GEMINI_PRIMARY_MODEL',
    'AUTODEV_GEMINI_FALLBACK_MODEL',
    'AUTODEV_GEMINI_DECISION_MODEL',
    'AUTODEV_BACKUP_BASE_URL',
    'AUTODEV_BACKUP_MODEL',
    'AUTODEV_BACKUP_API_KEY',
  ]) {
    assert.doesNotMatch(envText, new RegExp(`^${optionalKey}=`, 'm'));
  }
});

test('src/lib/aiModelConfig.ts uses explicit .ts extensions for native Node ESM Cloud Run boot', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const srcText = fs.readFileSync(path.join(process.cwd(), 'src/lib/aiModelConfig.ts'), 'utf-8');
  const relativeImports = [...srcText.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(relativeImports.length > 0);
  for (const spec of relativeImports) {
    assert.ok(spec.endsWith('.ts'), `Relative import "${spec}" must end with .ts for node server.ts`);
  }
});



