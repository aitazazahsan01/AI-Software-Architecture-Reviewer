# WIP: Draft version of SETUP.md

# Setup

## Prerequisites

- Node.js 20.11+ (check with `node -v`)
- A free Google Gemini API key

## 1. Get a free Gemini API key

1. Go to https://aistudio.google.com/apikey
2. Sign in, click "Create API key"
3. Copy the key — Gemini's free tier covers `gemini-3.6-flash` and the
   `gemini-embedding-001` embedding model, both used by this project

## 2. Install dependencies

```bash
npm install
```

## 3. Configure your API key

```bash
cp .env.example .env
```

Edit `.env` and set:

```
GEMINI_API_KEY=your_key_here
```

## 4. Run it

```bash
npm run dev -- analyze --repo ../path/to/some/codebase --proposal "Add a real-time chat feature between users" --out ./output
```

This writes `output/report.md` and `output/report.html` — open the `.html` file
directly in a browser to view the rendered diagrams, or view `.md` in GitHub/VS Code.

## 4b. Or use the web UI

```bash
npm run web
```

Then open http://localhost:4317 — fill in a repo path and a proposed change,
and watch live progress as it runs (config check → scan → dependency
analysis → embedding → retrieval → Gemini → diagrams → report), with the
full report (tables, severity-tagged risks, collapsible Mermaid diagrams)
rendered on the page when it finishes. Pass `--port <port>` to use a
different port (`npm run web -- --port 8080`). Reports are still written to
disk under `.arch-review-web-output/` for anyone who wants the raw files.

## 5. Run tests

```bash
npm test
```

Tests never call the live Gemini API (the LLM/RAG clients are mocked in tests), so
this works even without a configured API key.

## 6. Build a standalone binary-ish bundle

```bash
npm run build
npm start -- analyze --repo ../path/to/some/codebase --proposal "..." --out ./output
```

## Troubleshooting: "404 Not Found ... is not found for API version v1beta"

Google periodically retires/renames Gemini model ids. If you see a 404 for the
model in `GEMINI_MODEL` or `GEMINI_EMBEDDING_MODEL` (set in `src/config/index.ts`
or overridden via `.env`), list the models your key currently has access to and
pick a current, non-preview one that supports the method you need
(`generateContent` for `GEMINI_MODEL`, `embedContent` for `GEMINI_EMBEDDING_MODEL`):

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
```

Then override the default in `.env`, e.g.:

```
GEMINI_MODEL=gemini-3.6-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
```

Note: `gemini-embedding-001` only supports single-item `embedContent` (no
synchronous batch endpoint), so you'll see a one-time
`[rag] batchEmbedContents failed ... falling back to per-item embedding`
warning per batch — that's expected, not an error; embedding still succeeds
via the per-item fallback.

## Notes on cost and resource usage

- This project only ever calls Gemini's free tier. There is no other paid
  dependency anywhere in the stack.
- Everything runs locally as a single Node process. The only "storage" is a
  SQLite file under `.arch-review-cache/` (safe to delete any time to force
  re-embedding).
- No Docker, no GPU, no external database server required.
