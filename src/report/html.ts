// WIP: Initial module design - html.ts
import type { DiagramSet } from '../types/index.js';

// Pinned Mermaid version served from jsdelivr — matches the CDN choice documented
// in docs/ARCHITECTURE.md ("diagrams" section): no bundler/server needed.
const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  return out;
}

function renderTableHtml(tableLines: string[]): string {
  const rows = tableLines.map((l) =>
    l
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
  );
  const [headerRow, sepRow, ...restRows] = rows;
  const isSepRow = sepRow !== undefined && sepRow.every((c) => /^:?-+:?$/.test(c));
  const bodyRows = isSepRow ? restRows : rows.slice(1);
  const thead = `<thead><tr>${(headerRow ?? [])
    .map((h) => `<th>${renderInline(h)}</th>`)
    .join('')}</tr></thead>`;
  const tbody = `<tbody>${bodyRows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

/**
 * Hand-rolled Markdown-to-HTML conversion, deliberately scoped to the subset
 * of Markdown that `renderMarkdownReport` actually produces (headings,
 * blockquotes, pipe tables, bullet/numbered lists, fenced code blocks,
 * paragraphs, and minimal inline bold/italic/code) — a full Markdown parser
 * dependency isn't declared in package.json and isn't necessary here.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;

  const closeLists = (): void => {
    if (inUl) {
      html.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      html.push('</ol>');
      inOl = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const contentLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        contentLines.push(lines[i] ?? '');
        i++;
      }
      i++; // skip closing fence
      closeLists();
      const content = contentLines.join('\n');
      if (lang === 'mermaid') {
        html.push(`<pre class="mermaid">${escapeHtml(content)}</pre>`);
      } else {
        html.push(`<pre><code>${escapeHtml(content)}</code></pre>`);
      }
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      closeLists();
      const level = headingMatch[1]?.length ?? 1;
      html.push(`<h${level}>${renderInline(headingMatch[2] ?? '')}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      closeLists();
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quoteLines.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${renderInline(quoteLines.join('<br/>'))}</blockquote>`);
      continue;
    }

    if (/^\|.*\|$/.test(line.trim()) && line.trim().length > 1) {
      closeLists();
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.*\|$/.test((lines[i] ?? '').trim())) {
        tableLines.push((lines[i] ?? '').trim());
        i++;
      }
      html.push(renderTableHtml(tableLines));
      continue;
    }

    if (/^-\s+/.test(line)) {
      if (!inUl) {
        closeLists();
        html.push('<ul>');
        inUl = true;
      }
      html.push(`<li>${renderInline(line.replace(/^-\s+/, ''))}</li>`);
      i++;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (!inOl) {
        closeLists();
        html.push('<ol>');
        inOl = true;
      }
      html.push(`<li>${renderInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      i++;
      continue;
    }

    if (line.trim() === '') {
      closeLists();
      i++;
      continue;
    }

    closeLists();
    html.push(`<p>${renderInline(line)}</p>`);
    i++;
  }
  closeLists();
  return html.join('\n');
}

/** Extracts the (trimmed) content of every ```mermaid fenced block in `markdown`. */
function extractMermaidBlocks(markdown: string): Set<string> {
  const regex = /```mermaid\r?\n([\s\S]*?)```/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    found.add((match[1] ?? '').trim());
  }
  return found;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1.5rem 4rem; line-height: 1.6; color: #1a1a1a; background: #ffffff; }
  h1, h2, h3 { color: #1f2937; }
  h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.4rem; }
  h2 { border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3rem; margin-top: 2.5rem; }
  h3 { margin-top: 1.75rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d1d5db; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  blockquote { border-left: 4px solid #93c5fd; margin: 1rem 0; padding: 0.25rem 1rem; background: #eff6ff; color: #1e3a8a; }
  code { background: #f3f4f6; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
  pre { overflow-x: auto; }
  pre code { display: block; padding: 0.75rem; }
  pre.mermaid { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; text-align: center; }
  ul, ol { padding-left: 1.4rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f172a; color: #e2e8f0; }
    h1, h2, h3 { color: #f1f5f9; }
    h1, h2 { border-color: #334155; }
    th, td { border-color: #334155; }
    th { background: #1e293b; }
    blockquote { background: #1e293b; border-color: #3b82f6; color: #bfdbfe; }
    code { background: #1e293b; }
    pre.mermaid { background: #1e293b; border-color: #334155; }
  }
`;

/**
 * Renders a single self-contained HTML string that loads mermaid.js from a
 * CDN and renders the report standalone in a browser — no bundler, no
 * server. The Markdown body is converted with `markdownToHtml`; each
 * diagram in `diagrams` gets its own `<pre class="mermaid">` block. When the
 * given `markdown` already embeds a diagram's exact source in a
 * ` ```mermaid ` fence (the normal case, since it came from
 * `renderMarkdownReport`), that block is reused in place rather than
 * duplicated; any diagram from `diagrams` not found in the markdown is
 * appended so every diagram is always rendered.
 */
export function renderHtmlViewer(markdown: string, diagrams: DiagramSet): string {
  const bodyHtml = markdownToHtml(markdown);
  const embeddedMermaid = extractMermaidBlocks(markdown);

  const diagramFields: Array<[string, string | undefined]> = [
    ['Current Architecture', diagrams.currentArchitecture],
    ['Proposed Architecture', diagrams.proposedArchitecture],
    ['Sequence Flow', diagrams.sequenceFlow],
    ['Data Model Changes', diagrams.dataModelDiagram],
  ];

  const extraDiagramSections: string[] = [];
  for (const [title, source] of diagramFields) {
    if (!source) continue;
    if (embeddedMermaid.has(source.trim())) continue;
    extraDiagramSections.push(
      `<section><h3>${escapeHtml(title)}</h3><pre class="mermaid">${escapeHtml(source)}</pre></section>`
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Architecture Impact Report</title>
<style>${STYLE}</style>
</head>
<body>
<article>
${bodyHtml}
${extraDiagramSections.join('\n')}
</article>
<script type="module">
  import mermaid from '${MERMAID_CDN_URL}';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
  });
  mermaid.run({ querySelector: '.mermaid' });
</script>
</body>
</html>
`;
}
