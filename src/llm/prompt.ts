// WIP: Initial module design - prompt.ts
/**
 * Prompt construction for `generateImpactReport`. Deliberately does NOT dump
 * the full dependency graph (can be hundreds/thousands of nodes+edges) into
 * the prompt — only counts plus the human-readable API/data-model lists, per
 * the module contract in docs/ARCHITECTURE.md. The actual code context comes
 * from the RAG-retrieved chunks, which are the parts of the graph most
 * relevant to this specific proposal.
 */
import type { ArchitectureInventory, ChangeProposal, RetrievalResult } from '../types/index.js';

const RESPONSE_SHAPE_HINT = `{
  "summary": string,
  "affectedComponents": [{ "name": string, "reason": string }],
  "affectedApis": [{ "endpoint": string, "impact": string }],
  "databaseChanges": [{ "description": string, "migrationNotes": string }],
  "newComponents": [{ "name": string, "purpose": string }],
  "scalabilityRisks": [{ "risk": string, "severity": "low" | "medium" | "high", "mitigation": string }],
  "securityConcerns": [{ "concern": string, "severity": "low" | "medium" | "high", "mitigation": string }],
  "recommendedSteps": [string]
}`;

function summarizeInventory(inventory: ArchitectureInventory): string {
  const { repo, dependencyGraph, apiEndpoints, dataModels } = inventory;

  const apiList = apiEndpoints.length
    ? apiEndpoints
        .map((e) => `- ${e.method} ${e.path} -> ${e.handlerFile}:${e.handlerLine} (${e.framework})`)
        .join('\n')
    : '(none detected)';

  const modelList = dataModels.length
    ? dataModels
        .map(
          (m) =>
            `- ${m.name} [${m.kind}] (${m.sourceFile}): ${m.fields.map((f) => `${f.name}: ${f.type}`).join(', ') || '(no fields detected)'}`
        )
        .join('\n')
    : '(none detected)';

  return [
    `Project type: ${repo.projectType}`,
    `Files scanned: ${repo.files.length}`,
    `Dependency graph: ${dependencyGraph.nodes.length} components, ${dependencyGraph.edges.length} dependency edges`,
    '',
    'API endpoints:',
    apiList,
    '',
    'Data models:',
    modelList,
  ].join('\n');
}

function formatRetrievedContext(results: RetrievalResult[]): string {
  if (results.length === 0) return '(no relevant code chunks retrieved)';
  return results
    .map(
      (r, i) =>
        `[Chunk ${i + 1}] ${r.chunk.relPath}:${r.chunk.startLine}-${r.chunk.endLine} (similarity ${r.score.toFixed(3)})\n\`\`\`\n${r.chunk.content}\n\`\`\``
    )
    .join('\n\n');
}

export interface GenerateImpactReportParams {
  proposal: ChangeProposal;
  inventory: ArchitectureInventory;
  retrievedContext: RetrievalResult[];
}

/**
 * Builds the single prompt sent to Gemini. When `strict` is true, appends an
 * extra instruction used on the retry after a parse/validation failure.
 */
export function buildImpactReportPrompt(params: GenerateImpactReportParams, strict = false): string {
  const { proposal, inventory, retrievedContext } = params;

  const strictSuffix = strict
    ? '\n\nIMPORTANT: Your previous response could not be parsed as valid JSON. Return ONLY valid JSON, ' +
      'with no markdown code fences, no commentary, and no explanation before or after the JSON object.'
    : '';

  return `You are a senior software architect reviewing a proposed change to an existing codebase.

## Proposed change
${proposal.description}

## Current architecture summary
${summarizeInventory(inventory)}

## Relevant existing code (retrieved via similarity search against the proposal)
${formatRetrievedContext(retrievedContext)}

## Task
Analyze the impact of the proposed change on this codebase: which existing components/APIs/data
structures are affected, what new components are likely needed, scalability risks, security
concerns, and recommended implementation steps.

Respond with ONLY a single JSON object matching exactly this shape (no extra top-level fields,
no trailing commentary):
${RESPONSE_SHAPE_HINT}${strictSuffix}`;
}
