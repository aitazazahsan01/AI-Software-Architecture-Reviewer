import { readFileSync } from 'node:fs';
import type { ApiEndpoint, RepoInventory } from '../types/index.js';

const HTTP_METHOD_NAMES = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Finds the substring of `content` for the balanced-bracket block starting at `openIndex`. */
function extractBalanced(content: string, openIndex: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === openChar) depth++;
    else if (content[i] === closeChar) {
      depth--;
      if (depth === 0) return content.slice(openIndex, i + 1);
    }
  }
  return null;
}

function detectFramework(content: string, receiver: string): string {
  if (receiver === 'fastify') return 'fastify';
  const looksLikeKoa = /from\s+['"]koa['"]/.test(content) || /require\(\s*['"]koa['"]\s*\)/.test(content) || /@koa\/router/.test(content);
  if (looksLikeKoa) return 'koa';
  return 'express';
}

function safeRead(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Best-effort regex scan for Express/Koa-style method-call route registrations
 * (`app.get('/path', ...)`, `router.post('/path', ...)`) and Fastify's
 * `fastify.route({ method, url, handler })` object form. False negatives on
 * exotic routing setups (nested routers, string concatenation, etc.) are
 * acceptable for v1.
 */
export async function extractApiEndpoints(inventory: RepoInventory): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];

  for (const file of inventory.files) {
    if (file.language !== 'typescript' && file.language !== 'javascript') continue;
    const content = safeRead(file.absPath);
    if (content === null) continue;

    // Method-call style: app.get('/path', handler), router.post('/path', handler), fastify.get(...)
    const callRegex =
      /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])([^'"`]+)\3/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(content)) !== null) {
      const [, receiver, methodRaw, , routePath] = match;
      if (!HTTP_METHOD_NAMES.has(methodRaw)) continue;
      if (!routePath.startsWith('/')) continue;

      endpoints.push({
        method: methodRaw.toUpperCase(),
        path: routePath,
        handlerFile: file.relPath,
        handlerLine: getLineNumber(content, match.index),
        framework: detectFramework(content, receiver),
      });
    }

    // Fastify object style: fastify.route({ method: 'GET', url: '/path', handler: ... })
    const routeBlockRegex = /\bfastify\s*\.\s*route\s*\(\s*\{/g;
    while ((match = routeBlockRegex.exec(content)) !== null) {
      const openIndex = match.index + match[0].length - 1;
      const block = extractBalanced(content, openIndex, '{', '}');
      if (!block) continue;

      const methodMatch = /method\s*:\s*['"`]([A-Za-z]+)['"`]/.exec(block);
      const urlMatch = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(block);
      if (!methodMatch || !urlMatch) continue;

      endpoints.push({
        method: methodMatch[1].toUpperCase(),
        path: urlMatch[1],
        handlerFile: file.relPath,
        handlerLine: getLineNumber(content, match.index),
        framework: 'fastify',
      });
    }
  }

  return endpoints;
}
