import { describe, expect, it } from 'vitest';

import {
  AiToolPackError,
  bindPackToolArguments,
  classifySqlVerb,
  extractSqlParams,
  loadToolPackRows,
  packToolDefinitions,
  parseToolPack,
  validatePackToolSql,
} from './jsonToolPack';
import type { AiToolPackToolDocument } from '@/types/aiTools';

const readTool: AiToolPackToolDocument = {
  name: 'spend_by_category',
  description: 'Spend per category',
  inputSchema: {
    type: 'object',
    properties: {
      startDate: { type: 'string' },
      endDate: { type: 'string' },
    },
    required: ['startDate', 'endDate'],
  },
  crud: 'read',
  sql: "SELECT category_id, SUM(amount) AS total FROM transactions WHERE date BETWEEN :startDate AND :endDate AND description <> ':notAParam' GROUP BY category_id",
  resultMode: 'rows',
};

const updateTool: AiToolPackToolDocument = {
  name: 'set_note',
  description: 'Set a note',
  inputSchema: {
    type: 'object',
    properties: {
      transactionId: { type: 'integer' },
      note: { type: ['string', 'null'] },
    },
    required: ['transactionId', 'note'],
  },
  crud: 'update',
  sql: 'UPDATE transactions SET comment = :note WHERE id = :transactionId',
  resultMode: 'changes',
};

function pack(tools: unknown[], overrides: Record<string, unknown> = {}) {
  return { id: 'test-pack', name: 'Test pack', version: '1.0.0', author: 'tests', tools, ...overrides };
}

describe('parseToolPack', () => {
  it('accepts a valid pack from an object or a JSON string', () => {
    const parsed = parseToolPack(pack([readTool, updateTool]));
    expect(parsed.id).toBe('test-pack');
    expect(parsed.tools).toHaveLength(2);

    const fromString = parseToolPack(JSON.stringify(pack([readTool])));
    expect(fromString.tools[0].name).toBe('spend_by_category');
  });

  it('rejects a pack whose declared crud disagrees with its SQL', () => {
    expect(() => parseToolPack(pack([{ ...readTool, sql: 'DELETE FROM transactions WHERE id = :startDate' }])))
      .toThrow(/declared crud "read" but sql is not a read-only SELECT/);

    expect(() => parseToolPack(pack([{ ...updateTool, sql: 'SELECT 1' }])))
      .toThrow(/declared crud "update" but sql does not write/);

    expect(() => parseToolPack(pack([{ ...updateTool, crud: 'create' }])))
      .toThrow(/declared crud "create" but sql is UPDATE/);

    expect(() => parseToolPack(pack([{ ...updateTool, crud: 'delete' }])))
      .toThrow(/declared crud "delete" but sql is UPDATE/);
  });

  it('accepts mixed for any write and rejects CTE reads declared as writes', () => {
    expect(() => parseToolPack(pack([{ ...updateTool, crud: 'mixed' }]))).not.toThrow();
    expect(() => parseToolPack(pack([{ ...updateTool, crud: 'mixed', sql: 'WITH x AS (SELECT 1) SELECT * FROM x' }])))
      .toThrow(/does not write/);
    expect(() => parseToolPack(pack([{ ...readTool, sql: 'WITH x AS (SELECT 1) DELETE FROM transactions' }])))
      .toThrow(/not a read-only SELECT/);
  });

  it('rejects multi-statement, DDL and pragma SQL', () => {
    expect(() => parseToolPack(pack([{ ...readTool, sql: 'SELECT 1; DROP TABLE transactions' }]))).toThrow(/single statement/);
    expect(() => parseToolPack(pack([{ ...readTool, sql: 'PRAGMA table_info(transactions)' }]))).toThrow(/schema or pragma/);
    expect(() => parseToolPack(pack([{ ...updateTool, sql: 'ALTER TABLE transactions ADD COLUMN x' }]))).toThrow(/schema or pragma/);
    // A semicolon inside a string literal is fine.
    expect(() => parseToolPack(pack([{ ...readTool, sql: "SELECT 'a;b' AS x" }]))).not.toThrow();
  });

  it('rejects undeclared parameters, non-scalar arguments and bad names', () => {
    expect(() => parseToolPack(pack([{ ...readTool, sql: 'SELECT * FROM transactions WHERE id = :missing' }])))
      .toThrow(/:missing is not declared/);
    expect(() => parseToolPack(pack([{ ...readTool, inputSchema: { type: 'object', properties: { startDate: { type: 'object' }, endDate: { type: 'string' } } } }])))
      .toThrow(/must be a scalar/);
    expect(() => parseToolPack(pack([{ ...readTool, name: 'Bad-Name' }]))).toThrow(/name must match/);
    expect(() => parseToolPack(pack([readTool], { id: '../etc' }))).toThrow(/id must match/);
    expect(() => parseToolPack(pack([readTool, readTool]))).toThrow(/duplicate tool name/);
    expect(() => parseToolPack(pack([{ ...readTool, resultMode: 'changes' }]))).toThrow(/read tools must use resultMode "rows"/);
  });

  it('collects every problem into AiToolPackError', () => {
    try {
      parseToolPack(pack([{ ...readTool, sql: 'DELETE FROM x' }, { ...updateTool, crud: 'read' }], { version: '' }));
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AiToolPackError);
      expect((error as AiToolPackError).errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('rejects invalid JSON and non-object documents', () => {
    expect(() => parseToolPack('{not json')).toThrow(/not valid JSON/);
    expect(() => parseToolPack([])).toThrow(/must be a JSON object/);
    expect(() => parseToolPack(pack([]))).toThrow(/non-empty array/);
  });
});

describe('validatePackToolSql / classifySqlVerb', () => {
  it('classifies verbs ignoring comments and literals', () => {
    expect(classifySqlVerb('-- note\nSELECT 1')).toBe('select');
    expect(classifySqlVerb('/* x */ insert into t values (1)')).toBe('insert');
    expect(classifySqlVerb("UPDATE t SET a = 'delete' WHERE 1")).toBe('update');
    expect(classifySqlVerb('WITH c AS (SELECT 1) UPDATE t SET a = 1')).toBe('update');
    expect(classifySqlVerb('REPLACE INTO t VALUES (1)')).toBe('insert');
    expect(classifySqlVerb('VACUUM')).toBe('other');
  });

  it('flags an empty statement', () => {
    expect(validatePackToolSql({ name: 't', sql: '  ', crud: 'read' })).toEqual(['t: sql is empty']);
  });
});

describe('bindPackToolArguments', () => {
  it('rewrites :params positionally and never interpolates values', () => {
    const bound = bindPackToolArguments(readTool, { startDate: "2026-01-01' OR 1=1 --", endDate: '2026-01-31' });

    expect(bound.sql).toBe("SELECT category_id, SUM(amount) AS total FROM transactions WHERE date BETWEEN ? AND ? AND description <> ':notAParam' GROUP BY category_id");
    expect(bound.params).toEqual(["2026-01-01' OR 1=1 --", '2026-01-31']);
    expect(bound.sql).not.toContain('OR 1=1');
  });

  it('binds repeated and null parameters in SQL order', () => {
    const tool: AiToolPackToolDocument = {
      ...updateTool,
      sql: 'UPDATE transactions SET comment = :note, description = :note WHERE id = :transactionId',
    };
    const bound = bindPackToolArguments(tool, { transactionId: 7, note: null });
    expect(bound.sql).toBe('UPDATE transactions SET comment = ?, description = ? WHERE id = ?');
    expect(bound.params).toEqual([null, null, 7]);
  });

  it('rejects arguments that fail the schema or add unknown keys', () => {
    expect(() => bindPackToolArguments(updateTool, { transactionId: 'seven', note: 'x' })).toThrow(/transactionId must be of type integer/);
    expect(() => bindPackToolArguments(updateTool, { transactionId: 1 })).toThrow(/note is required/);
    expect(() => bindPackToolArguments(updateTool, { transactionId: 1, note: 'x', extra: 'DROP TABLE' })).toThrow(/extra is not an allowed argument/);
    expect(() => bindPackToolArguments(updateTool, { transactionId: 1, note: { nested: true } })).toThrow(/must be of type string \| null/);
  });

  it('binds undeclared optional params as null', () => {
    const tool: AiToolPackToolDocument = {
      ...readTool,
      inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
      sql: 'SELECT * FROM transactions LIMIT COALESCE(:limit, 10)',
    };
    expect(bindPackToolArguments(tool, {})).toEqual({ sql: 'SELECT * FROM transactions LIMIT COALESCE(?, 10)', params: [null] });
  });
});

describe('extractSqlParams / packToolDefinitions / loadToolPackRows', () => {
  it('extracts unique parameter names outside literals', () => {
    expect(extractSqlParams(readTool.sql)).toEqual(['startDate', 'endDate']);
  });

  it('applies safe defaults per crud and the pack consent override', () => {
    const definitions = packToolDefinitions(parseToolPack(pack([readTool, { ...updateTool, consent: 'deny' }])), 'user:test-pack');
    expect(definitions[0]).toMatchObject({ source: 'pack', packKey: 'user:test-pack', crud: 'read', consentDefault: 'always', enabled: true, group: 'Test pack' });
    expect(definitions[1]).toMatchObject({ crud: 'update', consentDefault: 'deny', enabled: true });
  });

  it('separates rows that no longer validate', () => {
    const { loaded, failed } = loadToolPackRows([
      { id: 1, pack_key: 'user:ok', name: 'ok', version: '1', source: 'user', enabled: 1, definition_json: JSON.stringify(pack([readTool], { id: 'ok' })), created_at: '', updated_at: '' },
      { id: 2, pack_key: 'user:bad', name: 'bad', version: '1', source: 'user', enabled: 1, definition_json: '{"id":"bad"}', created_at: '', updated_at: '' },
    ]);
    expect(loaded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].packKey).toBe('user:bad');
  });
});
