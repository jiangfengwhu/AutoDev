import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHUSHENG_DEFAULT_MODEL,
  SHUSHENG_FALLBACK_MODEL,
  buildShushengChatPayload,
  extractJsonFromShushengContent,
  formatShushengError,
  isTransientShushengStatus,
  parseShushengModelsResponse,
  selectPreferredShushengModel,
} from './shushengProtocol';

test('parseShushengModelsResponse extracts unique valid sorted model IDs', () => {
  const models = parseShushengModelsResponse({
    object: 'list',
    data: [
      { id: 'intern-s2', object: 'model' },
      { id: 'intern-latest', object: 'model' },
      { id: 'intern-s2', object: 'model' },
      { id: '  ' },
      { id: 'bad model with spaces' },
      null,
    ],
  });
  assert.deepEqual(models, ['intern-latest', 'intern-s2']);
});

test('selectPreferredShushengModel honors preference and falls back cleanly', () => {
  assert.equal(selectPreferredShushengModel(['intern-s2', 'intern-latest']), SHUSHENG_DEFAULT_MODEL);
  assert.equal(selectPreferredShushengModel(['intern-latest', 'qwen-x']), SHUSHENG_FALLBACK_MODEL);
  assert.equal(selectPreferredShushengModel(['intern-s1-pro', 'other']), 'intern-s1-pro');
  assert.equal(selectPreferredShushengModel(['custom-v1'], 'custom-v1'), 'custom-v1');
  assert.equal(selectPreferredShushengModel([]), SHUSHENG_DEFAULT_MODEL);
});

test('buildShushengChatPayload creates OpenAI-compatible JSON payload', () => {
  const payload = buildShushengChatPayload({
    model: 'intern-latest',
    systemInstruction: 'You are a classifier.',
    prompt: '{"hello":"world"}',
    temperature: 0.1,
    maxTokens: 1024,
    requireJsonObject: true,
  });
  assert.equal(payload.model, 'intern-latest');
  assert.equal(payload.stream, false);
  assert.equal(payload.temperature, 0.1);
  assert.equal(payload.max_tokens, 1024);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.messages.length, 2);
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /JSON/);
  assert.equal(payload.messages[1].role, 'user');
});

test('extractJsonFromShushengContent strips <think> blocks and markdown code fences', () => {
  const raw = `<think>先分析一下需求，决定字段取值。</think>
\`\`\`json
{
  "title": "修复列表刷新",
  "tasks": [{ "id": "T1", "title": "更新状态" }]
}
\`\`\``;
  const parsed = extractJsonFromShushengContent<{ title: string; tasks: Array<{ id: string }> }>(raw);
  assert.equal(parsed.title, '修复列表刷新');
  assert.equal(parsed.tasks[0].id, 'T1');
});

test('extractJsonFromShushengContent extracts balanced JSON embedded in prose', () => {
  const raw = '分析结果如下：{"injectionProb":0.02,"maliciousProb":0.01,"actionableProb":0.92} 以上为输出。';
  const parsed = extractJsonFromShushengContent<{ actionableProb: number }>(raw);
  assert.equal(parsed.actionableProb, 0.92);
});

test('extractJsonFromShushengContent throws on empty or non-JSON content', () => {
  assert.throws(() => extractJsonFromShushengContent(''), /空响应/);
  assert.throws(() => extractJsonFromShushengContent('not json at all'), /合法的 JSON/);
});

test('formatShushengError and isTransientShushengStatus classify HTTP statuses accurately', () => {
  assert.equal(isTransientShushengStatus(429), true);
  assert.equal(isTransientShushengStatus(503), true);
  assert.equal(isTransientShushengStatus(401), false);

  assert.match(formatShushengError(401, '{"error":{"message":"invalid key"}}'), /鉴权失败/);
  assert.match(formatShushengError(429, ''), /频率限制/);
  assert.match(formatShushengError(503, ''), /暂时繁忙/);
  assert.match(formatShushengError(null, 'The operation was aborted due to timeout'), /超时/);
});
