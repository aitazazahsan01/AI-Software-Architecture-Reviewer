import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../ingestion/scan.js';
import { extractApiEndpoints } from './api-endpoints.js';
import type { ApiEndpoint, RepoInventory } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, 'fixtures', 'sample-repo');

describe('extractApiEndpoints', () => {
  let inventory: RepoInventory;
  let endpoints: ApiEndpoint[];

  beforeAll(async () => {
    inventory = await scanRepo(SAMPLE_REPO);
    endpoints = await extractApiEndpoints(inventory);
  });

  it('detects an Express GET route with a path param', () => {
    const match = endpoints.find((e) => e.path === '/users/:id' && e.method === 'GET');
    expect(match).toBeDefined();
    expect(match?.handlerFile).toBe('src/server.js');
    expect(match?.framework).toBe('express');
    expect(match?.handlerLine).toBeGreaterThan(0);
  });

  it('detects an Express POST route', () => {
    const match = endpoints.find((e) => e.path === '/users' && e.method === 'POST');
    expect(match).toBeDefined();
    expect(match?.handlerFile).toBe('src/server.js');
    expect(match?.framework).toBe('express');
  });

  it('detects a Fastify route registered via fastify.route({...})', () => {
    const match = endpoints.find((e) => e.path === '/orders/:id');
    expect(match).toBeDefined();
    expect(match?.method).toBe('GET');
    expect(match?.framework).toBe('fastify');
    expect(match?.handlerFile).toBe('src/fastify-server.js');
  });

  it('ignores non-route method calls that do not start with a leading slash', () => {
    const bogus = endpoints.find((e) => !e.path.startsWith('/'));
    expect(bogus).toBeUndefined();
  });
});
