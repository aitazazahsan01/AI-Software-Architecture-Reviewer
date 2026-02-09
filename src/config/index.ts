// WIP: Initial module design - index.ts
import 'dotenv/config';

// `||` (not `??`) so an empty-string override (e.g. a blank GEMINI_MODEL= left
// in .env) falls back to the default instead of silently becoming ''.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

/** Max lines per chunk when splitting source files for embedding/RAG. */
export const CHUNK_MAX_LINES = 120;

/** Number of retrieved chunks to feed into the LLM as context. */
export const RAG_TOP_K = 8;

/** Where the local SQLite cache (embeddings, parsed inventory) is stored, relative to CWD. */
export const CACHE_DIR = '.arch-review-cache';

export interface AppConfig {
  geminiApiKey: string;
  geminiModel: string;
  geminiEmbeddingModel: string;
}

/**
 * Loads and validates required environment configuration. Throws a helpful
 * error (pointing at .env.example) rather than failing deep inside an SDK call.
 */
export function loadConfig(): AppConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY. Copy .env.example to .env and set your free Gemini API key ' +
        '(https://aistudio.google.com/apikey).'
    );
  }
  return {
    geminiApiKey,
    geminiModel: GEMINI_MODEL,
    geminiEmbeddingModel: GEMINI_EMBEDDING_MODEL,
  };
}
