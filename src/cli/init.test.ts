import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';

describe('runInit', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'arch-review-init-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates .env from .env.example when .env does not exist', async () => {
    await writeFile(path.join(dir, '.env.example'), 'GEMINI_API_KEY=your_key_here\n', 'utf-8');

    const result = await runInit(dir);

    expect(result.created).toBe(true);
    const contents = await readFile(path.join(dir, '.env'), 'utf-8');
    expect(contents).toContain('GEMINI_API_KEY');
  });

  it('rejects clearly when .env.example is missing, instead of a raw ENOENT crash', async () => {
    await expect(runInit(dir)).rejects.toThrow(/ENOENT|no such file/);
  });

  it('does not overwrite an existing .env', async () => {
    await writeFile(path.join(dir, '.env.example'), 'GEMINI_API_KEY=your_key_here\n', 'utf-8');
    await writeFile(path.join(dir, '.env'), 'GEMINI_API_KEY=already-set\n', 'utf-8');

    const result = await runInit(dir);

    expect(result.created).toBe(false);
    const contents = await readFile(path.join(dir, '.env'), 'utf-8');
    expect(contents).toContain('already-set');
  });
});
