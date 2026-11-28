/**
 * Trip business expenses against a real SQLite database (Node's built-in
 * node:sqlite), so the SQL itself runs: the joins, the cap at the charge,
 * the prune sweep, the numbered parameters and the currency conversion.
 * Skips with a reason when node:sqlite is unavailable.
 */
import { describe, expect, it } from 'vitest';

import { CREATE_INDEXES, CREATE_TABLES } from '../../public/database-schema.js';
import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';

interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
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

function bind(parameters: unknown[] = []) {
  return parameters.map((value) => (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value));
}

function createTransport(db: SqliteDatabase): DatabaseWorkerTransport {
  const query = async (sql: string, parameters: unknown[] = []) => db.prepare(sql).all(...bind(parameters)) as any[];
  return { query, queryWithTimeout: query } as unknown as DatabaseWorkerTransport;
}

function setup() {
  const db = new sqlite!.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of Object.values(CREATE_TABLES)) db.exec(sql);
  for (const sql of CREATE_INDEXES) db.exec(sql);
  db.exec(`
    INSERT INTO users (id, display_name) VALUES (1, 'Alex'), (2, 'Sam');
    INSERT INTO accounts (id, name, type, owner_user_id, currency) VALUES
      (1, 'Card', 'credit', 1, 'USD'), (2, 'Spouse card', 'credit', 2, 'USD'),
      (3, 'Checking', 'checking', 1, 'USD'), (4, 'Euro card', 'credit', 1, 'EUR'), (5, 'Yen card', 'credit', 1, 'JPY');
    INSERT INTO exchange_rates (currency, rate) VALUES ('EUR', 1.1);
    INSERT INTO categories (id, name, color, type) VALUES (1, 'Travel', '#111', 'expense'), (2, 'Dining', '#222', 'expense');
    INSERT INTO companies (id, name) VALUES (1, 'Airline');
    INSERT INTO projects (id, name) VALUES (1, 'Kitchen');
    INSERT INTO trips (id, name, trip_category, status, start_date, end_date, expense_mode) VALUES
      (1, 'SF work weekend', 'business', 'completed', '2026-10-08', '2026-10-12', 'mixed'),
      (2, 'Conference', 'business', 'completed', '2026-09-01', '2026-09-03', 'business');
    INSERT INTO transactions (id, date, amount, description, account_id, category_id, company_id, project_id, type, transaction_hash) VALUES
      (1, '2026-10-08', -450, 'Airline', 1, 1, 1, NULL, 'expense', 'h1'),
      (2, '2026-10-09', -900, 'Hotel', 1, 1, NULL, 1, 'expense', 'h2'),
      (3, '2026-10-10', -120, 'Dinner', 2, 2, NULL, NULL, 'expense', 'h3'),
      (4, '2026-10-11', 20, 'Shop refund', 2, NULL, NULL, NULL, 'refund', 'h4'),
      (5, '2026-10-10', -100, 'Euro taxi', 4, 1, NULL, NULL, 'expense', 'h5'),
      (6, '2026-10-10', -5000, 'Yen gift', 5, NULL, NULL, NULL, 'expense', 'h6'),
      (7, '2026-10-31', 4200, 'Payroll', 3, NULL, NULL, NULL, 'income', 'h7'),
      (8, '2026-11-02', 300, 'Expense report payout', 3, NULL, NULL, NULL, 'income', 'h8'),
      (9, '2026-09-02', -80, 'Conference lunch', 1, 2, NULL, NULL, 'expense', 'h9'),
      (10, '2026-06-01', -40, 'Far away', 1, 2, NULL, NULL, 'expense', 'h10');
  `);
  return { db, service: new DatabaseService(createTransport(db)) };
}

describe.skipIf(!sqlite)('trip business expenses on SQLite', () => {
  it('assigns rows, splits them, records reimbursements and adds it all up', async () => {
    const { db, service } = setup();
    const trips = service.tripExpenses;

    // Candidates are expenses and refunds in the window that are on no trip.
    const candidates = await trips.findCandidates('2026-10-05', '2026-10-15');
    expect(candidates.map((row) => row.transaction_id)).toEqual([1, 2, 3, 5, 6, 4]);

    await trips.assignTransactions([1, 2, 3, 4, 5, 6], 1);
    // The hotel was on a project: a row is on a project or a trip, not both.
    expect(db.prepare('SELECT project_id, trip_id FROM transactions WHERE id = 2').get()).toEqual({ project_id: null, trip_id: 1 });
    // A mixed trip starts everything personal.
    expect(db.prepare('SELECT COUNT(*) AS n FROM trip_expense_allocations').get()).toEqual({ n: 0 });

    await trips.setAllocations([
      { transactionId: 1, businessAmount: 450, status: 'submitted' },
      { transactionId: 2, businessAmount: 600 },
      { transactionId: 5, businessAmount: 100 },
    ]);

    let detail = await trips.getDetail(1);
    // 450 + 900 + 120 - 20 + 110 (EUR at 1.1); the yen row has no rate.
    expect(detail.summary.gross_spend).toBe(1560);
    expect(detail.summary.business_share).toBe(1160);
    expect(detail.summary.personal_share).toBe(400);
    expect(detail.summary.missing_rate_count).toBe(1);
    expect(detail.rows.find((row) => row.transaction_id === 3)).toMatchObject({ user_name: 'Sam', business_amount: null, status: null });

    // The reimbursement arrived inside the paycheck: the paycheck stays income.
    await trips.addReimbursement({ tripId: 1, amount: 1100, receivedDate: '2026-10-31', transactionId: 7, markReimbursedIds: [1, 2] });
    // A second, reimbursement-only payout becomes a refund off the trip.
    await trips.addReimbursement({ tripId: 1, amount: 50, transactionId: 8, countDepositAsRefund: true });
    expect(db.prepare('SELECT type FROM transactions WHERE id = 7').get()).toEqual({ type: 'income' });
    expect(db.prepare('SELECT type, type_locked, type_source, trip_id FROM transactions WHERE id = 8').get()).toEqual({
      type: 'refund',
      type_locked: 1,
      type_source: 'manual',
      trip_id: null,
    });

    detail = await trips.getDetail(1);
    expect(detail.summary).toMatchObject({ received: 1150, outstanding: 10, net_cost: 410 });
    expect(detail.summary.status_counts).toEqual({ pending: 1, submitted: 0, reimbursed: 2, denied: 0 });
    expect(detail.receipts[0]).toMatchObject({ transaction_id: 8, amount: 50, transaction_type: 'refund' });
    expect(detail.receipts[1]).toMatchObject({ transaction_description: 'Payroll', transaction_type: 'income' });

    // Editing the charge down caps the business part at it.
    db.exec('UPDATE transactions SET amount = -500 WHERE id = 2');
    detail = await trips.getDetail(1);
    expect(detail.rows.find((row) => row.transaction_id === 2)?.business_amount).toBe(500);

    // Denied business counts as personal.
    await trips.setStatus([5], 'denied');
    detail = await trips.getDetail(1);
    expect(detail.summary.denied_share).toBe(110);
  });

  it('defaults a business trip to fully business and keeps a row the user made personal', async () => {
    const { db, service } = setup();
    const trips = service.tripExpenses;

    await trips.assignTransactions([9], 2);
    expect(db.prepare('SELECT business_amount, status FROM trip_expense_allocations WHERE transaction_id = 9').get()).toEqual({
      business_amount: 80,
      status: 'pending',
    });
    await trips.setAllocations([{ transactionId: 9, businessAmount: 0 }]);
    // An unrelated classification on the same row does not bring the default back.
    await service.applyTransactionClassifications([{ transactionId: 9, categoryId: 1 }]);
    expect(db.prepare('SELECT business_amount FROM trip_expense_allocations WHERE transaction_id = 9').get()).toEqual({ business_amount: 0 });

    // Moving it to another trip starts afresh; taking it off drops the part.
    await service.updateTransactionLabels(9, null, 1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM trip_expense_allocations').get()).toEqual({ n: 0 });
    await trips.assignTransactions([9], 2);
    await trips.assignTransactions([9], null);
    expect(db.prepare('SELECT COUNT(*) AS n FROM trip_expense_allocations').get()).toEqual({ n: 0 });
  });

  it('cleans up when a transaction or the trip is deleted', async () => {
    const { db, service } = setup();
    const trips = service.tripExpenses;
    await trips.assignTransactions([1, 2], 1);
    await trips.setAllocations([{ transactionId: 1, businessAmount: 450 }]);
    await trips.addReimbursement({ tripId: 1, amount: 400, transactionId: 7 });

    await service.deleteTransaction(7);
    expect(db.prepare('SELECT transaction_id FROM trip_reimbursements').get()).toEqual({ transaction_id: null });
    await service.deleteTransaction(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM trip_expense_allocations').get()).toEqual({ n: 0 });

    await service.deleteTrip(1);
    expect(db.prepare('SELECT trip_id FROM transactions WHERE id = 2').get()).toEqual({ trip_id: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM trip_reimbursements').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM trips WHERE id = 1').get()).toEqual({ n: 0 });

    // Trip totals for the list cover every trip with rows.
    await trips.assignTransactions([9], 2);
    const summaries = await trips.getAllSummaries();
    expect(Object.keys(summaries)).toEqual(['2']);
    expect(summaries[2]).toMatchObject({ gross_spend: 80, business_share: 80 });
  });

  it('remembers which receipt paid each part, and undoes only that one on delete', async () => {
    const { db, service } = setup();
    const trips = service.tripExpenses;
    await trips.assignTransactions([1, 2, 5], 1);
    await trips.setAllocations([
      { transactionId: 1, businessAmount: 450, status: 'submitted' },
      { transactionId: 2, businessAmount: 600, status: 'submitted' },
      { transactionId: 5, businessAmount: 100, status: 'submitted' },
    ]);
    const first = await trips.addReimbursement({ tripId: 1, amount: 450, transactionId: 7, markReimbursedIds: [1] });
    const second = await trips.addReimbursement({ tripId: 1, amount: 600, markReimbursedIds: [2] });
    // A status set by hand belongs to no receipt.
    await trips.setStatus([5], 'reimbursed');
    const parts = () =>
      db.prepare('SELECT transaction_id, status, reimbursement_id FROM trip_expense_allocations ORDER BY transaction_id').all();
    expect(parts()).toEqual([
      { transaction_id: 1, status: 'reimbursed', reimbursement_id: first },
      { transaction_id: 2, status: 'reimbursed', reimbursement_id: second },
      { transaction_id: 5, status: 'reimbursed', reimbursement_id: null },
    ]);

    // Editing a split while it stays reimbursed keeps the link; changing its status drops it.
    await trips.setAllocations([{ transactionId: 1, businessAmount: 400 }]);
    expect(parts()[0]).toEqual({ transaction_id: 1, status: 'reimbursed', reimbursement_id: first });

    await trips.deleteReimbursement(second);
    expect(parts()).toEqual([
      { transaction_id: 1, status: 'reimbursed', reimbursement_id: first },
      { transaction_id: 2, status: 'submitted', reimbursement_id: null },
      { transaction_id: 5, status: 'reimbursed', reimbursement_id: null },
    ]);

    await trips.setAllocations([{ transactionId: 1, businessAmount: 400, status: 'pending' }]);
    await trips.deleteReimbursement(first);
    expect(parts()[0]).toEqual({ transaction_id: 1, status: 'pending', reimbursement_id: null });
  });
});
