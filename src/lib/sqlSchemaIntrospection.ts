// Live schema introspection for the SQL Query page's editor tooling
// (autocomplete + local linting). Reads the actual current schema from the
// database itself via sqlite_master/pragma_table_info, so it never drifts
// from public/database-schema.js or any migration applied at runtime.

export interface SqlColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

export interface SqlTableInfo {
  name: string;
  columns: SqlColumnInfo[];
}

// Keyed by lowercase table name for case-insensitive lookups.
export type SqlSchemaMap = Record<string, SqlTableInfo>;

export const SQL_SCHEMA_INTROSPECTION_QUERY = `
SELECT
  m.name AS table_name,
  p.cid AS column_position,
  p.name AS column_name,
  p.type AS data_type,
  p.[notnull] AS not_null,
  p.pk AS primary_key
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type IN ('table', 'view')
  AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid
`;

interface SchemaIntrospectionRow {
  table_name?: unknown;
  column_name?: unknown;
  data_type?: unknown;
  not_null?: unknown;
  primary_key?: unknown;
}

function isTruthySqlFlag(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function buildSqlSchemaMap(rows: SchemaIntrospectionRow[]): SqlSchemaMap {
  const schema: SqlSchemaMap = {};

  for (const row of rows) {
    if (typeof row.table_name !== 'string' || typeof row.column_name !== 'string') {
      continue;
    }

    const key = row.table_name.toLowerCase();
    const table = schema[key] ?? { name: row.table_name, columns: [] };
    table.columns.push({
      name: row.column_name,
      type: typeof row.data_type === 'string' ? row.data_type : '',
      notNull: isTruthySqlFlag(row.not_null),
      primaryKey: isTruthySqlFlag(row.primary_key),
    });
    schema[key] = table;
  }

  return schema;
}

export async function fetchSqlSchema(
  executeCustomQuery: (sql: string, timeoutMs?: number) => Promise<unknown[]>,
  timeoutMs = 10000
): Promise<SqlSchemaMap> {
  const rows = (await executeCustomQuery(
    SQL_SCHEMA_INTROSPECTION_QUERY,
    timeoutMs
  )) as SchemaIntrospectionRow[];
  return buildSqlSchemaMap(rows);
}

// Shape CodeMirror's @codemirror/lang-sql `schema` option expects: a map from
// table name to its column names.
export function toCodeMirrorSchema(schema: SqlSchemaMap): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const table of Object.values(schema)) {
    result[table.name] = table.columns.map((column) => column.name);
  }
  return result;
}
