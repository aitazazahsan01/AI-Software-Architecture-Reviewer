// WIP: Initial module design - graph.ts
import { Project, SyntaxKind } from 'ts-morph';
import type { DependencyEdge, DependencyGraph, DependencyNode, FileInfo, RepoInventory } from '../types/index.js';
import { isRelativeSpecifier, resolveRelativeSpecifier } from './resolve.js';

function isJsOrTsFile(file: FileInfo): boolean {
  return file.language === 'typescript' || file.language === 'javascript';
}

/**
 * Uses ts-morph to load every JS/TS file in the inventory, walks import
 * declarations/export-from declarations/require()/dynamic import() calls,
 * and produces a DependencyGraph: relative specifiers resolve to in-repo
 * files (kind 'import'), bare/package specifiers become 'external' edges
 * whose target is the raw specifier string.
 */
export async function buildDependencyGraph(inventory: RepoInventory): Promise<DependencyGraph> {
  const jsTsFiles = inventory.files.filter(isJsOrTsFile);
  const knownFiles = new Set(inventory.files.map((f) => f.relPath));

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      experimentalDecorators: true,
      noEmit: true,
    },
  });

  for (const file of jsTsFiles) {
    try {
      project.addSourceFileAtPath(file.absPath);
    } catch {
      // Unreadable or unparsable file — skip it rather than failing the whole run.
    }
  }

  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];

  for (const file of jsTsFiles) {
    const sourceFile = project.getSourceFile(file.absPath);
    if (!sourceFile) continue;

    let exportNames: string[] = [];
    try {
      exportNames = Array.from(sourceFile.getExportedDeclarations().keys());
    } catch {
      exportNames = [];
    }
    nodes.push({ id: file.relPath, relPath: file.relPath, exports: exportNames });

    const specifiers = new Set<string>();

    for (const imp of sourceFile.getImportDeclarations()) {
      specifiers.add(imp.getModuleSpecifierValue());
    }
    for (const exp of sourceFile.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue();
      if (spec) specifiers.add(spec);
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      const isRequireCall = expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'require';
      const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
      if (!isRequireCall && !isDynamicImport) continue;

      const [firstArg] = call.getArguments();
      if (firstArg && firstArg.getKind() === SyntaxKind.StringLiteral) {
        const text = firstArg.getText();
        specifiers.add(text.slice(1, -1));
      }
    }

    for (const specifier of specifiers) {
      if (isRelativeSpecifier(specifier)) {
        const resolved = resolveRelativeSpecifier(file.relPath, specifier, knownFiles);
        edges.push({ from: file.relPath, to: resolved, kind: 'import' });
      } else {
        edges.push({ from: file.relPath, to: specifier, kind: 'external' });
      }
    }
  }

  return { nodes, edges };
}
