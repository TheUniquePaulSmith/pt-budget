import { describe, expect, it, vi } from 'vitest';

import {
  IMPORTS_NOT_IMPLEMENTED,
  ImportsService,
  mapToImportBatch,
  mapToSavedImportProfile,
  normalizeIdentifierValue,
} from './databaseServiceImports';
import { IMPORT_BATCH_QUERIES, TRANSACTION_QUERIES } from './sqlQueries';
import { IMPORT_QUERIES } from './sqlQueriesImports';
import type { CommitInput, ImportProfileConfig, StagedRowInput } from './statementImport/types';

type Entry = unknown[] | ((params?: unknown[]) => unknown[]);

function createWorker(rowsBySql: Record<string, Entry> = {}) {
  const answer = (sql: string, params?: unknown[]) => {
    const entry = rowsBySql[sql];
    return typeof entry === 'function' ? entry(params) : (entry ?? []);
  };
  const query = vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params) as any[]);
  const batchQueryReturning = vi.fn(async (sql: string, parameterSets: unknown[][] = []) =>
    sql === TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION_RETURNING_ID
      ? parameterSets.map((_, index) => ({ id: 100 + index }))
      : []
  );
  return { query, batchQueryReturning };
}

function createClassification() {
  return { applyStagedDecisions: vi.fn(async () => 0), applyDecisions: vi.fn(async () => 0) };
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
    const service = new ImportsService(worker, createClassification());

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
    const service = new ImportsService(worker, createClassification());
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
    const service = new ImportsService(worker, createClassification());
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
    const service = new ImportsService(worker, createClassification());

    expect(await service.findProfilesByFingerprint('')).toEqual([]);
    expect((await service.findProfilesByFingerprint('f')).map((profile) => profile.id)).toEqual([2]);
    expect(await service.listProfiles()).toEqual([]);

    await service.recordProfileUse(2, 7);
    await service.deleteProfile(2);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.RECORD_PROFILE_USE, [7, 2]);
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.DELETE_PROFILE, [2]);
  });
});

describe('ImportsService: account identifiers', () => {
  it('stores a number as its digits with the last four, and a label lower-cased', async () => {
    expect(normalizeIdentifierValue('number', 'XXXX-XXXX-0012 3456')).toBe('00123456');
    expect(normalizeIdentifierValue('label', '  Joint Checking ')).toBe('joint checking');

    const worker = createWorker({ [IMPORT_QUERIES.ADD_IDENTIFIER]: [{ id: 11 }] });
    const service = new ImportsService(worker, createClassification());

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
    const service = new ImportsService(worker, createClassification());
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
    const service = new ImportsService(worker, createClassification());

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
    const service = new ImportsService(worker, createClassification());

    expect(await service.resolveAccounts(['4000 0000 0000 4821', 'Acct 0012345678'])).toEqual([
      { value: '4000 0000 0000 4821', status: 'recognised', basis: 'fullNumber', accountId: 2, cardId: 8, candidateAccountIds: [2] },
      { value: 'Acct 0012345678', status: 'recognised', basis: 'fullNumber', accountId: 5, cardId: null, candidateAccountIds: [5] },
    ]);
  });

  it('assumes an account from the last four digits, and says so', async () => {
    const worker = createWorker({ [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_LAST_FOUR]: [{ account_id: 5 }] });
    const service = new ImportsService(worker, createClassification());

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
    const service = new ImportsService(worker, createClassification());

    expect(await service.resolveAccounts(['4821'])).toEqual([
      { value: '4821', status: 'ambiguous', basis: 'lastFour', accountId: null, cardId: null, candidateAccountIds: [2, 6] },
    ]);
  });

  it('matches a label, then falls back to the saved layout account, then gives up', async () => {
    const worker = createWorker({
      [IMPORT_QUERIES.FIND_IDENTIFIERS_BY_VALUE]: (params) =>
        params?.[0] === 'label' && params?.[1] === 'joint checking' ? [{ account_id: 4 }] : [],
    });
    const service = new ImportsService(worker, createClassification());

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
});

describe('ImportsService: staging', () => {
  it('stages rows by direction, with content hashes and usable references', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker, createClassification());

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
    const service = new ImportsService(worker, createClassification());

    const result = await service.stageRows([row({ rowIndex: 0 }), row({ rowIndex: 1 }), row({ rowIndex: 2, description: 'OTHER' })]);

    const parameterSets = worker.batchQueryReturning.mock.calls[0][1] as unknown[][];
    expect(parameterSets.map((params) => params[13])).toEqual([0, 1, 0]);
    expect(new Set(parameterSets.map((params) => params[11])).size).toBe(3);
    expect(result.duplicateGroups).toEqual([{ rowIndexes: [0, 1] }]);
  });

  it('drops a reference that repeats within one account, so those rows dedupe on content', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker, createClassification());

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
    const service = new ImportsService(worker, createClassification());

    const result = await service.stageRows([row({ rowIndex: 4 }), row({ rowIndex: 7, description: 'TEA' })]);
    expect(result.alreadyImported).toEqual([7]);
    expect(result.tempIds).toEqual([1, 2]);
  });

  it('empties the staging table and stops when there is nothing to stage', async () => {
    const worker = createWorker();
    const service = new ImportsService(worker, createClassification());

    expect(await service.stageRows([])).toEqual({ tempIds: [], alreadyImported: [], duplicateGroups: [] });
    expect(worker.query).toHaveBeenCalledTimes(1);
    expect(worker.query).toHaveBeenCalledWith(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
    expect(worker.batchQueryReturning).not.toHaveBeenCalled();
  });
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

  it('writes one batch with its details, inserts, finalises and empties staging, in that order', async () => {
    const worker = createWorker({
      [TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP]: [{ transaction_hash: 'a' }],
      [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 42 }],
      'SELECT changes() as count': [{ count: 3 }],
    });
    const classification = createClassification();
    const service = new ImportsService(worker, classification);
    const staged = [{ key: 'tmp:1' }] as any;
    const existing = [{ key: 'tx:9' }] as any;

    const result = await service.commitStaged(input({ stagedDecisions: staged, existingDecisions: existing }));

    expect(result).toEqual({ batchId: 42, inserted: 3, duplicates: 1 });
    expect(worker.query.mock.calls.map(([sql]) => sql)).toEqual([
      TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP,
      IMPORT_BATCH_QUERIES.CREATE,
      IMPORT_QUERIES.SET_BATCH_DETAILS,
      TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP,
      'SELECT changes() as count',
      IMPORT_BATCH_QUERIES.FINALIZE,
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
    expect(worker.query).toHaveBeenCalledWith(IMPORT_BATCH_QUERIES.FINALIZE, [3, 1, 1, 0, 42]);
    // Staged decisions land before the insert copies the rows; existing legs after.
    expect(classification.applyStagedDecisions).toHaveBeenCalledWith(staged);
    expect(classification.applyDecisions).toHaveBeenCalledWith(existing);
  });

  it('leaves out the in-file duplicates the user excluded', async () => {
    const worker = createWorker({ [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 1 }] });
    const service = new ImportsService(worker, createClassification());

    await service.commitStaged(input({ excludedTempIds: [12, 15, Number.NaN] }));

    expect(worker.query.mock.calls[0][0]).toBe(
      TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace('__IDS__', '12,15')
    );
  });

  it('empties staging and rethrows when the insert fails', async () => {
    const worker = createWorker({
      [IMPORT_BATCH_QUERIES.CREATE]: [{ id: 1 }],
      [TRANSACTION_QUERIES.BULK_INSERT_FROM_TEMP]: () => {
        throw new Error('disk full');
      },
    });
    const service = new ImportsService(worker, createClassification());

    await expect(service.commitStaged(input())).rejects.toThrow('disk full');
    expect(worker.query).toHaveBeenLastCalledWith(TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE);
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
    const service = new ImportsService(worker, createClassification());
    expect((await service.listImportBatches(10))[0]).toMatchObject({ id: 2, profile_id: 3, file_format: 'ofx', profile_name: 'Bank' });
    expect(worker.query).toHaveBeenCalledWith(IMPORT_QUERIES.LIST_BATCHES, [10]);
  });

  it('has no coverage, impact or undo yet', async () => {
    const service = new ImportsService(createWorker(), createClassification());
    expect(await service.getAccountCoverage([1])).toEqual([]);
    await expect(service.getBatchImpact(1)).rejects.toThrow(IMPORTS_NOT_IMPLEMENTED);
    await expect(service.undoBatch(1)).rejects.toThrow(IMPORTS_NOT_IMPLEMENTED);
  });
});
