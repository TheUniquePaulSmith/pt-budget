import { describe, expect, it } from 'vitest';

import { analyzeSqlQuery } from './sqlQueryAnalysis';
import type { SqlSchemaMap } from '@/lib/sqlSchemaIntrospection';

const schema: SqlSchemaMap = {
  transactions: {
    name: 'transactions',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true },
      { name: 'date', type: 'DATE', notNull: true, primaryKey: false },
      { name: 'amount', type: 'REAL', notNull: true, primaryKey: false },
      { name: 'category_id', type: 'INTEGER', notNull: false, primaryKey: false },
    ],
  },
  categories: {
    name: 'categories',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true },
      { name: 'name', type: 'TEXT', notNull: true, primaryKey: false },
    ],
  },
};

describe('analyzeSqlQuery', () => {
  it('returns no issues for an empty query', async () => {
    const result = await analyzeSqlQuery('   ', schema);
    expect(result).toEqual({ issues: [], blockingReason: null });
  });

  it('returns no issues for a valid, schema-clean SELECT', async () => {
    const result = await analyzeSqlQuery('SELECT id, amount FROM transactions WHERE amount > 0;', schema);
    expect(result.issues).toEqual([]);
    expect(result.blockingReason).toBeNull();
  });

  it('flags and blocks non-SELECT statements', async () => {
    const result = await analyzeSqlQuery("DELETE FROM transactions WHERE id = 1;", schema);
    expect(result.blockingReason).toMatch(/only runs SELECT/i);
    expect(result.issues.some((issue) => issue.severity === 'error' && /DELETE/.test(issue.message))).toBe(true);
  });

  it('reports a syntax error without blocking execution', async () => {
    const result = await analyzeSqlQuery('SELECT FROM WHERE', schema);
    expect(result.blockingReason).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toMatch(/syntax error/i);
  });

  it('flags an unknown table', async () => {
    const result = await analyzeSqlQuery('SELECT * FROM not_a_real_table;', schema);
    expect(result.blockingReason).toBeNull();
    expect(result.issues.some((issue) => /Unknown table "not_a_real_table"/.test(issue.message))).toBe(true);
  });

  it('flags an unknown column resolvable to a known table', async () => {
    const result = await analyzeSqlQuery('SELECT t.not_a_column FROM transactions t;', schema);
    expect(result.issues.some((issue) => /Column "not_a_column"/.test(issue.message))).toBe(true);
  });

  it('does not flag ambiguous columns it cannot resolve to a table', async () => {
    const result = await analyzeSqlQuery(
      "SELECT strftime('%Y-%m', date) as month FROM transactions;",
      schema
    );
    expect(result.issues.filter((issue) => issue.message.startsWith('Column'))).toHaveLength(0);
  });

  it('normalizes bracket-quoted identifiers before parsing', async () => {
    const result = await analyzeSqlQuery(
      "SELECT p.[notnull] FROM sqlite_master m LEFT OUTER JOIN pragma_table_info(m.name) p WHERE m.type = 'table';",
      null
    );
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('skips analysis for PRAGMA/EXPLAIN/VACUUM statements', async () => {
    const result = await analyzeSqlQuery('EXPLAIN QUERY PLAN SELECT * FROM transactions;', schema);
    expect(result).toEqual({ issues: [], blockingReason: null });
  });

  it('warns about multiple statements without blocking', async () => {
    const result = await analyzeSqlQuery('SELECT 1; SELECT 2;', schema);
    expect(result.blockingReason).toBeNull();
    expect(result.issues.some((issue) => issue.severity === 'warning' && /Multiple statements/.test(issue.message))).toBe(true);
  });
});
