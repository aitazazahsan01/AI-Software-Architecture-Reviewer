import { copyFile, access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Copies .env.example to .env if .env doesn't already exist. Returns whether
 * a file was created, so the CLI can print an appropriate message.
 */
export async function runInit(cwd: string = process.cwd()): Promise<{ created: boolean; envPath: string }> {
  const envPath = path.join(cwd, '.env');
  const examplePath = path.join(cwd, '.env.example');

  try {
    await access(envPath);
    return { created: false, envPath };
  } catch {
    await copyFile(examplePath, envPath);
    return { created: true, envPath };
  }
}
