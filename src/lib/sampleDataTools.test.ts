import fs from 'node:fs/promises';
import path from 'node:path';

import {
  MAX_IN_MEMORY_TRANSACTION_COUNT,
  SAMPLE_DATA_GENERATION_MODES,
  buildFixtureEnvelopes,
  estimateTransactionFixtureOutput,
  loadSampleDataContext,
  loadSchemaMetadata,
  readFixtureEnvelopes,
  validateFixtureEnvelopes,
  writeTransactionFixtureEnvelope,
} from '../../scripts/lib/sample-data-tools.mjs';
import { describe, expect, it } from 'vitest';

type TransactionMeta = {
  startDate: string;
  endDate: string;
  referenceDate: string;
  monthsBack: number;
  requestedTransactionCount: number;
  actualTransactionCount: number;
};

type TransactionRow = {
  date: string;
  category_id?: number | null;
  project_id?: number | null;
  trip_id?: number | null;
};

type SampleFixture = {
  table: string;
  data: TransactionRow[];
  meta?: TransactionMeta;
};

type ChunkedTransactionManifest = {
  table: string;
  format?: string;
  dataFiles: Array<{
    file: string;
    rowCount?: number;
  }>;
  meta?: TransactionMeta;
};

type SampleFixtureFile = {
  tableName: string;
  status: string;
  envelope: {
    data: TransactionRow[];
    meta?: TransactionMeta;
  };
};

const legacyTransactionGeneration = {
  referenceDate: '2026-04-30',
  monthsBack: 60,
  targetTransactionCount: 585,
};

describe('sample data tools', () => {
  const repoRoot = process.cwd();

  it('parses the live schema with enums and foreign keys', async () => {
    const tables = await loadSchemaMetadata(repoRoot);
    const accountsTable = tables.find((table) => table.tableName === 'accounts');
    const tripsTable = tables.find((table) => table.tableName === 'trips');

    expect(accountsTable?.foreignKeys).toContainEqual({
      columnName: 'owner_user_id',
      referencedTable: 'users',
      referencedColumn: 'id',
    });
    expect(
      tripsTable?.columns.find((column) => column.columnName === 'trip_category')
        ?.enumValues
    ).toEqual([
      'business',
      'vacation',
      'family',
      'medical',
      'education',
      'other',
    ]);
  });

  it('treats projects and trips as runtime-compatible managed fixtures', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const projectsCompatibility = context.runtimeCompatibility.byTable.get('projects');
    const tripsCompatibility = context.runtimeCompatibility.byTable.get('trips');

    expect(context.runtimeCompatibility.compatibleTables).toEqual(
      expect.arrayContaining([
        'users',
        'accounts',
        'account_cards',
        'categories',
        'companies',
        'projects',
        'trips',
        'budget_plans',
        'budget_plan_categories',
        'income_sources',
        'transactions',
      ])
    );
    expect(projectsCompatibility?.compatible).toBe(true);
    expect(tripsCompatibility?.compatible).toBe(true);
  });

  it('builds five years of runtime-compatible suburban family fixtures', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtures = buildFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      {
        mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE,
        transactionGeneration: legacyTransactionGeneration,
      }
    );
    const transactionsFixture = fixtures.find(
      (fixture: { table: string }) => fixture.table === 'transactions'
    ) as SampleFixture | undefined;
    const transactionDates = [...(transactionsFixture?.data ?? [])]
      .map((transaction) => transaction.date)
      .sort();
    const categoryIds = new Set(
      transactionsFixture?.data.map(
        (transaction: TransactionRow) => transaction.category_id
      )
    );

    expect(fixtures.map((fixture: { table: string }) => fixture.table)).toEqual([
      'users',
      'accounts',
      'account_cards',
      'categories',
      'companies',
      'projects',
      'trips',
      'budget_plans',
      'budget_plan_categories',
      'income_sources',
      'transactions',
    ]);
    expect(transactionsFixture?.data).toHaveLength(585);
    expect(transactionDates[0]).toBe('2021-05-01');
    expect(transactionDates[transactionDates.length - 1]).toBe('2026-04-27');
    expect(
      [...categoryIds]
        .filter((categoryId): categoryId is number => typeof categoryId === 'number')
        .sort((left, right) => left - right)
    ).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
    ]);
    expect(
      transactionsFixture?.data.every(
        (transaction: TransactionRow) =>
          transaction.project_id === null && transaction.trip_id === null
      )
    ).toBe(true);
  });

  it('supports configurable current-day-relative transaction windows and target volumes', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtures = buildFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      {
        mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE,
        transactionGeneration: {
          referenceDate: '2026-05-03',
          monthsBack: 1,
          targetTransactionCount: 40,
        },
      }
    );
    const transactionsFixture = fixtures.find(
      (fixture: { table: string }) => fixture.table === 'transactions'
    ) as SampleFixture | undefined;
    const transactionDates = [...(transactionsFixture?.data ?? [])]
      .map((transaction) => transaction.date)
      .sort();

    expect(transactionsFixture?.meta).toEqual(
      expect.objectContaining({
        referenceDate: '2026-05-03',
        startDate: '2026-04-03',
        monthsBack: 1,
        requestedTransactionCount: 40,
        actualTransactionCount: 40,
      })
    );
    expect(transactionsFixture?.data).toHaveLength(40);
    expect(transactionDates[0] >= '2026-04-03').toBe(true);
    expect(transactionDates[transactionDates.length - 1] <= '2026-05-03').toBe(
      true
    );
  });

  it('estimates transaction fixture output without materializing the full file set', () => {
    const singleFileEstimate = estimateTransactionFixtureOutput({
      transactionGeneration: {
        referenceDate: '2026-05-03',
        monthsBack: 1,
        targetTransactionCount: 40,
      },
    });
    const chunkedEstimate = estimateTransactionFixtureOutput({
      transactionGeneration: {
        referenceDate: '2026-05-03',
        monthsBack: 120,
        targetTransactionCount: 1001,
      },
      maxRowsPerFile: 500,
    });

    expect(singleFileEstimate.outputMode).toBe('single-file');
    expect(singleFileEstimate.isChunked).toBe(false);
    expect(singleFileEstimate.totalFileCount).toBe(1);
    expect(singleFileEstimate.estimatedTotalBytes).toBeGreaterThan(0);
    expect(singleFileEstimate.meta).toEqual(
      expect.objectContaining({
        requestedTransactionCount: 40,
        actualTransactionCount: 40,
      })
    );

    expect(chunkedEstimate.outputMode).toBe('chunked');
    expect(chunkedEstimate.isChunked).toBe(true);
    expect(chunkedEstimate.chunkCount).toBe(3);
    expect(chunkedEstimate.totalFileCount).toBe(4);
    expect(chunkedEstimate.estimatedManifestBytes).toBeGreaterThan(0);
    expect(chunkedEstimate.estimatedDataBytes).toBeGreaterThan(
      chunkedEstimate.estimatedManifestBytes
    );
    expect(chunkedEstimate.estimatedImportBatchCount).toBe(2);
  });

  it('streams large transaction fixtures above the in-memory threshold', async () => {
    const outputDir = path.join(
      'dist',
      'sample-data-tools-test',
      `stream-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
    );
    const targetTransactionCount = MAX_IN_MEMORY_TRANSACTION_COUNT + 1;
    const outputPath = path.join(repoRoot, outputDir, 'transactions.json');

    try {
      const result = await writeTransactionFixtureEnvelope(repoRoot, {
        outputDir,
        transactionGeneration: {
          referenceDate: '2026-05-03',
          monthsBack: 120,
          targetTransactionCount,
        },
      });
      const stats = await fs.stat(outputPath);

      expect(result.filePath).toBe(path.join(outputDir, 'transactions.json'));
      expect(result.isChunked).toBe(false);
      expect(result.additionalFilePaths).toEqual([]);
      expect(result.meta).toEqual(
        expect.objectContaining({
          requestedTransactionCount: targetTransactionCount,
          actualTransactionCount: targetTransactionCount,
          monthsBack: 120,
          referenceDate: '2026-05-03',
        })
      );
      expect(stats.size).toBeGreaterThan(0);
    } finally {
      await fs.rm(path.join(repoRoot, outputDir), {
        recursive: true,
        force: true,
      });
    }
  });

  it('chunks extreme transaction fixture output into a manifest and part files', async () => {
    const outputDir = path.join(
      'dist',
      'sample-data-tools-test',
      `chunked-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
    );
    const manifestPath = path.join(repoRoot, outputDir, 'transactions.json');

    try {
      const result = await writeTransactionFixtureEnvelope(repoRoot, {
        outputDir,
        maxRowsPerFile: 5,
        transactionGeneration: {
          referenceDate: '2026-05-03',
          monthsBack: 1,
          targetTransactionCount: 12,
        },
      });
      const manifest = JSON.parse(
        await fs.readFile(manifestPath, 'utf8')
      ) as ChunkedTransactionManifest;

      expect(result.isChunked).toBe(true);
      expect(result.additionalFilePaths).toHaveLength(3);
      expect(manifest.table).toBe('transactions');
      expect(manifest.format).toBe('chunked');
      expect(manifest.dataFiles).toHaveLength(3);
      expect(
        manifest.dataFiles.reduce(
          (sum, dataFile) => sum + (dataFile.rowCount ?? 0),
          0
        )
      ).toBe(12);

      const firstChunk = JSON.parse(
        await fs.readFile(path.join(repoRoot, outputDir, manifest.dataFiles[0].file), 'utf8')
      ) as SampleFixture;
      const lastChunk = JSON.parse(
        await fs.readFile(
          path.join(
            repoRoot,
            outputDir,
            manifest.dataFiles[manifest.dataFiles.length - 1].file
          ),
          'utf8'
        )
      ) as SampleFixture;

      expect(firstChunk.data).toHaveLength(5);
      expect(lastChunk.data).toHaveLength(2);
    } finally {
      await fs.rm(path.join(repoRoot, outputDir), {
        recursive: true,
        force: true,
      });
    }
  });

  it('keeps committed runtime-compatible fixtures schema-valid', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtureFiles = (await readFixtureEnvelopes(
      repoRoot
    )) as SampleFixtureFile[];
    const transactionsFixture = fixtureFiles.find(
      (fixture) => fixture.tableName === 'transactions'
    );
    const report = validateFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      fixtureFiles,
      { mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE }
    );

    expect(report.ok).toBe(true);
    expect(transactionsFixture?.status).toBe('present');

    if (transactionsFixture?.status !== 'present') {
      return;
    }

    const transactionDates = transactionsFixture.envelope.data
      .map((transaction: TransactionRow) => transaction.date)
      .sort();
    const transactionMeta = transactionsFixture.envelope.meta;

    expect(transactionsFixture.envelope.data.length).toBeGreaterThan(0);

    if (transactionMeta) {
      expect(transactionsFixture.envelope.data).toHaveLength(
        transactionMeta.actualTransactionCount
      );
      expect(transactionDates[0] >= transactionMeta.startDate).toBe(true);
      expect(
        transactionDates[transactionDates.length - 1] <= transactionMeta.endDate
      ).toBe(true);
    }
  });

  it('validates generated fixtures for runtime-compatible and full-schema modes', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtures = buildFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      { mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE }
    );
    const fixtureFiles = fixtures.map((fixture: { table: string; data: TransactionRow[] }) => ({
      tableName: fixture.table,
      filePath: `public/sample-data/${fixture.table}.json`,
      status: 'present',
      envelope: fixture,
    }));

    const runtimeCompatibleReport = validateFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      fixtureFiles,
      { mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE }
    );
    const fullSchemaReport = validateFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      fixtureFiles,
      { mode: SAMPLE_DATA_GENERATION_MODES.FULL_SCHEMA }
    );

    expect(runtimeCompatibleReport.ok).toBe(true);
    expect(fullSchemaReport.ok).toBe(true);
  });
});