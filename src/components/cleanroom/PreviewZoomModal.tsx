import { useEffect } from 'react';
import { CheckCircle2, ExternalLink, Globe, ShieldCheck, X } from 'lucide-react';
import type { FactoryMode } from '../../lib/factoryPipelineState';

interface PreviewZoomModalProps {
  open: boolean;
  mode: FactoryMode;
  previewUrl: string | null;
  title: string;
  subtitle: string;
  prNumber: number | null;
  onClose: () => void;
}

export function PreviewZoomModal({
  open,
  mode,
  previewUrl,
  title,
  subtitle,
  prNumber,
  onClose,
}: PreviewZoomModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const canRenderRealIframe = mode === 'real' && Boolean(previewUrl);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`预览放大：${title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[920px] max-h-[86vh] rounded-xl border border-[#CBD5E1] bg-white shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="h-4 w-4 text-[#2563EB] shrink-0" />
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#0F172A] text-white shrink-0">
              ST-04 PREVIEW
            </span>
            <h3 className="text-[14px] font-bold text-[#0F172A] truncate">{title}</h3>
            {prNumber && (
              <span className="font-mono text-[11px] text-[#64748B] shrink-0">
                PR #{prNumber}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canRenderRealIframe && previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] px-2.5 py-1 text-[11.5px] font-medium text-[#2563EB] whitespace-nowrap"
              >
                <span>新标签页打开</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭预览弹窗"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F1F5F9] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[#F6F8FA] p-4">
          {canRenderRealIframe && previewUrl ? (
            <div className="rounded-lg border border-[#CBD5E1] bg-white overflow-hidden shadow-sm">
              <iframe
                src={previewUrl}
                title={`Cloudflare Preview - ${title}`}
                className="w-full h-[540px] border-0 bg-white"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-[#CBD5E1] bg-white p-6 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
                <div>
                  <div className="font-mono text-[11px] text-[#2563EB] font-semibold">
                    {previewUrl || 'https://pr-418-invoice.atd-v1.pages.dev'}
                  </div>
                  <h4 className="text-[16px] font-bold text-[#0F172A] mt-0.5">{title}</h4>
                  <p className="text-[12px] text-[#64748B] font-mono">{subtitle}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#047857]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Playwright 8/8 视觉与盲测通过</span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: '导出币种支持', value: 'USD / EUR / CNY', note: 'UTC 成交汇率锁定' },
                  { label: '幂等防重放校验', value: '409 Conflict Guard', note: 'RULE+05 自动生效' },
                  { label: '首屏渲染耗时', value: '142 ms', note: 'Cloudflare Edge Preview' },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFD] p-3.5 space-y-1"
                  >
                    <div className="text-[11px] text-[#64748B]">{card.label}</div>
                    <div className="font-mono text-[14px] font-bold text-[#0F172A]">
                      {card.value}
                    </div>
                    <div className="text-[11px] text-[#059669] inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>{card.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
