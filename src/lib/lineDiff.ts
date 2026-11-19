export type DiffLineType = 'unchanged' | 'added' | 'removed';

export interface DiffLine {
  type: DiffLineType;
  beforeLine: number | null;
  afterLine: number | null;
  content: string;
}

export interface DiffResult {
  lines: DiffLine[];
  stats: {
    added: number;
    removed: number;
    unchanged: number;
  };
}

function splitLines(code: string): string[] {
  const normalized = code.replace(/\r\n/g, '\n');
  if (normalized.length === 0) return [];
  return normalized.split('\n');
}

export function computeLineDiff(beforeCode: string, afterCode: string): DiffResult {
  const a = splitLines(beforeCode);
  const b = splitLines(afterCode);
  const m = a.length;
  const n = b.length;

  // Guard against extreme line counts with a fast linear fallback
  if (m * n > 2_500_000) {
    const lines: DiffLine[] = [
      ...a.map((content, idx) => ({
        type: 'removed' as const,
        beforeLine: idx + 1,
        afterLine: null,
        content,
      })),
      ...b.map((content, idx) => ({
        type: 'added' as const,
        beforeLine: null,
        afterLine: idx + 1,
        content,
      })),
    ];
    return {
      lines,
      stats: { added: n, removed: m, unchanged: 0 },
    };
  }

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({
        type: 'unchanged',
        beforeLine: i + 1,
        afterLine: j + 1,
        content: a[i],
      });
      unchanged++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({
        type: 'removed',
        beforeLine: i + 1,
        afterLine: null,
        content: a[i],
      });
      removed++;
      i++;
    } else {
      lines.push({
        type: 'added',
        beforeLine: null,
        afterLine: j + 1,
        content: b[j],
      });
      added++;
      j++;
    }
  }

  while (i < m) {
    lines.push({
      type: 'removed',
      beforeLine: i + 1,
      afterLine: null,
      content: a[i],
    });
    removed++;
    i++;
  }

  while (j < n) {
    lines.push({
      type: 'added',
      beforeLine: null,
      afterLine: j + 1,
      content: b[j],
    });
    added++;
    j++;
  }

  return {
    lines,
    stats: { added, removed, unchanged },
  };
}
