import { createHash } from 'node:crypto';
import path from 'node:path';
import { scanRepo, chunkFiles } from '../ingestion/index.js';
import {
  buildDependencyGraph,
  extractApiEndpoints,
  extractDataModels,
} from '../dependency-graph/index.js';
import { VectorStore } from '../rag/index.js';
import { generateImpactReport } from '../llm/index.js';
import { generateDiagrams } from '../diagrams/index.js';
import { renderMarkdownReport, renderHtmlViewer, writeReportToDisk } from '../report/index.js';
import { RAG_TOP_K, CACHE_DIR, loadConfig } from '../config/index.js';
import type { ArchitectureInventory, AnalysisResult, ChangeProposal } from '../types/index.js';

export interface AnalyzeOptions {
  repoPath: string;
  proposalText: string;
  outDir: string;
}

export type AnalyzeStage =
  | 'config'
  | 'scan'
  | 'analyze'
  | 'embed'
  | 'retrieve'
  | 'llm'
  | 'diagrams'
  | 'report'
  | 'done';

export interface AnalyzeProgressEvent {
  stage: AnalyzeStage;
  message: string;
}

export type OnAnalyzeProgress = (event: AnalyzeProgressEvent) => void;

export interface AnalyzeOutcome {
  mdPath: string;
  htmlPath: string;
  markdown: string;
  html: string;
  result: AnalysisResult;
}

export interface AnalyzeDependencies {
  loadConfig: typeof loadConfig;
  scanRepo: typeof scanRepo;
  chunkFiles: typeof chunkFiles;
  buildDependencyGraph: typeof buildDependencyGraph;
  extractApiEndpoints: typeof extractApiEndpoints;
  extractDataModels: typeof extractDataModels;
  createVectorStore: () => VectorStore;
  generateImpactReport: typeof generateImpactReport;
  generateDiagrams: typeof generateDiagrams;
  renderMarkdownReport: typeof renderMarkdownReport;
  renderHtmlViewer: typeof renderHtmlViewer;
  writeReportToDisk: typeof writeReportToDisk;
}

const defaultDependencies: AnalyzeDependencies = {
  loadConfig,
  scanRepo,
  chunkFiles,
  buildDependencyGraph,
  extractApiEndpoints,
  extractDataModels,
  createVectorStore: () => new VectorStore(),
  generateImpactReport,
  generateDiagrams,
  renderMarkdownReport,
  renderHtmlViewer,
  writeReportToDisk,
};

/** Stable per-repo cache filename so re-running against the same repo reuses embeddings (see VectorStore's incremental upsert). */
function cachePathFor(repoPath: string): string {
  const hash = createHash('sha256').update(path.resolve(repoPath)).digest('hex').slice(0, 16);
  return path.join(process.cwd(), CACHE_DIR, `${hash}.sqlite`);
}

/**
 * Orchestrates the full pipeline: ingest -> statically analyze -> embed/retrieve
 * -> ask Gemini for the impact report -> diagram -> write the Markdown + HTML report.
 * `deps` is injectable so this can be tested without live Gemini calls or a real repo.
 */
export async function runAnalyze(
  options: AnalyzeOptions,
  deps: AnalyzeDependencies = defaultDependencies,
  onProgress: OnAnalyzeProgress = () => {}
): Promise<AnalyzeOutcome> {
  onProgress({ stage: 'config', message: 'Checking configuration...' });
  // Fail fast on a missing/invalid GEMINI_API_KEY before spending time
  // scanning and statically analyzing a potentially large repo.
  deps.loadConfig();

  const repoPath = path.resolve(options.repoPath);

  onProgress({ stage: 'scan', message: `Scanning ${repoPath}...` });
  const repo = await deps.scanRepo(repoPath);
  if (repo.files.length === 0) {
    throw new Error(
      `No files found under "${repoPath}". Check the --repo path and that it isn't entirely covered by .gitignore.`
    );
  }

  const chunks = deps.chunkFiles(repo);

  onProgress({
    stage: 'analyze',
    message: `Analyzing dependencies, APIs, and data models across ${repo.files.length} files...`,
  });
  const [dependencyGraph, apiEndpoints, dataModels] = await Promise.all([
    deps.buildDependencyGraph(repo),
    deps.extractApiEndpoints(repo),
    deps.extractDataModels(repo),
  ]);

  const inventory: ArchitectureInventory = {
    repo,
    dependencyGraph,
    apiEndpoints,
    dataModels,
  };

  const store = deps.createVectorStore();
  store.init(cachePathFor(repoPath));
  let retrievedContext;
  try {
    onProgress({
      stage: 'embed',
      message: `Embedding ${chunks.length} code chunks (cached chunks are skipped; free-tier quota may pace this)...`,
    });
    await store.upsertChunks(chunks);
    onProgress({ stage: 'retrieve', message: 'Finding the code most relevant to your proposal...' });
    retrievedContext = await store.query(options.proposalText, RAG_TOP_K);
  } finally {
    store.close();
  }

  const proposal: ChangeProposal = { description: options.proposalText };

  onProgress({ stage: 'llm', message: 'Asking Gemini to analyze the architectural impact...' });
  const report = await deps.generateImpactReport({
    proposal,
    inventory,
    retrievedContext,
  });

  onProgress({ stage: 'diagrams', message: 'Generating architecture diagrams...' });
  const diagrams = deps.generateDiagrams(inventory, report);

  const result: AnalysisResult = {
    inventory,
    proposal,
    retrievedContext,
    report,
    diagrams,
  };

  onProgress({ stage: 'report', message: 'Writing the report...' });
  const markdown = deps.renderMarkdownReport(result);
  const html = deps.renderHtmlViewer(markdown, diagrams);
  const { mdPath, htmlPath } = await deps.writeReportToDisk(options.outDir, markdown, html);

  onProgress({ stage: 'done', message: 'Analysis complete.' });
  return { mdPath, htmlPath, markdown, html, result };
}
