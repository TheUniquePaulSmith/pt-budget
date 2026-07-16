import { afterEach, describe, expect, it, vi } from 'vitest';

import { databaseWorkerService } from './databaseWorkerService';
import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import {
  buildDatabaseStatusFile,
  createDatabaseArchive,
  parseDatabaseArchive,
} from './databaseArchive';
import { encryptArchive } from './databaseEncryption';
import {
  ACCOUNT_CARD_QUERIES,
  ACCOUNT_QUERIES,
  ANALYTICS_QUERIES,
  BUDGET_PLAN_QUERIES,
  CATEGORY_QUERIES,
  COMPANY_QUERIES,
  INCOME_SOURCE_QUERIES,
  PROJECT_QUERIES,
  TRANSACTION_QUERIES,
  TRIP_QUERIES,
  USER_QUERIES,
} from './sqlQueries';
import type {
  Account,
  AccountCard,
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
  card_id: null,
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
  comment: null,
  account_id: 3,
  card_id: null,
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
  card_last_four: undefined,
  card_nickname: null,
  effective_user_id: null,
  effective_user_name: undefined,
  account_owner_name: undefined,
  series_id: null,
  series_name: undefined,
  service_name: undefined,
  project_name: 'Kitchen Remodel',
  trip_name: null,
};

const expectedMappedTransaction: Transaction = {
  id: 31,
  date: '2026-04-20',
  amount: -25.75,
  description: 'Fuel stop',
  comment: null,
  account_id: 3,
  card_id: null,
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
  card_last_four: undefined,
  card_nickname: null,
  effective_user_id: null,
  effective_user_name: undefined,
  account_owner_name: undefined,
  series_id: null,
  series_name: undefined,
  service_name: undefined,
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

const userRow: User = {
  id: 7,
  display_name: 'Pat Doe',
  is_primary: 0,
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
    exportDatabaseSnapshot: vi.fn(),
    importDatabaseSnapshot: vi.fn(),
    setEncryptionPassword: vi.fn().mockResolvedValue(undefined),
    clearEncryptionPassword: vi.fn().mockResolvedValue(undefined),
    isEncryptionReady: vi.fn().mockResolvedValue(true),
    encryptArchive: vi.fn().mockResolvedValue(new Uint8Array([0xaa, 0xbb])),
    decryptArchive: vi.fn().mockResolvedValue(new Uint8Array()),
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
        null,
        baseTransaction.account_id,
        null,
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
  
    it('updates a transaction comment without changing the imported description', async () => {
      const querySpy = vi.fn().mockResolvedValue([]);
      const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));
  
      await service.setTransactionComment(31, '  Needs receipt follow-up  ');
  
      expect(querySpy).toHaveBeenCalledWith(TRANSACTION_QUERIES.SET_COMMENT, ['Needs receipt follow-up', 31]);
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
  /**
   * Builds a plain inner ZIP archive that can stand-in for the decrypted
   * payload returned by `workerService.decryptArchive` in mocked tests.
   */
  async function buildInnerArchive(data: number[] = [1, 2, 3, 4]) {
    const snapshot = {
      format: 'wa-sqlite-idb-batch-atomic-v1' as const,
      idbName: 'ptbudgetapp',
      exportedAt: '2026-05-27T12:00:00.000Z',
      metadata: [{ name: '/budget-app.db', fileSize: data.length, version: 1 }],
      blocks: [
        {
          path: '/budget-app.db',
          offset: 0,
          version: 1,
          data: Uint8Array.from(data),
        },
      ],
    };
    return createDatabaseArchive({
      snapshot,
      status: buildDatabaseStatusFile({
        exportedAt: snapshot.exportedAt,
        lastWriteTimestamp: snapshot.exportedAt,
        tableStats: { accounts: 1 },
        snapshot,
      }),
    });
  }

  /**
   * Builds a real encrypted envelope around `innerBytes` so that
   * `isEncryptedArchive` returns `true` for the result.
   */
  async function buildEncryptedEnvelope(innerBytes: Uint8Array) {
    return encryptArchive(innerBytes, 'test-password', '2026-05-27T12:00:00.000Z');
  }

  it('decrypts and passes the archive snapshot through to the worker', async () => {
    const innerBytes = await buildInnerArchive();
    const encryptedBytes = await buildEncryptedEnvelope(innerBytes);

    const importDatabaseSnapshot = vi.fn().mockResolvedValue({
      isSuccessful: true,
    });
    const decryptArchive = vi.fn().mockResolvedValue(innerBytes);
    const service = new DatabaseService(
      createWorkerTransportStub({ importDatabaseSnapshot, decryptArchive })
    );
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(encryptedBytes.buffer),
    } as unknown as File;

    await service.loadDatabaseFromFile(file);

    expect(decryptArchive).toHaveBeenCalled();
    expect(importDatabaseSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'wa-sqlite-idb-batch-atomic-v1',
        idbName: 'ptbudgetapp',
      })
    );
  });

  it('throws when loading a plain (unencrypted) archive file', async () => {
    const innerBytes = await buildInnerArchive([9, 9]);
    const service = new DatabaseService(createWorkerTransportStub());
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(innerBytes.buffer),
    } as unknown as File;

    await expect(service.loadDatabaseFromFile(file)).rejects.toThrow(
      'Unencrypted archives are no longer supported'
    );
  });

  it('throws the worker import error when loading a file fails', async () => {
    const innerBytes = await buildInnerArchive([9, 9]);
    const encryptedBytes = await buildEncryptedEnvelope(innerBytes);

    const importDatabaseSnapshot = vi.fn().mockResolvedValue({
      isSuccessful: false,
      sqlResponse: { error: 'Import payload is invalid' },
    });
    const decryptArchive = vi.fn().mockResolvedValue(innerBytes);
    const service = new DatabaseService(
      createWorkerTransportStub({ importDatabaseSnapshot, decryptArchive })
    );
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(encryptedBytes.buffer),
    } as unknown as File;

    await expect(service.loadDatabaseFromFile(file)).rejects.toThrow(
      'Import payload is invalid'
    );
  });

  it('exports an encrypted archive whose inner ZIP contains the snapshot and dbstatus', async () => {
    // Capture the inner archive bytes that encryptArchive receives.
    let capturedInnerBytes: Uint8Array | null = null;
    const encryptArchiveMock = vi
      .fn()
      .mockImplementation(async (innerBytes: Uint8Array) => {
        capturedInnerBytes = innerBytes;
        return new Uint8Array([0xfe, 0xed]);
      });

    const service = new DatabaseService(
      createWorkerTransportStub({
        query: vi
          .fn()
          .mockResolvedValueOnce([{ name: 'accounts' }, { name: 'transactions' }])
          .mockResolvedValueOnce([{ count: 2 }])
          .mockResolvedValueOnce([{ count: 7 }]),
        exportDatabaseSnapshot: vi.fn().mockResolvedValue({
          format: 'wa-sqlite-idb-batch-atomic-v1',
          idbName: 'ptbudgetapp',
          exportedAt: '2026-05-27T12:00:00.000Z',
          metadata: [{ name: '/budget-app.db', fileSize: 12, version: 2 }],
          blocks: [
            {
              path: '/budget-app.db',
              offset: 0,
              version: 2,
              data: Uint8Array.from([8, 6, 7, 5, 3, 0, 9]),
            },
          ],
        }),
        encryptArchive: encryptArchiveMock,
      })
    );

    const result = await service.exportDatabase();

    expect(result).toBeInstanceOf(Uint8Array);
    expect(encryptArchiveMock).toHaveBeenCalled();

    // The inner archive (captured before encryption) must be a valid plain ZIP.
    expect(capturedInnerBytes).not.toBeNull();
    const parsed = await parseDatabaseArchive(capturedInnerBytes!);
    expect(parsed.status.tableStats).toEqual({ accounts: 2, transactions: 7 });
    expect(parsed.status.lastWriteTimestamp).toBeTruthy();
  });

  it('invokes onStage with exporting then encrypting, around the corresponding steps', async () => {
    const events: string[] = [];
    const exportDatabaseSnapshot = vi.fn().mockImplementation(async () => {
      events.push('exportDatabaseSnapshot:called');
      return {
        format: 'wa-sqlite-idb-batch-atomic-v1',
        idbName: 'ptbudgetapp',
        exportedAt: '2026-05-27T12:00:00.000Z',
        metadata: [{ name: '/budget-app.db', fileSize: 12, version: 2 }],
        blocks: [],
      };
    });
    const encryptArchive = vi.fn().mockImplementation(async () => {
      events.push('encryptArchive:called');
      return new Uint8Array([0xfe, 0xed]);
    });

    const service = new DatabaseService(
      createWorkerTransportStub({
        query: vi
          .fn()
          .mockResolvedValueOnce([{ name: 'accounts' }, { name: 'transactions' }])
          .mockResolvedValueOnce([{ count: 2 }])
          .mockResolvedValueOnce([{ count: 7 }]),
        exportDatabaseSnapshot,
        encryptArchive,
      })
    );

    const onStage = vi.fn((stage: string) => {
      events.push(`onStage:${stage}`);
    });

    await service.exportDatabase({ onStage });

    expect(onStage).toHaveBeenNthCalledWith(1, 'exporting');
    expect(onStage).toHaveBeenNthCalledWith(2, 'encrypting');
    expect(events).toEqual([
      'onStage:exporting',
      'exportDatabaseSnapshot:called',
      'onStage:encrypting',
      'encryptArchive:called',
    ]);
  });

  it('exports successfully when no onStage callback is provided', async () => {
    const service = new DatabaseService(
      createWorkerTransportStub({
        query: vi
          .fn()
          .mockResolvedValueOnce([{ name: 'accounts' }, { name: 'transactions' }])
          .mockResolvedValueOnce([{ count: 2 }])
          .mockResolvedValueOnce([{ count: 7 }]),
        exportDatabaseSnapshot: vi.fn().mockResolvedValue({
          format: 'wa-sqlite-idb-batch-atomic-v1',
          idbName: 'ptbudgetapp',
          exportedAt: '2026-05-27T12:00:00.000Z',
          metadata: [],
          blocks: [],
        }),
      })
    );

    await expect(service.exportDatabase()).resolves.toBeInstanceOf(Uint8Array);
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
        null,
        baseTransaction.account_id,
        null,
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
        null,
        baseTransaction.account_id,
        null,
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
      parameters: ['Jordan Smith', 0],
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

describe('DatabaseService budget income calculations', () => {
  it('adds multiple expected income sources and excludes credit-card payments from linked actual income', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      switch (sql) {
        case BUDGET_PLAN_QUERIES.GET_ALL_PLANS:
          return [{ id: 1, effective_month: '2026-07', total_amount: 2000, notes: null, created_at: 'now', updated_at: 'now' }];
        case BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES:
          return [{ id: 1, plan_id: 1, category_id: 2, amount: 500, created_at: 'now', updated_at: 'now', category_name: 'Groceries', category_color: '#43A047' }];
        case BUDGET_PLAN_QUERIES.ACTUAL_EXPENSES_BY_MONTH_CATEGORY:
          return [];
        case BUDGET_PLAN_QUERIES.ACTUAL_INCOME_LINKED_BY_MONTH:
          expect(sql).toContain("a.type != 'credit'");
          return [{ month: '2026-07', total: 3200 }];
        case INCOME_SOURCE_QUERIES.GET_ALL:
          return [
            { id: 1, name: 'Salary', kind: 'recurring_salary', account_id: null, amount: 3000, frequency: 'monthly', start_date: null, end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
            { id: 2, name: 'Side account', kind: 'linked_account', account_id: 4, amount: 600, frequency: 'monthly', start_date: null, end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: 'Checking' },
          ];
        default:
          throw new Error(`Unexpected SQL: ${sql}`);
      }
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const status = await service.getBudgetStatus({ type: 'month', key: '2026-07' });

    expect(status.expectedIncome).toBe(3600);
    expect(status.actualLinkedIncome).toBe(3200);
  });

  it('counts income sources that started before the selected year across all year months', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      switch (sql) {
        case BUDGET_PLAN_QUERIES.GET_ALL_PLANS:
        case BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES:
        case BUDGET_PLAN_QUERIES.ACTUAL_EXPENSES_BY_MONTH_CATEGORY:
        case BUDGET_PLAN_QUERIES.ACTUAL_INCOME_LINKED_BY_MONTH:
          return [];
        case INCOME_SOURCE_QUERIES.GET_ALL:
          return [
            { id: 1, name: 'Company draw', kind: 'recurring_salary', account_id: null, amount: 5000, frequency: 'monthly', start_date: '2023-03-01', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
          ];
        default:
          throw new Error(`Unexpected SQL: ${sql}`);
      }
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const status = await service.getBudgetStatus({ type: 'year', key: '2026' });

    expect(status.months).toHaveLength(12);
    expect(status.expectedIncome).toBe(60000);
  });
});

describe('DatabaseService dashboard income summaries', () => {
  it('uses configured income-source totals when actual non-credit income is lower', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) as transaction_count')) {
        expect(sql).toContain("a.type != 'credit'");
        return [{ transaction_count: 0, total_income: 0, total_expenses: 1250 }];
      }
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          { id: 1, name: 'Owner draw', kind: 'recurring_salary', account_id: null, amount: 5000, frequency: 'monthly', start_date: '2023-03-01', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
          { id: 2, name: 'Consulting', kind: 'linked_account', account_id: 4, amount: 2000, frequency: 'monthly', start_date: '2023-03-01', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: 'Checking' },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const summary = await service.getDashboardSummary('2026-01-01', '2026-12-31');

    expect(summary.totalIncome).toBe(84000);
    expect(summary.totalExpenses).toBe(1250);
    expect(summary.netIncome).toBe(82750);
  });

  it('only includes configured income in a week when the recurrence date falls inside that week', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) as transaction_count')) {
        return [{ transaction_count: 0, total_income: 0, total_expenses: 0 }];
      }
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          { id: 1, name: 'Owner draw', kind: 'recurring_salary', account_id: null, amount: 5000, frequency: 'monthly', start_date: '2023-03-15', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    await expect(service.getDashboardSummary('2026-07-01', '2026-07-07')).resolves.toMatchObject({
      totalIncome: 0,
      netIncome: 0,
    });
    await expect(service.getDashboardSummary('2026-07-12', '2026-07-18')).resolves.toMatchObject({
      totalIncome: 5000,
      netIncome: 5000,
    });
  });

  it('counts weekly configured income occurrences inside a week span', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) as transaction_count')) {
        return [{ transaction_count: 0, total_income: 0, total_expenses: 0 }];
      }
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          { id: 1, name: 'Weekly draw', kind: 'recurring_salary', account_id: null, amount: 1200, frequency: 'weekly', start_date: '2023-03-03', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const summary = await service.getDashboardSummary('2026-07-05', '2026-07-12');

    expect(summary.totalIncome).toBe(1200);
    expect(summary.netIncome).toBe(1200);
  });

  it('keeps actual income when it is higher than configured income-source totals', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) as transaction_count')) {
        return [{ transaction_count: 3, total_income: 9000, total_expenses: 1000 }];
      }
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          { id: 1, name: 'Owner draw', kind: 'recurring_salary', account_id: null, amount: 5000, frequency: 'monthly', start_date: '2026-01-01', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const summary = await service.getDashboardSummary('2026-01-01', '2026-01-31');

    expect(summary.totalIncome).toBe(9000);
    expect(summary.netIncome).toBe(8000);
  });

  it('uses income sources for chart source, trend, and account-analysis income', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SUM(ABS(t.amount)) as total') && sql.includes("c.type = 'expense'")) {
        return [];
      }
      if (sql.includes('COALESCE(comp.name') && sql.includes('mr.service_name')) {
        expect(sql).toContain('tsl.transaction_id = t.id');
        expect(sql).not.toContain('rs.company_id = comp.id');
        return [
          { company_id: 12, company_name: 'StreamHouse', service_name: 'Streaming', total: 49.99 },
        ];
      }
      if (sql.includes('rs.id as series_id') && sql.includes('transaction_series_links')) {
        return [
          { series_id: 3, series_name: 'StreamHouse', kind: 'subscription', total: 49.99 },
        ];
      }
      if (sql.includes('SUM(t.amount) as total') && sql.includes("a.type != 'credit'")) {
        return [];
      }
      if (sql.includes("strftime('%Y-%m', t.date) as month") && sql.includes('as expense')) {
        return [
          { month: '2026-07', income: 0, expense: 2500 },
        ];
      }
      if (sql.includes('a.id as account_id') && sql.includes('as expenses')) {
        expect(sql).toContain("t.type = 'income' AND a.type != 'credit'");
        return [
          { account_id: 7, account_name: 'Credit Card', user_display_name: 'Pat', income: 0, expenses: 1250 },
        ];
      }
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          { id: 1, name: 'Owner draw', kind: 'recurring_salary', account_id: null, amount: 5000, frequency: 'monthly', start_date: '2023-03-15', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null, owner_display_name: null },
          { id: 2, name: 'Consulting deposits', kind: 'linked_account', account_id: 4, amount: 1000, frequency: 'monthly', start_date: '2023-03-10', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: 'Checking', owner_display_name: 'Pat' },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const chartData = await service.getChartData('2026-07-01', '2026-07-31');

    expect(chartData.spendingByCompany).toEqual([
      expect.objectContaining({ id: '12-Streaming', label: 'StreamHouse - Streaming', value: 49.99 }),
    ]);
    expect(chartData.spendingByRecurring).toEqual([
      expect.objectContaining({ id: 3, label: 'StreamHouse (Subscription)', value: 49.99 }),
    ]);
    expect(chartData.incomeBySource).toEqual([
      expect.objectContaining({ id: 'income-source-1', label: 'Owner draw', value: 5000, color: '#2e7d32' }),
      expect.objectContaining({ id: 'income-source-2', label: 'Checking - Consulting deposits', value: 1000, color: '#ed6c02' }),
    ]);
    expect(chartData.trends.months).toContain('2026-07');
    expect(chartData.trends.income[chartData.trends.months.indexOf('2026-07')]).toBe(6000);
    expect(chartData.accountAnalysis).toEqual({
      accountNames: ['Owner draw', 'Pat'],
      income: [5000, 1000],
      expenses: [0, 1250],
    });
  });
});

describe('DatabaseService transaction report aggregates', () => {
  it('uses configured income-source totals for paginated report income when date filters are present', async () => {
    const querySpy = vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('COUNT(*) as total')) {
        return [{ total: 0, total_income: 0, total_expenses: 200 }];
      }
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          { id: 1, name: 'Owner draw', kind: 'recurring_salary', account_id: null, amount: 5000, frequency: 'monthly', start_date: '2023-03-15', end_date: null, is_active: 1, notes: null, created_at: 'now', updated_at: 'now', account_name: null },
        ];
      }
      if (sql.includes('SELECT') && sql.includes('FROM transactions t')) {
        expect(params).toEqual(['2026-07-01', '2026-07-31', 25, 0]);
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new DatabaseService(createWorkerTransportStub({ query: querySpy }));

    const result = await service.getTransactionsPaginated({
      page: 0,
      pageSize: 25,
      sortBy: 'date',
      sortOrder: 'desc',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(result).toEqual({ data: [], total: 0, totalIncome: 5000, totalExpenses: 200 });
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

  it('applies transaction classifications inside a database transaction', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 77,
          type: 'expense',
          category_id: null,
          company_id: null,
          project_id: null,
          trip_id: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 3, name: 'Utilities', color: '#ff9800', type: 'expense' }])
      .mockResolvedValueOnce([{ id: 4, name: 'Power Co' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const worker = createWorkerTransportStub({ query });
    const service = new DatabaseService(worker);

    await expect(
      service.applyTransactionClassifications([
        {
          transactionId: 77,
          categoryName: 'Utilities',
          categoryType: 'expense',
          companyName: 'Power Co',
        },
      ])
    ).resolves.toEqual({ appliedCount: 1, transactionIds: [77] });

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(query).toHaveBeenNthCalledWith(
      5,
      TRANSACTION_QUERIES.UPDATE_CLASSIFICATION,
      [3, 4, null, null, 77]
    );
    expect(query).toHaveBeenNthCalledWith(6, 'COMMIT');
  });

  it('rolls back transaction classifications when a referenced transaction is missing', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const worker = createWorkerTransportStub({ query });
    const service = new DatabaseService(worker);

    await expect(
      service.applyTransactionClassifications([{ transactionId: 404, categoryName: 'Utilities' }])
    ).rejects.toThrow('Transaction 404 was not found');

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});