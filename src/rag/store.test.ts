import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeChunk } from '../types/index.js';

// VectorStore embeds via `embedTexts` (imported from ./embed.js). We mock
// that module so tests control exactly which embedding vector each chunk
// gets, without touching the real Gemini client or making any network call.
const { embedTextsMock } = vi.hoisted(() => ({ embedTextsMock: vi.fn() }));
vi.mock('./embed.js', () => ({
  embedTexts: embedTextsMock,
}));

const { VectorStore } = await import('./store.js');

describe('VectorStore', () => {
  let dbPath: string;
  let store: InstanceType<typeof VectorStore>;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `arch-review-vector-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    store = new VectorStore();
    store.init(dbPath);
    embedTextsMock.mockReset();
  });

  afterEach(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.rmSync(p);
    }
  });

  it('throws if used before init()', async () => {
    const fresh = new VectorStore();
    await expect(fresh.query('x')).rejects.toThrow(/init/);
  });

  it('embeds and persists new chunks, then skips re-embedding unchanged content on a later upsert', async () => {
    const chunks: CodeChunk[] = [
      { id: 'a.ts:1-10', relPath: 'a.ts', startLine: 1, endLine: 10, content: 'function a() {}' },
      { id: 'b.ts:1-10', relPath: 'b.ts', startLine: 1, endLine: 10, content: 'function b() {}' },
    ];
    embedTextsMock.mockResolvedValueOnce([
      [1, 0, 0],
      [0, 1, 0],
    ]);

    await store.upsertChunks(chunks);
    expect(embedTextsMock).toHaveBeenCalledTimes(1);
    expect(embedTextsMock).toHaveBeenCalledWith(['function a() {}', 'function b() {}']);

    // Same ids, identical content -> incremental cache should skip re-embedding entirely.
    await store.upsertChunks(chunks);
    expect(embedTextsMock).toHaveBeenCalledTimes(1);
  });

  it('re-embeds only chunks whose content changed', async () => {
    const original: CodeChunk = { id: 'a.ts:1-10', relPath: 'a.ts', startLine: 1, endLine: 10, content: 'v1' };
    embedTextsMock.mockResolvedValueOnce([[1, 0, 0]]);
    await store.upsertChunks([original]);

    const changed: CodeChunk = { ...original, content: 'v2' };
    embedTextsMock.mockResolvedValueOnce([[0, 1, 0]]);
    await store.upsertChunks([changed]);

    expect(embedTextsMock).toHaveBeenCalledTimes(2);
    expect(embedTextsMock).toHaveBeenLastCalledWith(['v2']);

    // Confirm the stored embedding was actually updated, not left stale, by
    // querying with a vector that only matches the new embedding.
    embedTextsMock.mockResolvedValueOnce([[0, 1, 0]]);
    const results = await store.query('anything', 5);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('ranks query results by descending cosine similarity and respects k', async () => {
    const chunks: CodeChunk[] = [
      { id: 'x.ts:1-5', relPath: 'x.ts', startLine: 1, endLine: 5, content: 'auth login handler' },
      { id: 'y.ts:1-5', relPath: 'y.ts', startLine: 1, endLine: 5, content: 'payment processing' },
      { id: 'z.ts:1-5', relPath: 'z.ts', startLine: 1, endLine: 5, content: 'unrelated logging util' },
    ];
    embedTextsMock.mockResolvedValueOnce([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    await store.upsertChunks(chunks);

    embedTextsMock.mockResolvedValueOnce([[0.9, 0.1, 0]]); // closest to x.ts's vector
    const results = await store.query('login flow', 2);

    expect(results).toHaveLength(2);
    expect(results[0].chunk.relPath).toBe('x.ts');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    // Full CodeChunk shape should be reconstructed from the row.
    expect(results[0].chunk).toEqual({
      id: 'x.ts:1-5',
      relPath: 'x.ts',
      startLine: 1,
      endLine: 5,
      content: 'auth login handler',
    });
  });

  it('does not persist chunks whose embedding is a zero-vector placeholder (failed embed)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chunks: CodeChunk[] = [
      { id: 'ok.ts:1-1', relPath: 'ok.ts', startLine: 1, endLine: 1, content: 'ok' },
      { id: 'bad.ts:1-1', relPath: 'bad.ts', startLine: 1, endLine: 1, content: 'bad' },
    ];
    embedTextsMock.mockResolvedValueOnce([
      [1, 0],
      [0, 0], // zero-vector placeholder = embedTexts failed on this one
    ]);

    await store.upsertChunks(chunks);

    embedTextsMock.mockResolvedValueOnce([[1, 0]]);
    const results = await store.query('ok', 10);
    expect(results.map((r) => r.chunk.relPath)).toEqual(['ok.ts']);
    warnSpy.mockRestore();
  });

  it('returns no results when the query embedding itself fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    embedTextsMock.mockResolvedValueOnce([[1, 0, 0]]);
    await store.upsertChunks([{ id: 'a.ts:1-1', relPath: 'a.ts', startLine: 1, endLine: 1, content: 'a' }]);

    embedTextsMock.mockResolvedValueOnce([[0, 0, 0]]);
    const results = await store.query('unembeddable query');
    expect(results).toEqual([]);
    warnSpy.mockRestore();
  });

  it('persists across store instances pointed at the same db file', async () => {
    embedTextsMock.mockResolvedValueOnce([[1, 0]]);
    await store.upsertChunks([{ id: 'p.ts:1-1', relPath: 'p.ts', startLine: 1, endLine: 1, content: 'persisted' }]);
    store.close();

    const reopened = new VectorStore();
    reopened.init(dbPath);
    embedTextsMock.mockResolvedValueOnce([[1, 0]]);
    const results = await reopened.query('persisted', 5);
    expect(results).toHaveLength(1);
    expect(results[0].chunk.relPath).toBe('p.ts');
    reopened.close();
  });
});
