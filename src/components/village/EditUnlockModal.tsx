import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import {
  apiFetch,
  clearEditAuthToken,
  setEditAuthToken,
  type EditAuthMeta,
} from '../../lib/editAuthClient';

interface EditUnlockModalProps {
  open: boolean;
  unlocked: boolean;
  reason?: string | null;
  meta: EditAuthMeta | null;
  onClose: () => void;
  onUnlocked: (meta: EditAuthMeta) => void;
  onLocked: (meta: EditAuthMeta | null) => void;
  onSuccessToast?: (message: string, title?: string) => void;
}

export function EditUnlockModal({
  open,
  unlocked,
  reason,
  meta,
  onClose,
  onUnlocked,
  onLocked,
  onSuccessToast,
}: EditUnlockModalProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Change password state (only available when unlocked and not overridden by env var)
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setShowPassword(false);
      setError(null);
      setShowChangeForm(false);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setChangeError(null);
      setChangeSuccess(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    if (!unlocked) {
      setTimeout(() => inputRef.current?.focus(), 40);
    }
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, unlocked, onClose]);

  if (!open) return null;

  const handleUnlockSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('请输入编辑密码');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.unlocked || !json.token) {
        setError(json.error || `解锁失败 (${res.status})`);
        return;
      }
      setEditAuthToken(String(json.token));
      onUnlocked(json.meta as EditAuthMeta);
      setPassword('');
      onSuccessToast?.('已解锁全部编辑、派发与签批操作权限', '编辑权限已解锁');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRelock = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/lock', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      clearEditAuthToken();
      onLocked((json.meta as EditAuthMeta) ?? meta);
      onSuccessToast?.('已重新切换为只读锁定状态', '已锁定编辑权限');
      onClose();
    } catch {
      clearEditAuthToken();
      onLocked(meta);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setChangeError(null);
    setChangeSuccess(null);
    if (!currentPassword) {
      setChangeError('请输入当前密码');
      return;
    }
    if (nextPassword.trim().length < 6) {
      setChangeError('新密码至少需要 6 个字符');
      return;
    }
    if (nextPassword !== confirmPassword) {
      setChangeError('两次输入的新密码不一致');
      return;
    }
    setChangingPassword(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          nextPassword: nextPassword.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.token) {
        setChangeError(json.error || `修改密码失败 (${res.status})`);
        return;
      }
      setEditAuthToken(String(json.token));
      onUnlocked(json.meta as EditAuthMeta);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setChangeSuccess('密码已更新（以加密哈希持久化至服务端，旧会话已自动失效）');
      onSuccessToast?.('编辑密码已安全更新', '密码已修改');
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : '修改密码请求失败');
    } finally {
      setChangingPassword(false);
    }
  };

  const sourceLabel =
    meta?.source === 'env'
      ? '环境变量 AUTODEV_EDIT_PASSWORD 托管'
      : meta?.source === 'stored'
        ? '服务端自定义加密哈希（已同步状态分支）'
        : '默认初始化密码哈希（建议配置环境变量或修改）';

  return (
    <div
      data-testid="edit-unlock-modal"
      role="dialog"
      aria-modal="true"
      aria-label={unlocked ? '编辑权限管理' : '解锁编辑权限'}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-[#0F172A]/32 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="village-pavilion-enter cleanroom-glass-shell relative z-10 w-full max-w-[430px] rounded-[22px] overflow-hidden border border-white/85 bg-white/95 shadow-[0_28px_70px_-16px_rgba(15,23,42,0.34)]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${
                unlocked
                  ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#059669]'
                  : 'border-[#FDE68A] bg-[#FFFBEB] text-[#D97706]'
              }`}
            >
              {unlocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-[#0F172A] tracking-tight">
                {unlocked ? '编辑权限已解锁' : '解锁编辑权限'}
              </h2>
              <p className="text-[11.5px] text-[#64748B]">
                {unlocked
                  ? '当前会话可执行全部规划、派发与配置变更'
                  : '当前为只读模式，需验证编辑密码后才能修改'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭权限弹窗"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0] bg-white text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {!unlocked ? (
            <form onSubmit={handleUnlockSubmit} className="space-y-4">
              {reason && (
                <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-[12px] text-[#92400E] flex items-start gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#D97706]" />
                  <span>{reason}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-unlock-password"
                  className="block text-[12px] font-semibold text-[#334155]"
                >
                  编辑解锁密码
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    id="edit-unlock-password"
                    data-testid="edit-password-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="请输入编辑密码…"
                    className="w-full rounded-xl border border-[#CBD5E1] bg-white pl-3.5 pr-10 py-2.5 text-[13.5px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  data-testid="edit-unlock-error"
                  className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[12px] text-[#B91C1C] flex items-start gap-2"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#DC2626]" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-[#CBD5E1] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  data-testid="btn-submit-unlock"
                  disabled={submitting || !password}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_8px_18px_-4px_rgba(37,99,235,0.42)] hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  <span>{submitting ? '验证中…' : '解锁编辑'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/75 px-3.5 py-3 flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-[#059669] shrink-0 mt-0.5" />
                <div className="space-y-1 text-[12px] text-[#065F46]">
                  <div className="font-semibold">当前浏览器标签页已解锁写权限</div>
                  <div className="text-[11px] text-[#047857]">
                    会话凭证仅保存在内存（刷新页面或点击锁定即失效）。
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 text-[11.5px] text-[#475569] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#64748B]">密码来源</span>
                  <span className="font-medium text-[#0F172A]">{sourceLabel}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {meta?.canChangePassword !== false ? (
                  <button
                    type="button"
                    data-testid="btn-toggle-change-password"
                    onClick={() => {
                      setShowChangeForm((prev) => !prev);
                      setChangeError(null);
                      setChangeSuccess(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-[12px] font-semibold text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    <KeyRound className="h-3.5 w-3.5 text-[#2563EB]" />
                    <span>{showChangeForm ? '收起修改密码' : '修改编辑密码'}</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-[#64748B]">
                    由环境变量 <code className="font-mono text-[#0F172A]">AUTODEV_EDIT_PASSWORD</code> 统一管理
                  </span>
                )}

                <button
                  type="button"
                  data-testid="btn-relock-edit"
                  onClick={handleRelock}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-[12px] font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>{submitting ? '锁定中…' : '重新锁定为只读'}</span>
                </button>
              </div>

              {showChangeForm && meta?.canChangePassword !== false && (
                <form
                  onSubmit={handleChangePasswordSubmit}
                  className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-3"
                >
                  <div className="text-[12px] font-semibold text-[#0F172A]">
                    更新服务端编辑密码（Scrypt 加盐哈希存储）
                  </div>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="当前密码"
                    aria-label="当前密码"
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-[12.5px] text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                  />
                  <input
                    type="password"
                    value={nextPassword}
                    onChange={(e) => setNextPassword(e.target.value)}
                    placeholder="新密码（至少 6 位）"
                    aria-label="新密码"
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-[12.5px] text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次确认新密码"
                    aria-label="确认新密码"
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-[12.5px] text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                  />

                  {changeError && (
                    <div className="text-[11.5px] text-[#DC2626] flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{changeError}</span>
                    </div>
                  )}
                  {changeSuccess && (
                    <div className="text-[11.5px] text-[#059669] flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{changeSuccess}</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={changingPassword}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172A] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50 cursor-pointer"
                    >
                      <span>{changingPassword ? '保存中…' : '保存新密码'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Storage Location Info */}
          <div className="pt-2 border-t border-[#F1F5F9] text-[11px] text-[#64748B] leading-relaxed">
            安全存储策略：优先读取服务端环境变量{' '}
            <code className="font-mono text-[#334155]">AUTODEV_EDIT_PASSWORD</code>
            ，未配置时以加盐 Scrypt 哈希保存于服务端状态分支，前端不存储明文密码。
          </div>
        </div>
      </div>
    </div>
  );
}
