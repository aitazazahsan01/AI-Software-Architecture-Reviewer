// WIP: Initial module design - language.ts
import path from 'node:path';
import type { Language } from '../types/index.js';

const EXTENSION_LANGUAGE_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
};

/** Classifies a file's Language by its extension. Unknown extensions map to 'other'. */
export function classifyLanguage(relPath: string): Language {
  const ext = path.posix.extname(relPath.split(path.sep).join('/')).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'other';
}
