// WIP: Initial module design - analyze.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runAnalyze, type AnalyzeDependencies } from './analyze.js';
import type {
  ArchitectureImpactReport,
  DiagramSet,
  RepoInventory,
  RetrievalResult,
} from '../types/index.js';

function buildFakeDeps(overrides: Partial<AnalyzeDependencies> = {}): {
  deps: AnalyzeDependencies;
  calls: Record<string, unknown[]>;
  report: ArchitectureImpactReport;
  diagrams: DiagramSet;
} {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, arg: unknown) => {
    calls[name] = calls[name] ?? [];
    calls[name].push(arg);
  };

  const repo: RepoInventory = {
    rootPath: '/fake/repo',
    files: [{ relPath: 'src/index.ts', absPath: '/fake/repo/src/index.ts', language: 'typescript', sizeBytes: 42 }],
    projectType: 'node',
    packageManifests: ['package.json'],
  };

  const report: ArchitectureImpactReport = {
    summary: 'fake summary',
    affectedComponents: [],
    affectedApis: [],
    databaseChanges: [],
    newComponents: [],
    scalabilityRisks: [],
    securityConcerns: [],
    recommendedSteps: [],
  };

  const diagrams: DiagramSet = {
    currentArchitecture: 'flowchart LR\n  A --> B',
    proposedArchitecture: 'flowchart LR\n  A --> B',
    sequenceFlow: 'sequenceDiagram\n  A->>B: hi',
  };

  const retrievalResults: RetrievalResult[] = [];

  const fakeStore = {
    init: vi.fn((dbPath: string) => record('init', dbPath)),
    upsertChunks: vi.fn(async (chunks: unknown) => record('upsertChunks', chunks)),
    query: vi.fn(async (queryText: string) => {
      record('query', queryText);
      return retrievalResults;
    }),
    close: vi.fn(() => record('close', undefined)),
  };

  const deps: AnalyzeDependencies = {
    loadConfig: vi.fn(() => {
      record('loadConfig', undefined);
      return { geminiApiKey: 'fake-key', geminiModel: 'fake-model', geminiEmbeddingModel: 'fake-embedding-model' };
    }),
    scanRepo: vi.fn(async (rootPath: string) => {
      record('scanRepo', rootPath);
      return repo;
    }),
    chunkFiles: vi.fn((inv) => {
      record('chunkFiles', inv);
      return [{ id: 'src/index.ts:1-1', relPath: 'src/index.ts', startLine: 1, endLine: 1, content: 'x' }];
    }),
    buildDependencyGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
    extractApiEndpoints: vi.fn(async () => []),
    extractDataModels: vi.fn(async () => []),
    createVectorStore: vi.fn(() => fakeStore as never),
    generateImpactReport: vi.fn(async (params) => {
      record('generateImpactReport', params);
      return report;
    }),
    generateDiagrams: vi.fn((inv, rep) => {
      record('generateDiagrams', { inv, rep });
      return diagrams;
    }),
    renderMarkdownReport: vi.fn((result) => {
      record('renderMarkdownReport', result);
      return '# fake markdown';
    }),
    renderHtmlViewer: vi.fn((markdown) => {
      record('renderHtmlViewer', markdown);
      return '<html></html>';
    }),
    writeReportToDisk: vi.fn(async (outDir: string) => {
      record('writeReportToDisk', outDir);
      return { mdPath: `${outDir}/report.md`, htmlPath: `${outDir}/report.html` };
    }),
    ...overrides,
  };

  return { deps, calls, report, diagrams };
}

describe('runAnalyze', () => {
  it('orchestrates the full pipeline in order and returns the written report paths', async () => {
    const { deps, calls, report, diagrams } = buildFakeDeps();

    const progressEvents: { stage: string; message: string }[] = [];
    const result = await runAnalyze(
      { repoPath: '/fake/repo', proposalText: 'add a chat feature', outDir: './output' },
      deps,
      (event) => progressEvents.push(event)
    );

    expect(result.mdPath).toBe('./output/report.md');
    expect(result.htmlPath).toBe('./output/report.html');
    expect(result.markdown).toBe('# fake markdown');
    expect(result.html).toBe('<html></html>');
    expect(result.result.report).toEqual(report);
    expect(result.result.diagrams).toEqual(diagrams);

    // Progress fires in pipeline order and ends with "done".
    expect(progressEvents.map((e) => e.stage)).toEqual([
      'config',
      'scan',
      'analyze',
      'embed',
      'retrieve',
      'llm',
      'diagrams',
      'report',
      'done',
    ]);

    expect(deps.scanRepo).toHaveBeenCalledTimes(1);
    expect(calls.scanRepo[0]).toEqual(expect.stringContaining('fake'));
    expect(deps.chunkFiles).toHaveBeenCalledTimes(1);
    expect(deps.buildDependencyGraph).toHaveBeenCalledTimes(1);
    expect(deps.extractApiEndpoints).toHaveBeenCalledTimes(1);
    expect(deps.extractDataModels).toHaveBeenCalledTimes(1);

    expect(calls.query).toEqual(['add a chat feature']);
    expect(deps.generateImpactReport).toHaveBeenCalledTimes(1);
    expect(deps.generateDiagrams).toHaveBeenCalledTimes(1);
    expect(deps.renderMarkdownReport).toHaveBeenCalledTimes(1);
    expect(deps.renderHtmlViewer).toHaveBeenCalledTimes(1);
    expect(deps.writeReportToDisk).toHaveBeenCalledTimes(1);

    // upsert/query must happen between init and close, and close must always run
    expect(calls.init).toHaveLength(1);
    expect(calls.upsertChunks).toHaveLength(1);
    expect(calls.close).toHaveLength(1);
  });

  it('closes the vector store even if generateImpactReport throws', async () => {
    const { deps, calls } = buildFakeDeps({
      generateImpactReport: vi.fn(async () => {
        throw new Error('gemini exploded');
      }),
    });

    await expect(
      runAnalyze({ repoPath: '/fake/repo', proposalText: 'x', outDir: './output' }, deps)
    ).rejects.toThrow('gemini exploded');

    expect(calls.close).toHaveLength(1);
  });

  it('throws a clear error when the repo has no files', async () => {
    const { deps } = buildFakeDeps({
      scanRepo: vi.fn(async () => ({
        rootPath: '/fake/empty',
        files: [],
        projectType: 'unknown',
        packageManifests: [],
      })),
    });

    await expect(
      runAnalyze({ repoPath: '/fake/empty', proposalText: 'x', outDir: './output' }, deps)
    ).rejects.toThrow(/No files found/);
  });

  it('validates config before doing any repo scanning or analysis work', async () => {
    const { deps } = buildFakeDeps({
      loadConfig: vi.fn(() => {
        throw new Error('Missing GEMINI_API_KEY');
      }),
    });

    await expect(
      runAnalyze({ repoPath: '/fake/repo', proposalText: 'x', outDir: './output' }, deps)
    ).rejects.toThrow('Missing GEMINI_API_KEY');

    expect(deps.scanRepo).not.toHaveBeenCalled();
  });
});
