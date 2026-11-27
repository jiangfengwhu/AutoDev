import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Sparkles,
  X,
} from 'lucide-react';
import type { AiModelConfigPublicResponse } from '../lib/aiModelConfig';
import type { ShushengIntegrationStatus } from '../types/autodev';
import { apiFetch } from '../lib/editAuthClient';
import { DEFAULT_AGY_CODING_MODEL, DEFAULT_AGY_PLAN_MODEL } from '../lib/workflowBuilder';

interface AiModelConfigModalProps {
  open: boolean;
  onClose: () => void;
  shushengStatus?: ShushengIntegrationStatus;
  onSaved: () => void;
  onErrorToast: (message: string, title?: string) => void;
  onSuccessToast: (message: string, title?: string) => void;
}

export function AiModelConfigModal({
  open,
  onClose,
  shushengStatus,
  onSaved,
  onErrorToast,
  onSuccessToast,
}: AiModelConfigModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [testing, setTesting] = useState(false);

  const [configMeta, setConfigMeta] = useState<AiModelConfigPublicResponse | null>(null);

  const [geminiPrimaryModel, setGeminiPrimaryModel] = useState('gemini-4-hydrogen');
  const [geminiFallbackModel, setGeminiFallbackModel] = useState('gemini-3.1-flash-lite');
  const [geminiDecisionModel, setGeminiDecisionModel] = useState('gemini-decision-1');

  const [backupEnabled, setBackupEnabled] = useState(true);
  const [backupProviderName, setBackupProviderName] = useState('书生·端砚');
  const [backupBaseUrl, setBackupBaseUrl] = useState('https://discovery-api.intern-ai.org.cn/v1');
  const [backupModel, setBackupModel] = useState('intern-s2');
  const [backupApiKeyInput, setBackupApiKeyInput] = useState('');
  const [clearBackupApiKey, setClearBackupApiKey] = useState(false);

  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [probeMessage, setProbeMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setProbeMessage(null);
    try {
      const res = await fetch('/api/ai-config');
      const data = (await res.json()) as { config?: AiModelConfigPublicResponse; error?: string };
      if (!res.ok || !data.config) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const cfg = data.config;
      setConfigMeta(cfg);
      setGeminiPrimaryModel(cfg.geminiPrimaryModel);
      setGeminiFallbackModel(cfg.geminiFallbackModel);
      setGeminiDecisionModel(cfg.geminiDecisionModel);
      setBackupEnabled(cfg.backupEnabled);
      setBackupProviderName(cfg.backupProviderName);
      setBackupBaseUrl(cfg.backupBaseUrl);
      setBackupModel(cfg.backupModel);
      setBackupApiKeyInput('');
      setClearBackupApiKey(false);
      if (shushengStatus?.availableModels?.length) {
        setDiscoveredModels(shushengStatus.availableModels);
      }
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '读取 AI 模型配置失败',
        '加载配置失败'
      );
    } finally {
      setLoading(false);
    }
  }, [onErrorToast, shushengStatus?.availableModels]);

  useEffect(() => {
    if (open) {
      void loadConfig();
    }
  }, [open, loadConfig]);

  if (!open) return null;

  const handleProbeModels = async () => {
    setProbing(true);
    setProbeMessage(null);
    try {
      const res = await apiFetch('/api/ai-config/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupProviderName,
          backupBaseUrl,
          backupModel,
          ...(backupApiKeyInput.trim() ? { backupApiKey: backupApiKeyInput.trim() } : {}),
        }),
      });
      const data = (await res.json()) as {
        shusheng?: ShushengIntegrationStatus;
        error?: string;
      };
      if (!res.ok || !data.shusheng?.connected) {
        throw new Error(data.error || data.shusheng?.error || `HTTP ${res.status}`);
      }
      const models = data.shusheng.availableModels || [];
      setDiscoveredModels(models);
      if (models.length > 0 && !models.includes(backupModel.trim())) {
        setBackupModel(data.shusheng.defaultModel || models[0]);
      }
      setProbeMessage({
        type: 'success',
        text: `连通成功（${data.shusheng.latencyMs ?? 0}ms），发现 ${models.length} 个可用模型`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '探测模型列表失败';
      setProbeMessage({ type: 'error', text: msg });
      onErrorToast(msg, '模型探测失败');
    } finally {
      setProbing(false);
    }
  };

  const handleTestChat = async () => {
    setTesting(true);
    setProbeMessage(null);
    try {
      const res = await apiFetch('/api/ai-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupProviderName,
          backupBaseUrl,
          backupModel,
          ...(backupApiKeyInput.trim() ? { backupApiKey: backupApiKeyInput.trim() } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        model?: string;
        reply?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const msg = `对话实测通过：模型 ${data.model || backupModel} 返回「${data.reply || 'OK'}」（${data.latencyMs ?? 0}ms）`;
      setProbeMessage({ type: 'success', text: msg });
      onSuccessToast(msg, '备用模型连通正常');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '对话连通测试失败';
      setProbeMessage({ type: 'error', text: msg });
      onErrorToast(msg, '对话测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setProbeMessage(null);
    try {
      const res = await apiFetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiPrimaryModel,
          geminiFallbackModel,
          geminiDecisionModel,
          backupEnabled,
          backupProviderName,
          backupBaseUrl,
          backupModel,
          ...(backupApiKeyInput.trim() ? { backupApiKey: backupApiKeyInput.trim() } : {}),
          ...(clearBackupApiKey ? { clearBackupApiKey: true } : {}),
        }),
      });
      const data = (await res.json()) as {
        config?: AiModelConfigPublicResponse;
        error?: string;
      };
      if (!res.ok || !data.config) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setConfigMeta(data.config);
      setBackupApiKeyInput('');
      setClearBackupApiKey(false);
      onSuccessToast(
        `已生效：Gemini (${data.config.geminiPrimaryModel} / ${data.config.geminiFallbackModel}) · 备用 (${data.config.backupProviderName} · ${data.config.backupModel})`,
        'AI 模型配置已保存'
      );
      onSaved();
      onClose();
    } catch (err) {
      onErrorToast(
        err instanceof Error ? err.message : '保存 AI 模型配置失败',
        '保存失败'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaults = () => {
    const d = configMeta?.defaults;
    setGeminiPrimaryModel(d?.geminiPrimaryModel || 'gemini-4-hydrogen');
    setGeminiFallbackModel(d?.geminiFallbackModel || 'gemini-3.1-flash-lite');
    setGeminiDecisionModel(d?.geminiDecisionModel || 'gemini-decision-1');
    setBackupEnabled(true);
    setBackupProviderName(d?.backupProviderName || '书生·端砚');
    setBackupBaseUrl(d?.backupBaseUrl || 'https://discovery-api.intern-ai.org.cn/v1');
    setBackupModel(d?.backupModel || 'intern-s2');
    setBackupApiKeyInput('');
    setClearBackupApiKey(true);
  };

  const keySourceBadge =
    clearBackupApiKey
      ? '保存后将清除自定义密钥并回退到服务端环境变量'
      : configMeta?.backupApiKeySource === 'custom'
        ? `当前使用服务端加密保存的自定义密钥（${configMeta.backupApiKeyMasked || '已配置'}）`
        : configMeta?.backupApiKeySource === 'env'
          ? `当前使用环境变量 ${configMeta.backupApiKeyEnvName}（${configMeta.backupApiKeyMasked || '已配置'}）`
          : '当前未检测到环境变量或自定义 API Key';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-model-config-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        data-testid="ai-model-config-modal"
        className="w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden rounded-lg border border-[#30363D] bg-[#161B22] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#30363D]">
          <div className="min-w-0">
            <h2
              id="ai-model-config-title"
              className="text-[15.5px] font-semibold text-[#F0F6FC] flex items-center gap-2"
            >
              <Cpu className="h-4 w-4 text-[#58A6FF]" />
              <span>AI 模型与备用容灾配置</span>
            </h2>
            <p className="text-[12px] text-[#8B949E] mt-0.5">
              自定义控制面 Gemini 模型名称与 OpenAI 兼容备用容灾引擎（API Key 仅保存在服务端）。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭模型配置弹窗"
            className="rounded-md p-1.5 text-[#8B949E] hover:bg-[#21262D] hover:text-[#F0F6FC] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-[13px] text-[#8B949E]">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>正在加载当前模型配置…</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3.5">
            {/* Section 1: Gemini Control-Plane Models */}
            <section className="rounded-md border border-[#30363D] bg-[#0D1117] p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-[#F0F6FC] flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-[#58A6FF]" />
                  <span>Gemini 控制面模型</span>
                </h3>
                <span className="font-mono text-[11px] text-[#8B949E]">
                  密钥来源：GEMINI_API_KEY
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block space-y-1">
                  <span className="block text-[11.5px] font-medium text-[#C9D1D9]">
                    主推理模型
                  </span>
                  <input
                    type="text"
                    value={geminiPrimaryModel}
                    onChange={(e) => setGeminiPrimaryModel(e.target.value)}
                    placeholder="gemini-4-hydrogen"
                    required
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                  <span className="block text-[10.5px] text-[#8B949E]">
                    架构策划 / 任务书 / RSI 归因
                  </span>
                </label>

                <label className="block space-y-1">
                  <span className="block text-[11.5px] font-medium text-[#C9D1D9]">
                    同源轻量备用模型
                  </span>
                  <input
                    type="text"
                    value={geminiFallbackModel}
                    onChange={(e) => setGeminiFallbackModel(e.target.value)}
                    placeholder="gemini-3.1-flash-lite"
                    required
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                  <span className="block text-[10.5px] text-[#8B949E]">
                    主模型 503 繁忙时优先降级
                  </span>
                </label>

                <label className="block space-y-1">
                  <span className="block text-[11.5px] font-medium text-[#C9D1D9]">
                    校准决策门控模型
                  </span>
                  <input
                    type="text"
                    value={geminiDecisionModel}
                    onChange={(e) => setGeminiDecisionModel(e.target.value)}
                    placeholder="gemini-decision-1"
                    required
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                  <span className="block text-[10.5px] text-[#8B949E]">
                    反馈分诊 / 报错过滤 / RSI 门控（直连，不降级备用）
                  </span>
                </label>
              </div>
            </section>

            {/* Section 2: OpenAI-Compatible Backup Provider */}
            <section className="rounded-md border border-[#30363D] bg-[#0D1117] p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-[#F0F6FC] flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-[#A371F7]" />
                  <span>OpenAI 兼容备用容灾引擎</span>
                </h3>
                <label className="inline-flex items-center gap-2 text-[12px] text-[#C9D1D9] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={backupEnabled}
                    onChange={(e) => setBackupEnabled(e.target.checked)}
                    className="rounded border-[#30363D] bg-[#161B22]"
                  />
                  <span>主推理模型 503/429 时自动容灾切换</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="block text-[11.5px] font-medium text-[#C9D1D9]">
                    平台显示名称
                  </span>
                  <input
                    type="text"
                    value={backupProviderName}
                    onChange={(e) => setBackupProviderName(e.target.value)}
                    placeholder="书生·端砚"
                    maxLength={40}
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="block text-[11.5px] font-medium text-[#C9D1D9]">
                    备用模型名称
                  </span>
                  <input
                    type="text"
                    list="backup-discovered-models"
                    value={backupModel}
                    onChange={(e) => setBackupModel(e.target.value)}
                    placeholder="intern-s2"
                    required
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                  <datalist id="backup-discovered-models">
                    {discoveredModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>

                <label className="block space-y-1 sm:col-span-2">
                  <span className="block text-[11.5px] font-medium text-[#C9D1D9]">
                    OpenAI 兼容 Base URL（仅允许公网 HTTPS）
                  </span>
                  <input
                    type="url"
                    value={backupBaseUrl}
                    onChange={(e) => setBackupBaseUrl(e.target.value)}
                    placeholder="https://discovery-api.intern-ai.org.cn/v1"
                    required
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC] focus:border-[#58A6FF] focus:outline-none"
                  />
                </label>

                <div className="sm:col-span-2 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="backup-api-key-input"
                      className="text-[11.5px] font-medium text-[#C9D1D9] flex items-center gap-1"
                    >
                      <KeyRound className="h-3 w-3 text-[#8B949E]" />
                      <span>OpenAI 兼容 API Key（写保护，留空保持当前配置）</span>
                    </label>
                    {configMeta?.backupApiKeySource === 'custom' && !clearBackupApiKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setClearBackupApiKey(true);
                          setBackupApiKeyInput('');
                        }}
                        className="text-[11px] text-[#D29922] hover:underline cursor-pointer"
                      >
                        清除自定义密钥并回退环境变量
                      </button>
                    )}
                  </div>
                  <input
                    id="backup-api-key-input"
                    type="password"
                    autoComplete="new-password"
                    value={backupApiKeyInput}
                    onChange={(e) => {
                      setBackupApiKeyInput(e.target.value);
                      if (e.target.value.trim()) setClearBackupApiKey(false);
                    }}
                    placeholder={
                      configMeta?.backupApiKeyConfigured
                        ? '留空保持当前密钥不变；输入新密钥可覆盖'
                        : '输入兼容接口 API Key（或在 Secrets 中配置 AUTODEV_BACKUP_API_KEY / SHUSHENG_APIKEY）'
                    }
                    className="w-full rounded-md border border-[#30363D] bg-[#161B22] px-2.5 py-1.5 font-mono text-[12px] text-[#F0F6FC] placeholder:text-[#6E7681] focus:border-[#58A6FF] focus:outline-none"
                  />
                  <p className="text-[11px] text-[#8B949E]">
                    {keySourceBadge} · 自定义密钥仅在本地服务端加密存储，绝不回传前端或同步至 GitHub。
                  </p>
                </div>
              </div>

              {discoveredModels.length > 0 && (
                <div className="pt-1 space-y-1">
                  <span className="block text-[11px] text-[#8B949E]">
                    已探测可用模型（点击快速填入）：
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {discoveredModels.slice(0, 12).map((modelId) => (
                      <button
                        key={modelId}
                        type="button"
                        onClick={() => setBackupModel(modelId)}
                        className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors cursor-pointer ${
                          backupModel.trim() === modelId
                            ? 'border-[#58A6FF] bg-[#58A6FF]/15 text-[#58A6FF]'
                            : 'border-[#30363D] bg-[#161B22] text-[#C9D1D9] hover:border-[#8B949E]'
                        }`}
                      >
                        {modelId}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleProbeModels}
                  disabled={probing || testing || saving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-2.5 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
                  <span>{probing ? '探测中…' : '探测可用模型'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestChat}
                  disabled={testing || probing || saving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-2.5 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className={`h-3.5 w-3.5 ${testing ? 'animate-pulse' : ''}`} />
                  <span>{testing ? '测试中…' : '测试对话连通'}</span>
                </button>
              </div>

              {probeMessage && (
                <div
                  role={probeMessage.type === 'error' ? 'alert' : 'status'}
                  className={`rounded-md border px-3 py-2 text-[12px] ${
                    probeMessage.type === 'success'
                      ? 'border-[#3FB950]/40 bg-[#3FB950]/10 text-[#3FB950]'
                      : 'border-[#F85149]/40 bg-[#F85149]/10 text-[#FF7B72]'
                  }`}
                >
                  {probeMessage.text}
                </div>
              )}
            </section>

            {/* AGY Runner Defaults Info Strip */}
            <div className="rounded-md border border-[#30363D]/80 bg-[#0D1117]/60 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#8B949E]">
              <span>VPS AGY 默认模型策略</span>
              <span className="font-mono text-[#C9D1D9]">
                规划 {DEFAULT_AGY_PLAN_MODEL} · 编码 {DEFAULT_AGY_CODING_MODEL}
              </span>
            </div>
            </div>

            {/* Pinned Footer */}
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[#30363D] bg-[#161B22]">
              <button
                type="button"
                onClick={handleRestoreDefaults}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#30363D] disabled:opacity-50 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>恢复默认</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-md border border-[#30363D] bg-[#21262D] px-3 py-1.5 text-[12px] font-medium text-[#C9D1D9] hover:bg-[#30363D] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] border border-[#3FB950]/50 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#2EA043] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>{saving ? '保存中…' : '保存模型配置'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
