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
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
  { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
  { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
  { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
  { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
  { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
  { id: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)' },
  { id: 'gemini-pro-orchestrator-g1-pro', label: 'Orchestrator (Argon)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
  { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' },
  { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
  { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
] as const;

export const DEFAULT_AGY_MODEL = AGY_AVAILABLE_MODELS[0].id;

export const AGY_AGENT_MODES = [
  {
    id: 'auto',
    label: 'Auto（全自动模式）',
    description: '自动规划、编辑文件并执行终端命令（编码与规划默认推荐）',
  },
  {
    id: 'accept-edits',
    label: 'Accept Edits（自动编辑）',
    description: '自动接受文件改动，适合受控代码修订',
  },
  {
    id: 'plan',
    label: 'Plan（只读规划）',
    description: '仅分析代码并输出计划，不直接修改源码',
  },
] as const;

export const DEFAULT_AGY_MODE = AGY_AGENT_MODES[0].id;

export const AUTODEV_WORKFLOW_PATH = '.github/workflows/autodev-agy.yml';
export const AUTODEV_DEPLOY_WORKFLOW_PATH = '.github/workflows/autodev-deploy-cf.yml';
export const AUTODEV_PLAN_WORKFLOW_PATH = '.github/workflows/autodev-plan.yml';
export const AUTODEV_PLAN_CHANNEL_BRANCH = 'autodev-plan-channel';
export const AUTODEV_E2E_VAULT_PREFIX = '.autodev-e2e-vault';
export const AUTODEV_VPS_CAPS_PATH = '.autodev-vps-capabilities.json';
export const AUTODEV_LIVE_LOG_ISSUE_TITLE = '[AutoDev] Live AGY Execution Stream';

export function buildAgyRunnerWorkflowYaml(allowedActor: string = 'jiangfengwhu'): string {
  return `name: AutoDev AGY Coding Runner

on:
  workflow_dispatch:
    inputs:
      pr_branch:
        description: 'Target Draft PR branch containing docs/spec.json and docs/prd.md'
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
        description: 'Vault-backed blind E2E test path for post-coding verification'
        required: false
        default: ''
        type: string
      revision_note:
        description: 'Optional approval rework instructions when re-running after changes_requested'
        required: false
        default: ''
        type: string
      agy_model:
        description: 'AGY model ID configured on the VPS (supports Gemini 4 & live synced models)'
        required: false
        default: '${DEFAULT_AGY_MODEL}'
        type: string
      agy_mode:
        description: 'AGY execution mode (--mode: auto, accept-edits, plan)'
        required: false
        default: '${DEFAULT_AGY_MODE}'
        type: string
      session_mode:
        description: 'Optional AGY conversation policy: fresh or resume'
        required: false
        default: 'fresh'
        type: string
      resume_session_id:
        description: 'Optional previous AGY conversation ID to resume via --conversation'
        required: false
        default: ''
        type: string
      max_repair_rounds:
        description: 'Max automatic repair rounds when blind E2E verification fails (resumes original AGY session)'
        required: false
        default: '3'
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
    timeout-minutes: 180

    steps:
      - name: Resolve Target Branch & Model Settings
        id: target
        shell: bash
        run: |
          BRANCH="\${{ inputs.pr_branch || github.head_ref }}"
          MODEL="\${{ inputs.agy_model || '${DEFAULT_AGY_MODEL}' }}"
          MODE="\${{ inputs.agy_mode || '${DEFAULT_AGY_MODE}' }}"
          PR_NUM="\${{ inputs.pr_number || github.event.pull_request.number || '' }}"
          E2E_PATH="\${{ inputs.e2e_test_path || '' }}"
          echo "branch=\${BRANCH}" >> "\$GITHUB_OUTPUT"
          echo "model=\${MODEL}" >> "\$GITHUB_OUTPUT"
          echo "mode=\${MODE}" >> "\$GITHUB_OUTPUT"
          echo "pr_number=\${PR_NUM}" >> "\$GITHUB_OUTPUT"
          echo "e2e_test_path=\${E2E_PATH}" >> "\$GITHUB_OUTPUT"

      - name: Checkout PR Branch
        uses: actions/checkout@v7
        with:
          ref: \${{ steps.target.outputs.branch }}
          fetch-depth: 0

      - name: Verify VPS AGY CLI, Capabilities, Git Push Auth & Dependencies
        shell: bash
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          export PATH="\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
          echo "Workspace CWD: \$(pwd)"
          ls -la
          which agy
          agy --version
          echo "=== AGY CLI --help capabilities ==="
          agy --help 2>&1 | head -n 120 || true
          echo "=== AGY available models ==="
          agy models 2>&1 | head -n 80 || true
          echo "=== AGY available agents ==="
          agy agents 2>&1 | head -n 60 || true
          echo "==================================="

          git config user.name "AutoDev AGY Runner"
          git config user.email "autodev-runner@users.noreply.github.com"
          if [ -n "\${GH_TOKEN}" ]; then
            git remote set-url origin "https://x-access-token:\${GH_TOKEN}@github.com/\${{ github.repository }}.git"
          fi

          if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
            echo "Installing project dependencies before AGY coding..."
            npm ci --no-audit --no-fund || npm install --no-audit --no-fund
          fi

      - name: Execute VPS AGY Coding (No Timeout + Direct Push) & Blind Independent E2E Verification
        id: agy
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          LIVE_REPO: \${{ github.repository }}
          LIVE_RUN_ID: \${{ github.run_id }}
          LIVE_BRANCH: \${{ steps.target.outputs.branch }}
          LIVE_MODEL: \${{ steps.target.outputs.model }}
          LIVE_MODE: \${{ steps.target.outputs.mode }}
          LIVE_PR_NUM: \${{ steps.target.outputs.pr_number }}
          LIVE_PIPELINE_ID: \${{ inputs.run_id }}
          REVISION_NOTE: \${{ inputs.revision_note }}
          ACTIVE_E2E_PATH: \${{ steps.target.outputs.e2e_test_path }}
          SESSION_MODE: \${{ inputs.session_mode || 'fresh' }}
          RESUME_SESSION_ID: \${{ inputs.resume_session_id || '' }}
          MAX_REPAIR_ROUNDS: \${{ inputs.max_repair_rounds || '3' }}
          REPORT_CHANNEL_BRANCH: '${AUTODEV_PLAN_CHANNEL_BRANCH}'
          E2E_VAULT_PREFIX: '${AUTODEV_E2E_VAULT_PREFIX}'
          VPS_CAPS_PATH: '${AUTODEV_VPS_CAPS_PATH}'
          CI: 'true'
          PLAYWRIGHT_HTML_OPEN: 'never'
        shell: bash
        run: |
          export PATH="\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
          LOG_FILE="/tmp/autodev-agy-\${LIVE_RUN_ID}.log"
          : > "\${LOG_FILE}"

          cat > /tmp/autodev-blind-runner.mjs <<'BLIND_RUNNER_EOF'
          import fs from 'fs';
          import path from 'path';
          import { execSync, spawn, spawnSync } from 'child_process';

          const token = process.env.GH_TOKEN || '';
          const repo = process.env.LIVE_REPO || '';
          const actionsRunId = Number(process.env.LIVE_RUN_ID || 0);
          const branch = process.env.LIVE_BRANCH || 'main';
          const requestedModel = (process.env.LIVE_MODEL || '${DEFAULT_AGY_MODEL}').trim();
          const requestedMode = (process.env.LIVE_MODE || '${DEFAULT_AGY_MODE}').trim();
          const prNumber = process.env.LIVE_PR_NUM ? Number(process.env.LIVE_PR_NUM) : undefined;
          const pipelineRunId = (process.env.LIVE_PIPELINE_ID || '').trim() || undefined;
          const revisionNote = (process.env.REVISION_NOTE || '').trim();
          const sessionMode = (process.env.SESSION_MODE || 'fresh').trim();
          const resumeSessionId = (process.env.RESUME_SESSION_ID || '').trim();
          const maxRepairRounds = Math.max(0, Math.min(5, Number(process.env.MAX_REPAIR_ROUNDS ?? 3) || 3));
          const channelBranch = process.env.REPORT_CHANNEL_BRANCH || '${AUTODEV_PLAN_CHANNEL_BRANCH}';
          const activeE2ePath = (process.env.ACTIVE_E2E_PATH || '').trim();
          const capsPath = process.env.VPS_CAPS_PATH || '${AUTODEV_VPS_CAPS_PATH}';
          const logFile = process.env.LOG_FILE || '/tmp/autodev-agy.log';
          const issueTitle = '${AUTODEV_LIVE_LOG_ISSUE_TITLE}';
          const marker = '<!-- AUTODEV-LIVE-LOG:' + actionsRunId + ' -->';
          const startedAt = Date.now();

          let issueNumber = null;
          let issueCommentCount = 0;
          let commentId = null;
          let currentPhaseLabel = 'PREPARING';
          let resolvedModel = requestedModel;
          let latestFinalChatMessage = '';

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
                signal: AbortSignal.timeout(25000),
              });
              if (!res.ok) return null;
              return await res.json().catch(() => null);
            } catch {
              return null;
            }
          }

          function encodeRepoPath(filePath) {
            return filePath.split('/').map(encodeURIComponent).join('/');
          }

          async function upsertChannelJson(filePath, data, commitMessage) {
            if (!token || !repo) return;
            const encoded = encodeRepoPath(filePath);
            let sha;
            try {
              const existing = await gh('/repos/' + repo + '/contents/' + encoded + '?ref=' + encodeURIComponent(channelBranch));
              sha = existing?.sha;
            } catch {}
            const payload = {
              message: commitMessage,
              content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
              branch: channelBranch,
            };
            if (sha) payload.sha = sha;
            await gh('/repos/' + repo + '/contents/' + encoded, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
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
                .filter(Boolean);
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
              changedLines.join('\\n') || '(当前工作区干净，或 AGY 已直接 commit/push)'
            ).replace(/~~~~/g, '----');
            const outputSection =
              logText.trim() ||
              '(AutoDev VPS AGY 已启动，正在等待 AGY 完整执行并直接推送代码…)';
            const finalChatSection = latestFinalChatMessage
              ? [
                  '',
                  '#### Coding Agent Final Chat Message',
                  '<!-- AUTODEV-FINAL-CHAT-START -->',
                  latestFinalChatMessage.replace(/~~~~/g, '----').slice(0, 16000),
                  '<!-- AUTODEV-FINAL-CHAT-END -->',
                ]
              : [];
            return [
              marker,
              '### AutoDev VPS AGY Live Stream',
              '- Status: ' + stateLabel,
              '- Run ID: ' + actionsRunId,
              ...(pipelineRunId ? ['- PipelineRunId: ' + pipelineRunId] : []),
              '- Branch: ' + branch,
              '- Model: ' + resolvedModel,
              '- Mode: ' + requestedMode,
              '- Workspace: ' + process.cwd(),
              '- Elapsed: ' + elapsedSec + 's',
              '- Updated: ' + new Date().toISOString(),
              ...finalChatSection,
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

          function detectAndResolveAgyCapabilities() {
            const verRes = spawnSync('agy', ['--version'], { encoding: 'utf8', timeout: 15000 });
            const helpRes = spawnSync('agy', ['--help'], { encoding: 'utf8', timeout: 15000 });
            const modelsRes = spawnSync('agy', ['models'], { encoding: 'utf8', timeout: 15000 });
            const agentsRes = spawnSync('agy', ['agents'], { encoding: 'utf8', timeout: 15000 });

            const version = ((verRes.stdout || '') + ' ' + (verRes.stderr || '')).trim();
            const helpText = ((helpRes.stdout || '') + '\\n' + (helpRes.stderr || '')).trim();
            const modelsText = ((modelsRes.stdout || '') + '\\n' + (modelsRes.stderr || '')).trim();
            const agentsText = ((agentsRes.stdout || '') + '\\n' + (agentsRes.stderr || '')).trim();

            const parsedModels = [];
            for (const line of modelsText.split('\\n')) {
              const clean = line.replace(/\\x1b\\[[0-9;]*[a-zA-Z]/g, '').trim();
              if (!clean || /^(fetching|loading|available|models|name|id|usage|error|---)/i.test(clean)) continue;
              const tokenMatch = clean.match(/^[-*•]?\\s*([a-z0-9][a-z0-9._-]{2,64})\\b(.*)$/i);
              if (tokenMatch) {
                const id = tokenMatch[1];
                if (!id.includes('-')) continue;
                const rest = tokenMatch[2].trim().replace(/^[-:–|]+\\s*/, '');
                if (!parsedModels.some((m) => m.id === id)) {
                  parsedModels.push({ id, label: rest ? rest.slice(0, 64) : id });
                }
              }
            }

            const parsedAgents = [];
            for (const line of agentsText.split('\\n')) {
              const clean = line.replace(/\\x1b\\[[0-9;]*[a-zA-Z]/g, '').trim();
              if (!clean || /^(available|agents|name|id|---)/i.test(clean)) continue;
              const tokenMatch = clean.match(/^[-*•]?\\s*([a-z0-9][a-z0-9._-]{1,48})\\b(.*)$/i);
              if (tokenMatch) {
                const id = tokenMatch[1];
                if (!parsedAgents.some((a) => a.id === id)) {
                  parsedAgents.push({ id, label: clean.slice(0, 80) });
                }
              }
            }

            // Smart model pre-flight resolution against live VPS agy models
            let chosenModel = requestedModel;
            if (parsedModels.length > 0 && !parsedModels.some((m) => m.id === requestedModel)) {
              const reqLower = requestedModel.toLowerCase();
              const fuzzy =
                parsedModels.find((m) => m.id.toLowerCase() === reqLower) ||
                (reqLower.includes('gemini-4')
                  ? parsedModels.find((m) => /gemini-4/i.test(m.id))
                  : null) ||
                parsedModels.find((m) => m.id.toLowerCase().includes(reqLower.split('-').slice(0, 2).join('-'))) ||
                parsedModels[0];
              if (fuzzy) {
                appendLog('[AutoDev] Requested model "' + requestedModel + '" not verbatim in VPS agy models; resolved to "' + fuzzy.id + '".');
                chosenModel = fuzzy.id;
              }
            }
            resolvedModel = chosenModel;

            return {
              version,
              supportsConversation: helpText.includes('--conversation'),
              supportsMode: helpText.includes('--mode'),
              supportsStreamJson: helpText.includes('stream-json'),
              modes: ['auto', 'accept-edits', 'plan'],
              models: parsedModels,
              agents: parsedAgents,
              rawModelsOutput: modelsText.slice(0, 4000),
              rawAgentsOutput: agentsText.slice(0, 2000),
              syncedAt: new Date().toISOString(),
            };
          }

          function buildCodingPrompt() {
            const hasRev = fs.existsSync('docs/revision-feedback.md') || Boolean(revisionNote);
            const revBlock = hasRev
              ? 'CRITICAL REWORK MODE: Read docs/revision-feedback.md thoroughly (if present) and resolve EVERY requested fix: ' + revisionNote
              : '';

            return [
              'You are the autonomous full-stack coding agent executing inside AutoDev Studio on branch \`' + branch + '\`.',
              'Current working directory is the root of this repository.',
              'Read docs/prd.md, docs/spec.json, docs/rsi-guidelines.md (if present), docs/revision-feedback.md (if present), and the repository E2E test files under tests/ (e.g. ' + (activeE2ePath || 'tests/e2e/*.spec.ts') + ') thoroughly.',
              revBlock,
              '',
              'Engineering Requirements:',
              '1. INCREMENTAL ITERATION RULE: Inspect the existing codebase first. Preserve all previously working features, existing API contracts, and existing database migrations. Do NOT rewrite unrelated working modules from scratch.',
              '2. RSI GUARDRAILS: If docs/rsi-guidelines.md exists, strictly obey every engineering guardrail inside it.',
              '3. Implement ALL atomic tasks, UI flows, edge-case states (empty states, error states, loading states), and API contracts defined in docs/spec.json in clean, modular, production-ready code.',
              '4. TRANSPARENT E2E VERIFICATION & ROOT-CAUSE DISCIPLINE: E2E test files under tests/ are directly visible in this repository. Implement the real feature cleanly from docs/prd.md and docs/spec.json — never hardcode test shortcuts or weaken real functional coverage. If you run tests and encounter a failure, ALWAYS analyze the root cause first to distinguish whether it is an application logic/UI bug OR a test script defect (such as Playwright strict-mode multi-element locator collision, unreasonable single-test timeout, outdated selector, or race condition), and fix the right side accordingly.',
              '5. Cloudflare Deployment & D1 Migration Standard (when targeting Cloudflare Workers): maintain valid wrangler.toml with Static Assets, Hono TypeScript API entry, and append-only idempotent D1 SQL migrations (CREATE TABLE IF NOT EXISTS).',
              '6. STATIC VERIFICATION BEFORE PUSH: Before committing, run finite foreground checks such as \`npx tsc --noEmit\` and \`npm run build\` (if scripts exist) and fix all errors. NEVER leave background dev servers or watch processes running.',
              '7. MANDATORY FINAL STEP — COMMIT AND PUSH CODE:',
              '   Once implementation and build/typecheck pass, stage all your code changes, commit them with a clear message, and push directly to the remote branch:',
              '   \`git add -A && git commit -m "feat(autodev): implement spec for ' + branch + '" && git push origin HEAD:' + branch + '\`',
              '   Verify \`git status\` is clean and the push succeeded before ending your turn.',
            ].filter(Boolean).join('\\n');
          }

          function stripAnsi(str) {
            return String(str || '').replace(/\\u001b\\[[0-9;]*[A-Za-z]/g, '');
          }

          function buildRepairFeedbackPrompt(verify, round, maxRounds) {
            const failedCases = (verify?.cases || []).filter((c) => c.status === 'failed');
            const detailBlocks = failedCases.slice(0, 15).map((c, idx) => {
              const header = (idx + 1) + '. [' + (c.file || verify.kind || 'check') + '] ' + c.title;
              const errText = stripAnsi(c.error || 'Assertion failed').trim().slice(0, 800);
              return header + '\\n   Error:\\n   ' + errText.replace(/\\n/g, '\\n   ');
            });
            const extraNotice = failedCases.length > 15
              ? '\\n... and ' + (failedCases.length - 15) + ' additional failed case(s).'
              : '';
            const rawFallback = detailBlocks.length === 0 && verify?.rawLogExcerpt
              ? 'Raw verification log excerpt:\\n' + stripAnsi(verify.rawLogExcerpt).slice(-2000)
              : '';

            return [
              'AUTOMATED E2E VERIFICATION FEEDBACK — AUTO-REPAIR ROUND ' + round + '/' + maxRounds + ' (branch \`' + branch + '\`).',
              'Your previous push was evaluated by the verification suite and did NOT fully pass:',
              '- Summary: ' + (verify?.passed ?? 0) + ' passed / ' + (verify?.failed ?? 0) + ' failed / ' + (verify?.skipped ?? 0) + ' skipped (total ' + (verify?.total ?? 0) + ').',
              '',
              'Failed checks & exact error diagnostics:',
              detailBlocks.join('\\n\\n') + extraNotice,
              rawFallback,
              '',
              'Repair Instructions (Root-Cause First — App Logic vs Test Script):',
              '1. MANDATORY ROOT-CAUSE TRIAGE: For EVERY failed case above, open and inspect BOTH the failing test file in \`tests/\` AND the relevant application code (frontend UI, API route, database logic). Explicitly determine whether the failure is:',
              '   (a) an APPLICATION LOGIC / UI / API BUG (missing behavior, broken interaction, wrong state/persistence, slow or hanging endpoint), OR',
              '   (b) a TEST SCRIPT DEFECT (e.g., Playwright strict-mode locator matching multiple elements, over-packed single test hitting the default 30s timeout, wrong selector/copy assumption, or missing wait for network/navigation).',
              '2. FIX THE TRUE ROOT CAUSE:',
              '   - If it is an application bug, fix the application code cleanly while preserving all ' + (verify?.passed ?? 0) + ' already-passing tests.',
              '   - If it is a test script defect, fix the test script directly (e.g., scope ambiguous locators accurately, split or increase timeout for long multi-step flows, fix brittle selectors) WITHOUT deleting or watering down the real functional assertions required by docs/prd.md and docs/spec.json.',
              '   - In your final summary reply, clearly state for each failure whether the root cause was in application code or in the test script, and what you changed.',
              '3. Run finite static verification (\`npx tsc --noEmit\`, \`npm run build\` if present) and verify the failing test passes locally. NEVER leave background servers running.',
              '4. MANDATORY FINAL STEP — COMMIT AND PUSH YOUR FIX:',
              '   \`git add -A && git commit -m "fix(autodev): resolve E2E verification failures (round ' + round + ')" && git push origin HEAD:' + branch + '\`',
              '   Verify \`git status\` is clean and push succeeded before ending your turn.',
            ].filter(Boolean).join('\\n');
          }

          function runAgyToCompletion({ prompt, resumeId, useStreamJson, supportsMode, supportsConversation }) {
            return new Promise((resolve) => {
              const args = [
                '--dangerously-skip-permissions',
                '--model',
                resolvedModel,
              ];
              if (supportsMode && requestedMode) {
                args.push('--mode', requestedMode);
              }
              if (useStreamJson) {
                args.push('--output-format', 'stream-json');
              }
              if (resumeId && supportsConversation) {
                args.push('--conversation', resumeId);
              }
              // NO --print-timeout: let AGY wait naturally until the full turn completes!
              args.push('--print=' + prompt);

              appendLog(
                '=== [AutoDev] Starting VPS AGY (no timeout, wait-until-complete, model=' +
                resolvedModel + ', mode=' + requestedMode +
                (useStreamJson ? ', stream-json' : '') +
                (resumeId ? ', conversation=' + resumeId : ', fresh session') + ') ==='
              );

              const child = spawn('agy', args, {
                cwd: process.cwd(),
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                  ...process.env,
                  CI: 'true',
                  PLAYWRIGHT_HTML_OPEN: 'never',
                },
              });

              let combinedOut = '';
              let lineBuf = '';
              let directCapturedSessionId = undefined;
              let finalResponseText = '';
              let currentAssistantTurnBlocks = [];
              let lastCompletedAssistantMessage = '';
              let reportedInputTokens = 0;
              let reportedOutputTokens = 0;
              let reportedTotalTokens = 0;
              let hasReportedTokens = false;
              const roundStart = Date.now();

              const captureUsageObj = (u) => {
                if (!u || typeof u !== 'object') return;
                const inp = Number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0) || 0;
                const out = Number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0) || 0;
                const tot = Number(u.total_tokens ?? u.totalTokens ?? u.totalTokenCount ?? 0) || (inp + out);
                if (tot > 0 || inp > 0 || out > 0) {
                  hasReportedTokens = true;
                  reportedInputTokens = Math.max(reportedInputTokens, inp);
                  reportedOutputTokens = Math.max(reportedOutputTokens, out);
                  reportedTotalTokens = Math.max(reportedTotalTokens, tot || (inp + out));
                }
              };

              const flushAssistantTurnBeforeTool = () => {
                if (currentAssistantTurnBlocks.length > 0) {
                  const joined = currentAssistantTurnBlocks.join('').trim();
                  if (joined) lastCompletedAssistantMessage = joined;
                  currentAssistantTurnBlocks = [];
                }
              };

              const formatStreamJsonLine = (rawLine) => {
                const trimmed = rawLine.trim();
                if (!trimmed) return '';
                if (!trimmed.startsWith('{')) return rawLine;
                try {
                  const ev = JSON.parse(trimmed);
                  const evType = String(ev.type || ev.event || '');
                  captureUsageObj(ev.usage);
                  captureUsageObj(ev.token_usage);
                  captureUsageObj(ev.result?.usage);
                  captureUsageObj(ev.result?.token_usage);
                  captureUsageObj(ev.result?.stats?.usage);
                  captureUsageObj(ev.message?.usage);
                  captureUsageObj(ev.stats?.usage);
                  const foundSid =
                    ev.session_id ||
                    ev.sessionId ||
                    ev.conversation_id ||
                    ev.conversationId ||
                    ev.result?.conversation_id ||
                    ev.result?.session_id ||
                    ev.result?.conversationId ||
                    ev.result?.sessionId;
                  if (foundSid) {
                    const sid = String(foundSid).trim();
                    if (sid) {
                      directCapturedSessionId = sid;
                      combinedOut += '\\nsession_id=' + sid + '\\n';
                    }
                  }
                  if (evType === 'result' || evType === 'turn_complete' || evType === 'done') {
                    const fullResp =
                      (typeof ev.result === 'string'
                        ? ev.result
                        : ev.result?.response || ev.result?.text || ev.result?.content || ev.response || ev.text || '') || '';
                    if (typeof fullResp === 'string' && fullResp.trim()) {
                      finalResponseText = stripAnsi(fullResp).trim().slice(0, 40000);
                    }
                    const msg = typeof ev.result === 'string' ? ev.result.slice(0, 300) : JSON.stringify(ev).slice(0, 300);
                    return '[agy:result] ' + msg;
                  }
                  if (evType === 'tool_use' || evType === 'tool_call' || ev.tool_name || ev.name) {
                    flushAssistantTurnBeforeTool();
                    const toolName = String(ev.tool_name || ev.name || ev.tool?.name || 'tool');
                    const inputPreview = JSON.stringify(ev.input || ev.arguments || ev.args || {}).slice(0, 180);
                    return '[agy:tool] ' + toolName + ' ' + inputPreview;
                  }
                  if (evType === 'assistant' && ev.message) {
                    const blocks = Array.isArray(ev.message.content) ? ev.message.content : [];
                    const parts = [];
                    const hasToolBlock = blocks.some((b) => b?.type === 'tool_use');
                    const turnTexts = [];
                    for (const b of blocks) {
                      if (b?.type === 'tool_use') {
                        parts.push('[agy:tool] ' + String(b.name || 'tool') + ' ' + JSON.stringify(b.input || {}).slice(0, 160));
                      } else if (b?.type === 'text' && b.text) {
                        const cleanText = stripAnsi(String(b.text));
                        turnTexts.push(cleanText);
                        parts.push('[agy] ' + cleanText.replace(/\\s+/g, ' ').slice(0, 240));
                      }
                    }
                    if (turnTexts.length > 0) {
                      const joinedTurn = turnTexts.join('\\n\\n').trim();
                      if (joinedTurn) {
                        lastCompletedAssistantMessage = joinedTurn;
                        currentAssistantTurnBlocks = hasToolBlock ? [] : [joinedTurn];
                      }
                    } else if (hasToolBlock) {
                      flushAssistantTurnBeforeTool();
                    }
                    if (parts.length > 0) return parts.join('\\n');
                  }
                  if (evType === 'text' || evType === 'delta' || typeof ev.text === 'string' || typeof ev.delta === 'string') {
                    const rawDelta = stripAnsi(String(ev.text ?? ev.delta ?? ''));
                    if (rawDelta) {
                      currentAssistantTurnBlocks.push(rawDelta);
                      const assembled = currentAssistantTurnBlocks.join('').trim();
                      if (assembled) lastCompletedAssistantMessage = assembled;
                    }
                    const trimmedDelta = rawDelta.trim();
                    return trimmedDelta ? '[agy] ' + trimmedDelta.slice(0, 240) : '';
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

              child.on('error', (err) => {
                appendLog('[AutoDev] AGY spawn error: ' + String(err));
                resolve({
                  exitCode: 1,
                  elapsedMs: Date.now() - roundStart,
                  capturedSessionId: directCapturedSessionId,
                  finalResponse: '',
                  tokenUsage: undefined,
                });
              });
              child.on('close', (code) => {
                if (useStreamJson && lineBuf.trim()) {
                  const tailFormatted = formatStreamJsonLine(lineBuf);
                  if (tailFormatted) {
                    process.stdout.write(tailFormatted + '\\n');
                    try {
                      fs.appendFileSync(logFile, tailFormatted + '\\n');
                    } catch {}
                  }
                }
                const sessionMatch = combinedOut.match(/(?:session[_ -]?id|sessionId|conversation[_ -]?id|conversationId)["'\\s:=]+([A-Za-z0-9_-]{8,64})/i);
                const finalTurnAssistantText = currentAssistantTurnBlocks.join('').trim();
                // Prefer the agent's final chat window reply (after all tool calls finished) — never raw runner/terminal logs
                const resolvedResponse =
                  finalResponseText ||
                  finalTurnAssistantText ||
                  lastCompletedAssistantMessage ||
                  '';
                const tokenUsage = hasReportedTokens
                  ? {
                      inputTokens: reportedInputTokens,
                      outputTokens: reportedOutputTokens,
                      totalTokens: reportedTotalTokens || (reportedInputTokens + reportedOutputTokens),
                      source: 'reported',
                      model: resolvedModel,
                    }
                  : undefined;
                resolve({
                  exitCode: code ?? 1,
                  elapsedMs: Date.now() - roundStart,
                  capturedSessionId: directCapturedSessionId || (sessionMatch ? sessionMatch[1] : undefined),
                  finalResponse: resolvedResponse.slice(0, 40000),
                  tokenUsage,
                });
              });
            });
          }

          function ensureChangesCommittedAndPushed(initialHeadSha) {
            const dirty = getCleanGitStatusLines();
            if (dirty.length > 0) {
              appendLog('[AutoDev] AGY left uncommitted files; committing & pushing fallback commit to ' + branch + '...');
              spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
              spawnSync('git', ['commit', '-m', 'feat(autodev): implement spec via VPS AGY (' + resolvedModel + ')'], { stdio: 'inherit' });
            }
            const currentHeadSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
            // Always ensure remote branch is up to date with HEAD
            const pushRes = spawnSync('git', ['push', 'origin', 'HEAD:' + branch], { encoding: 'utf8' });
            if (pushRes.status !== 0) {
              appendLog('[AutoDev] git push warning: ' + ((pushRes.stderr || '') + (pushRes.stdout || '')).slice(0, 400));
            } else {
              appendLog('[AutoDev] Confirmed branch ' + branch + ' pushed at ' + currentHeadSha.slice(0, 7));
            }
            return {
              changed: currentHeadSha !== initialHeadSha,
              commitSha: currentHeadSha.slice(0, 7),
            };
          }

          function runBlindVerification() {
            const startedAll = Date.now();
            const cases = [];
            let kind = 'build_check';
            let rawLog = '';

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
              if (testCmd && !testCmd.includes('no test specified') && !(hasPlaywrightCfg && /playwright/i.test(testCmd))) {
                kind = 'unit';
                runCheck('check-unit', '自动化单元测试 (npm test)', 'npm', ['test']);
              }
            }

            if (fs.existsSync('playwright.config.ts') || fs.existsSync('playwright.config.js')) {
              kind = 'e2e';
              const t0 = Date.now();
              const pw = spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
                encoding: 'utf8',
                timeout: 300000,
                env: { ...process.env, CI: 'true', PLAYWRIGHT_HTML_OPEN: 'never' },
              });
              const durationMs = Date.now() - t0;
              rawLog += '\\n=== Playwright E2E Verification ===\\n' + ((pw.stderr || '') + '\\n' + (pw.stdout || '')).slice(-2500);
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
                  title: 'Playwright E2E 验收测试套件',
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
            const allPassed = total > 0 ? failed === 0 && passed > 0 : true;

            return {
              kind,
              status,
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

          async function publishTestReport(verify, meta) {
            if (!token || !repo) return;
            const effectiveVerify = verify || {
              kind: 'build_check',
              status: meta.agyExitCode === 0 ? 'passed' : 'failed',
              total: 0,
              passed: 0,
              failed: 0,
              skipped: 0,
              durationMs: 0,
              cases: [],
              rawLogExcerpt: '',
            };
            if (effectiveVerify.total <= 0 && !meta.codingFinalOutput) return;
            const report = {
              runId: pipelineRunId,
              actionsRunId,
              actionsUrl: 'https://github.com/' + repo + '/actions/runs/' + actionsRunId,
              workflowName: 'AutoDev AGY Coding Runner',
              branch,
              prNumber,
              commitSha: meta.commitSha,
              model: resolvedModel,
              kind: effectiveVerify.kind,
              status: effectiveVerify.status,
              total: effectiveVerify.total,
              passed: effectiveVerify.passed,
              failed: effectiveVerify.failed,
              skipped: effectiveVerify.skipped,
              durationMs: effectiveVerify.durationMs,
              executedAt: new Date().toISOString(),
              summary:
                '自动化 E2E 验收（' + resolvedModel + ' / ' + requestedMode +
                (meta.repairRounds > 0 ? ' · 自动返工 ' + meta.repairRounds + ' 轮' : '') + '）：' +
                effectiveVerify.passed + ' 通过 / ' + effectiveVerify.failed + ' 失败 / ' + effectiveVerify.skipped + ' 跳过',
              cases: effectiveVerify.cases,
              rawLogExcerpt: effectiveVerify.rawLogExcerpt,
              ...(meta.agySessionId ? { agySessionId: meta.agySessionId } : {}),
              agySessionReused: meta.agySessionReused,
              agyExitCode: meta.agyExitCode,
              repairRounds: meta.repairRounds || 0,
              ...(meta.codingFinalOutput ? { codingFinalOutput: meta.codingFinalOutput } : {}),
              ...(meta.tokenUsage ? { tokenUsage: meta.tokenUsage } : {}),
            };
            await upsertChannelJson(
              '.autodev-test-reports/' + actionsRunId + '.json',
              report,
              'chore(autodev-test): publish E2E verification report & coding output for run ' + actionsRunId
            );
          }

          async function main() {
            const initialHeadSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
            const caps = detectAndResolveAgyCapabilities();
            appendLog('[AutoDev] VPS AGY capabilities synced: version=' + caps.version + ', models=' + caps.models.length + ', agents=' + caps.agents.length);
            await upsertChannelJson(capsPath, caps, 'chore(autodev): sync live VPS AGY capabilities').catch(() => {});

            await syncLiveComment('CODING (waiting for AGY completion)');
            const ticker = setInterval(() => {
              syncLiveComment(currentPhaseLabel).catch(() => {});
            }, 8000);

            let agyRes = { exitCode: 1, elapsedMs: 0, capturedSessionId: undefined, finalResponse: '', tokenUsage: undefined };
            let pushInfo = { changed: false, commitSha: initialHeadSha.slice(0, 7) };
            let verify = null;
            let repairRounds = 0;
            let totalAgyElapsedMs = 0;
            const codingOutputSections = [];
            const accTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false };
            let useStreamJson = Boolean(caps.supportsStreamJson);
            const initialResume = sessionMode === 'resume' && resumeSessionId && caps.supportsConversation ? resumeSessionId : undefined;
            let activeSessionId = initialResume;
            let sessionReused = Boolean(initialResume);

            const executeAgyTurn = async (promptText, resumeTarget, fallbackLabel) => {
              let res = await runAgyToCompletion({
                prompt: promptText,
                resumeId: resumeTarget,
                useStreamJson,
                supportsMode: caps.supportsMode,
                supportsConversation: caps.supportsConversation,
              });

              if (useStreamJson && res.exitCode !== 0 && res.elapsedMs < 20000) {
                appendLog('[AutoDev] stream-json exited quickly; retrying without --output-format stream-json.');
                useStreamJson = false;
                res = await runAgyToCompletion({
                  prompt: promptText,
                  resumeId: resumeTarget,
                  useStreamJson: false,
                  supportsMode: caps.supportsMode,
                  supportsConversation: caps.supportsConversation,
                });
              }

              if (resumeTarget && res.exitCode !== 0 && res.elapsedMs < 45000) {
                appendLog('[AutoDev] Resuming conversation (' + resumeTarget.slice(0, 12) + ') failed quickly during ' + fallbackLabel + '; retrying with fresh session.');
                sessionReused = false;
                res = await runAgyToCompletion({
                  prompt: promptText,
                  resumeId: undefined,
                  useStreamJson,
                  supportsMode: caps.supportsMode,
                  supportsConversation: caps.supportsConversation,
                });
              }

              totalAgyElapsedMs += Number(res.elapsedMs || 0);
              if (res.tokenUsage && res.tokenUsage.totalTokens > 0) {
                accTokens.reported = true;
                accTokens.inputTokens += res.tokenUsage.inputTokens || 0;
                accTokens.outputTokens += res.tokenUsage.outputTokens || 0;
                accTokens.totalTokens += res.tokenUsage.totalTokens || 0;
              }
              if (res.finalResponse && res.finalResponse.trim()) {
                codingOutputSections.push({
                  label: fallbackLabel,
                  text: res.finalResponse.trim(),
                });
              }
              if (res.capturedSessionId) {
                activeSessionId = res.capturedSessionId;
              }
              return res;
            };

            const runVerificationCycle = async (labelSuffix) => {
              currentPhaseLabel = 'E2E VERIFICATION' + (labelSuffix ? ' (' + labelSuffix + ')' : '');
              await syncLiveComment(currentPhaseLabel);
              const v = runBlindVerification();
              appendLog(
                '[AutoDev] E2E Verification' + (labelSuffix ? ' [' + labelSuffix + ']' : '') + ' finished: ' +
                v.passed + ' passed / ' + v.failed + ' failed / ' + v.skipped + ' skipped'
              );
              return v;
            };

            try {
              // 1. Initial AGY coding turn (NO blind hiding; repo E2E tests are directly visible to Coding Agent)
              currentPhaseLabel = 'CODING (' + resolvedModel + ' · ' + requestedMode + (activeSessionId ? ' · resume ' + activeSessionId.slice(0, 8) : '') + ')';
              await syncLiveComment(currentPhaseLabel);
              agyRes = await executeAgyTurn(buildCodingPrompt(), activeSessionId, 'initial coding');
              appendLog('[AutoDev] AGY initial turn completed (exit=' + agyRes.exitCode + ', elapsed=' + Math.round(agyRes.elapsedMs / 1000) + 's, session=' + (activeSessionId || 'none') + ').');

              // 2. Ensure all AGY edits are committed & pushed
              pushInfo = ensureChangesCommittedAndPushed(initialHeadSha);

              // 3. Run repository Playwright E2E + static/unit verification directly
              verify = await runVerificationCycle('initial');

              // 4. Auto-Repair Feedback Loop: feed diagnostics back to the SAME AGY session to triage app bug vs test script defect!
              while (verify && !verify.allPassed && repairRounds < maxRepairRounds) {
                repairRounds += 1;
                const targetSession = caps.supportsConversation ? activeSessionId : undefined;
                if (targetSession) {
                  sessionReused = true;
                }
                appendLog(
                  '[AutoDev] Verification failed (' + verify.passed + ' passed / ' + verify.failed +
                  ' failed). Feeding error diagnostics back to ' +
                  (targetSession ? 'original AGY session ' + targetSession : 'fresh AGY session') +
                  ' for root-cause auto-repair round ' + repairRounds + '/' + maxRepairRounds + '...'
                );

                currentPhaseLabel =
                  'AUTO-REPAIRING (' + repairRounds + '/' + maxRepairRounds +
                  (targetSession ? ' · session ' + targetSession.slice(0, 8) : '') + ')';
                await syncLiveComment(currentPhaseLabel);

                const repairPrompt = buildRepairFeedbackPrompt(verify, repairRounds, maxRepairRounds);
                agyRes = await executeAgyTurn(repairPrompt, targetSession, 'auto-repair round ' + repairRounds);
                appendLog(
                  '[AutoDev] AGY auto-repair round ' + repairRounds + '/' + maxRepairRounds +
                  ' completed (exit=' + agyRes.exitCode + ', elapsed=' + Math.round(agyRes.elapsedMs / 1000) +
                  's, session=' + (activeSessionId || 'none') + ').'
                );

                pushInfo = ensureChangesCommittedAndPushed(initialHeadSha);
                verify = await runVerificationCycle('repair ' + repairRounds + '/' + maxRepairRounds);
              }
            } finally {
              clearInterval(ticker);
            }

            // Surface ONLY the final round's assistant chat window reply to the user (not multi-round runner logs)
            const combinedCodingFinalOutput = codingOutputSections.length > 0
              ? String(codingOutputSections[codingOutputSections.length - 1].text || '').trim().slice(0, 40000)
              : '';
            if (combinedCodingFinalOutput) {
              latestFinalChatMessage = combinedCodingFinalOutput;
            }

            const totalElapsedMin = Math.max(0.1, totalAgyElapsedMs / 60000);
            const estTotal = Math.round(totalElapsedMin * 22000);
            const estInput = Math.round(estTotal * 0.72);
            const finalTokenUsage = accTokens.reported && accTokens.totalTokens > 0
              ? {
                  inputTokens: accTokens.inputTokens,
                  outputTokens: accTokens.outputTokens,
                  totalTokens: accTokens.totalTokens,
                  source: 'reported',
                  model: resolvedModel,
                }
              : {
                  inputTokens: estInput,
                  outputTokens: Math.max(0, estTotal - estInput),
                  totalTokens: estTotal,
                  source: 'estimated',
                  model: resolvedModel,
                };

            await publishTestReport(verify, {
              agySessionId: activeSessionId || agyRes.capturedSessionId || initialResume,
              agySessionReused: sessionReused,
              agyExitCode: agyRes.exitCode,
              repairRounds,
              commitSha: pushInfo.commitSha,
              codingFinalOutput: combinedCodingFinalOutput || undefined,
              tokenUsage: finalTokenUsage,
            });

            const verifiedOk = Boolean(verify && verify.allPassed && agyRes.exitCode === 0);
            const finalStatus = verifiedOk
              ? 'COMPLETED (E2E verified ' + verify.passed + '/' + verify.total +
                (repairRounds > 0 ? ', auto-repaired in ' + repairRounds + ' round(s)' : '') +
                ', commit ' + pushInfo.commitSha + ')'
              : 'FAILED (agyExit=' + agyRes.exitCode + ', repairRounds=' + repairRounds + ', verify=' + (verify ? verify.passed + '/' + verify.total + ', ' + verify.failed + ' failed' : 'skipped') + ')';
            await syncLiveComment(finalStatus);

            if (process.env.GITHUB_OUTPUT) {
              const lines = [
                'verified_complete=' + (verifiedOk ? 'true' : 'false'),
                'passed_count=' + (verify ? verify.passed : 0),
                'failed_count=' + (verify ? verify.failed : 0),
                'repair_rounds=' + repairRounds,
                'changed=' + (pushInfo.changed ? 'true' : 'false'),
                'commit_sha=' + pushInfo.commitSha,
                'resolved_model=' + resolvedModel,
                'agy_exit=' + agyRes.exitCode,
              ];
              fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\\n') + '\\n');
            }

            process.exit(verifiedOk ? 0 : 1);
          }

          main().catch(async (err) => {
            appendLog('[AutoDev] Fatal runner error: ' + String(err));
            await syncLiveComment('FAILED (fatal runner error)').catch(() => {});
            process.exit(1);
          });
          BLIND_RUNNER_EOF

          export LOG_FILE
          set +e
          node /tmp/autodev-blind-runner.mjs
          RUNNER_EXIT=\$?
          set -e
          rm -f /tmp/autodev-blind-runner.mjs "\${LOG_FILE}"
          exit "\${RUNNER_EXIT}"

      - name: Post Summary Comment on Draft PR
        if: always() && steps.target.outputs.pr_number != ''
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        shell: bash
        run: |
          if [ "\${{ steps.agy.outputs.verified_complete }}" = "true" ]; then
            cat > /tmp/autodev-pr-summary.md <<'COMMENT_EOF'
          ### AutoDev VPS AGY 编码完成 · 自动化 E2E 验收通过
          - Model: \`\${{ steps.agy.outputs.resolved_model || steps.target.outputs.model }}\` · Mode: \`\${{ steps.target.outputs.mode }}\`
          - Commit: \`\${{ steps.agy.outputs.commit_sha }}\` · 自动修复返工轮次：\${{ steps.agy.outputs.repair_rounds || 0 }}
          - E2E 验收校验：\${{ steps.agy.outputs.passed_count }} 项通过 / \${{ steps.agy.outputs.failed_count }} 项失败
          - 请前往 AutoDev Studio「验收签批部」进行人工验收与一键发布。
          COMMENT_EOF
          else
            cat > /tmp/autodev-pr-summary.md <<'COMMENT_EOF'
          ### AutoDev VPS AGY 执行结束 · E2E 校验仍有待修复项
          - Model: \`\${{ steps.agy.outputs.resolved_model || steps.target.outputs.model }}\` · Mode: \`\${{ steps.target.outputs.mode }}\`
          - Commit: \`\${{ steps.agy.outputs.commit_sha }}\` · AGY Exit: \`\${{ steps.agy.outputs.agy_exit }}\` · 已自动返工修复：\${{ steps.agy.outputs.repair_rounds || 0 }} 轮
          - E2E 验收校验：\${{ steps.agy.outputs.passed_count }} 项通过 / \${{ steps.agy.outputs.failed_count }} 项失败
          - 完整结构化测试报告已同步至 AutoDev Studio「质检进化圣殿 (RSI)」。
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
        description: 'AGY model ID configured on the VPS (supports Gemini 4 & live synced models)'
        required: false
        default: '${DEFAULT_AGY_MODEL}'
        type: string
      agy_mode:
        description: 'AGY execution mode (--mode: auto, accept-edits, plan)'
        required: false
        default: '${DEFAULT_AGY_MODE}'
        type: string

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
    timeout-minutes: 90

    steps:
      - name: Checkout Latest Base Branch (Full Codebase Context)
        uses: actions/checkout@v7
        with:
          ref: \${{ inputs.base_branch || 'main' }}
          fetch-depth: 0

      - name: Run Single-Turn Unified Instabox AGY Planning (Architect + QA Spec + QA Critic)
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PLAN_REPO: \${{ github.repository }}
          PLAN_RUN_ID: \${{ github.run_id }}
          PLAN_JOB_ID: \${{ inputs.job_id }}
          PLAN_BASE_BRANCH: \${{ inputs.base_branch || 'main' }}
          PLAN_CHANNEL_BRANCH: \${{ inputs.channel_branch || 'autodev-plan-channel' }}
          PLAN_MODEL: \${{ inputs.agy_model || '${DEFAULT_AGY_MODEL}' }}
          PLAN_MODE: \${{ inputs.agy_mode || '${DEFAULT_AGY_MODE}' }}
        shell: bash
        run: |
          export PATH="\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
          echo "Workspace CWD: \$(pwd)"
          which agy
          agy --version

          cat > /tmp/autodev-plan-runner.mjs <<'PLAN_RUNNER_EOF'
          import fs from 'fs';
          import path from 'path';
          import { execSync, spawn, spawnSync } from 'child_process';

          const token = process.env.GH_TOKEN;
          const repo = process.env.PLAN_REPO;
          const actionsRunId = Number(process.env.PLAN_RUN_ID || 0);
          const jobId = process.env.PLAN_JOB_ID;
          const safeJobId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
          const baseBranch = process.env.PLAN_BASE_BRANCH || 'main';
          const channelBranch = process.env.PLAN_CHANNEL_BRANCH || 'autodev-plan-channel';
          const requestedModel = (process.env.PLAN_MODEL || '${DEFAULT_AGY_MODEL}').trim();
          const requestedMode = (process.env.PLAN_MODE || '${DEFAULT_AGY_MODE}').trim();
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

          // Resolve requested model against live VPS agy models
          let model = requestedModel;
          const helpText = String(spawnSync('agy', ['--help'], { encoding: 'utf8', timeout: 15000 }).stdout || '');
          const supportsMode = helpText.includes('--mode');
          const supportsStreamJson = helpText.includes('stream-json');
          const supportsConversation = helpText.includes('--conversation');
          try {
            const mText = String(spawnSync('agy', ['models'], { encoding: 'utf8', timeout: 15000 }).stdout || '');
            const ids = [];
            for (const line of mText.split('\\n')) {
              const clean = line.replace(/\\x1b\\[[0-9;]*[a-zA-Z]/g, '').trim();
              if (!clean || /^(fetching|loading|available|models|name|id|usage|error|---)/i.test(clean)) continue;
              const m = clean.match(/^[-*•]?\\s*([a-z0-9][a-z0-9._-]{2,64})\\b/i);
              if (m && m[1].includes('-') && !ids.includes(m[1])) ids.push(m[1]);
            }
            if (ids.length > 0 && !ids.includes(requestedModel)) {
              const lower = requestedModel.toLowerCase();
              const fuzzy =
                ids.find((id) => id.toLowerCase() === lower) ||
                (lower.includes('gemini-4') ? ids.find((id) => /gemini-4/i.test(id)) : null) ||
                ids[0];
              if (fuzzy) {
                console.log('[Plan] Resolved model "' + requestedModel + '" -> "' + fuzzy + '"');
                model = fuzzy;
              }
            }
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
            const maxAttempts = 5;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              if (!sha) {
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
                if ((err.status === 409 || err.status === 422) && attempt < maxAttempts) {
                  sha = undefined;
                  const waitMs = 450 * attempt + Math.floor(Math.random() * 250);
                  console.warn('[writeChannelFile retry ' + attempt + '/' + maxAttempts + '] HTTP ' + err.status + ' on ' + filePath + ', waiting ' + waitMs + 'ms');
                  await sleep(waitMs);
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
            mode: 'unified_single_turn',
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

          function invokeAgyAsync(promptText, resumeSessionId, useStreamJsonFlag) {
            return new Promise((resolve) => {
              const args = [
                '--dangerously-skip-permissions',
                '--model',
                model,
              ];
              if (supportsMode && requestedMode) {
                args.push('--mode', requestedMode);
              }
              if (useStreamJsonFlag) {
                args.push('--output-format', 'stream-json');
              }
              if (resumeSessionId && supportsConversation) {
                args.push('--conversation', resumeSessionId);
              }
              // NO --print-timeout: wait naturally until AGY completes the unified planning conversation
              args.push('--print=' + promptText);

              const child = spawn('agy', args, {
                cwd: process.cwd(),
                stdio: ['ignore', 'pipe', 'pipe'],
              });

              const maxCapture = 4 * 1024 * 1024;
              const startMs = Date.now();
              let stdout = '';
              let stderr = '';
              let lineBuf = '';
              let capturedSessionId = undefined;
              let finalResponse = '';
              let reportedInputTokens = 0;
              let reportedOutputTokens = 0;
              let reportedTotalTokens = 0;
              let hasReportedTokens = false;

              const captureUsage = (u) => {
                if (!u || typeof u !== 'object') return;
                const inp = Number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0) || 0;
                const out = Number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0) || 0;
                const tot = Number(u.total_tokens ?? u.totalTokens ?? u.totalTokenCount ?? 0) || (inp + out);
                if (tot > 0 || inp > 0 || out > 0) {
                  hasReportedTokens = true;
                  reportedInputTokens = Math.max(reportedInputTokens, inp);
                  reportedOutputTokens = Math.max(reportedOutputTokens, out);
                  reportedTotalTokens = Math.max(reportedTotalTokens, tot || (inp + out));
                }
              };

              const parseStreamLine = (rawLine) => {
                const trimmed = rawLine.trim();
                if (!trimmed || !trimmed.startsWith('{')) return;
                try {
                  const ev = JSON.parse(trimmed);
                  captureUsage(ev.usage);
                  captureUsage(ev.token_usage);
                  captureUsage(ev.result?.usage);
                  captureUsage(ev.result?.token_usage);
                  captureUsage(ev.message?.usage);
                  captureUsage(ev.stats?.usage);
                  const sid =
                    ev.session_id ||
                    ev.sessionId ||
                    ev.conversation_id ||
                    ev.conversationId ||
                    ev.result?.conversation_id ||
                    ev.result?.session_id;
                  if (sid) capturedSessionId = String(sid).trim();
                  const evType = String(ev.type || ev.event || '');
                  if (evType === 'result' || evType === 'turn_complete' || evType === 'done') {
                    const resp =
                      typeof ev.result === 'string'
                        ? ev.result
                        : ev.result?.response || ev.result?.text || ev.response || '';
                    if (typeof resp === 'string' && resp.trim()) {
                      finalResponse = resp.trim();
                    }
                  }
                } catch {}
              };

              child.stdout.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                process.stdout.write(text);
                stdout += text;
                if (stdout.length > maxCapture) {
                  stdout = stdout.slice(-maxCapture);
                }
                if (useStreamJsonFlag) {
                  lineBuf += text;
                  const lines = lineBuf.split('\\n');
                  lineBuf = lines.pop() || '';
                  for (const l of lines) parseStreamLine(l);
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
                resolve({
                  status: 1,
                  stdout,
                  stderr: stderr + '\\n' + String(err),
                  elapsedMs: Date.now() - startMs,
                  capturedSessionId,
                  finalResponse,
                  tokenUsage: undefined,
                });
              });

              child.on('close', (code) => {
                if (useStreamJsonFlag && lineBuf.trim()) {
                  parseStreamLine(lineBuf);
                }
                const tokenUsage = hasReportedTokens
                  ? {
                      inputTokens: reportedInputTokens,
                      outputTokens: reportedOutputTokens,
                      totalTokens: reportedTotalTokens || (reportedInputTokens + reportedOutputTokens),
                      source: 'reported',
                      model,
                    }
                  : undefined;
                resolve({
                  status: code ?? 1,
                  stdout,
                  stderr,
                  elapsedMs: Date.now() - startMs,
                  capturedSessionId,
                  finalResponse,
                  tokenUsage,
                });
              });
            });
          }

          async function runUnifiedPlanStage(basePrompt) {
            const startedMs = Date.now();
            const startedIso = new Date().toISOString();
            const relBundlePath = '.autodev-plan-output/plan-bundle.json';
            const absBundlePath = path.join(process.cwd(), relBundlePath);

            state.steps.architect = {
              status: 'running',
              startedAt: startedIso,
              message: '单对话联合规划中：正在阅读代码库并一次性生成架构方案、API 契约与原子任务树…',
            };
            state.steps.qa_spec = {
              status: 'running',
              startedAt: startedIso,
              message: '同会话同步产出接口测试清单与初版 Playwright E2E 脚本…',
            };
            state.steps.qa_critic = {
              status: 'running',
              startedAt: startedIso,
              message: '同会话完成盲测安全评审并输出终版加固 E2E 套件…',
            };
            await syncState();

            let lastErr = '';
            let activeSessionId = undefined;
            let useStreamJsonFlag = supportsStreamJson;
            let totalElapsedMs = 0;
            const accTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false };

            for (let attempt = 1; attempt <= 2; attempt++) {
              fs.mkdirSync(wsOutDir, { recursive: true });
              const prompt =
                attempt === 1
                  ? basePrompt
                  : 'Your previous unified plan JSON failed validation with error: ' +
                    lastErr +
                    '. Fix the JSON and write ONLY a single valid JSON object with top-level keys "architect", "qa_spec", and "qa_critic" to ' +
                    relBundlePath +
                    ' (do not modify any other repository files).';

              console.log('=== Running unified single-turn AGY plan, attempt:', attempt, activeSessionId ? '(resume ' + activeSessionId.slice(0, 8) + ')' : '(fresh)', '===');
              let execRes = await invokeAgyAsync(prompt, attempt > 1 ? activeSessionId : undefined, useStreamJsonFlag);

              if (useStreamJsonFlag && execRes.status !== 0 && execRes.elapsedMs < 20000) {
                console.log('[Plan] stream-json exited quickly; retrying without stream-json.');
                useStreamJsonFlag = false;
                execRes = await invokeAgyAsync(prompt, undefined, false);
              }

              totalElapsedMs += Number(execRes.elapsedMs || 0);
              if (execRes.capturedSessionId) {
                activeSessionId = execRes.capturedSessionId;
              }
              if (execRes.tokenUsage && execRes.tokenUsage.totalTokens > 0) {
                accTokens.reported = true;
                accTokens.inputTokens += execRes.tokenUsage.inputTokens || 0;
                accTokens.outputTokens += execRes.tokenUsage.outputTokens || 0;
                accTokens.totalTokens += execRes.tokenUsage.totalTokens || 0;
              }

              let parsedBundle = null;
              try {
                if (fs.existsSync(absBundlePath)) {
                  const fileContent = fs.readFileSync(absBundlePath, 'utf8');
                  parsedBundle = extractJsonLoose(fileContent);
                } else if (execRes.finalResponse) {
                  parsedBundle = extractJsonLoose(execRes.finalResponse);
                } else {
                  parsedBundle = extractJsonLoose(execRes.stdout);
                }
              } catch (parseErr) {
                lastErr = 'JSON parse error: ' + (parseErr instanceof Error ? parseErr.message : String(parseErr));
                parsedBundle = null;
              }

              // Also support fallback if AGY wrote separate stage files in .autodev-plan-output/
              if (!parsedBundle) {
                try {
                  const aPath = path.join(wsOutDir, 'architect.json');
                  const sPath = path.join(wsOutDir, 'qa_spec.json');
                  const cPath = path.join(wsOutDir, 'qa_critic.json');
                  if (fs.existsSync(aPath) && fs.existsSync(sPath) && fs.existsSync(cPath)) {
                    parsedBundle = {
                      architect: extractJsonLoose(fs.readFileSync(aPath, 'utf8')),
                      qa_spec: extractJsonLoose(fs.readFileSync(sPath, 'utf8')),
                      qa_critic: extractJsonLoose(fs.readFileSync(cPath, 'utf8')),
                    };
                  }
                } catch {}
              }

              resetWorkspaceClean();

              if (parsedBundle && typeof parsedBundle === 'object') {
                const archCheck = validateStage('architect', parsedBundle.architect);
                const specCheck = validateStage('qa_spec', parsedBundle.qa_spec);
                const criticCheck = validateStage('qa_critic', parsedBundle.qa_critic);

                if (archCheck.ok && specCheck.ok && criticCheck.ok) {
                  // Commit sequentially to autodev-plan-channel to avoid GitHub Contents API 409 HEAD races
                  const archFile = await postStageOutput('architect', archCheck.data);
                  const specFile = await postStageOutput('qa_spec', specCheck.data);
                  const criticFile = await postStageOutput('qa_critic', criticCheck.data);

                  const completedIso = new Date().toISOString();
                  const durationMs = Date.now() - startedMs;
                  const estTotal = Math.round(Math.max(0.1, totalElapsedMs / 60000) * 14000);
                  const estInput = Math.round(estTotal * 0.72);
                  state.tokenUsage = accTokens.reported && accTokens.totalTokens > 0
                    ? {
                        inputTokens: accTokens.inputTokens,
                        outputTokens: accTokens.outputTokens,
                        totalTokens: accTokens.totalTokens,
                        source: 'reported',
                        model,
                      }
                    : {
                        inputTokens: estInput,
                        outputTokens: Math.max(0, estTotal - estInput),
                        totalTokens: estTotal,
                        source: 'estimated',
                        model,
                      };

                  state.outputFiles = {
                    architect: archFile,
                    qa_spec: specFile,
                    qa_critic: criticFile,
                  };
                  state.steps.architect = {
                    status: 'completed',
                    startedAt: startedIso,
                    completedAt: completedIso,
                    durationMs,
                    message: '单对话完成 · 识别 ' + archCheck.data.ambiguities.length + ' 项歧义、' + archCheck.data.tasks.length + ' 项增量任务',
                  };
                  state.steps.qa_spec = {
                    status: 'completed',
                    startedAt: startedIso,
                    completedAt: completedIso,
                    durationMs,
                    message: '单对话完成 · 生成 ' + specCheck.data.apiTestChecklist.length + ' 条接口用例与初版 E2E 测试',
                  };
                  state.steps.qa_critic = {
                    status: 'completed',
                    startedAt: startedIso,
                    completedAt: completedIso,
                    durationMs,
                    message: '单对话完成 · 提出 ' + criticCheck.data.findings.length + ' 项加固意见并锁定盲测 E2E 测试集',
                  };
                  state.status = 'completed';
                  await syncState();
                  return {
                    architect: archCheck.data,
                    qaSpec: specCheck.data,
                    qaCritic: criticCheck.data,
                  };
                }

                const errs = [];
                if (!archCheck.ok) errs.push('architect: ' + archCheck.error);
                if (!specCheck.ok) errs.push('qa_spec: ' + specCheck.error);
                if (!criticCheck.ok) errs.push('qa_critic: ' + criticCheck.error);
                lastErr = errs.join('; ');
              } else if (execRes.status !== 0 && !lastErr) {
                lastErr = 'AGY exited with code ' + execRes.status;
              }
            }

            const finalErr = 'Unified single-turn planning failed after retry: ' + (lastErr || 'unknown error');
            for (const key of ['architect', 'qa_spec', 'qa_critic']) {
              state.steps[key] = {
                ...state.steps[key],
                status: 'error',
                message: finalErr,
              };
            }
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

            const rsiBlocks = [
              input.rsiSystemPrompts?.architect,
              input.rsiSystemPrompts?.qa_spec,
              input.rsiSystemPrompts?.qa_critic,
            ]
              .filter(Boolean)
              .join('\\n\\n');

            const unifiedPrompt = [
              'You are the Unified AutoDev Studio Planning Engine (combining Architect + QA Spec + QA Critic in ONE single conversation) running directly inside the real repository on branch ' + baseBranch + ' (HEAD ' + headSha.slice(0, 7) + ').',
              'STRICT READ-ONLY RULE: Do NOT modify, create, or delete any repository source files, package.json, migrations, or tests. ONLY write your final unified JSON bundle to .autodev-plan-output/plan-bundle.json.',
              'INCREMENTAL ITERATION RULE: Inspect the existing repository first. If working code already exists, design INCREMENTAL changes on top of the existing architecture without deleting working modules or rewriting already-applied SQL migrations.',
              'PLAYWRIGHT STRICT-MODE HYGIENE & BLIND-TEST AUDIT (CRITICAL):',
              '- Because \`qa_critic.finalE2eTestCode\` will be stored in a Blind Verification Vault (the coding agent will NOT see it!), EVERY assertion must test real PRD behavior via resilient user-facing selectors (roles, labels, placeholders, visible text) and API contracts rather than guessing arbitrary CSS class names.',
              '- NEVER write bare \`locatorA.or(locatorB)\` without appending \`.first()\` (ALWAYS write \`locatorA.or(locatorB).first()\`) to prevent Playwright strict mode violations!',
              '- Self-critique your draft \`qa_spec\` inside \`qa_critic\`: identify boundary/invalid_input/ui_interaction/security/concurrency gaps in \`findings\`, and produce the hardened \`finalApiTestChecklist\` and \`finalE2eTestCode\`.',
              'LANGUAGE: All Chinese text fields (titles, descriptions, summaries, ambiguity details, acceptanceCriteria, reviewSummary, findings, scenarios) MUST be written in concise, professional Simplified Chinese.',
              'ACCEPTANCE CRITERIA RULE (CRITICAL - FOR PRODUCT MANAGERS & QA TESTERS): Every item in architect.tasks[].acceptanceCriteria is displayed directly to non-technical Product Managers and Manual QA Testers on the Acceptance Gate checklist. Write each item purely in plain-language user/business functional terms ("用户在XX页面执行XX操作后，页面展示/实现XX效果"). STRICTLY FORBID mentioning HTTP status codes, API paths, SQL/database tables, JWT/cookies, CSS classes, file paths, Playwright, or any code/engineering jargon in acceptanceCriteria!',
              ...(rsiBlocks ? ['', rsiBlocks] : []),
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
              'Write ONLY a single valid JSON object to .autodev-plan-output/plan-bundle.json with this EXACT schema:',
              '{',
              '  "architect": {',
              '    "ambiguities": [{ "id": "AMB-1", "severity": "high|medium|low", "title": "...", "detail": "...", "clarificationSuggestion": "..." }],',
              '    "architectureSummary": "Concise Chinese technical architecture summary grounded in the real codebase",',
              '    "techDecisions": ["Decision 1", "Decision 2"],',
              '    "apiContracts": [{ "id": "API-1", "method": "GET|POST|PUT|PATCH|DELETE", "path": "/api/...", "summary": "...", "requestSchema": "...", "responseSchema": "...", "errorCodes": ["400", "404"] }],',
              '    "tasks": [{ "id": "T-01", "title": "...", "module": "...", "description": "...", "dependsOn": [], "acceptanceCriteria": ["面向产品/测试人员的纯功能业务验收描述，不含技术术语"], "estimatedComplexity": "S|M|L" }]',
              '  },',
              '  "qa_spec": {',
              '    "apiTestChecklist": [{ "id": "TC-01", "endpoint": "/api/...", "method": "GET|POST|...", "scenario": "...", "expectedStatus": 200, "assertion": "..." }],',
              '    "e2eTestCode": "Complete runnable TypeScript Playwright test file importing test and expect from @playwright/test",',
              '    "coverageNotes": ["Coverage note 1"]',
              '  },',
              '  "qa_critic": {',
              '    "reviewSummary": "Concise Chinese critic review conclusion",',
              '    "findings": [{ "id": "CRIT-01", "category": "boundary|invalid_input|ui_interaction|security|concurrency", "severity": "high|medium|low", "issue": "...", "recommendation": "..." }],',
              '    "finalApiTestChecklist": [{ "id": "TC-01", "endpoint": "/api/...", "method": "GET|POST|...", "scenario": "...", "expectedStatus": 200, "assertion": "..." }],',
              '    "finalE2eTestCode": "Complete hardened TypeScript Playwright test code"',
              '  }',
              '}',
              'Keep tasks focused, atomic, and strictly scoped to the PRD (typically 3-6 tasks for incremental features).',
            ].join('\\n');

            await runUnifiedPlanStage(unifiedPrompt);

            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log('=== Single-turn unified Instabox AGY planning completed successfully ===');
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
