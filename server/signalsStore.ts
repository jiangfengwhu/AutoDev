import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ERROR_REOPEN_COOLDOWN_MS,
  computeProdErrorFingerprint,
  type FeedbackDecisionScores,
  type FeedbackRecord,
  type FeedbackStatus,
  type FeedbackTriageBatch,
  type ProdErrorAutofixBatch,
  type ProdErrorDecisionScores,
  type ProdErrorGroup,
  type ProdErrorStatus,
  type ValidatedFeedbackInput,
  type ValidatedProdErrorInput,
} from '../src/lib/signalsEngine.ts';
import { scheduleGitHubStateSync } from './githubStateStore.ts';

interface FeedbackStoreFile {
  records: FeedbackRecord[];
  batches: FeedbackTriageBatch[];
}

interface ProdErrorsStoreFile {
  groups: ProdErrorGroup[];
  batches: ProdErrorAutofixBatch[];
}

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback-v1.json');
const PROD_ERRORS_FILE = path.join(DATA_DIR, 'prod-errors-v1.json');

const MAX_FEEDBACK_RECORDS = 400;
const MAX_FEEDBACK_BATCHES = 80;
const MAX_ERROR_GROUPS = 250;
const MAX_ERROR_BATCHES = 100;

let feedbackRecords: FeedbackRecord[] = [];
let feedbackBatches: FeedbackTriageBatch[] = [];
let errorGroups: ProdErrorGroup[] = [];
let errorBatches: ProdErrorAutofixBatch[] = [];

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as T;
      }
    }
  } catch {
    // ignore corrupt local cache
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // non-fatal on read-only filesystem
  }
}

function loadFeedbackFromDisk(): void {
  const parsed = readJsonFile<Partial<FeedbackStoreFile>>(FEEDBACK_FILE, {});
  feedbackRecords = Array.isArray(parsed.records) ? parsed.records.slice(0, MAX_FEEDBACK_RECORDS) : [];
  feedbackBatches = Array.isArray(parsed.batches) ? parsed.batches.slice(0, MAX_FEEDBACK_BATCHES) : [];
}

function loadProdErrorsFromDisk(): void {
  const parsed = readJsonFile<Partial<ProdErrorsStoreFile>>(PROD_ERRORS_FILE, {});
  errorGroups = Array.isArray(parsed.groups) ? parsed.groups.slice(0, MAX_ERROR_GROUPS) : [];
  errorBatches = Array.isArray(parsed.batches) ? parsed.batches.slice(0, MAX_ERROR_BATCHES) : [];
}

function persistFeedback(): void {
  const payload: FeedbackStoreFile = {
    records: feedbackRecords.slice(0, MAX_FEEDBACK_RECORDS),
    batches: feedbackBatches.slice(0, MAX_FEEDBACK_BATCHES),
  };
  writeJsonFile(FEEDBACK_FILE, payload);
  scheduleGitHubStateSync('feedback', payload);
}

function persistProdErrors(): void {
  const payload: ProdErrorsStoreFile = {
    groups: errorGroups.slice(0, MAX_ERROR_GROUPS),
    batches: errorBatches.slice(0, MAX_ERROR_BATCHES),
  };
  writeJsonFile(PROD_ERRORS_FILE, payload);
  scheduleGitHubStateSync('prodErrors', payload);
}

loadFeedbackFromDisk();
loadProdErrorsFromDisk();

export function reloadSignalsFromDisk(): void {
  loadFeedbackFromDisk();
  loadProdErrorsFromDisk();
}

export function resetSignalsStores(): void {
  feedbackRecords = [];
  feedbackBatches = [];
  errorGroups = [];
  errorBatches = [];
  persistFeedback();
  persistProdErrors();
}

export function listFeedbackRecords(limit = 200): FeedbackRecord[] {
  return feedbackRecords.slice(0, limit);
}

export function getFeedbackRecordById(id: string): FeedbackRecord | undefined {
  return feedbackRecords.find((r) => r.id === id);
}

export function recordFeedbackItem(
  repoFullName: string,
  input: ValidatedFeedbackInput
): FeedbackRecord {
  const now = new Date().toISOString();
  const record: FeedbackRecord = {
    id: `fb-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    createdAt: now,
    updatedAt: now,
    repoFullName,
    content: input.content,
    categoryHint: input.categoryHint,
    pageRoute: input.pageRoute,
    appVersion: input.appVersion,
    userAgent: input.userAgent,
    reporterHash: input.reporterHash,
    metadata: input.metadata,
    status: 'pending',
  };
  feedbackRecords = [record, ...feedbackRecords].slice(0, MAX_FEEDBACK_RECORDS);
  persistFeedback();
  return record;
}

export function listFeedbackRecordsByRunId(runId: string): FeedbackRecord[] {
  return feedbackRecords.filter((r) => r.linkedRunId === runId);
}

export function listFeedbackRecordsByIds(ids: string[]): FeedbackRecord[] {
  if (ids.length === 0) return [];
  const set = new Set(ids);
  return feedbackRecords.filter((r) => set.has(r.id));
}

export function updateFeedbackRecord(
  id: string,
  patch: Partial<{
    status: FeedbackStatus;
    decisionScores: FeedbackDecisionScores;
    triageReason: string;
    triageBatchId: string;
    linkedJobId: string;
    linkedIssueNumber: number;
    linkedIssueUrl: string;
    linkedRunId: string;
    linkedPrNumber: number;
    linkedPrUrl: string;
    repliedStageKeys: string[];
  }>
): FeedbackRecord | null {
  const idx = feedbackRecords.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const updated: FeedbackRecord = {
    ...feedbackRecords[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  feedbackRecords[idx] = updated;
  persistFeedback();
  return updated;
}

export function markFeedbackStageReplied(id: string, stageKey: string): FeedbackRecord | null {
  const idx = feedbackRecords.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const existing = feedbackRecords[idx];
  const prevKeys = Array.isArray(existing.repliedStageKeys) ? existing.repliedStageKeys : [];
  if (prevKeys.includes(stageKey)) {
    return existing;
  }
  const updated: FeedbackRecord = {
    ...existing,
    repliedStageKeys: [...prevKeys, stageKey].slice(-30),
    updatedAt: new Date().toISOString(),
  };
  feedbackRecords[idx] = updated;
  persistFeedback();
  return updated;
}

export function listFeedbackBatches(limit = 40): FeedbackTriageBatch[] {
  return feedbackBatches.slice(0, limit);
}

export function getFeedbackBatchById(id: string): FeedbackTriageBatch | undefined {
  return feedbackBatches.find((b) => b.id === id);
}

export function saveFeedbackBatch(batch: FeedbackTriageBatch): FeedbackTriageBatch {
  const idx = feedbackBatches.findIndex((b) => b.id === batch.id);
  if (idx >= 0) {
    feedbackBatches[idx] = batch;
  } else {
    feedbackBatches = [batch, ...feedbackBatches].slice(0, MAX_FEEDBACK_BATCHES);
  }
  persistFeedback();
  return batch;
}

export function listProdErrorGroups(limit = 200): ProdErrorGroup[] {
  return errorGroups.slice(0, limit);
}

export function getProdErrorGroupById(id: string): ProdErrorGroup | undefined {
  return errorGroups.find((g) => g.id === id);
}

export function getProdErrorGroupByFingerprint(fingerprint: string): ProdErrorGroup | undefined {
  return errorGroups.find((g) => g.fingerprint === fingerprint);
}

export function upsertProdErrorOccurrence(
  repoFullName: string,
  input: ValidatedProdErrorInput
): {
  group: ProdErrorGroup;
  isNew: boolean;
  reopened: boolean;
} {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const fp = computeProdErrorFingerprint({
    source: input.source,
    errorName: input.errorName,
    message: input.message,
    stack: input.stack,
    route: input.route,
  });

  const existingIdx = errorGroups.findIndex((g) => g.fingerprint === fp.fingerprint);
  if (existingIdx >= 0) {
    const existing = errorGroups[existingIdx];
    let nextStatus: ProdErrorStatus = existing.status;
    let reopened = false;

    if (existing.status === 'resolved') {
      const resolvedMs = existing.resolvedAt ? new Date(existing.resolvedAt).getTime() : 0;
      if (!resolvedMs || nowMs - resolvedMs >= ERROR_REOPEN_COOLDOWN_MS) {
        nextStatus = 'new';
        reopened = true;
      }
    }

    const updated: ProdErrorGroup = {
      ...existing,
      occurrenceCount: existing.occurrenceCount + 1,
      lastSeenAt: nowIso,
      latestAppVersion: input.appVersion || existing.latestAppVersion,
      httpStatus: input.httpStatus ?? existing.httpStatus,
      rawMessageSample: input.message || existing.rawMessageSample,
      sanitizedStackSample: input.stack || existing.sanitizedStackSample,
      recentRequestContext: input.requestContext || existing.recentRequestContext,
      status: nextStatus,
      updatedAt: nowIso,
    };

    errorGroups.splice(existingIdx, 1);
    errorGroups = [updated, ...errorGroups].slice(0, MAX_ERROR_GROUPS);
    persistProdErrors();
    return { group: updated, isNew: false, reopened };
  }

  const created: ProdErrorGroup = {
    id: `err-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    fingerprint: fp.fingerprint,
    repoFullName,
    source: input.source,
    errorName: input.errorName,
    rawMessageSample: input.message,
    normalizedMessage: fp.normalizedMessage,
    topFrame: fp.topFrame,
    route: fp.route,
    environment: input.environment,
    httpStatus: input.httpStatus,
    occurrenceCount: 1,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    latestAppVersion: input.appVersion,
    sanitizedStackSample: input.stack,
    recentRequestContext: input.requestContext,
    status: 'new',
    updatedAt: nowIso,
  };

  errorGroups = [created, ...errorGroups].slice(0, MAX_ERROR_GROUPS);
  persistProdErrors();
  return { group: created, isNew: true, reopened: false };
}

export function updateProdErrorGroup(
  id: string,
  patch: Partial<{
    status: ProdErrorStatus;
    decisionScores: ProdErrorDecisionScores;
    triageReason: string;
    autofixBatchId: string;
    linkedJobId: string;
    linkedIssueNumber: number;
    linkedIssueUrl: string;
    linkedRunId: string;
    linkedPrNumber: number;
    linkedPrUrl: string;
    lastDispatchedAt: string;
    resolvedAt: string;
  }>
): ProdErrorGroup | null {
  const idx = errorGroups.findIndex((g) => g.id === id);
  if (idx < 0) return null;
  const updated: ProdErrorGroup = {
    ...errorGroups[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  errorGroups[idx] = updated;
  persistProdErrors();
  return updated;
}

export function markProdErrorsResolvedForRun(runId: string): number {
  const nowIso = new Date().toISOString();
  let count = 0;
  for (let i = 0; i < errorGroups.length; i += 1) {
    if (errorGroups[i].linkedRunId === runId && errorGroups[i].status !== 'resolved') {
      errorGroups[i] = {
        ...errorGroups[i],
        status: 'resolved',
        resolvedAt: nowIso,
        updatedAt: nowIso,
      };
      count += 1;
    }
  }
  if (count > 0) {
    persistProdErrors();
  }
  return count;
}

export function listProdErrorBatches(limit = 40): ProdErrorAutofixBatch[] {
  return errorBatches.slice(0, limit);
}

export function getProdErrorBatchById(id: string): ProdErrorAutofixBatch | undefined {
  return errorBatches.find((b) => b.id === id);
}

export function saveProdErrorBatch(batch: ProdErrorAutofixBatch): ProdErrorAutofixBatch {
  const idx = errorBatches.findIndex((b) => b.id === batch.id);
  if (idx >= 0) {
    errorBatches[idx] = batch;
  } else {
    errorBatches = [batch, ...errorBatches].slice(0, MAX_ERROR_BATCHES);
  }
  persistProdErrors();
  return batch;
}
