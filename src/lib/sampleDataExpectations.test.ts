/**
 * Sample-data validation, Node side.
 *
 * Loads the generated fixtures in public/sample-data/ into Node's built-in
 * SQLite through the exact insert path the browser import uses, runs the
 * real DatabaseService scans on them (classification, loan rules,
 * subscription detection) and compares what the app's own SQL reports with
 * public/sample-data/expectations.json, the manifest the generator wrote.
 *
 * It needs natural fixtures (`node scripts/generate-sample-data.mjs` without
 * --count) and node:sqlite (Node 22.13+ / 24). Without either it skips with
 * a reason instead of failing, so the ordinary unit run stays green on an
 * unprepared checkout; the sample-data skill runs it deliberately.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CREATE_INDEXES, CREATE_TABLES, DEFAULT_DATA } from '../../public/database-schema.js';
import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { COMMUNITY_RULES_URL, seedMerchantRules } from './merchantRulesSeedService';
import { normalizeDescription } from './merchantMatchingService';
import { SampleDataService } from './sampleDataService';
import { SAMPLE_DATA_QUERIES } from './sqlQueries';
import { incomeExpr, spendExpr } from './sqlMoneyExpressions';

// Minimal view of node:sqlite (the installed @types/node predates it).
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

interface ExpectationsMonth {
  month: string;
  rowCount: number;
  income: number;
  expenses: number;
  refunds: number;
  transferLegCount: number;
  spendByCategory: Record<string, number>;
}

interface Expectations {
  natural: boolean;
  reason?: string;
  window: { referenceDate: string; startDate: string; completeMonths: string[]; lastMonth: string };
  transactions: { total: number; byExpectedType: Record<string, number> };
  months: ExpectationsMonth[];
  accounts: Array<{ id: number; name: string; type: string; openingBalance: number; endingBalance: number; rowCount: number; tracksBalanceBySnapshots: boolean }>;
  transfers: { pairCount: number; expectedTransferRowCount: number; pairs: Array<{ key: string; legs: Array<{ id: number; accountId: number; amount: number }> }> };
  refunds: Array<{ id: number }>;
  loans: Array<{ id: number; name: string; loanType: string; accountId: number | null; originalPrincipal: number; ruleLinked: boolean; expectedPaymentCount: number; expectedTotalPaid: number; paymentDescription: string; paymentRowsInWindow: number }>;
  subscriptions: Array<{ description: string; amount: number; occurrences: number; detectable: boolean; cadence: string }>;
  budget: { plans: Array<{ effectiveMonth: string; totalAmount: number }>; funds: Array<{ kind: string; id: number }> };
  projects: Array<{ id: number; linkedRows: number; linkedSpend: number }>;
  trips: Array<{ id: number; linkedRows: number; linkedSpend: number }>;
}

const repoRoot = path.resolve(__dirname, '..', '..');
const sampleDataDir = path.join(repoRoot, 'public', 'sample-data');
const expectationsPath = path.join(sampleDataDir, 'expectations.json');

const sqlite: SqliteModule | null = await import(/* @vite-ignore */ ('node:sqlite' as string))
  .then((module) => module as unknown as SqliteModule)
  .catch(() => null);
const expectations: Expectations | null = fs.existsSync(expectationsPath)
  ? (JSON.parse(fs.readFileSync(expectationsPath, 'utf8')) as Expectations)
  : null;

const skipReason = !sqlite
  ? 'node:sqlite is unavailable (needs Node 22.13+ or 24)'
  : !expectations
    ? 'public/sample-data/expectations.json is missing: run `node scripts/generate-sample-data.mjs --months=12 --seed=review`'
    : !expectations.natural
      ? `fixtures are not natural: ${expectations.reason}`
      : null;

// SQLite binds null, numbers, bigints, strings and buffers; the services also
// hand it booleans and undefined.
function bind(parameters: unknown[] = []): Array<null | number | bigint | string | Uint8Array> {
  return parameters.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value as null | number | bigint | string | Uint8Array;
  });
}

/** The worker transport, backed by an in-process SQLite database. */
function createNodeTransport(db: SqliteDatabase): DatabaseWorkerTransport {
  const query = async (sql: string, parameters: unknown[] = []) => db.prepare(sql).all(...bind(parameters)) as any[];
  const unsupported = (name: string) => async () => {
    throw new Error(`${name} is not available on the Node sample-data transport`);
  };
  return {
    initialize: async () => undefined,
    createTables: async () => undefined,
    ensureIndexes: async () => undefined,
    query,
    queryWithTimeout: query,
    batchQueryReturning: async (sql: string, parameterSets: unknown[][] = []) => {
      const statement = db.prepare(sql);
      return parameterSets.flatMap((parameters) => statement.all(...bind(parameters)) as any[]);
    },
    exec: async (sql: string) => db.exec(sql),
    exportDatabaseSnapshot: unsupported('exportDatabaseSnapshot'),
    importDatabaseSnapshot: unsupported('importDatabaseSnapshot'),
  } as unknown as DatabaseWorkerTransport;
}

/** Mirrors the worker's createTables(): every table, default categories, indexes. */
function createSchema(db: SqliteDatabase) {
  db.exec('PRAGMA foreign_keys = ON');
  for (const createTableSql of Object.values(CREATE_TABLES)) db.exec(createTableSql);
  db.exec(DEFAULT_DATA.CATEGORIES);
  for (const createIndexSql of CREATE_INDEXES) db.exec(createIndexSql);
}

/** Mirrors SampleDataService.loadAllSampleData(): same files, same order, same parameter mapping. */
function loadFixtures(db: SqliteDatabase) {
  const resetSequence = db.prepare(SAMPLE_DATA_QUERIES.RESET_SEQUENCE);
  for (const fileName of SampleDataService.sampleDataFiles) {
    const filePath = path.join(sampleDataDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { table: string; data?: any[]; dataFiles?: Array<{ file: string }> };
    const rows: any[] = envelope.data ?? (envelope.dataFiles ?? []).flatMap((chunk) => JSON.parse(fs.readFileSync(path.join(sampleDataDir, chunk.file), 'utf8')).data as any[]);
    const definition = SampleDataService.getImportDefinition(envelope.table);
    const insert = db.prepare(definition.insertQuery);
    let maxId = 0;
    db.exec('BEGIN');
    for (const row of rows) {
      insert.run(...bind(definition.toParameters(row)));
      if (typeof row.id === 'number') maxId = Math.max(maxId, row.id);
    }
    db.exec('COMMIT');
    if (maxId > 0) resetSequence.run(maxId, envelope.table);
  }
}

function monthRange(month: string): [string, string] {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`];
}

function count(db: SqliteDatabase, sql: string, ...parameters: unknown[]): number {
  const row = db.prepare(sql).get(...bind(parameters)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function titleCaseWords(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

describe.skipIf(skipReason !== null)(`sample-data expectations${skipReason ? ` (skipped: ${skipReason})` : ''}`, () => {
  const manifest = expectations as Expectations;
  const db: SqliteDatabase = sqlite ? new sqlite.DatabaseSync(':memory:') : (null as unknown as SqliteDatabase);
  const service = sqlite ? new DatabaseService(createNodeTransport(db)) : (null as unknown as DatabaseService);
  const completeMonths = manifest?.window.completeMonths ?? [];

  // The suite is one story: load, then scan, then read back. Tests run in
  // file order and each later step depends on the earlier ones.
  it('loads every fixture through the import path with foreign keys on', () => {
    createSchema(db);
    loadFixtures(db);
    expect(count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(manifest.transactions.total);
    expect(count(db, 'PRAGMA foreign_key_check')).toBe(0);
    // Raw import state: typed by sign, nothing paired yet.
    expect(count(db, "SELECT COUNT(*) AS n FROM transactions WHERE type IN ('transfer', 'refund')")).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM loans')).toBe(manifest.loans.length);
    expect(count(db, 'SELECT COUNT(*) AS n FROM classification_rules')).toBeGreaterThan(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM account_balance_snapshots')).toBeGreaterThan(0);
  });

  it('seeds the bundled community merchant rules like app start does', async () => {
    const result = await seedMerchantRules({
      query: (sql, parameters) => service['workerService'].query(sql, parameters as any[]),
      fetchRulesFile: async () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'public', COMMUNITY_RULES_URL), 'utf8')),
    });
    expect(result).toBeDefined();
    expect(count(db, "SELECT COUNT(*) AS n FROM merchant_rules WHERE source = 'community'")).toBeGreaterThan(0);
  });

  it('classification scan pairs every transfer and infers every refund the manifest lists', async () => {
    const summary = await service.classification.runInitialScanIfNeeded();
    expect(summary).not.toBeNull();
    expect(summary!.transfersPaired).toBe(manifest.transfers.pairCount);
    expect(count(db, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'transfer'")).toBe(manifest.transfers.expectedTransferRowCount);
    expect(count(db, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'refund'")).toBe(manifest.refunds.length);
    for (const refund of manifest.refunds) {
      expect(count(db, "SELECT COUNT(*) AS n FROM transactions WHERE id = ? AND type = 'refund'", refund.id)).toBe(1);
    }
    // Both legs of each pair share a group and sit in different accounts.
    const groupOf = db.prepare('SELECT transfer_group_id AS g, account_id AS a, type AS t FROM transactions WHERE id = ?');
    for (const pair of manifest.transfers.pairs) {
      const [first, second] = pair.legs.map((leg) => groupOf.get(leg.id) as { g: string | null; a: number; t: string });
      expect(first.t, pair.key).toBe('transfer');
      expect(second.t, pair.key).toBe('transfer');
      expect(first.g, pair.key).not.toBeNull();
      expect(first.g, pair.key).toBe(second.g);
      expect(first.a).not.toBe(second.a);
    }
    // Nothing else became a transfer or refund.
    expect(count(db, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'income'")).toBe(manifest.transactions.byExpectedType.income);
    expect(count(db, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'expense'")).toBe(manifest.transactions.byExpectedType.expense);
    // A second open is a no-op.
    expect(await service.classification.runInitialScanIfNeeded()).toBeNull();
  });

  it('monthly income and spending match the manifest through the app money expressions', () => {
    const totals = db.prepare(
      `SELECT COALESCE(SUM(${incomeExpr()}), 0) AS income, COALESCE(SUM(${spendExpr()}), 0) AS expenses,
              SUM(CASE WHEN t.is_excluded = 0 THEN 1 ELSE 0 END) AS rows
       FROM transactions t WHERE t.date BETWEEN ? AND ?`
    );
    for (const month of manifest.months) {
      const [start, end] = monthRange(month.month);
      const row = totals.get(start, end) as { income: number; expenses: number; rows: number };
      expect(row.rows, month.month).toBe(month.rowCount);
      expect(row.income, `${month.month} income`).toBeCloseTo(month.income, 2);
      expect(row.expenses, `${month.month} expenses`).toBeCloseTo(month.expenses, 2);
    }
  });

  it('dashboard summary and budget status agree with the manifest for every complete month', async () => {
    expect(completeMonths.length).toBeGreaterThan(0);
    for (const monthKey of completeMonths) {
      const month = manifest.months.find((candidate) => candidate.month === monthKey)!;
      const [start, end] = monthRange(monthKey);
      const dashboard = await service.getDashboardSummary(start, end);
      expect(dashboard.totalExpenses, `${monthKey} dashboard expenses`).toBeCloseTo(month.expenses, 2);
      // Income is max(actual, expected from income sources), so never below actual.
      expect(dashboard.totalIncome, `${monthKey} dashboard income`).toBeGreaterThanOrEqual(month.income - 0.005);
      expect(dashboard.transactionCount, `${monthKey} dashboard rows`).toBe(month.rowCount);

      const status = await service.getBudgetStatus({ type: 'month', key: monthKey });
      expect(status.actualExpenses, `${monthKey} budget actual`).toBeCloseTo(month.expenses, 2);
      for (const line of status.categories) {
        const expected = month.spendByCategory[String(line.category_id)] ?? 0;
        expect(line.actualExpenses, `${monthKey} category ${line.category_id}`).toBeCloseTo(expected, 2);
      }
    }
    const plans = await service.getBudgetPlans();
    expect(plans.map((plan) => plan.effective_month).sort()).toEqual(manifest.budget.plans.map((plan) => plan.effectiveMonth).sort());
  });

  it('running balances of the tracked accounts end where the manifest says', () => {
    const balance = db.prepare(
      `SELECT a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND (a.opening_balance_date IS NULL OR t.date >= a.opening_balance_date)), 0) AS balance,
              (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS rows
       FROM accounts a WHERE a.id = ?`
    );
    for (const account of manifest.accounts) {
      const row = balance.get(account.id) as { balance: number; rows: number };
      expect(row.rows, account.name).toBe(account.rowCount);
      if (account.tracksBalanceBySnapshots) {
        expect(row.rows, `${account.name} has no transaction legs`).toBe(0);
        expect(count(db, 'SELECT COUNT(*) AS n FROM account_balance_snapshots WHERE account_id = ?', account.id), `${account.name} snapshots`).toBeGreaterThan(0);
      } else {
        expect(row.balance, account.name).toBeCloseTo(account.endingBalance, 2);
      }
    }
  });

  it('loan rules claim exactly the payments the manifest expects and the ledgers compute', async () => {
    const summary = await service.loans.applyRules();
    for (const loan of manifest.loans) {
      const payments = await service.loans.listPayments(loan.id);
      expect(payments.length, loan.name).toBe(loan.expectedPaymentCount);
      expect(summary.byLoan[loan.id] ?? 0, loan.name).toBe(loan.expectedPaymentCount);
      // Every payment row of the window exists, linked or not.
      expect(count(db, 'SELECT COUNT(*) AS n FROM transactions WHERE description = ? AND amount < 0', loan.paymentDescription), `${loan.name} rows`).toBe(loan.paymentRowsInWindow);

      const ledger = await service.loans.getSummary(loan.id, manifest.window.referenceDate);
      expect(ledger).not.toBeNull();
      expect(ledger!.totalPaid, `${loan.name} total paid`).toBeCloseTo(loan.expectedTotalPaid, 2);
      expect(ledger!.paymentCount).toBe(loan.expectedPaymentCount);
      if (loan.expectedPaymentCount > 0) {
        expect(ledger!.balance, `${loan.name} balance`).toBeLessThan(loan.originalPrincipal);
        expect(ledger!.balance).toBeGreaterThan(0);
      } else {
        expect(ledger!.balance).toBeCloseTo(loan.originalPrincipal, 2);
      }
      if (loan.loanType === 'deferred_interest') expect(ledger!.deferred).not.toBeNull();
      // A linked loan account gets its statement balance written after the scan.
      if (loan.accountId && loan.expectedPaymentCount > 0) {
        expect(count(db, 'SELECT COUNT(*) AS n FROM account_balance_snapshots WHERE account_id = ? AND balance < 0', loan.accountId), `${loan.name} snapshot`).toBeGreaterThan(0);
      }
    }
    // Idempotent: a second pass links nothing new.
    expect((await service.loans.applyRules()).linked).toBe(0);
  });

  it('subscription scan detects every fixed series and leaves loan payments alone', async () => {
    const summary = await service.runSubscriptionScan();
    expect(summary.seriesCreated).toBeGreaterThan(0);
    const series = await service.getRecurringSeriesWithStats();
    const byMatchKey = new Map(series.map((entry) => [entry.match_key, entry]));
    for (const expected of manifest.subscriptions.filter((entry) => entry.detectable)) {
      const normalized = normalizeDescription(expected.description);
      const match = byMatchKey.get(`desc:${normalized}`) ?? series.find((entry) => entry.name === titleCaseWords(normalized));
      expect(match, `${expected.description} detected`).toBeDefined();
      expect(match!.cadence, expected.description).toBe(expected.cadence);
      expect(Number(match!.expected_amount), expected.description).toBeCloseTo(expected.amount, 2);
      expect(Number(match!.transaction_count), expected.description).toBe(expected.occurrences);
    }
    // Rule-linked loan payments never become a series.
    for (const loan of manifest.loans.filter((entry) => entry.ruleLinked)) {
      expect(series.some((entry) => entry.match_key === `desc:${normalizeDescription(loan.paymentDescription)}`), loan.name).toBe(false);
    }
    // Not even a one-off membership qualifies.
    for (const expected of manifest.subscriptions.filter((entry) => !entry.detectable)) {
      expect(byMatchKey.has(`desc:${normalizeDescription(expected.description)}`), expected.description).toBe(false);
    }
  });

  it('projects, trips and savings funds carry their linked spend', async () => {
    const linked = db.prepare('SELECT COUNT(*) AS rows, COALESCE(SUM(-amount), 0) AS spend FROM transactions WHERE project_id = ?');
    for (const project of manifest.projects) {
      const row = linked.get(project.id) as { rows: number; spend: number };
      expect(row.rows, `project ${project.id}`).toBe(project.linkedRows);
      expect(row.spend, `project ${project.id}`).toBeCloseTo(project.linkedSpend, 2);
    }
    const tripLinked = db.prepare('SELECT COUNT(*) AS rows, COALESCE(SUM(-amount), 0) AS spend FROM transactions WHERE trip_id = ?');
    for (const trip of manifest.trips) {
      const row = tripLinked.get(trip.id) as { rows: number; spend: number };
      expect(row.rows, `trip ${trip.id}`).toBe(trip.linkedRows);
      expect(row.spend, `trip ${trip.id}`).toBeCloseTo(trip.linkedSpend, 2);
    }
    const funds = await service.budgetFunds.listLinkedFunds();
    expect(funds.map((fund) => `${fund.entity_type}:${fund.entity_id}`).sort()).toEqual(
      manifest.budget.funds.map((fund) => `${fund.kind}:${fund.id}`).sort()
    );
  });
});
