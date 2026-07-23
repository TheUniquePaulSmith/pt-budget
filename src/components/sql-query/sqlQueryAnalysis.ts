// Local, best-effort SQL analysis for the SQL Query console: syntax checking,
// a SELECT-only guard, and schema-aware unknown table/column hints. Runs
// entirely client-side against a local parser — it never talks to the
// database worker.
//
// node-sql-parser's SQLite grammar doesn't cover every construct real SQLite
// accepts (bracket-quoted identifiers, PRAGMA/EXPLAIN/VACUUM, some newer
// syntax). To avoid the console crying wolf on valid queries, a parse
// failure is always advisory (shown as a hint, never blocks Execute) —
// only a *successfully parsed* non-SELECT statement blocks execution, since
// that's unambiguous. Real correctness is always decided by the actual
// SQLite engine when the query runs.
import type { SqlSchemaMap } from '@/lib/sqlSchemaIntrospection';

export interface SqlQueryIssue {
  severity: 'error' | 'warning';
  message: string;
  from: number;
  to: number;
}

export interface SqlQueryAnalysis {
  issues: SqlQueryIssue[];
  blockingReason: string | null;
}

const STATEMENT_LABELS: Record<string, string> = {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  create: 'CREATE',
  drop: 'DROP',
  alter: 'ALTER',
  replace: 'REPLACE',
  truncate: 'TRUNCATE',
  attach: 'ATTACH',
  detach: 'DETACH',
  transaction: 'TRANSACTION',
};

// Statements this page's parser can't reliably lint but that are legitimate,
// non-mutating (or diagnostic) SQLite commands — skip analysis rather than
// show a false "syntax error".
const NON_LINTABLE_PREFIX = /^\s*(PRAGMA|EXPLAIN|VACUUM|ANALYZE)\b/i;

function normalizeForParser(sql: string): string {
  // SQLite's `[identifier]` bracket-quoting isn't in node-sql-parser's
  // grammar; rewrite to standard double quotes for local analysis only —
  // the original text is always what gets sent to the real database.
  return sql.replace(/\[([^[\]\r\n]+)]/g, '"$1"');
}

function clampRange(text: string, from: number, to: number): { from: number; to: number } {
  const max = text.length;
  const safeFrom = Math.min(Math.max(from, 0), max);
  const minTo = Math.min(safeFrom + 1, max);
  const safeTo = Math.min(Math.max(to, minTo), max);
  return { from: safeFrom, to: Math.max(safeTo, safeFrom) };
}

function findIdentifierRange(text: string, name: string): { from: number; to: number } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(text);
  if (!match) {
    return null;
  }
  return { from: match.index, to: match.index + match[0].length };
}

export async function analyzeSqlQuery(
  sql: string,
  schema: SqlSchemaMap | null
): Promise<SqlQueryAnalysis> {
  const issues: SqlQueryIssue[] = [];

  if (!sql.trim() || NON_LINTABLE_PREFIX.test(sql)) {
    return { issues, blockingReason: null };
  }

  const { Parser } = await import('node-sql-parser/build/sqlite');
  const parser = new Parser();
  const normalized = normalizeForParser(sql);

  let ast: unknown;
  try {
    ast = parser.astify(normalized);
  } catch (err) {
    const location = (err as { location?: { start?: { offset?: number }; end?: { offset?: number } } })
      ?.location;
    const from = typeof location?.start?.offset === 'number' ? location.start.offset : 0;
    const rawTo = typeof location?.end?.offset === 'number' ? location.end.offset : from + 1;
    const range = clampRange(sql, from, rawTo);
    const message = err instanceof Error ? err.message.split('\n')[0] : 'Unable to parse query.';
    issues.push({ severity: 'error', message: `Syntax error: ${message}`, ...range });
    return { issues, blockingReason: null };
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length > 1) {
    issues.push({
      severity: 'warning',
      message: 'Multiple statements detected — only the first statement will run.',
      ...clampRange(sql, 0, 1),
    });
  }

  let blockingReason: string | null = null;
  for (const statement of statements) {
    const type = typeof (statement as { type?: unknown })?.type === 'string'
      ? (statement as { type: string }).type
      : 'unknown';
    if (type !== 'select') {
      const label = STATEMENT_LABELS[type] ?? type.toUpperCase();
      blockingReason = `This page only runs SELECT queries — remove the ${label} statement.`;
      issues.push({
        severity: 'error',
        message: `Only SELECT queries are allowed here (found ${label}).`,
        ...clampRange(sql, 0, 1),
      });
    }
  }

  const hasParseLevelError = issues.some((issue) => issue.severity === 'error');
  if (schema && Object.keys(schema).length > 0 && !hasParseLevelError) {
    try {
      const tableRefs = parser.tableList(normalized) as string[];
      const seenTables = new Set<string>();
      for (const ref of tableRefs) {
        const tableName = ref.split('::').pop();
        if (!tableName || seenTables.has(tableName)) {
          continue;
        }
        seenTables.add(tableName);
        if (!schema[tableName.toLowerCase()]) {
          const range = findIdentifierRange(sql, tableName);
          if (range) {
            issues.push({ severity: 'error', message: `Unknown table "${tableName}".`, ...range });
          }
        }
      }
    } catch {
      // Best-effort: table extraction can fail independently of astify.
    }

    try {
      const columnRefs = parser.columnList(normalized) as string[];
      const seenColumns = new Set<string>();
      for (const ref of columnRefs) {
        const [, tableName, columnName] = ref.split('::');
        if (!columnName || columnName === '(.*)' || !tableName || tableName === 'null') {
          continue;
        }
        const key = `${tableName}.${columnName}`;
        if (seenColumns.has(key)) {
          continue;
        }
        seenColumns.add(key);
        const table = schema[tableName.toLowerCase()];
        if (table && !table.columns.some((column) => column.name.toLowerCase() === columnName.toLowerCase())) {
          const range = findIdentifierRange(sql, columnName);
          if (range) {
            issues.push({
              severity: 'warning',
              message: `Column "${columnName}" was not found on table "${table.name}".`,
              ...range,
            });
          }
        }
      }
    } catch {
      // Best-effort: column extraction can fail independently of astify.
    }
  }

  return { issues, blockingReason };
}
