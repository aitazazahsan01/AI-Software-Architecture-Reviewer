// WIP: Initial module design - mermaidUtils.ts
/**
 * Small, dependency-free helpers for generating and sanity-checking Mermaid
 * source strings. Kept separate from the diagram builders so both the
 * builders and the tests can share the same sanitization/validation logic.
 */

const BRACKET_PAIRS: Record<string, string> = {
  '[': ']',
  '{': '}',
  '(': ')',
};
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));

/**
 * Checks that every opening bracket/brace/paren in `source` has a matching
 * closer in the right order. This is a heuristic (it doesn't understand
 * Mermaid's quoting rules), but it's good enough to catch the classic
 * "forgot to close a subgraph/node label" bug in generated diagram source.
 */
export function isBalanced(source: string): boolean {
  const stack: string[] = [];
  for (const ch of source) {
    const closer = BRACKET_PAIRS[ch];
    if (closer) {
      stack.push(closer);
      continue;
    }
    if (CLOSERS.has(ch)) {
      if (stack.pop() !== ch) return false;
    }
  }
  return stack.length === 0;
}

/** Checks that `source` starts (after trimming) with the given diagram-type keyword. */
export function startsWithDiagramKeyword(source: string, keyword: string): boolean {
  return source.trim().startsWith(keyword);
}

/**
 * Sanity-checks a generated Mermaid string: it must open with the expected
 * diagram-type keyword and have balanced brackets/braces/parens.
 */
export function validateMermaid(source: string, keyword: string): boolean {
  return startsWithDiagramKeyword(source, keyword) && isBalanced(source);
}

/**
 * Turns an arbitrary string (a file path, a free-text component name, ...)
 * into a safe Mermaid node/subgraph id: alphanumerics and underscores only,
 * never starting with a digit, never empty.
 */
export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
  const safe = cleaned.length > 0 ? cleaned : 'node';
  return /^[0-9]/.test(safe) ? `n_${safe}` : safe;
}

/**
 * Escapes text for use inside a quoted Mermaid label ("...") or as sequence
 * diagram message text: strips characters that would otherwise break out of
 * the label and collapses newlines.
 */
export function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Truncates text to `maxLen` characters, appending an ellipsis when cut. */
export function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}
