import crypto from 'crypto';
import { AGY_AVAILABLE_MODELS, DEFAULT_AGY_MODEL } from './workflowBuilder.ts';
import { stripAnsi } from './deploySanitizer.ts';

export type FeishuCardActionType =
  | 'open_prd_form'
  | 'submit_prd_form'
  | 'create_draft_pr'
  | 'dispatch_agy'
  | 'deploy_preview'
  | 'approve_release'
  | 'open_rework_form'
  | 'submit_rework_form'
  | 'redeploy_production'
  | 'query_status';

export type FeishuStageEventKind =
  | 'plan_completed'
  | 'plan_failed'
  | 'draft_pr_created'
  | 'coding_completed'
  | 'coding_failed'
  | 'preview_deployed'
  | 'preview_failed'
  | 'production_deployed'
  | 'production_failed'
  | 'rework_dispatched';

export interface FeishuStageNotificationPayload {
  kind: FeishuStageEventKind;
  prdTitle: string;
  repoFullName: string;
  runId?: string;
  jobId?: string;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  previewUrl?: string;
  productionUrl?: string;
  actionsUrl?: string;
  summary?: string;
  error?: string;
  tasksCount?: number;
  ambiguitiesCount?: number;
  passedTests?: number;
  failedTests?: number;
  appBaseUrl?: string;
  chatId?: string;
}

export interface ParsedFeishuEventEnvelope {
  kind: 'url_verification' | 'im_message' | 'ignored';
  challenge?: string;
  token?: string;
  eventId?: string;
  message?: {
    messageId: string;
    chatId: string;
    chatType: string;
    senderOpenId?: string;
    rawText: string;
    cleanText: string;
    mentionsBot: boolean;
  };
}

export interface ParsedFeishuCardCallback {
  kind: 'url_verification' | 'card_action' | 'ignored';
  schemaVersion: '1.0' | '2.0';
  challenge?: string;
  token?: string;
  eventId?: string;
  actionType?: FeishuCardActionType;
  actionValue: Record<string, string>;
  formValue: Record<string, string>;
  chatId?: string;
  openMessageId?: string;
  operatorOpenId?: string;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Decrypts Feishu AES-256-CBC encrypted webhook payload using FEISHU_ENCRYPT_KEY.
 * Spec: key = SHA256(encryptKey), payload = Base64(IV[16] + ciphertext), PKCS#7 padding.
 */
export function decryptFeishuPayload(encryptBase64: string, encryptKey: string): string {
  const key = crypto.createHash('sha256').update(encryptKey, 'utf-8').digest();
  const raw = Buffer.from(encryptBase64, 'base64');
  if (raw.length <= 16) {
    throw new Error('Feishu encrypted payload is too short');
  }
  const iv = raw.subarray(0, 16);
  const cipherText = raw.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return decrypted.toString('utf-8');
}

/**
 * Encrypts a JSON string in Feishu AES-256-CBC format (useful for deterministic unit tests).
 */
export function encryptFeishuPayloadForTest(
  plainJson: string,
  encryptKey: string,
  fixedIv?: Buffer
): string {
  const key = crypto.createHash('sha256').update(encryptKey, 'utf-8').digest();
  const iv = fixedIv ?? crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainJson, 'utf-8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

/**
 * Verifies Feishu X-Lark-Signature header:
 * expected = hex(SHA256(timestamp + nonce + encryptKey + rawBody))
 */
export function verifyFeishuSignature(params: {
  timestamp?: string;
  nonce?: string;
  signature?: string;
  encryptKey: string;
  rawBody: string;
  nowMs?: number;
  maxClockSkewSec?: number;
}): { ok: boolean; reason?: string } {
  const { timestamp, nonce, signature, encryptKey, rawBody } = params;
  if (!timestamp || !nonce || !signature) {
    return { ok: false, reason: '缺少飞书签名请求头（X-Lark-Signature）' };
  }
  const tsSec = Number(timestamp);
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const maxSkew = params.maxClockSkewSec ?? 300;
  if (!Number.isFinite(tsSec) || Math.abs(nowSec - tsSec) > maxSkew) {
    return { ok: false, reason: '飞书回调时间戳超出允许范围' };
  }
  const expected = crypto
    .createHash('sha256')
    .update(`${timestamp}${nonce}${encryptKey}${rawBody}`, 'utf-8')
    .digest('hex');

  if (!timingSafeStringEqual(expected.toLowerCase(), signature.trim().toLowerCase())) {
    return { ok: false, reason: '飞书回调签名校验失败' };
  }
  return { ok: true };
}

/**
 * Strips Feishu @mention placeholders (e.g. `@_user_1`) and collapses extra whitespace.
 */
export function cleanFeishuMessageText(rawContentJson: string): string {
  let text = rawContentJson;
  try {
    const parsed = JSON.parse(rawContentJson) as { text?: string };
    if (typeof parsed?.text === 'string') {
      text = parsed.text;
    }
  } catch {
    // Plain text fallback
  }
  return text
    .replace(/@_user_\d+\s*/g, '')
    .replace(/@_all\s*/g, '')
    .trim();
}

export function parseFeishuEventBody(body: Record<string, unknown>): ParsedFeishuEventEnvelope {
  // URL Verification (v1 / v2)
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return {
      kind: 'url_verification',
      challenge: body.challenge,
      token: typeof body.token === 'string' ? body.token : undefined,
    };
  }

  const header = (body.header && typeof body.header === 'object'
    ? (body.header as Record<string, unknown>)
    : null);
  const event = (body.event && typeof body.event === 'object'
    ? (body.event as Record<string, unknown>)
    : null);

  const eventType =
    (typeof header?.event_type === 'string' ? header.event_type : undefined) ||
    (typeof event?.type === 'string' ? event.type : undefined);
  const token =
    (typeof header?.token === 'string' ? header.token : undefined) ||
    (typeof body.token === 'string' ? body.token : undefined);
  const eventId = typeof header?.event_id === 'string' ? header.event_id : undefined;

  if (eventType === 'im.message.receive_v1' && event) {
    const msg = (event.message && typeof event.message === 'object'
      ? (event.message as Record<string, unknown>)
      : null);
    const sender = (event.sender && typeof event.sender === 'object'
      ? (event.sender as Record<string, unknown>)
      : null);
    const senderId = (sender?.sender_id && typeof sender.sender_id === 'object'
      ? (sender.sender_id as Record<string, unknown>)
      : null);

    const messageId = typeof msg?.message_id === 'string' ? msg.message_id : '';
    const chatId = typeof msg?.chat_id === 'string' ? msg.chat_id : '';
    const chatType = typeof msg?.chat_type === 'string' ? msg.chat_type : 'group';
    const rawText = typeof msg?.content === 'string' ? msg.content : '';
    const cleanText = cleanFeishuMessageText(rawText);
    const mentions = Array.isArray(msg?.mentions) ? msg.mentions : [];
    const mentionsBot = chatType === 'p2p' || mentions.length > 0 || /@_user_\d+/.test(rawText);

    if (chatId) {
      return {
        kind: 'im_message',
        token,
        eventId,
        message: {
          messageId,
          chatId,
          chatType,
          senderOpenId: typeof senderId?.open_id === 'string' ? senderId.open_id : undefined,
          rawText,
          cleanText,
          mentionsBot,
        },
      };
    }
  }

  return { kind: 'ignored', token, eventId };
}

function normalizeStringRecord(obj: unknown): Record<string, string> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

export function parseFeishuCardCallbackBody(body: Record<string, unknown>): ParsedFeishuCardCallback {
  // Challenge handshake (both v1 & v2)
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return {
      kind: 'url_verification',
      schemaVersion: body.schema === '2.0' ? '2.0' : '1.0',
      challenge: body.challenge,
      token: typeof body.token === 'string' ? body.token : undefined,
      actionValue: {},
      formValue: {},
    };
  }

  // Card Callback 2.0 (schema: "2.0", header.event_type === "card.action.trigger")
  if (body.schema === '2.0' && body.event && typeof body.event === 'object') {
    const header = (body.header && typeof body.header === 'object'
      ? (body.header as Record<string, unknown>)
      : null);
    const event = body.event as Record<string, unknown>;
    const action = (event.action && typeof event.action === 'object'
      ? (event.action as Record<string, unknown>)
      : null);
    const context = (event.context && typeof event.context === 'object'
      ? (event.context as Record<string, unknown>)
      : null);
    const operator = (event.operator && typeof event.operator === 'object'
      ? (event.operator as Record<string, unknown>)
      : null);

    const actionValue = normalizeStringRecord(action?.value);
    const formValue = normalizeStringRecord(action?.form_value);
    const actionName = typeof action?.name === 'string' ? action.name : '';
    const inferredFormAction: FeishuCardActionType | undefined =
      actionName === 'submit_prd_btn'
        ? 'submit_prd_form'
        : actionName === 'submit_rework_btn'
          ? 'submit_rework_form'
          : undefined;
    const actionType = (actionValue.action as FeishuCardActionType | undefined) || inferredFormAction;

    return {
      kind: actionType ? 'card_action' : 'ignored',
      schemaVersion: '2.0',
      token: typeof header?.token === 'string' ? header.token : undefined,
      eventId: typeof header?.event_id === 'string' ? header.event_id : undefined,
      actionType,
      actionValue,
      formValue,
      chatId:
        (typeof context?.open_chat_id === 'string' ? context.open_chat_id : undefined) ||
        actionValue.chat_id,
      openMessageId:
        typeof context?.open_message_id === 'string' ? context.open_message_id : undefined,
      operatorOpenId:
        typeof operator?.open_id === 'string' ? operator.open_id : undefined,
    };
  }

  // Legacy Card Callback 1.0 (action.value, action.form_value, open_chat_id, token)
  if (body.action && typeof body.action === 'object') {
    const action = body.action as Record<string, unknown>;
    const actionValue = normalizeStringRecord(action.value);
    const formValue = normalizeStringRecord(action.form_value);
    const actionType = actionValue.action as FeishuCardActionType | undefined;

    return {
      kind: actionType ? 'card_action' : 'ignored',
      schemaVersion: '1.0',
      token: typeof body.token === 'string' ? body.token : undefined,
      actionType,
      actionValue,
      formValue,
      chatId:
        (typeof body.open_chat_id === 'string' ? body.open_chat_id : undefined) ||
        actionValue.chat_id,
      openMessageId:
        typeof body.open_message_id === 'string' ? body.open_message_id : undefined,
      operatorOpenId: typeof body.open_id === 'string' ? body.open_id : undefined,
    };
  }

  return {
    kind: 'ignored',
    schemaVersion: '1.0',
    token: typeof body.token === 'string' ? body.token : undefined,
    actionValue: {},
    formValue: {},
  };
}

/**
 * Builds an interactive Feishu Card 2.0 form to collect PRD title, tech stack, model, and details.
 */
export function buildFeishuPrdFormCard(params: {
  repoFullName: string;
  chatId: string;
  prefillTitle?: string;
  prefillContent?: string;
  appBaseUrl?: string;
}): Record<string, unknown> {
  const modelOptions = AGY_AVAILABLE_MODELS.map((m) => ({
    text: { tag: 'plain_text', content: m.label },
    value: m.id,
  }));

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: 'AutoDev Studio · 发起新研发需求 (ST-01)',
      },
      subtitle: {
        tag: 'plain_text',
        content: `目标仓库：${params.repoFullName} · 提交后自动启动架构规划`,
      },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            '填写以下需求信息并点击提交，系统将自动拉取仓库最新基线并启动 **Architect + QA Spec + QA Critic** 联合规划，完成后会在本群推送下一阶段操作卡片。',
        },
        {
          tag: 'form',
          name: 'autodev_prd_form',
          elements: [
            {
              tag: 'input',
              name: 'prd_title',
              required: true,
              label: { tag: 'plain_text', content: '需求标题' },
              placeholder: { tag: 'plain_text', content: '例如：接入站内消息通知中心与未读红点' },
              default_value: params.prefillTitle || '',
              width: 'fill',
            },
            {
              tag: 'input',
              name: 'prd_content',
              required: true,
              label: { tag: 'plain_text', content: 'PRD 需求详情（业务背景、核心流程、边界约束）' },
              placeholder: {
                tag: 'plain_text',
                content: '请描述目标功能、交互流程、权限要求及异常边界（建议 20 字以上）…',
              },
              default_value: params.prefillContent || '',
              width: 'fill',
            },
            {
              tag: 'input',
              name: 'tech_stack_hint',
              required: false,
              label: { tag: 'plain_text', content: '技术栈覆盖（选填）' },
              placeholder: {
                tag: 'plain_text',
                content: '留空默认 Cloudflare Workers + Hono + D1 + React',
              },
              width: 'fill',
            },
            {
              tag: 'select_static',
              name: 'agy_model',
              required: false,
              initial_option: DEFAULT_AGY_MODEL,
              placeholder: { tag: 'plain_text', content: '选择规划/编码模型' },
              options: modelOptions,
            },
            {
              tag: 'button',
              name: 'submit_prd_btn',
              text: { tag: 'plain_text', content: '提交并启动架构规划' },
              type: 'primary',
              form_action_type: 'submit',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'submit_prd_form',
                    chat_id: params.chatId,
                    repo: params.repoFullName,
                  },
                },
              ],
            },
          ],
        },
        ...(params.appBaseUrl
          ? [
              {
                tag: 'markdown',
                content: `需要更复杂的长文档编辑？[打开 AutoDev Studio 控制台](${params.appBaseUrl})`,
              },
            ]
          : []),
      ],
    },
  };
}

/**
 * Builds an interactive Feishu Card 2.0 form to collect human revision/rework feedback.
 */
export function buildFeishuReworkFormCard(params: {
  runId: string;
  prdTitle: string;
  prNumber?: number;
  chatId: string;
}): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: 'orange',
      title: {
        tag: 'plain_text',
        content: `退回修订与 AGY 自动返工 · ${params.prdTitle}`,
      },
      subtitle: {
        tag: 'plain_text',
        content: params.prNumber ? `PR #${params.prNumber} · 原分支自动修复` : `Run ${params.runId}`,
      },
    },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'autodev_rework_form',
          elements: [
            {
              tag: 'input',
              name: 'revision_note',
              required: true,
              label: { tag: 'plain_text', content: '修改意见 / 验收不通过原因' },
              placeholder: {
                tag: 'plain_text',
                content: '例如：列表分页加载第二页时重复显示第一页数据，且缺少空状态文案',
              },
              width: 'fill',
            },
            {
              tag: 'button',
              name: 'submit_rework_btn',
              text: { tag: 'plain_text', content: '提交退回并派发 AGY 返工' },
              type: 'danger',
              form_action_type: 'submit',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'submit_rework_form',
                    run_id: params.runId,
                    chat_id: params.chatId,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Builds a Feishu stage completion/failure notification card with actionable next-step buttons.
 */
export function buildFeishuStageCard(
  payload: FeishuStageNotificationPayload
): Record<string, unknown> {
  const buttons: Array<Record<string, unknown>> = [];
  let headerTemplate = 'blue';
  let title = '';
  let nextActionGuide = '';

  const makeCallbackButton = (
    content: string,
    type: 'primary' | 'danger' | 'default',
    value: Record<string, string>
  ) => ({
    tag: 'button',
    text: { tag: 'plain_text', content },
    type,
    behaviors: [
      {
        type: 'callback',
        value,
      },
    ],
  });

  switch (payload.kind) {
    case 'plan_completed':
      headerTemplate = 'green';
      title = `架构规划已完成 · ${payload.prdTitle}`;
      nextActionGuide =
        '下一步：点击下方「创建 Draft PR」生成特性分支与规格契约，或在控制台微调方案。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('创建 Draft PR', 'primary', {
            action: 'create_draft_pr',
            run_id: payload.runId,
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'plan_failed':
      headerTemplate = 'red';
      title = `架构规划失败 · ${payload.prdTitle}`;
      nextActionGuide = '下一步：检查错误原因后，可点击「重新发起需求」再次提交规划。';
      buttons.push(
        makeCallbackButton('重新发起需求', 'primary', {
          action: 'open_prd_form',
          chat_id: payload.chatId || '',
        })
      );
      break;

    case 'draft_pr_created':
      headerTemplate = 'blue';
      title = `Draft PR #${payload.prNumber ?? ''} 已创建 · ${payload.prdTitle}`;
      nextActionGuide =
        '下一步：点击下方「派发 AGY 自动编码」启动代码实现与自动化测试自愈闭环。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('派发 AGY 自动编码', 'primary', {
            action: 'dispatch_agy',
            run_id: payload.runId,
            branch: payload.branchName || '',
            pr_number: payload.prNumber ? String(payload.prNumber) : '',
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'coding_completed':
      headerTemplate = 'green';
      title = `AGY 编码与校验完成 · ${payload.prdTitle}`;
      nextActionGuide =
        '下一步：点击「部署隔离预览环境」生成独立 Cloudflare Preview 网址进行功能验收。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('部署隔离预览环境', 'primary', {
            action: 'deploy_preview',
            run_id: payload.runId,
            branch: payload.branchName || '',
            pr_number: payload.prNumber ? String(payload.prNumber) : '',
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'coding_failed':
      headerTemplate = 'red';
      title = `AGY 编码流水线失败 · ${payload.prdTitle}`;
      nextActionGuide = '下一步：可查看 GitHub Actions 日志，或点击「重试 AGY 编码」继续修复。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('重试 AGY 编码', 'primary', {
            action: 'dispatch_agy',
            run_id: payload.runId,
            branch: payload.branchName || '',
            pr_number: payload.prNumber ? String(payload.prNumber) : '',
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'preview_deployed':
      headerTemplate = 'turquoise';
      title = `隔离预览环境已就绪 · ${payload.prdTitle}`;
      nextActionGuide =
        '下一步：点击上方预览网址验收功能，确认无误后点击「同意上线（合并并部署生产）」，或点击「退回修订」。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('同意上线（合并并部署生产）', 'primary', {
            action: 'approve_release',
            run_id: payload.runId,
            chat_id: payload.chatId || '',
          })
        );
        buttons.push(
          makeCallbackButton('退回修订', 'danger', {
            action: 'open_rework_form',
            run_id: payload.runId,
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'preview_failed':
      headerTemplate = 'red';
      title = `隔离预览部署失败 · ${payload.prdTitle}`;
      nextActionGuide = '下一步：检查 Cloudflare 报错信息后可点击「重新部署预览」。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('重新部署预览', 'primary', {
            action: 'deploy_preview',
            run_id: payload.runId,
            branch: payload.branchName || '',
            pr_number: payload.prNumber ? String(payload.prNumber) : '',
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'production_deployed':
      headerTemplate = 'green';
      title = `正式上线部署成功 · ${payload.prdTitle}`;
      nextActionGuide = '本轮迭代已交付并归档，随时可点击「发起下一轮需求」。';
      buttons.push(
        makeCallbackButton('发起下一轮需求', 'primary', {
          action: 'open_prd_form',
          chat_id: payload.chatId || '',
        })
      );
      break;

    case 'production_failed':
      headerTemplate = 'red';
      title = `生产环境部署失败 · ${payload.prdTitle}`;
      nextActionGuide = 'PR 已合并或审批通过，但 Cloudflare 生产发布失败，请点击下方「重新部署生产环境」。';
      if (payload.runId) {
        buttons.push(
          makeCallbackButton('重新部署生产环境', 'primary', {
            action: 'redeploy_production',
            run_id: payload.runId,
            chat_id: payload.chatId || '',
          })
        );
      }
      break;

    case 'rework_dispatched':
      headerTemplate = 'orange';
      title = `已退回并派发 AGY 返工 · ${payload.prdTitle}`;
      nextActionGuide = 'AGY 正在原分支依据修订意见自动修复，完成后将自动推送新通知卡片。';
      break;
  }

  // External link buttons
  if (payload.previewUrl) {
    buttons.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开预览环境' },
      type: 'default',
      behaviors: [{ type: 'open_url', default_url: payload.previewUrl }],
    });
  }
  if (payload.productionUrl) {
    buttons.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开线上生产站' },
      type: 'default',
      behaviors: [{ type: 'open_url', default_url: payload.productionUrl }],
    });
  }
  if (payload.prUrl) {
    buttons.push({
      tag: 'button',
      text: { tag: 'plain_text', content: `查看 PR #${payload.prNumber ?? ''}` },
      type: 'default',
      behaviors: [{ type: 'open_url', default_url: payload.prUrl }],
    });
  }
  if (payload.actionsUrl) {
    buttons.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '查看 Actions 日志' },
      type: 'default',
      behaviors: [{ type: 'open_url', default_url: payload.actionsUrl }],
    });
  }
  if (payload.appBaseUrl) {
    buttons.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开控制台' },
      type: 'default',
      behaviors: [{ type: 'open_url', default_url: payload.appBaseUrl }],
    });
  }

  const lines: string[] = [
    `**目标仓库**：\`${payload.repoFullName}\`${payload.branchName ? ` · 分支 \`${payload.branchName}\`` : ''}`,
  ];
  if (payload.tasksCount !== undefined) {
    lines.push(
      `**规划产出**：${payload.tasksCount} 项原子任务${
        payload.ambiguitiesCount !== undefined ? ` · ${payload.ambiguitiesCount} 条需求歧义澄清` : ''
      }`
    );
  }
  if (payload.passedTests !== undefined || payload.failedTests !== undefined) {
    lines.push(
      `**自动化校验**：通过 ${payload.passedTests ?? 0} 项 · 失败 ${payload.failedTests ?? 0} 项`
    );
  }
  if (payload.previewUrl) {
    lines.push(`**预览地址**：[${payload.previewUrl}](${payload.previewUrl})`);
  }
  if (payload.productionUrl) {
    lines.push(`**生产地址**：[${payload.productionUrl}](${payload.productionUrl})`);
  }
  if (payload.summary) {
    lines.push(`**阶段摘要**：${stripAnsi(payload.summary)}`);
  }
  if (payload.error) {
    lines.push(`**异常详情**：${stripAnsi(payload.error).slice(0, 480)}`);
  }
  if (nextActionGuide) {
    lines.push(`\n> ${nextActionGuide}`);
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: headerTemplate,
      title: { tag: 'plain_text', content: title },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: lines.join('\n'),
        },
        ...buttons,
      ],
    },
  };
}
