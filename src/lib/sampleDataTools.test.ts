import {
  SAMPLE_DATA_GENERATION_MODES,
  buildFixtureEnvelopes,
  loadSampleDataContext,
  loadSchemaMetadata,
  readFixtureEnvelopes,
  validateFixtureEnvelopes,
} from '../../scripts/lib/sample-data-tools.mjs';

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

  it('detects runtime compatibility drift for projects and trips', async () => {
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
        'transactions',
      ])
    );
    expect(projectsCompatibility?.compatible).toBe(false);
    expect(projectsCompatibility?.issues.join(' ')).toContain('description, budget');
    expect(tripsCompatibility?.compatible).toBe(false);
    expect(tripsCompatibility?.issues.join(' ')).toContain('description');
  });

  it('builds five years of runtime-compatible suburban family fixtures', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtures = buildFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      { mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE }
    );
    const transactionsFixture = fixtures.find(
      (fixture) => fixture.table === 'transactions'
    );
    const transactionDates = [...(transactionsFixture?.data ?? [])]
      .map((transaction) => transaction.date)
      .sort();
    const categoryIds = new Set(
      transactionsFixture?.data.map((transaction) => transaction.category_id)
    );

    expect(fixtures.map((fixture) => fixture.table)).toEqual([
      'users',
      'accounts',
      'account_cards',
      'categories',
      'companies',
      'transactions',
    ]);
    expect(transactionsFixture?.data).toHaveLength(585);
    expect(transactionDates[0]).toBe('2021-05-01');
    expect(transactionDates[transactionDates.length - 1]).toBe('2026-04-27');
    expect([...categoryIds].sort((left, right) => left - right)).toEqual([
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
        (transaction) => transaction.project_id === null && transaction.trip_id === null
      )
    ).toBe(true);
  });

  it('keeps committed runtime-compatible fixtures in sync with the five-year scenario', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtureFiles = await readFixtureEnvelopes(repoRoot);
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
    expect(transactionsFixture?.status === 'present' && transactionsFixture.envelope.data).toHaveLength(585);

    if (transactionsFixture?.status !== 'present') {
      return;
    }

    const transactionDates = transactionsFixture.envelope.data
      .map((transaction) => transaction.date)
      .sort();

    expect(transactionDates[0]).toBe('2021-05-01');
    expect(transactionDates[transactionDates.length - 1]).toBe('2026-04-27');
  });

  it('validates generated fixtures for runtime-compatible and full-schema modes', async () => {
    const context = await loadSampleDataContext(repoRoot);
    const fixtures = buildFixtureEnvelopes(
      context.schemaTables,
      context.runtimeCompatibility,
      { mode: SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE }
    );
    const fixtureFiles = fixtures.map((fixture) => ({
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
    expect(fullSchemaReport.ok).toBe(false);
    expect(fullSchemaReport.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: 'projects', code: 'missing-file' }),
        expect.objectContaining({ tableName: 'trips', code: 'missing-file' }),
      ])
    );
  });
});