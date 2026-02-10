// WIP: Initial module design - gemini-retry.ts
import { GoogleGenerativeAIError, GoogleGenerativeAIFetchError } from '@google/generative-ai';

/**
 * Shared retry policy for calls made through `@google/generative-ai`, used by
 * both `src/rag` (embeddings) and `src/llm` (chat). Discovered empirically by
 * running this tool against a real repo with a real free-tier key: three
 * distinct failure modes showed up that a naive "try once" call cannot
 * survive, and all three are worth retrying because they're transient rather
 * than a property of the request itself:
 *
 *  - HTTP 429 (rate limited) — free-tier embedding quota in particular can be
 *    tight enough that even modest concurrency trips it.
 *  - HTTP 5xx (e.g. 503 "currently experiencing high demand") — a server-side
 *    hiccup on Google's end, not a rejection of the request.
 *  - A bare `GoogleGenerativeAIError` (not the `...FetchError` subclass) —
 *    the SDK wraps the underlying `fetch()` call's own exception in this when
 *    it fails before getting an HTTP response at all (DNS hiccup, TCP reset,
 *    TLS handshake failure, timeout, etc.), which is a network-layer blip,
 *    not a rejection from Gemini.
 *
 * Anything else (a `GoogleGenerativeAIFetchError` with a 4xx status other than
 * 429, a validation error, etc.) is a property of the request and retrying it
 * would just fail the same way again, so it's rethrown immediately.
 */
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 20000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableGeminiError(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    return err.status === 429 || (err.status !== undefined && err.status >= 500 && err.status < 600);
  }
  return err instanceof GoogleGenerativeAIError;
}

/**
 * Retries `fn` with exponential backoff + jitter when it fails with a
 * retryable Gemini error (see `isRetryableGeminiError`); any other error is
 * rethrown immediately.
 */
export async function withGeminiRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableGeminiError(err) || attempt >= MAX_RETRIES) {
        throw err;
      }
      const delayMs = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS) + Math.random() * 1000;
      console.warn(
        `[gemini] ${label} failed (${
          err instanceof Error ? err.message : String(err)
        }); retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(delayMs);
    }
  }
}
