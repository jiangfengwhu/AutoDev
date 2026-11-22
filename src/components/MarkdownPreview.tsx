import type { ReactNode } from 'react';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

function isSafeHref(raw: string): boolean {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed);
}

/**
 * Renders inline Markdown tokens (**bold**, *italic*, `code`, ~~strike~~, [label](url))
 * purely as safe React nodes (zero raw HTML injection).
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|\[([^\]\n]+)\]\(([^)\s]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${tokenIdx++}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded border border-[#E2E8F0] bg-[#F1F5F9] px-1.5 py-0.5 font-mono text-[12px] text-[#0F172A]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      nodes.push(
        <strong key={key} className="font-semibold text-[#0F172A]">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(
        <del key={key} className="text-[#64748B] line-through">
          {renderInline(token.slice(2, -2), `${key}-d`)}
        </del>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key} className="italic text-[#334155]">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>
      );
    } else if (token.startsWith('[') && match[2] && match[3]) {
      const label = match[2];
      const href = match[3];
      if (isSafeHref(href)) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#2563EB] underline decoration-[#93C5FD] underline-offset-2 hover:text-[#1D4ED8]"
          >
            {label}
          </a>
        );
      } else {
        nodes.push(label);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;

  const lines = normalized.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing ```
      blocks.push(
        <div
          key={`b-${blockKey++}`}
          className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] overflow-hidden"
        >
          {lang && (
            <div className="px-3 py-1 border-b border-[#E2E8F0] bg-[#F1F5F9] font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[#64748B]">
              {lang}
            </div>
          )}
          <pre className="p-3.5 overflow-x-auto font-mono text-[12px] leading-relaxed text-[#0F172A]">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      continue;
    }

    // 2. Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`b-${blockKey++}`} className="border-t border-[#E2E8F0] my-2" />);
      i += 1;
      continue;
    }

    // 3. ATX Heading (# .. ######)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const key = `b-${blockKey++}`;
      if (level === 1) {
        blocks.push(
          <h1 key={key} className="text-[17px] font-bold text-[#0F172A] pt-1 pb-1 border-b border-[#E2E8F0]">
            {renderInline(text, key)}
          </h1>
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={key} className="text-[15px] font-bold text-[#0F172A] pt-1.5">
            {renderInline(text, key)}
          </h2>
        );
      } else if (level === 3) {
        blocks.push(
          <h3 key={key} className="text-[13.5px] font-semibold text-[#0F172A] pt-1">
            {renderInline(text, key)}
          </h3>
        );
      } else {
        blocks.push(
          <h4 key={key} className="text-[13px] font-semibold text-[#334155] pt-0.5">
            {renderInline(text, key)}
          </h4>
        );
      }
      i += 1;
      continue;
    }

    // 4. Markdown Table (header + separator row)
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = parseTableCells(rawLine);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(parseTableCells(lines[i]));
        i += 1;
      }
      const key = `b-${blockKey++}`;
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full text-left border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                {headers.map((h, hi) => (
                  <th key={hi} className="px-3 py-2 font-semibold">
                    {renderInline(h, `${key}-h-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-[#F8FAFC]/70">
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 text-[#334155] align-top">
                      {renderInline(row[ci] ?? '', `${key}-r-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 5. Blockquote (> ...)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const key = `b-${blockKey++}`;
      blocks.push(
        <blockquote
          key={key}
          className="rounded-r-lg border-l-[3px] border-[#3B82F6] bg-[#EFF6FF]/65 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#334155] space-y-1"
        >
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{renderInline(ql, `${key}-q-${qi}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 6. Unordered / Task List (- or * or •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: Array<{ text: string; checked: boolean | null; indented: boolean }> = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        const leadingSpaces = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        const itemRaw = lines[i].trim().replace(/^[-*•]\s+/, '');
        const taskMatch = itemRaw.match(/^\[(x|X| )\]\s+(.*)$/);
        if (taskMatch) {
          items.push({
            checked: taskMatch[1].toLowerCase() === 'x',
            text: taskMatch[2],
            indented: leadingSpaces >= 2,
          });
        } else {
          items.push({ checked: null, text: itemRaw, indented: leadingSpaces >= 2 });
        }
        i += 1;
      }
      const key = `b-${blockKey++}`;
      blocks.push(
        <ul key={key} className="space-y-1.5 pl-1 text-[13px] leading-relaxed text-[#334155]">
          {items.map((item, li) => (
            <li
              key={li}
              className={`flex items-start gap-2 ${item.indented ? 'pl-5' : ''}`}
            >
              {item.checked !== null ? (
                <span
                  aria-hidden="true"
                  className={`mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
                    item.checked
                      ? 'border-[#10B981] bg-[#ECFDF5] text-[#059669]'
                      : 'border-[#CBD5E1] bg-white text-transparent'
                  }`}
                >
                  ✓
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className={`mt-2 h-1.5 w-1.5 rounded-full shrink-0 ${
                    item.indented ? 'bg-[#94A3B8]' : 'bg-[#3B82F6]'
                  }`}
                />
              )}
              <span className="min-w-0 break-words">
                {renderInline(item.text, `${key}-ul-${li}`)}
              </span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 7. Ordered List (1. ... preserving explicit item numbers across sub-lists)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: Array<{ num: number; text: string }> = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].trim().match(/^(\d+)\.\s+(.*)$/);
        if (m) {
          items.push({ num: Number(m[1]), text: m[2] });
        }
        i += 1;
      }
      const key = `b-${blockKey++}`;
      const startNum = items[0]?.num ?? 1;
      blocks.push(
        <ol
          key={key}
          start={startNum}
          className="space-y-1.5 pl-1 text-[13px] leading-relaxed text-[#334155]"
        >
          {items.map((item, li) => (
            <li key={li} className="flex items-start gap-2">
              <span className="font-mono text-[11.5px] font-semibold text-[#2563EB] mt-0.5 tabular-nums shrink-0">
                {item.num}.
              </span>
              <span className="min-w-0 break-words">
                {renderInline(item.text, `${key}-ol-${li}`)}
              </span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 8. Paragraph (collect consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^#{1,6}\s+/.test(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^>/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    const key = `b-${blockKey++}`;
    blocks.push(
      <p key={key} className="text-[13px] leading-relaxed text-[#334155] break-words">
        {renderInline(paraLines.join(' '), key)}
      </p>
    );
  }

  return (
    <div data-testid="markdown-preview" className={`space-y-3 ${className}`}>
      {blocks}
    </div>
  );
}
