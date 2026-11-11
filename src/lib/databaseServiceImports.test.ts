import { describe, expect, it, vi } from 'vitest';

import type { TypeDecision } from '../types/classification';
import {
  IMPORT_BATCH_NOT_FOUND,
  ImportsService,
  mapToImportBatch,
  mapToSavedImportProfile,
  normalizeIdentifierValue,
  stagedDecisionParams,
  storedDecisionParams,
} from './databaseServiceImports';
import { CLASSIFICATION_QUERIES, IMPORT_BATCH_QUERIES, TRANSACTION_QUERIES } from './sqlQueries';
import { IMPORT_QUERIES } from './sqlQueriesImports';
import type { CommitInput, ImportProfileConfig, StagedRowInput } from './statementImport/types';
import { computeTransactionHash } from './transactionHash';

type Entry = unknown[] | ((params?: unknown[]) => unknown[]);

/**
 * The transport stub. `statements` is every statement in the order it was
 * sent, single queries and batches alike, so a test can assert what ran
 * between BEGIN and COMMIT.
 */
function createWorker(rowsBySql: Record<string, Entry> = {}) {
  const statements: string[] = [];
  const answer = (sql: string, params?: unknown[]) => {
    const entry = rowsBySql[sql];
    return typeof entry === 'function' ? entry(params) : (entry ?? []);
  };
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    return answer(sql, params) as any[];
  });
  const batchQueryReturning = vi.fn(
    async (sql: string, parameterSets: unknown[][] = [], _options?: { useTransaction?: boolean }) => {
      statements.push(sql);
      return sql === TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION_RETURNING_ID
        ? parameterSets.map((_, index) => ({ id: 100 + index }))
        : [];
    }
  );
  return { query, batchQueryReturning, statements };
}

const CONFIG: ImportProfileConfig = {
  version: 1,
  layout: { roles: { date: 0, description: [2], amount: 1 }, dateOrder: 'DMY', decimal: ',', amountSign: 'inverted' },
};

const row = (overrides: Partial<StagedRowInput> = {}): StagedRowInput => ({
  rowIndex: 0,
  accountId: 1,
  cardId: null,
  date: '2026-10-01',
  amount: -12.5,
  description: 'COFFEE',
  reference: null,
  ...overrides,
});

describe('ImportsService: saved layouts', () => {
  it('maps a profile row and parses its layout', () => {
    const profile = mapToSavedImportProfile({
      id: 3,
      name: 'Card export',
      format: 'delimited',
      fingerprint: 'delimited:date|amount|description',
      institution: null,
      account_id: null,
      config_json: JSON.stringify(CONFIG),
      use_count: null,
      last_used_at: null,
      account_name: null,
    });
    expect(profile).toMatchObject({ id: 3, format: 'delimited', account_id: null, use_count: 0, institution: null });
    expect(profile.config).toEqual(CONFIG);
    expect(profile).not.toHaveProperty('config_json');
  });

  it('treats an unreadable layout as no layout instead of throwing', () => {
    const profile = mapToSavedImportProfile({ id: 1, name: 'Broken', format: 'ofx', fingerprint: 'x', config_json: '{not json' });
    expect(profile.format).toBe('ofx');
    expect(profile.config.layout.roles).toEqual({ date: null, description: [] });
  });

  it('creates a layout with trimmed text and the layout as JSON', async () => {
    const worker = createWorker({ [IMPORT_QUERIES.CREATE_PROFILE]: [{ id: 9 }] });
    const service = new ImportsService(worker);

    const id = await service.saveProfile({
      name: '  Card export ',
      format: 'delimited',
      fingerprint: 'delimited:a|b',
      institution: '  ',
      account_id: 4,
      config: CONFIG,
    });

    expect(id).toBe(9);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.CREATE_PROFILE, [
      'Card export',
      'delimited',
      'delimited:a|b',
      null,
      4,
      JSON.stringify(CONFIG),
    ]);
  });

  it('replaces an existing layout when an id is given', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);
    await expect(
      service.saveProfile({ name: 'X', format: 'ofx', fingerprint: 'ofx:bank:checking', config: CONFIG }, 5)
    ).resolves.toBe(5);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.UPDATE_PROFILE, [
      'X',
      'ofx',
      'ofx:bank:checking',
      null,
      null,
      JSON.stringify(CONFIG),
      5,
    ]);
  });

  it('rejects a layout without a name or a fingerprint before touching the database', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);
    await expect(service.saveProfile({ name: ' ', format: 'delimited', fingerprint: 'f', config: CONFIG })).rejects.toThrow(
      'IMPORT_PROFILE_NAME_REQUIRED'
    );
    await expect(service.saveProfile({ name: 'A', format: 'delimited', fingerprint: '', config: CONFIG })).rejects.toThrow(
      'IMPORT_PROFILE_FINGERPRINT_REQUIRED'
    );
    expect(worker.query).not.toHaveBeenCalled();
  });

  it('finds layouts by fingerprint, records a use and deletes', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_PROFILES_BY_FINGERPRINT]: [{ id: 2, name: 'A', format: 'delimited', fingerprint: 'f', config_json: JSON.stringify(CONFIG) }],
      [IMPORT_QUERIES.LIST_PROFILES]: [],
    });
    const service = new ImportsService(worker);

    expect(await service.findProfilesByFingerprint('')).toEqual([]);
    expect((await service.findProfilesByFingerprint('f')).map((profile) => profile.id)).toEqual([2]);
    expect(await service.listProfiles()).toEqual([]);

    await service.recordProfileUse(2, 7);
    await service.deleteProfile(2);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.RECORD_PROFILE_USE, [7, 2]);
    // The runs that used the layout are unlinked first, in the same transaction.
    expect(worker.statements.slice(-4)).toEqual([
      'BEGIN TRANSACTION',
      IMPORT_QUERIES.CLEAR_PROFILE_ON_BATCHES,
      IMPORT_QUERIES.DELETE_PROFILE,
      'COMMIT',
    ]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.CLEAR_PROFILE_ON_BATCHES, [2]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.DELETE_PROFILE, [2]);
  });
});

describe('ImportsService: account identifiers', () => {
  it('stores a number as its digits with the last four, and a label lower-cased', async () => {
    expect(normalizeIdentifierValue('number', 'XXXX-XXXX-0012 3456')).toBe('00123456');
    expect(normalizeIdentifierValue('label', '  Joint Checking ')).toBe('joint checking');

    const worker = createWorker({ [IMPORT_QUERIES.ADD_IDENTIFIER]: [{ id: 11 }] });
    const service = new ImportsService(worker);

    await service.addAccountIdentifier({ account_id: 3, kind: 'number', value: 'Acct ****9034' });
    await service.addAccountIdentifier({ account_id: 3, kind: 'label', value: ' Joint Checking ', source: 'manual' });
    await service.addAccountIdentifier({ account_id: 3, kind: 'number', value: '12' });

    expect(worker.query).toHaveBeenNthCalledWith(1, IMPORT_QUERIES.ADD_IDENTIFIER, [3, 'number', '9034', '9034', 'import']);
    expect(worker.query).toHaveBeenNthCalledWith(2, IMPORT_QUERIES.ADD_IDENTIFIER, [3, 'label', 'joint checking', null, 'manual']);
    // Fewer than four digits: kept, but never matched by last four.
    expect(worker.query).toHaveBeenNthCalledWith(3, IMPORT_QUERIES.ADD_IDENTIFIER, [3, 'number', '12', null, 'import']);
  });

  it('refuses an identifier with nothing usable in it', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);
    await expect(service.addAccountIdentifier({ account_id: 1, kind: 'number', value: 'no digits' })).rejects.toThrow(
      'ACCOUNT_IDENTIFIER_VALUE_REQUIRED'
    );
    expect(worker.query).not.toHaveBeenCalled();
  });

  it('lists identifiers for every account or for one, and removes one', async () => {
    const identifier = { id: 1, account_id: 3, kind: 'number', value: '9034', last_four: '9034', source: 'import', account_name: 'Savings' };
    const worker = createWorker({
      [IMPORT_QUERIES.LIST_IDENTIFIERS]: [identifier],
      [IMPORT_QUERIES.LIST_IDENTIFIERS_FOR_ACCOUNT]: [{ ...identifier, account_name: undefined, kind: 'label', last_four: null }],
    });
    const service = new ImportsService(worker);

    expect(await service.listAccountIdentifiers()).toEqual([
      { id: 1, account_id: 3, kind: 'number', value: '9034', last_four: '9034', source: 'import', created_at: '', account_name: 'Savings' },
    ]);
    expect((await service.listAccountIdentifiers(3))[0]).toMatchObject({ kind: 'label', last_four: null });
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.LIST_IDENTIFIERS_FOR_ACCOUNT, [3]);

    await service.removeAccountIdentifier(1);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.DELETE_IDENTIFIER, [1]);
  });
});

describe('ImportsService: resolving accounts', () => {
  it('recognises a full number, on a card or as an identifier', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_CARDS_BY_FULL_NUMBER]: (params) => (params?.[0] === '4000000000004821' ? [{ card_id: 8, account_id: 2 }] : []),
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_VALUE]: (params) =>
        params?.[0] === 'number' && params?.[1] === '0012345678' ? [{ account_id: 5 }] : [],
    });
    const service = new ImportsService(worker);

    expect(await service.resolveAccounts(['4000 0000 0000 4821', 'Acct 0012345678'])).toEqual([
      { value: '4000 0000 0000 4821', status: 'recognised', basis: 'fullNumber', accountId: 2, cardId: 8, candidateAccountIds: [2] },
      { value: 'Acct 0012345678', status: 'recognised', basis: 'fullNumber', accountId: 5, cardId: null, candidateAccountIds: [5] },
    ]);
  });

  it('assumes an account from the last four digits, and says so', async () => {
    const worker = createWorker({ [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR]: [{ account_id: 5 }] });
    const service = new ImportsService(worker);

    // No full-number match for the long value, so its last four decide.
    expect(await service.resolveAccounts(['XXXXXX9034', '9034'])).toEqual([
      { value: 'XXXXXX9034', status: 'assumed', basis: 'lastFour', accountId: 5, cardId: null, candidateAccountIds: [5] },
      { value: '9034', status: 'assumed', basis: 'lastFour', accountId: 5, cardId: null, candidateAccountIds: [5] },
    ]);
  });

  it('reports several matches as ambiguous instead of picking one', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_CARDS_BY_LAST_FOUR]: [{ card_id: 1, account_id: 2 }, { card_id: 2, account_id: 2 }],
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR]: [{ account_id: 6 }],
    });
    const service = new ImportsService(worker);

    expect(await service.resolveAccounts(['4821'])).toEqual([
      { value: '4821', status: 'ambiguous', basis: 'lastFour', accountId: null, cardId: null, candidateAccountIds: [2, 6] },
    ]);
  });

  it('matches a label, then falls back to the saved layout account, then gives up', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_VALUE]: (params) =>
        params?.[0] === 'label' && params?.[1] === 'joint checking' ? [{ account_id: 4 }] : [],
    });
    const service = new ImportsService(worker);

    expect(await service.resolveAccounts([' Joint Checking ', '', 'Mystery'], { profileAccountId: 7 })).toEqual([
      { value: ' Joint Checking ', status: 'assumed', basis: 'label', accountId: 4, cardId: null, candidateAccountIds: [4] },
      { value: '', status: 'assumed', basis: 'profile', accountId: 7, cardId: null, candidateAccountIds: [7] },
      { value: 'Mystery', status: 'assumed', basis: 'profile', accountId: 7, cardId: null, candidateAccountIds: [7] },
    ]);
    expect(await service.resolveAccounts(['', '', 'Mystery'])).toEqual([
      { value: '', status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [] },
      { value: 'Mystery', status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [] },
    ]);
  });

  it('prefers a full number over the last four it also ends in', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_VALUE]: (params) =>
        params?.[0] === 'number' && params?.[1] === '0012344821' ? [{ account_id: 5 }] : [],
      [IMPORT_QUERIES.FIND_CARDS_BY_LAST_FOUR]: [{ card_id: 1, account_id: 2 }],
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR]: [{ account_id: 5 }, { account_id: 6 }],
    });
    const service = new ImportsService(worker);

    expect(await service.resolveAccounts(['0012344821'])).toEqual([
      { value: '0012344821', status: 'recognised', basis: 'fullNumber', accountId: 5, cardId: null, candidateAccountIds: [5] },
    ]);
    // The full number decided: the last four were never looked up.
    expect(worker.statements).not.toContain(IMPORT_QUERIES.FIND_CARDS_BY_LAST_FOUR);
    expect(worker.statements).not.toContain(IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR);
  });

  it('settles several matches on the saved layout account when it is one of them', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_CARDS_BY_LAST_FOUR]: [{ card_id: 1, account_id: 2 }, { card_id: 3, account_id: 6 }],
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR]: [{ account_id: 9 }],
    });
    const service = new ImportsService(worker);

    // Assumed, never recognised, and it says the layout is why.
    expect(await service.resolveAccounts(['4821'], { profileAccountId: 6 })).toEqual([
      { value: '4821', status: 'assumed', basis: 'profile', accountId: 6, cardId: 3, candidateAccountIds: [2, 6, 9] },
    ]);
    // Matched through an identifier, so there is no card to attach.
    expect(await service.resolveAccounts(['4821'], { profileAccountId: 9 })).toEqual([
      { value: '4821', status: 'assumed', basis: 'profile', accountId: 9, cardId: null, candidateAccountIds: [2, 6, 9] },
    ]);
    // A layout account that did not match does not break the tie.
    expect(await service.resolveAccounts(['4821'], { profileAccountId: 7 })).toEqual([
      { value: '4821', status: 'ambiguous', basis: 'lastFour', accountId: null, cardId: null, candidateAccountIds: [2, 6, 9] },
    ]);
  });

  it('offers the accounts whose name or institution resembles an unknown value', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.LIST_ACCOUNTS_FOR_HINTS]: [
        { id: 1, name: 'Everyday', institution: 'Huntington' },
        { id: 2, name: 'Huntington Savings', institution: null },
        { id: 3, name: 'Travel Card', institution: 'Chase' },
        { id: 4, name: null, institution: null },
      ],
    });
    const service = new ImportsService(worker);

    expect(await service.resolveAccounts(['Huntington Checking', 'Checking account', 'Chase Sapphire', ''])).toEqual([
      { value: 'Huntington Checking', status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [1, 2] },
      // Account-type words alone say nothing about which account is meant.
      { value: 'Checking account', status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [] },
      { value: 'Chase Sapphire', status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [3] },
      { value: '', status: 'unknown', basis: null, accountId: null, cardId: null, candidateAccountIds: [] },
    ]);
    // The account list is read once for the whole call.
    expect(worker.statements.filter((sql) => sql === IMPORT_QUERIES.LIST_ACCOUNTS_FOR_HINTS)).toHaveLength(1);
  });

  it('does not read the account list when every value matched', async () => {
    const worker = createWorker({ [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR]: [{ account_id: 5 }] });
    const service = new ImportsService(worker);

    await service.resolveAccounts(['9034', ''], { profileAccountId: 5 });
    expect(worker.statements).not.toContain(IMPORT_QUERIES.LIST_ACCOUNTS_FOR_HINTS);
  });
});

describe('ImportsService: staging', () => {
  it('stages rows by direction, with content hashes and usable references', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);

    const result = await service.stageRows([
      row({ rowIndex: 0, reference: 'R1', cardId: 9 }),
      row({ rowIndex: 3, amount: 100, description: 'PAYROLL', reference: '0' }),
    ]);

    expect(worker.query).toHaveBeenNthCalledWith(1, TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
    const [sql, parameterSets] = worker.batchQueryReturning.mock.calls[0] as [string, unknown[][]];
    expect(sql).toBe(TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION_RETURNING_ID);
    expect(parameterSets[0].slice(0, 11)).toEqual(['2026-10-01', -12.5, 'COFFEE', null, 1, 9, null, null, null, null, 'expense']);
    expect(parameterSets[0][11]).toMatch(/^[0-9a-f]{64}$/);
    expect(parameterSets[0].slice(12)).toEqual(['R1', 0]);
    // Money in is income until the classifier says otherwise; "0" is a placeholder, not a reference.
    expect(parameterSets[1][10]).toBe('income');
    expect(parameterSets[1].slice(12)).toEqual([null, 0]);

    expect(result).toEqual({ tempIds: [100, 101], alreadyImported: [], duplicateGroups: [] });
  });

  it('keeps identical rows apart with variation seeds and reports them as a group', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);

    const result = await service.stageRows([row({ rowIndex: 0 }), row({ rowIndex: 1 }), row({ rowIndex: 2, description: 'OTHER' })]);

    const parameterSets = worker.batchQueryReturning.mock.calls[0][1] as unknown[][];
    expect(parameterSets.map((params) => params[13])).toEqual([0, 1, 0]);
    expect(new Set(parameterSets.map((params) => params[11])).size).toBe(3);
    expect(result.duplicateGroups).toEqual([{ rowIndexes: [0, 1] }]);
  });

  it('drops a reference that repeats within one account, so those rows dedupe on content', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);

    await service.stageRows([
      row({ rowIndex: 0, reference: 'SAME' }),
      row({ rowIndex: 1, reference: 'SAME', description: 'TEA' }),
      row({ rowIndex: 2, reference: 'SAME', accountId: 2 }),
    ]);

    const parameterSets = worker.batchQueryReturning.mock.calls[0][1] as unknown[][];
    expect(parameterSets.map((params) => params[12])).toEqual([null, null, 'SAME']);
  });

  it('reports the rows that are already stored', async () => {
    let stagedHashes: string[] = [];
    const worker = createWorker({
      [TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP]: () => [{ transaction_hash: stagedHashes[1] }],
    });
    worker.batchQueryReturning.mockImplementation(async (_sql: string, parameterSets: unknown[][] = []) => {
      stagedHashes = parameterSets.map((params) => String(params[11]));
      return parameterSets.map((_, index) => ({ id: index + 1 }));
    });
    const service = new ImportsService(worker);

    const result = await service.stageRows([row({ rowIndex: 4 }), row({ rowIndex: 7, description: 'TEA' })]);
    expect(result.alreadyImported).toEqual([7]);
    expect(result.tempIds).toEqual([1, 2]);
  });

  it('empties the staging table and stops when there is nothing to stage', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);

    expect(await service.stageRows([])).toEqual({ tempIds: [], alreadyImported: [], duplicateGroups: [] });
    expect(worker.query).toHaveBeenCalledTimes(1);
    expect(worker.query).toHaveBeenCalledWith(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
    expect(worker.batchQueryReturning).not.toHaveBeenCalled();
  });
});

const decision = (overrides: Partial<TypeDecision> = {}): TypeDecision => ({
  key: 'tmp:1',
  type: 'transfer',
  source: 'pair',
  confidence: 0.9,
  transferGroupId: 'group-1',
  ruleId: null,
  pairedWithKey: null,
  reasons: [],
  ...overrides,
});

describe('ImportsService: commit', () => {
  const input = (overrides: Partial<CommitInput> = {}): CommitInput => ({
    fileName: 'export.csv',
    format: 'delimited',
    profileId: 3,
    accountIds: [1],
    totalRows: 5,
    skippedRows: 1,
    rejectedRows: 0,
    issues: { counts: { blankDescription: 2 }, assumptions: ['amountSign:signAssumed'], fixedRows: 1 },
    excludedTempIds: [],
    stagedDecisions: [],
    existingDecisions: [],
    ...overrides,
  });

  it('writes the batch, the decisions, the rows and the totals in one transaction, then empties staging', async () => {
    const worker = createWorker({
      [TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP]: [{ transaction_hash: 'a' }],
      [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 42 }],
      [IMPORT_QUERIES.COUNT_BATCH_TRANSACTIONS]: [{ count: 3 }],
    });
    const service = new ImportsService(worker);

    const result = await service.commitStaged(
      input({
        stagedDecisions: [decision({ key: 'tmp:7' }), decision({ key: 'tmp:8', type: 'refund', source: 'inferred', confidence: 0.6, transferGroupId: null })],
        existingDecisions: [
          decision({ key: 'tx:9' }),
          decision({ key: 'tx:11', type: 'expense', source: 'sign', confidence: null, transferGroupId: null }),
        ],
      })
    );

    expect(result).toEqual({ batchId: 42, inserted: 3, duplicates: 1 });
    expect(worker.statements).toEqual([
      'BEGIN TRANSACTION',
      TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP,
      IMPORT_BATCH_QUERIES.CREATE,
      IMPORT_QUERIES.SET_BATCH_DETAILS,
      // Staged decisions land before the insert copies the rows; existing legs after.
      CLASSIFICATION_QUERIES.UPDATE_STAGED_CLASSIFICATION,
      TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP,
      IMPORT_QUERIES.COUNT_BATCH_TRANSACTIONS,
      CLASSIFICATION_QUERIES.APPLY_CLASSIFICATION,
      CLASSIFICATION_QUERIES.SET_TRANSFER_GROUP_ON_LOCKED_TRANSFER,
      IMPORT_BATCH_QUERIES.FINALIZE,
      'COMMIT',
      TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE,
    ]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_BATCH_QUERIES.CREATE, ['csv', 'export.csv', '[1]', 5]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.SET_BATCH_DETAILS, [
      3,
      'delimited',
      JSON.stringify({ counts: { blankDescription: 2 }, assumptions: ['amountSign:signAssumed'], fixedRows: 1 }),
      42,
    ]);
    expect(worker.query).toHaveBeenCalledWith(TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP, [42]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.COUNT_BATCH_TRANSACTIONS, [42]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_BATCH_QUERIES.FINALIZE, [3, 1, 1, 0, 42]);

    // Every batched write joins the open transaction instead of starting its own.
    expect(worker.batchQueryReturning.mock.calls).toEqual([
      [
        CLASSIFICATION_QUERIES.UPDATE_STAGED_CLASSIFICATION,
        [
          ['transfer', 'group-1', 'pair', 0.9, 7],
          ['refund', null, 'inferred', 0.6, 8],
        ],
        { useTransaction: false },
      ],
      [
        CLASSIFICATION_QUERIES.APPLY_CLASSIFICATION,
        [
          ['transfer', 'group-1', 'pair', 0.9, 9],
          ['expense', null, 'sign', null, 11],
        ],
        { useTransaction: false },
      ],
      // Only a transfer with a group can give a locked row its counterpart.
      [CLASSIFICATION_QUERIES.SET_TRANSFER_GROUP_ON_LOCKED_TRANSFER, [['group-1', 9]], { useTransaction: false }],
    ]);
  });

  it('sends no decision statements when there are no decisions, and counts nothing as zero', async () => {
    const worker = createWorker({ [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 1 }] });
    const service = new ImportsService(worker);

    expect(await service.commitStaged(input({ profileId: null, format: 'ofx' }))).toEqual({ batchId: 1, inserted: 0, duplicates: 0 });
    expect(worker.batchQueryReturning).not.toHaveBeenCalled();
    // No exclusions: the staged rows are not read back.
    expect(worker.statements).not.toContain(IMPORT_QUERIES.GET_STAGED_ROWS);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.SET_BATCH_DETAILS, [null, 'ofx', expect.any(String), 1]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_BATCH_QUERIES.FINALIZE, [0, 0, 1, 0, 1]);
  });

  it('sorts decisions by key kind and refuses a malformed key', () => {
    const decisions = [decision({ key: 'tmp:4' }), decision({ key: 'tx:5', transferGroupId: null })];
    expect(stagedDecisionParams(decisions)).toEqual([['transfer', 'group-1', 'pair', 0.9, 4]]);
    expect(storedDecisionParams(decisions)).toEqual({ full: [['transfer', null, 'pair', 0.9, 5]], lockedTransfers: [] });
    expect(() => stagedDecisionParams([decision({ key: 'row:4' })])).toThrow('Invalid classification key: row:4');
  });

  describe('in-file duplicates the user left out', () => {
    const copy = { account_id: 1, date: '2026-11-01', amount: 100, description: 'VENMO CASHOUT' };
    const hashOf = (seed: number) => computeTransactionHash(copy.account_id, copy.date, copy.amount, copy.description, seed);
    // Three identical rows staged under seeds 0, 1, 2 and one unrelated row.
    const stagedRows = async () => [
      { id: 10, ...copy, transaction_hash: await hashOf(0), hash_variation_seed: 0 },
      { id: 11, ...copy, transaction_hash: await hashOf(1), hash_variation_seed: 1 },
      { id: 12, ...copy, transaction_hash: await hashOf(2), hash_variation_seed: 2 },
      { id: 13, ...copy, description: 'COFFEE', transaction_hash: 'coffee-hash', hash_variation_seed: null },
    ];
    const commitExcluding = async (excludedTempIds: number[]) => {
      const worker = createWorker({
        [IMPORT_QUERIES.GET_STAGED_ROWS]: await stagedRows(),
        [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 1 }],
      });
      await new ImportsService(worker).commitStaged(input({ excludedTempIds }));
      return worker;
    };

    it('removes them and re-seeds the kept copies 0, 1, 2… inside the transaction', async () => {
      const worker = await commitExcluding([10, 10, Number.NaN]);

      expect(worker.statements.slice(0, 5)).toEqual([
        // Read before the transaction opens; nothing is written yet.
        IMPORT_QUERIES.GET_STAGED_ROWS,
        'BEGIN TRANSACTION',
        TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace('__IDS__', '10'),
        IMPORT_QUERIES.RESEED_STAGED_ROW,
        TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP,
      ]);
      // The second copy becomes the first (the content hash), the third the second.
      expect(worker.batchQueryReturning).toHaveBeenCalledWith(
        IMPORT_QUERIES.RESEED_STAGED_ROW,
        [
          [await hashOf(0), 0, 11],
          [await hashOf(1), 1, 12],
        ],
        { useTransaction: false }
      );
    });

    it('re-seeds only the copies after the one left out', async () => {
      const worker = await commitExcluding([11]);
      expect(worker.batchQueryReturning).toHaveBeenCalledWith(
        IMPORT_QUERIES.RESEED_STAGED_ROW,
        [[await hashOf(1), 1, 12]],
        { useTransaction: false }
      );
    });

    it('changes no hash when the last copy is the one left out', async () => {
      const worker = await commitExcluding([12]);
      expect(worker.statements).toContain(TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace('__IDS__', '12'));
      expect(worker.batchQueryReturning).not.toHaveBeenCalled();
    });
  });

  it('rolls back, empties staging and rethrows when the insert fails', async () => {
    const worker = createWorker({
      [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 1 }],
      [TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP]: () => {
        throw new Error('disk full');
      },
    });
    const service = new ImportsService(worker);

    await expect(service.commitStaged(input())).rejects.toThrow('disk full');
    expect(worker.statements).toEqual([
      'BEGIN TRANSACTION',
      TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP,
      IMPORT_BATCH_QUERIES.CREATE,
      IMPORT_QUERIES.SET_BATCH_DETAILS,
      TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP,
      // The batch row goes with everything else; nothing is committed.
      'ROLLBACK',
      TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE,
    ]);
  });

  it('reports the original failure even when the rollback fails too', async () => {
    const worker = createWorker({
      [IMPORT_BATCH_QUERIES.CREATE]: () => {
        throw new Error('constraint failed');
      },
      ROLLBACK: () => {
        throw new Error('no transaction is active');
      },
    });
    const service = new ImportsService(worker);

    await expect(service.commitStaged(input())).rejects.toThrow('constraint failed');
    expect(worker.query).toHaveBeenLastCalledWith(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
  });

  it('refuses a malformed decision before anything is written, and still empties staging', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);

    await expect(service.commitStaged(input({ existingDecisions: [decision({ key: 'nonsense' })] }))).rejects.toThrow(
      'Invalid classification key: nonsense'
    );
    expect(worker.statements).toEqual([TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE]);
  });
});

describe('ImportsService: history', () => {
  it('maps import batches, including rows written before schema v7', async () => {
    expect(
      mapToImportBatch({ id: 1, imported_at: '2026-11-01 10:00:00', source: 'csv', file_name: null, total_rows: null })
    ).toEqual({
      id: 1,
      imported_at: '2026-11-01 10:00:00',
      source: 'csv',
      file_name: null,
      account_ids_json: null,
      total_rows: 0,
      inserted_count: 0,
      duplicate_count: 0,
      skipped_count: 0,
      rejected_count: 0,
      min_date: null,
      max_date: null,
      profile_id: null,
      file_format: null,
      issues_json: null,
    });

    const worker = createWorker({
      [IMPORT_QUERIES.LIST_BATCHES]: [{ id: 2, imported_at: 'x', source: 'csv', profile_id: 3, file_format: 'ofx', issues_json: '{}', profile_name: 'Bank' }],
    });
    const service = new ImportsService(worker);
    expect((await service.listImportBatches(10))[0]).toMatchObject({ id: 2, profile_id: 3, file_format: 'ofx', profile_name: 'Bank' });
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.LIST_BATCHES, [10]);
    await service.listImportBatches();
    expect(worker.query).toHaveBeenLastCalledWith(IMPORT_QUERIES.LIST_BATCHES, [50]);
  });

  it('reports what is stored per account, one entry per account asked for', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.ACCOUNT_COVERAGE.replace('__IDS__', '4,2,9')]: [
        { account_id: 2, first_date: '2026-01-03', last_date: '2026-10-30', transaction_count: 212, last_import_through: '2026-10-30' },
        // Rows entered by hand only: stored, but never imported.
        { account_id: 4, first_date: '2026-09-01', last_date: '2026-09-02', transaction_count: 2, last_import_through: null },
      ],
    });
    const service = new ImportsService(worker);

    expect(await service.getAccountCoverage([4, 2, 4, 9, 1.5, Number.NaN])).toEqual([
      { accountId: 4, firstDate: '2026-09-01', lastDate: '2026-09-02', lastImportThrough: null, transactionCount: 2 },
      { accountId: 2, firstDate: '2026-01-03', lastDate: '2026-10-30', lastImportThrough: '2026-10-30', transactionCount: 212 },
      // No transactions yet: the query returns no row for it.
      { accountId: 9, firstDate: null, lastDate: null, lastImportThrough: null, transactionCount: 0 },
    ]);
    expect(worker.query).toHaveBeenCalledTimes(1);
  });

  it('asks nothing when no usable account id is given', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);
    expect(await service.getAccountCoverage([])).toEqual([]);
    expect(await service.getAccountCoverage([Number.NaN])).toEqual([]);
    expect(worker.query).not.toHaveBeenCalled();
  });
});

describe('ImportsService: undo', () => {
  const impactRow = { transactions: 12, edited_since_import: 2, loan_payments: 1, transfer_pairs: 3 };

  it('reports what undoing a batch would remove', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.GET_BATCH]: [{ id: 7 }],
      [IMPORT_QUERIES.BATCH_IMPACT]: [impactRow],
    });
    const service = new ImportsService(worker);

    expect(await service.getBatchImpact(7)).toEqual({
      batchId: 7,
      transactions: 12,
      editedSinceImport: 2,
      loanPayments: 1,
      transferPairs: 3,
    });
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.GET_BATCH, [7]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.BATCH_IMPACT, [7]);
  });

  it('counts a batch that inserted nothing as zeros', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.GET_BATCH]: [{ id: 7 }],
      [IMPORT_QUERIES.BATCH_IMPACT]: [{ transactions: null, edited_since_import: null, loan_payments: null, transfer_pairs: null }],
    });
    const service = new ImportsService(worker);
    expect(await service.getBatchImpact(7)).toEqual({ batchId: 7, transactions: 0, editedSinceImport: 0, loanPayments: 0, transferPairs: 0 });

    const silent = new ImportsService(createWorker({ [IMPORT_QUERIES.GET_BATCH]: [{ id: 7 }] }));
    expect(await silent.getBatchImpact(7)).toMatchObject({ transactions: 0, transferPairs: 0 });
  });

  it('refuses an id that is not an import batch', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker);

    await expect(service.getBatchImpact(99)).rejects.toThrow(IMPORT_BATCH_NOT_FOUND);
    await expect(service.getBatchImpact(1.5)).rejects.toThrow(IMPORT_BATCH_NOT_FOUND);
    await expect(service.undoBatch(99)).rejects.toThrow(IMPORT_BATCH_NOT_FOUND);
    // Looked up, never written to: no transaction was opened.
    expect(worker.statements).toEqual([IMPORT_QUERIES.GET_BATCH, IMPORT_QUERIES.GET_BATCH]);
  });

  it('lists the loans that have a payment in the batch', async () => {
    const worker = createWorker({ [IMPORT_QUERIES.BATCH_LOAN_IDS]: [{ loan_id: 2 }, { loan_id: '5' }] });
    const service = new ImportsService(worker);

    expect(await service.getBatchLoanIds(7)).toEqual([2, 5]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.BATCH_LOAN_IDS, [7]);
    expect(await service.getBatchLoanIds(Number.NaN)).toEqual([]);
    expect(worker.query).toHaveBeenCalledTimes(1);
  });

  it('removes the batch and what hangs off it in one transaction, and returns what went', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.GET_BATCH]: [{ id: 7 }],
      [IMPORT_QUERIES.BATCH_IMPACT]: [impactRow],
    });
    const service = new ImportsService(worker);

    expect(await service.undoBatch(7)).toEqual({
      batchId: 7,
      transactions: 12,
      editedSinceImport: 2,
      loanPayments: 1,
      transferPairs: 3,
    });
    expect(worker.query.mock.calls).toEqual([
      [IMPORT_QUERIES.GET_BATCH, [7]],
      [IMPORT_QUERIES.BATCH_IMPACT, [7]],
      ['BEGIN TRANSACTION'],
      // Children first: cascades are off on reopened databases.
      [IMPORT_QUERIES.DELETE_BATCH_SERIES_LINKS, [7]],
      [IMPORT_QUERIES.DELETE_BATCH_LOAN_PAYMENTS, [7]],
      // Surviving legs are freed while the batch's rows still say which groups they were in.
      [IMPORT_QUERIES.REVERT_SURVIVING_PAIRED_LEGS, [7, 7]],
      [IMPORT_QUERIES.CLEAR_SURVIVING_TRANSFER_GROUPS, [7, 7]],
      [IMPORT_QUERIES.DELETE_BATCH_TRANSACTIONS, [7]],
      [IMPORT_BATCH_QUERIES.DELETE, [7]],
      ['COMMIT'],
    ]);
  });

  it('rolls the whole undo back when a step fails', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.GET_BATCH]: [{ id: 7 }],
      [IMPORT_QUERIES.BATCH_IMPACT]: [impactRow],
      [IMPORT_QUERIES.DELETE_BATCH_TRANSACTIONS]: () => {
        throw new Error('database is locked');
      },
    });
    const service = new ImportsService(worker);

    await expect(service.undoBatch(7)).rejects.toThrow('database is locked');
    expect(worker.statements.at(-1)).toBe('ROLLBACK');
    expect(worker.statements).not.toContain('COMMIT');
    expect(worker.statements).not.toContain(IMPORT_BATCH_QUERIES.DELETE);
  });
});
