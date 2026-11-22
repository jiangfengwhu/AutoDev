import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  FailureIncident,
  FailureIncidentSource,
  RsiAttributionDecision,
  RsiPersistedState,
  RsiRootCauseCategory,
  RsiRuleSeverity,
  RsiRuleStatus,
  RsiSystemRule,
  RsiTargetStage,
  TestExecutionReport,
} from '../src/lib/rsiEngine.ts';
import {
  applyRsiLifecycleHygiene,
  clampDirectiveLength,
  mergeOrCreateRsiRule,
  normalizeRuleDedupeKey,
  selectActiveRsiRulesForStage,
} from '../src/lib/rsiEngine.ts';
import { scheduleGitHubStateSync } from './githubStateStore.ts';

const DATA_DIR = path.join(process.cwd(), '.autodev-data');
const RSI_STORE_FILE = path.join(DATA_DIR, 'rsi-state-v1.json');

let stateCache: RsiPersistedState | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadState(): RsiPersistedState {
  if (stateCache) return stateCache;
  try {
    if (fs.existsSync(RSI_STORE_FILE)) {
      const raw = fs.readFileSync(RSI_STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<RsiPersistedState>;
      stateCache = {
        testReports: Array.isArray(parsed.testReports) ? parsed.testReports : [],
        incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
      };
      return stateCache;
    }
  } catch {
    // ignore corrupt disk cache
  }
  stateCache = {
    testReports: [],
    incidents: [],
    rules: [],
  };
  return stateCache;
}

function persistState(next: RsiPersistedState, skipRemoteSync = false): void {
  stateCache = next;
  try {
    ensureDataDir();
    fs.writeFileSync(RSI_STORE_FILE, JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    // ignore disk errors
  }
  if (!skipRemoteSync) {
    scheduleGitHubStateSync('rsi', next);
  }
}

export function reloadRsiStateFromDisk(): void {
  stateCache = null;
  loadState();
}

export function getRsiState(): RsiPersistedState {
  const s = loadState();
  return {
    testReports: [...s.testReports].sort(
      (a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt)
    ),
    incidents: [...s.incidents].sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
    ),
    rules: [...s.rules].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    lastSyncedAt: s.lastSyncedAt,
  };
}

export function setRsiLastSyncedAt(iso: string): void {
  const s = loadState();
  persistState({ ...s, lastSyncedAt: iso });
}

export function upsertTestReport(report: TestExecutionReport): TestExecutionReport {
  const s = loadState();
  const filtered = s.testReports.filter(
    (r) => r.id !== report.id && !(report.actionsRunId && r.actionsRunId === report.actionsRunId)
  );
  const nextReports = [report, ...filtered]
    .sort((a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt))
    .slice(0, 60);
  persistState({ ...s, testReports: nextReports });
  return report;
}

export function findIncidentBySourceRef(sourceRefKey: string): FailureIncident | undefined {
  return loadState().incidents.find((i) => i.sourceRefKey === sourceRefKey);
}

export function getIncidentById(incidentId: string): FailureIncident | undefined {
  return loadState().incidents.find((i) => i.id === incidentId);
}

export function recordIncident(input: {
  sourceRefKey: string;
  source: FailureIncidentSource;
  repoFullName: string;
  title: string;
  errorSummary: string;
  rawEvidence: string;
  relatedRunId?: string;
  relatedActionsRunId?: number;
  relatedActionsUrl?: string;
  branch?: string;
  occurredAt?: string;
}): { incident: FailureIncident; created: boolean } {
  const s = loadState();
  const existing = s.incidents.find((i) => i.sourceRefKey === input.sourceRefKey);
  if (existing) {
    return { incident: existing, created: false };
  }

  const incident: FailureIncident = {
    id: `inc-${crypto.randomBytes(4).toString('hex')}`,
    sourceRefKey: input.sourceRefKey,
    source: input.source,
    repoFullName: input.repoFullName,
    title: input.title.trim().slice(0, 180),
    errorSummary: input.errorSummary.trim().slice(0, 600),
    rawEvidence: input.rawEvidence.slice(0, 12000),
    relatedRunId: input.relatedRunId,
    relatedActionsRunId: input.relatedActionsRunId,
    relatedActionsUrl: input.relatedActionsUrl,
    branch: input.branch,
    occurredAt: input.occurredAt || new Date().toISOString(),
    analysisStatus: 'pending',
  };

  const nextIncidents = [incident, ...s.incidents].slice(0, 100);
  persistState({ ...s, incidents: nextIncidents });
  return { incident, created: true };
}

export function markIncidentAnalyzing(incidentId: string): FailureIncident | null {
  const s = loadState();
  const idx = s.incidents.findIndex((i) => i.id === incidentId);
  if (idx === -1) return null;
  const updated: FailureIncident = {
    ...s.incidents[idx],
    analysisStatus: 'analyzing',
    analysisError: undefined,
  };
  const next = [...s.incidents];
  next[idx] = updated;
  persistState({ ...s, incidents: next });
  return updated;
}

export function markIncidentAnalysisError(
  incidentId: string,
  errorMessage: string
): FailureIncident | null {
  const s = loadState();
  const idx = s.incidents.findIndex((i) => i.id === incidentId);
  if (idx === -1) return null;
  const updated: FailureIncident = {
    ...s.incidents[idx],
    analysisStatus: 'error',
    analysisError: errorMessage,
  };
  const next = [...s.incidents];
  next[idx] = updated;
  persistState({ ...s, incidents: next });
  return updated;
}

export function applyIncidentAttribution(
  incidentId: string,
  decision: RsiAttributionDecision
): {
  incident: FailureIncident | null;
  rule?: RsiSystemRule;
  ruleAction?: 'created' | 'merged';
  promotedFromCandidate?: boolean;
} {
  const s = loadState();
  const idx = s.incidents.findIndex((i) => i.id === incidentId);
  if (idx === -1) return { incident: null };

  let nextRules = applyRsiLifecycleHygiene(s.rules);
  let savedRule: RsiSystemRule | undefined;
  let ruleAction: 'created' | 'merged' | undefined;
  let promotedFromCandidate = false;
  const enrichedDecision: RsiAttributionDecision = { ...decision };

  if (decision.shouldCodifyAsRule && decision.suggestedRule) {
    const initialStatus: 'active' | 'candidate' =
      decision.appliedOutcome === 'candidate_created' ? 'candidate' : 'active';
    const explicitMergeRuleId =
      decision.appliedOutcome === 'merged'
        ? decision.decisionGate?.matchedRuleId || decision.mergedIntoRuleId
        : undefined;

    const res = mergeOrCreateRsiRule({
      existingRules: nextRules,
      candidate: {
        ...decision.suggestedRule,
        rootCauseCategory: decision.rootCauseCategory,
      },
      incidentId,
      newId: `rsi-${crypto.randomBytes(4).toString('hex')}`,
      initialStatus,
      explicitMergeRuleId,
    });
    nextRules = res.nextRules;
    savedRule = res.rule;
    ruleAction = res.action;
    promotedFromCandidate = Boolean(res.promotedFromCandidate);
    if (res.action === 'merged') {
      enrichedDecision.mergedIntoRuleId = res.rule.id;
      enrichedDecision.appliedOutcome = 'merged';
    } else {
      enrichedDecision.generatedRuleId = res.rule.id;
      enrichedDecision.appliedOutcome =
        res.rule.status === 'candidate' ? 'candidate_created' : 'active_created';
    }
  } else {
    enrichedDecision.appliedOutcome = 'discarded';
  }

  const updatedIncident: FailureIncident = {
    ...s.incidents[idx],
    analysisStatus: 'analyzed',
    analysisError: undefined,
    attribution: enrichedDecision,
  };
  const nextIncidents = [...s.incidents];
  nextIncidents[idx] = updatedIncident;

  persistState({
    ...s,
    incidents: nextIncidents,
    rules: nextRules,
  });

  return { incident: updatedIncident, rule: savedRule, ruleAction, promotedFromCandidate };
}

export function createManualRsiRule(input: {
  title: string;
  targetStage: RsiTargetStage;
  severity: RsiRuleSeverity;
  promptDirective: string;
  rootCauseCategory: RsiRootCauseCategory;
  status?: RsiRuleStatus;
}): RsiSystemRule {
  const s = loadState();
  const nowIso = new Date().toISOString();
  const rule: RsiSystemRule = {
    id: `rsi-${crypto.randomBytes(4).toString('hex')}`,
    dedupeKey: normalizeRuleDedupeKey(input.title, input.title),
    title: input.title.trim().slice(0, 60),
    targetStage: input.targetStage,
    severity: input.severity,
    status: input.status ?? 'active',
    promptDirective: clampDirectiveLength(input.promptDirective),
    rootCauseCategory: input.rootCauseCategory,
    sourceIncidentIds: [],
    hitCount: 1,
    appliedCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const nextRules = applyRsiLifecycleHygiene([rule, ...s.rules], nowIso);
  persistState({ ...s, rules: nextRules });
  return rule;
}

export function updateRsiRule(
  ruleId: string,
  patch: Partial<{
    title: string;
    targetStage: RsiTargetStage;
    severity: RsiRuleSeverity;
    status: RsiRuleStatus;
    promptDirective: string;
    rootCauseCategory: RsiRootCauseCategory;
  }>
): RsiSystemRule | null {
  const s = loadState();
  const idx = s.rules.findIndex((r) => r.id === ruleId);
  if (idx === -1) return null;

  const nowIso = new Date().toISOString();
  const updated: RsiSystemRule = {
    ...s.rules[idx],
    ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 60) } : {}),
    ...(patch.targetStage !== undefined ? { targetStage: patch.targetStage } : {}),
    ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.promptDirective !== undefined
      ? { promptDirective: clampDirectiveLength(patch.promptDirective) }
      : {}),
    ...(patch.rootCauseCategory !== undefined
      ? { rootCauseCategory: patch.rootCauseCategory }
      : {}),
    updatedAt: nowIso,
  };

  const nextRules = [...s.rules];
  nextRules[idx] = updated;
  persistState({ ...s, rules: applyRsiLifecycleHygiene(nextRules, nowIso) });
  return updated;
}

export function replaceConsolidatedRsiRules(
  distilled: Array<{
    title: string;
    targetStage: RsiTargetStage;
    severity: RsiRuleSeverity;
    promptDirective: string;
    rootCauseCategory: RsiRootCauseCategory;
    dedupeKey: string;
    sourceRuleIds: string[];
  }>
): { beforeCount: number; afterCount: number; rules: RsiSystemRule[] } {
  const s = loadState();
  const nowIso = new Date().toISOString();
  const eligibleOld = s.rules.filter((r) => r.status === 'active' || r.status === 'candidate');
  const untouched = s.rules.filter((r) => r.status !== 'active' && r.status !== 'candidate');
  const oldById = new Map(eligibleOld.map((r) => [r.id, r]));

  const nextActive: RsiSystemRule[] = distilled.map((item) => {
    const mergedSources = item.sourceRuleIds
      .map((id) => oldById.get(id))
      .filter((r): r is RsiSystemRule => Boolean(r));
    const hitCount = Math.max(
      1,
      mergedSources.reduce((sum, r) => sum + (r.hitCount || 1), 0)
    );
    const appliedCount = mergedSources.reduce((sum, r) => sum + (r.appliedCount || 0), 0);
    const sourceIncidentIds = Array.from(
      new Set(mergedSources.flatMap((r) => r.sourceIncidentIds || []))
    );
    const existingPrimary = mergedSources[0];

    return {
      id: existingPrimary?.id || `rsi-${crypto.randomBytes(4).toString('hex')}`,
      dedupeKey: normalizeRuleDedupeKey(item.dedupeKey, item.title),
      title: item.title.trim().slice(0, 60),
      targetStage: item.targetStage,
      severity: item.severity,
      status: 'active',
      promptDirective: clampDirectiveLength(item.promptDirective),
      rootCauseCategory: item.rootCauseCategory,
      sourceIncidentIds,
      hitCount,
      appliedCount,
      createdAt: existingPrimary?.createdAt || nowIso,
      updatedAt: nowIso,
      lastAppliedAt: existingPrimary?.lastAppliedAt,
    };
  });

  const finalRules = applyRsiLifecycleHygiene([...nextActive, ...untouched], nowIso);
  persistState({ ...s, rules: finalRules });
  return {
    beforeCount: eligibleOld.length,
    afterCount: nextActive.length,
    rules: finalRules,
  };
}

export function deleteRsiRule(ruleId: string): boolean {
  const s = loadState();
  const nextRules = s.rules.filter((r) => r.id !== ruleId);
  if (nextRules.length === s.rules.length) return false;
  persistState({ ...s, rules: nextRules });
  return true;
}

export function recordRulesAppliedForStage(stage: Exclude<RsiTargetStage, 'all'>): RsiSystemRule[] {
  const s = loadState();
  const selected = selectActiveRsiRulesForStage(s.rules, stage);
  if (selected.length === 0) return [];
  const selectedIds = new Set(selected.map((r) => r.id));
  const nowIso = new Date().toISOString();
  const nextRules = s.rules.map((r) =>
    selectedIds.has(r.id)
      ? { ...r, appliedCount: (r.appliedCount || 0) + 1, lastAppliedAt: nowIso }
      : r
  );
  persistState({ ...s, rules: nextRules });
  return selected;
}

export function listAllRsiRules(): RsiSystemRule[] {
  return [...loadState().rules];
}

export function deleteTestReportById(reportId: string): boolean {
  const s = loadState();
  const nextReports = s.testReports.filter((r) => r.id !== reportId);
  if (nextReports.length === s.testReports.length) return false;
  persistState({ ...s, testReports: nextReports });
  return true;
}

export function deleteIncidentById(incidentId: string): boolean {
  const s = loadState();
  const nextIncidents = s.incidents.filter((i) => i.id !== incidentId);
  if (nextIncidents.length === s.incidents.length) return false;
  persistState({ ...s, incidents: nextIncidents });
  return true;
}

export function clearRsiHistory(options: { keepRules?: boolean } = {}): {
  clearedReports: number;
  clearedIncidents: number;
  clearedRules: number;
} {
  const s = loadState();
  const clearedReports = s.testReports.length;
  const clearedIncidents = s.incidents.length;
  const clearedRules = options.keepRules ? 0 : s.rules.length;
  persistState({
    testReports: [],
    incidents: [],
    rules: options.keepRules ? s.rules : [],
    lastSyncedAt: undefined,
  });
  return { clearedReports, clearedIncidents, clearedRules };
}
