import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  AUDIT_ACTION_LABELS,
  type AuditActionType,
  type AuditLogCategory,
  type AuditLogEntry,
} from '../src/lib/requirementsBoard';
import { scheduleGitHubStateSync } from './githubStateStore';

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit-logs-v1.json');

let logsCache: AuditLogEntry[] | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLogs(): AuditLogEntry[] {
  if (logsCache) return logsCache;
  try {
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        logsCache = parsed as AuditLogEntry[];
        return logsCache;
      }
    }
  } catch {
    // ignore corrupt cache
  }
  logsCache = [];
  return logsCache;
}

function persistLogs(next: AuditLogEntry[], skipRemoteSync = false): void {
  logsCache = next;
  try {
    ensureDataDir();
    fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    // ignore disk errors
  }
  if (!skipRemoteSync) {
    scheduleGitHubStateSync('auditLogs', next);
  }
}

export function reloadAuditLogsFromDisk(): void {
  logsCache = null;
  loadLogs();
}

export function listAuditLogs(): AuditLogEntry[] {
  return [...loadLogs()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function appendAuditLog(input: {
  category: AuditLogCategory;
  action: AuditActionType;
  label?: string;
  actor?: string;
  repoFullName: string;
  runId?: string;
  jobId?: string;
  prdTitle?: string;
  branch?: string;
  prNumber?: number;
  status?: 'success' | 'failed';
  detail: string;
}): AuditLogEntry {
  const current = loadLogs();
  const entry: AuditLogEntry = {
    id: `aud-${crypto.randomBytes(4).toString('hex')}`,
    timestamp: new Date().toISOString(),
    category: input.category,
    action: input.action,
    label: input.label || AUDIT_ACTION_LABELS[input.action],
    actor: input.actor || '控制面操作员',
    repoFullName: input.repoFullName,
    runId: input.runId,
    jobId: input.jobId,
    prdTitle: input.prdTitle,
    branch: input.branch,
    prNumber: input.prNumber,
    status: input.status || 'success',
    detail: input.detail.slice(0, 600),
  };
  const next = [entry, ...current].slice(0, 300);
  persistLogs(next);
  return entry;
}

export function clearAllAuditLogs(): number {
  const prevCount = loadLogs().length;
  persistLogs([]);
  return prevCount;
}
