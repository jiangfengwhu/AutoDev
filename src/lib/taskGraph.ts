import type { AtomicTask } from '../types/autodev';

export interface PrdValidationInput {
  repoFullName: string;
  prdTitle: string;
  prdContent: string;
}

export interface PrdValidationResult {
  valid: boolean;
  errors: {
    repoFullName?: string;
    prdTitle?: string;
    prdContent?: string;
  };
}

export interface ParsedRepoSlug {
  owner: string;
  name: string;
  fullName: string;
}

export interface TaskLayerResult {
  layers: AtomicTask[][];
  hasCycle: boolean;
  cycleTaskIds: string[];
  missingDependencies: Array<{ taskId: string; missingDepId: string }>;
}

const REPO_SLUG_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseRepoFullName(input: string): ParsedRepoSlug | null {
  const trimmed = input.trim();
  if (!REPO_SLUG_REGEX.test(trimmed)) {
    return null;
  }
  const [owner, name] = trimmed.split('/');
  if (!owner || !name || owner === '.' || owner === '..' || name === '.' || name === '..') {
    return null;
  }
  return { owner, name, fullName: `${owner}/${name}` };
}

export function validatePrdInput(input: PrdValidationInput): PrdValidationResult {
  const errors: PrdValidationResult['errors'] = {};

  if (!parseRepoFullName(input.repoFullName)) {
    errors.repoFullName = '请先在「环境与引擎装配」选择或输入有效的目标仓库（格式：owner/repo）';
  }

  const trimmedTitle = input.prdTitle.trim();
  if (trimmedTitle.length < 3) {
    errors.prdTitle = '需求标题至少需要 3 个字符';
  } else if (trimmedTitle.length > 120) {
    errors.prdTitle = '需求标题不能超过 120 个字符';
  }

  const trimmedContent = input.prdContent.trim();
  if (trimmedContent.length < 30) {
    errors.prdContent = 'PRD 内容至少需要 30 个字符，以便 Architect Agent 完成有效架构拆解';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function generateBranchName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
  return `autodev/feat-${stamp}`;
}

export function buildTaskLayers(tasks: AtomicTask[]): TaskLayerResult {
  const byId = new Map<string, AtomicTask>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }

  const missingDependencies: Array<{ taskId: string; missingDepId: string }> = [];
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of tasks) {
    const uniqueDeps = new Set(task.dependsOn || []);
    for (const depId of uniqueDeps) {
      if (depId === task.id) {
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
        continue;
      }
      if (!byId.has(depId)) {
        missingDependencies.push({ taskId: task.id, missingDepId: depId });
        continue;
      }
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      dependents.get(depId)!.push(task.id);
    }
  }

  const layers: AtomicTask[][] = [];
  const processed = new Set<string>();

  let currentWave = tasks
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .map((t) => t.id);

  while (currentWave.length > 0) {
    const waveTasks: AtomicTask[] = [];
    const nextWave: string[] = [];

    for (const id of currentWave) {
      if (processed.has(id)) continue;
      processed.add(id);
      const task = byId.get(id);
      if (task) waveTasks.push(task);

      for (const dependentId of dependents.get(id) ?? []) {
        const nextDeg = (inDegree.get(dependentId) ?? 1) - 1;
        inDegree.set(dependentId, nextDeg);
        if (nextDeg === 0) {
          nextWave.push(dependentId);
        }
      }
    }

    if (waveTasks.length > 0) {
      layers.push(waveTasks);
    }
    currentWave = nextWave;
  }

  const remaining = tasks.filter((t) => !processed.has(t.id));
  const hasCycle = remaining.length > 0;
  const cycleTaskIds = remaining.map((t) => t.id);

  if (remaining.length > 0) {
    layers.push(remaining);
  }

  return {
    layers,
    hasCycle,
    cycleTaskIds,
    missingDependencies,
  };
}
