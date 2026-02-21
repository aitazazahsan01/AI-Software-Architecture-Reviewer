import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { runAnalyze, type OnAnalyzeProgress } from '../cli/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

export interface CreateServerOptions {
  /** Injectable for tests — production callers should omit it. */
  runAnalyzeFn?: typeof runAnalyze;
}

/**
 * Builds the Express app for the local web UI: serves the static frontend
 * from `src/web/public` and exposes `GET /api/analyze` as a Server-Sent
 * Events stream so the frontend can show live progress through the same
 * pipeline stages the CLI logs to the console (see `runAnalyze`'s
 * `onProgress` callback in src/cli/analyze.ts).
 *
 * A GET (not POST) endpoint is deliberate: it lets the frontend use the
 * browser's native `EventSource`, which understands SSE framing and
 * reconnection out of the box — a POST-based stream would need a hand-rolled
 * `fetch` + `ReadableStream` reader for the same effect.
 */
export function createServer(options: CreateServerOptions = {}): Express {
  const runAnalyzeFn = options.runAnalyzeFn ?? runAnalyze;
  const app = express();

  app.use(express.static(PUBLIC_DIR));

  app.get('/api/analyze', async (req: Request, res: Response) => {
    const repoPath = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const proposalText = typeof req.query.proposal === 'string' ? req.query.proposal.trim() : '';

    if (!repoPath || !proposalText) {
      res.status(400).json({ error: 'Both "repo" and "proposal" query parameters are required.' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Some proxies/CDNs need an initial flush before they'll forward chunks;
    // harmless locally, cheap insurance if this is ever run behind one.
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onProgress: OnAnalyzeProgress = (event) => send('progress', event);

    const outDir = path.join(process.cwd(), '.arch-review-web-output', `run-${Date.now()}`);

    try {
      const outcome = await runAnalyzeFn({ repoPath, proposalText, outDir }, undefined, onProgress);
      send('result', {
        result: outcome.result,
        mdPath: outcome.mdPath,
        htmlPath: outcome.htmlPath,
      });
    } catch (err) {
      // Named "failure", not "error" — EventSource reserves the "error" event
      // name for its own connection-level failures, so a same-named custom
      // SSE event would be indistinguishable from a dropped connection on
      // the client (see src/web/public/app.js).
      send('failure', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}
