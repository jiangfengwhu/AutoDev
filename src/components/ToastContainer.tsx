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
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 w-full max-w-[380px] pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isSuccess = toast.type === 'success';
        const Icon = isError ? AlertCircle : isSuccess ? CheckCircle2 : Info;
        const borderClass = isError
          ? 'border-[#F85149]/50'
          : isSuccess
            ? 'border-[#3FB950]/45'
            : 'border-[#58A6FF]/45';
        const iconClass = isError
          ? 'text-[#F85149]'
          : isSuccess
            ? 'text-[#3FB950]'
            : 'text-[#58A6FF]';

        return (
          <div
            key={toast.id}
            role={isError ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-md border ${borderClass} bg-[#161B22] shadow-lg shadow-black/50 px-3.5 py-3 flex items-start gap-2.5`}
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconClass}`} />
            <div className="min-w-0 flex-1 space-y-0.5">
              {toast.title && (
                <div className="text-[12px] font-semibold text-[#F0F6FC]">{toast.title}</div>
              )}
              <div className="text-[12px] text-[#C9D1D9] leading-relaxed break-words">
                {toast.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭提示"
              className="text-[#8B949E] hover:text-[#F0F6FC] p-0.5 rounded transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
