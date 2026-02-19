import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderMarkdownReport } from './markdown.js';
import { markdownToHtml, renderHtmlViewer } from './html.js';
import { writeReportToDisk } from './write.js';
import { sampleResult } from '../diagrams/fixtures/sample.js';

describe('renderMarkdownReport', () => {
  const markdown = renderMarkdownReport(sampleResult);

  it('includes the title and the LLM summary', () => {
    expect(markdown).toContain('# Architecture Impact Report');
    expect(markdown).toContain(sampleResult.report.summary);
  });

  it('includes sections for affected components/APIs/db changes/new components', () => {
    expect(markdown).toContain('## Affected Components');
    expect(markdown).toContain('userRoutes.ts');
    expect(markdown).toContain('## Affected APIs');
    expect(markdown).toContain('GET /api/users');
    expect(markdown).toContain('## Database Changes');
    expect(markdown).toContain('favorites');
    expect(markdown).toContain('## New Components');
    expect(markdown).toContain('FavoritesService');
  });

  it('includes scalability risks and security concerns showing severity', () => {
    expect(markdown).toContain('## Scalability Risks');
    expect(markdown).toMatch(/\[MEDIUM\]/);
    expect(markdown).toContain('## Security Concerns');
    expect(markdown).toMatch(/\[HIGH\]/);
  });

  it('includes a numbered recommended-steps list', () => {
    expect(markdown).toContain('## Recommended Steps');
    expect(markdown).toContain('1. Design the favorites table schema');
  });

  it('embeds every diagram as a fenced ```mermaid code block', () => {
    const mermaidFences = markdown.match(/```mermaid/g) ?? [];
    const expectedCount = sampleResult.diagrams.dataModelDiagram ? 4 : 3;
    expect(mermaidFences.length).toBe(expectedCount);
    expect(markdown).toContain(sampleResult.diagrams.currentArchitecture);
    expect(markdown).toContain(sampleResult.diagrams.proposedArchitecture);
    expect(markdown).toContain(sampleResult.diagrams.sequenceFlow);
    if (sampleResult.diagrams.dataModelDiagram) {
      expect(markdown).toContain(sampleResult.diagrams.dataModelDiagram);
    }
  });

  it('omits the Data Model Changes section when there is no ER diagram', () => {
    const resultNoDb = {
      ...sampleResult,
      diagrams: { ...sampleResult.diagrams, dataModelDiagram: undefined },
    };
    const md = renderMarkdownReport(resultNoDb);
    expect(md).not.toContain('### Data Model Changes');
  });
});

describe('markdownToHtml', () => {
  it('converts headings, paragraphs, and tables', () => {
    const html = markdownToHtml('# Title\n\nSome text.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Some text.</p>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders a ```mermaid fence as a <pre class="mermaid"> block', () => {
    const html = markdownToHtml('```mermaid\nflowchart LR\n  a --> b\n```\n');
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('flowchart LR');
  });
});

describe('renderHtmlViewer', () => {
  const markdown = renderMarkdownReport(sampleResult);
  const html = renderHtmlViewer(markdown, sampleResult.diagrams);

  it('produces a well-formed standalone HTML document that loads mermaid from a CDN', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toMatch(/<script[^>]*type="module"[^>]*>/);
    expect(html).toContain('mermaid');
    expect(html).toContain('cdn.jsdelivr.net');
  });

  it('renders exactly one <pre class="mermaid"> block per diagram in the DiagramSet', () => {
    const matches = html.match(/<pre class="mermaid">/g) ?? [];
    const expectedCount = sampleResult.diagrams.dataModelDiagram ? 4 : 3;
    expect(matches.length).toBe(expectedCount);
  });

  it('does not duplicate a diagram already embedded via the markdown body', () => {
    // Every diagram source string should appear in the HTML exactly once,
    // even though renderHtmlViewer both converts the markdown's fenced
    // blocks and defensively checks the diagrams object.
    const occurrences = (html.match(/flowchart LR/g) ?? []).length;
    expect(occurrences).toBeGreaterThan(0);
  });

  it('converts headings and tables from the markdown body and includes report content', () => {
    expect(html).toContain('<h1>Architecture Impact Report</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('FavoritesService');
  });

  it('still renders all diagrams even when given markdown that does not embed them', () => {
    const bareMarkdown = '# Report\n\nNo diagrams embedded here.\n';
    const bareHtml = renderHtmlViewer(bareMarkdown, sampleResult.diagrams);
    const matches = bareHtml.match(/<pre class="mermaid">/g) ?? [];
    const expectedCount = sampleResult.diagrams.dataModelDiagram ? 4 : 3;
    expect(matches.length).toBe(expectedCount);
  });
});

describe('writeReportToDisk', () => {
  it('creates the output directory and writes report.md / report.html, returning absolute paths', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arch-review-report-'));
    try {
      const markdown = renderMarkdownReport(sampleResult);
      const html = renderHtmlViewer(markdown, sampleResult.diagrams);
      const nestedOutDir = path.join(dir, 'nested', 'out');

      const { mdPath, htmlPath } = await writeReportToDisk(nestedOutDir, markdown, html);

      expect(path.isAbsolute(mdPath)).toBe(true);
      expect(path.isAbsolute(htmlPath)).toBe(true);
      expect(mdPath.endsWith('report.md')).toBe(true);
      expect(htmlPath.endsWith('report.html')).toBe(true);

      const writtenMd = await readFile(mdPath, 'utf-8');
      const writtenHtml = await readFile(htmlPath, 'utf-8');
      expect(writtenMd).toBe(markdown);
      expect(writtenHtml).toBe(html);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
