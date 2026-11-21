/**
 * Pure utilities for extracting and validating the Coding Agent's final
 * user-facing chat window message, strictly filtering out raw GitHub Actions
 * terminal output, tool-call traces, and runner shell logs.
 */

export const FINAL_CHAT_START_MARKER = '<!-- AUTODEV-FINAL-CHAT-START -->';
export const FINAL_CHAT_END_MARKER = '<!-- AUTODEV-FINAL-CHAT-END -->';

export function stripAnsiCodes(input: string): string {
  return String(input || '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '');
}

/**
 * Heuristic check to prevent raw GitHub Actions / terminal / tool logs
 * from leaking into the user-facing Coding Agent chat preview.
 */
export function looksLikeRawActionsLog(text: string | undefined | null): boolean {
  if (!text) return true;
  const cleaned = stripAnsiCodes(text).trim();
  if (!cleaned) return true;

  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;

  const logLinePattern =
    /^(?:\[AutoDev\]|\[autodev-test-harness\]|\[Blind E2E\]|\[agy:(?:tool|error|stream|debug|session)\]|===\s*\[AutoDev\]|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|>\s*(?:npm|npx|git|wrangler|node|vite|tsc)\b|✓\s*built in\s+\d|npm\s+(?:warn|notice|ERR!)|added\s+\d+\s+packages|Run\s+actions\/|Workspace CWD:|session_id=)/i;

  let logLikeCount = 0;
  for (const line of lines) {
    if (logLinePattern.test(line)) {
      logLikeCount += 1;
    }
  }

  // If a notable portion of lines are runner/CLI logs, or it starts with runner banners
  if (logLikeCount >= 3 && logLikeCount / lines.length >= 0.25) {
    return true;
  }
  if (/^===\s*\[AutoDev\]|^\[AutoDev\]\s+Starting VPS AGY|^\[Blind E2E\]|^\[autodev-test-harness\]/i.test(cleaned)) {
    return true;
  }

  // Raw JSON event stream dump rather than natural language chat reply
  if (cleaned.startsWith('{') && cleaned.endsWith('}') && /"(?:type|session_id|tool_use|input_tokens)"/.test(cleaned)) {
    return true;
  }

  return false;
}

/**
 * Sanitizes a captured Coding Agent chat message, returning undefined if it is
 * empty or actually raw Actions/terminal logs.
 */
export function sanitizeCodingChatOutput(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = stripAnsiCodes(raw).trim();
  if (!cleaned) return undefined;
  if (looksLikeRawActionsLog(cleaned)) {
    return undefined;
  }
  return cleaned;
}

/**
 * Extracts ONLY the Coding Agent's final chat window message from a GitHub
 * live-log tracking comment body or stream snapshot.
 *
 * Strictly NEVER falls back to raw GitHub Actions / terminal log tails.
 */
export function extractCleanAssistantChatFromComment(
  rawBody: string | undefined | null,
  liveOutput?: string | undefined | null
): string | undefined {
  const body = stripAnsiCodes(rawBody || '');

  // 1. Primary structured chat marker emitted by AutoDev AGY Coding Runner
  const startIdx = body.indexOf(FINAL_CHAT_START_MARKER);
  const endIdx = body.indexOf(FINAL_CHAT_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const extracted = body
      .slice(startIdx + FINAL_CHAT_START_MARKER.length, endIdx)
      .trim();
    const clean = sanitizeCodingChatOutput(extracted);
    if (clean) return clean;
  }

  const streamText = stripAnsiCodes(liveOutput || body);
  if (!streamText.trim()) return undefined;

  const lines = streamText.split('\n');

  // 2. Check structured [agy:result] JSON response field
  const resultLines = lines.filter((line) => line.trim().startsWith('[agy:result]'));
  for (let i = resultLines.length - 1; i >= 0; i -= 1) {
    const payloadStr = resultLines[i].replace(/^\[agy:result\]\s*/, '').trim();
    try {
      const parsed = JSON.parse(payloadStr) as {
        result?: string | { response?: string; text?: string; content?: string };
        response?: string;
        text?: string;
      };
      const candidate =
        typeof parsed?.result === 'string'
          ? parsed.result
          : parsed?.result?.response ||
            parsed?.result?.text ||
            parsed?.result?.content ||
            parsed?.response ||
            parsed?.text;
      const clean = sanitizeCodingChatOutput(candidate);
      if (clean) return clean;
    } catch {
      // Ignore truncated JSON lines — never return raw JSON fragments
    }
  }

  // 3. Check contiguous final [agy] assistant chat lines emitted AFTER the last [agy:tool] call
  let lastToolIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('[agy:tool]') || trimmed.startsWith('[AutoDev]')) {
      lastToolIdx = i;
    }
  }
  const trailingAssistantLines = lines
    .slice(lastToolIdx + 1)
    .filter((line) => line.trim().startsWith('[agy] '))
    .map((line) => line.trim().replace(/^\[agy\]\s*/, ''));
  if (trailingAssistantLines.length > 0) {
    const joined = trailingAssistantLines.join('\n').trim();
    const clean = sanitizeCodingChatOutput(joined);
    if (clean) return clean;
  }

  // 4. Strictly DO NOT fall back to raw Actions / terminal output
  return undefined;
}
