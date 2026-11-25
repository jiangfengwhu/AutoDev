import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  FileText,
  GitBranch,
  Layers,
  ListTree,
  Table2,
} from 'lucide-react';
import type { PrArtifacts } from '../lib/specBuilder';
import { MarkdownPreview } from './MarkdownPreview';

interface PrArtifactsPreviewProps {
  artifacts: PrArtifacts;
  copiedArtifact: string | null;
  onCopyArtifact: (key: string, content: string) => void;
}

interface ParsedSpecPayload {
  schemaVersion?: string;
  generatedBy?: string;
  runId?: string;
  createdAt?: string;
  repository?: string;
  baseBranch?: string;
  baseCommitSha?: string;
  archivedSpecPath?: string;
  prdTitle?: string;
  architecture?: {
    summary?: string;
    techDecisions?: string[];
  };
  ambiguities?: Array<{
    id: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    detail: string;
    clarificationSuggestion: string;
  }>;
  apiContracts?: Array<{
    id: string;
    method: string;
    path: string;
    summary: string;
    requestSchema: string;
    responseSchema: string;
    errorCodes: string[];
  }>;
  tasks?: Array<{
    id: string;
    title: string;
    module: string;
    description: string;
    dependsOn: string[];
    acceptanceCriteria: string[];
    estimatedComplexity: string;
  }>;
  qaCritic?: {
    reviewSummary?: string;
    findings?: Array<{
      id: string;
      category: string;
      severity: string;
      issue: string;
      recommendation: string;
    }>;
    finalApiTestChecklist?: Array<{
      id: string;
      endpoint: string;
      method: string;
      scenario: string;
      expectedStatus: number;
      assertion: string;
    }>;
  };
}

type ActiveArtifactFile = 'spec' | 'prd';
type SpecRenderMode = 'structured' | 'tree';
type PrdRenderMode = 'preview' | 'source';

const SEVERITY_LABEL: Record<string, { label: string; colorClass: string }> = {
  high: { label: '高危', colorClass: 'text-[#B91C1C]' },
  medium: { label: '中危', colorClass: 'text-[#B45309]' },
  low: { label: '低危', colorClass: 'text-[#475569]' },
};

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-[#047857]',
  POST: 'text-[#1D4ED8]',
  PUT: 'text-[#B45309]',
  PATCH: 'text-[#6D28D9]',
  DELETE: 'text-[#B91C1C]',
};

function JsonTreeNode({
  name,
  value,
  depth,
  defaultExpandDepth,
}: {
  name?: string;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
}) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object' && !isArray;
  const isCollapsible = isArray || isObject;

  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);

  if (!isCollapsible) {
    let rendered: React.ReactNode;
    if (typeof value === 'string') {
      rendered = <span className="text-[#047857] break-words">&quot;{value}&quot;</span>;
    } else if (typeof value === 'number') {
      rendered = <span className="text-[#B45309] tabular-nums">{String(value)}</span>;
    } else if (typeof value === 'boolean') {
      rendered = <span className="text-[#6D28D9] font-medium">{String(value)}</span>;
    } else {
      rendered = <span className="text-[#64748B] italic">null</span>;
    }

    return (
      <div className="py-0.5 leading-relaxed flex items-start gap-1.5 font-mono text-[12px]">
        {name !== undefined && (
          <span className="text-[#1D4ED8] shrink-0">&quot;{name}&quot;:</span>
        )}
        <span className="min-w-0">{rendered}</span>
      </div>
    );
  }

  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((item, idx) => [String(idx), item])
    : Object.entries(value as Record<string, unknown>);

  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';
  const countLabel = isArray ? `${entries.length} 项` : `${entries.length} 字段`;

  return (
    <div className="font-mono text-[12px] leading-relaxed">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-left py-0.5 flex items-center gap-1 rounded hover:bg-[#E2E8F0]/60 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[#64748B] shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[#64748B] shrink-0" />
        )}
        {name !== undefined && (
          <span className="text-[#1D4ED8] shrink-0">&quot;{name}&quot;:</span>
        )}
        <span className="text-[#475569]">{openBracket}</span>
        {!expanded && (
          <>
            <span className="text-[11px] font-sans text-[#64748B] px-1">{countLabel}</span>
            <span className="text-[#475569]">{closeBracket}</span>
          </>
        )}
      </button>

      {expanded && (
        <div className="pl-4 ml-1.5 border-l border-[#E2E8F0]">
          {entries.length === 0 ? (
            <div className="py-0.5 text-[#94A3B8] text-[11px] font-sans">（空）</div>
          ) : (
            entries.map(([k, v]) => (
              <JsonTreeNode
                key={k}
                name={isArray ? undefined : k}
                value={v}
                depth={depth + 1}
                defaultExpandDepth={defaultExpandDepth}
              />
            ))
          )}
          <div className="text-[#475569] py-0.5">{closeBracket}</div>
        </div>
      )}
    </div>
  );
}

export function PrArtifactsPreview({
  artifacts,
  copiedArtifact,
  onCopyArtifact,
}: PrArtifactsPreviewProps) {
  const [activeFile, setActiveFile] = useState<ActiveArtifactFile>('spec');
  const [specMode, setSpecMode] = useState<SpecRenderMode>('structured');
  const [prdMode, setPrdMode] = useState<PrdRenderMode>('preview');
  const [treeExpandDepth, setTreeExpandDepth] = useState(2);

  const parsedSpec = useMemo<ParsedSpecPayload | null>(() => {
    try {
      return JSON.parse(artifacts.specJsonContent) as ParsedSpecPayload;
    } catch {
      return null;
    }
  }, [artifacts.specJsonContent]);

  const currentFileMeta =
    activeFile === 'spec'
      ? {
          key: 'spec',
          path: artifacts.specJsonPath,
          archivePath: artifacts.archivedSpecPath,
          content: artifacts.specJsonContent,
          copyLabel: '复制 JSON',
        }
      : {
          key: 'prd',
          path: artifacts.prdMdPath,
          archivePath: artifacts.archivedPrdPath,
          content: artifacts.prdMdContent,
          copyLabel: '复制 Markdown',
        };

  return (
    <div
      data-testid="pr-artifacts-preview"
      className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden"
    >
      {/* Top File Selector + Action Header */}
      <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#E2E8F0]/75">
          <button
            type="button"
            data-testid="artifact-tab-spec"
            onClick={() => setActiveFile('spec')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeFile === 'spec'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5 text-[#2563EB]" />
            <span className="font-mono">{artifacts.specJsonPath}</span>
          </button>
          <button
            type="button"
            data-testid="artifact-tab-prd"
            onClick={() => setActiveFile('prd')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeFile === 'prd'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <FileText className="h-3.5 w-3.5 text-[#059669]" />
            <span className="font-mono">{artifacts.prdMdPath}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11.5px] text-[#64748B] truncate max-w-[320px]">
            同步归档至 <code className="font-mono text-[#334155]">{currentFileMeta.archivePath}</code>
          </span>

          {activeFile === 'spec' ? (
            <div className="flex items-center gap-1 p-0.5 rounded-lg border border-[#E2E8F0] bg-white">
              <button
                type="button"
                data-testid="spec-mode-structured"
                onClick={() => setSpecMode('structured')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  specMode === 'structured'
                    ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                <Table2 className="h-3 w-3" />
                <span>结构化视图</span>
              </button>
              <button
                type="button"
                data-testid="spec-mode-tree"
                onClick={() => setSpecMode('tree')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  specMode === 'tree'
                    ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                <ListTree className="h-3 w-3" />
                <span>JSON 树</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 p-0.5 rounded-lg border border-[#E2E8F0] bg-white">
              <button
                type="button"
                data-testid="prd-mode-preview"
                onClick={() => setPrdMode('preview')}
                className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  prdMode === 'preview'
                    ? 'bg-[#ECFDF5] text-[#047857]'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                文档预览
              </button>
              <button
                type="button"
                data-testid="prd-mode-source"
                onClick={() => setPrdMode('source')}
                className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  prdMode === 'source'
                    ? 'bg-[#ECFDF5] text-[#047857]'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                Markdown 源码
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => onCopyArtifact(currentFileMeta.key, currentFileMeta.content)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors whitespace-nowrap cursor-pointer"
          >
            {copiedArtifact === currentFileMeta.key ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#059669]" />
                <span className="text-[#059669]">已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>{currentFileMeta.copyLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Body Content */}
      {activeFile === 'spec' ? (
        specMode === 'structured' && parsedSpec ? (
          <div
            data-testid="spec-structured-view"
            className="p-5 sm:p-6 space-y-6 bg-white text-[#0F172A] max-h-[540px] overflow-y-auto"
          >
            {/* Unboxed Metadata Bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pb-4 border-b border-[#E2E8F0] text-[12px] text-[#475569]">
              <span className="font-semibold text-[#0F172A]">{parsedSpec.prdTitle || '规格说明'}</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span className="font-mono text-[#334155]">Schema v{parsedSpec.schemaVersion || '1.1'}</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span className="font-mono text-[#2563EB]">{parsedSpec.runId}</span>
              {parsedSpec.repository && (
                <>
                  <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[#334155]">
                    <GitBranch className="h-3 w-3 text-[#64748B]" />
                    {parsedSpec.repository} ({parsedSpec.baseBranch || 'main'}
                    {parsedSpec.baseCommitSha ? `@${parsedSpec.baseCommitSha.slice(0, 7)}` : ''})
                  </span>
                </>
              )}
            </div>

            {/* Architecture Summary & Tech Decisions */}
            {parsedSpec.architecture && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">
                    01. 架构摘要与技术决策
                  </h4>
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {(parsedSpec.architecture.techDecisions || []).length} 项决策
                  </span>
                </div>
                {parsedSpec.architecture.summary && (
                  <p className="text-[13px] leading-relaxed text-[#334155] bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] px-4 py-3">
                    {parsedSpec.architecture.summary}
                  </p>
                )}
                {(parsedSpec.architecture.techDecisions || []).length > 0 && (
                  <ol className="space-y-1.5 text-[12.5px] text-[#334155]">
                    {parsedSpec.architecture.techDecisions!.map((decision, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="font-mono text-[11.5px] font-semibold text-[#2563EB] tabular-nums mt-0.5 shrink-0">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <span className="leading-relaxed">{decision}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {/* API Contracts Table */}
            {(parsedSpec.apiContracts || []).length > 0 && (
              <div className="space-y-2.5 pt-2 border-t border-[#F1F5F9]">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">
                    02. 接口契约 (API Contracts)
                  </h4>
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {parsedSpec.apiContracts!.length} 个接口
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
                  <table className="w-full text-left border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569]">
                        <th className="px-3 py-2 font-semibold whitespace-nowrap">ID</th>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap">接口路径</th>
                        <th className="px-3 py-2 font-semibold">说明与数据结构</th>
                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">错误码</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] bg-white">
                      {parsedSpec.apiContracts!.map((api, idx) => (
                        <tr
                          key={api.id || `${api.method}-${api.path}-${idx}`}
                          className="hover:bg-[#F8FAFC]/80"
                        >
                          <td className="px-3 py-2.5 font-mono text-[#2563EB] whitespace-nowrap align-top">
                            {api.id || `API-${String(idx + 1).padStart(2, '0')}`}
                          </td>
                          <td className="px-3 py-2.5 font-mono whitespace-nowrap align-top">
                            <span
                              className={`font-bold mr-1.5 ${
                                METHOD_COLOR[api.method?.toUpperCase()] || 'text-[#0F172A]'
                              }`}
                            >
                              {api.method}
                            </span>
                            <span className="text-[#0F172A]">{api.path}</span>
                          </td>
                          <td className="px-3 py-2.5 text-[#334155] align-top space-y-1">
                            <div className="font-medium text-[#0F172A]">{api.summary}</div>
                            <div className="text-[11px] font-mono text-[#64748B] break-all">
                              Req: {api.requestSchema} · Res: {api.responseSchema}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums text-[#64748B] whitespace-nowrap align-top">
                            {(api.errorCodes || []).join(' / ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Atomic Tasks Breakdown */}
            {(parsedSpec.tasks || []).length > 0 && (
              <div className="space-y-2.5 pt-2 border-t border-[#F1F5F9]">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">
                    03. 原子开发任务清单 (Tasks)
                  </h4>
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {parsedSpec.tasks!.length} 项任务
                  </span>
                </div>
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-white">
                  {parsedSpec.tasks!.map((task, idx) => (
                    <div key={task.id || `task-${idx}`} className="p-3.5 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-[12px] font-semibold text-[#2563EB]">
                            {task.id || `T-${String(idx + 1).padStart(2, '0')}`}
                          </span>
                          <span className="text-[13px] font-semibold text-[#0F172A]">
                            {task.title}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-[#64748B] font-mono">
                          {task.module} · 复杂度 {task.estimatedComplexity}
                          {task.dependsOn && task.dependsOn.length > 0
                            ? ` · 依赖 ${task.dependsOn.join(', ')}`
                            : ''}
                        </div>
                      </div>
                      <p className="text-[12.5px] text-[#334155] leading-relaxed">
                        {task.description}
                      </p>
                      {(task.acceptanceCriteria || []).length > 0 && (
                        <ul className="space-y-1 pt-1 text-[12px] text-[#475569]">
                          {task.acceptanceCriteria.map((ac, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-[#059669] font-semibold shrink-0">✓</span>
                              <span>{ac}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ambiguities */}
            {(parsedSpec.ambiguities || []).length > 0 && (
              <div className="space-y-2.5 pt-2 border-t border-[#F1F5F9]">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">
                    04. 需求歧义与澄清记录
                  </h4>
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {parsedSpec.ambiguities!.length} 条记录
                  </span>
                </div>
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-white">
                  {parsedSpec.ambiguities!.map((amb, idx) => {
                    const sev = SEVERITY_LABEL[amb.severity] ?? SEVERITY_LABEL.low;
                    return (
                      <div key={amb.id || `amb-${idx}`} className="p-3.5 space-y-1">
                        <div className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                          <span className="font-mono text-[#64748B]">
                            {amb.id || `AMB-${String(idx + 1).padStart(2, '0')}`}
                          </span>
                          <span className={`font-semibold ${sev.colorClass}`}>{sev.label}</span>
                          <span className="font-semibold text-[#0F172A]">{amb.title}</span>
                        </div>
                        <p className="text-[12px] text-[#334155] leading-relaxed">{amb.detail}</p>
                        <p className="text-[12px] text-[#1D4ED8] leading-relaxed">
                          澄清建议：{amb.clarificationSuggestion}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* QA Critic Summary (concise metadata, no raw test script) */}
            {parsedSpec.qaCritic?.reviewSummary && (
              <div className="space-y-2 pt-2 border-t border-[#F1F5F9]">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">
                    05. 独立评审摘要 (QA Critic)
                  </h4>
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {(parsedSpec.qaCritic.findings || []).length} 条评审发现 ·{' '}
                    {(parsedSpec.qaCritic.finalApiTestChecklist || []).length} 项接口校验
                  </span>
                </div>
                <p className="text-[12.5px] leading-relaxed text-[#334155] bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] px-4 py-3">
                  {parsedSpec.qaCritic.reviewSummary}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div
            data-testid="spec-json-tree-view"
            className="bg-[#F8FAFC] max-h-[540px] overflow-y-auto"
          >
            <div className="px-4 py-2 border-b border-[#E2E8F0] bg-white/80 flex items-center justify-between text-[11.5px] text-[#64748B]">
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>交互式 JSON 结构树（点击节点展开 / 收起）</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTreeExpandDepth((d) => (d >= 6 ? 1 : 6))}
                  className="text-[#2563EB] hover:text-[#1D4ED8] font-medium cursor-pointer"
                >
                  {treeExpandDepth >= 6 ? '折叠深层' : '全部展开'}
                </button>
              </div>
            </div>
            <div className="p-4" key={treeExpandDepth}>
              {parsedSpec ? (
                <JsonTreeNode
                  value={parsedSpec}
                  depth={0}
                  defaultExpandDepth={treeExpandDepth}
                />
              ) : (
                <pre
                  data-light-surface="true"
                  className="p-3 rounded-lg border border-[#E2E8F0] bg-white font-mono text-[12px] leading-relaxed text-[#0F172A] overflow-x-auto"
                >
                  {artifacts.specJsonContent}
                </pre>
              )}
            </div>
          </div>
        )
      ) : prdMode === 'preview' ? (
        <div
          data-testid="prd-markdown-rendered"
          className="p-5 sm:p-6 bg-white max-h-[540px] overflow-y-auto"
        >
          <MarkdownPreview content={artifacts.prdMdContent} />
        </div>
      ) : (
        <div className="p-4 bg-[#F8FAFC] max-h-[540px] overflow-y-auto">
          <pre
            data-light-surface="true"
            className="p-4 rounded-lg border border-[#E2E8F0] bg-white font-mono text-[12px] leading-relaxed text-[#0F172A] whitespace-pre-wrap break-words"
          >
            {artifacts.prdMdContent}
          </pre>
        </div>
      )}
    </div>
  );
}
