export const FIXED_TARGET_REPO = {
  fullName: 'jiangfengwhu/atd-v1',
  owner: 'jiangfengwhu',
  name: 'atd-v1',
  defaultBranch: 'main',
  htmlUrl: 'https://github.com/jiangfengwhu/atd-v1',
  isLiveGitHub: true,
} as const;

export const DEFAULT_CLOUDFLARE_TECH_STACK =
  'React + Vite + TypeScript (Cloudflare Workers Static Assets) + Hono API on Cloudflare Workers + Cloudflare D1 (SQLite) + Cloudflare KV';

export function resolveEffectiveTechStack(userHint?: string): {
  stack: string;
  isDefaultCloudflare: boolean;
} {
  const cleaned = (userHint ?? '').trim();
  if (cleaned.length > 0) {
    return { stack: cleaned, isDefaultCloudflare: false };
  }
  return { stack: DEFAULT_CLOUDFLARE_TECH_STACK, isDefaultCloudflare: true };
}

export const AGY_AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
] as const;

export const AUTODEV_WORKFLOW_PATH = '.github/workflows/autodev-agy.yml';
export const AUTODEV_DEPLOY_WORKFLOW_PATH = '.github/workflows/autodev-deploy-cf.yml';
export const AUTODEV_PLAN_WORKFLOW_PATH = '.github/workflows/autodev-plan.yml';
export const AUTODEV_PLAN_CHANNEL_BRANCH = 'autodev-plan-channel';
export const AUTODEV_LIVE_LOG_ISSUE_TITLE = '[AutoDev] Live AGY Execution Stream';
export const AUTODEV_PLAN_ISSUE_TITLE = '[AutoDev] AGY Plan Artifacts';

export function buildAgyRunnerWorkflowYaml(allowedActor: string = 'jiangfengwhu'): string {
  return `name: AutoDev AGY Coding Runner

on:
  workflow_dispatch:
    inputs:
      pr_branch:
        description: 'Target Draft PR branch containing docs/spec.json and read-only E2E test suite'
        required: true
        type: string
      pr_number:
        description: 'Draft PR number (optional, used for status comment)'
        required: false
        default: ''
        type: string
      run_id:
        description: 'AutoDev Studio Run ID'
        required: false
        default: ''
        type: string
      e2e_test_path:
        description: 'Read-only E2E test path for this iteration (defaults to spec.json or tests/e2e.spec.ts)'
        required: false
        default: ''
        type: string
      revision_note:
        description: 'Optional approval rework instructions when re-running after changes_requested'
        required: false
        default: ''
        type: string
      agy_model:
        description: 'AGY model ID configured on the VPS'
        required: false
        default: 'gemini-3.8-flash-high'
        type: choice
        options:
          - gemini-3.8-flash-high
          - gemini-3.8-flash-medium
          - claude-sonnet-4-6
          - claude-opus-4-6-thinking
          - gpt-oss-120b-medium
      session_mode:
        description: 'Conditional AGY session policy: fresh or resume'
        required: false
        default: 'fresh'
        type: string
      resume_session_id:
        description: 'Optional previous clean AGY session ID to resume on rework'
        required: false
        default: ''
        type: string
  pull_request:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

# Single-task repository-wide serial queue to guarantee fresh context across iterations
concurrency:
  group: autodev-agy-single-queue
  cancel-in-progress: false

jobs:
  agy-implement:
    # Security guard: only allow repo owner to trigger execution on the VPS self-hosted runner
    if: >-
      github.actor == '${allowedActor}' &&
      (github.event_name == 'workflow_dispatch' ||
       (github.event_name == 'pull_request' && github.event.label.name == 'autodev:run'))
    runs-on: [self-hosted, linux, x64, vps-agy]
    timeout-minutes: 30

    steps:
      - name: Resolve Target Branch
        id: target
        shell: bash
        run: |
          BRANCH="\${{ inputs.pr_branch || github.head_ref }}"
          MODEL="\${{ inputs.agy_model || 'gemini-3.8-flash-high' }}"
          PR_NUM="\${{ inputs.pr_number || github.event.pull_request.number || '' }}"
          E2E_PATH="\${{ inputs.e2e_test_path || '' }}"
          echo "branch=\${BRANCH}" >> "\$GITHUB_OUTPUT"
          echo "model=\${MODEL}" >> "\$GITHUB_OUTPUT"
          echo "pr_number=\${PR_NUM}" >> "\$GITHUB_OUTPUT"
          echo "e2e_test_path=\${E2E_PATH}" >> "\$GITHUB_OUTPUT"

      - name: Checkout PR Branch
        uses: actions/checkout@v7
        with:
          ref: \${{ steps.target.outputs.branch }}
          fetch-depth: 0

      - name: Verify VPS AGY CLI, Capabilities, Workspace & Lock All Read-Only E2E Contracts
        id: lock
        shell: bash
        run: |
          export PATH="\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
          echo "Workspace CWD: \$(pwd)"
          ls -la
          which agy
          agy --version
          echo "=== AGY CLI --help capabilities ==="
          agy --help 2>&1 | head -n 120 || true
          echo "==================================="

          LOCK_MANIFEST="/tmp/autodev-e2e-lock-\${{ github.run_id }}.sha256"
          : > "\${LOCK_MANIFEST}"
          if [ -f "tests/e2e.spec.ts" ]; then
            sha256sum "tests/e2e.spec.ts" >> "\${LOCK_MANIFEST}"
          fi
          if [ -d "tests/e2e" ]; then
            find tests/e2e -type f -name '*.spec.ts' | sort | while read -r f; do
              sha256sum "\${f}" >> "\${LOCK_MANIFEST}"
            done
          fi
          if [ -f "docs/spec.json" ]; then
            sha256sum "docs/spec.json" >> "\${LOCK_MANIFEST}"
          fi
          echo "lock_manifest=\${LOCK_MANIFEST}" >> "\$GITHUB_OUTPUT"
          echo "Locked read-only contract files:"
          cat "\${LOCK_MANIFEST}" || true

          if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
            echo "Installing project dependencies before AGY coding & deterministic verification..."
            npm ci --no-audit --no-fund || npm install --no-audit --no-fund
          fi

      - name: Execute AGY Outer-Loop Harness (Sentinel Watchdog + 4-Gate Deterministic Verifier)
        id: agy
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          LIVE_REPO: \${{ github.repository }}
          LIVE_RUN_ID: \${{ github.run_id }}
          LIVE_BRANCH: \${{ steps.target.outputs.branch }}
          LIVE_MODEL: \${{ steps.target.outputs.model }}
          LIVE_PR_NUM: \${{ steps.target.outputs.pr_number }}
          LIVE_PIPELINE_ID: \${{ inputs.run_id }}
          REVISION_NOTE: \${{ inputs.revision_note }}
          ACTIVE_E2E_PATH: \${{ steps.target.outputs.e2e_test_path }}
          SESSION_MODE: \${{ inputs.session_mode || 'fresh' }}
          RESUME_SESSION_ID: \${{ inputs.resume_session_id || '' }}
          LOCK_MANIFEST: \${{ steps.lock.outputs.lock_manifest }}
          REPORT_CHANNEL_BRANCH: '${AUTODEV_PLAN_CHANNEL_BRANCH}'
          MAX_ROUNDS: '3'
          ROUND_TIMEOUT_MINUTES: '9'
          CI: 'true'
          PLAYWRIGHT_HTML_OPEN: 'never'
        shell: bash
        run: |
          export PATH="\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
          LOG_FILE="/tmp/autodev-agy-\${LIVE_RUN_ID}.log"
          : > "\${LOG_FILE}"

          cat > /tmp/autodev-outer-harness.mjs <<'OUTER_HARNESS_EOF'
          import fs from 'fs';
          import path from 'path';
          import { execSync, spawn, spawnSync } from 'child_process';

          const token = process.env.GH_TOKEN || '';
          const repo = process.env.LIVE_REPO || '';
          const actionsRunId = Number(process.env.LIVE_RUN_ID || 0);
          const branch = process.env.LIVE_BRANCH || 'main';
          const model = process.env.LIVE_MODEL || 'gemini-3.8-flash-high';
          const prNumber = process.env.LIVE_PR_NUM ? Number(process.env.LIVE_PR_NUM) : undefined;
          const pipelineRunId = process.env.LIVE_PIPELINE_ID || undefined;
          const revisionNote = (process.env.REVISION_NOTE || '').trim();
          const sessionMode = (process.env.SESSION_MODE || 'fresh').trim();
          const resumeSessionId = (process.env.RESUME_SESSION_ID || '').trim();
          const lockManifest = (process.env.LOCK_MANIFEST || '').trim();
          const channelBranch = process.env.REPORT_CHANNEL_BRANCH || '${AUTODEV_PLAN_CHANNEL_BRANCH}';
          const logFile = process.env.LOG_FILE || '/tmp/autodev-agy.log';
          const maxRounds = Math.max(1, Math.min(4, Number(process.env.MAX_ROUNDS || 3)));
          const roundTimeoutMin = Math.max(3, Math.min(12, Number(process.env.ROUND_TIMEOUT_MINUTES || 7)));
          const sentinelFile = '.autodev-agent-done.json';
          const feedbackFile = '.autodev-verify-feedback.md';
          const issueTitle = '${AUTODEV_LIVE_LOG_ISSUE_TITLE}';
          const marker = '<!-- AUTODEV-LIVE-LOG:' + actionsRunId + ' -->';
          const startedAt = Date.now();

          let issueNumber = null;
          let issueCommentCount = 0;
          let commentId = null;
          let currentPhaseLabel = 'RUNNING (Round 1/' + maxRounds + ')';

          function appendLog(line) {
            const text = String(line || '');
            process.stdout.write(text.endsWith('\\n') ? text : text + '\\n');
            try {
              fs.appendFileSync(logFile, text.endsWith('\\n') ? text : text + '\\n');
            } catch {}
          }

          const ghHeaders = {
            Authorization: 'Bearer ' + token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            Connection: 'close',
          };

          async function gh(apiPath, options = {}) {
            if (!token || !repo) return null;
            try {
              const res = await fetch('https://api.github.com' + apiPath, {
                ...options,
                headers: ghHeaders,
                signal: AbortSignal.timeout(20000),
              });
              if (!res.ok) return null;
              return await res.json().catch(() => null);
            } catch {
              return null;
            }
          }

          async function ensureIssue() {
            if (issueNumber) return issueNumber;
            const issues = await gh('/repos/' + repo + '/issues?state=open&per_page=30');
            if (Array.isArray(issues)) {
              const found = issues.find((i) => !i.pull_request && i.title === issueTitle);
              if (found) {
                issueNumber = found.number;
                issueCommentCount = Number(found.comments || 0);
                return issueNumber;
              }
            }
            const created = await gh('/repos/' + repo + '/issues', {
              method: 'POST',
              body: JSON.stringify({
                title: issueTitle,
                body: 'AutoDev Studio 实时 AGY 执行日志流（系统自动维护，请勿手动删除）。',
              }),
            });
            if (created && created.number) {
              issueNumber = created.number;
              issueCommentCount = 0;
            }
            return issueNumber;
          }

          function getCleanGitStatusLines() {
            try {
              return execSync('git status --porcelain', { encoding: 'utf8' })
                .split('\\n')
                .map((l) => l.trimEnd())
                .filter((l) => l && !l.includes(sentinelFile) && !l.includes(feedbackFile));
            } catch {
              return [];
            }
          }

          function buildLiveCommentBody(stateLabel) {
            const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            const changedLines = getCleanGitStatusLines();
            let logText = '';
            try {
              const raw = fs.readFileSync(logFile, 'utf8');
              const clean = raw
                .replace(/\\x1b\\[[0-9;]*[a-zA-Z]/g, '')
                .replace(/\\r/g, '')
                .replace(/~~~~/g, '----');
              logText = clean.split('\\n').slice(-110).join('\\n').slice(-24000);
            } catch {}
            const filesSection = (
              changedLines.join('\\n') || '(尚未产生文件变更，AGY 正在阅读需求并规划实现…)'
            ).replace(/~~~~/g, '----');
            const outputSection =
              logText.trim() ||
              '(AutoDev Outer-Loop Harness 已启动，正在派发 AGY 编码回合…)';
            return [
              marker,
              '### AutoDev VPS AGY Live Stream',
              '- Status: ' + stateLabel,
              '- Run ID: ' + actionsRunId,
              '- Branch: ' + branch,
              '- Model: ' + model,
              '- Workspace: ' + process.cwd(),
              '- Elapsed: ' + elapsedSec + 's',
              '- Updated: ' + new Date().toISOString(),
              '',
              '#### Changed Files (git status --short)',
              '~~~~text',
              filesSection,
              '~~~~',
              '',
              '#### Live AGY Output',
              '~~~~text',
              outputSection,
              '~~~~',
            ].join('\\n');
          }

          async function syncLiveComment(stateLabel) {
            if (!token || !repo) return;
            const num = await ensureIssue();
            if (!num) return;
            const body = buildLiveCommentBody(stateLabel);
            if (!commentId) {
              const lastPage = Math.max(1, Math.ceil((issueCommentCount || 1) / 100));
              const pagesToCheck = lastPage > 1 ? [lastPage, lastPage - 1] : [1];
              for (const page of pagesToCheck) {
                const comments = await gh('/repos/' + repo + '/issues/' + num + '/comments?per_page=100&page=' + page);
                if (Array.isArray(comments)) {
                  const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));
                  if (existing) {
                    commentId = existing.id;
                    break;
                  }
                }
              }
            }
            if (commentId) {
              await gh('/repos/' + repo + '/issues/comments/' + commentId, {
                method: 'PATCH',
                body: JSON.stringify({ body }),
              });
            } else {
              const created = await gh('/repos/' + repo + '/issues/' + num + '/comments', {
                method: 'POST',
                body: JSON.stringify({ body }),
              });
              if (created && created.id) {
                commentId = created.id;
                issueCommentCount += 1;
              }
            }
          }

          function removeEphemeralFiles() {
            for (const f of [sentinelFile, feedbackFile]) {
              try {
                if (fs.existsSync(f)) fs.rmSync(f, { force: true });
              } catch {}
            }
          }

          function detectAgyCapabilities() {
            const helpRes = spawnSync('agy', ['--help'], { encoding: 'utf8', timeout: 15000 });
            const helpText = ((helpRes.stdout || '') + '\\n' + (helpRes.stderr || '')).trim();
            return {
              supportsResume: helpText.includes('--resume'),
              supportsStreamJson: helpText.includes('stream-json'),
              supportsOutputFormat: helpText.includes('--output-format'),
              supportsMaxTurns: helpText.includes('--max-turns'),
            };
          }

          function buildRoundPrompt(round) {
            const hasRev = fs.existsSync('docs/revision-feedback.md') || Boolean(revisionNote);
            const revBlock = hasRev
              ? 'CRITICAL REWORK MODE: Read docs/revision-feedback.md thoroughly (if present) and prioritize resolving EVERY requested fix: ' + revisionNote
              : '';

            const commonSeparationRules = [
              'CRITICAL EXECUTION BOUNDARY (OUTER-LOOP HARNESS ARCHITECTURE):',
              '- DO NOT run \`npx playwright test\`, \`npm run dev\`, \`wrangler dev\`, or start ANY server/watch/background process inside your turn.',
              '- The external AutoDev Outer-Loop Harness will automatically run \`npm run build\`, \`tsc --noEmit\`, and the full Playwright E2E test suite immediately after you finish, and will invoke a focused follow-up round with exact failure traces if anything fails.',
              '- You may optionally run fast, finite foreground static checks ONLY (e.g. \`npx tsc --noEmit\`), and NEVER spawn background tasks.',
              '- STRICT READ-ONLY CONTRACT: Do NOT modify, weaken, or delete docs/spec.json, tests/e2e.spec.ts, or ANY file inside tests/e2e/.',
              '- MANDATORY COMPLETION SENTINEL: As your VERY LAST action after finishing all code edits, write a small JSON file \`' + sentinelFile + '\` in the repository root with \`{"done": true, "round": ' + round + ', "summary": "<1-line Chinese summary>"}\` and immediately end your turn.',
            ].join('\\n');

            if (round === 1) {
              return [
                'You are executing Round 1/' + maxRounds + ' inside AutoDev Studio Outer-Loop Pipeline on branch ' + branch + '.',
                'Current working directory is the root of this repository.',
                'Read docs/prd.md, docs/spec.json, docs/rsi-guidelines.md (if present), any docs/revision-feedback.md, and all read-only Playwright E2E tests under tests/e2e/ (and tests/e2e.spec.ts if present) thoroughly.',
                revBlock,
                '',
                'Engineering Requirements:',
                '1. INCREMENTAL ITERATION RULE: Inspect the existing codebase first. Preserve all previously working features, existing API contracts, and historical regression tests under tests/e2e/. Do NOT rewrite unrelated working modules from scratch.',
                '2. RSI GUARDRAILS: If docs/rsi-guidelines.md exists, strictly obey every engineering guardrail inside it.',
                '3. Implement all atomic tasks and API contracts defined in docs/spec.json in clean, modular, production-ready code.',
                '4. Cloudflare Deployment & D1 Migration Standard (when targeting Cloudflare Workers): maintain valid wrangler.toml with Static Assets, Hono TypeScript API entry, and append-only idempotent D1 SQL migrations (CREATE TABLE IF NOT EXISTS).',
                '5. Keep git working tree clean of temporary logs or build artifacts.',
                '',
                commonSeparationRules,
              ].filter(Boolean).join('\\n');
            }

            return [
              'You are executing Auto-Fix Round ' + round + '/' + maxRounds + ' inside AutoDev Studio Outer-Loop Pipeline on branch ' + branch + '.',
              'The external deterministic verifier ran build + full Playwright E2E tests after the previous round and found specific failures.',
              'Read \`' + feedbackFile + '\` FIRST — it contains the exact failing test names, error messages, and build/typecheck logs.',
              'Also respect docs/rsi-guidelines.md (if present) and all read-only tests under tests/e2e/.',
              '',
              'Focus strictly on fixing EVERY failure listed in \`' + feedbackFile + '\` without breaking already-passing tests or modifying any read-only test/spec file.',
              '',
              commonSeparationRules,
            ].join('\\n');
          }

          function killProcessGroup(pid) {
            if (!pid) return;
            try {
              process.kill(-pid, 'SIGTERM');
            } catch {
              try {
                process.kill(pid, 'SIGTERM');
              } catch {}
            }
            setTimeout(() => {
              try {
                process.kill(-pid, 'SIGKILL');
              } catch {
                try {
                  process.kill(pid, 'SIGKILL');
                } catch {}
              }
            }, 3000).unref();
          }

          function runAgyRound({ round, prompt, resumeId, useStreamJson = false }) {
            return new Promise((resolve) => {
              try {
                if (fs.existsSync(sentinelFile)) fs.rmSync(sentinelFile, { force: true });
              } catch {}

              const args = [
                '--dangerously-skip-permissions',
                '--model',
                model,
                '--print-timeout',
                roundTimeoutMin + 'm',
              ];
              if (useStreamJson) {
                args.push('--output-format', 'stream-json');
              }
              if (resumeId) {
                args.push('--resume', resumeId);
              }
              args.push('--print=' + prompt);

              appendLog(
                '=== [Outer Harness] Starting AGY Round ' + round + '/' + maxRounds +
                ' (timeout ' + roundTimeoutMin + 'm' +
                (useStreamJson ? ', stream-json' : '') +
                (resumeId ? ', resume ' + resumeId : ', fresh session') + ') ==='
              );

              const child = spawn('agy', args, {
                cwd: process.cwd(),
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                  ...process.env,
                  CI: 'true',
                  PLAYWRIGHT_HTML_OPEN: 'never',
                },
              });

              let combinedOut = '';
              let lineBuf = '';
              let idleDetectedAt = null;
              let sentinelDetectedAt = null;
              let streamResultDetectedAt = null;
              let earlyStopReason = '';
              let settled = false;
              const roundStart = Date.now();
              const hardWallMs = (roundTimeoutMin + 1) * 60 * 1000;

              const formatStreamJsonLine = (rawLine) => {
                const trimmed = rawLine.trim();
                if (!trimmed) return '';
                if (!trimmed.startsWith('{')) return rawLine;
                try {
                  const ev = JSON.parse(trimmed);
                  const evType = String(ev.type || ev.event || '');
                  if (ev.session_id || ev.sessionId) {
                    combinedOut += '\\nsession_id=' + String(ev.session_id || ev.sessionId) + '\\n';
                  }
                  if (evType === 'result' || evType === 'turn_complete' || evType === 'done') {
                    if (!streamResultDetectedAt) streamResultDetectedAt = Date.now();
                    const msg = typeof ev.result === 'string' ? ev.result.slice(0, 300) : JSON.stringify(ev).slice(0, 300);
                    return '[agy:result] ' + msg;
                  }
                  if (evType === 'tool_use' || evType === 'tool_call' || ev.tool_name || ev.name) {
                    const toolName = String(ev.tool_name || ev.name || ev.tool?.name || 'tool');
                    const inputPreview = JSON.stringify(ev.input || ev.arguments || ev.args || {}).slice(0, 180);
                    return '[agy:tool] ' + toolName + ' ' + inputPreview;
                  }
                  if (evType === 'assistant' && ev.message) {
                    const blocks = Array.isArray(ev.message.content) ? ev.message.content : [];
                    const parts = [];
                    for (const b of blocks) {
                      if (b?.type === 'tool_use') {
                        parts.push('[agy:tool] ' + String(b.name || 'tool') + ' ' + JSON.stringify(b.input || {}).slice(0, 160));
                      } else if (b?.type === 'text' && b.text) {
                        parts.push('[agy] ' + String(b.text).replace(/\\s+/g, ' ').slice(0, 240));
                      }
                    }
                    if (parts.length > 0) return parts.join('\\n');
                  }
                  if (evType === 'text' || evType === 'delta' || typeof ev.text === 'string' || typeof ev.delta === 'string') {
                    const t = String(ev.text || ev.delta || '').trim();
                    return t ? '[agy] ' + t.slice(0, 240) : '';
                  }
                  if (evType === 'error' || ev.error) {
                    return '[agy:error] ' + String(ev.error?.message || ev.error || trimmed).slice(0, 300);
                  }
                  return '';
                } catch {
                  return rawLine;
                }
              };

              const onChunk = (buf) => {
                const text = buf.toString('utf8');
                combinedOut += text;
                if (combinedOut.length > 250000) {
                  combinedOut = combinedOut.slice(-250000);
                }
                if (!idleDetectedAt && /root agent idle; waiting up to/i.test(text)) {
                  idleDetectedAt = Date.now();
                  appendLog('[Outer Harness] Detected AGY root-agent-idle waiting for background task; arming 25s watchdog.');
                }
                if (!useStreamJson) {
                  process.stdout.write(text);
                  try {
                    fs.appendFileSync(logFile, text);
                  } catch {}
                  return;
                }
                lineBuf += text;
                const lines = lineBuf.split('\\n');
                lineBuf = lines.pop() || '';
                for (const l of lines) {
                  const formatted = formatStreamJsonLine(l);
                  if (formatted) {
                    process.stdout.write(formatted + '\\n');
                    try {
                      fs.appendFileSync(logFile, formatted + '\\n');
                    } catch {}
                  }
                }
              };

              child.stdout.on('data', onChunk);
              child.stderr.on('data', onChunk);

              let lastGitSnapshot = getCleanGitStatusLines().join('|');
              let lastGitChangeAt = Date.now();

              const watchdog = setInterval(() => {
                if (settled) return;
                const now = Date.now();
                const curGit = getCleanGitStatusLines().join('|');
                if (curGit !== lastGitSnapshot) {
                  lastGitSnapshot = curGit;
                  lastGitChangeAt = now;
                }

                // 1. Completion Sentinel Watchdog: once AGY writes .autodev-agent-done.json, allow 12s grace then cleanly stop process group
                if (!sentinelDetectedAt && fs.existsSync(sentinelFile)) {
                  try {
                    const content = fs.readFileSync(sentinelFile, 'utf8').trim();
                    if (content.length > 2) {
                      sentinelDetectedAt = now;
                      appendLog('[Outer Harness] Completion sentinel ' + sentinelFile + ' detected; allowing 12s grace for clean AGY exit.');
                    }
                  } catch {}
                }
                if (sentinelDetectedAt && now - sentinelDetectedAt >= 12000) {
                  earlyStopReason = 'sentinel_grace_elapsed';
                  appendLog('[Outer Harness] Stopping AGY process group cleanly after completion sentinel grace window.');
                  killProcessGroup(child.pid);
                  return;
                }
                if (streamResultDetectedAt && now - streamResultDetectedAt >= 15000) {
                  earlyStopReason = 'stream_result_grace_elapsed';
                  appendLog('[Outer Harness] Stopping AGY process group cleanly after stream-json result event.');
                  killProcessGroup(child.pid);
                  return;
                }

                // 2. Root-Agent-Idle Watchdog: if AGY is idling on a leaked background task and repo edits have stabilized for 25s
                if (idleDetectedAt && now - idleDetectedAt >= 25000 && now - lastGitChangeAt >= 15000) {
                  earlyStopReason = 'root_agent_idle_watchdog';
                  appendLog('[Outer Harness] Terminating stalled AGY process group stuck in root-agent-idle background wait.');
                  killProcessGroup(child.pid);
                  return;
                }

                // 3. Hard outer wall-clock timeout
                if (now - roundStart >= hardWallMs) {
                  earlyStopReason = 'hard_round_wall_timeout';
                  appendLog('[Outer Harness] Hard round wall timeout (' + (roundTimeoutMin + 1) + 'm) reached; terminating AGY process group.');
                  killProcessGroup(child.pid);
                }
              }, 2000);

              const finish = (exitCode) => {
                if (settled) return;
                settled = true;
                clearInterval(watchdog);
                killProcessGroup(child.pid);

                const sessionMatch = combinedOut.match(/(?:session[_ -]?id|sessionId|session)[\\s:=]+([A-Za-z0-9_-]{8,64})/i);
                const capturedSessionId = sessionMatch ? sessionMatch[1] : undefined;
                const sentinelWritten = fs.existsSync(sentinelFile);
                let sentinelSummary = '';
                if (sentinelWritten) {
                  try {
                    const parsed = JSON.parse(fs.readFileSync(sentinelFile, 'utf8'));
                    sentinelSummary = String(parsed?.summary || '');
                  } catch {}
                }
                resolve({
                  exitCode: exitCode ?? 1,
                  elapsedMs: Date.now() - roundStart,
                  capturedSessionId,
                  sentinelWritten,
                  sentinelSummary,
                  earlyStopReason,
                });
              };

              child.on('error', (err) => {
                appendLog('[Outer Harness] AGY spawn error: ' + String(err));
                finish(1);
              });
              child.on('close', (code) => {
                finish(code ?? 1);
              });
            });
          }

          function runDeterministicVerification(round) {
            const startedAll = Date.now();
            const cases = [];
            let kind = 'build_check';
            let rawLog = '';
            let contractOk = true;

            try {
              if (fs.existsSync(sentinelFile)) fs.rmSync(sentinelFile, { force: true });
            } catch {}

            // Gate 1: Read-Only Contract Hash Integrity
            if (lockManifest && fs.existsSync(lockManifest) && fs.statSync(lockManifest).size > 0) {
              const t0 = Date.now();
              const chk = spawnSync('sha256sum', ['-c', lockManifest], { encoding: 'utf8', timeout: 30000 });
              const durationMs = Date.now() - t0;
              if (chk.status !== 0) {
                contractOk = false;
                const out = ((chk.stderr || '') + '\\n' + (chk.stdout || '')).trim();
                rawLog += '\\n=== Read-Only Contract Violation ===\\n' + out;
                cases.push({
                  id: 'gate-contract',
                  title: '只读测试与规格契约完整性校验 (sha256sum -c)',
                  status: 'failed',
                  durationMs,
                  error: '严禁修改 docs/spec.json 或 tests/e2e/ 只读测试文件，已自动还原：' + out.slice(0, 400),
                });
                spawnSync('git', ['checkout', '--', 'docs/spec.json', 'tests/e2e.spec.ts', 'tests/e2e'], { stdio: 'ignore' });
              } else {
                cases.push({
                  id: 'gate-contract',
                  title: '只读测试与规格契约完整性校验 (sha256sum -c)',
                  status: 'passed',
                  durationMs,
                });
              }
            }

            const runCheck = (id, title, cmd, args, timeoutMs = 180000) => {
              const t0 = Date.now();
              const res = spawnSync(cmd, args, {
                encoding: 'utf8',
                timeout: timeoutMs,
                env: { ...process.env, CI: 'true', PLAYWRIGHT_HTML_OPEN: 'never' },
              });
              const durationMs = Date.now() - t0;
              const combined = ((res.stderr || '') + '\\n' + (res.stdout || '')).trim();
              rawLog += '\\n=== ' + title + ' ===\\n' + combined.slice(-2000);
              cases.push({
                id,
                title,
                status: res.status === 0 ? 'passed' : 'failed',
                durationMs,
                ...(res.status === 0 ? {} : { error: combined.slice(-600) || 'Exit code ' + res.status }),
              });
              return res.status === 0;
            };

            // Gate 2: Dependencies, Typecheck, Build & Unit Tests
            if (fs.existsSync('package.json')) {
              if (!fs.existsSync('node_modules')) {
                runCheck('check-deps', '安装项目依赖 (npm ci)', 'npm', ['ci', '--no-audit', '--no-fund'], 240000);
              }
              let pkg = {};
              try {
                pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
              } catch {}
              const scripts = pkg.scripts || {};
              const hasPlaywrightCfg = fs.existsSync('playwright.config.ts') || fs.existsSync('playwright.config.js');
              if (scripts.typecheck || scripts.lint) {
                const sName = scripts.typecheck ? 'typecheck' : 'lint';
                runCheck('check-type', 'TypeScript / Lint 静态检查 (' + sName + ')', 'npm', ['run', sName]);
              }
              if (scripts.build) {
                runCheck('check-build', '生产构建检查 (npm run build)', 'npm', ['run', 'build']);
              }
              const testCmd = String(scripts.test || '');
              if (
                testCmd &&
                !testCmd.includes('no test specified') &&
                !(hasPlaywrightCfg && /playwright/i.test(testCmd))
              ) {
                kind = 'unit';
                runCheck('check-unit', '自动化单元测试 (npm test)', 'npm', ['test']);
              }
            }

            // Gate 3: Full Playwright E2E Suite (Deterministic Outer Runner)
            if (fs.existsSync('playwright.config.ts') || fs.existsSync('playwright.config.js')) {
              kind = 'e2e';
              const t0 = Date.now();
              const pw = spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
                encoding: 'utf8',
                timeout: 240000,
                env: { ...process.env, CI: 'true', PLAYWRIGHT_HTML_OPEN: 'never' },
              });
              const durationMs = Date.now() - t0;
              rawLog += '\\n=== Playwright E2E ===\\n' + ((pw.stderr || '') + '\\n' + (pw.stdout || '')).slice(-2500);
              let parsedPw = null;
              try {
                const firstBrace = (pw.stdout || '').indexOf('{');
                if (firstBrace !== -1) parsedPw = JSON.parse(pw.stdout.slice(firstBrace));
              } catch {}
              if (parsedPw && Array.isArray(parsedPw.suites)) {
                const walk = (suite, prefix = '') => {
                  const label = prefix ? prefix + ' › ' + (suite.title || '') : (suite.title || '');
                  for (const spec of suite.specs || []) {
                    const testObj = (spec.tests || [])[0];
                    const lastResult = testObj && testObj.results ? testObj.results[testObj.results.length - 1] : null;
                    const st = lastResult?.status === 'passed' ? 'passed' : lastResult?.status === 'skipped' ? 'skipped' : 'failed';
                    cases.push({
                      id: 'pw-' + cases.length,
                      title: (label ? label + ' › ' : '') + (spec.title || 'E2E Case'),
                      file: spec.file,
                      status: st,
                      durationMs: Number(lastResult?.duration || 0),
                      ...(st === 'failed' ? { error: String(lastResult?.error?.message || 'Assertion failed').slice(0, 600) } : {}),
                    });
                  }
                  for (const child of suite.suites || []) walk(child, label);
                };
                for (const s of parsedPw.suites) walk(s);
              } else {
                cases.push({
                  id: 'pw-suite',
                  title: 'Playwright E2E 测试套件',
                  status: pw.status === 0 ? 'passed' : 'failed',
                  durationMs,
                  ...(pw.status === 0 ? {} : { error: ((pw.stderr || '') + (pw.stdout || '')).slice(-600) }),
                });
              }
            }

            const passed = cases.filter((c) => c.status === 'passed').length;
            const failed = cases.filter((c) => c.status === 'failed').length;
            const skipped = cases.filter((c) => c.status === 'skipped').length;
            const total = cases.length;
            const status = failed > 0 && passed > 0 ? 'partial' : failed > 0 ? 'failed' : passed > 0 ? 'passed' : 'skipped';
            const hasChanges = getCleanGitStatusLines().length > 0;
            const allPassed = contractOk && (total > 0 ? failed === 0 && passed > 0 : hasChanges);

            return {
              round,
              kind,
              status,
              contractOk,
              hasChanges,
              allPassed,
              total,
              passed,
              failed,
              skipped,
              durationMs: Date.now() - startedAll,
              cases,
              rawLogExcerpt: rawLog.slice(-3000),
            };
          }

          function writeVerificationFeedback(verify) {
            const failedCases = verify.cases.filter((c) => c.status === 'failed');
            const lines = [
              '# AutoDev Deterministic Verification Feedback (Round ' + verify.round + ')',
              '',
              '- Summary: ' + verify.passed + ' passed / ' + verify.failed + ' failed / ' + verify.skipped + ' skipped',
              '- Contract Integrity: ' + (verify.contractOk ? 'OK' : 'VIOLATED (reverted)'),
              '',
              '## Failing Checks & Test Cases (FIX ALL OF THESE)',
            ];
            for (const fc of failedCases) {
              lines.push('### ❌ ' + fc.title + (fc.file ? ' (' + fc.file + ')' : ''));
              if (fc.error) {
                lines.push('~~~text');
                lines.push(fc.error);
                lines.push('~~~');
              }
            }
            if (verify.rawLogExcerpt) {
              lines.push('', '## Verifier Log Tail', '~~~text', verify.rawLogExcerpt.slice(-1800), '~~~');
            }
            fs.writeFileSync(feedbackFile, lines.join('\\n'), 'utf8');
          }

          async function publishTestReport(verify, meta) {
            if (!token || !repo || verify.total <= 0) return;
            const report = {
              runId: pipelineRunId,
              actionsRunId,
              actionsUrl: 'https://github.com/' + repo + '/actions/runs/' + actionsRunId,
              workflowName: 'AutoDev AGY Coding Runner',
              branch,
              prNumber,
              kind: verify.kind,
              status: verify.status,
              total: verify.total,
              passed: verify.passed,
              failed: verify.failed,
              skipped: verify.skipped,
              durationMs: verify.durationMs,
              executedAt: new Date().toISOString(),
              summary:
                '外置验证（第 ' +
                meta.roundsExecuted +
                '/' +
                maxRounds +
                ' 轮）：' +
                verify.passed +
                ' 通过 / ' +
                verify.failed +
                ' 失败 / ' +
                verify.skipped +
                ' 跳过' +
                (meta.earlyStopped ? ' · 哨兵早停' : ''),
              cases: verify.cases,
              rawLogExcerpt: verify.rawLogExcerpt,
              ...(meta.agySessionId ? { agySessionId: meta.agySessionId } : {}),
              agySessionReused: meta.agySessionReused,
              agyExitCode: meta.agyExitCode,
            };

            const targetPath = '.autodev-test-reports/' + actionsRunId + '.json';
            const encoded = targetPath.split('/').map(encodeURIComponent).join('/');
            const contentB64 = Buffer.from(JSON.stringify(report, null, 2), 'utf8').toString('base64');
            await fetch('https://api.github.com/repos/' + repo + '/contents/' + encoded, {
              method: 'PUT',
              headers: ghHeaders,
              body: JSON.stringify({
                message: 'chore(autodev-test): publish structured test report for run ' + actionsRunId,
                content: contentB64,
                branch: channelBranch,
              }),
              signal: AbortSignal.timeout(20000),
            }).catch((err) => appendLog('Warning: Failed to upload structured test report: ' + String(err)));
          }

          async function main() {
            removeEphemeralFiles();
            const caps = detectAgyCapabilities();
            appendLog('[Outer Harness] AGY CLI capabilities: ' + JSON.stringify(caps));

            await syncLiveComment(currentPhaseLabel);
            const ticker = setInterval(() => {
              syncLiveComment(currentPhaseLabel).catch(() => {});
            }, 8000);

            let activeSessionId = sessionMode === 'resume' && resumeSessionId && caps.supportsResume ? resumeSessionId : undefined;
            let sessionReused = Boolean(activeSessionId);
            let lastRoundResult = { exitCode: 1, earlyStopReason: '', capturedSessionId: undefined };
            let lastVerify = null;
            let roundsExecuted = 0;
            let earlyStoppedAny = false;

            try {
              for (let round = 1; round <= maxRounds; round++) {
                roundsExecuted = round;
                currentPhaseLabel = 'CODING (Round ' + round + '/' + maxRounds + ')';
                await syncLiveComment(currentPhaseLabel);

                const prompt = buildRoundPrompt(round);
                const useResumeThisRound = round === 1 ? activeSessionId : undefined;
                let useStreamJson = Boolean(caps.supportsStreamJson);
                let res = await runAgyRound({ round, prompt, resumeId: useResumeThisRound, useStreamJson });

                if (useStreamJson && res.exitCode !== 0 && res.elapsedMs < 20000 && !res.sentinelWritten) {
                  appendLog('[Outer Harness] stream-json flag exited quickly; retrying Round ' + round + ' without --output-format stream-json.');
                  useStreamJson = false;
                  caps.supportsStreamJson = false;
                  res = await runAgyRound({ round, prompt, resumeId: useResumeThisRound, useStreamJson: false });
                }

                if (useResumeThisRound && res.exitCode !== 0 && res.elapsedMs < 45000 && !res.sentinelWritten) {
                  appendLog('[Outer Harness] Resuming session ' + useResumeThisRound + ' failed quickly; retrying Round 1 with clean fresh session.');
                  sessionReused = false;
                  activeSessionId = undefined;
                  res = await runAgyRound({ round, prompt, resumeId: undefined, useStreamJson });
                }

                lastRoundResult = res;
                if (res.capturedSessionId) activeSessionId = res.capturedSessionId;
                if (res.earlyStopReason) earlyStoppedAny = true;

                appendLog(
                  '[Outer Harness] Round ' + round + ' AGY finished (exit=' + res.exitCode +
                  ', elapsed=' + Math.round(res.elapsedMs / 1000) + 's, sentinel=' + res.sentinelWritten +
                  (res.earlyStopReason ? ', earlyStop=' + res.earlyStopReason : '') + '). Starting deterministic 4-gate verification...'
                );

                currentPhaseLabel = 'VERIFYING (Round ' + round + '/' + maxRounds + ')';
                await syncLiveComment(currentPhaseLabel);

                lastVerify = runDeterministicVerification(round);
                appendLog(
                  '[Outer Harness] Round ' + round + ' Verification: ' +
                  lastVerify.passed + ' passed / ' + lastVerify.failed + ' failed / ' + lastVerify.skipped + ' skipped' +
                  ' (contractOk=' + lastVerify.contractOk + ', hasChanges=' + lastVerify.hasChanges + ', allPassed=' + lastVerify.allPassed + ')'
                );

                if (lastVerify.allPassed) {
                  appendLog('[Outer Harness] ✅ 4-Gate Deterministic Verification PASSED on Round ' + round + '/' + maxRounds + '! Task Complete.');
                  removeEphemeralFiles();
                  break;
                }

                if (round < maxRounds) {
                  writeVerificationFeedback(lastVerify);
                  appendLog('[Outer Harness] Verification had ' + lastVerify.failed + ' failure(s). Wrote ' + feedbackFile + ' and starting Auto-Fix Round ' + (round + 1) + '/' + maxRounds + '...');
                }
              }
            } finally {
              clearInterval(ticker);
              removeEphemeralFiles();
            }

            const verifiedComplete = Boolean(lastVerify && lastVerify.allPassed);
            const logicalAgyExit = verifiedComplete && lastRoundResult.earlyStopReason === 'sentinel_grace_elapsed'
              ? 0
              : lastRoundResult.exitCode;

            if (lastVerify) {
              await publishTestReport(lastVerify, {
                roundsExecuted,
                earlyStopped: earlyStoppedAny,
                agySessionId: activeSessionId,
                agySessionReused: sessionReused,
                agyExitCode: logicalAgyExit,
              });
            }

            const finalStatusLabel = verifiedComplete
              ? 'COMPLETED (verified ' + lastVerify.passed + '/' + lastVerify.total + ' in ' + roundsExecuted + ' round' + (roundsExecuted > 1 ? 's' : '') + ')'
              : 'FAILED (verification failed after ' + roundsExecuted + '/' + maxRounds + ' rounds: ' + (lastVerify ? lastVerify.failed + ' failed' : 'no checks') + ')';
            await syncLiveComment(finalStatusLabel);

            if (process.env.GITHUB_OUTPUT) {
              const lines = [
                'verified_complete=' + (verifiedComplete ? 'true' : 'false'),
                'rounds_executed=' + roundsExecuted,
                'passed_count=' + (lastVerify ? lastVerify.passed : 0),
                'failed_count=' + (lastVerify ? lastVerify.failed : 0),
                'has_changes=' + (lastVerify && lastVerify.hasChanges ? 'true' : 'false'),
                'early_stopped=' + (earlyStoppedAny ? 'true' : 'false'),
                'agy_exit=' + logicalAgyExit,
                'agy_session_id=' + (activeSessionId || ''),
                'agy_session_reused=' + (sessionReused ? 'true' : 'false'),
              ];
              fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\\n') + '\\n');
            }

            process.exit(verifiedComplete ? 0 : 1);
          }

          main().catch((err) => {
            appendLog('[Outer Harness] Fatal error: ' + String(err));
            process.exit(1);
          });
          OUTER_HARNESS_EOF

          export LOG_FILE
          set +e
          node /tmp/autodev-outer-harness.mjs
          HARNESS_EXIT=\$?
          set -e
          rm -f /tmp/autodev-outer-harness.mjs "\${LOG_FILE}"
          exit "\${HARNESS_EXIT}"

      - name: Enforce Read-Only E2E Test & Spec Contract Integrity
        shell: bash
        run: |
          LOCK_MANIFEST="\${{ steps.lock.outputs.lock_manifest }}"
          if [ -s "\${LOCK_MANIFEST}" ]; then
            if ! sha256sum -c "\${LOCK_MANIFEST}"; then
              echo "::error::One or more read-only test/spec contract files were modified or deleted by coding agent! Reverting and failing gate."
              git checkout -- docs/spec.json tests/e2e.spec.ts tests/e2e 2>/dev/null || true
              rm -f "\${LOCK_MANIFEST}"
              exit 1
            fi
            echo "Read-only contract verified: all locked E2E tests and docs/spec.json are unchanged."
          fi
          rm -f "\${LOCK_MANIFEST}"

      - name: Commit & Push Implementation to Draft PR Branch
        id: push
        shell: bash
        run: |
          rm -f .autodev-agent-done.json .autodev-verify-feedback.md
          git config user.name "AutoDev AGY Runner"
          git config user.email "autodev-runner@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "changed=false" >> "\$GITHUB_OUTPUT"
            echo "No file changes produced by AGY."
          else
            git commit -m "feat(autodev): implement spec via VPS AGY (\${{ steps.target.outputs.model }}) [verified: \${{ steps.agy.outputs.passed_count }} passed in \${{ steps.agy.outputs.rounds_executed }}r]"
            git push origin "HEAD:\${{ steps.target.outputs.branch }}"
            SHA=\$(git rev-parse --short HEAD)
            echo "changed=true" >> "\$GITHUB_OUTPUT"
            echo "commit_sha=\${SHA}" >> "\$GITHUB_OUTPUT"
          fi

      - name: Post Summary Comment on Draft PR
        if: steps.target.outputs.pr_number != ''
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        shell: bash
        run: |
          if [ "\${{ steps.push.outputs.changed }}" = "true" ]; then
            cat > /tmp/autodev-pr-summary.md <<'COMMENT_EOF'
          ### AutoDev VPS AGY 外置闭环验证通过
          - Model: \`\${{ steps.target.outputs.model }}\`
          - Commit: \`\${{ steps.push.outputs.commit_sha }}\`
          - Rounds: \`\${{ steps.agy.outputs.rounds_executed }}/3\` · 通过校验 \`\${{ steps.agy.outputs.passed_count }}\` 项（失败 \`\${{ steps.agy.outputs.failed_count }}\` 项）
          - 全量只读测试契约（含历次回归测试）完整性校验通过，结构化测试报告已同步至控制面。
          - 请前往 AutoDev Studio「5. 验收与上线审批」或「6. 质量与自进化 (RSI)」查看测试结果并验收。
          COMMENT_EOF
          else
            cat > /tmp/autodev-pr-summary.md <<'COMMENT_EOF'
          ### AutoDev VPS AGY 执行结束
          - Model: \`\${{ steps.target.outputs.model }}\`
          - Rounds: \`\${{ steps.agy.outputs.rounds_executed }}/3\` · 校验通过 \`\${{ steps.agy.outputs.passed_count }}\` 项
          - 本次执行未产生新的文件变更，请查看 Actions 日志。
          COMMENT_EOF
          fi
          gh pr comment "\${{ steps.target.outputs.pr_number }}" --body-file /tmp/autodev-pr-summary.md || true
          rm -f /tmp/autodev-pr-summary.md
`;
}

export function buildCloudflareDeployWorkflowYaml(allowedActor: string = 'jiangfengwhu'): string {
  return `name: AutoDev Cloudflare Workers Deploy

on:
  workflow_dispatch:
    inputs:
      target_branch:
        description: 'Branch to build and deploy to Cloudflare Workers'
        required: false
        default: 'main'
        type: string
      worker_name:
        description: 'Optional Worker name override (defaults to wrangler.toml name)'
        required: false
        default: ''
        type: string
  push:
    branches:
      - main
    paths-ignore:
      - 'docs/**'
      - 'README.md'
      - '.github/**'

permissions:
  contents: read

concurrency:
  group: autodev-cf-deploy-single-queue
  cancel-in-progress: false

jobs:
  deploy-cloudflare:
    if: github.actor == '${allowedActor}'
    runs-on: [self-hosted, linux, x64, vps-agy]
    timeout-minutes: 15

    steps:
      - name: Checkout Target Branch
        uses: actions/checkout@v7
        with:
          ref: \${{ inputs.target_branch || github.ref_name }}

      - name: Verify Cloudflare Credentials & Wrangler Config
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        shell: bash
        run: |
          if [ -z "\${CLOUDFLARE_API_TOKEN}" ] || [ -z "\${CLOUDFLARE_ACCOUNT_ID}" ]; then
            echo "::error::Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in GitHub Repository Secrets."
            echo "Please configure both secrets at: https://github.com/\${{ github.repository }}/settings/secrets/actions"
            exit 1
          fi
          if [ ! -f "wrangler.toml" ] && [ ! -f "wrangler.jsonc" ] && [ ! -f "wrangler.json" ]; then
            echo "::error::No wrangler.toml / wrangler.jsonc found on branch \${{ inputs.target_branch || github.ref_name }}."
            exit 1
          fi

      - name: Install Dependencies & Build Project
        shell: bash
        run: |
          if [ -f "package-lock.json" ]; then
            npm ci || (rm -rf package-lock.json node_modules && npm install)
          elif [ -f "package.json" ]; then
            npm install
          fi
          if [ -f "package.json" ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['build:client'] ? 0 : 1)"; then
            npm run build:client
          elif [ -f "package.json" ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then
            npm run build
          fi

      - name: Provision D1 Database (if placeholder) & Apply Remote Migrations
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        shell: bash
        run: |
          node <<'D1_EOF'
          const fs = require('fs');
          if (!fs.existsSync('wrangler.toml')) process.exit(0);
          let toml = fs.readFileSync('wrangler.toml', 'utf8');
          const nameMatch = toml.match(/database_name\\s*=\\s*"([^"]+)"/);
          if (!nameMatch) process.exit(0);
          const dbName = nameMatch[1];
          const idMatch = toml.match(/database_id\\s*=\\s*"([^"]+)"/);
          const currentId = idMatch ? idMatch[1] : '';
          const isPlaceholder = !currentId || /^0+(-0+)*$/.test(currentId) || /placeholder|replace/i.test(currentId);
          (async () => {
            if (isPlaceholder) {
              const token = process.env.CLOUDFLARE_API_TOKEN;
              const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
              const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
              const listRes = await fetch('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/d1/database', { headers });
              const listJson = await listRes.json();
              if (!listRes.ok || !listJson.success) throw new Error('Failed to list D1 databases: ' + JSON.stringify(listJson.errors));
              let found = (listJson.result || []).find((d) => d.name === dbName);
              if (!found) {
                const createRes = await fetch('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/d1/database', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ name: dbName }),
                });
                const createJson = await createRes.json();
                if (!createRes.ok || !createJson.success) throw new Error('Failed to create D1 database: ' + JSON.stringify(createJson.errors));
                found = createJson.result;
              }
              if (idMatch) {
                toml = toml.replace(/database_id\\s*=\\s*"[^"]+"/, 'database_id = "' + found.uuid + '"');
              } else {
                toml = toml.replace(/(database_name\\s*=\\s*"[^"]+")/, '$1\\ndatabase_id = "' + found.uuid + '"');
              }
              fs.writeFileSync('wrangler.toml', toml, 'utf8');
              console.log('Bound production D1 database:', dbName, found.uuid);
            }
          })().catch((err) => {
            console.error(err);
            process.exit(1);
          });
          D1_EOF

          if [ -f "wrangler.toml" ] && [ -d "migrations" ] && ls migrations/*.sql >/dev/null 2>&1; then
            DB_NAME=\$(node -e "const fs=require('fs');const m=fs.readFileSync('wrangler.toml','utf8').match(/database_name\\s*=\\s*\"([^\"]+)\"/);console.log(m?m[1]:'')")
            if [ -n "\${DB_NAME}" ]; then
              echo "Applying remote D1 migrations to \${DB_NAME}..."
              npx --yes wrangler d1 migrations apply "\${DB_NAME}" --remote
            fi
          fi

      - name: Deploy to Cloudflare Workers
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        shell: bash
        run: |
          if [ -n "\${{ inputs.worker_name }}" ]; then
            npx --yes wrangler deploy --name "\${{ inputs.worker_name }}"
          else
            npx --yes wrangler deploy
          fi
`;
}

export function buildAgyPlanWorkflowYaml(allowedActor: string = 'jiangfengwhu'): string {
  return `name: AutoDev AGY Plan Pipeline

on:
  workflow_dispatch:
    inputs:
      job_id:
        description: 'AutoDev Studio Analysis Job ID'
        required: true
        type: string
      base_branch:
        description: 'Base branch to inspect (default: main)'
        required: false
        default: 'main'
        type: string
      channel_branch:
        description: 'Dedicated orphan branch for plan JSON artifacts (default: autodev-plan-channel)'
        required: false
        default: 'autodev-plan-channel'
        type: string
      agy_model:
        description: 'AGY model ID configured on the VPS'
        required: false
        default: 'gemini-3.8-flash-high'
        type: choice
        options:
          - gemini-3.8-flash-high
          - gemini-3.8-flash-medium
          - claude-sonnet-4-6
          - claude-opus-4-6-thinking
          - gpt-oss-120b-medium

# Writes ONLY to dedicated orphan branch autodev-plan-channel via REST API; never modifies base_branch/main
permissions:
  contents: write

# Shares the single-task repository-wide serial queue with AGY coding runs
concurrency:
  group: autodev-agy-single-queue
  cancel-in-progress: false

jobs:
  agy-plan:
    if: github.actor == '${allowedActor}'
    runs-on: [self-hosted, linux, x64, vps-agy]
    timeout-minutes: 30

    steps:
      - name: Checkout Latest Base Branch (Full Codebase Context)
        uses: actions/checkout@v7
        with:
          ref: \${{ inputs.base_branch || 'main' }}
          fetch-depth: 0

      - name: Run 3-Stage Instabox AGY Planning (Architect -> QA Spec -> QA Critic)
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PLAN_REPO: \${{ github.repository }}
          PLAN_RUN_ID: \${{ github.run_id }}
          PLAN_JOB_ID: \${{ inputs.job_id }}
          PLAN_BASE_BRANCH: \${{ inputs.base_branch || 'main' }}
          PLAN_CHANNEL_BRANCH: \${{ inputs.channel_branch || 'autodev-plan-channel' }}
          PLAN_MODEL: \${{ inputs.agy_model || 'gemini-3.8-flash-high' }}
        shell: bash
        run: |
          export PATH="\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
          echo "Workspace CWD: \$(pwd)"
          which agy
          agy --version

          cat > /tmp/autodev-plan-runner.mjs <<'PLAN_RUNNER_EOF'
          import fs from 'fs';
          import path from 'path';
          import { execSync, spawn } from 'child_process';

          const token = process.env.GH_TOKEN;
          const repo = process.env.PLAN_REPO;
          const actionsRunId = Number(process.env.PLAN_RUN_ID || 0);
          const jobId = process.env.PLAN_JOB_ID;
          const safeJobId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
          const baseBranch = process.env.PLAN_BASE_BRANCH || 'main';
          const channelBranch = process.env.PLAN_CHANNEL_BRANCH || 'autodev-plan-channel';
          const model = process.env.PLAN_MODEL || 'gemini-3.8-flash-high';
          const actionsUrl = 'https://github.com/' + repo + '/actions/runs/' + actionsRunId;

          if (!channelBranch || channelBranch === baseBranch || channelBranch === 'main' || channelBranch === 'master') {
            throw new Error('Refusing to write plan artifacts to protected branch: ' + channelBranch);
          }

          const tmpDir = '/tmp/autodev-plan-' + safeJobId;
          fs.mkdirSync(tmpDir, { recursive: true });
          const wsOutDir = path.join(process.cwd(), '.autodev-plan-output');

          let headSha = '';
          try {
            headSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
          } catch {}

          const headers = {
            Authorization: 'Bearer ' + token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            Connection: 'close',
          };

          function sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
          }

          function formatNetworkError(err) {
            const base = err instanceof Error ? err.message : String(err);
            const cause = err && typeof err === 'object' && err.cause ? err.cause : null;
            if (!cause) return base;
            const code = cause.code ? '[' + cause.code + '] ' : '';
            const cMsg = cause.message || String(cause);
            return base + ' (' + code + cMsg + ')';
          }

          async function gh(apiPath, options = {}) {
            const url = 'https://api.github.com' + apiPath;
            const maxAttempts = 4;
            let lastErr = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                const res = await fetch(url, {
                  ...options,
                  headers: { ...headers, ...(options.headers || {}) },
                  signal: AbortSignal.timeout(30000),
                });
                const text = await res.text();
                if (!res.ok) {
                  const err = new Error('GitHub API ' + res.status + ' on ' + apiPath + ': ' + text.slice(0, 300));
                  err.status = res.status;
                  const retryableStatus = res.status === 429 || res.status >= 500;
                  if (retryableStatus && attempt < maxAttempts) {
                    const waitMs = 1500 * attempt;
                    console.warn('[gh retry ' + attempt + '/' + maxAttempts + '] HTTP ' + res.status + ', waiting ' + waitMs + 'ms');
                    await sleep(waitMs);
                    continue;
                  }
                  throw err;
                }
                return text ? JSON.parse(text) : null;
              } catch (err) {
                lastErr = err;
                // Do not retry non-retryable 4xx API errors (400/401/403/404/409/422)
                if (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 429) {
                  throw err;
                }
                if (attempt < maxAttempts) {
                  const waitMs = 1500 * attempt;
                  console.warn('[gh retry ' + attempt + '/' + maxAttempts + '] ' + formatNetworkError(err) + ', waiting ' + waitMs + 'ms');
                  await sleep(waitMs);
                  continue;
                }
                const wrapped = new Error('GitHub request failed after ' + maxAttempts + ' attempts on ' + apiPath + ': ' + formatNetworkError(err));
                if (err && typeof err.status === 'number') wrapped.status = err.status;
                throw wrapped;
              }
            }
            throw lastErr;
          }

          function encodeRepoPath(filePath) {
            return filePath.split('/').map((s) => encodeURIComponent(s)).join('/');
          }

          function artifactPath(fileName) {
            return '.autodev-plans/' + safeJobId + '/' + fileName;
          }

          async function readChannelFile(filePath) {
            const encoded = encodeRepoPath(filePath);
            const res = await gh(
              '/repos/' + repo + '/contents/' + encoded + '?ref=' + encodeURIComponent(channelBranch)
            );
            const rawText = res.encoding === 'base64'
              ? Buffer.from(String(res.content || '').replace(/\\n/g, ''), 'base64').toString('utf8')
              : String(res.content || '');
            return { sha: res.sha, data: JSON.parse(rawText) };
          }

          async function writeChannelFile(filePath, data, commitMsg, knownSha) {
            const encoded = encodeRepoPath(filePath);
            const contentB64 = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');

            let sha = knownSha;
            for (let attempt = 1; attempt <= 2; attempt++) {
              if (!sha && attempt === 2) {
                try {
                  const existing = await gh(
                    '/repos/' + repo + '/contents/' + encoded + '?ref=' + encodeURIComponent(channelBranch)
                  );
                  sha = existing?.sha;
                } catch {}
              }
              const payload = {
                message: commitMsg,
                content: contentB64,
                branch: channelBranch,
              };
              if (sha) payload.sha = sha;
              try {
                const updated = await gh('/repos/' + repo + '/contents/' + encoded, {
                  method: 'PUT',
                  body: JSON.stringify(payload),
                });
                return updated?.content?.sha || sha;
              } catch (err) {
                if ((err.status === 409 || err.status === 422) && attempt === 1) {
                  sha = undefined;
                  continue;
                }
                throw err;
              }
            }
            return sha;
          }

          function buildQuickRepoDigest() {
            const parts = [];
            try {
              const files = execSync('git ls-files', { encoding: 'utf8' })
                .split('\\n')
                .map((s) => s.trim())
                .filter((p) => p && !p.startsWith('node_modules/') && !p.startsWith('dist/'))
                .slice(0, 120);
              parts.push('Tracked files (' + files.length + '):\\n' + files.join('\\n'));
            } catch {}
            for (const cfg of ['package.json', 'wrangler.toml']) {
              if (fs.existsSync(cfg)) {
                try {
                  const snippet = fs.readFileSync(cfg, 'utf8').slice(0, 1800);
                  parts.push(cfg + ':\\n' + snippet);
                } catch {}
              }
            }
            return parts.join('\\n\\n');
          }

          function extractJsonLoose(text) {
            const trimmed = (text || '').trim();
            if (!trimmed) throw new Error('Empty output');
            try {
              return JSON.parse(trimmed);
            } catch {}
            const fenced = trimmed.match(/\`\`\`(?:json)?\\s*\\n([\\s\\S]*?)\\n\`\`\`/i);
            if (fenced) {
              return JSON.parse(fenced[1].trim());
            }
            const first = trimmed.indexOf('{');
            const last = trimmed.lastIndexOf('}');
            if (first !== -1 && last > first) {
              return JSON.parse(trimmed.slice(first, last + 1));
            }
            throw new Error('No valid JSON object found in output');
          }

          function resetWorkspaceClean() {
            try {
              fs.rmSync(wsOutDir, { recursive: true, force: true });
            } catch {}
            try {
              execSync('git checkout -- . && git clean -fd', { stdio: 'ignore' });
            } catch {}
          }

          const state = {
            jobId,
            status: 'running',
            updatedAt: new Date().toISOString(),
            headSha,
            actionsRunId,
            actionsUrl,
            model,
            steps: {
              architect: { status: 'idle' },
              qa_spec: { status: 'idle' },
              qa_critic: { status: 'idle' },
            },
            outputFiles: {},
          };

          let stateFileSha;
          const stateFilePath = artifactPath('state.json');

          async function syncState() {
            state.updatedAt = new Date().toISOString();
            if (!stateFileSha) {
              try {
                const existing = await readChannelFile(stateFilePath);
                stateFileSha = existing.sha;
              } catch {}
            }
            stateFileSha = await writeChannelFile(
              stateFilePath,
              state,
              'chore(autodev-plan): update state for ' + safeJobId + ' (' + state.status + ')',
              stateFileSha
            );
          }

          async function postStageOutput(stage, data) {
            const outFilePath = artifactPath(stage + '.json');
            await writeChannelFile(
              outFilePath,
              data,
              'chore(autodev-plan): save ' + stage + ' output for ' + safeJobId,
              undefined
            );
            return outFilePath;
          }

          function validateStage(stage, raw) {
            if (!raw || typeof raw !== 'object') {
              return { ok: false, error: 'Root value must be a JSON object' };
            }
            if (stage === 'architect') {
              if (typeof raw.architectureSummary !== 'string' || !raw.architectureSummary.trim()) {
                return { ok: false, error: 'Missing non-empty string "architectureSummary"' };
              }
              if (!Array.isArray(raw.ambiguities)) return { ok: false, error: '"ambiguities" must be an array' };
              if (!Array.isArray(raw.techDecisions)) return { ok: false, error: '"techDecisions" must be an array' };
              if (!Array.isArray(raw.apiContracts)) return { ok: false, error: '"apiContracts" must be an array' };
              if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
                return { ok: false, error: '"tasks" must be a non-empty array' };
              }
              return { ok: true, data: raw };
            }
            if (stage === 'qa_spec') {
              if (typeof raw.e2eTestCode !== 'string' || !raw.e2eTestCode.trim()) {
                return { ok: false, error: 'Missing non-empty string "e2eTestCode"' };
              }
              if (!Array.isArray(raw.apiTestChecklist)) {
                return { ok: false, error: '"apiTestChecklist" must be an array' };
              }
              if (!Array.isArray(raw.coverageNotes)) raw.coverageNotes = [];
              return { ok: true, data: raw };
            }
            if (stage === 'qa_critic') {
              if (typeof raw.reviewSummary !== 'string' || !raw.reviewSummary.trim()) {
                return { ok: false, error: 'Missing non-empty string "reviewSummary"' };
              }
              if (typeof raw.finalE2eTestCode !== 'string' || !raw.finalE2eTestCode.trim()) {
                return { ok: false, error: 'Missing non-empty string "finalE2eTestCode"' };
              }
              if (!Array.isArray(raw.findings)) return { ok: false, error: '"findings" must be an array' };
              if (!Array.isArray(raw.finalApiTestChecklist)) {
                return { ok: false, error: '"finalApiTestChecklist" must be an array' };
              }
              return { ok: true, data: raw };
            }
            return { ok: false, error: 'Unknown stage: ' + stage };
          }

          function invokeAgyAsync(promptText, timeoutStr = '10m') {
            return new Promise((resolve) => {
              const child = spawn(
                'agy',
                [
                  '--dangerously-skip-permissions',
                  '--model',
                  model,
                  '--print-timeout',
                  timeoutStr,
                  '--print=' + promptText,
                ],
                {
                  cwd: process.cwd(),
                  stdio: ['ignore', 'pipe', 'pipe'],
                }
              );

              const maxCapture = 4 * 1024 * 1024;
              let stdout = '';
              let stderr = '';

              child.stdout.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                process.stdout.write(text);
                stdout += text;
                if (stdout.length > maxCapture) {
                  stdout = stdout.slice(-maxCapture);
                }
              });

              child.stderr.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                process.stderr.write(text);
                stderr += text;
                if (stderr.length > maxCapture) {
                  stderr = stderr.slice(-maxCapture);
                }
              });

              child.on('error', (err) => {
                resolve({ status: 1, stdout, stderr: stderr + '\\n' + String(err) });
              });

              child.on('close', (code) => {
                resolve({ status: code ?? 1, stdout, stderr });
              });
            });
          }

          async function runStage(stage, basePrompt, summaryFn) {
            const startedMs = Date.now();
            const relOutPath = '.autodev-plan-output/' + stage + '.json';
            const absOutPath = path.join(process.cwd(), relOutPath);
            const tmpOutPath = path.join(tmpDir, stage + '.json');

            state.steps[stage] = {
              status: 'running',
              startedAt: new Date().toISOString(),
              message:
                stage === 'architect'
                  ? 'Instabox AGY 正在阅读当前仓库真实代码并拆解增量架构与任务树…'
                  : stage === 'qa_spec'
                    ? 'Instabox AGY 正在结合现有页面与历史测试生成独立 Playwright E2E 测试集…'
                    : 'Instabox AGY 正在评审边界异常并锁定终版只读回归测试集…',
            };
            await syncState();

            let lastErr = '';
            for (let attempt = 1; attempt <= 2; attempt++) {
              fs.mkdirSync(wsOutDir, { recursive: true });
              const prompt =
                attempt === 1
                  ? basePrompt
                  : basePrompt +
                    '\\n\\n[RETRY CORRECTION] Your previous attempt failed validation with error: ' +
                    lastErr +
                    '. Write ONLY valid JSON matching the exact required schema to ' +
                    relOutPath +
                    ' (do not modify any other repository files).';

              console.log('=== Running stage:', stage, 'attempt:', attempt, '===');
              const execRes = await invokeAgyAsync(prompt, '10m');

              let parsed = null;
              try {
                if (fs.existsSync(absOutPath)) {
                  const fileContent = fs.readFileSync(absOutPath, 'utf8');
                  parsed = extractJsonLoose(fileContent);
                } else {
                  parsed = extractJsonLoose(execRes.stdout);
                }
              } catch (parseErr) {
                lastErr = 'JSON parse error: ' + (parseErr instanceof Error ? parseErr.message : String(parseErr));
                parsed = null;
              }

              // Always reset repository working tree immediately after AGY finishes
              resetWorkspaceClean();

              if (parsed) {
                const check = validateStage(stage, parsed);
                if (check.ok) {
                  fs.writeFileSync(tmpOutPath, JSON.stringify(check.data, null, 2), 'utf8');
                  const outPath = await postStageOutput(stage, check.data);
                  const durationMs = Date.now() - startedMs;
                  state.outputFiles[stage] = outPath;
                  state.steps[stage] = {
                    status: 'completed',
                    startedAt: state.steps[stage].startedAt,
                    completedAt: new Date().toISOString(),
                    durationMs,
                    message: summaryFn(check.data),
                  };
                  await syncState();
                  return check.data;
                } else {
                  lastErr = check.error;
                }
              } else if (execRes.status !== 0 && !lastErr) {
                lastErr = 'AGY exited with code ' + execRes.status;
              }
            }

            const finalErr = 'Stage ' + stage + ' failed after retry: ' + (lastErr || 'unknown error');
            state.steps[stage] = {
              ...state.steps[stage],
              status: 'error',
              message: finalErr,
            };
            state.status = 'error';
            state.error = finalErr;
            await syncState();
            throw new Error(finalErr);
          }

          async function main() {
            const { data: input } = await readChannelFile(artifactPath('input.json'));
            if (!input || typeof input.prdTitle !== 'string') {
              throw new Error('Failed to load valid input.json from channel branch ' + channelBranch);
            }

            const repoDigest = buildQuickRepoDigest();
            const stackNote = input.isDefaultCloudflare
              ? 'Default Cloudflare Workers + Hono + D1 + KV + React/Vite stack. Inspect existing wrangler.toml, migrations/, src/, and client/ first!'
              : 'User specified tech stack: ' + input.effectiveTechStack;

            const rsiArchitectBlock = input.rsiSystemPrompts && input.rsiSystemPrompts.architect ? '\\n' + input.rsiSystemPrompts.architect + '\\n' : '';
            const rsiQaSpecBlock = input.rsiSystemPrompts && input.rsiSystemPrompts.qa_spec ? '\\n' + input.rsiSystemPrompts.qa_spec + '\\n' : '';
            const rsiQaCriticBlock = input.rsiSystemPrompts && input.rsiSystemPrompts.qa_critic ? '\\n' + input.rsiSystemPrompts.qa_critic + '\\n' : '';

            // Stage 1: Architect Agent
            const architectPrompt = [
              'You are Step 1 (Architect Agent) in AutoDev Studio running directly inside the real repository on branch ' + baseBranch + ' (HEAD ' + headSha.slice(0, 7) + ').',
              'STRICT READ-ONLY RULE: Do NOT modify, create, or delete any repository source files, package.json, migrations, or tests. ONLY write your final JSON result to .autodev-plan-output/architect.json.',
              'SPEED & FOCUS RULE: Use the pre-collected repository digest below as your map; inspect only the 3-6 most relevant source files directly and write .autodev-plan-output/architect.json promptly (aim for under 90 seconds).',
              'INCREMENTAL ITERATION RULE: If the repository already has working code, design INCREMENTAL changes on top of the existing architecture. NEVER delete or rewrite working unrelated modules or already-applied migrations (append sequentially numbered SQL migrations only when schema changes are genuinely needed).',
              'LANGUAGE: All Chinese text fields (titles, descriptions, summaries, ambiguity details, acceptanceCriteria) MUST be written in concise, professional Simplified Chinese.',
              ...(rsiArchitectBlock ? [rsiArchitectBlock] : []),
              '',
              'Repository Digest:',
              repoDigest,
              '',
              'Target Repo: ' + input.repoFullName + ' (' + baseBranch + ')',
              'Tech Stack Guideline: ' + stackNote,
              'PRD Title: ' + input.prdTitle,
              'PRD Content:',
              input.prdContent,
              '',
              'Write ONLY a valid JSON object to .autodev-plan-output/architect.json with this EXACT schema:',
              '{',
              '  "ambiguities": [{ "id": "AMB-1", "severity": "high|medium|low", "title": "...", "detail": "...", "clarificationSuggestion": "..." }],',
              '  "architectureSummary": "Concise Chinese technical architecture summary grounded in the real codebase",',
              '  "techDecisions": ["Decision 1", "Decision 2"],',
              '  "apiContracts": [{ "id": "API-1", "method": "GET|POST|PUT|PATCH|DELETE", "path": "/api/...", "summary": "...", "requestSchema": "...", "responseSchema": "...", "errorCodes": ["400", "404"] }],',
              '  "tasks": [{ "id": "T-01", "title": "...", "module": "...", "description": "...", "dependsOn": [], "acceptanceCriteria": ["..."], "estimatedComplexity": "S|M|L" }]',
              '}',
              'Keep tasks focused, atomic, and strictly scoped to the PRD (typically 3-6 tasks for incremental features).',
            ].join('\\n');

            const architectData = await runStage('architect', architectPrompt, (d) =>
              '完成 · 识别 ' + d.ambiguities.length + ' 项歧义、' + d.tasks.length + ' 项增量任务'
            );

            // Stage 2: QA Spec Agent
            const qaSpecPrompt = [
              'You are Step 2 (QA Spec Agent) in AutoDev Studio running in the real repository on branch ' + baseBranch + '.',
              'STRICT READ-ONLY RULE: Do NOT modify any repository files. ONLY write your final JSON result to .autodev-plan-output/qa_spec.json.',
              'SPEED & FOCUS RULE: Inspect existing tests/e2e* and playwright.config.ts plus the main UI entry file only, then write .autodev-plan-output/qa_spec.json promptly (aim for under 90 seconds). Do NOT duplicate or break historical regression tests.',
              'LANGUAGE: All Chinese scenario descriptions, assertions, and coverageNotes MUST be in Simplified Chinese.',
              ...(rsiQaSpecBlock ? [rsiQaSpecBlock] : []),
              '',
              'PRD Title: ' + input.prdTitle,
              'PRD Content:',
              input.prdContent,
              '',
              'Architect API Contracts & Tasks (from Stage 1):',
              JSON.stringify({ apiContracts: architectData.apiContracts, tasks: architectData.tasks }, null, 2),
              '',
              'Write ONLY a valid JSON object to .autodev-plan-output/qa_spec.json with this EXACT schema:',
              '{',
              '  "apiTestChecklist": [{ "id": "TC-01", "endpoint": "/api/...", "method": "GET|POST|...", "scenario": "...", "expectedStatus": 200, "assertion": "..." }],',
              '  "e2eTestCode": "Complete runnable TypeScript Playwright test file importing test and expect from @playwright/test",',
              '  "coverageNotes": ["Coverage note 1"]',
              '}',
            ].join('\\n');

            const qaSpecData = await runStage('qa_spec', qaSpecPrompt, (d) =>
              '完成 · 生成 ' + d.apiTestChecklist.length + ' 条接口用例与初版 E2E 测试'
            );

            // Stage 3: QA Critic Agent
            const qaCriticPrompt = [
              'You are Step 3 (QA Critic Agent) in AutoDev Studio running in the real repository on branch ' + baseBranch + '.',
              'STRICT READ-ONLY RULE: Do NOT modify any repository files. ONLY write your final JSON result to .autodev-plan-output/qa_critic.json.',
              'SPEED & FOCUS RULE: Review Stage 2 QA Spec directly against the PRD and real repository routes/selectors, harden edge cases, and write .autodev-plan-output/qa_critic.json promptly (aim for under 90 seconds).',
              'Produce a hardened, deterministic final Playwright E2E test suite (finalE2eTestCode) and final API checklist (finalApiTestChecklist) that is realistic, fast, and aligned with the real app.',
              'LANGUAGE: All reviewSummary, finding issues, recommendations, and checklist text MUST be in Simplified Chinese.',
              ...(rsiQaCriticBlock ? [rsiQaCriticBlock] : []),
              '',
              'PRD Title: ' + input.prdTitle,
              'PRD Content:',
              input.prdContent,
              '',
              'Stage 1 API Contracts:',
              JSON.stringify(architectData.apiContracts, null, 2),
              '',
              'Stage 2 Draft QA Spec:',
              JSON.stringify(qaSpecData, null, 2),
              '',
              'Write ONLY a valid JSON object to .autodev-plan-output/qa_critic.json with this EXACT schema:',
              '{',
              '  "reviewSummary": "Concise Chinese critic review conclusion",',
              '  "findings": [{ "id": "CRIT-01", "category": "boundary|invalid_input|ui_interaction|security|concurrency", "severity": "high|medium|low", "issue": "...", "recommendation": "..." }],',
              '  "finalApiTestChecklist": [{ "id": "TC-01", "endpoint": "/api/...", "method": "GET|POST|...", "scenario": "...", "expectedStatus": 200, "assertion": "..." }],',
              '  "finalE2eTestCode": "Complete hardened TypeScript Playwright test code"',
              '}',
            ].join('\\n');

            await runStage('qa_critic', qaCriticPrompt, (d) =>
              '完成 · 提出 ' + d.findings.length + ' 项加固意见并锁定终版只读测试'
            );

            state.status = 'completed';
            await syncState();
            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log('=== All 3 Instabox AGY planning stages completed successfully ===');
          }

          main().catch(async (err) => {
            console.error(err);
            const msg = formatNetworkError(err);
            state.status = 'error';
            state.error = msg;
            for (const key of ['architect', 'qa_spec', 'qa_critic']) {
              if (state.steps[key] && state.steps[key].status === 'running') {
                state.steps[key] = { ...state.steps[key], status: 'error', message: msg };
              }
            }
            try {
              await syncState();
            } catch {}
            resetWorkspaceClean();
            fs.rmSync(tmpDir, { recursive: true, force: true });
            process.exit(1);
          });
          PLAN_RUNNER_EOF

          node /tmp/autodev-plan-runner.mjs
          EXIT_CODE=\$?
          rm -f /tmp/autodev-plan-runner.mjs
          exit \$EXIT_CODE
`;
}


