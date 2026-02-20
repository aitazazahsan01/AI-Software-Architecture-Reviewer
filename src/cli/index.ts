#!/usr/bin/env node
import { Command } from 'commander';
import { runAnalyze } from './analyze.js';
import { runInit } from './init.js';
import { createServer } from '../web/server.js';

const program = new Command();

program
  .name('arch-review')
  .description(
    'AI Software Architecture Reviewer — analyzes a codebase and evaluates the impact of a proposed change using Gemini.'
  )
  .version('0.1.0');

program
  .command('init')
  .description('Create a .env file from .env.example if one does not already exist')
  .action(async () => {
    try {
      const { created, envPath } = await runInit();
      if (created) {
        console.log(`Created ${envPath}`);
        console.log('Get a free Gemini API key at https://aistudio.google.com/apikey');
        console.log('Then set GEMINI_API_KEY in that file.');
      } else {
        console.log(`${envPath} already exists — leaving it as is.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`arch-review init failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command('analyze')
  .description('Analyze a repo and evaluate the impact of a proposed change')
  .requiredOption('-r, --repo <path>', 'path to the codebase to analyze')
  .requiredOption('-p, --proposal <text>', 'natural-language description of the proposed feature/change')
  .option('-o, --out <dir>', 'output directory for the report', './output')
  .action(async (opts: { repo: string; proposal: string; out: string }) => {
    try {
      const { mdPath, htmlPath } = await runAnalyze({
        repoPath: opts.repo,
        proposalText: opts.proposal,
        outDir: opts.out,
      });
      console.log('Analysis complete.');
      console.log(`  Markdown report: ${mdPath}`);
      console.log(`  HTML report:     ${htmlPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`arch-review failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command('web')
  .description('Start a local web UI for running analyses in the browser')
  .option('-p, --port <port>', 'port to listen on', '4317')
  .action((opts: { port: string }) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port <= 0) {
      console.error(`arch-review web failed: invalid --port "${opts.port}"`);
      process.exitCode = 1;
      return;
    }
    const app = createServer();
    app.listen(port, () => {
      console.log(`arch-review web UI running at http://localhost:${port}`);
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`arch-review failed: ${message}`);
  process.exitCode = 1;
});
