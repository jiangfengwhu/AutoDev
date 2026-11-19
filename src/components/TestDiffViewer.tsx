import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { computeLineDiff } from '../lib/lineDiff';

interface TestDiffViewerProps {
  initialCode: string;
  finalCode: string;
  fileName?: string;
}

type ViewerMode = 'diff' | 'final' | 'initial';

export function TestDiffViewer({
  initialCode,
  finalCode,
  fileName = 'tests/e2e.spec.ts',
}: TestDiffViewerProps) {
  const [mode, setMode] = useState<ViewerMode>('diff');
  const [copied, setCopied] = useState(false);

  const diff = useMemo(() => computeLineDiff(initialCode, finalCode), [initialCode, finalCode]);

  const handleCopy = async () => {
    const text = mode === 'initial' ? initialCode : finalCode;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in non-secure context
    }
  };

  return (
    <div className="rounded-md border border-[#30363D] bg-[#0D1117] overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#30363D] bg-[#161B22]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[12px] font-medium text-[#F0F6FC] truncate">
            {fileName}
          </span>
          <span className="text-[12px] font-mono tabular-nums flex items-center gap-2 shrink-0">
            <span className="text-[#3FB950]">+{diff.stats.added}</span>
            <span className="text-[#F85149]">-{diff.stats.removed}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="测试脚本视图切换"
            className="inline-flex items-center gap-1 rounded-md bg-[#0D1117] p-0.5 border border-[#30363D]"
          >
            {(
              [
                { id: 'diff', label: '评审变更对比' },
                { id: 'final', label: '终版只读代码' },
                { id: 'initial', label: 'QA Spec 初版' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                onClick={() => setMode(tab.id)}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  mode === tab.id
                    ? 'bg-[#21262D] text-[#F0F6FC]'
                    : 'text-[#8B949E] hover:text-[#C9D1D9]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#30363D] bg-[#21262D] px-2.5 py-1 text-[11px] font-medium text-[#C9D1D9] hover:bg-[#30363D] hover:text-[#F0F6FC] transition-colors whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-[#3FB950]" />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>复制代码</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Viewport */}
      <div className="max-h-[460px] overflow-auto font-mono text-[12px] leading-[1.6] bg-[#010409]">
        {mode === 'diff' ? (
          <table className="w-full border-collapse">
            <tbody>
              {diff.lines.map((line, index) => {
                const rowClass =
                  line.type === 'added'
                    ? 'bg-[#2EA043]/15 text-[#AFF5B4]'
                    : line.type === 'removed'
                      ? 'bg-[#F85149]/15 text-[#FFDCD7]'
                      : 'text-[#C9D1D9]';
                const marker =
                  line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                const markerColor =
                  line.type === 'added'
                    ? 'text-[#3FB950]'
                    : line.type === 'removed'
                      ? 'text-[#F85149]'
                      : 'text-[#6E7681]';

                return (
                  <tr key={index} className={rowClass}>
                    <td className="w-10 select-none px-2 text-right text-[11px] text-[#6E7681] tabular-nums border-r border-[#21262D]">
                      {line.beforeLine ?? ''}
                    </td>
                    <td className="w-10 select-none px-2 text-right text-[11px] text-[#6E7681] tabular-nums border-r border-[#30363D]">
                      {line.afterLine ?? ''}
                    </td>
                    <td className={`w-6 select-none text-center font-semibold ${markerColor}`}>
                      {marker}
                    </td>
                    <td className="pr-4 whitespace-pre">{line.content || ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <pre className="p-4 text-[#C9D1D9] whitespace-pre overflow-x-auto">
            {mode === 'final' ? finalCode : initialCode}
          </pre>
        )}
      </div>
    </div>
  );
}
