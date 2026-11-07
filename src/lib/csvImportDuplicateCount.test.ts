/**
 * CSV import duplicate counting on real SQLite (node:sqlite).
 *
 * The analysis step shows "Already in database" from CHECK_DUPLICATES_IN_TEMP
 * and the import inserts with BULK_INSERT_FROM_TEMP; both must agree on which
 * staged rows are already stored. The count is per staged row: one CSV row
 * matching many stored rows (a repeated bank reference) used to push
 * "unique to import" negative.
 */
import { describe, expect, it } from 'vitest';

import { CREATE_INDEXES, CREATE_TABLES } from '../../public/database-schema.js';
import { TRANSACTION_QUERIES } from './sqlQueries';

interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): unknown;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
interface SqliteModule {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

const sqlite: SqliteModule | null = await import(/* @vite-ignore */ ('node:sqlite' as string))
  .then((module) => module as unknown as SqliteModule)
  .catch(() => null);

type Row = { date: string; amount: number; description: string; hash: string; ref?: string | null };

function setup(stored: Row[], staged: Row[]) {
  const db = new sqlite!.DatabaseSync(':memory:');
  // node:sqlite enforces foreign keys by default; these rows need no account.
  db.exec('PRAGMA foreign_keys = OFF');
  for (const createTableSql of Object.values(CREATE_TABLES)) db.exec(createTableSql as string);
  for (const createIndexSql of CREATE_INDEXES) db.exec(createIndexSql);
  const insert = (table: string) =>
    db.prepare(
      `INSERT INTO ${table} (date, amount, description, account_id, type, transaction_hash, external_id) VALUES (?, ?, ?, 4, 'expense', ?, ?)`
    );
  const storeRow = insert('transactions');
  const stageRow = insert('temp_import_transactions');
  for (const row of stored) storeRow.run(row.date, row.amount, row.description, row.hash, row.ref ?? null);
  for (const row of staged) stageRow.run(row.date, row.amount, row.description, row.hash, row.ref ?? null);
  return db;
}

function countOf(db: SqliteDatabase, sql: string): number {
  return (db.prepare(sql).all() as Array<{ count: number }>)[0].count;
}

describe.skipIf(!sqlite)('CSV import duplicate count (node:sqlite)', () => {
  it('counts staged rows, not stored rows, and matches what the import skips', () => {
    // Twelve stored monthly transfers share reference "0" and amount -250.
    const stored: Row[] = Array.from({ length: 12 }, (_, month) => ({
      date: `2026-${String(month + 1).padStart(2, '0')}-01`,
      amount: -250,
      description: `TFR TO SAVINGS ${month + 1}`,
      hash: `stored-${month}`,
      ref: '0',
    }));
    const staged: Row[] = [
      // Already stored (same hash).
      { ...stored[11], ref: '0' },
      // New, but its reference "0" + amount match every stored transfer.
      { date: '2026-12-01', amount: -250, description: 'TFR TO SAVINGS 13', hash: 'new-1', ref: '0' },
      // New, no reference.
      { date: '2026-12-02', amount: -9, description: 'Coffee', hash: 'new-2', ref: null },
    ];
    const db = setup(stored, staged);

    const duplicates = db.prepare(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP).all();
    // Never more than the staged rows (the old query returned 12 stored rows here).
    expect(duplicates.length).toBe(2);

    const before = countOf(db, 'SELECT COUNT(*) AS count FROM transactions');
    db.prepare(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP).run(null);
    const inserted = countOf(db, 'SELECT COUNT(*) AS count FROM transactions') - before;
    expect(inserted).toBe(staged.length - duplicates.length);
  });

  it('with the placeholder reference dropped, only hash matches count as duplicates', () => {
    const stored: Row[] = [{ date: '2026-11-01', amount: -250, description: 'TFR 1101', hash: 'h-1', ref: '0' }];
    const staged: Row[] = [
      { date: '2026-11-01', amount: -250, description: 'TFR 1101', hash: 'h-1', ref: null },
      { date: '2026-12-01', amount: -250, description: 'TFR 1201', hash: 'h-2', ref: null },
    ];
    const db = setup(stored, staged);

    expect(db.prepare(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP).all()).toEqual([{ transaction_hash: 'h-1' }]);
  });

  it('imports both copies of a new in-file pair (staged under seeds 0 and 1)', () => {
    const staged: Row[] = [
      { date: '2026-11-01', amount: 100, description: 'VENMO CASHOUT', hash: 'h-seed0' },
      { date: '2026-11-01', amount: 100, description: 'VENMO CASHOUT', hash: 'h-seed1' },
    ];
    const db = setup([], staged);

    expect(db.prepare(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP).all()).toHaveLength(0);
    db.prepare(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP).run(null);
    expect(countOf(db, 'SELECT COUNT(*) AS count FROM transactions')).toBe(2);
  });

  it('re-importing a stored pair finds both copies already in the database', () => {
    const pair: Row[] = [
      { date: '2026-05-18', amount: 100, description: 'VENMO CASHOUT', hash: 'h-seed0' },
      { date: '2026-05-18', amount: 100, description: 'VENMO CASHOUT', hash: 'h-seed1' },
    ];
    const db = setup(pair, pair);

    expect(db.prepare(TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP).all()).toHaveLength(2);
    db.prepare(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP).run(null);
    expect(countOf(db, 'SELECT COUNT(*) AS count FROM transactions')).toBe(2);
  });

  it('an unseeded in-file pair is what used to fail the whole import', () => {
    const staged: Row[] = [
      { date: '2026-11-01', amount: 100, description: 'VENMO CASHOUT', hash: 'same' },
      { date: '2026-11-01', amount: 100, description: 'VENMO CASHOUT', hash: 'same' },
    ];
    const db = setup([], staged);

    expect(() => db.prepare(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP).run(null)).toThrow(/UNIQUE/);
  });
});
