export const PRD_DRAFT_STORAGE_KEY = 'autodev_studio:prd_draft:v1';

export interface PrdDraftPayload {
  repoFullName: string;
  prdTitle: string;
  techStackHint: string;
  prdContent: string;
}

export interface StoredPrdDraft extends PrdDraftPayload {
  savedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // localStorage disabled or restricted
  }
  return null;
}

export function hasPrdDraftContent(draft: {
  prdTitle?: string;
  techStackHint?: string;
  prdContent?: string;
}): boolean {
  return Boolean(
    draft.prdTitle?.trim() ||
      draft.techStackHint?.trim() ||
      draft.prdContent?.trim()
  );
}

export function loadPrdDraft(
  storage?: StorageLike | null,
  expectedRepo?: string
): StoredPrdDraft | null {
  const store = resolveStorage(storage);
  if (!store) return null;

  try {
    const raw = store.getItem(PRD_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPrdDraft>;
    if (!parsed || typeof parsed !== 'object') return null;

    const repoFullName = typeof parsed.repoFullName === 'string' ? parsed.repoFullName : '';
    if (
      expectedRepo &&
      repoFullName &&
      repoFullName.toLowerCase() !== expectedRepo.toLowerCase()
    ) {
      return null;
    }

    const prdTitle = typeof parsed.prdTitle === 'string' ? parsed.prdTitle : '';
    const techStackHint =
      typeof parsed.techStackHint === 'string' ? parsed.techStackHint : '';
    const prdContent = typeof parsed.prdContent === 'string' ? parsed.prdContent : '';
    const savedAt =
      typeof parsed.savedAt === 'string' && parsed.savedAt
        ? parsed.savedAt
        : new Date().toISOString();

    if (!hasPrdDraftContent({ prdTitle, techStackHint, prdContent })) {
      return null;
    }

    return {
      repoFullName,
      prdTitle,
      techStackHint,
      prdContent,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function savePrdDraft(
  draft: PrdDraftPayload,
  storage?: StorageLike | null,
  now: Date = new Date()
): StoredPrdDraft | null {
  const store = resolveStorage(storage);
  if (!store) return null;

  if (!hasPrdDraftContent(draft)) {
    try {
      store.removeItem(PRD_DRAFT_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    return null;
  }

  const record: StoredPrdDraft = {
    repoFullName: draft.repoFullName,
    prdTitle: draft.prdTitle,
    techStackHint: draft.techStackHint,
    prdContent: draft.prdContent,
    savedAt: now.toISOString(),
  };

  try {
    store.setItem(PRD_DRAFT_STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function clearPrdDraft(storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(PRD_DRAFT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
