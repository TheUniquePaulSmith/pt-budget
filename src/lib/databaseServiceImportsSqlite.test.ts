/**
 * Statement import on real SQLite (node:sqlite) with the real schema.
 *
 * The stub-transport tests in databaseServiceImports.test.ts pin which
 * statements run; these prove what they do to the data: a failed commit
 * leaves nothing behind, a left-out duplicate re-seeds the kept copies, an
 * undo removes exactly what the import brought in, and a value in a file is
 * tied to an account in the documented order.
 *
 * The transport mirrors the worker: a batch opens its own transaction unless
 * told not to, so a write that tried to nest one inside the commit's
 * BEGIN … COMMIT fails here as it would in the browser.
 */
import { describe, expect, it } from 'vitest';

import { CREATE_INDEXES, CREATE_TABLES } from '../../public/database-schema.js';
import type { TypeDecision } from '../types/classification';
import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { IMPORT_BATCH_NOT_FOUND } from './databaseServiceImports';
import type { CommitInput, StagedRowInput } from './statementImport/types';
import { computeTransactionHash } from './transactionHash';

// Minimal view of node:sqlite (the installed @types/node predates it).
interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
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

// SQLite binds null, numbers, strings and buffers; the services also hand it booleans and undefined.
function bind(parameters: unknown[] = []): unknown[] {
  return parameters.map((value) => (value === undefined ? null : typeof value === 'boolean' ? Number(value) : value));
}

function createTransport(db: SqliteDatabase): DatabaseWorkerTransport {
  const query = async (sql: string, parameters: unknown[] = []) => db.prepare(sql).all(...bind(parameters)) as any[];
  return {
    query,
    queryWithTimeout: query,
    batchQueryReturning: async (
      sql: string,
      parameterSets: unknown[][] = [],
      options: { useTransaction?: boolean } = {}
    ) => {
      const ownTransaction = options.useTransaction !== false;
      // Throws inside an open transaction, exactly like the worker's BEGIN IMMEDIATE.
      if (ownTransaction) db.exec('BEGIN IMMEDIATE');
      try {
        const statement = db.prepare(sql);
        const rows = parameterSets.flatMap((parameters) => statement.all(...bind(parameters)) as any[]);
        if (ownTransaction) db.exec('COMMIT');
        return rows;
      } catch (error) {
        if (ownTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as DatabaseWorkerTransport;
}

const CHECKING = 1;
const SAVINGS = 2;
const LOAN_ACCOUNT = 3;
const CARD_ACCOUNT = 4;

/**
 * A household with four accounts. New databases run with foreign keys on;
 * reopened ones with them off (the worker does not re-enable the pragma), so
 * the undo is proven under both.
 */
function openDatabase({ foreignKeys = true }: { foreignKeys?: boolean } = {}) {
  const db = new sqlite!.DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  for (const createTableSql of Object.values(CREATE_TABLES)) db.exec(createTableSql as string);
  for (const createIndexSql of CREATE_INDEXES) db.exec(createIndexSql);
  db.exec(`INSERT INTO users (id, display_name, is_primary) VALUES (1, 'Alex', 1)`);
  db.exec(`
    INSERT INTO accounts (id, name, type, owner_user_id, institution) VALUES
      (${CHECKING}, 'Everyday Checking', 'checking', 1, 'Huntington'),
      (${SAVINGS}, 'Rainy Day', 'savings', 1, 'Huntington'),
      (${LOAN_ACCOUNT}, 'Car Loan', 'loan', 1, 'Summit Auto Finance'),
      (${CARD_ACCOUNT}, 'Travel Card', 'credit', 1, 'Chase')
  `);
  const service = new DatabaseService(createTransport(db));
  const all = (sql: string, ...parameters: unknown[]) => db.prepare(sql).all(...parameters) as any[];
  const count = (table: string, where = '1 = 1') => Number(all(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)[0].count);
  return { db, service, imports: service.imports, all, count };
}

type Harness = ReturnType<typeof openDatabase>;

const row = (
  rowIndex: number,
  date: string,
  amount: number,
  description: string,
  overrides: Partial<StagedRowInput> = {}
): StagedRowInput => ({ rowIndex, accountId: CHECKING, cardId: null, date, amount, description, reference: null, ...overrides });

const commitInput = (overrides: Partial<CommitInput> = {}): CommitInput => ({
  fileName: 'checking.csv',
  format: 'delimited',
  profileId: null,
  accountIds: [CHECKING],
  totalRows: 0,
  skippedRows: 0,
  rejectedRows: 0,
  issues: { counts: {}, assumptions: [], fixedRows: 0 },
  excludedTempIds: [],
  stagedDecisions: [],
  existingDecisions: [],
  ...overrides,
});

/** The decision each leg of a kept transfer pair carries. */
const transferLeg = (key: string, groupId: string): TypeDecision => ({
  key,
  type: 'transfer',
  source: 'pair',
  confidence: 0.92,
  transferGroupId: groupId,
  ruleId: null,
  pairedWithKey: null,
  reasons: [],
});

/** A row that was stored before the import, outside any batch. */
function storeRow(
  { all }: Harness,
  values: { accountId: number; date: string; amount: number; description: string; type: string; locked?: boolean }
): number {
  return Number(
    all(
      `INSERT INTO transactions (date, amount, description, account_id, type, transaction_hash, type_locked, type_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      values.date,
      values.amount,
      values.description,
      values.accountId,
      values.type,
      `stored:${values.description}`,
      values.locked ? 1 : 0,
      values.locked ? 'manual' : 'sign'
    )[0].id
  );
}

async function importRows(harness: Harness, rows: StagedRowInput[], overrides: Partial<CommitInput> = {}) {
  const staged = await harness.imports.stageRows(rows);
  const result = await harness.imports.commitStaged(commitInput({ totalRows: rows.length, ...overrides }));
  return { staged, result };
}

describe.skipIf(!sqlite)('ImportsService on SQLite: commit', () => {
  it('lands a file as one batch: rows, their types, the existing transfer leg and the totals', async () => {
    const harness = openDatabase();
    const { imports, all, count } = harness;
    const savingsLeg = storeRow(harness, {
      accountId: SAVINGS,
      date: '2026-10-02',
      amount: 500,
      description: 'TRANSFER FROM CHECKING',
      type: 'income',
    });
    await importRows(harness, [row(0, '2026-10-01', -4.5, 'COFFEE')], { fileName: 'earlier.csv' });
    const profileId = await imports.saveProfile({
      name: 'Huntington checking',
      format: 'delimited',
      fingerprint: 'delimited:date|amount|description',
      account_id: CHECKING,
      config: { version: 1, layout: { roles: { date: 0, description: [2], amount: 1 }, dateOrder: 'MDY', decimal: '.', amountSign: 'asIs' } },
    });

    const staged = await imports.stageRows([
      row(0, '2026-10-01', -4.5, 'COFFEE'),
      row(1, '2026-10-02', -500, 'TRANSFER TO SAVINGS'),
      row(2, '2026-10-09', -80.25, 'GROCERY'),
    ]);
    expect(staged.alreadyImported).toEqual([0]);

    const result = await imports.commitStaged(
      commitInput({
        profileId,
        totalRows: 4,
        skippedRows: 1,
        issues: { counts: { alreadyImported: 1 }, assumptions: ['account:accountAssumedByProfile'], fixedRows: 0 },
        stagedDecisions: [transferLeg(`tmp:${staged.tempIds[1]}`, 'group-a')],
        existingDecisions: [transferLeg(`tx:${savingsLeg}`, 'group-a')],
      })
    );

    expect(result).toMatchObject({ inserted: 2, duplicates: 1 });
    expect(all('SELECT * FROM import_batches WHERE id = ?', result.batchId)[0]).toMatchObject({
      source: 'csv',
      file_name: 'checking.csv',
      account_ids_json: '[1]',
      total_rows: 4,
      inserted_count: 2,
      duplicate_count: 1,
      skipped_count: 1,
      rejected_count: 0,
      min_date: '2026-10-02',
      max_date: '2026-10-09',
      profile_id: profileId,
      file_format: 'delimited',
      issues_json: JSON.stringify({ counts: { alreadyImported: 1 }, assumptions: ['account:accountAssumedByProfile'], fixedRows: 0 }),
    });
    // The staged decision travelled with the row; the leg that was already stored joined the pair.
    expect(
      all('SELECT description, type, type_source, type_confidence, transfer_group_id FROM transactions WHERE transfer_group_id IS NOT NULL ORDER BY id')
    ).toEqual([
      { description: 'TRANSFER FROM CHECKING', type: 'transfer', type_source: 'pair', type_confidence: 0.92, transfer_group_id: 'group-a' },
      { description: 'TRANSFER TO SAVINGS', type: 'transfer', type_source: 'pair', type_confidence: 0.92, transfer_group_id: 'group-a' },
    ]);
    expect(all('SELECT type FROM transactions WHERE description = ?', 'GROCERY')).toEqual([{ type: 'expense' }]);
    expect(count('temp_import_transactions')).toBe(0);

    const [latest] = await imports.listImportBatches(1);
    expect(latest).toMatchObject({ id: result.batchId, profile_name: 'Huntington checking', inserted_count: 2 });
  });

  it('a failed insert leaves no batch row, no staged rows and no half-applied decision', async () => {
    const harness = openDatabase();
    const { db, imports, all, count } = harness;
    const savingsLeg = storeRow(harness, {
      accountId: SAVINGS,
      date: '2026-10-02',
      amount: 500,
      description: 'TRANSFER FROM CHECKING',
      type: 'income',
    });
    // The second row of the file is refused by the database mid-insert.
    db.exec(`
      CREATE TRIGGER refuse_insert BEFORE INSERT ON transactions WHEN NEW.description = 'BOOM'
      BEGIN SELECT RAISE(ABORT, 'insert refused'); END
    `);

    const staged = await imports.stageRows([row(0, '2026-10-02', -500, 'TRANSFER TO SAVINGS'), row(1, '2026-10-03', -1, 'BOOM')]);
    await expect(
      imports.commitStaged(
        commitInput({
          totalRows: 2,
          stagedDecisions: [transferLeg(`tmp:${staged.tempIds[0]}`, 'group-a')],
          existingDecisions: [transferLeg(`tx:${savingsLeg}`, 'group-a')],
        })
      )
    ).rejects.toThrow(/insert refused/);

    // The batch row was written before the insert failed; the rollback took it back.
    expect(count('import_batches')).toBe(0);
    expect(count('temp_import_transactions')).toBe(0);
    expect(all('SELECT id, type, type_source, transfer_group_id FROM transactions')).toEqual([
      { id: savingsLeg, type: 'income', type_source: 'sign', transfer_group_id: null },
    ]);

    // No transaction was left open: the next import goes through.
    const { result } = await importRows(harness, [row(0, '2026-10-02', -500, 'TRANSFER TO SAVINGS')]);
    expect(result.inserted).toBe(1);
    expect(count('import_batches')).toBe(1);
  });

  it('re-seeds the kept copies when an identical row is left out, so a later import matches them', async () => {
    const harness = openDatabase();
    const { imports, all } = harness;
    const cashout = (rowIndex: number) => row(rowIndex, '2026-11-01', 100, 'VENMO CASHOUT');
    const hashOf = (seed: number) => computeTransactionHash(CHECKING, '2026-11-01', 100, 'VENMO CASHOUT', seed);

    // The file repeats one row three times; the user says only two are real and leaves out the first.
    const staged = await imports.stageRows([cashout(0), cashout(1), cashout(2), row(3, '2026-11-02', -9, 'COFFEE')]);
    expect(staged.duplicateGroups).toEqual([{ rowIndexes: [0, 1, 2] }]);
    const first = await imports.commitStaged(commitInput({ totalRows: 4, skippedRows: 1, excludedTempIds: [staged.tempIds[0]] }));
    expect(first).toMatchObject({ inserted: 3, duplicates: 0 });

    // Stored as copies 0 and 1, not 1 and 2.
    expect(
      all(`SELECT hash_variation_seed, transaction_hash FROM transactions WHERE description = 'VENMO CASHOUT' ORDER BY hash_variation_seed`)
    ).toEqual([
      { hash_variation_seed: 0, transaction_hash: await hashOf(0) },
      { hash_variation_seed: 1, transaction_hash: await hashOf(1) },
    ]);

    // A later export of the same days carries the two real rows: both are recognised as stored.
    const again = await imports.stageRows([cashout(0), cashout(1), row(2, '2026-11-02', -9, 'COFFEE')]);
    expect(again.alreadyImported).toEqual([0, 1, 2]);
    expect(await imports.commitStaged(commitInput({ totalRows: 3 }))).toMatchObject({ inserted: 0, duplicates: 3 });
  });
});

describe.skipIf(!sqlite).each([
  { name: 'foreign keys on (a new database)', foreignKeys: true },
  { name: 'foreign keys off (a reopened database)', foreignKeys: false },
])('ImportsService on SQLite: undo, $name', ({ foreignKeys }) => {
  /**
   * One import of five checking rows with everything an import can grow:
   * two transfer pairs (one with an untouched savings row, one with a savings
   * row the user had typed), a loan payment, a detected series link and a
   * note. A second import of one card row must survive the undo.
   */
  async function importedHousehold() {
    const harness = openDatabase({ foreignKeys });
    const { db, service, imports, all } = harness;
    const autoLeg = storeRow(harness, { accountId: SAVINGS, date: '2026-10-02', amount: 500, description: 'TRANSFER FROM CHECKING', type: 'income' });
    const lockedLeg = storeRow(harness, {
      accountId: SAVINGS,
      date: '2026-10-03',
      amount: 250,
      description: 'ROUND-UP SWEEP',
      type: 'transfer',
      locked: true,
    });
    const loanId = await service.loans.create({ name: 'Car loan', owner_user_id: 1, account_id: LOAN_ACCOUNT, original_principal: 10000 });
    db.exec(`INSERT INTO recurring_series (id, name, match_key) VALUES (1, 'Netflix', 'netflix')`);

    const rows = [
      row(0, '2026-10-02', -500, 'TRANSFER TO SAVINGS'),
      row(1, '2026-10-03', -250, 'SWEEP TO SAVINGS'),
      row(2, '2026-10-05', -300, 'SUMMIT AUTO FINANCE PMT'),
      row(3, '2026-10-06', -15.99, 'NETFLIX.COM'),
      row(4, '2026-10-07', -4.5, 'COFFEE'),
    ];
    const staged = await imports.stageRows(rows);
    const { batchId } = await imports.commitStaged(
      commitInput({
        totalRows: rows.length,
        stagedDecisions: [transferLeg(`tmp:${staged.tempIds[0]}`, 'group-auto'), transferLeg(`tmp:${staged.tempIds[1]}`, 'group-locked')],
        existingDecisions: [transferLeg(`tx:${autoLeg}`, 'group-auto'), transferLeg(`tx:${lockedLeg}`, 'group-locked')],
      })
    );
    const idOf = (description: string) => Number(all('SELECT id FROM transactions WHERE description = ?', description)[0].id);

    // What the post-import passes and the user add on top of the imported rows.
    await service.loans.linkTransaction(loanId, idOf('SUMMIT AUTO FINANCE PMT'));
    db.exec(`INSERT INTO transaction_series_links (transaction_id, series_id, match_source) VALUES (${idOf('NETFLIX.COM')}, 1, 'rule')`);
    await service.setTransactionComment(idOf('COFFEE'), 'with Sam');

    const other = await importRows(harness, [row(0, '2026-10-08', -62, 'HOTEL', { accountId: CARD_ACCOUNT })], {
      fileName: 'card.csv',
      accountIds: [CARD_ACCOUNT],
    });
    const loanBalance = () => all('SELECT balance FROM account_balance_snapshots WHERE account_id = ?', LOAN_ACCOUNT).map((snapshot) => snapshot.balance);
    return { ...harness, batchId, otherBatchId: other.result.batchId, autoLeg, lockedLeg, loanId, rows, loanBalance };
  }

  const leg = ({ all }: Harness, id: number) =>
    all('SELECT type, type_locked, type_source, type_confidence, transfer_group_id FROM transactions WHERE id = ?', id)[0];

  it('says what the undo would remove before anything is touched', async () => {
    const household = await importedHousehold();

    expect(await household.imports.getBatchImpact(household.batchId)).toEqual({
      batchId: household.batchId,
      transactions: 5,
      // The note on the coffee row; a series the scan linked is not the user's edit.
      editedSinceImport: 1,
      loanPayments: 1,
      transferPairs: 2,
    });
    expect(await household.imports.getBatchLoanIds(household.batchId)).toEqual([household.loanId]);
    expect(await household.imports.getBatchLoanIds(household.otherBatchId)).toEqual([]);
    expect(household.count('transactions')).toBe(8);
  });

  it('removes the transactions, their loan payment and series link, frees the surviving legs and deletes the batch', async () => {
    const household = await importedHousehold();
    const { imports, service, all, count, batchId, otherBatchId } = household;
    // The payment the import brought in is in the loan account's balance.
    expect(household.loanBalance()).toEqual([-9700]);
    expect(leg(household, household.autoLeg)).toMatchObject({ type: 'transfer', type_source: 'pair', transfer_group_id: 'group-auto' });
    expect(leg(household, household.lockedLeg)).toMatchObject({ type: 'transfer', type_locked: 1, transfer_group_id: 'group-locked' });

    const impact = await imports.undoBatch(batchId);

    expect(impact).toEqual({ batchId, transactions: 5, editedSinceImport: 1, loanPayments: 1, transferPairs: 2 });
    expect(count('transactions', `import_batch_id = ${batchId}`)).toBe(0);
    expect(all('SELECT id FROM import_batches')).toEqual([{ id: otherBatchId }]);
    // Nothing is left pointing at a row that no longer exists.
    expect(count('loan_payments')).toBe(0);
    expect(count('transaction_series_links')).toBe(0);
    expect(count('transactions', 'transfer_group_id IS NOT NULL')).toBe(0);
    // The leg the import had turned into a transfer is income again, as before the import…
    expect(leg(household, household.autoLeg)).toEqual({
      type: 'income',
      type_locked: 0,
      type_source: 'sign',
      type_confidence: null,
      transfer_group_id: null,
    });
    // …and the one the user typed keeps the user's decision.
    expect(leg(household, household.lockedLeg)).toEqual({
      type: 'transfer',
      type_locked: 1,
      type_source: 'manual',
      type_confidence: null,
      transfer_group_id: null,
    });
    // The other import is untouched.
    expect(all('SELECT description, import_batch_id FROM transactions WHERE account_id = ?', CARD_ACCOUNT)).toEqual([
      { description: 'HOTEL', import_batch_id: otherBatchId },
    ]);

    // The loans service's public snapshot refresh (what the slice calls after an undo)
    // brings the linked account back to the balance without the removed payment.
    expect(household.loanBalance()).toEqual([-9700]);
    await service.loans.syncAccountSnapshot(household.loanId);
    expect(household.loanBalance()).toEqual([-10000]);

    await expect(imports.getBatchImpact(batchId)).rejects.toThrow(IMPORT_BATCH_NOT_FOUND);
    await expect(imports.undoBatch(batchId)).rejects.toThrow(IMPORT_BATCH_NOT_FOUND);

    // The file can be imported again: its hashes are free.
    const again = await importRows(household, household.rows);
    expect(again.staged.alreadyImported).toEqual([]);
    expect(again.result.inserted).toBe(5);
  });

  it('keeps everything when the undo fails part-way', async () => {
    const household = await importedHousehold();
    const { db, imports, count, batchId } = household;
    db.exec(`
      CREATE TRIGGER refuse_delete BEFORE DELETE ON import_batches
      BEGIN SELECT RAISE(ABORT, 'delete refused'); END
    `);

    await expect(imports.undoBatch(batchId)).rejects.toThrow(/delete refused/);

    // The last step failed; the deletes before it were rolled back with it.
    expect(count('transactions', `import_batch_id = ${batchId}`)).toBe(5);
    expect(count('loan_payments')).toBe(1);
    expect(count('transaction_series_links')).toBe(1);
    expect(leg(household, household.autoLeg)).toMatchObject({ type: 'transfer', type_source: 'pair', transfer_group_id: 'group-auto' });
    expect(leg(household, household.lockedLeg)).toMatchObject({ transfer_group_id: 'group-locked' });
    expect(count('import_batches')).toBe(2);
  });
});

describe.skipIf(!sqlite)('ImportsService on SQLite: which account a file means', () => {
  async function withIdentifiers(options: { foreignKeys?: boolean } = {}) {
    const harness = openDatabase(options);
    harness.db.exec(`INSERT INTO account_cards (id, account_id, last_four, full_number) VALUES (1, ${CARD_ACCOUNT}, '4821', '4000000000004821')`);
    await harness.imports.addAccountIdentifier({ account_id: CHECKING, kind: 'number', value: 'Acct 0012344821' });
    await harness.imports.addAccountIdentifier({ account_id: SAVINGS, kind: 'number', value: 'XXXX7777' });
    await harness.imports.addAccountIdentifier({ account_id: SAVINGS, kind: 'label', value: 'Rainy Day Fund', source: 'manual' });
    return harness;
  }
  const one = async (harness: Harness, value: string, profileAccountId?: number) =>
    (await harness.imports.resolveAccounts([value], { profileAccountId }))[0];

  it('recognises a full number only; a card match also says which card', async () => {
    const harness = await withIdentifiers();

    expect(await one(harness, '4000 0000 0000 4821')).toEqual({
      value: '4000 0000 0000 4821',
      status: 'recognised',
      basis: 'fullNumber',
      accountId: CARD_ACCOUNT,
      cardId: 1,
      candidateAccountIds: [CARD_ACCOUNT],
    });
    // The same four last digits sit on two accounts, but the full number settles it.
    expect(await one(harness, '0012344821')).toMatchObject({ status: 'recognised', basis: 'fullNumber', accountId: CHECKING, cardId: null });
  });

  it('falls back to the last four as an assumption, and to "ambiguous" when they sit on two accounts', async () => {
    const harness = await withIdentifiers();

    expect(await one(harness, '****7777')).toMatchObject({ status: 'assumed', basis: 'lastFour', accountId: SAVINGS, candidateAccountIds: [SAVINGS] });
    // A masked number, and a full number nobody has stored: both come down to 4821.
    for (const value of ['XXXX-4821', '9999 0000 1111 4821']) {
      expect(await one(harness, value)).toEqual({
        value,
        status: 'ambiguous',
        basis: 'lastFour',
        accountId: null,
        cardId: null,
        candidateAccountIds: [CARD_ACCOUNT, CHECKING],
      });
    }
  });

  it('lets the saved layout settle an ambiguous match, as an assumption', async () => {
    const harness = await withIdentifiers();

    expect(await one(harness, 'XXXX-4821', CHECKING)).toEqual({
      value: 'XXXX-4821',
      status: 'assumed',
      basis: 'profile',
      accountId: CHECKING,
      cardId: null,
      candidateAccountIds: [CARD_ACCOUNT, CHECKING],
    });
    expect(await one(harness, 'XXXX-4821', CARD_ACCOUNT)).toMatchObject({ status: 'assumed', basis: 'profile', accountId: CARD_ACCOUNT, cardId: 1 });
    // The layout's account is not among the matches: still the user's call.
    expect(await one(harness, 'XXXX-4821', SAVINGS)).toMatchObject({ status: 'ambiguous', accountId: null });
  });

  it('matches a label, then the layout, then offers accounts by name', async () => {
    const harness = await withIdentifiers();

    expect(await one(harness, ' rainy day fund ')).toMatchObject({ status: 'assumed', basis: 'label', accountId: SAVINGS });
    expect(await one(harness, 'Huntington Checking', LOAN_ACCOUNT)).toMatchObject({ status: 'assumed', basis: 'profile', accountId: LOAN_ACCOUNT });
    expect(await one(harness, 'Huntington Checking')).toEqual({
      value: 'Huntington Checking',
      status: 'unknown',
      basis: null,
      accountId: null,
      cardId: null,
      candidateAccountIds: [CHECKING, SAVINGS],
    });
    expect(await one(harness, 'summit-auto-finance_export')).toMatchObject({ status: 'unknown', candidateAccountIds: [LOAN_ACCOUNT] });
    expect(await one(harness, '')).toMatchObject({ status: 'unknown', candidateAccountIds: [] });
  });

  // A reopened database does not enforce foreign keys, so deleting an account
  // leaves its card, its identifiers and a layout's account_id behind.
  it('never matches an account that was deleted, even though its rows are still there', async () => {
    const harness = await withIdentifiers({ foreignKeys: false });
    const layoutId = await harness.imports.saveProfile({
      name: 'Travel Card export',
      format: 'delimited',
      fingerprint: 'delimited:date|description|amount',
      institution: 'Chase',
      account_id: CARD_ACCOUNT,
      config: {
        version: 1,
        layout: { roles: { date: 0, description: [1], amount: 2 }, dateOrder: 'MDY', decimal: '.', amountSign: 'inverted' },
      },
    });
    await harness.imports.addAccountIdentifier({ account_id: CARD_ACCOUNT, kind: 'label', value: 'Travel Rewards' });

    harness.db.exec(`DELETE FROM accounts WHERE id = ${CARD_ACCOUNT}`);
    // Nothing cascaded: the leftovers are what the lookups have to ignore.
    expect(harness.count('account_cards', `account_id = ${CARD_ACCOUNT}`)).toBe(1);
    expect(harness.count('account_identifiers', `account_id = ${CARD_ACCOUNT}`)).toBe(1);

    expect(await one(harness, '4000 0000 0000 4821')).toMatchObject({
      // The full number is the deleted card's; only the checking account still ends in 4821.
      status: 'assumed',
      basis: 'lastFour',
      accountId: CHECKING,
      cardId: null,
      candidateAccountIds: [CHECKING],
    });
    expect(await one(harness, 'Travel Rewards')).toMatchObject({ status: 'unknown', accountId: null });
    expect((await harness.imports.listAccountIdentifiers()).map((identifier) => identifier.account_id)).not.toContain(CARD_ACCOUNT);

    // The layout survives, but no longer names an account to assume.
    const [layout] = await harness.imports.findProfilesByFingerprint('delimited:date|description|amount');
    expect(layout).toMatchObject({ id: layoutId, name: 'Travel Card export', account_id: null, account_name: null });
    expect((await harness.imports.listProfiles())[0]).toMatchObject({ id: layoutId, account_id: null });
  });
});

describe.skipIf(!sqlite)('ImportsService on SQLite: deleting a saved layout', () => {
  it.each([true, false])('leaves the import that used it in the history without it (foreign keys %s)', async (foreignKeys) => {
    const harness = openDatabase({ foreignKeys });
    const layoutId = await harness.imports.saveProfile({
      name: 'Everyday Checking export',
      format: 'delimited',
      fingerprint: 'delimited:date|description|amount',
      institution: 'Huntington',
      account_id: CHECKING,
      config: {
        version: 1,
        layout: { roles: { date: 0, description: [1], amount: 2 }, dateOrder: 'MDY', decimal: '.', amountSign: 'asIs' },
      },
    });
    await harness.imports.stageRows([row(0, '2026-09-01', -12.5, 'COFFEE ROASTERS')]);
    const { batchId } = await harness.imports.commitStaged(commitInput({ profileId: layoutId, totalRows: 1 }));
    expect((await harness.imports.listImportBatches())[0]).toMatchObject({ id: batchId, profile_id: layoutId, profile_name: 'Everyday Checking export' });

    await harness.imports.deleteProfile(layoutId);

    expect(harness.count('import_profiles')).toBe(0);
    expect(harness.all('SELECT profile_id FROM import_batches WHERE id = ?', batchId)).toEqual([{ profile_id: null }]);
    expect((await harness.imports.listImportBatches())[0]).toMatchObject({ id: batchId, profile_id: null });
    expect(harness.count('transactions', `import_batch_id = ${batchId}`)).toBe(1);
  });
});

describe.skipIf(!sqlite)('ImportsService on SQLite: account coverage', () => {
  it('reports the stored range, the count and how far the imports reach, per account', async () => {
    const harness = openDatabase();
    const { imports } = harness;
    await importRows(harness, [row(0, '2026-10-01', -4.5, 'COFFEE'), row(1, '2026-10-07', -80, 'GROCERY')], { fileName: 'october.csv' });
    await importRows(harness, [row(0, '2026-11-01', -4.5, 'COFFEE'), row(1, '2026-11-05', 1500, 'PAYROLL')], { fileName: 'november.csv' });
    // Typed in by hand: stored, but no import reaches that far.
    storeRow(harness, { accountId: CHECKING, date: '2026-12-01', amount: -20, description: 'CASH', type: 'expense' });
    storeRow(harness, { accountId: SAVINGS, date: '2026-09-15', amount: 50, description: 'INTEREST', type: 'income' });

    expect(await imports.getAccountCoverage([CHECKING, SAVINGS, LOAN_ACCOUNT])).toEqual([
      { accountId: CHECKING, firstDate: '2026-10-01', lastDate: '2026-12-01', lastImportThrough: '2026-11-05', transactionCount: 5 },
      { accountId: SAVINGS, firstDate: '2026-09-15', lastDate: '2026-09-15', lastImportThrough: null, transactionCount: 1 },
      { accountId: LOAN_ACCOUNT, firstDate: null, lastDate: null, lastImportThrough: null, transactionCount: 0 },
    ]);
  });
});
