import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DataModel, RepoInventory } from '../types/index.js';

type Field = { name: string; type: string };

function safeRead(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

/** Splits `text` on top-level occurrences of `sep`, ignoring separators nested inside (), {}, []. */
function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;

    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Extracts the balanced-bracket substring of `content` starting at `openIndex`. */
function extractBalanced(content: string, openIndex: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === openChar) depth++;
    else if (content[i] === closeChar) {
      depth--;
      if (depth === 0) return content.slice(openIndex, i + 1);
    }
  }
  return null;
}

/** Parses a `{ field: Type, other: { type: Type, ... }, ... }` object literal body into fields. */
function extractFieldsFromObjectLiteral(objectLiteral: string): Field[] {
  const fields: Field[] = [];
  const inner = objectLiteral.slice(1, -1);
  for (const rawEntry of splitTopLevel(inner)) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const keyMatch = /^['"`]?(\w+)['"`]?\s*:/.exec(entry);
    if (!keyMatch) continue;

    const name = keyMatch[1];
    const rest = entry.slice(keyMatch[0].length).trim();
    let type = 'unknown';
    if (rest.startsWith('{')) {
      const nestedTypeMatch = /type\s*:\s*([\w.]+)/.exec(rest);
      type = nestedTypeMatch ? nestedTypeMatch[1] : 'object';
    } else {
      const typeMatch = /^([\w.[\]]+)/.exec(rest);
      type = typeMatch ? typeMatch[1] : rest.slice(0, 30).trim();
    }
    fields.push({ name, type });
  }
  return fields;
}

function extractPrismaModels(content: string, relPath: string): DataModel[] {
  const models: DataModel[] = [];
  const modelRegex = /\bmodel\s+(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(content)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const block = extractBalanced(content, openIndex, '{', '}');
    if (!block) continue;

    const fields: Field[] = [];
    for (const rawLine of block.slice(1, -1).split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const fieldMatch = /^(\w+)\s+([A-Za-z_][\w[\]?.]*)/.exec(line);
      if (fieldMatch) fields.push({ name: fieldMatch[1], type: fieldMatch[2] });
    }

    models.push({ name: match[1], sourceFile: relPath, fields, kind: 'schema' });
  }
  return models;
}

function extractMongooseSchemas(content: string, relPath: string): DataModel[] {
  const models: DataModel[] = [];
  const schemaRegex = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*(\{)/g;
  let match: RegExpExecArray | null;
  while ((match = schemaRegex.exec(content)) !== null) {
    const varName = match[1];
    const openIndex = match.index + match[0].length - 1;
    const block = extractBalanced(content, openIndex, '{', '}');
    if (!block) continue;

    const fields = extractFieldsFromObjectLiteral(block);

    let name = varName.replace(/Schema$/i, '') || varName;
    const modelCallRegex = new RegExp(`mongoose\\.model\\s*\\(\\s*['"\`](\\w+)['"\`]\\s*,\\s*${varName}\\b`);
    const modelMatch = modelCallRegex.exec(content);
    if (modelMatch) {
      name = modelMatch[1];
    } else {
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }

    models.push({ name, sourceFile: relPath, fields, kind: 'schema' });
  }
  return models;
}

function extractTypeOrmEntities(content: string, relPath: string): DataModel[] {
  const models: DataModel[] = [];
  const entityRegex = /@Entity\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = entityRegex.exec(content)) !== null) {
    const className = match[1];
    const searchFrom = match.index + match[0].length;
    const classBodyStart = content.indexOf('{', searchFrom);
    const block = classBodyStart >= 0 ? extractBalanced(content, classBodyStart, '{', '}') : null;

    const fields: Field[] = [];
    if (block) {
      const propRegex = /(\w+)\s*[!?]?\s*:\s*([\w<>[\].]+)\s*[;=]/g;
      let propMatch: RegExpExecArray | null;
      while ((propMatch = propRegex.exec(block)) !== null) {
        fields.push({ name: propMatch[1], type: propMatch[2] });
      }
      // Plain-JS TypeORM entities (no type annotations) declare bare fields
      // preceded by a @Column()-style decorator instead.
      if (fields.length === 0) {
        const decoratedFieldRegex = /@\w+\s*\([^)]*\)\s*\n\s*(\w+)\s*;/g;
        let decoratedMatch: RegExpExecArray | null;
        while ((decoratedMatch = decoratedFieldRegex.exec(block)) !== null) {
          fields.push({ name: decoratedMatch[1], type: 'unknown' });
        }
      }
    }

    models.push({ name: className, sourceFile: relPath, fields, kind: 'orm-model' });
  }
  return models;
}

function extractSequelizeModels(content: string, relPath: string): DataModel[] {
  const models: DataModel[] = [];
  const defineRegex = /\.define\s*\(\s*['"`](\w+)['"`]\s*,\s*(\{)/g;
  let match: RegExpExecArray | null;
  while ((match = defineRegex.exec(content)) !== null) {
    const name = match[1];
    const openIndex = match.index + match[0].length - 1;
    const block = extractBalanced(content, openIndex, '{', '}');
    const fields = block ? extractFieldsFromObjectLiteral(block) : [];
    models.push({ name, sourceFile: relPath, fields, kind: 'orm-model' });
  }
  return models;
}

const SQL_CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'FOREIGN',
  'CONSTRAINT',
  'UNIQUE',
  'CHECK',
  'KEY',
  'INDEX',
]);

function extractSqlTables(content: string, relPath: string): DataModel[] {
  const models: DataModel[] = [];
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(content)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const block = extractBalanced(content, openIndex, '(', ')');
    if (!block) continue;

    const fields: Field[] = [];
    for (const rawDef of splitTopLevel(block.slice(1, -1))) {
      const tokens = rawDef.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      if (SQL_CONSTRAINT_KEYWORDS.has(tokens[0].toUpperCase())) continue;

      fields.push({
        name: tokens[0].replace(/[`"[\]]/g, ''),
        type: tokens[1] ?? 'unknown',
      });
    }

    models.push({ name: match[1], sourceFile: relPath, fields, kind: 'sql-table' });
  }
  return models;
}

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Best-effort detection of common data-model definitions: Prisma schema
 * `model` blocks, Mongoose `new Schema(...)`, TypeORM `@Entity()` classes,
 * Sequelize `.define(...)` calls, and raw `CREATE TABLE` statements in .sql
 * files.
 */
export async function extractDataModels(inventory: RepoInventory): Promise<DataModel[]> {
  const models: DataModel[] = [];

  for (const file of inventory.files) {
    const ext = path.posix.extname(file.relPath).toLowerCase();
    const content = safeRead(file.absPath);
    if (content === null) continue;

    if (ext === '.prisma') {
      models.push(...extractPrismaModels(content, file.relPath));
    } else if (ext === '.sql') {
      models.push(...extractSqlTables(content, file.relPath));
    } else if (JS_TS_EXTENSIONS.has(ext)) {
      models.push(...extractMongooseSchemas(content, file.relPath));
      models.push(...extractTypeOrmEntities(content, file.relPath));
      models.push(...extractSequelizeModels(content, file.relPath));
    }
  }

  return models;
}
