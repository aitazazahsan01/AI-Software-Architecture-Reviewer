import { GoogleGenerativeAIError } from '@google/generative-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureInventory, ChangeProposal, RetrievalResult } from '../types/index.js';
import type { GenerativeContentClient } from './client.js';

const inventory: ArchitectureInventory = {
  repo: { rootPath: '/repo', files: [], projectType: 'node', packageManifests: ['package.json'] },
  dependencyGraph: { nodes: [], edges: [] },
  apiEndpoints: [
    { method: 'GET', path: '/users', handlerFile: 'src/routes/users.ts', handlerLine: 10, framework: 'express' },
  ],
  dataModels: [{ name: 'User', sourceFile: 'src/models/user.ts', fields: [{ name: 'id', type: 'string' }], kind: 'orm-model' }],
};

const proposal: ChangeProposal = { description: 'Add a password reset flow.' };

const retrievedContext: RetrievalResult[] = [
  {
    chunk: { id: 'src/routes/users.ts:1-20', relPath: 'src/routes/users.ts', startLine: 1, endLine: 20, content: 'router.get("/users", handler)' },
    score: 0.9,
  },
];

const validReport = {
  summary: 'Adds a password reset flow touching the auth and user modules.',
  affectedComponents: [{ name: 'AuthService', reason: 'Needs a new reset-token flow' }],
  affectedApis: [{ endpoint: 'GET /users', impact: 'No change to response shape' }],
  databaseChanges: [{ description: 'Add resetToken column to User', migrationNotes: 'Nullable, indexed' }],
  newComponents: [{ name: 'PasswordResetController', purpose: 'Handles reset requests' }],
  scalabilityRisks: [{ risk: 'Email sending under load', severity: 'medium', mitigation: 'Queue emails' }],
  securityConcerns: [{ concern: 'Token brute-forcing', severity: 'high', mitigation: 'Rate limit + expiry' }],
  recommendedSteps: ['Add migration', 'Implement controller', 'Add rate limiting'],
};

function fakeClient(...texts: string[]): GenerativeContentClient {
  let call = 0;
  return {
    generateContent: vi.fn().mockImplementation(async () => {
      const text = texts[Math.min(call, texts.length - 1)];
      call++;
      return { response: { text: () => text } };
    }),
  };
}

describe('generateImpactReport', () => {
  let importedClient: typeof import('./client.js');

  beforeEach(async () => {
    importedClient = await import('./client.js');
  });

  it('parses a valid JSON response on the first attempt', async () => {
    const client = fakeClient(JSON.stringify(validReport));
    const report = await importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client);

    expect(report).toEqual(validReport);
    expect(client.generateContent).toHaveBeenCalledTimes(1);
  });

  it('strips a markdown JSON fence around an otherwise-valid response', async () => {
    const fenced = '```json\n' + JSON.stringify(validReport) + '\n```';
    const client = fakeClient(fenced);
    const report = await importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client);

    expect(report).toEqual(validReport);
    expect(client.generateContent).toHaveBeenCalledTimes(1);
  });

  it('retries once with a stricter prompt when the first response is malformed JSON, and succeeds', async () => {
    const malformed = 'Sure, here is the analysis:\n' + JSON.stringify(validReport) + '\nHope that helps!';
    const client = fakeClient(malformed, JSON.stringify(validReport));

    const report = await importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client);

    expect(report).toEqual(validReport);
    expect(client.generateContent).toHaveBeenCalledTimes(2);
    // The retry prompt should carry a stricter "JSON only" instruction.
    const secondPrompt = (client.generateContent as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondPrompt).toMatch(/only valid json/i);
  });

  it('retries once when the first response fails schema validation (missing required field), and succeeds', async () => {
    const invalidShape = { ...validReport, scalabilityRisks: [{ risk: 'x', mitigation: 'y' }] }; // missing severity
    const client = fakeClient(JSON.stringify(invalidShape), JSON.stringify(validReport));

    const report = await importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client);

    expect(report).toEqual(validReport);
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it('throws a clear error when both attempts fail to produce valid JSON', async () => {
    const client = fakeClient('not json at all', 'still not json');

    await expect(
      importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client)
    ).rejects.toThrow(/did not return JSON matching ArchitectureImpactReport/i);
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it('throws a clear error when both attempts fail schema validation', async () => {
    const invalidShape = { summary: 'only summary present' };
    const client = fakeClient(JSON.stringify(invalidShape), JSON.stringify(invalidShape));

    await expect(
      importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client)
    ).rejects.toThrow(/did not return JSON matching ArchitectureImpactReport/i);
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it('retries a transient network-layer failure (not a malformed-JSON issue) and still succeeds', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let call = 0;
    const client: GenerativeContentClient = {
      generateContent: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) throw new GoogleGenerativeAIError('fetch failed');
        return { response: { text: () => JSON.stringify(validReport) } };
      }),
    };

    const resultPromise = importedClient.generateImpactReport({ proposal, inventory, retrievedContext }, client);
    await vi.advanceTimersByTimeAsync(30000);
    const report = await resultPromise;

    expect(report).toEqual(validReport);
    expect(client.generateContent).toHaveBeenCalledTimes(2); // 1 failed + 1 retried call, no "strict JSON" retry needed
    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('generateImpactReport default client wiring', () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'test-key-not-real';
  });

  afterEach(() => {
    vi.doUnmock('@google/generative-ai');
    vi.resetModules();
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  });

  it('constructs a GoogleGenerativeAI client from config when no client is injected (mocked SDK, no live call)', async () => {
    const generateContent = vi.fn().mockResolvedValue({ response: { text: () => JSON.stringify(validReport) } });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });

    vi.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: vi.fn().mockImplementation(() => ({ getGenerativeModel })),
    }));

    const { generateImpactReport } = await import('./client.js');
    const report = await generateImpactReport({ proposal, inventory, retrievedContext });

    expect(report).toEqual(validReport);
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.any(String) })
    );
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
