import { GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS, embedTexts, type EmbeddingClient } from './embed.js';

function makeClient(overrides: Partial<EmbeddingClient> = {}): EmbeddingClient {
  return {
    embedContent: vi.fn(),
    batchEmbedContents: vi.fn(),
    ...overrides,
  } as EmbeddingClient;
}

describe('embedTexts', () => {
  it('returns embeddings in input order via a single batch call for small inputs', async () => {
    const client = makeClient({
      batchEmbedContents: vi.fn().mockResolvedValue({
        embeddings: [{ values: [1, 2, 3] }, { values: [4, 5, 6] }],
      }),
    });

    const result = await embedTexts(['a', 'b'], client);

    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(client.batchEmbedContents).toHaveBeenCalledTimes(1);
  });

  it('splits large inputs into multiple batch calls of at most EMBEDDING_BATCH_SIZE', async () => {
    const total = EMBEDDING_BATCH_SIZE + 5;
    const texts = Array.from({ length: total }, (_, i) => `text-${i}`);
    const batchEmbedContents = vi.fn().mockImplementation(async (req: { requests: unknown[] }) => ({
      embeddings: req.requests.map(() => ({ values: [1] })),
    }));
    const client = makeClient({ batchEmbedContents });

    const result = await embedTexts(texts, client);

    expect(result).toHaveLength(total);
    expect(batchEmbedContents).toHaveBeenCalledTimes(2);
    expect((batchEmbedContents.mock.calls[0][0] as { requests: unknown[] }).requests).toHaveLength(
      EMBEDDING_BATCH_SIZE
    );
    expect((batchEmbedContents.mock.calls[1][0] as { requests: unknown[] }).requests).toHaveLength(5);
  });

  it('falls back to per-item embedding when the whole batch call fails, without losing good items', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient({
      batchEmbedContents: vi.fn().mockRejectedValue(new Error('batch rejected: item 1 too large')),
      embedContent: vi.fn().mockImplementation(async (text: string) => {
        if (text === 'bad') throw new Error('content blocked');
        return { embedding: { values: [text.length, 0, 0] } };
      }),
    });

    const resultPromise = embedTexts(['good-a', 'bad', 'good-b'], client);
    // Per-item embedding is paced (see SEQUENTIAL_PACING_MS in embed.ts); fast-forward past it.
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([6, 0, 0]); // 'good-a'.length === 6
    expect(result[1]).toEqual(new Array(EMBEDDING_DIMENSIONS).fill(0)); // zero-vector placeholder for the failed item
    expect(result[2]).toEqual([6, 0, 0]); // 'good-b'.length === 6
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('never returns fewer embeddings than inputs, even if every item fails', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient({
      batchEmbedContents: vi.fn().mockRejectedValue(new Error('boom')),
      embedContent: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const resultPromise = embedTexts(['x', 'y', 'z'], client);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

    expect(result).toHaveLength(3);
    for (const vec of result) {
      expect(vec).toEqual(new Array(EMBEDDING_DIMENSIONS).fill(0));
    }
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('resolves to an empty array for empty input without calling the client', async () => {
    const client = makeClient();
    const result = await embedTexts([], client);
    expect(result).toEqual([]);
    expect(client.batchEmbedContents).not.toHaveBeenCalled();
  });

  describe('rate-limit (429) handling', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a 429 with backoff and succeeds, instead of falling back to a zero-vector', async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let attempts = 0;
      const client = makeClient({
        batchEmbedContents: vi.fn().mockRejectedValue(new Error('batch not supported by this model')),
        embedContent: vi.fn().mockImplementation(async () => {
          attempts++;
          if (attempts === 1) {
            throw new GoogleGenerativeAIFetchError('rate limited', 429, 'Too Many Requests');
          }
          return { embedding: { values: [9, 9, 9] } };
        }),
      });

      const resultPromise = embedTexts(['only-item'], client);
      // Let the backoff timer(s) elapse without a real multi-second wait.
      await vi.advanceTimersByTimeAsync(30000);
      const result = await resultPromise;

      expect(result).toEqual([[9, 9, 9]]);
      expect(client.embedContent).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });

    it('does not retry a non-429 error (falls back to zero-vector immediately)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = makeClient({
        batchEmbedContents: vi.fn().mockRejectedValue(new Error('batch not supported by this model')),
        embedContent: vi
          .fn()
          .mockRejectedValue(new GoogleGenerativeAIFetchError('bad request', 400, 'Bad Request')),
      });

      const result = await embedTexts(['x'], client);

      expect(result).toEqual([new Array(EMBEDDING_DIMENSIONS).fill(0)]);
      expect(client.embedContent).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });
});
