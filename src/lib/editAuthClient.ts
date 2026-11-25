export interface EditAuthMeta {
  source: 'env' | 'stored' | 'default';
  canChangePassword: boolean;
  envVarName: 'AUTODEV_EDIT_PASSWORD';
  updatedAt: string | null;
}

export interface EditAuthStatusResponse {
  unlocked: boolean;
  expiresAt: string | null;
  meta: EditAuthMeta;
}

type LockedListener = (reason: string) => void;

// Bearer token is kept strictly in JS memory (never localStorage or sessionStorage)
let memoryEditToken: string | null = null;
let interceptorInstalled = false;
const lockedListeners = new Set<LockedListener>();

const capturedNativeFetch: typeof fetch | null =
  typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;

export function getEditAuthToken(): string | null {
  return memoryEditToken;
}

export function setEditAuthToken(token: string | null): void {
  memoryEditToken = token && token.trim().length > 0 ? token.trim() : null;
}

export function clearEditAuthToken(): void {
  memoryEditToken = null;
}

export function subscribeEditAuthLocked(listener: LockedListener): () => void {
  lockedListeners.add(listener);
  return () => {
    lockedListeners.delete(listener);
  };
}

function notifyEditLocked(reason: string): void {
  for (const listener of lockedListeners) {
    try {
      listener(reason);
    } catch {
      // ignore listener errors
    }
  }
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isSameOriginApiRequest(rawUrl: string): boolean {
  if (rawUrl.startsWith('/api/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Auth-aware fetch wrapper that attaches the in-memory Bearer token to same-origin `/api/*`
 * requests and notifies listeners on `403 EDIT_LOCKED`, without relying on mutating `window.fetch`.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const baseFetch =
    capturedNativeFetch ??
    (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : null);

  if (!baseFetch) {
    throw new Error('Fetch API is unavailable in the current environment');
  }

  const urlStr = resolveRequestUrl(input);
  const isApi = isSameOriginApiRequest(urlStr);

  let nextInit = init;
  if (isApi && memoryEditToken) {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${memoryEditToken}`);
    }
    nextInit = { ...(init ?? {}), headers };
  }

  const res = await baseFetch(input, nextInit);

  if (isApi && res.status === 403) {
    try {
      const cloned = res.clone();
      const body = (await cloned.json()) as { code?: string; error?: string };
      if (body?.code === 'EDIT_LOCKED') {
        memoryEditToken = null;
        notifyEditLocked(
          body.error || '当前处于只读锁定状态，请先输入编辑密码解锁'
        );
      }
    } catch {
      // non-JSON 403 response
    }
  }

  return res;
}

/**
 * Best-effort global fetch wrapper for environments where `window.fetch` is writable or configurable.
 * Never throws when `window.fetch` is getter-only (e.g. sandboxed iframe runtimes).
 */
export function installEditAuthFetchInterceptor(): void {
  if (interceptorInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }
  interceptorInstalled = true;

  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (desc && !desc.writable && !desc.set) {
      if (desc.configurable) {
        Object.defineProperty(window, 'fetch', {
          value: apiFetch,
          configurable: true,
          writable: true,
        });
      }
      return;
    }
    window.fetch = apiFetch;
  } catch {
    // Sandboxed runtimes may expose a getter-only/non-configurable window.fetch;
    // all mutation callers invoke `apiFetch` directly so auth continues working seamlessly.
  }
}
