import crypto from 'crypto';
import type {
  BackgroundTask,
  BackgroundTaskKind,
  NavSectionId,
} from '../src/types/autodev.ts';

const MAX_RETAINED_TASKS = 40;

const tasksStore: BackgroundTask[] = [];

function trimOldTasks() {
  if (tasksStore.length <= MAX_RETAINED_TASKS) return;
  const running = tasksStore.filter((t) => t.status === 'running');
  const finished = tasksStore
    .filter((t) => t.status !== 'running')
    .slice(0, Math.max(0, MAX_RETAINED_TASKS - running.length));
  tasksStore.length = 0;
  tasksStore.push(...running, ...finished);
}

export function listBackgroundTasks(limit = 25): BackgroundTask[] {
  return [...tasksStore]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, Math.max(1, limit));
}

export function getBackgroundTaskById(taskId: string): BackgroundTask | undefined {
  return tasksStore.find((t) => t.id === taskId);
}

export function updateBackgroundTaskProgress(taskId: string, progressMessage: string): void {
  const target = tasksStore.find((t) => t.id === taskId);
  if (!target || target.status !== 'running') return;
  target.progressMessage = progressMessage;
  target.updatedAt = new Date().toISOString();
}

export interface EnqueueBackgroundTaskOptions<TResult = Record<string, unknown>> {
  kind: BackgroundTaskKind;
  title: string;
  roomId: NavSectionId;
  initialMessage: string;
  runId?: string;
  repoFullName?: string;
  dedupeKey?: string;
  executor: (helpers: {
    taskId: string;
    setProgress: (message: string) => void;
  }) => Promise<{ summary: string; result?: TResult }>;
}

/**
 * Enqueues a server-side background job completely detached from the HTTP request
 * lifecycle so navigating away, refreshing, or closing the browser tab never
 * interrupts execution.
 */
export function enqueueBackgroundTask<TResult = Record<string, unknown>>(
  options: EnqueueBackgroundTaskOptions<TResult>
): { task: BackgroundTask; deduplicated: boolean } {
  if (options.dedupeKey) {
    const existing = tasksStore.find(
      (t) => t.status === 'running' && t.dedupeKey === options.dedupeKey
    );
    if (existing) {
      return { task: { ...existing }, deduplicated: true };
    }
  }

  const now = new Date().toISOString();
  const task: BackgroundTask = {
    id: `task-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    kind: options.kind,
    title: options.title,
    roomId: options.roomId,
    status: 'running',
    progressMessage: options.initialMessage,
    startedAt: now,
    updatedAt: now,
    runId: options.runId,
    repoFullName: options.repoFullName,
    dedupeKey: options.dedupeKey,
  };

  tasksStore.unshift(task);
  trimOldTasks();

  // Launch completely detached from Express request/response lifecycle
  void (async () => {
    try {
      const outcome = await options.executor({
        taskId: task.id,
        setProgress: (msg: string) => updateBackgroundTaskProgress(task.id, msg),
      });
      const doneAt = new Date().toISOString();
      task.status = 'completed';
      task.summary = outcome.summary;
      task.progressMessage = outcome.summary;
      task.result = outcome.result as Record<string, unknown> | undefined;
      task.updatedAt = doneAt;
      task.completedAt = doneAt;
    } catch (err) {
      const failAt = new Date().toISOString();
      const message = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.error = message;
      task.progressMessage = message;
      task.updatedAt = failAt;
      task.completedAt = failAt;
    } finally {
      trimOldTasks();
    }
  })();

  return { task: { ...task }, deduplicated: false };
}

export function clearBackgroundTasksForTest(): void {
  tasksStore.length = 0;
}
