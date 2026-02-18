import path from 'node:path';
import type {
  ArchitectureImpactReport,
  ArchitectureInventory,
  DependencyGraph,
} from '../types/index.js';
import { escapeLabel, sanitizeId } from './mermaidUtils.js';

const EXTERNAL_NODE_ID = 'external_dependencies';

/**
 * Groups a repo-relative file path into a "top-level directory" bucket for
 * subgraphing. A raw per-file graph of a real repo is too noisy, so files
 * are grouped: for anything under `src/`, by its immediate child directory
 * (e.g. `src/rag/embed.ts` and `src/rag/utils/foo.ts` both land in the
 * `src/rag` group); for anything else, by its first path segment; and files
 * with no directory at all land in a synthetic `.` (repo root) group.
 */
function groupForPath(relPath: string): string {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return '.';
  if (parts[0] === 'src' && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function nodeIdFor(relPath: string): string {
  return `f_${sanitizeId(relPath)}`;
}

interface BuiltFlowchart {
  lines: string[];
  /** Maps a repo-relative file path to the Mermaid node id rendered for it. */
  nodeIdByPath: Map<string, string>;
}

function buildBaseFlowchart(graph: DependencyGraph): BuiltFlowchart {
  const lines: string[] = ['flowchart LR'];
  const nodeIdByPath = new Map<string, string>();
  const nodeLinesByGroup = new Map<string, string[]>();

  for (const node of graph.nodes) {
    const id = nodeIdFor(node.relPath);
    nodeIdByPath.set(node.relPath, id);
    const group = groupForPath(node.relPath);
    const label = escapeLabel(path.basename(node.relPath));
    const bucket = nodeLinesByGroup.get(group) ?? [];
    bucket.push(`        ${id}["${label}"]`);
    nodeLinesByGroup.set(group, bucket);
  }

  for (const group of [...nodeLinesByGroup.keys()].sort()) {
    const subgraphId = sanitizeId(group);
    lines.push(`    subgraph ${subgraphId}["${escapeLabel(group)}"]`);
    for (const nodeLine of nodeLinesByGroup.get(group) ?? []) lines.push(nodeLine);
    lines.push('    end');
  }

  const seenImportEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'import') continue;
    const fromId = nodeIdByPath.get(edge.from);
    const toId = nodeIdByPath.get(edge.to);
    if (!fromId || !toId) continue;
    const key = `${fromId}-->${toId}`;
    if (seenImportEdges.has(key)) continue;
    seenImportEdges.add(key);
    lines.push(`    ${fromId} --> ${toId}`);
  }

  // Fold every external (npm package) dependency into a single shared node
  // instead of rendering one node per package, which would be pure noise.
  const externalFroms = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'external') continue;
    const fromId = nodeIdByPath.get(edge.from);
    if (fromId) externalFroms.add(fromId);
  }
  if (externalFroms.size > 0) {
    lines.push(`    ${EXTERNAL_NODE_ID}(["External Dependencies"])`);
    for (const fromId of externalFroms) {
      lines.push(`    ${fromId} -.-> ${EXTERNAL_NODE_ID}`);
    }
  }

  return { lines, nodeIdByPath };
}

/** Best-effort match of a free-text component name (from the LLM report) to a known file node. */
function findMatchingPath(name: string, nodeIdByPath: Map<string, string>): string | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;

  for (const relPath of nodeIdByPath.keys()) {
    if (relPath.toLowerCase() === needle) return relPath;
  }
  for (const relPath of nodeIdByPath.keys()) {
    const base = path.basename(relPath).toLowerCase();
    const baseNoExt = base.replace(/\.[^./]+$/, '');
    if (base === needle || baseNoExt === needle) return relPath;
  }
  for (const relPath of nodeIdByPath.keys()) {
    const baseNoExt = path.basename(relPath).replace(/\.[^./]+$/, '').toLowerCase();
    if (relPath.toLowerCase().includes(needle) || needle.includes(baseNoExt)) return relPath;
  }
  return undefined;
}

/** `currentArchitecture`: a flowchart of the repo's dependency graph, grouped into subgraphs by directory. */
export function buildCurrentArchitectureDiagram(inventory: ArchitectureInventory): string {
  const { lines } = buildBaseFlowchart(inventory.dependencyGraph);
  return lines.join('\n');
}

/**
 * `proposedArchitecture`: the same flowchart, plus new nodes for
 * `report.newComponents` and Mermaid `class` styling highlighting both the
 * new components and any `report.affectedComponents` that match an existing
 * file node (falling back to a floating node when no match is found, so the
 * component is still visible even if the LLM named something not present in
 * the static dependency graph).
 */
export function buildProposedArchitectureDiagram(
  inventory: ArchitectureInventory,
  report: ArchitectureImpactReport
): string {
  const { lines, nodeIdByPath } = buildBaseFlowchart(inventory.dependencyGraph);

  const newComponentIds: string[] = [];
  if (report.newComponents.length > 0) {
    lines.push('    subgraph new_components["Proposed New Components"]');
    report.newComponents.forEach((comp, i) => {
      const id = `newc_${i}_${sanitizeId(comp.name)}`;
      newComponentIds.push(id);
      lines.push(`        ${id}["${escapeLabel(comp.name)}"]`);
    });
    lines.push('    end');
  }

  const affectedIds = new Set<string>();
  report.affectedComponents.forEach((comp, i) => {
    const matchedPath = findMatchingPath(comp.name, nodeIdByPath);
    if (matchedPath) {
      affectedIds.add(nodeIdByPath.get(matchedPath) as string);
    } else {
      const id = `aff_${i}_${sanitizeId(comp.name)}`;
      lines.push(`    ${id}["${escapeLabel(comp.name)}"]`);
      affectedIds.add(id);
    }
  });

  if (newComponentIds.length > 0 || affectedIds.size > 0) {
    lines.push('    classDef newComp fill:#d4f8d4,stroke:#2e7d32,stroke-width:2px;');
    lines.push('    classDef affectedComp fill:#fff3cd,stroke:#e6a700,stroke-width:2px;');
    if (newComponentIds.length > 0) {
      lines.push(`    class ${newComponentIds.join(',')} newComp;`);
    }
    if (affectedIds.size > 0) {
      lines.push(`    class ${[...affectedIds].join(',')} affectedComp;`);
    }
  }

  return lines.join('\n');
}
