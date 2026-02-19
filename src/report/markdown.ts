import type { AnalysisResult, Severity } from '../types/index.js';

function severityBadge(sev: Severity): string {
  switch (sev) {
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    default:
      return String(sev).toUpperCase();
  }
}

function escapeCell(text: string): string {
  return (text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_None identified._\n';
  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((r) => `| ${r.map(escapeCell).join(' | ')} |`);
  return [headerLine, sepLine, ...bodyLines].join('\n') + '\n';
}

function renderMermaidBlock(source: string): string[] {
  return ['```mermaid', source, '```', ''];
}

/**
 * Renders a complete Markdown report from an `AnalysisResult`: the LLM's
 * summary, tables/lists for every report section, and each generated
 * diagram embedded as a fenced ```mermaid block (renders natively on GitHub
 * and in VS Code's Markdown preview).
 */
export function renderMarkdownReport(result: AnalysisResult): string {
  const { proposal, report, diagrams, inventory } = result;
  const lines: string[] = [];

  lines.push('# Architecture Impact Report');
  lines.push('');
  lines.push(`**Repository:** \`${inventory.repo.rootPath}\``);
  lines.push('');
  lines.push('**Proposed change:**');
  lines.push('');
  lines.push('> ' + proposal.description.split(/\r?\n/).join('\n> '));
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(report.summary || '_No summary provided._');
  lines.push('');

  lines.push('## Affected Components');
  lines.push('');
  lines.push(
    renderTable(
      ['Component', 'Reason'],
      report.affectedComponents.map((c) => [c.name, c.reason])
    )
  );

  lines.push('## Affected APIs');
  lines.push('');
  lines.push(
    renderTable(
      ['Endpoint', 'Impact'],
      report.affectedApis.map((a) => [a.endpoint, a.impact])
    )
  );

  lines.push('## Database Changes');
  lines.push('');
  lines.push(
    renderTable(
      ['Description', 'Migration Notes'],
      report.databaseChanges.map((d) => [d.description, d.migrationNotes])
    )
  );

  lines.push('## New Components');
  lines.push('');
  lines.push(
    renderTable(
      ['Component', 'Purpose'],
      report.newComponents.map((c) => [c.name, c.purpose])
    )
  );

  lines.push('## Scalability Risks');
  lines.push('');
  if (report.scalabilityRisks.length === 0) {
    lines.push('_None identified._');
  } else {
    for (const r of report.scalabilityRisks) {
      lines.push(`- **[${severityBadge(r.severity)}]** ${r.risk} — _Mitigation:_ ${r.mitigation}`);
    }
  }
  lines.push('');

  lines.push('## Security Concerns');
  lines.push('');
  if (report.securityConcerns.length === 0) {
    lines.push('_None identified._');
  } else {
    for (const s of report.securityConcerns) {
      lines.push(`- **[${severityBadge(s.severity)}]** ${s.concern} — _Mitigation:_ ${s.mitigation}`);
    }
  }
  lines.push('');

  lines.push('## Recommended Steps');
  lines.push('');
  if (report.recommendedSteps.length === 0) {
    lines.push('_None identified._');
  } else {
    report.recommendedSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  }
  lines.push('');

  lines.push('## Diagrams');
  lines.push('');
  lines.push('### Current Architecture');
  lines.push('');
  lines.push(...renderMermaidBlock(diagrams.currentArchitecture));
  lines.push('### Proposed Architecture');
  lines.push('');
  lines.push(...renderMermaidBlock(diagrams.proposedArchitecture));
  lines.push('### Sequence Flow');
  lines.push('');
  lines.push(...renderMermaidBlock(diagrams.sequenceFlow));
  if (diagrams.dataModelDiagram) {
    lines.push('### Data Model Changes');
    lines.push('');
    lines.push(...renderMermaidBlock(diagrams.dataModelDiagram));
  }

  return lines.join('\n');
}
