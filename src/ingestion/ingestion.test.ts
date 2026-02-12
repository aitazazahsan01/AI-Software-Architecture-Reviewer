import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from './scan.js';
import { chunkFiles } from './chunk.js';
import { classifyLanguage } from './language.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_REPO = path.join(FIXTURES_DIR, 'sample-repo');
const PYTHON_REPO = path.join(FIXTURES_DIR, 'python-repo');
const MIXED_REPO = path.join(FIXTURES_DIR, 'mixed-repo');

describe('classifyLanguage', () => {
  it('classifies by extension', () => {
    expect(classifyLanguage('src/foo.ts')).toBe('typescript');
    expect(classifyLanguage('src/foo.tsx')).toBe('typescript');
    expect(classifyLanguage('src/foo.js')).toBe('javascript');
    expect(classifyLanguage('src/foo.mjs')).toBe('javascript');
    expect(classifyLanguage('src/foo.py')).toBe('python');
    expect(classifyLanguage('package.json')).toBe('json');
    expect(classifyLanguage('README.md')).toBe('markdown');
    expect(classifyLanguage('data.bin')).toBe('other');
  });
});

describe('scanRepo', () => {
  it('respects .gitignore and the hard-coded skip list', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    const relPaths = inventory.files.map((f) => f.relPath);

    expect(relPaths).not.toContain('ignored.txt');
    expect(relPaths).not.toContain('ignored-dir/file.js');
    expect(relPaths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(relPaths.some((p) => p.startsWith('dist/'))).toBe(false);
    expect(relPaths).not.toContain('package-lock.json');

    expect(relPaths).toContain('package.json');
    expect(relPaths).toContain('src/index.ts');
    expect(relPaths).toContain('src/util.py');
    expect(relPaths).toContain('README.md');
    expect(relPaths).toContain('.gitignore');
  });

  it('sets rootPath and absPath consistently', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    expect(inventory.rootPath).toBe(path.resolve(SAMPLE_REPO));
    const indexFile = inventory.files.find((f) => f.relPath === 'src/index.ts');
    expect(indexFile).toBeDefined();
    expect(indexFile?.absPath).toBe(path.join(inventory.rootPath, 'src', 'index.ts'));
    expect(indexFile?.sizeBytes).toBeGreaterThan(0);
  });

  it('classifies languages of scanned files', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    const byPath = new Map(inventory.files.map((f) => [f.relPath, f.language]));
    expect(byPath.get('src/index.ts')).toBe('typescript');
    expect(byPath.get('src/util.py')).toBe('python');
    expect(byPath.get('README.md')).toBe('markdown');
    expect(byPath.get('package.json')).toBe('json');
  });

  it('detects node projectType and packageManifests', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    expect(inventory.projectType).toBe('node');
    expect(inventory.packageManifests).toContain('package.json');
  });

  it('detects python projectType', async () => {
    const inventory = await scanRepo(PYTHON_REPO);
    expect(inventory.projectType).toBe('python');
    expect(inventory.packageManifests).toContain('requirements.txt');
  });

  it('detects mixed projectType', async () => {
    const inventory = await scanRepo(MIXED_REPO);
    expect(inventory.projectType).toBe('mixed');
    expect(inventory.packageManifests.sort()).toEqual(['package.json', 'pyproject.toml']);
  });
});

describe('chunkFiles', () => {
  it('produces stable, 1-indexed, inclusive line-window ids', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    const chunks = chunkFiles(inventory, 2);
    const indexChunks = chunks
      .filter((c) => c.relPath === 'src/index.ts')
      .sort((a, b) => a.startLine - b.startLine);

    expect(indexChunks).toEqual([
      {
        id: 'src/index.ts:1-2',
        relPath: 'src/index.ts',
        startLine: 1,
        endLine: 2,
        content: 'export const LINE_1 = 1;\nexport const LINE_2 = 2;',
      },
      {
        id: 'src/index.ts:3-4',
        relPath: 'src/index.ts',
        startLine: 3,
        endLine: 4,
        content: 'export const LINE_3 = 3;\nexport const LINE_4 = 4;',
      },
      {
        id: 'src/index.ts:5-5',
        relPath: 'src/index.ts',
        startLine: 5,
        endLine: 5,
        content: 'export const LINE_5 = 5;',
      },
    ]);
  });

  it('defaults maxLines to CHUNK_MAX_LINES, producing a single chunk for a small file', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    const chunks = chunkFiles(inventory);
    const indexChunks = chunks.filter((c) => c.relPath === 'src/index.ts');
    expect(indexChunks).toHaveLength(1);
    expect(indexChunks[0].id).toBe('src/index.ts:1-5');
  });

  it('does not chunk unreadable/empty files into phantom chunks', async () => {
    const inventory = await scanRepo(SAMPLE_REPO);
    const chunks = chunkFiles(inventory, 2);
    // every chunk must reference a file that was actually scanned
    const knownPaths = new Set(inventory.files.map((f) => f.relPath));
    for (const chunk of chunks) {
      expect(knownPaths.has(chunk.relPath)).toBe(true);
    }
  });
});
