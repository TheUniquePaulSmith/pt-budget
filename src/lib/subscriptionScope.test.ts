/**
 * Subscriptions under the shared account/user filter, on real SQLite
 * (node:sqlite) through the real DatabaseService: the same scope rule as the
 * Dashboard (a charge belongs to its account's owner unless its card names
 * another user) narrows the series list, their stats and the unmatched clusters.
 */
import { describe, expect, it } from 'vitest';

import { CREATE_INDEXES, CREATE_TABLES } from '../../public/database-schema.js';
import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';

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

/**
 * Pat (user 1) owns checking (account 1) and the card account (account 2);
 * Riley (user 2) holds card 20 on Pat's card account. Riley owns account 3.
 */
function setup() {
  const db = new sqlite!.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const createTableSql of Object.values(CREATE_TABLES)) db.exec(createTableSql as string);
  for (const createIndexSql of CREATE_INDEXES) db.exec(createIndexSql);
  db.exec(`
    INSERT INTO users (id, display_name) VALUES (1, 'Pat'), (2, 'Riley');
    INSERT INTO accounts (id, name, type, owner_user_id) VALUES
      (1, 'Checking', 'checking', 1), (2, 'Visa', 'credit', 1), (3, 'Riley Checking', 'checking', 2);
    INSERT INTO account_cards (id, account_id, last_four, user_id) VALUES (10, 2, '1111', 1), (20, 2, '2222', 2);
    INSERT INTO recurring_series (id, name, match_key, status, kind) VALUES
      (1, 'Streaming', 'desc:streaming', 'active', 'subscription'),
      (2, 'Gym', 'desc:gym', 'active', 'subscription');
  `);
  const tx = db.prepare(
    `INSERT INTO transactions (id, date, amount, description, account_id, card_id, type, transaction_hash)
     VALUES (?, ?, ?, ?, ?, ?, 'expense', ?)`
  );
  const link = db.prepare('INSERT INTO transaction_series_links (transaction_id, series_id) VALUES (?, ?)');
  // Streaming: Pat's checking in January, Riley's card in February.
  tx.run(1, '2026-01-05', -10, 'STREAMING', 1, null, 'h1');
  tx.run(2, '2026-02-05', -10, 'STREAMING', 2, 20, 'h2');
  link.run(1, 1);
  link.run(2, 1);
  // Gym: Pat's card only.
  tx.run(3, '2026-01-10', -40, 'GYM', 2, 10, 'h3');
  link.run(3, 2);
  // Unlinked repeating charge on Riley's own account.
  tx.run(4, '2026-01-20', -5, 'COFFEE CLUB', 3, null, 'h4');
  tx.run(5, '2026-02-20', -5, 'COFFEE CLUB', 3, null, 'h5');
  tx.run(6, '2026-03-20', -5, 'COFFEE CLUB', 3, null, 'h6');

  const query = async (sql: string, parameters: unknown[] = []) => db.prepare(sql).all(...parameters) as any[];
  return new DatabaseService({ query, queryWithTimeout: query } as unknown as DatabaseWorkerTransport);
}

const stats = (series: Array<{ name: string; transaction_count?: number; total_spent?: number }>) =>
  Object.fromEntries(series.map((item) => [item.name, [item.transaction_count, item.total_spent]]));

describe.skipIf(!sqlite)('subscriptions with the account/user filter (node:sqlite)', () => {
  it('without a filter, every series counts every charge', async () => {
    expect(stats(await setup().getRecurringSeriesWithStats())).toEqual({ Gym: [1, 40], Streaming: [2, 20] });
  });

  it('an account filter keeps series that charged those accounts and counts only those charges', async () => {
    const service = setup();
    expect(stats(await service.getRecurringSeriesWithStats(undefined, { accountIds: [1] }))).toEqual({ Streaming: [1, 10] });
    expect(stats(await service.getRecurringSeriesWithStats(undefined, { accountIds: [2] }))).toEqual({
      Gym: [1, 40],
      Streaming: [1, 10],
    });
  });

  it('a user filter follows the card holder before the account owner', async () => {
    const service = setup();
    // Riley's card charge on Pat's account belongs to Riley.
    expect(stats(await service.getRecurringSeriesWithStats(undefined, { userIds: [2] }))).toEqual({ Streaming: [1, 10] });
    expect(stats(await service.getRecurringSeriesWithStats(undefined, { userIds: [1] }))).toEqual({
      Gym: [1, 40],
      Streaming: [1, 10],
    });
  });

  it('keeps an in-scope series with no charges in the date range, at zero', async () => {
    const series = await setup().getRecurringSeriesWithStats({ startDate: '2026-02-01', endDate: '2026-02-28' }, { accountIds: [1] });
    expect(stats(series)).toEqual({ Streaming: [0, 0] });
  });

  it('unmatched clusters count only the charges in scope', async () => {
    const service = setup();
    expect((await service.getUnmatchedRecurringClusters(3)).map((cluster) => cluster.normalized_description)).toEqual(['COFFEE CLUB']);
    expect(await service.getUnmatchedRecurringClusters(3, { userIds: [1] })).toEqual([]);
    expect((await service.getUnmatchedRecurringClusters(3, { accountIds: [3] }))[0].occurrences).toBe(3);
  });
});
