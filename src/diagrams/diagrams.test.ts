import { describe, expect, it } from 'vitest';
import { generateDiagrams } from './index.js';
import { isBalanced, validateMermaid } from './mermaidUtils.js';
import { sampleInventory, sampleReport, sampleReportNoDbChanges } from './fixtures/sample.js';

describe('generateDiagrams', () => {
  const diagrams = generateDiagrams(sampleInventory, sampleReport);

  it('produces a valid current-architecture flowchart grouped by top-level directory', () => {
    expect(diagrams.currentArchitecture.trim().startsWith('flowchart')).toBe(true);
    expect(isBalanced(diagrams.currentArchitecture)).toBe(true);
    expect(diagrams.currentArchitecture).toContain('subgraph');
    expect(diagrams.currentArchitecture).toContain('src/rag');
    expect(diagrams.currentArchitecture).toContain('src/api');
    expect(diagrams.currentArchitecture).toContain('userRoutes.ts');
    // external ("kind: external") deps are folded into a single shared node, not one per package
    expect(diagrams.currentArchitecture).toContain('External Dependencies');
    expect(diagrams.currentArchitecture.match(/External Dependencies/g)?.length).toBe(1);
  });

  it('produces a valid proposed-architecture flowchart highlighting new/affected components', () => {
    expect(diagrams.proposedArchitecture.trim().startsWith('flowchart')).toBe(true);
    expect(isBalanced(diagrams.proposedArchitecture)).toBe(true);
    // new component from report.newComponents
    expect(diagrams.proposedArchitecture).toContain('FavoritesService');
    expect(diagrams.proposedArchitecture).toContain('classDef newComp');
    expect(diagrams.proposedArchitecture).toContain('classDef affectedComp');
    expect(diagrams.proposedArchitecture).toMatch(/class .*newComp;/);
    expect(diagrams.proposedArchitecture).toMatch(/class .*affectedComp;/);
  });

  it('produces a valid sequence diagram inferred from the report summary + affected APIs', () => {
    expect(diagrams.sequenceFlow.trim().startsWith('sequenceDiagram')).toBe(true);
    expect(isBalanced(diagrams.sequenceFlow)).toBe(true);
    expect(diagrams.sequenceFlow).toContain('participant Client');
    expect(diagrams.sequenceFlow).toContain('GET /api/users');
    // databaseChanges is non-empty in the fixture -> a data store participant is included
    expect(diagrams.sequenceFlow).toContain('data_store');
  });

  it('produces a data model ER diagram when databaseChanges is non-empty, matched against inventory.dataModels', () => {
    expect(diagrams.dataModelDiagram).toBeDefined();
    const er = diagrams.dataModelDiagram as string;
    expect(er.trim().startsWith('erDiagram')).toBe(true);
    expect(isBalanced(er)).toBe(true);
    expect(er).toContain('USER');
    expect(er).toContain('email');
  });

  it('omits the data model diagram entirely when there are no database changes', () => {
    const noDbDiagrams = generateDiagrams(sampleInventory, sampleReportNoDbChanges);
    expect(noDbDiagrams.dataModelDiagram).toBeUndefined();
  });

  it('falls back to a generic entity block when a database change cannot be matched to a known data model', () => {
    const unmatchedReport: typeof sampleReport = {
      ...sampleReport,
      databaseChanges: [
        { description: 'Add a brand new audit_log table.', migrationNotes: 'CREATE TABLE audit_log(...)' },
      ],
    };
    const diagramSet = generateDiagrams(sampleInventory, unmatchedReport);
    expect(diagramSet.dataModelDiagram).toBeDefined();
    const er = diagramSet.dataModelDiagram as string;
    expect(isBalanced(er)).toBe(true);
    expect(er).toContain('CHANGE_0');
    expect(er).toContain('description');
  });
});

describe('validateMermaid', () => {
  const diagrams = generateDiagrams(sampleInventory, sampleReport);

  it('accepts well-formed generated diagrams', () => {
    expect(validateMermaid(diagrams.currentArchitecture, 'flowchart')).toBe(true);
    expect(validateMermaid(diagrams.sequenceFlow, 'sequenceDiagram')).toBe(true);
    expect(validateMermaid(diagrams.dataModelDiagram as string, 'erDiagram')).toBe(true);
  });

  it('rejects unbalanced brackets', () => {
    expect(validateMermaid('flowchart LR\n  a[[b', 'flowchart')).toBe(false);
  });

  it('rejects a mismatched diagram-type keyword', () => {
    expect(validateMermaid(diagrams.sequenceFlow, 'flowchart')).toBe(false);
  });
});
