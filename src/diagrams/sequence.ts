// WIP: Initial module design - sequence.ts
import type { ArchitectureImpactReport } from '../types/index.js';
import { escapeLabel, truncate } from './mermaidUtils.js';

/**
 * `sequenceFlow`: a best-effort Mermaid sequence diagram inferred from the
 * LLM's free-text report. There's no structured call-graph to draw from, so
 * this renders a simple linear flow per affected API: Client -> the
 * endpoint -> the component(s) that handle it -> a data store (only when
 * `databaseChanges` is non-empty) -> back to the client. This is
 * intentionally a simplification of the report's prose, not a literal call
 * trace.
 */
export function buildSequenceFlowDiagram(report: ArchitectureImpactReport): string {
  const lines: string[] = ['sequenceDiagram'];
  const hasDb = report.databaseChanges.length > 0;

  const apis =
    report.affectedApis.length > 0
      ? report.affectedApis
      : [{ endpoint: 'the application', impact: report.summary || 'handle the request' }];

  const componentLabel =
    report.affectedComponents.length > 0
      ? report.affectedComponents.map((c) => c.name).join(' + ')
      : report.newComponents.length > 0
        ? report.newComponents.map((c) => c.name).join(' + ')
        : 'Application Logic';

  lines.push('    participant Client');
  const apiIds = apis.map((api, i) => {
    const id = `api_${i}`;
    lines.push(`    participant ${id} as ${escapeLabel(api.endpoint)}`);
    return id;
  });
  const componentId = 'component';
  lines.push(`    participant ${componentId} as ${escapeLabel(componentLabel)}`);
  if (hasDb) {
    lines.push('    participant data_store as Data Store');
  }

  if (report.summary) {
    lines.push(`    Note over Client: ${escapeLabel(truncate(report.summary, 120))}`);
  }

  apis.forEach((api, i) => {
    const apiId = apiIds[i];
    lines.push(`    Client->>+${apiId}: request`);
    lines.push(`    ${apiId}->>+${componentId}: handle`);
    if (hasDb) {
      lines.push(`    ${componentId}->>+data_store: read/write`);
      lines.push(`    data_store-->>-${componentId}: result`);
    }
    const impactNote = escapeLabel(truncate(api.impact || 'response', 80));
    lines.push(`    ${componentId}-->>-${apiId}: ${impactNote || 'response'}`);
    lines.push(`    ${apiId}-->>-Client: response`);
  });

  return lines.join('\n');
}
