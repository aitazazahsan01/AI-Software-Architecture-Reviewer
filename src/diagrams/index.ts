// WIP: Initial module design - index.ts
// Implemented by: diagrams + report agent.
// See docs/ARCHITECTURE.md "Module Contracts" for the required export:
//   generateDiagrams(inventory: ArchitectureInventory, report: ArchitectureImpactReport): DiagramSet
import type { ArchitectureImpactReport, ArchitectureInventory, DiagramSet } from '../types/index.js';
import { buildCurrentArchitectureDiagram, buildProposedArchitectureDiagram } from './flowchart.js';
import { buildSequenceFlowDiagram } from './sequence.js';
import { buildDataModelDiagram } from './er.js';

export function generateDiagrams(
  inventory: ArchitectureInventory,
  report: ArchitectureImpactReport
): DiagramSet {
  const currentArchitecture = buildCurrentArchitectureDiagram(inventory);
  const proposedArchitecture = buildProposedArchitectureDiagram(inventory, report);
  const sequenceFlow = buildSequenceFlowDiagram(report);
  const dataModelDiagram = buildDataModelDiagram(inventory, report);

  return {
    currentArchitecture,
    proposedArchitecture,
    sequenceFlow,
    ...(dataModelDiagram !== undefined ? { dataModelDiagram } : {}),
  };
}

export { buildCurrentArchitectureDiagram, buildProposedArchitectureDiagram } from './flowchart.js';
export { buildSequenceFlowDiagram } from './sequence.js';
export { buildDataModelDiagram } from './er.js';
export { validateMermaid, isBalanced, startsWithDiagramKeyword, sanitizeId, escapeLabel } from './mermaidUtils.js';
