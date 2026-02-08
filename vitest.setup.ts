// WIP: Initial module design - vitest.setup.ts
import { afterEach, beforeEach } from 'vitest';

/**
 * docs/ARCHITECTURE.md's "Testing approach" requires that no test makes a
 * live Gemini API call (burns free-tier quota, and no key is guaranteed
 * present in CI). @google/generative-ai calls the global `fetch`, so
 * stubbing it to throw by default enforces that rule at the network layer
 * instead of relying only on convention. A test that genuinely needs a real
 * fetch can save/restore `globalThis.fetch` itself.
 */
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error(
      'Blocked a real network call via global fetch. Tests must mock the Gemini client instead of ' +
        'hitting the live API (see docs/ARCHITECTURE.md "Testing approach").'
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});
