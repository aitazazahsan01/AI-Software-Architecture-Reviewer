import path from 'node:path';

const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const INDEX_BASENAMES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];

/**
 * Best-effort resolution of a relative/absolute import specifier to an
 * in-repo relPath, checked against the set of files actually present in the
 * inventory (so it works without needing real module resolution machinery).
 * Falls back to the normalized-but-unresolved path if no match is found
 * (e.g. the import targets a file excluded from the inventory).
 */
export function resolveRelativeSpecifier(
  fromRelPath: string,
  specifier: string,
  knownFiles: ReadonlySet<string>
): string {
  const fromDir = path.posix.dirname(fromRelPath);
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${joined}${ext}`;
    if (knownFiles.has(candidate)) return candidate;
  }
  for (const indexName of INDEX_BASENAMES) {
    const candidate = path.posix.join(joined, indexName);
    if (knownFiles.has(candidate)) return candidate;
  }

  return joined;
}

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}
