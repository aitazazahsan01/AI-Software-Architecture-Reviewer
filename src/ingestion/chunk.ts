// WIP: Initial module design - chunk.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CodeChunk, RepoInventory } from '../types/index.js';
import { CHUNK_MAX_LINES } from '../config/index.js';

/** Extensions we don't bother chunking — binary content isn't useful for embedding/RAG. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi', '.webm',
]);

function splitIntoLines(content: string): string[] {
  const rawLines = content.split(/\r\n|\r|\n/);
  // Drop a single trailing empty element caused by a final trailing newline —
  // otherwise every file ending in "\n" would produce a phantom empty last line.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    return rawLines.slice(0, -1);
  }
  return rawLines;
}

/**
 * Splits each file in the inventory into maxLines-line windows, producing
 * stable ids like "src/foo.ts:1-120" (1-indexed, inclusive line ranges).
 */
export function chunkFiles(
  inventory: RepoInventory,
  maxLines: number = CHUNK_MAX_LINES
): CodeChunk[] {
  const chunks: CodeChunk[] = [];

  for (const file of inventory.files) {
    const ext = path.posix.extname(file.relPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) continue;

    let content: string;
    try {
      content = readFileSync(file.absPath, 'utf8');
    } catch {
      continue; // unreadable file — skip rather than fail the whole run
    }
    if (content.length === 0) continue;

    const lines = splitIntoLines(content);

    for (let start = 0; start < lines.length; start += maxLines) {
      const end = Math.min(start + maxLines, lines.length);
      const startLine = start + 1;
      const endLine = end;
      chunks.push({
        id: `${file.relPath}:${startLine}-${endLine}`,
        relPath: file.relPath,
        startLine,
        endLine,
        content: lines.slice(start, end).join('\n'),
      });
    }
  }

  return chunks;
}
