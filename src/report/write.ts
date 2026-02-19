// WIP: Initial module design - write.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes `report.md` and `report.html` into `outDir` (created recursively if
 * it doesn't exist yet) and returns their absolute paths.
 */
export async function writeReportToDisk(
  outDir: string,
  markdown: string,
  html: string
): Promise<{ mdPath: string; htmlPath: string }> {
  const absOutDir = path.resolve(outDir);
  await mkdir(absOutDir, { recursive: true });

  const mdPath = path.join(absOutDir, 'report.md');
  const htmlPath = path.join(absOutDir, 'report.html');

  await writeFile(mdPath, markdown, 'utf-8');
  await writeFile(htmlPath, html, 'utf-8');

  return { mdPath, htmlPath };
}
