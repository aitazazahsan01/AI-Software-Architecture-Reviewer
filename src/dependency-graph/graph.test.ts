import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../ingestion/scan.js';
import { buildDependencyGraph } from './graph.js';
import type { DependencyGraph, RepoInventory } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, 'fixtures', 'sample-repo');

describe('buildDependencyGraph', () => {
  let inventory: RepoInventory;
  let graph: DependencyGraph;

  beforeAll(async () => {
    inventory = await scanRepo(SAMPLE_REPO);
    graph = await buildDependencyGraph(inventory);
  });

  it('creates one node per JS/TS file with its named exports', () => {
    const byPath = new Map(graph.nodes.map((n) => [n.relPath, n]));

    expect(byPath.has('src/a.ts')).toBe(true);
    expect(byPath.has('src/b.ts')).toBe(true);
    expect(byPath.has('src/c.ts')).toBe(true);

    const cNode = byPath.get('src/c.ts')!;
    expect(cNode.id).toBe('src/c.ts');
    expect(cNode.exports).toEqual(expect.arrayContaining(['helperC', 'VALUE']));

    const bNode = byPath.get('src/b.ts')!;
    expect(bNode.exports).toEqual(expect.arrayContaining(['helperB']));
  });

  it('resolves the internal import chain a -> b -> c as import edges', () => {
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'src/a.ts', to: 'src/b.ts', kind: 'import' },
        { from: 'src/b.ts', to: 'src/c.ts', kind: 'import' },
      ])
    );
  });

  it('records bare package specifiers as external edges', () => {
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'src/a.ts', to: 'zod', kind: 'external' },
        { from: 'src/server.js', to: 'express', kind: 'external' },
        { from: 'src/models/user.model.js', to: 'mongoose', kind: 'external' },
      ])
    );
  });

  it('does not mistake external specifiers for in-repo files', () => {
    const externalToLocalLooking = graph.edges.filter(
      (e) => e.kind === 'external' && (e.to.startsWith('.') || e.to.startsWith('/'))
    );
    expect(externalToLocalLooking).toHaveLength(0);
  });
});
