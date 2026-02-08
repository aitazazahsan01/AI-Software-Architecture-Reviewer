// WIP: Initial module design - index.ts
/**
 * Shared data contracts between all modules. Every module (ingestion,
 * dependency-graph, rag, llm, diagrams, report) reads/writes these shapes.
 * Treat this file as the integration contract: implementations may change
 * freely, but the exported shapes here should stay stable so modules built
 * in parallel compose without modification.
 */

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'json'
  | 'markdown'
  | 'other';

export interface FileInfo {
  relPath: string;
  absPath: string;
  language: Language;
  sizeBytes: number;
}

export type ProjectType = 'node' | 'python' | 'mixed' | 'unknown';

export interface RepoInventory {
  rootPath: string;
  files: FileInfo[];
  projectType: ProjectType;
  /** Paths (relative to rootPath) of manifest files found, e.g. package.json */
  packageManifests: string[];
}

export interface CodeChunk {
  /** Stable id derived from relPath + line range, e.g. "src/foo.ts:1-120" */
  id: string;
  relPath: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface DependencyNode {
  id: string; // relPath, used as the graph key
  relPath: string;
  exports: string[];
}

export interface DependencyEdge {
  from: string; // relPath of the importing file
  to: string; // relPath of the resolved local file, or the raw specifier for externals
  kind: 'import' | 'external';
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface ApiEndpoint {
  method: string; // GET | POST | PUT | DELETE | PATCH | ...
  path: string;
  handlerFile: string; // relPath
  handlerLine: number;
  framework: string; // express | fastify | koa | ...
}

export interface DataModel {
  name: string;
  sourceFile: string; // relPath
  fields: { name: string; type: string }[];
  kind: 'orm-model' | 'sql-table' | 'schema';
}

export interface ArchitectureInventory {
  repo: RepoInventory;
  dependencyGraph: DependencyGraph;
  apiEndpoints: ApiEndpoint[];
  dataModels: DataModel[];
}

export interface RetrievalResult {
  chunk: CodeChunk;
  score: number;
}

export interface ChangeProposal {
  /** Free-text description of the feature/change being proposed, from the user */
  description: string;
}

export type Severity = 'low' | 'medium' | 'high';

export interface ArchitectureImpactReport {
  summary: string;
  affectedComponents: { name: string; reason: string }[];
  affectedApis: { endpoint: string; impact: string }[];
  databaseChanges: { description: string; migrationNotes: string }[];
  newComponents: { name: string; purpose: string }[];
  scalabilityRisks: { risk: string; severity: Severity; mitigation: string }[];
  securityConcerns: { concern: string; severity: Severity; mitigation: string }[];
  recommendedSteps: string[];
}

export interface DiagramSet {
  /** Mermaid source for the current architecture (component/dependency view) */
  currentArchitecture: string;
  /** Mermaid source for the proposed architecture, highlighting new/changed parts */
  proposedArchitecture: string;
  /** Mermaid sequence diagram for the new feature's primary flow */
  sequenceFlow: string;
  /** Optional Mermaid ER diagram when databaseChanges is non-empty */
  dataModelDiagram?: string;
}

export interface AnalysisResult {
  inventory: ArchitectureInventory;
  proposal: ChangeProposal;
  retrievedContext: RetrievalResult[];
  report: ArchitectureImpactReport;
  diagrams: DiagramSet;
}
