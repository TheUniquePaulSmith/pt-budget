import fs from 'node:fs/promises';
import path from 'node:path';

import {
  MAX_IN_MEMORY_TRANSACTION_COUNT,
  SAMPLE_DATA_GENERATION_MODES,
  buildFixtureEnvelopes,
  buildSampleDataBundle,
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
  id?: number;
  date: string;
  amount?: number;
  description?: string;
  account_id?: number;
  category_id?: number | null;
  project_id?: number | null;
  trip_id?: number | null;
  type?: string;
  type_source?: string;
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

  it('treats every managed table, loans and rules included, as runtime-compatible', async () => {
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

  it('lands on a requested transaction count by splitting or merging household rows', async () => {
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
      'loans',
      'loan_match_rules',
      'classification_rules',
      'account_balance_snapshots',
      'transactions',
    ]);
    expect(transactionsFixture?.data).toHaveLength(585);
    expect(transactionsFixture?.meta).toEqual(
      expect.objectContaining({ natural: false, requestedTransactionCount: 585, actualTransactionCount: 585 })
    );
    expect(transactionDates[0] >= '2021-04-30').toBe(true);
    expect(transactionDates[transactionDates.length - 1] <= '2026-04-30').toBe(true);
  });

  it('builds the natural Parker-household set with transfers, refunds, loans and series, newest first', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const bundle = buildSampleDataBundle(
      context.schemaTables,
      context.runtimeCompatibility,
      {
        mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE,
        transactionGeneration: { referenceDate: '2026-04-30', monthsBack: 12, seed: 'review' },
      }
    );
    const byTable = new Map(bundle.fixtureEnvelopes.map((fixture: { table: string }) => [fixture.table, fixture]));
    const transactions = byTable.get('transactions') as SampleFixture;
    const rows = transactions.data;
    const expectations = bundle.expectations as {
      natural: boolean;
      transactions: { total: number; byExpectedType: Record<string, number> };
      transfers: { pairCount: number; expectedTransferRowCount: number; pairs: Array<{ legs: Array<{ id: number; amount: number; accountId: number }> }> };
      refunds: unknown[];
      loans: Array<{ ruleLinked: boolean; expectedPaymentCount: number }>;
      subscriptions: Array<{ detectable: boolean }>;
      months: Array<{ month: string; income: number; expenses: number }>;
      window: { completeMonths: string[] };
    };

    // Natural: every scheduled event is a row, nothing merged or split.
    expect(transactions.meta).toEqual(
      expect.objectContaining({ natural: true, rowOrder: 'newest-first', startDate: '2025-04-30', endDate: '2026-04-30' })
    );
    expect(expectations.natural).toBe(true);
    expect(expectations.transactions.total).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(500);

    // Newest first, ids ascending in file order.
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index].date <= rows[index - 1].date).toBe(true);
      expect(rows[index].id).toBe(rows[index - 1].id! + 1);
    }

    // Raw-import shape: typed by sign only, every classification column neutral.
    expect(rows.every((row) => row.type === (row.amount! > 0 ? 'income' : 'expense'))).toBe(true);
    expect(new Set(rows.map((row) => row.type_source))).toEqual(new Set(['sign']));

    // Transfer pairs: same amount, opposite sign, two accounts, both inside the window.
    expect(expectations.transfers.pairCount).toBeGreaterThan(50);
    for (const pair of expectations.transfers.pairs) {
      expect(pair.legs).toHaveLength(2);
      expect(pair.legs[0].amount + pair.legs[1].amount).toBeCloseTo(0, 2);
      expect(pair.legs[0].accountId).not.toBe(pair.legs[1].accountId);
    }
    expect(expectations.transactions.byExpectedType.transfer).toBe(expectations.transfers.expectedTransferRowCount);
    expect(expectations.refunds.length).toBeGreaterThan(0);

    // Feature coverage: linked project and trip spend, two rule-linked loans and one awaiting a rule.
    expect(rows.some((row) => row.project_id !== null)).toBe(true);
    expect(rows.some((row) => row.trip_id !== null)).toBe(true);
    expect(expectations.loans.filter((loan) => loan.ruleLinked && loan.expectedPaymentCount > 0)).toHaveLength(2);
    expect(expectations.loans.filter((loan) => !loan.ruleLinked)).toHaveLength(1);
    expect(expectations.subscriptions.filter((series) => series.detectable).length).toBeGreaterThanOrEqual(8);

    // Every complete month has income and spending (the partial first and last
    // months may miss a payday).
    expect(expectations.window.completeMonths.length).toBe(11);
    for (const month of expectations.months.filter((candidate) => expectations.window.completeMonths.includes(candidate.month))) {
      expect(month.income, month.month).toBeGreaterThan(0);
      expect(month.expenses, month.month).toBeGreaterThan(0);
    }

    // The dated tables follow the reference date.
    const loans = byTable.get('loans') as { data: Array<{ opened_date: string; promo_end_date: string | null }> };
    expect(loans.data.every((loan) => loan.opened_date >= '2025-04-01')).toBe(true);
    const plans = byTable.get('budget_plans') as { data: Array<{ effective_month: string }> };
    expect(plans.data.map((plan) => plan.effective_month)).toEqual(['2025-04', '2026-01']);
    const accounts = byTable.get('accounts') as { data: Array<{ opening_balance_date: string; currency: string }> };
    expect(accounts.data.every((account) => account.opening_balance_date === '2025-04-30' && account.currency === 'USD')).toBe(true);
  });

  it('is deterministic for a seed and changes with it', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const build = (seed: string) =>
      buildFixtureEnvelopes(context.schemaTables, context.runtimeCompatibility, {
        transactionGeneration: { referenceDate: '2026-04-30', monthsBack: 3, seed },
      }).find((fixture: { table: string }) => fixture.table === 'transactions') as SampleFixture;
    const first = build('alpha');
    const again = build('alpha');
    const other = build('beta');
    expect(JSON.stringify(first.data)).toBe(JSON.stringify(again.data));
    expect(JSON.stringify(first.data)).not.toBe(JSON.stringify(other.data));
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
  }, 30_000); // streams ~MBs of fixtures; the 5s default is exceeded under coverage instrumentation

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