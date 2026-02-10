// WIP: Initial module design - gemini-retry.test.ts
import { GoogleGenerativeAIError, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRetryableGeminiError, withGeminiRetry } from './gemini-retry.js';

describe('isRetryableGeminiError', () => {
  it('is retryable for a 429 GoogleGenerativeAIFetchError', () => {
    expect(isRetryableGeminiError(new GoogleGenerativeAIFetchError('rate limited', 429, 'Too Many Requests'))).toBe(
      true
    );
  });

  it('is not retryable for a non-429, non-5xx GoogleGenerativeAIFetchError (e.g. 400/404)', () => {
    expect(isRetryableGeminiError(new GoogleGenerativeAIFetchError('bad request', 400, 'Bad Request'))).toBe(false);
    expect(isRetryableGeminiError(new GoogleGenerativeAIFetchError('not found', 404, 'Not Found'))).toBe(false);
  });

  it('is retryable for a 5xx GoogleGenerativeAIFetchError (e.g. 503 "high demand")', () => {
    expect(isRetryableGeminiError(new GoogleGenerativeAIFetchError('unavailable', 503, 'Service Unavailable'))).toBe(
      true
    );
    expect(isRetryableGeminiError(new GoogleGenerativeAIFetchError('server error', 500, 'Internal Server Error'))).toBe(
      true
    );
  });

  it('is retryable for a bare GoogleGenerativeAIError (network-layer failure, no HTTP response)', () => {
    expect(isRetryableGeminiError(new GoogleGenerativeAIError('fetch failed'))).toBe(true);
  });

  it('is not retryable for an unrelated error', () => {
    expect(isRetryableGeminiError(new Error('some other failure'))).toBe(false);
    expect(isRetryableGeminiError('not even an Error')).toBe(false);
  });
});

describe('withGeminiRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a retryable error and returns the eventual success', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new GoogleGenerativeAIError('fetch failed');
      return 'ok';
    });

    const resultPromise = withGeminiRetry(fn, 'testOp');
    await vi.advanceTimersByTimeAsync(60000);
    const result = await resultPromise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
  });

  it('rethrows immediately for a non-retryable error, without waiting', async () => {
    const fn = vi.fn().mockRejectedValue(new GoogleGenerativeAIFetchError('bad request', 400, 'Bad Request'));

    await expect(withGeminiRetry(fn, 'testOp')).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up and rethrows after exhausting retries on a persistently retryable error', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(new GoogleGenerativeAIFetchError('rate limited', 429, 'Too Many Requests'));

    const resultPromise = withGeminiRetry(fn, 'testOp').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120000);
    const result = await resultPromise;

    expect(result).toBeInstanceOf(GoogleGenerativeAIFetchError);
    expect(fn.mock.calls.length).toBeGreaterThan(1);
    warnSpy.mockRestore();
  });
});
