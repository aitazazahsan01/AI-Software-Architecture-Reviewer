/**
 * Thin wrapper around Gemini's embedding endpoint (`gemini-embedding-001` by
 * default, see `GEMINI_EMBEDDING_MODEL`). Note: this model does not support
 * `batchEmbedContents` (only `embedContent`/`asyncBatchEmbedContent`), so the
 * per-batch call below always fails over to the sequential per-item path —
 * expected, not a bug; see the `embedTexts` batch-failure comment.
 *
 * Design decision (documented per the module contract): `embedTexts` ALWAYS
 * resolves to an array whose length equals `texts.length`, in the same
 * order. Callers (`VectorStore` in particular) zip embeddings back to their
 * source texts/chunks by index, so silently dropping a failed item would
 * misalign every embedding after it. Instead, any text that fails to embed
 * (oversized chunk, transient API error, safety block, etc.) is represented
 * by an all-zero vector of `EMBEDDING_DIMENSIONS` length, and a warning is
 * logged with enough context to find the offending text.
 *
 * A zero-vector is a safe sentinel here because:
 *  - Real Gemini embeddings are dense floating point vectors that are
 *    essentially never exactly all-zero.
 *  - Cosine similarity against an all-zero vector is defined as 0 by our
 *    `cosineSimilarity` (avoids NaN from a zero-length vector), so a failed
 *    embedding can never win a similarity ranking — it just quietly never
 *    surfaces as a retrieval result instead of corrupting the ranking.
 *  - `VectorStore.upsertChunks` additionally detects the all-zero sentinel
 *    and skips persisting those rows entirely, so failed chunks don't even
 *    take up space in the index (see store.ts).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { loadConfig } from '../config/index.js';
import { withGeminiRetry } from '../config/gemini-retry.js';

/** Output size of `gemini-embedding-001` (default dimensionality). Used only to build the zero-vector placeholder. */
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * Conservative batch size for `batchEmbedContents`. Gemini's batch embedding
 * endpoint caps the number of requests per call at 100; chunking client-side
 * keeps us under that regardless of how many texts are passed in.
 */
export const EMBEDDING_BATCH_SIZE = 100;

/**
 * Max number of concurrent single-item embed calls when falling back from a
 * failed batch. Live-testing against a real free-tier key showed
 * `gemini-embedding-001`'s free quota is tight enough (a handful of requests
 * per minute) that any concurrency just produces more simultaneous 429s, so
 * this is serial by default; `withGeminiRetry` (src/config/gemini-retry.ts)
 * and `SEQUENTIAL_PACING_MS` below are what actually make progress under
 * that cap.
 */
const SEQUENTIAL_CONCURRENCY = 1;

/**
 * Fixed delay between successive per-item embed calls — a proactive throttle
 * (rather than only reacting to a 429 after the fact) to spread requests out
 * under a tight free-tier per-minute quota. Cheap insurance: negligible cost
 * for a well-provisioned key, meaningfully fewer 429s for a tight one.
 */
const SEQUENTIAL_PACING_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal surface of `GenerativeModel` that embedTexts depends on — kept narrow so tests can inject a fake without touching `@google/generative-ai`. */
export interface EmbeddingClient {
  embedContent(request: string): Promise<{ embedding: { values: number[] } }>;
  batchEmbedContents(request: {
    requests: { content: { role: string; parts: { text: string }[] } }[];
  }): Promise<{ embeddings: { values: number[] }[] }>;
}

let cachedClient: EmbeddingClient | undefined;

function getDefaultEmbeddingClient(): EmbeddingClient {
  if (!cachedClient) {
    const config = loadConfig();
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    cachedClient = genAI.getGenerativeModel({
      model: config.geminiEmbeddingModel,
    }) as unknown as EmbeddingClient;
  }
  return cachedClient;
}

function zeroVector(): number[] {
  return new Array(EMBEDDING_DIMENSIONS).fill(0);
}

/** Embeds a slice of `texts` one-by-one with a small concurrency limit, writing results (or zero-vector placeholders on failure) into `out` at `indices[i]`. */
async function embedSequentially(
  texts: string[],
  indices: number[],
  client: EmbeddingClient,
  out: number[][]
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < texts.length) {
      const i = cursor++;
      if (i > 0) await sleep(SEQUENTIAL_PACING_MS);
      try {
        const response = await withGeminiRetry(() => client.embedContent(texts[i]), 'embedContent');
        out[indices[i]] = response.embedding.values;
      } catch (err) {
        console.warn(
          `[rag] failed to embed item at index ${indices[i]} (length ${texts[i]?.length ?? 0} chars); ` +
            `using zero-vector placeholder so index alignment is preserved. Reason: ${
              err instanceof Error ? err.message : String(err)
            }`
        );
        out[indices[i]] = zeroVector();
      }
    }
  };
  const workers = Array.from({ length: Math.min(SEQUENTIAL_CONCURRENCY, texts.length) }, () => worker());
  await Promise.all(workers);
}

/**
 * Embeds `texts` via Gemini's embedding model, batched for efficiency.
 * See the file-level comment for the error-handling contract: the returned
 * array always has the same length as `texts`, with zero-vector placeholders
 * standing in for anything that failed to embed.
 *
 * `client` is injectable for tests; production callers should omit it and
 * let a lazily-constructed real Gemini client be used.
 */
export async function embedTexts(
  texts: string[],
  client: EmbeddingClient = getDefaultEmbeddingClient()
): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);

  for (let batchStart = 0; batchStart < texts.length; batchStart += EMBEDDING_BATCH_SIZE) {
    const batchTexts = texts.slice(batchStart, batchStart + EMBEDDING_BATCH_SIZE);
    const batchIndices = batchTexts.map((_, i) => batchStart + i);

    try {
      const response = await withGeminiRetry(
        () =>
          client.batchEmbedContents({
            requests: batchTexts.map((text) => ({
              content: { role: 'user', parts: [{ text }] },
            })),
          }),
        'batchEmbedContents'
      );
      if (response.embeddings.length !== batchTexts.length) {
        // Defensive: a mismatched response length would silently misalign
        // everything downstream, so treat it the same as a batch failure.
        throw new Error(
          `batchEmbedContents returned ${response.embeddings.length} embeddings for ${batchTexts.length} inputs`
        );
      }
      response.embeddings.forEach((embedding, i) => {
        results[batchIndices[i]] = embedding.values;
      });
    } catch (batchErr) {
      // The whole-batch call failed — commonly because one item in the batch
      // was oversized/malformed/blocked. A single bad item must not sink the
      // other N-1 good ones, so fall back to embedding this batch's items
      // individually (small concurrency limit, not full parallelism, to be
      // gentle on free-tier rate limits).
      console.warn(
        `[rag] batchEmbedContents failed for a batch of ${batchTexts.length} texts, falling back to ` +
          `per-item embedding: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`
      );
      await embedSequentially(batchTexts, batchIndices, client, results);
    }
  }

  return results;
}
