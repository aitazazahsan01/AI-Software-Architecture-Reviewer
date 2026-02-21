import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from './server.js';
import type { AnalyzeOutcome, OnAnalyzeProgress } from '../cli/analyze.js';
import type { ArchitectureImpactReport } from '../types/index.js';

const fakeReport: ArchitectureImpactReport = {
  summary: 'fake summary',
  affectedComponents: [],
  affectedApis: [],
  databaseChanges: [],
  newComponents: [],
  scalabilityRisks: [],
  securityConcerns: [],
  recommendedSteps: [],
};

const fakeOutcome: AnalyzeOutcome = {
  mdPath: '/out/report.md',
  htmlPath: '/out/report.html',
  markdown: '# fake',
  html: '<html></html>',
  result: {
    inventory: {
      repo: { rootPath: '/repo', files: [], projectType: 'node', packageManifests: [] },
      dependencyGraph: { nodes: [], edges: [] },
      apiEndpoints: [],
      dataModels: [],
    },
    proposal: { description: 'test proposal' },
    retrievedContext: [],
    report: fakeReport,
    diagrams: { currentArchitecture: 'flowchart LR\n  A', proposedArchitecture: 'flowchart LR\n  A', sequenceFlow: 'sequenceDiagram\n  A->>B: hi' },
  },
};

describe('GET /', () => {
  it('serves the frontend index.html', async () => {
    const app = createServer();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Architecture Reviewer');
  });
});

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const app = createServer();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('GET /api/analyze', () => {
  it('rejects with 400 when repo or proposal is missing', async () => {
    const app = createServer({ runAnalyzeFn: vi.fn() });

    const missingBoth = await request(app).get('/api/analyze');
    expect(missingBoth.status).toBe(400);

    const missingProposal = await request(app).get('/api/analyze').query({ repo: '/some/repo' });
    expect(missingProposal.status).toBe(400);

    const missingRepo = await request(app).get('/api/analyze').query({ proposal: 'add a thing' });
    expect(missingRepo.status).toBe(400);
  });

  it('streams progress events then a result event on success', async () => {
    const runAnalyzeFn = vi.fn(async (_options, _deps, onProgress?: OnAnalyzeProgress) => {
      onProgress?.({ stage: 'scan', message: 'Scanning...' });
      onProgress?.({ stage: 'done', message: 'Analysis complete.' });
      return fakeOutcome;
    });
    const app = createServer({ runAnalyzeFn: runAnalyzeFn as never });

    const res = await request(app).get('/api/analyze').query({ repo: '/some/repo', proposal: 'add a thing' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('"stage":"scan"');
    expect(res.text).toContain('event: result');
    expect(res.text).toContain('"mdPath":"/out/report.md"');
    expect(runAnalyzeFn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: '/some/repo', proposalText: 'add a thing' }),
      undefined,
      expect.any(Function)
    );
  });

  it('streams a failure event (not "error") when the analysis throws', async () => {
    const runAnalyzeFn = vi.fn().mockRejectedValue(new Error('Missing GEMINI_API_KEY'));
    const app = createServer({ runAnalyzeFn: runAnalyzeFn as never });

    const res = await request(app).get('/api/analyze').query({ repo: '/some/repo', proposal: 'add a thing' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: failure');
    expect(res.text).toContain('Missing GEMINI_API_KEY');
    // Must not use the bare "event: error" name — EventSource reserves that
    // for connection failures, so a same-named custom event would be
    // indistinguishable from a dropped connection on the client.
    expect(res.text).not.toMatch(/^event: error$/m);
  });

  it('passes the optional "out" query param through as outDir', async () => {
    const runAnalyzeFn = vi.fn().mockResolvedValue(fakeOutcome);
    const app = createServer({ runAnalyzeFn: runAnalyzeFn as never });

    await request(app).get('/api/analyze').query({ repo: '/some/repo', proposal: 'x' });
    const firstCallOptions = runAnalyzeFn.mock.calls[0][0];
    expect(firstCallOptions.outDir).toEqual(expect.stringContaining('.arch-review-web-output'));
  });
});
