export interface AgySessionSnapshot {
  sessionId?: string;
  branchName: string;
  actionsRunId?: number;
  exitCode: number;
  reused: boolean;
  consecutiveReuseCount: number;
  updatedAt: string;
}

export interface AgySessionPolicyDecision {
  mode: 'resume' | 'fresh';
  resumeSessionId?: string;
  nextConsecutiveReuseCount: number;
  reason: string;
}

export const MAX_CONSECUTIVE_AGY_SESSION_REUSE = 2;

/**
 * Pure policy deciding whether a rework / follow-up AGY coding run should resume
 * the previous VPS AGY session or reset to a clean fresh session.
 *
 * Rules:
 * 1. Never reuse if caller explicitly requests a fresh session (`forceFresh`).
 * 2. Never reuse if no previous session ID was captured for this branch.
 * 3. Never reuse if the previous run failed or timed out (`exitCode !== 0`) — prevents
 *    context pollution from error loops or 20m print_timeout partial turns.
 * 4. Never reuse more than MAX_CONSECUTIVE_AGY_SESSION_REUSE (2) times in a row —
 *    resets to a clean session backed by git branch code + docs/revision-feedback.md.
 */
export function decideAgySessionPolicy(params: {
  targetBranch: string;
  lastAgySession?: AgySessionSnapshot | null;
  forceFresh?: boolean;
}): AgySessionPolicyDecision {
  const { targetBranch, lastAgySession, forceFresh } = params;

  if (forceFresh) {
    return {
      mode: 'fresh',
      nextConsecutiveReuseCount: 0,
      reason: '人工指定重置全新 AGY 会话（基于当前分支代码与修改意见冷启动）',
    };
  }

  if (!lastAgySession || !lastAgySession.sessionId?.trim()) {
    return {
      mode: 'fresh',
      nextConsecutiveReuseCount: 0,
      reason: '当前分支尚无已落盘的可复用 AGY Session，启动全新会话并记录 Session ID',
    };
  }

  if (lastAgySession.branchName !== targetBranch) {
    return {
      mode: 'fresh',
      nextConsecutiveReuseCount: 0,
      reason: `分支已切换（${lastAgySession.branchName} → ${targetBranch}），启动全新会话`,
    };
  }

  if (lastAgySession.exitCode !== 0) {
    return {
      mode: 'fresh',
      nextConsecutiveReuseCount: 0,
      reason: `上一轮 AGY 退出异常（exit ${lastAgySession.exitCode}），为避免上下文污染自动重置全新会话`,
    };
  }

  if (lastAgySession.consecutiveReuseCount >= MAX_CONSECUTIVE_AGY_SESSION_REUSE) {
    return {
      mode: 'fresh',
      nextConsecutiveReuseCount: 0,
      reason: `原会话已连续复用 ${lastAgySession.consecutiveReuseCount} 轮（达上限 ${MAX_CONSECUTIVE_AGY_SESSION_REUSE} 轮），自动重置全新干净会话`,
    };
  }

  return {
    mode: 'resume',
    resumeSessionId: lastAgySession.sessionId.trim(),
    nextConsecutiveReuseCount: lastAgySession.consecutiveReuseCount + 1,
    reason: `上一轮正常完成（exit 0），复用原分支 AGY Session (${lastAgySession.sessionId.trim().slice(0, 12)}) 接续返工`,
  };
}
