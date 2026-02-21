# WIP: Draft version of IMPLEMENTATION_PLAN.md

# Implementation Plan

Tracks phases, ownership, and status. See [ARCHITECTURE.md](./ARCHITECTURE.md) for
the "why" and the exact module contracts.

## Phase 0 — Scaffold (done)

- [x] `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- [x] Shared contract types: `src/types/index.ts`
- [x] Config loader: `src/config/index.ts`
- [x] Placeholder module barrels for `ingestion`, `dependency-graph`, `rag`, `llm`,
      `diagrams`, `report`, `cli`
- [x] `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/SETUP.md`

## Phase 1 — Ingestion + Dependency Graph (done)

Owns: `src/ingestion/`, `src/dependency-graph/`, their `*.test.ts` files, and
fixture repos under `src/dependency-graph/fixtures/` and `src/ingestion/fixtures/`.

- [x] `scanRepo(rootPath)` — gitignore-aware file walk (`fast-glob` + `ignore`,
      plus a hard-coded skip list) + language classification + project-type detection
- [x] `chunkFiles(inventory, maxLines?)` — line-window chunking with stable ids
- [x] `buildDependencyGraph(inventory)` — `ts-morph`-based import graph for JS/TS
      (imports, `require()`, dynamic `import()`, internal vs. external edges)
- [x] `extractApiEndpoints(inventory)` — Express/Koa-style + Fastify route detection
- [x] `extractDataModels(inventory)` — Prisma/Mongoose/TypeORM/Sequelize/raw-SQL
      detection
- [x] Unit tests (23 tests) against fixture repos (import chains, Express/Fastify
      routes, Mongoose/TypeORM/Sequelize/Prisma/SQL models, gitignore handling,
      mixed node/python project detection)

Known MVP simplification: `.gitignore` handling reads only the repo-root file (no
nested-directory `.gitignore` merging).

## Phase 2 — RAG + LLM (Gemini integration) (done)

Owns: `src/rag/`, `src/llm/`, their `*.test.ts` files.

- [x] `embedTexts(texts)` — batched Gemini embedding calls (`batchEmbedContents`,
      100/batch) with per-item fallback on batch failure; always returns an
      array the same length as the input (a failed item becomes a zero-vector
      sentinel rather than being dropped, so index alignment with the caller's
      chunk list is never broken)
- [x] `VectorStore` — `better-sqlite3`-backed persistence + cosine-similarity
      `query()`, cached under `.arch-review-cache/`; upsert skips re-embedding
      unchanged chunks via a content hash
- [x] `generateImpactReport(params)` — prompt construction + Gemini call
      (native JSON response mode) + `zod`-validated parsing with one retry
      (stricter "JSON only" instruction) on parse/validation failure
- [x] Unit tests (19 tests), Gemini client fully mocked/injectable — no live
      API calls in the test suite

## Phase 3 — Diagrams + Report (done)

Owns: `src/diagrams/`, `src/report/`, their `*.test.ts` files.

- [x] `generateDiagrams(inventory, report)` — current/proposed flowcharts
      (grouped by top-level directory, external deps folded into one node),
      a sequence diagram inferred from the affected APIs, and an optional ER
      diagram when `databaseChanges` is non-empty
- [x] `renderMarkdownReport(result)` — full Markdown report with fenced
      `mermaid` blocks
- [x] `renderHtmlViewer(markdown, diagrams)` — self-contained HTML viewer
      (mermaid.js via CDN, no build step)
- [x] `writeReportToDisk(outDir, markdown, html)`
- [x] Unit tests (23 tests): Mermaid output validity (balanced brackets, correct
      diagram-type keyword), directory grouping, component highlighting,
      Markdown/HTML section and content assertions, real-file-write assertions

## Phase 4 — CLI integration (done)

- [x] `arch-review analyze --repo <path> --proposal "<text>" --out <dir>`
      orchestrates: config validation (fail-fast) → `scanRepo` → `chunkFiles` →
      (`buildDependencyGraph` + `extractApiEndpoints` + `extractDataModels` in
      parallel) → `VectorStore.upsertChunks` → `VectorStore.query(proposal)` →
      `generateImpactReport` → `generateDiagrams` → `renderMarkdownReport` +
      `renderHtmlViewer` → `writeReportToDisk` (see `src/cli/analyze.ts`)
- [x] `arch-review init` — copies `.env.example` to `.env` if missing, prints
      the Google AI Studio API-key link
- [x] Friendly top-level error handling: missing/invalid `GEMINI_API_KEY` is
      checked before any repo scanning happens; `analyze` and `init` actions
      and the top-level `parseAsync` all catch and print a clean
      `arch-review ... failed: <message>` instead of a raw stack trace
- [x] `npm run build` produces a working `dist/cli/index.js` (verified via
      `arch-review --help` and a full non-LLM pipeline smoke run against this
      repo itself)
- [x] Unit tests (7 tests) for the orchestration (all dependencies injected —
      no live repo scan or Gemini call) and `init`'s file handling

## Phase 5 — Review pass (done)

- [x] Merged Phases 1–3 (built in parallel in isolated git worktrees) into
      `master` with no conflicts; contracts in `src/types/index.ts` held
      without modification
- [x] `npm test` (72 tests, 11 files) and `npm run build` pass end-to-end
- [x] Ran the non-LLM part of the pipeline (scan → chunk → dependency graph →
      API/data-model extraction → diagrams → report) against this repo itself
      as a smoke test — the Gemini-calling step (`generateImpactReport`)
      still requires a user-supplied free API key to exercise live; see
      [SETUP.md](./SETUP.md)
- [x] Code review pass (`/code-review high`) — fixed: CLI failing to
      validate config before doing repo-scan work, `init` command leaking raw
      stack traces on error, unhandled `parseAsync` rejections, fixture
      directories leaking into the build output, an env-var empty-string
      fallback bug, an unused type, and a Node/`@types/node` version mismatch;
      also added a vitest setup file that stubs `fetch` to throw by default so
      "no live Gemini calls in tests" is enforced rather than just documented

## Phase 6 — Web UI (done)

Owns: `src/web/` (`server.ts`, `server.test.ts`, `public/{index.html,styles.css,app.js}`).

- [x] `runAnalyze` (src/cli/analyze.ts) extended with an optional `onProgress`
      callback, firing at each pipeline stage (`config`, `scan`, `analyze`,
      `embed`, `retrieve`, `llm`, `diagrams`, `report`, `done`); its return
      value grew from `{ mdPath, htmlPath }` to also include `markdown`,
      `html`, and the full in-memory `result: AnalysisResult` — additive, the
      CLI's existing usage still destructures just `{ mdPath, htmlPath }`
- [x] `createServer()` (Express): serves the static frontend from
      `src/web/public`, and `GET /api/analyze?repo=&proposal=&out=` streams
      progress + the final result as Server-Sent Events. A GET (not POST)
      endpoint is deliberate — it lets the frontend use the browser's native
      `EventSource`, which handles SSE framing/reconnection without a
      hand-rolled `fetch` + `ReadableStream` reader
- [x] `arch-review web [--port <port>]` CLI command; `npm run web`
- [x] Frontend: a professional, fully responsive single-page UI (vanilla
      HTML/CSS/JS, no bundler/framework — consistent with the project's
      no-heavy-resources stance) with a live progress stepper + log, and a
      results view (tables, severity-badged risk lists, collapsible Mermaid
      diagrams via the same CDN approach as `renderHtmlViewer`). Light/dark
      themes via `prefers-color-scheme`; responsive breakpoint collapses the
      two-column layout to one column under 900px
- [x] `scripts/copy-web-assets.mjs` copies `src/web/public` into
      `dist/web/public` after `tsc` (which only compiles `.ts` files) — wired
      into the `build` npm script
- [x] Unit tests (6 tests, `supertest`, mocked `runAnalyzeFn` — no live
      analysis or Gemini calls): static serving, `/api/health`, 400 on
      missing query params, the SSE progress→result sequence, and the error
      path
- [x] Verified live end-to-end: started the built server, drove
      `GET /api/analyze` with curl against a real fixture repo with a real
      Gemini key — confirmed the full SSE event sequence and a correct,
      coherent report; opened the page in a browser to confirm the frontend
      renders it

Note: the custom SSE event carrying analysis failures is named `failure`, not
`error` — `EventSource` reserves the `error` event name for connection-level
failures, so a same-named custom event would be indistinguishable from a
dropped connection on the client. Caught and fixed during review (see
`src/web/public/app.js` and `src/web/server.ts`).

## Future work (explicitly out of scope for v1)

- Language plugins for Python/Go/Java dependency graphs (the `ts-morph`-based
  extractor is JS/TS-only for v1; see ARCHITECTURE.md "MVP language scope")
- Ingesting a remote GitHub repo by URL (via the GitHub API) instead of a local path
- PR-comment bot mode (post the report as a GitHub PR comment via `gh`/GitHub API)
- Incremental re-analysis (only re-embed/re-graph files that changed since the
  last cached run)
- Nested `.gitignore` support in `scanRepo` (currently root-only)
- Concurrent web requests share no queue/lock — two simultaneous `/api/analyze`
  calls against the same repo would both try to write to the same SQLite
  cache file; fine for the intended single-user local-tool use case, not
  hardened for multi-user hosting
