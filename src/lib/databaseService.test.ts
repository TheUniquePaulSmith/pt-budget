import { afterEach, describe, expect, it, vi } from 'vitest';

import { databaseWorkerService } from './databaseWorkerService';
import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import {
  ACCOUNT_CARD_QUERIES,
  ACCOUNT_QUERIES,
  ANALYTICS_QUERIES,
  BUDGET_QUERIES,
  CATEGORY_QUERIES,
  COMPANY_QUERIES,
  PROJECT_QUERIES,
  TRANSACTION_QUERIES,
  TRIP_QUERIES,
  USER_QUERIES,
} from './sqlQueries';
import type {
  Account,
  AccountCard,
  Budget,
  Category,
  Company,
  Project,
  Transaction,
  Trip,
  User,
} from '../types/database';

type TransactionInput = Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;

const baseTransaction: TransactionInput = {
  date: '2026-04-25',
  amount: -42.5,
  description: 'Hardware store purchase',
  account_id: 7,
  category_id: null,
  company_id: 12,
  project_id: null,
  trip_id: null,
  type: 'expense',
};

const existingProject: Project = {
  id: 9,
  name: 'Kitchen Remodel',
  company_name: 'Acme Plumbing',
  contact_details: 'joe@acme.example',
  project_category: 'plumbing',
  status: 'planning',
  start_date: '2026-03-01',
  end_date: null,
  estimated_cost: 5000,
  actual_cost: 1000,
  notes: 'Initial scope',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
};

const existingTrip: Trip = {
  id: 12,
  name: 'Seattle Client Visit',
  destination: 'Seattle',
  purpose: 'Implementation workshop',
  trip_category: 'business',
  status: 'planning',
  start_date: '2026-05-10',
  end_date: '2026-05-12',
  estimated_cost: 1400,
  actual_cost: 250,
  notes: 'Book hotel near office',
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

const transactionRow = {
  id: 31,
  date: '2026-04-20',
  amount: -25.75,
  description: 'Fuel stop',
  account_id: 3,
  category_id: 4,
  company_id: null,
  project_id: 8,
  trip_id: 0,
  type: 'expense',
  transaction_hash: 'fuel-123',
  created_at: '2026-04-20T10:00:00.000Z',
  updated_at: '2026-04-20T10:00:00.000Z',
  category_name: 'Travel',
  category_color: '#ffaa00',
  category_type: 'expense',
  company_name: null,
  account_name: 'Credit Card',
  account_type: 'credit',
  project_name: 'Kitchen Remodel',
  trip_name: null,
};

const expectedMappedTransaction: Transaction = {
  id: 31,
  date: '2026-04-20',
  amount: -25.75,
  description: 'Fuel stop',
  account_id: 3,
  category_id: 4,
  company_id: null,
  project_id: 8,
  trip_id: null,
  type: 'expense',
  transaction_hash: 'fuel-123',
  created_at: '2026-04-20T10:00:00.000Z',
  updated_at: '2026-04-20T10:00:00.000Z',
  category_name: 'Travel',
  category_color: '#ffaa00',
  category_type: 'expense',
  company_name: undefined,
  account_name: 'Credit Card',
  account_type: 'credit',
  project_name: 'Kitchen Remodel',
  trip_name: undefined,
};

const categoryRow: Category = {
  id: 4,
  name: 'Travel',
  color: '#ffaa00',
  type: 'expense',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const companyRow: Company = {
  id: 12,
  name: 'Acme Plumbing',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const accountRow: Account = {
  id: 3,
  name: 'Credit Card',
  type: 'credit',
  owner_user_id: 7,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  owner_display_name: 'Pat Doe',
};

const accountCardRow = {
  id: 22,
  account_id: 3,
  last_four: '4242',
  nickname: 'Daily card',
  user_id: 7,
  created_at: '2026-02-02T00:00:00.000Z',
};

const budgetRow: Budget = {
  id: 6,
  category_id: 4,
  amount: 500,
  period: 'monthly',
  start_date: '2026-04-01',
  end_date: '2026-04-30',
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

const userRow: User = {
  id: 7,
  display_name: 'Pat Doe',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function createWorkerTransportStub(
  overrides: Partial<DatabaseWorkerTransport> = {}
): DatabaseWorkerTransport {
  return {
    initialize: vi.fn(),
    openDatabase: vi.fn(),
    createTables: vi.fn(),
    ensureIndexes: vi.fn(),
    query: vi.fn(),
    exec: vi.fn(),
    exportDatabase: vi.fn(),
    importDatabase: vi.fn(),
    onStatusChange: vi.fn(() => () => undefined),
    ...overrides,
  } as DatabaseWorkerTransport;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DatabaseService transaction helpers', () => {
  it('creates a deterministic hash from transaction fields', () => {
    const hash = DatabaseService.generateTransactionHashFromFields(
      String(baseTransaction.account_id),
      baseTransaction.date,
      baseTransaction.amount,
      baseTransaction.description
    );

    expect(hash).toBe('7e946247');
  });

  it('changes the hash when a variation seed is provided', () => {
    const baseHash = DatabaseService.generateTransactionHashFromFields(
      '7',
      '2026-04-25',
      -42.5,
      'Hardware store purchase'
    );
    const variantHash = DatabaseService.generateTransactionHashFromFields(
      '7',
      '2026-04-25',
      -42.5,
      'Hardware store purchase',
      undefined,
      1
    );

    expect(variantHash).not.toBe(baseHash);
  });
});

describe('DatabaseService.addTransaction', () => {
  it('checks duplicates before inserting and returns the inserted id', async () => {
    const querySpy = vi.fn()
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ id: 42 }]);
    const service = new DatabaseService(
      createWorkerTransportStub({ query: querySpy })
    );

    const insertedId = await service.addTransaction(baseTransaction);
    const expectedHash = DatabaseService.generateTransactionHashFromFields(
      String(baseTransaction.account_id),
      baseTransaction.date,
      baseTransaction.amount,
      baseTransaction.description
    );

    expect(insertedId).toBe('42');
    expect(querySpy).toHaveBeenNthCalledWith(
      1,
      TRANSACTION_QUERIES.CHECK_HASH_EXISTS,
      [expectedHash]
    );
    expect(querySpy).toHaveBeenNthCalledWith(
      2,
      TRANSACTION_QUERIES.CREATE,
      [
        baseTransaction.date,
        baseTransaction.amount,
        baseTransaction.description,
        baseTransaction.account_id,
        null,
        baseTransaction.company_id,
        null,
        null,
        baseTransaction.type,
        expectedHash,
      ]
    );
  });

  it('rejects duplicate transactions before insert', async () => {
    const querySpy = vi.fn().mockResolvedValueOnce([{ count: 1 }]);
    const service = new DatabaseService(
      createWorkerTransportStub({ query: querySpy })
    );

    await expect(service.addTransaction(baseTransaction)).rejects.toThrow(
      'Duplicate transaction detected'
    );
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('propagates worker query failures from the insert step', async () => {
    const querySpy = vi.fn()
      .mockResolvedValueOnce([{ count: 0 }])
      .mockRejectedValueOnce(new Error('Database operation timed out after 10000ms: query'));
    const service = new DatabaseService(
      createWorkerTransportStub({ query: querySpy })
    );

    await expect(service.addTransaction(baseTransaction)).rejects.toThrow(
      'Database operation timed out after 10000ms: query'
    );
  });
});

describe('DatabaseService lifecycle helpers', () => {
  it('tracks whether the database existed before initialization and only initializes once', async () => {
    const worker = createWorkerTransportStub();
    const service = new DatabaseService(worker);
    const databaseExistsSpy = vi
      .spyOn(service, 'databaseAlreadyExists')
      .mockResolvedValue(true);

    await service.initialize();
    await service.initialize();

    expect(service.dbExistsBeforeInit).toBe(true);
    expect(databaseExistsSpy).toHaveBeenCalledTimes(1);
    expect(worker.initialize).toHaveBeenCalledTimes(1);
  });

  it('delegates new database opening to the worker without a second createTables call', async () => {
    const worker = createWorkerTransportStub();
    const service = new DatabaseService(worker);
    vi.spyOn(service, 'initialize').mockResolvedValue(undefined);

    await service.openDatabase('/custom-budget.db', true);

    expect(worker.openDatabase).toHaveBeenCalledWith('/custom-budget.db', true, {});
    expect(worker.createTables).not.toHaveBeenCalled();
  });

  it('skips table creation when opening an existing database', async () => {
    const worker = createWorkerTransportStub();
    const service = new DatabaseService(worker);
    vi.spyOn(service, 'initialize').mockResolvedValue(undefined);

    await service.openDatabase('/custom-budget.db', false);

    expect(worker.openDatabase).toHaveBeenCalledWith('/custom-budget.db', false, {});
    expect(worker.createTables).not.toHaveBeenCalled();
  });

  it('can defer index creation when opening a new database for bulk sample imports', async () => {
    const worker = createWorkerTransportStub();
    const service = new DatabaseService(worker);
    vi.spyOn(service, 'initialize').mockResolvedValue(undefined);

    await service.createNewDatabase({ deferIndexes: true });

    expect(worker.openDatabase).toHaveBeenCalledWith('/budget-app.db', true, {
      deferIndexes: true,
    });
  });

  it('delegates ensureIndexes to the worker transport', async () => {
    const worker = createWorkerTransportStub();
    const service = new DatabaseService(worker);

    await service.ensureIndexes();

    expect(worker.ensureIndexes).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'openExistingDatabase',
      call: (service: DatabaseService) => service.openExistingDatabase(),
      expectedArgs: [undefined, false],
    },
    {
      name: 'createNewDatabase',
      call: (service: DatabaseService) => service.createNewDatabase(),
      expectedArgs: [undefined, true, {}],
    },
    {
      name: 'clearAndRecreateDatabase',
      call: (service: DatabaseService) => service.clearAndRecreateDatabase(),
      expectedArgs: ['/budget-app.db', true],
    },
  ])('delegates %s to openDatabase with the expected arguments', async ({
    call,
    expectedArgs,
  }) => {
    const service = new DatabaseService(createWorkerTransportStub());
    const openDatabaseSpy = vi
      .spyOn(service, 'openDatabase')
      .mockResolvedValue(undefined);

    await call(service);

    expect(openDatabaseSpy).toHaveBeenCalledWith(...expectedArgs);
  });
});

describe('DatabaseService file operations', () => {
  it('passes imported file bytes through to the worker', async () => {
    const importDatabase = vi.fn().mockResolvedValue({ isSuccessful: true });
    const service = new DatabaseService(
      createWorkerTransportStub({ importDatabase })
    );
    const fileBuffer = Uint8Array.from([1, 2, 3, 4]);
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(fileBuffer.buffer),
    } as unknown as File;

    await service.loadDatabaseFromFile(file);

    expect(importDatabase).toHaveBeenCalledWith(fileBuffer);
  });

  it('throws the worker import error when loading a file fails', async () => {
    const importDatabase = vi.fn().mockResolvedValue({
      isSuccessful: false,
      sqlResponse: { error: 'Import payload is invalid' },
    });
    const service = new DatabaseService(
      createWorkerTransportStub({ importDatabase })
    );
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([9, 9]).buffer),
    } as unknown as File;

    await expect(service.loadDatabaseFromFile(file)).rejects.toThrow(
      'Import payload is invalid'
    );
  });

  it('returns the exported bytes from the worker', async () => {
    const exportedBytes = Uint8Array.from([8, 6, 7, 5, 3, 0, 9]);
    const service = new DatabaseService(
      createWorkerTransportStub({ exportDatabase: vi.fn().mockResolvedValue(exportedBytes) })
    );

    await expect(service.exportDatabase()).resolves.toEqual(exportedBytes);
  });
});

describe('DatabaseService batch and import helpers', () => {
  it('reads transactions through the injected worker transport', async () => {
    const worker = createWorkerTransportStub({
      query: vi.fn().mockResolvedValue([transactionRow]),
    });
    const service = new DatabaseService(worker);

    await expect(service.getTransactions()).resolves.toEqual([
      expectedMappedTransaction,
    ]);
    expect(worker.query).toHaveBeenCalledWith(TRANSACTION_QUERIES.GET_ALL);
  });

  it('aggregates success and failure counts for transaction batches', async () => {
    const service = new DatabaseService(createWorkerTransportStub());
    vi.spyOn(service, 'addTransaction')
      .mockResolvedValueOnce('1')
      .mockRejectedValueOnce(new Error('Duplicate transaction detected'))
      .mockResolvedValueOnce('2');

    const result = await service.addTransactionsBatch([
      baseTransaction,
      { ...baseTransaction, description: 'Duplicate row' },
      { ...baseTransaction, description: 'Successful retry' },
    ]);

    expect(result).toEqual({
      success: 2,
      failed: 1,
      errors: ['Duplicate transaction detected'],
    });
  });

  it('inserts temp transactions and returns the inserted row ids', async () => {
    const querySpy = vi
      .spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 101 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 102 }]);
    const service = new DatabaseService();

    const insertedIds = await service.insertIntoTempTable([
      baseTransaction,
      {
        ...baseTransaction,
        description: 'Imported airfare',
        transaction_hash: 'airfare-123',
      },
    ]);

    expect(insertedIds).toEqual([101, 102]);
    expect(querySpy).toHaveBeenNthCalledWith(
      1,
      TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION,
      [
        baseTransaction.date,
        baseTransaction.amount,
        baseTransaction.description,
        baseTransaction.account_id,
        null,
        baseTransaction.company_id,
        null,
        null,
        baseTransaction.type,
        null,
      ]
    );
    expect(querySpy).toHaveBeenNthCalledWith(2, 'SELECT last_insert_rowid() as id');
    expect(querySpy).toHaveBeenNthCalledWith(
      3,
      TRANSACTION_QUERIES.INSERT_TEMP_TRANSACTION,
      [
        baseTransaction.date,
        baseTransaction.amount,
        'Imported airfare',
        baseTransaction.account_id,
        null,
        baseTransaction.company_id,
        null,
        null,
        baseTransaction.type,
        'airfare-123',
      ]
    );
    expect(querySpy).toHaveBeenNthCalledWith(4, 'SELECT last_insert_rowid() as id');
  });

  it('returns the inserted row count after bulk import', async () => {
    vi.spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 3 }]);
    const service = new DatabaseService();

    await expect(service.bulkInsertFromTempTable()).resolves.toBe(3);
  });

  it('skips temp-table deletes when no ids are provided', async () => {
    const querySpy = vi
      .spyOn(databaseWorkerService, 'query')
      .mockResolvedValue([]);
    const service = new DatabaseService();

    await service.deleteFromTempTable([]);

    expect(querySpy).not.toHaveBeenCalled();
  });

  it('formats temp-table delete queries with the provided ids', async () => {
    const querySpy = vi
      .spyOn(databaseWorkerService, 'query')
      .mockResolvedValue([]);
    const service = new DatabaseService();

    await service.deleteFromTempTable([5, 7, 9]);

    expect(querySpy).toHaveBeenCalledWith(
      TRANSACTION_QUERIES.DELETE_TEMP_TRANSACTIONS_BY_IDS.replace(
        '__IDS__',
        '5,7,9'
      )
    );
  });

  it('updates temp transaction hashes one row at a time', async () => {
    const worker = createWorkerTransportStub({ query: vi.fn().mockResolvedValue([]) });
    const service = new DatabaseService(worker);

    await service.updateTempTransactionHashes([
      { tempId: 11, newHash: 'hash-a', variationSeed: 1 },
      { tempId: 12, newHash: 'hash-b', variationSeed: 2 },
    ]);

    expect(worker.query).toHaveBeenNthCalledWith(
      1,
      'UPDATE temp_import_transactions SET transaction_hash = ?, hash_variation_seed = ? WHERE id = ?',
      ['hash-a', 1, 11]
    );
    expect(worker.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE temp_import_transactions SET transaction_hash = ?, hash_variation_seed = ? WHERE id = ?',
      ['hash-b', 2, 12]
    );
  });

  it('returns all stored transaction hashes', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue([
      { transaction_hash: 'hash-a' },
      { transaction_hash: 'hash-b' },
    ]);
    const service = new DatabaseService();

    await expect(service.getAllTransactionHashes()).resolves.toEqual([
      'hash-a',
      'hash-b',
    ]);
    expect(querySpy).toHaveBeenCalledWith(TRANSACTION_QUERIES.GET_ALL_HASHES);
  });

  it('checks duplicate transaction hashes from the temp import table', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue([
      { transaction_hash: 'dup-1' },
      { transaction_hash: 'dup-2' },
    ]);
    const service = new DatabaseService();

    await expect(service.checkDuplicateTransactions()).resolves.toEqual([
      'dup-1',
      'dup-2',
    ]);
    expect(querySpy).toHaveBeenCalledWith(
      TRANSACTION_QUERIES.CHECK_DUPLICATES_IN_TEMP
    );
  });

  it.each([
    {
      name: 'truncateImportTable',
      call: (service: DatabaseService) => service.truncateImportTable(),
    },
    {
      name: 'dropTempImportTable',
      call: (service: DatabaseService) => service.dropTempImportTable(),
    },
  ])('uses the temp-table truncate query for %s', async ({ call }) => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue([]);
    const service = new DatabaseService();

    await call(service);

    expect(querySpy).toHaveBeenCalledWith(
      TRANSACTION_QUERIES.TRUNCATE_IMPORT_TABLE
    );
  });

  it('suppresses cleanup failures when dropping the temp import table', async () => {
    vi.spyOn(databaseWorkerService, 'query').mockRejectedValue(
      new Error('cleanup failed')
    );
    const service = new DatabaseService();

    await expect(service.dropTempImportTable()).resolves.toBeUndefined();
  });
});

describe('DatabaseService singleton-backed query wrappers', () => {
  it.each([
    {
      name: 'maps transaction rows from getTransactions',
      call: (service: DatabaseService) => service.getTransactions(),
      query: TRANSACTION_QUERIES.GET_ALL,
      parameters: undefined,
      response: [transactionRow],
      expected: [expectedMappedTransaction],
    },
    {
      name: 'maps transaction rows from getTransactionsByProject',
      call: (service: DatabaseService) => service.getTransactionsByProject(8),
      query: TRANSACTION_QUERIES.GET_BY_PROJECT,
      parameters: [8],
      response: [transactionRow],
      expected: [expectedMappedTransaction],
    },
    {
      name: 'maps transaction rows from getTransactionsByDateRange without type filtering',
      call: (service: DatabaseService) =>
        service.getTransactionsByDateRange('2026-04-01', '2026-04-30'),
      query: TRANSACTION_QUERIES.GET_BY_DATE_RANGE,
      parameters: ['2026-04-01', '2026-04-30'],
      response: [transactionRow],
      expected: [expectedMappedTransaction],
    },
    {
      name: 'maps category rows',
      call: (service: DatabaseService) => service.getCategories(),
      query: CATEGORY_QUERIES.GET_ALL,
      parameters: undefined,
      response: [categoryRow],
      expected: [categoryRow],
    },
    {
      name: 'maps company rows',
      call: (service: DatabaseService) => service.getCompanies(),
      query: COMPANY_QUERIES.GET_ALL,
      parameters: undefined,
      response: [companyRow],
      expected: [companyRow],
    },
    {
      name: 'maps account rows',
      call: (service: DatabaseService) => service.getAccounts(),
      query: ACCOUNT_QUERIES.GET_ALL,
      parameters: undefined,
      response: [accountRow],
      expected: [accountRow],
    },
    {
      name: 'maps account card rows',
      call: (service: DatabaseService) => service.getAccountCards(3),
      query: ACCOUNT_CARD_QUERIES.GET_BY_ACCOUNT_ID,
      parameters: [3],
      response: [accountCardRow],
      expected: [accountCardRow],
    },
    {
      name: 'maps budget rows',
      call: (service: DatabaseService) => service.getBudgets(),
      query: BUDGET_QUERIES.GET_ALL,
      parameters: undefined,
      response: [budgetRow],
      expected: [budgetRow],
    },
    {
      name: 'maps project rows',
      call: (service: DatabaseService) => service.getProjects(),
      query: PROJECT_QUERIES.GET_ALL,
      parameters: undefined,
      response: [existingProject],
      expected: [existingProject],
    },
    {
      name: 'maps user rows',
      call: (service: DatabaseService) => service.getUsers(),
      query: USER_QUERIES.GET_ALL,
      parameters: undefined,
      response: [userRow],
      expected: [userRow],
    },
    {
      name: 'maps account rows filtered by owner',
      call: (service: DatabaseService) => service.getAccountsByUserId(7),
      query: ACCOUNT_QUERIES.GET_BY_USER_ID,
      parameters: [7],
      response: [accountRow],
      expected: [accountRow],
    },
    {
      name: 'passes custom SQL through unchanged',
      call: (service: DatabaseService) => service.executeCustomQuery('SELECT 42 as answer'),
      query: 'SELECT 42 as answer',
      parameters: undefined,
      response: [{ answer: 42 }],
      expected: [{ answer: 42 }],
    },
    {
      name: 'checks whether a transaction hash exists',
      call: (service: DatabaseService) =>
        service.checkTransactionHashExists('known-hash'),
      query: TRANSACTION_QUERIES.CHECK_HASH_EXISTS,
      parameters: ['known-hash'],
      response: [{ count: 1 }],
      expected: true,
    },
  ])('$name', async ({ call, expected, parameters, query, response }) => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue(response);
    const service = new DatabaseService();

    await expect(call(service)).resolves.toEqual(expected);
    if (parameters === undefined) {
      expect(querySpy).toHaveBeenCalledWith(query);
    } else {
      expect(querySpy).toHaveBeenCalledWith(query, parameters);
    }
  });

  it('uses the type-filtered date range query when a type is provided', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue([
      transactionRow,
    ]);
    const service = new DatabaseService();

    await expect(
      service.getTransactionsByDateRange('2026-04-01', '2026-04-30', 'expense')
    ).resolves.toEqual([expectedMappedTransaction]);
    expect(querySpy).toHaveBeenCalledWith(
      TRANSACTION_QUERIES.GET_BY_DATE_RANGE_AND_TYPE,
      ['2026-04-01', '2026-04-30', 'expense']
    );
  });

  it('returns the matched company row or null when finding by name', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([companyRow])
      .mockResolvedValueOnce([]);
    const service = new DatabaseService();

    await expect(service.findCompanyByName('Acme Plumbing')).resolves.toEqual(
      companyRow
    );
    await expect(service.findCompanyByName('Missing Vendor')).resolves.toBeNull();
    expect(querySpy).toHaveBeenNthCalledWith(
      1,
      COMPANY_QUERIES.FIND_BY_NAME,
      ['Acme Plumbing']
    );
    expect(querySpy).toHaveBeenNthCalledWith(
      2,
      COMPANY_QUERIES.FIND_BY_NAME,
      ['Missing Vendor']
    );
  });

  it('returns the matched project row or null when loading a project by id', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([existingProject])
      .mockResolvedValueOnce([]);
    const service = new DatabaseService();

    await expect(service.getProjectById(existingProject.id)).resolves.toEqual(
      existingProject
    );
    await expect(service.getProjectById(404)).resolves.toBeNull();
    expect(querySpy).toHaveBeenNthCalledWith(
      1,
      PROJECT_QUERIES.GET_BY_ID,
      [existingProject.id]
    );
    expect(querySpy).toHaveBeenNthCalledWith(2, PROJECT_QUERIES.GET_BY_ID, [404]);
  });

  it('maps project cost summaries and falls back to zeroes when no row exists', async () => {
    vi.spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([
        { estimated_cost: 5000, actual_cost: 1250, transactions_total: 830.45 },
      ])
      .mockResolvedValueOnce([]);
    const service = new DatabaseService();

    await expect(service.getProjectCosts(existingProject.id)).resolves.toEqual({
      estimated: 5000,
      actual: 1250,
      transactions_total: 830.45,
    });
    await expect(service.getProjectCosts(999)).resolves.toEqual({
      estimated: 0,
      actual: 0,
      transactions_total: 0,
    });
  });

  it('maps analytics results into chart-friendly structures', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([
        { category_id: 9, category_name: 'Salary', total: 3500, color: '#00ff00' },
      ])
      .mockResolvedValueOnce([
        { category_id: 4, category_name: 'Travel', total: 125.5, color: '#ffaa00' },
      ])
      .mockResolvedValueOnce([
        { month: '2026-03', income: 5000, expense: 1200 },
        { month: '2026-04', income: null, expense: undefined },
      ]);
    const service = new DatabaseService();

    await expect(
      service.getSpendingByCategory('2026-04-01', '2026-04-30')
    ).resolves.toEqual([
      {
        category_id: '9',
        category_name: 'Salary',
        total: 3500,
        color: '#00ff00',
      },
    ]);
    await expect(
      service.getIncomeByCategory('2026-04-01', '2026-04-30')
    ).resolves.toEqual([
      {
        category_id: '4',
        category_name: 'Travel',
        total: 125.5,
        color: '#ffaa00',
      },
    ]);
    await expect(service.getMonthlyTrends(2)).resolves.toEqual([
      { month: '2026-03', income: 5000, expense: 1200 },
      { month: '2026-04', income: 0, expense: 0 },
    ]);
    expect(querySpy).toHaveBeenNthCalledWith(
      1,
      ANALYTICS_QUERIES.SPENDING_BY_CATEGORY,
      ['2026-04-01', '2026-04-30']
    );
    expect(querySpy).toHaveBeenNthCalledWith(
      2,
      ANALYTICS_QUERIES.INCOME_BY_CATEGORY,
      ['2026-04-01', '2026-04-30']
    );
    expect(querySpy).toHaveBeenNthCalledWith(
      3,
      ANALYTICS_QUERIES.MONTHLY_TRENDS,
      [2]
    );
  });
});

describe('DatabaseService singleton-backed mutation wrappers', () => {
  it.each([
    {
      name: 'adds a category with default color and type',
      call: (service: DatabaseService) =>
        service.addCategory({ name: 'Groceries', color: '', type: 'expense' }),
      query: CATEGORY_QUERIES.CREATE,
      parameters: ['Groceries', '#1976d2', 'expense'],
      response: [{ id: 51 }],
      expected: 51,
    },
    {
      name: 'adds a company by name',
      call: (service: DatabaseService) => service.addCompany('Fresh Paint LLC'),
      query: COMPANY_QUERIES.CREATE,
      parameters: ['Fresh Paint LLC'],
      response: [{ id: 52 }],
      expected: 52,
    },
    {
      name: 'adds an account for a user',
      call: (service: DatabaseService) =>
        service.addAccount({ name: 'Joint Checking', type: 'joint' }, 7),
      query: ACCOUNT_QUERIES.CREATE,
      parameters: ['Joint Checking', 'joint', 7],
      response: [{ id: 53 }],
      expected: 53,
    },
    {
      name: 'deletes an account by id',
      call: (service: DatabaseService) => service.deleteAccount(53),
      query: ACCOUNT_QUERIES.DELETE,
      parameters: [53],
      response: [],
      expected: undefined,
    },
    {
      name: 'adds an account card with optional values normalized',
      call: (service: DatabaseService) =>
        service.addAccountCard({
          account_id: 3,
          last_four: '1111',
          nickname: '',
          user_id: null,
        }),
      query: ACCOUNT_CARD_QUERIES.CREATE,
      parameters: [3, '1111', null, null],
      response: [{ id: 54 }],
      expected: 54,
    },
    {
      name: 'updates account card metadata',
      call: (service: DatabaseService) =>
        service.updateAccountCard(54, {
          last_four: '2222',
          nickname: 'Travel card',
          user_id: 7,
        }),
      query: ACCOUNT_CARD_QUERIES.UPDATE,
      parameters: ['2222', 'Travel card', 7, 54],
      response: [],
      expected: undefined,
    },
    {
      name: 'deletes an account card by id',
      call: (service: DatabaseService) => service.deleteAccountCard(54),
      query: ACCOUNT_CARD_QUERIES.DELETE,
      parameters: [54],
      response: [],
      expected: undefined,
    },
    {
      name: 'adds a monthly budget by default',
      call: (service: DatabaseService) =>
        service.addBudget({
          category_id: 4,
          amount: 750,
          period: 'monthly',
          start_date: '2026-04-01',
          end_date: '',
        }),
      query: BUDGET_QUERIES.CREATE,
      parameters: [4, 750, 'monthly', '2026-04-01', null],
      response: [{ id: 55 }],
      expected: 55,
    },
    {
      name: 'adds a project with default nullable fields',
      call: (service: DatabaseService) =>
        service.addProject({
          name: 'Garage Upgrade',
          company_name: 'Acme Builders',
          contact_details: 'sales@acme.example',
          project_category: 'other',
          status: 'planning',
          start_date: null,
          end_date: null,
          estimated_cost: null,
          actual_cost: null,
          notes: null,
        }),
      query: PROJECT_QUERIES.CREATE,
      parameters: [
        'Garage Upgrade',
        'Acme Builders',
        'sales@acme.example',
        'other',
        'planning',
        null,
        null,
        0,
        0,
        null,
      ],
      response: [{ id: 56 }],
      expected: 56,
    },
    {
      name: 'deletes a project by id',
      call: (service: DatabaseService) => service.deleteProject(56),
      query: PROJECT_QUERIES.DELETE,
      parameters: [56],
      response: [],
      expected: undefined,
    },
    {
      name: 'adds a user by display name',
      call: (service: DatabaseService) =>
        service.addUser({ display_name: 'Jordan Smith' }),
      query: USER_QUERIES.CREATE,
      parameters: ['Jordan Smith'],
      response: [{ id: 57 }],
      expected: 57,
    },
    {
      name: 'updates a user display name',
      call: (service: DatabaseService) =>
        service.updateUser(57, { display_name: 'Jordan S.' }),
      query: USER_QUERIES.UPDATE,
      parameters: ['Jordan S.', 57],
      response: [],
      expected: undefined,
    },
    {
      name: 'deletes a user by id',
      call: (service: DatabaseService) => service.deleteUser(57),
      query: USER_QUERIES.DELETE,
      parameters: [57],
      response: [],
      expected: undefined,
    },
  ])('$name', async ({ call, expected, parameters, query, response }) => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue(response);
    const service = new DatabaseService();

    await expect(call(service)).resolves.toEqual(expected);
    if (parameters === undefined) {
      expect(querySpy).toHaveBeenCalledWith(query);
    } else {
      expect(querySpy).toHaveBeenCalledWith(query, parameters);
    }
  });

  it('gets a user by id or returns null when the user is missing', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query')
      .mockResolvedValueOnce([userRow])
      .mockResolvedValueOnce([]);
    const service = new DatabaseService();

    await expect(service.getUserById(7)).resolves.toEqual(userRow);
    await expect(service.getUserById(404)).resolves.toBeNull();
    expect(querySpy).toHaveBeenNthCalledWith(1, USER_QUERIES.GET_BY_ID, [7]);
    expect(querySpy).toHaveBeenNthCalledWith(2, USER_QUERIES.GET_BY_ID, [404]);
  });

  it('finds accounts by card last four digits', async () => {
    const querySpy = vi.spyOn(databaseWorkerService, 'query').mockResolvedValue([
      accountRow,
    ]);
    const service = new DatabaseService();

    await expect(service.findAccountsByLastFour('4242')).resolves.toEqual([
      accountRow,
    ]);
    expect(querySpy).toHaveBeenCalledWith(
      ACCOUNT_CARD_QUERIES.FIND_ACCOUNT_BY_LAST_FOUR,
      ['4242']
    );
  });
});

describe('DatabaseService company and project helpers', () => {
  it('reuses an existing company id before creating a new company', async () => {
    const service = new DatabaseService();
    vi.spyOn(service, 'findCompanyByName').mockResolvedValue({
      id: 44,
      name: 'Acme Plumbing',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const addCompanySpy = vi.spyOn(service, 'addCompany');

    await expect(service.findOrCreateCompany('Acme Plumbing')).resolves.toBe(44);
    expect(addCompanySpy).not.toHaveBeenCalled();
  });

  it('creates a company when no existing company matches the name', async () => {
    const service = new DatabaseService();
    vi.spyOn(service, 'findCompanyByName').mockResolvedValue(null);
    const addCompanySpy = vi.spyOn(service, 'addCompany').mockResolvedValue(55);

    await expect(service.findOrCreateCompany('Fresh Paint LLC')).resolves.toBe(55);
    expect(addCompanySpy).toHaveBeenCalledWith('Fresh Paint LLC');
  });

  it('merges project updates with existing values before writing them', async () => {
    const querySpy = vi
      .spyOn(databaseWorkerService, 'query')
      .mockResolvedValue([]);
    const service = new DatabaseService();
    vi.spyOn(service, 'getProjectById').mockResolvedValue(existingProject);

    await service.updateProject(existingProject.id, {
      status: 'in_progress',
      actual_cost: 1500,
    });

    expect(querySpy).toHaveBeenCalledWith(PROJECT_QUERIES.UPDATE, [
      existingProject.name,
      existingProject.company_name,
      existingProject.contact_details,
      existingProject.project_category,
      'in_progress',
      existingProject.start_date,
      existingProject.end_date,
      existingProject.estimated_cost,
      1500,
      existingProject.notes,
      existingProject.id,
    ]);
  });

  it('rejects project updates when the project does not exist', async () => {
    const querySpy = vi
      .spyOn(databaseWorkerService, 'query')
      .mockResolvedValue([]);
    const service = new DatabaseService();
    vi.spyOn(service, 'getProjectById').mockResolvedValue(null);

    await expect(
      service.updateProject(404, { status: 'completed' })
    ).rejects.toThrow('Project not found');
    expect(querySpy).not.toHaveBeenCalled();
  });
});

describe('DatabaseService trip helpers', () => {
  it('returns trips and trip-linked transactions using the injected worker transport', async () => {
    const worker = createWorkerTransportStub({
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            ...existingTrip,
            estimated_cost: '1400.25',
            actual_cost: '250.75',
          },
        ])
        .mockResolvedValueOnce([transactionRow]),
    });
    const service = new DatabaseService(worker);

    await expect(service.getTrips()).resolves.toEqual([
      {
        ...existingTrip,
        estimated_cost: 1400.25,
        actual_cost: 250.75,
      },
    ]);
    await expect(service.getTransactionsByTrip(existingTrip.id)).resolves.toEqual([
      expectedMappedTransaction,
    ]);
    expect(worker.query).toHaveBeenNthCalledWith(1, TRIP_QUERIES.GET_ALL);
    expect(worker.query).toHaveBeenNthCalledWith(
      2,
      TRANSACTION_QUERIES.GET_BY_TRIP,
      [existingTrip.id]
    );
  });

  it('adds, fetches, and deletes trips through the injected worker transport', async () => {
    const worker = createWorkerTransportStub({
      query: vi
        .fn()
        .mockResolvedValueOnce([{ id: existingTrip.id }])
        .mockResolvedValueOnce([
          {
            ...existingTrip,
            estimated_cost: '1400.25',
            actual_cost: '250.75',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    });
    const service = new DatabaseService(worker);

    await expect(
      service.addTrip({
        name: existingTrip.name,
        destination: existingTrip.destination,
        purpose: existingTrip.purpose,
        trip_category: existingTrip.trip_category,
        status: existingTrip.status,
        start_date: existingTrip.start_date,
        end_date: existingTrip.end_date,
        estimated_cost: existingTrip.estimated_cost,
        actual_cost: existingTrip.actual_cost,
        notes: existingTrip.notes,
      })
    ).resolves.toBe(existingTrip.id);
    await expect(service.getTripById(existingTrip.id)).resolves.toEqual({
      ...existingTrip,
      estimated_cost: 1400.25,
      actual_cost: 250.75,
    });
    await expect(service.getTripById(404)).resolves.toBeNull();
    await expect(service.deleteTrip(existingTrip.id)).resolves.toBeUndefined();

    expect(worker.query).toHaveBeenNthCalledWith(1, TRIP_QUERIES.CREATE, [
      existingTrip.name,
      existingTrip.destination,
      existingTrip.purpose,
      existingTrip.trip_category,
      existingTrip.status,
      existingTrip.start_date,
      existingTrip.end_date,
      existingTrip.estimated_cost,
      existingTrip.actual_cost,
      existingTrip.notes,
    ]);
    expect(worker.query).toHaveBeenNthCalledWith(2, TRIP_QUERIES.GET_BY_ID, [
      existingTrip.id,
    ]);
    expect(worker.query).toHaveBeenNthCalledWith(3, TRIP_QUERIES.GET_BY_ID, [404]);
    expect(worker.query).toHaveBeenNthCalledWith(4, TRIP_QUERIES.DELETE, [
      existingTrip.id,
    ]);
  });

  it('merges trip updates with existing values before writing them', async () => {
    const worker = createWorkerTransportStub({ query: vi.fn().mockResolvedValue([]) });
    const service = new DatabaseService(worker);
    vi.spyOn(service, 'getTripById').mockResolvedValue(existingTrip);

    await service.updateTrip(existingTrip.id, {
      status: 'completed',
      actual_cost: 900.5,
    });

    expect(worker.query).toHaveBeenCalledWith(TRIP_QUERIES.UPDATE, [
      existingTrip.name,
      existingTrip.destination,
      existingTrip.purpose,
      existingTrip.trip_category,
      'completed',
      existingTrip.start_date,
      existingTrip.end_date,
      existingTrip.estimated_cost,
      900.5,
      existingTrip.notes,
      existingTrip.id,
    ]);
  });

  it('rejects trip updates when the trip does not exist', async () => {
    const worker = createWorkerTransportStub({ query: vi.fn().mockResolvedValue([]) });
    const service = new DatabaseService(worker);
    vi.spyOn(service, 'getTripById').mockResolvedValue(null);

    await expect(
      service.updateTrip(404, { status: 'completed' })
    ).rejects.toThrow('Trip not found');
    expect(worker.query).not.toHaveBeenCalled();
  });

  it('coerces trip costs to numbers and falls back to zeroes', async () => {
    const worker = createWorkerTransportStub({
      query: vi
        .fn()
        .mockResolvedValueOnce([
          { estimated: '1200.50', actual: null, transactions_total: '87.25' },
        ])
        .mockResolvedValueOnce([]),
    });
    const service = new DatabaseService(worker);

    await expect(service.getTripCosts(existingTrip.id)).resolves.toEqual({
      estimated: 1200.5,
      actual: 0,
      transactions_total: 87.25,
    });
    await expect(service.getTripCosts(999)).resolves.toEqual({
      estimated: 0,
      actual: 0,
      transactions_total: 0,
    });
  });

  it('updates transaction labels through the worker transport', async () => {
    const worker = createWorkerTransportStub({ query: vi.fn().mockResolvedValue([]) });
    const service = new DatabaseService(worker);

    await service.updateTransactionLabels(77, 5, 9);

    expect(worker.query).toHaveBeenCalledWith(
      TRANSACTION_QUERIES.UPDATE_PROJECT_TRIP,
      [5, 9, 77]
    );
  });
});