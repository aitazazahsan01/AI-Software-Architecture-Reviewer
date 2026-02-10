// WIP: Initial module design - scan.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import type { FileInfo, ProjectType, RepoInventory } from '../types/index.js';
import { classifyLanguage } from './language.js';

/**
 * Directories that are always skipped regardless of .gitignore contents.
 * Expressed as fast-glob ignore globs so they're filtered out before any
 * gitignore-based filtering happens.
 */
const HARD_SKIP_GLOBS = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

/** Lockfiles that are always skipped regardless of .gitignore contents. */
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'bun.lockb',
]);

async function readGitignore(rootPath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(rootPath, '.gitignore'), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Walks the repo at rootPath, respecting .gitignore (via the `ignore` package)
 * plus a hard-coded skip list (node_modules, .git, dist, build, lockfiles),
 * classifies each file's Language, and detects the project's ProjectType from
 * manifest files present.
 */
export async function scanRepo(rootPath: string): Promise<RepoInventory> {
  const absRoot = path.resolve(rootPath);

  const gitignoreContent = await readGitignore(absRoot);
  const ig = ignore().add(gitignoreContent);

  const relPaths = await fg('**/*', {
    cwd: absRoot,
    dot: true,
    onlyFiles: true,
    ignore: HARD_SKIP_GLOBS,
    followSymbolicLinks: false,
    absolute: false,
  });

  const files: FileInfo[] = [];
  const packageManifests: string[] = [];
  let hasPackageJson = false;
  let hasRequirementsTxt = false;
  let hasPyprojectToml = false;

  for (const relPath of relPaths) {
    const baseName = path.posix.basename(relPath);
    if (LOCKFILE_NAMES.has(baseName)) continue;
    if (ig.ignores(relPath)) continue;

    const absPath = path.join(absRoot, relPath);
    let sizeBytes = 0;
    try {
      const stat = await fs.stat(absPath);
      sizeBytes = stat.size;
    } catch {
      // Broken symlink or file disappeared mid-scan — skip it.
      continue;
    }

    files.push({
      relPath,
      absPath,
      language: classifyLanguage(relPath),
      sizeBytes,
    });

    if (baseName === 'package.json') {
      hasPackageJson = true;
      packageManifests.push(relPath);
    } else if (baseName === 'requirements.txt') {
      hasRequirementsTxt = true;
      packageManifests.push(relPath);
    } else if (baseName === 'pyproject.toml') {
      hasPyprojectToml = true;
      packageManifests.push(relPath);
    }
  }

  const hasPython = hasRequirementsTxt || hasPyprojectToml;
  let projectType: ProjectType = 'unknown';
  if (hasPackageJson && hasPython) projectType = 'mixed';
  else if (hasPackageJson) projectType = 'node';
  else if (hasPython) projectType = 'python';

  return { rootPath: absRoot, files, projectType, packageManifests };
}
