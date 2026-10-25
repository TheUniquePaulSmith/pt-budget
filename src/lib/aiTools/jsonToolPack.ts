import { isWriteSql } from '../../../public/database-sql-classifier.js';
import type { AiToolConsent, AiToolPack } from '@/types/database';
import {
  AI_TOOL_CRUDS,
  type AiToolCrud,
  type AiToolDefinition,
  type AiToolInputSchema,
  type AiToolPackDocument,
  type AiToolPackToolDocument,
  type AiToolPackValidationError,
} from '@/types/aiTools';
import { isInputSchema, validateToolArguments } from './toolSchema';
import { consentDefaultForCrud, enabledDefaultForCrud } from './consentDefaults';

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PARAM_PATTERN = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
const FORBIDDEN_SQL_PATTERN = /\b(attach|detach|pragma|vacuum|alter|drop|create|reindex|analyze)\b/i;
const CONSENTS: readonly AiToolConsent[] = ['ask', 'always', 'deny'];

export class AiToolPackError extends Error {
  readonly errors: AiToolPackValidationError[];

  constructor(errors: AiToolPackValidationError[]) {
    super(errors.map((error) => error.message).join('; ') || 'Invalid tool pack');
    this.name = 'AiToolPackError';
    this.errors = errors;
  }
}

/** Removes string literals and comments so structural checks ignore their contents. */
export function stripSqlLiterals(sql: string): string {
  let out = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end + 1;
      out += ' ';
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const closing = char === '[' ? ']' : char;
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === closing) {
          if (closing !== ']' && sql[cursor + 1] === closing) {
            cursor += 2;
            continue;
          }
          break;
        }
        cursor += 1;
      }
      out += char === '[' ? ' ident ' : " '' ";
      index = cursor + 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** First SQL verb, used to compare against the declared CRUD class. */
export function classifySqlVerb(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'other' {
  const stripped = stripSqlLiterals(sql).trim();
  const match = stripped.match(/^([a-zA-Z]+)/);
  const keyword = match ? match[1].toLowerCase() : '';

  if (keyword === 'with') {
    const verb = stripped.match(/\b(insert|update|delete|replace)\b/i);
    if (!verb) {
      return 'select';
    }
    const lowered = verb[1].toLowerCase();
    return lowered === 'replace' ? 'insert' : (lowered as 'insert' | 'update' | 'delete');
  }
  if (keyword === 'select' || keyword === 'values') {
    return 'select';
  }
  if (keyword === 'insert' || keyword === 'replace') {
    return 'insert';
  }
  if (keyword === 'update') {
    return 'update';
  }
  if (keyword === 'delete') {
    return 'delete';
  }
  return 'other';
}

/** Checks a single pack tool's SQL: one statement, no DDL, verb matches the declared crud. */
export function validatePackToolSql(tool: Pick<AiToolPackToolDocument, 'name' | 'sql' | 'crud'>): string[] {
  const errors: string[] = [];
  const sql = tool.sql.trim();

  if (!sql) {
    errors.push(`${tool.name}: sql is empty`);
    return errors;
  }

  const stripped = stripSqlLiterals(sql).replace(/;\s*$/, '');
  if (stripped.includes(';')) {
    errors.push(`${tool.name}: sql must be a single statement`);
  }
  if (FORBIDDEN_SQL_PATTERN.test(stripped)) {
    errors.push(`${tool.name}: sql may not contain schema or pragma statements`);
  }

  const isWrite = isWriteSql(sql);
  const verb = classifySqlVerb(sql);

  if (tool.crud === 'read') {
    if (isWrite || verb !== 'select') {
      errors.push(`${tool.name}: declared crud "read" but sql is not a read-only SELECT`);
    }
  } else {
    if (!isWrite) {
      errors.push(`${tool.name}: declared crud "${tool.crud}" but sql does not write`);
    } else if (verb === 'other') {
      errors.push(`${tool.name}: sql must be an INSERT, UPDATE or DELETE statement`);
    } else if (tool.crud === 'create' && verb !== 'insert') {
      errors.push(`${tool.name}: declared crud "create" but sql is ${verb.toUpperCase()}`);
    } else if (tool.crud === 'update' && verb !== 'update') {
      errors.push(`${tool.name}: declared crud "update" but sql is ${verb.toUpperCase()}`);
    } else if (tool.crud === 'delete' && verb !== 'delete') {
      errors.push(`${tool.name}: declared crud "delete" but sql is ${verb.toUpperCase()}`);
    }
  }

  return errors;
}

export function extractSqlParams(sql: string): string[] {
  const stripped = stripSqlLiterals(sql);
  const names = new Set<string>();
  for (const match of stripped.matchAll(PARAM_PATTERN)) {
    names.add(match[1]);
  }
  return Array.from(names);
}

function validateTool(raw: unknown, index: number, errors: AiToolPackValidationError[], packId?: string): AiToolPackToolDocument | null {
  const prefix = `tools[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push({ packId, message: `${prefix} must be an object` });
    return null;
  }

  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  const toolErrors: string[] = [];

  if (!TOOL_NAME_PATTERN.test(name)) {
    toolErrors.push(`${prefix}.name must match ${TOOL_NAME_PATTERN}`);
  }
  if (typeof record.description !== 'string' || !record.description.trim()) {
    toolErrors.push(`${name || prefix}: description is required`);
  }
  if (!isInputSchema(record.inputSchema)) {
    toolErrors.push(`${name || prefix}: inputSchema must be an object schema with typed properties`);
  }
  if (!AI_TOOL_CRUDS.includes(record.crud as AiToolCrud)) {
    toolErrors.push(`${name || prefix}: crud must be one of ${AI_TOOL_CRUDS.join(', ')}`);
  }
  if (record.consent !== undefined && !CONSENTS.includes(record.consent as AiToolConsent)) {
    toolErrors.push(`${name || prefix}: consent must be one of ${CONSENTS.join(', ')}`);
  }
  if (typeof record.sql !== 'string') {
    toolErrors.push(`${name || prefix}: sql must be a string`);
  }
  if (record.resultMode !== 'rows' && record.resultMode !== 'changes') {
    toolErrors.push(`${name || prefix}: resultMode must be "rows" or "changes"`);
  }

  if (toolErrors.length > 0) {
    errors.push(...toolErrors.map((message) => ({ packId, toolName: name || undefined, message })));
    return null;
  }

  const tool: AiToolPackToolDocument = {
    name,
    description: (record.description as string).trim(),
    inputSchema: record.inputSchema as AiToolInputSchema,
    crud: record.crud as AiToolCrud,
    consent: record.consent as AiToolConsent | undefined,
    sql: record.sql as string,
    resultMode: record.resultMode as 'rows' | 'changes',
  };

  const sqlErrors = validatePackToolSql(tool);
  const params = extractSqlParams(tool.sql);
  const properties = tool.inputSchema.properties;
  for (const param of params) {
    if (!(param in properties)) {
      sqlErrors.push(`${name}: sql parameter :${param} is not declared in inputSchema.properties`);
    }
  }
  for (const property of Object.keys(properties)) {
    const propertyType = properties[property].type;
    const types = Array.isArray(propertyType) ? propertyType : [propertyType];
    if (types.some((type) => type === 'object' || type === 'array')) {
      sqlErrors.push(`${name}: argument "${property}" must be a scalar (string, number, integer, boolean or null)`);
    }
  }
  if (tool.crud === 'read' && tool.resultMode !== 'rows') {
    sqlErrors.push(`${name}: read tools must use resultMode "rows"`);
  }

  if (sqlErrors.length > 0) {
    errors.push(...sqlErrors.map((message) => ({ packId, toolName: name, message })));
    return null;
  }

  return tool;
}

/**
 * Parses and validates a pack document. Throws `AiToolPackError` listing every
 * problem found; a pack whose declared `crud` disagrees with its SQL is
 * rejected as a whole.
 */
export function parseToolPack(raw: unknown): AiToolPackDocument {
  const errors: AiToolPackValidationError[] = [];
  let value = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AiToolPackError([{ message: 'The pack is not valid JSON' }]);
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiToolPackError([{ message: 'The pack must be a JSON object' }]);
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';

  if (!PACK_ID_PATTERN.test(id)) {
    errors.push({ message: `id must match ${PACK_ID_PATTERN}` });
  }
  if (typeof record.name !== 'string' || !record.name.trim()) {
    errors.push({ packId: id || undefined, message: 'name is required' });
  }
  if (typeof record.version !== 'string' || !record.version.trim()) {
    errors.push({ packId: id || undefined, message: 'version is required' });
  }
  if (record.author !== undefined && typeof record.author !== 'string') {
    errors.push({ packId: id || undefined, message: 'author must be a string' });
  }
  if (record.description !== undefined && typeof record.description !== 'string') {
    errors.push({ packId: id || undefined, message: 'description must be a string' });
  }
  if (!Array.isArray(record.tools) || record.tools.length === 0) {
    errors.push({ packId: id || undefined, message: 'tools must be a non-empty array' });
  }

  const tools: AiToolPackToolDocument[] = [];
  if (Array.isArray(record.tools)) {
    const seen = new Set<string>();
    record.tools.forEach((toolRaw, index) => {
      const tool = validateTool(toolRaw, index, errors, id || undefined);
      if (tool) {
        if (seen.has(tool.name)) {
          errors.push({ packId: id, toolName: tool.name, message: `${tool.name}: duplicate tool name in pack` });
        }
        seen.add(tool.name);
        tools.push(tool);
      }
    });
  }

  if (errors.length > 0) {
    throw new AiToolPackError(errors);
  }

  return {
    id,
    name: (record.name as string).trim(),
    version: (record.version as string).trim(),
    author: typeof record.author === 'string' ? record.author : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    tools,
  };
}

export interface BoundPackSql {
  sql: string;
  params: Array<string | number | boolean | null>;
}

/**
 * Validates `args` against the tool's schema and binds `:name` placeholders
 * positionally. Values are never interpolated into the SQL text, so argument
 * contents cannot change the statement.
 */
export function bindPackToolArguments(tool: AiToolPackToolDocument, args: unknown): BoundPackSql {
  const schemaErrors = validateToolArguments({ ...tool.inputSchema, additionalProperties: false }, args);
  if (schemaErrors.length > 0) {
    throw new Error(`Invalid arguments for ${tool.name}: ${schemaErrors.join('; ')}`);
  }

  const record = (args ?? {}) as Record<string, unknown>;
  const params: BoundPackSql['params'] = [];
  const stripped = stripSqlLiterals(tool.sql);

  // Rewrite placeholders in the original SQL while walking the stripped copy
  // to know which `:name` tokens are real parameters (not inside literals).
  let sql = '';
  let cursor = 0;
  for (const match of stripped.matchAll(PARAM_PATTERN)) {
    const start = match.index ?? 0;
    sql += tool.sql.slice(cursor, start) + '?';
    cursor = start + match[0].length;
    const name = match[1];
    const value = record[name];
    if (value === undefined) {
      params.push(null);
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      params.push(value);
    } else {
      throw new Error(`Argument "${name}" for ${tool.name} must be a scalar value`);
    }
  }
  sql += tool.sql.slice(cursor);

  return { sql, params };
}

/** Registry definitions for a parsed pack. */
export function packToolDefinitions(pack: AiToolPackDocument, packKey: string): AiToolDefinition[] {
  return pack.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    crud: tool.crud,
    group: pack.name,
    consentDefault: tool.consent ?? consentDefaultForCrud(tool.crud),
    source: 'pack',
    packKey,
    enabled: enabledDefaultForCrud(tool.crud),
  }));
}

export interface LoadedToolPack {
  packKey: string;
  row: AiToolPack;
  document: AiToolPackDocument;
}

export interface FailedToolPack {
  packKey: string;
  packName?: string;
  errors: AiToolPackValidationError[];
}

/** Parses stored pack rows, separating the ones that no longer validate. */
export function loadToolPackRows(rows: AiToolPack[]): { loaded: LoadedToolPack[]; failed: FailedToolPack[] } {
  const loaded: LoadedToolPack[] = [];
  const failed: FailedToolPack[] = [];

  for (const row of rows) {
    try {
      const document = parseToolPack(row.definition_json);
      loaded.push({ packKey: row.pack_key, row, document });
    } catch (error) {
      failed.push({
        packKey: row.pack_key,
        packName: row.name,
        errors: error instanceof AiToolPackError ? error.errors : [{ message: error instanceof Error ? error.message : 'Invalid pack' }],
      });
    }
  }

  return { loaded, failed };
}
