// WIP: Initial module design - store.ts
/**
 * Local vector store backed by `better-sqlite3` (a single file on disk, no
 * server) with cosine similarity computed in JS. See docs/ARCHITECTURE.md —
 * a repo's chunk count (hundreds to low thousands) makes brute-force cosine
 * similarity fast enough that a real vector DB would be overkill.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CodeChunk, RetrievalResult } from '../types/index.js';
import { RAG_TOP_K } from '../config/index.js';
import { embedTexts } from './embed.js';

interface ChunkRow {
  id: string;
  rel_path: string;
  start_line: number;
  end_line: number;
  content: string;
  content_hash: string;
  embedding: string;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Cosine similarity, defined as 0 for a zero-length or zero-magnitude vector rather than NaN (see embed.ts for why zero vectors can occur). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function isZeroVector(v: number[]): boolean {
  return v.length === 0 || v.every((x) => x === 0);
}

export class VectorStore {
  private db: Database.Database | undefined;

  /** Opens (creating if needed) the SQLite file at `dbPath` and ensures the schema exists. */
  init(dbPath: string): void {
    const dir = path.dirname(dbPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        rel_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding TEXT NOT NULL
      )
    `);
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error('VectorStore.init(dbPath) must be called before use.');
    }
    return this.db;
  }

  /**
   * Inserts/updates chunks, re-embedding only those that are new or whose
   * content changed since the last run (compared by content hash) — cheap
   * incremental-cache behavior so re-running on an unchanged repo is nearly
   * free.
   */
  async upsertChunks(chunks: CodeChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const db = this.requireDb();

    const existingStmt = db.prepare('SELECT content_hash FROM chunks WHERE id = ?');
    const toEmbed: CodeChunk[] = [];
    for (const chunk of chunks) {
      const existing = existingStmt.get(chunk.id) as { content_hash: string } | undefined;
      if (!existing || existing.content_hash !== hashContent(chunk.content)) {
        toEmbed.push(chunk);
      }
    }
    if (toEmbed.length === 0) return;

    const embeddings = await embedTexts(toEmbed.map((c) => c.content));

    const upsertStmt = db.prepare(`
      INSERT INTO chunks (id, rel_path, start_line, end_line, content, content_hash, embedding)
      VALUES (@id, @rel_path, @start_line, @end_line, @content, @content_hash, @embedding)
      ON CONFLICT(id) DO UPDATE SET
        rel_path = excluded.rel_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        content = excluded.content,
        content_hash = excluded.content_hash,
        embedding = excluded.embedding
    `);

    const rows: ChunkRow[] = [];
    toEmbed.forEach((chunk, i) => {
      const embedding = embeddings[i];
      if (isZeroVector(embedding)) {
        // embedTexts uses an all-zero vector to mark a chunk it couldn't
        // embed (see embed.ts). Don't persist those — they'd never be
        // useful retrieval results and would just take up space.
        console.warn(`[rag] skipping chunk "${chunk.id}": embedding failed (zero-vector placeholder)`);
        return;
      }
      rows.push({
        id: chunk.id,
        rel_path: chunk.relPath,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        content: chunk.content,
        content_hash: hashContent(chunk.content),
        embedding: JSON.stringify(embedding),
      });
    });

    if (rows.length === 0) return;
    const insertMany = db.transaction((rowsToInsert: ChunkRow[]) => {
      for (const row of rowsToInsert) upsertStmt.run(row);
    });
    insertMany(rows);
  }

  /** Embeds `queryText` and returns the top `k` stored chunks by descending cosine similarity. */
  async query(queryText: string, k: number = RAG_TOP_K): Promise<RetrievalResult[]> {
    const db = this.requireDb();
    const [queryEmbedding] = await embedTexts([queryText]);
    if (!queryEmbedding || isZeroVector(queryEmbedding)) {
      console.warn('[rag] query embedding failed; returning no retrieval results');
      return [];
    }

    const rows = db.prepare('SELECT * FROM chunks').all() as ChunkRow[];
    const scored: RetrievalResult[] = rows.map((row) => ({
      chunk: {
        id: row.id,
        relPath: row.rel_path,
        startLine: row.start_line,
        endLine: row.end_line,
        content: row.content,
      },
      score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /** Closes the underlying SQLite connection. Safe to call even if init() was never called. */
  close(): void {
    this.db?.close();
    this.db = undefined;
  }
}
