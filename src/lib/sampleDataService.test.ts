// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { batchQueryMock, queryMock } = vi.hoisted(() => ({
  batchQueryMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock('./databaseWorkerService', () => ({
  databaseWorkerService: {
    batchQuery: batchQueryMock,
    query: queryMock,
  },
}));

import { SAMPLE_DATA_QUERIES } from './sqlQueries';
import { SampleDataService } from './sampleDataService';

function createStreamResponse(bodyText: string, json = vi.fn()) {
  const encoder = new TextEncoder();
  const splitIndex = Math.max(1, Math.floor(bodyText.length / 2));

  return {
    ok: true,
    statusText: 'OK',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(bodyText.slice(0, splitIndex)));
        controller.enqueue(encoder.encode(bodyText.slice(splitIndex)));
        controller.close();
      },
    }),
    json,
  } as unknown as Response;
}

function createJsonOnlyResponse(payload: unknown, json = vi.fn().mockResolvedValue(payload)) {
  return {
    ok: true,
    statusText: 'OK',
    body: null,
    json,
  } as unknown as Response;
}

function createMissingResponse() {
  return {
    ok: false,
    statusText: 'Not Found',
    body: null,
    json: vi.fn(),
  } as unknown as Response;
}

function createUserRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    display_name: `Generated User ${index + 1}`,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  }));
}

describe('SampleDataService', () => {
  beforeEach(() => {
    batchQueryMock.mockReset();
    queryMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams transaction fixtures and batches inserts without calling response.json', async () => {
    const transactionRows = [
      {
        id: 1,
        date: '2026-04-01',
        amount: 100,
        description: 'Avery payroll deposit',
        account_id: 1,
        category_id: 13,
        company_id: 1,
        project_id: null,
        trip_id: null,
        type: 'income',
        transaction_hash: '1-2026-04-01-100-Avery payroll deposit',
        hash_variation_seed: 0,
        created_at: '2026-04-01T08:15:00.000Z',
        updated_at: '2026-04-01T08:15:00.000Z',
      },
      {
        id: 2,
        date: '2026-04-02',
        amount: -50,
        description: 'Weekly groceries and household staples',
        account_id: 4,
        category_id: 2,
        company_id: 4,
        project_id: null,
        trip_id: null,
        type: 'expense',
        transaction_hash: '4-2026-04-02--50-Weekly groceries and household staples',
        hash_variation_seed: 0,
        created_at: '2026-04-02T17:45:00.000Z',
        updated_at: '2026-04-02T17:45:00.000Z',
      },
    ];
    const jsonSpy = vi.fn();
    const transactionResponse = createStreamResponse(
      JSON.stringify({
        table: 'transactions',
        meta: { actualTransactionCount: transactionRows.length },
        data: transactionRows,
      }),
      jsonSpy
    );

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.endsWith('/sample-data/transactions.json')) {
          return Promise.resolve(transactionResponse);
        }

        return Promise.resolve(createMissingResponse());
      })
    );

    batchQueryMock.mockResolvedValue(transactionRows.length);
    queryMock.mockResolvedValue([]);

    const progressStages: string[] = [];

    await SampleDataService.loadAllSampleData({
      onProgress: (progress) => {
        progressStages.push(progress.stage);
      },
    });

    expect(jsonSpy).not.toHaveBeenCalled();
    expect(progressStages).toEqual(
      expect.arrayContaining([
        'starting',
        'fetching-file',
        'importing-table',
        'table-progress',
        'table-complete',
        'complete',
      ])
    );
    expect(batchQueryMock).toHaveBeenCalledTimes(1);
    expect(batchQueryMock).toHaveBeenCalledWith(
      SAMPLE_DATA_QUERIES.INSERT_TRANSACTION,
      transactionRows.map((row) => [
        row.id,
        row.date,
        row.amount,
        row.description,
        row.account_id,
        row.category_id,
        row.company_id,
        row.project_id,
        row.trip_id,
        row.type,
        row.transaction_hash,
        row.hash_variation_seed,
        row.created_at,
        row.updated_at,
      ]),
      { useTransaction: true }
    );
    expect(queryMock).toHaveBeenCalledWith(SAMPLE_DATA_QUERIES.RESET_SEQUENCE, [2, 'transactions']);
  });

  it('falls back to response.json when a readable stream is unavailable', async () => {
    const usersPayload = {
      table: 'users',
      data: [
        {
          id: 1,
          display_name: 'Avery Parker',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    };
    const jsonSpy = vi.fn().mockResolvedValue(usersPayload);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createJsonOnlyResponse(usersPayload, jsonSpy))
    );

    batchQueryMock.mockResolvedValue(1);
    queryMock.mockResolvedValue([]);

    await (SampleDataService as any).loadSampleDataFile('users.json', {
      completedFiles: 0,
      totalFiles: 1,
      currentFile: 'users.json',
    });

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(batchQueryMock).toHaveBeenCalledWith(
      SAMPLE_DATA_QUERIES.INSERT_USER,
      [[1, 'Avery Parker', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z']],
      { useTransaction: true }
    );
    expect(queryMock).toHaveBeenCalledWith(SAMPLE_DATA_QUERIES.RESET_SEQUENCE, [1, 'users']);
  });

  it('loads chunked transaction manifests by reading each referenced part file', async () => {
    const transactionManifest = {
      table: 'transactions',
      format: 'chunked',
      meta: { actualTransactionCount: 2 },
      dataFiles: [
        { file: 'transactions.part-000001.json', rowCount: 1 },
        { file: 'transactions.part-000002.json', rowCount: 1 },
      ],
    };
    const transactionChunkOne = {
      table: 'transactions',
      data: [
        {
          id: 1,
          date: '2026-04-01',
          amount: 100,
          description: 'Chunked payroll deposit',
          account_id: 1,
          category_id: 13,
          company_id: 1,
          project_id: null,
          trip_id: null,
          type: 'income',
          transaction_hash: '1-2026-04-01-100-Chunked payroll deposit',
          hash_variation_seed: 0,
          created_at: '2026-04-01T08:15:00.000Z',
          updated_at: '2026-04-01T08:15:00.000Z',
        },
      ],
    };
    const transactionChunkTwo = {
      table: 'transactions',
      data: [
        {
          id: 2,
          date: '2026-04-02',
          amount: -50,
          description: 'Chunked grocery run',
          account_id: 4,
          category_id: 2,
          company_id: 4,
          project_id: null,
          trip_id: null,
          type: 'expense',
          transaction_hash: '4-2026-04-02--50-Chunked grocery run',
          hash_variation_seed: 0,
          created_at: '2026-04-02T17:45:00.000Z',
          updated_at: '2026-04-02T17:45:00.000Z',
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.endsWith('/sample-data/transactions.json')) {
          return Promise.resolve(createJsonOnlyResponse(transactionManifest));
        }

        if (input.endsWith('/sample-data/transactions.part-000001.json')) {
          return Promise.resolve(createJsonOnlyResponse(transactionChunkOne));
        }

        if (input.endsWith('/sample-data/transactions.part-000002.json')) {
          return Promise.resolve(createJsonOnlyResponse(transactionChunkTwo));
        }

        return Promise.resolve(createMissingResponse());
      })
    );

    batchQueryMock.mockResolvedValue(2);
    queryMock.mockResolvedValue([]);

    await SampleDataService.loadAllSampleData();

    expect(batchQueryMock).toHaveBeenCalledWith(
      SAMPLE_DATA_QUERIES.INSERT_TRANSACTION,
      [
        [
          1,
          '2026-04-01',
          100,
          'Chunked payroll deposit',
          1,
          13,
          1,
          null,
          null,
          'income',
          '1-2026-04-01-100-Chunked payroll deposit',
          0,
          '2026-04-01T08:15:00.000Z',
          '2026-04-01T08:15:00.000Z',
        ],
        [
          2,
          '2026-04-02',
          -50,
          'Chunked grocery run',
          4,
          2,
          4,
          null,
          null,
          'expense',
          '4-2026-04-02--50-Chunked grocery run',
          0,
          '2026-04-02T17:45:00.000Z',
          '2026-04-02T17:45:00.000Z',
        ],
      ],
      { useTransaction: true }
    );
    expect(queryMock).toHaveBeenCalledWith(SAMPLE_DATA_QUERIES.RESET_SEQUENCE, [2, 'transactions']);
  });

  it('supports cooperative cancellation during batched imports', async () => {
    const usersPayload = {
      table: 'users',
      data: createUserRows(251),
    };
    const controller = new AbortController();

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.endsWith('/sample-data/users.json')) {
          return Promise.resolve(createJsonOnlyResponse(usersPayload));
        }

        return Promise.resolve(createMissingResponse());
      })
    );

    batchQueryMock.mockImplementation(async (_sql: string, parameterSets: any[][]) => {
      return parameterSets.length;
    });
    queryMock.mockResolvedValue([]);

    await expect(
      SampleDataService.loadAllSampleData({
        signal: controller.signal,
        onProgress: (progress) => {
          if (
            progress.stage === 'table-progress' &&
            progress.currentTable === 'users' &&
            progress.importedRows >= 250
          ) {
            controller.abort();
          }
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(batchQueryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalledWith(SAMPLE_DATA_QUERIES.RESET_SEQUENCE, [251, 'users']);
  });
});