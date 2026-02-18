import type {
  ArchitectureImpactReport,
  ArchitectureInventory,
  DataModel,
} from '../types/index.js';
import { escapeLabel, sanitizeId } from './mermaidUtils.js';

function entityNameFor(name: string): string {
  return sanitizeId(name).toUpperCase();
}

/** Best-effort match of a database-change description to a known, structured data model. */
function findMatchingDataModel(description: string, dataModels: DataModel[]): DataModel | undefined {
  const lowerDesc = description.toLowerCase();
  return dataModels.find((dm) => dm.name.length > 0 && lowerDesc.includes(dm.name.toLowerCase()));
}

function sanitizeFieldType(type: string): string {
  const cleaned = type.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'string';
}

function sanitizeFieldName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'field';
}

/**
 * `dataModelDiagram`: a Mermaid `erDiagram`, generated only when
 * `report.databaseChanges` is non-empty. `ArchitectureImpactReport.databaseChanges`
 * is just free text, so each change is matched (by name appearing in its
 * description) against `inventory.dataModels`, which DOES have structured
 * fields, to render a real entity block. When no structured model matches, a
 * generic entity summarizing the change description is rendered instead.
 */
export function buildDataModelDiagram(
  inventory: ArchitectureInventory,
  report: ArchitectureImpactReport
): string | undefined {
  if (report.databaseChanges.length === 0) return undefined;

  const lines: string[] = ['erDiagram'];
  const renderedEntities = new Set<string>();

  report.databaseChanges.forEach((change, i) => {
    const matched = findMatchingDataModel(change.description, inventory.dataModels);

    if (matched) {
      const entityName = entityNameFor(matched.name);
      if (renderedEntities.has(entityName)) return;
      renderedEntities.add(entityName);
      lines.push(`    ${entityName} {`);
      if (matched.fields.length > 0) {
        for (const field of matched.fields) {
          lines.push(`        ${sanitizeFieldType(field.type)} ${sanitizeFieldName(field.name)}`);
        }
      } else {
        lines.push('        string id');
      }
      lines.push('    }');
      return;
    }

    const entityName = `CHANGE_${i}`;
    if (renderedEntities.has(entityName)) return;
    renderedEntities.add(entityName);
    const note = escapeLabel(change.description).slice(0, 60) || 'database change';
    lines.push(`    ${entityName} {`);
    lines.push(`        string description "${note}"`);
    lines.push('    }');
  });

  return lines.join('\n');
}
