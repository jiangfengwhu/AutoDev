import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastItem } from '../types/autodev';

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      aria-label="系统消息通知"
      className="fixed top-20 right-5 z-50 flex flex-col gap-2.5 w-full max-w-[360px] pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isSuccess = toast.type === 'success';
        const Icon = isError ? AlertCircle : isSuccess ? CheckCircle2 : Info;
        const borderClass = isError
          ? 'border-[#FECACA]'
          : isSuccess
            ? 'border-[#A7F3D0]'
            : 'border-[#BFDBFE]';
        const iconClass = isError
          ? 'text-[#DC2626]'
          : isSuccess
            ? 'text-[#059669]'
            : 'text-[#2563EB]';

        return (
          <div
            key={toast.id}
            role={isError ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-xl border ${borderClass} bg-white/97 shadow-[0_12px_28px_-10px_rgba(15,23,42,0.18)] px-3.5 py-3 flex items-start gap-2.5`}
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconClass}`} />
            <div className="min-w-0 flex-1 space-y-0.5">
              {toast.title && (
                <div className="text-[12px] font-bold text-[#0F172A]">{toast.title}</div>
              )}
              <div className="text-[12px] text-[#475569] leading-relaxed break-words">
                {toast.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭提示"
              className="text-[#94A3B8] hover:text-[#0F172A] p-0.5 rounded transition-colors shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
