export type BrowserNotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export type BrowserNotificationPermission = BrowserNotificationPermissionState;

export interface BrowserNotificationPayload {
  title: string;
  body: string;
  tag?: string;
  enabled?: boolean;
  onClick?: () => void;
}

const STORAGE_KEY = 'autodev:browser-notifications-enabled:v1';
const notifiedTags = new Map<string, number>();
const TAG_DEDUPE_TTL_MS = 15_000;

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}

export function getBrowserNotificationPermission(): BrowserNotificationPermissionState {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
}

export function loadBrowserNotificationsEnabled(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function saveBrowserNotificationsEnabled(enabled: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota or iframe restrictions
  }
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return getBrowserNotificationPermission();
  }
}

export function shouldDispatchBrowserNotification(params: {
  supported?: boolean;
  permission: BrowserNotificationPermissionState;
  enabled: boolean;
  tag?: string;
  nowMs?: number;
}): boolean {
  const supported = params.supported ?? true;
  if (!supported || !params.enabled || params.permission !== 'granted') {
    return false;
  }
  const nowMs = params.nowMs ?? Date.now();
  if (params.tag) {
    const last = notifiedTags.get(params.tag);
    if (last !== undefined && nowMs - last < TAG_DEDUPE_TTL_MS) {
      return false;
    }
    notifiedTags.set(params.tag, nowMs);
    if (notifiedTags.size > 120) {
      for (const [k, ts] of notifiedTags.entries()) {
        if (nowMs - ts >= TAG_DEDUPE_TTL_MS) notifiedTags.delete(k);
      }
    }
  }
  return true;
}

export function sendBrowserNotification(
  payload: BrowserNotificationPayload,
  enabledOverride?: boolean
): boolean {
  const supported = isBrowserNotificationSupported();
  const permission = getBrowserNotificationPermission();
  const enabled = enabledOverride ?? payload.enabled ?? loadBrowserNotificationsEnabled();

  if (
    !shouldDispatchBrowserNotification({
      supported,
      permission,
      enabled,
      tag: payload.tag,
    })
  ) {
    return false;
  }

  try {
    const notification = new window.Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      silent: false,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // non-fatal
      }
      payload.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function resetNotificationDedupeForTest(): void {
  notifiedTags.clear();
}
