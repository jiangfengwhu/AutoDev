import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractErrorStatusCode,
  formatFriendlyGeminiError,
  isTransientGeminiError,
  withGeminiModelFallback,
  withGeminiRetry,
} from './geminiResilience';

const SAMPLE_503_RAW =
  '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';

test('detects transient Gemini 503/429/5xx errors and rejects non-transient 400/401 errors', () => {
  assert.equal(isTransientGeminiError(new Error(SAMPLE_503_RAW)), true);
  assert.equal(extractErrorStatusCode(new Error(SAMPLE_503_RAW)), 503);
  assert.equal(isTransientGeminiError(new Error('429 RESOURCE_EXHAUSTED rate limit')), true);
  assert.equal(isTransientGeminiError(new Error('fetch failed: ECONNRESET')), true);
  assert.equal(isTransientGeminiError(new Error('401 API_KEY_INVALID')), false);
  assert.equal(isTransientGeminiError(new Error('Invalid argument schema')), false);
});

test('formats raw Google API JSON errors into clean Simplified Chinese messages', () => {
  const friendly503 = formatFriendlyGeminiError(new Error(SAMPLE_503_RAW));
  assert.ok(friendly503.includes('503'));
  assert.ok(!friendly503.includes('{"error"'));

  const friendly429 = formatFriendlyGeminiError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'));
  assert.ok(friendly429.includes('429'));
  assert.ok(!friendly429.includes('{"error"'));

  const friendly401 = formatFriendlyGeminiError(new Error('401 API_KEY_INVALID'));
  assert.ok(friendly401.includes('GEMINI_API_KEY'));
});

test('withGeminiRetry retries transient 503 errors with exponential backoff and succeeds', async () => {
  const delays: number[] = [];
  let calls = 0;

  const result = await withGeminiRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(SAMPLE_503_RAW);
      }
      return 'ok-after-retry';
    },
    {
      maxAttempts: 3,
      baseDelayMs: 100,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    }
  );

  assert.equal(result, 'ok-after-retry');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('withGeminiRetry does not retry non-transient 401 errors', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withGeminiRetry(
        async () => {
          calls += 1;
          throw new Error('401 API_KEY_INVALID');
        },
        {
          maxAttempts: 3,
          baseDelayMs: 50,
          sleepFn: async () => {},
        }
      ),
    /API_KEY_INVALID/
  );
  assert.equal(calls, 1);
});

test('withGeminiModelFallback switches from primary model to fallback model on persistent 503', async () => {
  const tried: string[] = [];
  const fallbacks: Array<{ from: string; to: string }> = [];

  const res = await withGeminiModelFallback(
    ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
    async (model) => {
      tried.push(model);
      if (model === 'gemini-4-hydrogen') {
        throw new Error(SAMPLE_503_RAW);
      }
      return { ok: true, used: model };
    },
    {
      retriesPerModel: 2,
      baseDelayMs: 10,
      sleepFn: async () => {},
      onFallback: ({ fromModel, toModel }) => {
        fallbacks.push({ from: fromModel, to: toModel });
      },
    }
  );

  assert.equal(res.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(res.value, { ok: true, used: 'gemini-3.1-flash-lite' });
  assert.deepEqual(tried, ['gemini-4-hydrogen', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
  assert.deepEqual(fallbacks, [{ from: 'gemini-4-hydrogen', to: 'gemini-3.1-flash-lite' }]);
});

test('withGeminiModelFallback throws clean Chinese message when all models return 503', async () => {
  await assert.rejects(
    () =>
      withGeminiModelFallback(
        ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
        async () => {
          throw new Error(SAMPLE_503_RAW);
        },
        {
          retriesPerModel: 2,
          baseDelayMs: 5,
          sleepFn: async () => {},
        }
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('503'));
      assert.ok(!err.message.includes('{"error"'));
      return true;
    }
  );
});
