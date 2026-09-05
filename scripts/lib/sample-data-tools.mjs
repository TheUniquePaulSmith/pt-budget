import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const CREATE_TABLES_BLOCK_PATTERN =
  /export const CREATE_TABLES\s*=\s*\{([\s\S]*?)\n\};/;
const CREATE_TABLE_ENTRY_PATTERN = /([A-Z_]+):\s*`([\s\S]*?)`/g;
const SAMPLE_DATA_QUERIES_BLOCK_PATTERN =
  /export const SAMPLE_DATA_QUERIES\s*=\s*\{([\s\S]*?)\n\};/;
const CREATE_TABLE_NAME_PATTERN = /CREATE TABLE IF NOT EXISTS\s+(\w+)/i;
const INSERT_QUERY_PATTERN =
  /INSERT OR REPLACE INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES/i;
const FOREIGN_KEY_PATTERN =
  /FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+(\w+)\s*\((\w+)\)/i;
const COLUMN_PATTERN = /^(\w+)\s+(.+?)(?:,)?$/;
const CHECK_IN_PATTERN = /CHECK\s*\(\s*\w+\s+IN\s*\(([^)]+)\)\s*\)/i;
const COLOR_PALETTE = [
  '#4CAF50',
  '#FF9800',
  '#2196F3',
  '#9C27B0',
  '#FF5722',
  '#00BCD4',
  '#795548',
  '#8BC34A',
  '#CDDC39',
];
const BASE_TIMESTAMP = '2024-01-01T00:00:00.000Z';
const BASE_DATE = '2024-01-01';
const DEFAULT_TRANSACTION_REFERENCE_DATE = '2026-04-30';
const DEFAULT_TRANSACTION_MONTHS_BACK = 60;
const DEFAULT_TRANSACTION_TARGET_COUNT = 585;
export const MAX_IN_MEMORY_TRANSACTION_COUNT = 250000;
export const MAX_TRANSACTION_ROWS_PER_FILE = 1000000;
const TRANSACTION_CHUNK_FILE_PATTERN = /^transactions\.part-\d+\.json$/;
const FAMILY_ACCOUNT_IDS = {
  HOUSEHOLD_CHECKING: 1,
  RAINY_DAY_SAVINGS: 2,
  REWARDS_VISA: 3,
  HOUSEHOLD_JOINT: 4,
};
const FAMILY_ACCOUNT_CARD_IDS = {
  HOUSEHOLD_CHECKING: 1,
  RAINY_DAY_SAVINGS: 2,
  REWARDS_VISA: 3,
  HOUSEHOLD_JOINT: 4,
};
const FAMILY_CATEGORY_IDS = {
  HOUSING: 1,
  GROCERIES: 2,
  UTILITIES: 3,
  TRANSPORTATION: 4,
  HEALTHCARE: 5,
  CHILDCARE_AND_SCHOOL: 6,
  DINING_OUT: 7,
  SHOPPING: 8,
  ENTERTAINMENT: 9,
  INSURANCE: 10,
  TRAVEL: 11,
  HOME_IMPROVEMENT: 12,
  SALARY: 13,
  SIDE_INCOME: 14,
  TAX_REFUND: 15,
};
const FAMILY_COMPANY_IDS = {
  PRIMARY_PAYROLL: 1,
  SECONDARY_PAYROLL: 2,
  MORTGAGE_SERVICER: 3,
  FRESH_MARKET: 4,
  WAREHOUSE_CLUB: 5,
  ELECTRIC_AND_GAS: 6,
  WATER_AND_SEWER: 7,
  HIGHWAY_FUEL: 8,
  CORNER_BISTRO: 9,
  STREAMHOUSE_MEDIA: 10,
  FAMILY_SHIELD_INSURANCE: 11,
  BRIGHTPATH_PEDIATRICS: 12,
  LITTLE_OAKS_LEARNING: 13,
  MAPLE_HARDWARE: 14,
  UPTOWN_OUTFITTERS: 15,
  SUNTRAIL_AIRLINES: 16,
  HARBOR_DUNES_RESORT: 17,
  RIVER_COUNTY_SCHOOLS: 18,
  FREELANCE_COLLECTIVE: 19,
  STATE_REVENUE: 20,
  MAIN_STREET_PHARMACY: 21,
  FIBERLINK_HOME: 22,
  GREENFIELD_LAWN: 23,
  COMMUNITY_SOCCER_CLUB: 24,
};
const FAMILY_TRAVEL_DESTINATIONS = [
  'Outer Banks',
  'San Diego',
  'Yellowstone',
  'Charleston',
  'Maine Coast',
];
const FLEX_EXPENSE_BUILDERS = [
  {
    categoryId: FAMILY_CATEGORY_IDS.DINING_OUT,
    companyId: FAMILY_COMPANY_IDS.CORNER_BISTRO,
    accountId: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
    amount: (yearOffset, monthOffset, monthNumber) =>
      -roundCurrency(
        118 + yearOffset * 5 + (monthOffset % 4) * 9 + (monthNumber === 11 ? 24 : 0)
      ),
    description: (monthNumber) =>
      [
        'Family takeout and pizza night',
        'Friday dinner out',
        'Birthday dinner and dessert',
      ][monthNumber % 3],
  },
  {
    categoryId: FAMILY_CATEGORY_IDS.SHOPPING,
    companyId: FAMILY_COMPANY_IDS.UPTOWN_OUTFITTERS,
    accountId: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
    amount: (yearOffset, monthOffset, monthNumber) =>
      -roundCurrency(
        146 + yearOffset * 6 + (monthOffset % 5) * 11 + (monthNumber === 10 ? 92 : 0)
      ),
    description: (monthNumber) =>
      [
        'Clothing and household essentials',
        'Seasonal clothes and shoes',
        'Home organization and family shopping',
      ][monthNumber % 3],
  },
  {
    categoryId: FAMILY_CATEGORY_IDS.ENTERTAINMENT,
    companyId: FAMILY_COMPANY_IDS.STREAMHOUSE_MEDIA,
    accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT,
    amount: (yearOffset, monthOffset, monthNumber) =>
      -roundCurrency(
        62 + yearOffset * 3 + (monthOffset % 4) * 6 + (monthNumber === 6 ? 28 : 0)
      ),
    description: (monthNumber) =>
      [
        'Streaming bundle and family movie night',
        'Zoo, museum, and streaming subscriptions',
        'Weekend entertainment and subscriptions',
      ][monthNumber % 3],
  },
];

export const DEFAULT_SCHEMA_FILE = path.join(
  'public',
  'database-schema.js'
);
export const DEFAULT_QUERIES_FILE = path.join('src', 'lib', 'sqlQueries.ts');
export const DEFAULT_SAMPLE_DATA_DIR = path.join('public', 'sample-data');
export const DEFAULT_VALIDATION_REPORT_FILE = path.join(
  'dist',
  'sample-data',
  'schema-validation-report.json'
);
export const MANAGED_SAMPLE_TABLES = [
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
];
export const SAMPLE_DATA_GENERATION_MODES = {
  FULL_SCHEMA: 'full-schema',
  RUNTIME_COMPATIBLE: 'runtime-compatible',
};
export const DEFAULT_TRANSACTION_GENERATION = Object.freeze({
  referenceDate: DEFAULT_TRANSACTION_REFERENCE_DATE,
  monthsBack: DEFAULT_TRANSACTION_MONTHS_BACK,
  targetTransactionCount: DEFAULT_TRANSACTION_TARGET_COUNT,
});

export function estimateDefaultTransactionCount(monthsBack) {
  return Math.max(
    1,
    Math.round(
      (DEFAULT_TRANSACTION_TARGET_COUNT / DEFAULT_TRANSACTION_MONTHS_BACK) *
        monthsBack
    )
  );
}

export function resolveTransactionGenerationOptions(options = {}) {
  const referenceDate = normalizeReferenceDate(
    options.referenceDate ?? DEFAULT_TRANSACTION_GENERATION.referenceDate
  );
  const monthsBack = parsePositiveInteger(
    options.monthsBack ?? DEFAULT_TRANSACTION_GENERATION.monthsBack,
    'monthsBack'
  );
  const targetTransactionCount = parsePositiveInteger(
    options.targetTransactionCount ??
      options.amount ??
      DEFAULT_TRANSACTION_GENERATION.targetTransactionCount,
    'targetTransactionCount'
  );
  const startDate = subtractUtcMonths(referenceDate, monthsBack);
  const seed = normalizeSeed(
    options.seed ??
      `${formatDate(referenceDate)}:${monthsBack}:${targetTransactionCount}`
  );

  return {
    referenceDate,
    startDate,
    monthsBack,
    targetTransactionCount,
    seed,
  };
}

export async function readSchemaSource(repoRoot) {
  const schemaPath = path.join(repoRoot, DEFAULT_SCHEMA_FILE);
  return fs.readFile(schemaPath, 'utf8');
}

export async function readSampleDataQueriesSource(repoRoot) {
  const queriesPath = path.join(repoRoot, DEFAULT_QUERIES_FILE);
  return fs.readFile(queriesPath, 'utf8');
}

export function parseCreateTables(sourceText) {
  const createTablesBlockMatch = sourceText.match(CREATE_TABLES_BLOCK_PATTERN);

  if (!createTablesBlockMatch) {
    throw new Error('Unable to locate CREATE_TABLES block in public/database-schema.js');
  }

  const createTablesBlock = createTablesBlockMatch[1];
  const tables = [];

  for (const entryMatch of createTablesBlock.matchAll(CREATE_TABLE_ENTRY_PATTERN)) {
    const [, constantName, sql] = entryMatch;
    tables.push(parseTableSql(constantName, sql));
  }

  if (tables.length === 0) {
    throw new Error('No CREATE_TABLES entries were parsed from public/database-schema.js');
  }

  return tables;
}

export function indexTablesByName(tables) {
  return new Map(tables.map((table) => [table.tableName, table]));
}

export async function loadSchemaMetadata(repoRoot) {
  const sourceText = await readSchemaSource(repoRoot);
  return parseCreateTables(sourceText);
}

export function parseSampleDataQueries(sourceText) {
  const queryBlockMatch = sourceText.match(SAMPLE_DATA_QUERIES_BLOCK_PATTERN);

  if (!queryBlockMatch) {
    throw new Error('Unable to locate SAMPLE_DATA_QUERIES block in src/lib/sqlQueries.ts');
  }

  const queryBlock = queryBlockMatch[1];
  const queries = new Map();

  for (const entryMatch of queryBlock.matchAll(CREATE_TABLE_ENTRY_PATTERN)) {
    const [, constantName, sql] = entryMatch;

    if (!constantName.startsWith('INSERT_')) {
      continue;
    }

    const normalizedSql = sql.trim();
    const insertMatch = normalizedSql.match(INSERT_QUERY_PATTERN);

    if (!insertMatch) {
      continue;
    }

    const [, tableName, rawColumns] = insertMatch;
    const columns = rawColumns
      .split(',')
      .map((columnName) => columnName.trim())
      .filter(Boolean);

    queries.set(tableName, {
      constantName,
      tableName,
      columns,
      sql: normalizedSql,
    });
  }

  return queries;
}

export async function loadSampleDataQueryMetadata(repoRoot) {
  const sourceText = await readSampleDataQueriesSource(repoRoot);
  return parseSampleDataQueries(sourceText);
}

export async function loadSampleDataContext(repoRoot) {
  const [schemaTables, sampleDataQueries] = await Promise.all([
    loadSchemaMetadata(repoRoot),
    loadSampleDataQueryMetadata(repoRoot),
  ]);

  const runtimeCompatibility = analyzeRuntimeCompatibility(
    schemaTables,
    sampleDataQueries
  );

  return {
    schemaTables,
    sampleDataQueries,
    runtimeCompatibility,
  };
}

export function analyzeRuntimeCompatibility(
  schemaTables,
  sampleDataQueries,
  managedTableNames = MANAGED_SAMPLE_TABLES
) {
  const schemaIndex = indexTablesByName(schemaTables);
  const results = managedTableNames.map((tableName) => {
    const schemaTable = schemaIndex.get(tableName);
    const query = sampleDataQueries.get(tableName);
    const issues = [];

    if (!schemaTable) {
      issues.push(`Table ${tableName} is not present in CREATE_TABLES.`);
    }

    if (!query) {
      issues.push(`Missing INSERT query for ${tableName} in SAMPLE_DATA_QUERIES.`);
    }

    if (schemaTable && query) {
      const schemaColumnNames = new Set(
        schemaTable.columns.map((column) => column.columnName)
      );
      const unknownQueryColumns = query.columns.filter(
        (columnName) => !schemaColumnNames.has(columnName)
      );
      const missingRequiredQueryColumns = schemaTable.columns
        .filter((column) => column.required)
        .map((column) => column.columnName)
        .filter((columnName) => !query.columns.includes(columnName));

      if (unknownQueryColumns.length > 0) {
        issues.push(
          `Query references columns not found in schema: ${unknownQueryColumns.join(', ')}.`
        );
      }

      if (missingRequiredQueryColumns.length > 0) {
        issues.push(
          `Query omits required schema columns: ${missingRequiredQueryColumns.join(', ')}.`
        );
      }
    }

    return {
      tableName,
      compatible: issues.length === 0,
      issues,
      queryColumns: query?.columns ?? [],
    };
  });

  return {
    results,
    byTable: new Map(results.map((result) => [result.tableName, result])),
    compatibleTables: results
      .filter((result) => result.compatible)
      .map((result) => result.tableName),
    incompatibleTables: results
      .filter((result) => !result.compatible)
      .map((result) => result.tableName),
  };
}

export function getGenerationTableNames(
  runtimeCompatibility,
  mode = SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE
) {
  if (mode === SAMPLE_DATA_GENERATION_MODES.FULL_SCHEMA) {
    return [...MANAGED_SAMPLE_TABLES];
  }

  return MANAGED_SAMPLE_TABLES.filter((tableName) =>
    runtimeCompatibility.byTable.get(tableName)?.compatible
  );
}

export function buildFixtureEnvelopes(
  schemaTables,
  runtimeCompatibility,
  options = {}
) {
  const mode =
    options.mode ?? SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;
  const tableNames =
    options.tableNames ?? getGenerationTableNames(runtimeCompatibility, mode);
  const schemaIndex = indexTablesByName(schemaTables);
  const transactionGeneration = resolveTransactionGenerationOptions(
    options.transactionGeneration
  );
  const context = {
    activeTables: new Set(tableNames),
    idsByTable: new Map(),
    transactionGeneration,
  };

  return tableNames.map((tableName) => {
    const schemaTable = schemaIndex.get(tableName);

    if (!schemaTable) {
      throw new Error(`Cannot generate data for unknown schema table: ${tableName}`);
    }

    if (tableName === 'transactions') {
      const transactionEnvelope = buildTransactionFixtureEnvelope(
        mode,
        context.transactionGeneration
      );
      const rows = transactionEnvelope.data.map((baseRow, rowIndex) =>
        normalizeRowForTable(schemaTable, baseRow, rowIndex, context)
      );

      context.idsByTable.set(
        tableName,
        rows
          .map((row) => row.id)
          .filter((value) => typeof value === 'number')
      );

      return {
        table: tableName,
        data: rows,
        meta: transactionEnvelope.meta,
      };
    }

    const baseRows = getBaseRowsForTable(tableName, context);
    const rows = baseRows.map((baseRow, rowIndex) =>
      normalizeRowForTable(schemaTable, baseRow, rowIndex, context)
    );

    context.idsByTable.set(
      tableName,
      rows
        .map((row) => row.id)
        .filter((value) => typeof value === 'number')
    );

    return {
      table: tableName,
      data: rows,
    };
  });
}

export async function writeFixtureEnvelopes(
  repoRoot,
  fixtureEnvelopes,
  outputDir = DEFAULT_SAMPLE_DATA_DIR
) {
  const absoluteOutputDir = path.join(repoRoot, outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });

  await Promise.all(
    fixtureEnvelopes.map((fixtureEnvelope) => {
      const outputPath = path.join(
        absoluteOutputDir,
        `${fixtureEnvelope.table}.json`
      );
      const content = `${JSON.stringify(fixtureEnvelope, null, 2)}\n`;
      return fs.writeFile(outputPath, content, 'utf8');
    })
  );

  return fixtureEnvelopes.map((fixtureEnvelope) =>
    path.join(outputDir, `${fixtureEnvelope.table}.json`)
  );
}

export async function writeTransactionFixtureEnvelope(
  repoRoot,
  options = {}
) {
  const mode =
    options.mode ?? SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;
  const outputDir = options.outputDir ?? DEFAULT_SAMPLE_DATA_DIR;
  const absoluteOutputDir = path.join(repoRoot, outputDir);
  const absoluteOutputPath = path.join(absoluteOutputDir, 'transactions.json');
  const maxRowsPerFile = parsePositiveInteger(
    options.maxRowsPerFile ?? MAX_TRANSACTION_ROWS_PER_FILE,
    'maxRowsPerFile'
  );
  const generationOptions = resolveTransactionGenerationOptions(
    options.transactionGeneration
  );
  const plan = buildTransactionGenerationPlan(generationOptions);
  const meta = buildTransactionFixtureMeta(mode, plan);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await removeExistingTransactionChunkFiles(absoluteOutputDir);

  if (plan.actualTransactionCount > maxRowsPerFile) {
    const dataFiles = await writeTransactionChunkFiles(
      absoluteOutputDir,
      plan,
      maxRowsPerFile
    );
    const manifest = {
      table: 'transactions',
      format: 'chunked',
      meta,
      dataFiles,
    };

    await fs.writeFile(
      absoluteOutputPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );

    return {
      filePath: path.join(outputDir, 'transactions.json'),
      additionalFilePaths: dataFiles.map((dataFile) =>
        path.join(outputDir, dataFile.file)
      ),
      meta,
      isChunked: true,
      maxRowsPerFile,
    };
  }

  const stream = createWriteStream(absoluteOutputPath, { encoding: 'utf8' });

  try {
    await writeToStream(stream, '{' + '\n');
    await writeToStream(stream, '  "table": "transactions",\n');
    await writeToStream(
      stream,
      `  "meta": ${indentMultilineJson(JSON.stringify(meta, null, 2), 2)},\n`
    );
    await writeToStream(stream, '  "data": [\n');

    let isFirstRow = true;
    for (const row of iterateTransactionRows(plan)) {
      await writeToStream(
        stream,
        `${isFirstRow ? '' : ',\n'}    ${JSON.stringify(row)}`
      );
      isFirstRow = false;
    }

    if (!isFirstRow) {
      await writeToStream(stream, '\n');
    }

    await writeToStream(stream, '  ]\n');
    await writeToStream(stream, '}\n');
    stream.end();

    await waitForWritableStream(stream);

    return {
      filePath: path.join(outputDir, 'transactions.json'),
      additionalFilePaths: [],
      meta,
      isChunked: false,
      maxRowsPerFile,
    };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export function estimateTransactionFixtureOutput(options = {}) {
  const mode =
    options.mode ?? SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;
  const maxRowsPerFile = parsePositiveInteger(
    options.maxRowsPerFile ?? MAX_TRANSACTION_ROWS_PER_FILE,
    'maxRowsPerFile'
  );
  const sampleRowCount = parsePositiveInteger(
    options.sampleRowCount ?? 128,
    'sampleRowCount'
  );
  const generationOptions = resolveTransactionGenerationOptions(
    options.transactionGeneration
  );
  const plan = buildTransactionGenerationPlan(generationOptions);
  const meta = buildTransactionFixtureMeta(mode, plan);
  const usesStreaming =
    plan.actualTransactionCount > MAX_IN_MEMORY_TRANSACTION_COUNT;
  const isChunked = plan.actualTransactionCount > maxRowsPerFile;
  const outputMode = isChunked
    ? 'chunked'
    : usesStreaming
      ? 'streamed-single-file'
      : 'single-file';
  const averageRowBytes = estimateAverageTransactionRowBytes(
    plan,
    sampleRowCount
  );

  if (!isChunked) {
    return {
      meta,
      outputMode,
      usesStreaming,
      isChunked,
      maxRowsPerFile,
      chunkCount: 0,
      totalFileCount: 1,
      averageRowBytes,
      estimatedManifestBytes: 0,
      estimatedDataBytes: estimateTransactionEnvelopeBytes({
        rowCount: plan.actualTransactionCount,
        averageRowBytes,
        meta,
        includeMeta: true,
      }),
      estimatedTotalBytes: estimateTransactionEnvelopeBytes({
        rowCount: plan.actualTransactionCount,
        averageRowBytes,
        meta,
        includeMeta: true,
      }),
      estimatedImportBatchCount: Math.ceil(plan.actualTransactionCount / 1000),
    };
  }

  const chunkRowCounts = buildChunkRowCounts(
    plan.actualTransactionCount,
    maxRowsPerFile
  );
  const dataFiles = chunkRowCounts.map((rowCount, index) => ({
    file: createTransactionChunkFileName(index + 1),
    rowCount,
  }));
  const manifest = {
    table: 'transactions',
    format: 'chunked',
    meta,
    dataFiles,
  };
  const estimatedManifestBytes = Buffer.byteLength(
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  const estimatedDataBytes = chunkRowCounts.reduce(
    (sum, rowCount) =>
      sum +
      estimateTransactionEnvelopeBytes({
        rowCount,
        averageRowBytes,
        includeMeta: false,
      }),
    0
  );

  return {
    meta,
    outputMode,
    usesStreaming,
    isChunked,
    maxRowsPerFile,
    chunkCount: chunkRowCounts.length,
    totalFileCount: chunkRowCounts.length + 1,
    averageRowBytes,
    estimatedManifestBytes,
    estimatedDataBytes,
    estimatedTotalBytes: estimatedManifestBytes + estimatedDataBytes,
    estimatedImportBatchCount: Math.ceil(plan.actualTransactionCount / 1000),
  };
}

export async function readFixtureEnvelopes(
  repoRoot,
  tableNames = MANAGED_SAMPLE_TABLES,
  outputDir = DEFAULT_SAMPLE_DATA_DIR
) {
  const absoluteOutputDir = path.join(repoRoot, outputDir);
  const results = [];

  for (const tableName of tableNames) {
    const filePath = path.join(absoluteOutputDir, `${tableName}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const envelope = JSON.parse(content);

      if (isChunkedTransactionFixtureEnvelope(envelope)) {
        await assertTransactionChunkFilesExist(absoluteOutputDir, envelope);
      }

      results.push({
        tableName,
        filePath,
        status: 'present',
        envelope,
      });
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        results.push({
          tableName,
          filePath,
          status: 'missing',
        });
        continue;
      }

      results.push({
        tableName,
        filePath,
        status: 'invalid',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function validateFixtureEnvelopes(
  schemaTables,
  runtimeCompatibility,
  fixtureFiles,
  options = {}
) {
  const mode =
    options.mode ?? SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;
  const expectedTables = getGenerationTableNames(runtimeCompatibility, mode);
  const schemaIndex = indexTablesByName(schemaTables);
  const fixtureByTable = new Map(
    fixtureFiles.map((fixtureFile) => [fixtureFile.tableName, fixtureFile])
  );
  const allFixtureIds = new Map();
  const issues = [];
  const warnings = [];

  for (const tableName of MANAGED_SAMPLE_TABLES) {
    const compatibility = runtimeCompatibility.byTable.get(tableName);

    if (compatibility && !compatibility.compatible) {
      warnings.push({
        code: 'runtime-incompatible-table',
        tableName,
        message: compatibility.issues.join(' '),
      });
    }
  }

  const unmanagedSchemaTables = schemaTables
    .map((table) => table.tableName)
    .filter((tableName) => !MANAGED_SAMPLE_TABLES.includes(tableName));

  for (const tableName of unmanagedSchemaTables) {
    warnings.push({
      code: 'unmanaged-schema-table',
      tableName,
      message: `${tableName} exists in CREATE_TABLES but is not part of the managed sample-data workflow.`,
    });
  }

  for (const tableName of expectedTables) {
    const fixtureFile = fixtureByTable.get(tableName);

    if (!fixtureFile || fixtureFile.status === 'missing') {
      issues.push({
        code: 'missing-file',
        tableName,
        message: `Expected fixture file ${tableName}.json is missing.`,
      });
      continue;
    }

    if (fixtureFile.status === 'invalid') {
      issues.push({
        code: 'invalid-json',
        tableName,
        message: fixtureFile.error,
      });
      continue;
    }

    const schemaTable = schemaIndex.get(tableName);

    if (!schemaTable) {
      issues.push({
        code: 'missing-schema-table',
        tableName,
        message: `Schema metadata for ${tableName} could not be found.`,
      });
      continue;
    }

    const envelope = fixtureFile.envelope;

    if (envelope.table !== tableName) {
      issues.push({
        code: 'table-name-mismatch',
        tableName,
        message: `Fixture table field is ${String(envelope.table)} instead of ${tableName}.`,
      });
    }

    if (isChunkedTransactionFixtureEnvelope(envelope)) {
      validateChunkedTransactionManifest(tableName, envelope, issues, warnings);
      allFixtureIds.set(tableName, new Set());
      continue;
    }

    if (!Array.isArray(envelope.data)) {
      issues.push({
        code: 'invalid-data-array',
        tableName,
        message: 'Fixture data must be an array.',
      });
      continue;
    }

    allFixtureIds.set(
      tableName,
      new Set(
        envelope.data
          .map((row) => row?.id)
          .filter((value) => typeof value === 'number')
      )
    );

    validateRowsForSchema(schemaTable, envelope.data, issues);
  }

  for (const tableName of expectedTables) {
    const fixtureFile = fixtureByTable.get(tableName);

    if (!fixtureFile || fixtureFile.status !== 'present') {
      continue;
    }

    const schemaTable = schemaIndex.get(tableName);

    if (!schemaTable) {
      continue;
    }

    if (!Array.isArray(fixtureFile.envelope.data)) {
      continue;
    }

    validateForeignKeys(schemaTable, fixtureFile.envelope.data, allFixtureIds, issues);
  }

  return {
    ok: issues.length === 0,
    mode,
    expectedTables,
    compatibleTables: runtimeCompatibility.compatibleTables,
    incompatibleTables: runtimeCompatibility.incompatibleTables,
    issues,
    warnings,
  };
}

export function formatValidationReport(report) {
  const lines = [
    `Sample data validation: ${report.ok ? 'PASS' : 'FAIL'}`,
    `Mode: ${report.mode}`,
    `Expected tables: ${report.expectedTables.join(', ')}`,
    `Runtime-compatible tables: ${report.compatibleTables.join(', ') || 'none'}`,
  ];

  if (report.incompatibleTables.length > 0) {
    lines.push(
      `Runtime-incompatible tables: ${report.incompatibleTables.join(', ')}`
    );
  }

  if (report.issues.length > 0) {
    lines.push('Issues:');
    for (const issue of report.issues) {
      lines.push(`- [${issue.tableName}] ${issue.message}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of report.warnings) {
      lines.push(`- [${warning.tableName}] ${warning.message}`);
    }
  }

  return lines.join('\n');
}

export async function writeValidationReport(
  repoRoot,
  report,
  reportFile = DEFAULT_VALIDATION_REPORT_FILE
) {
  const absoluteReportPath = path.join(repoRoot, reportFile);
  await fs.mkdir(path.dirname(absoluteReportPath), { recursive: true });
  await fs.writeFile(
    absoluteReportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  return reportFile;
}

function parseTableSql(constantName, sql) {
  const trimmedSql = sql.trim();
  const tableNameMatch = trimmedSql.match(CREATE_TABLE_NAME_PATTERN);

  if (!tableNameMatch) {
    throw new Error(`Unable to determine table name for ${constantName}`);
  }

  const tableName = tableNameMatch[1];
  const columns = [];
  const foreignKeys = [];

  for (const rawLine of trimmedSql.split('\n')) {
    const line = rawLine.trim();

    if (
      line.length === 0 ||
      line.startsWith('CREATE TABLE') ||
      line === ')' ||
      line === ');'
    ) {
      continue;
    }

    const foreignKeyMatch = line.match(FOREIGN_KEY_PATTERN);

    if (foreignKeyMatch) {
      const [, columnName, referencedTable, referencedColumn] = foreignKeyMatch;
      foreignKeys.push({
        columnName,
        referencedTable,
        referencedColumn,
      });
      continue;
    }

    const columnMatch = line.match(COLUMN_PATTERN);

    if (!columnMatch) {
      continue;
    }

    const [, columnName, definition] = columnMatch;
    columns.push({
      columnName,
      definition,
      required: isRequiredColumn(columnName, definition),
      primaryKey: /\bPRIMARY KEY\b/i.test(definition),
      hasDefault: /\bDEFAULT\b/i.test(definition),
      enumValues: extractEnumValues(definition),
    });
  }

  return {
    constantName,
    tableName,
    sql: trimmedSql,
    columns,
    foreignKeys,
  };
}

function getBaseRowsForTable(tableName, context) {
  switch (tableName) {
    case 'users':
      return [
        { id: 1, display_name: 'Avery Parker', is_primary: 1 },
        { id: 2, display_name: 'Jordan Parker', is_primary: 0 },
      ];
    case 'accounts':
      return [
        {
          id: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          name: 'Household Checking',
          type: 'checking',
          ownership: 'individual',
          owner_user_id: 1,
        },
        {
          id: FAMILY_ACCOUNT_IDS.RAINY_DAY_SAVINGS,
          name: 'Rainy Day Savings',
          type: 'savings',
          ownership: 'individual',
          owner_user_id: 1,
        },
        {
          id: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
          name: 'Rewards Visa',
          type: 'credit',
          ownership: 'individual',
          owner_user_id: 1,
        },
        {
          id: FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT,
          name: 'Household Joint',
          type: 'checking',
          ownership: 'joint',
          owner_user_id: 2,
        },
      ];
    case 'account_cards':
      return [
        {
          id: 1,
          account_id: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          last_four: '4821',
          full_number: '400000000004821',
          nickname: 'Main Debit',
          user_id: 1,
        },
        {
          id: 2,
          account_id: FAMILY_ACCOUNT_IDS.RAINY_DAY_SAVINGS,
          last_four: '6502',
          nickname: 'Savings ATM',
          user_id: 1,
        },
        {
          id: 3,
          account_id: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
          last_four: '9034',
          nickname: 'Rewards Card',
          user_id: 1,
        },
        {
          id: 4,
          account_id: FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT,
          last_four: '1176',
          nickname: 'Joint Debit',
          user_id: 2,
        },
        // Deliberately shares last_four with card 1 but on a different
        // account, distinguished by full_number — exercises CSV-import
        // disambiguation between cards that share their last four digits.
        {
          id: 5,
          account_id: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
          last_four: '4821',
          full_number: '550000000004821',
          nickname: 'Backup Card',
          user_id: 1,
        },
      ];
    case 'categories':
      return [
        { id: FAMILY_CATEGORY_IDS.HOUSING, name: 'Housing', color: '#8D6E63', type: 'expense' },
        { id: FAMILY_CATEGORY_IDS.GROCERIES, name: 'Groceries', color: '#43A047', type: 'expense' },
        { id: FAMILY_CATEGORY_IDS.UTILITIES, name: 'Utilities', color: '#FB8C00', type: 'expense' },
        {
          id: FAMILY_CATEGORY_IDS.TRANSPORTATION,
          name: 'Transportation',
          color: '#1E88E5',
          type: 'expense',
        },
        { id: FAMILY_CATEGORY_IDS.HEALTHCARE, name: 'Healthcare', color: '#E53935', type: 'expense' },
        {
          id: FAMILY_CATEGORY_IDS.CHILDCARE_AND_SCHOOL,
          name: 'Childcare & School',
          color: '#5E35B1',
          type: 'expense',
        },
        { id: FAMILY_CATEGORY_IDS.DINING_OUT, name: 'Dining Out', color: '#F4511E', type: 'expense' },
        { id: FAMILY_CATEGORY_IDS.SHOPPING, name: 'Shopping', color: '#6D4C41', type: 'expense' },
        {
          id: FAMILY_CATEGORY_IDS.ENTERTAINMENT,
          name: 'Entertainment',
          color: '#8E24AA',
          type: 'expense',
        },
        { id: FAMILY_CATEGORY_IDS.INSURANCE, name: 'Insurance', color: '#546E7A', type: 'expense' },
        { id: FAMILY_CATEGORY_IDS.TRAVEL, name: 'Travel', color: '#00ACC1', type: 'expense' },
        {
          id: FAMILY_CATEGORY_IDS.HOME_IMPROVEMENT,
          name: 'Home Improvement',
          color: '#7CB342',
          type: 'expense',
        },
        { id: FAMILY_CATEGORY_IDS.SALARY, name: 'Salary', color: '#2E7D32', type: 'income' },
        { id: FAMILY_CATEGORY_IDS.SIDE_INCOME, name: 'Side Income', color: '#C0CA33', type: 'income' },
        { id: FAMILY_CATEGORY_IDS.TAX_REFUND, name: 'Tax Refund', color: '#FDD835', type: 'income' },
      ];
    case 'companies':
      return [
        { id: FAMILY_COMPANY_IDS.PRIMARY_PAYROLL, name: 'Cedar Valley Payroll' },
        { id: FAMILY_COMPANY_IDS.SECONDARY_PAYROLL, name: 'Pine Ridge Health Network' },
        { id: FAMILY_COMPANY_IDS.MORTGAGE_SERVICER, name: 'Meadowbrook Mortgage' },
        { id: FAMILY_COMPANY_IDS.FRESH_MARKET, name: 'Fresh Market' },
        { id: FAMILY_COMPANY_IDS.WAREHOUSE_CLUB, name: 'Warehouse Club' },
        { id: FAMILY_COMPANY_IDS.ELECTRIC_AND_GAS, name: 'Suburban Gas & Electric' },
        { id: FAMILY_COMPANY_IDS.WATER_AND_SEWER, name: 'Metro Water & Sewer' },
        { id: FAMILY_COMPANY_IDS.HIGHWAY_FUEL, name: 'Highway Fuel Stop' },
        { id: FAMILY_COMPANY_IDS.CORNER_BISTRO, name: 'Corner Table Bistro' },
        { id: FAMILY_COMPANY_IDS.STREAMHOUSE_MEDIA, name: 'StreamHouse Media' },
        {
          id: FAMILY_COMPANY_IDS.FAMILY_SHIELD_INSURANCE,
          name: 'Family Shield Insurance',
        },
        { id: FAMILY_COMPANY_IDS.BRIGHTPATH_PEDIATRICS, name: 'BrightPath Pediatrics' },
        { id: FAMILY_COMPANY_IDS.LITTLE_OAKS_LEARNING, name: 'Little Oaks Learning Center' },
        { id: FAMILY_COMPANY_IDS.MAPLE_HARDWARE, name: 'Maple Hardware' },
        { id: FAMILY_COMPANY_IDS.UPTOWN_OUTFITTERS, name: 'Uptown Outfitters' },
        { id: FAMILY_COMPANY_IDS.SUNTRAIL_AIRLINES, name: 'SunTrail Airlines' },
        { id: FAMILY_COMPANY_IDS.HARBOR_DUNES_RESORT, name: 'Harbor Dunes Resort' },
        { id: FAMILY_COMPANY_IDS.RIVER_COUNTY_SCHOOLS, name: 'River County School District' },
        { id: FAMILY_COMPANY_IDS.FREELANCE_COLLECTIVE, name: 'Neighborhood Freelance Collective' },
        { id: FAMILY_COMPANY_IDS.STATE_REVENUE, name: 'State Revenue Department' },
        { id: FAMILY_COMPANY_IDS.MAIN_STREET_PHARMACY, name: 'Main Street Pharmacy' },
        { id: FAMILY_COMPANY_IDS.FIBERLINK_HOME, name: 'FiberLink Home' },
        { id: FAMILY_COMPANY_IDS.GREENFIELD_LAWN, name: 'GreenField Lawn Care' },
        { id: FAMILY_COMPANY_IDS.COMMUNITY_SOCCER_CLUB, name: 'Community Soccer Club' },
      ];
    case 'projects':
      return [
        {
          id: 1,
          name: 'Mudroom Storage Refresh',
          company_name: 'Maple Hardware',
          contact_details: 'service@maplehardware.example',
          project_category: 'other',
          status: 'completed',
          start_date: '2025-09-10',
          end_date: '2025-10-02',
          estimated_cost: 1800,
          actual_cost: 1645,
          notes: 'Built-in cubbies and bench seating for school gear',
        },
        {
          id: 2,
          name: 'Patio Shade Install',
          company_name: 'GreenField Lawn Care',
          contact_details: 'hello@greenfield.example',
          project_category: 'landscaping',
          status: 'planning',
          start_date: '2026-03-14',
          end_date: '2026-04-08',
          estimated_cost: 2600,
          actual_cost: 0,
          notes: 'Shade sail and raised planters for the back patio',
        },
      ];
    case 'trips':
      return [
        {
          id: 1,
          name: 'Outer Banks Summer Week',
          destination: 'Outer Banks',
          purpose: 'Family beach vacation',
          trip_category: 'family',
          status: 'completed',
          start_date: '2025-07-13',
          end_date: '2025-07-19',
          estimated_cost: 2100,
          actual_cost: 2248.63,
          notes: 'Rental house, beach gear, and family activities',
        },
        {
          id: 2,
          name: 'Spring Break in Charleston',
          destination: 'Charleston',
          purpose: 'School break city trip',
          trip_category: 'family',
          status: 'planning',
          start_date: '2026-04-05',
          end_date: '2026-04-10',
          estimated_cost: 2450,
          actual_cost: 0,
          notes: 'Historic district hotel plus aquarium and food tour',
        },
      ];
    case 'budget_plans':
      return [
        {
          id: 1,
          effective_month: '2026-01',
          total_amount: 6575,
          notes: 'Baseline household budget for the year',
        },
        {
          id: 2,
          effective_month: '2026-04',
          total_amount: 6840,
          notes: 'Spring adjustment for travel and school activities',
        },
      ];
    case 'budget_plan_categories':
      return [
        { id: 1, plan_id: 1, category_id: FAMILY_CATEGORY_IDS.HOUSING, amount: 2450 },
        { id: 2, plan_id: 1, category_id: FAMILY_CATEGORY_IDS.GROCERIES, amount: 780 },
        { id: 3, plan_id: 1, category_id: FAMILY_CATEGORY_IDS.UTILITIES, amount: 410 },
        { id: 4, plan_id: 1, category_id: FAMILY_CATEGORY_IDS.DINING_OUT, amount: 360 },
        { id: 5, plan_id: 2, category_id: FAMILY_CATEGORY_IDS.HOUSING, amount: 2450 },
        { id: 6, plan_id: 2, category_id: FAMILY_CATEGORY_IDS.GROCERIES, amount: 825 },
        { id: 7, plan_id: 2, category_id: FAMILY_CATEGORY_IDS.TRAVEL, amount: 620 },
        { id: 8, plan_id: 2, category_id: FAMILY_CATEGORY_IDS.CHILDCARE_AND_SCHOOL, amount: 1180 },
      ];
    case 'income_sources':
      return [
        {
          id: 1,
          name: 'Primary salary',
          kind: 'recurring_salary',
          user_id: 1,
          amount: 4200,
          frequency: 'monthly',
          start_date: '2024-01-01',
          end_date: null,
          is_active: 1,
          notes: 'Monthly take-home pay estimate',
        },
        {
          id: 2,
          name: 'Household checking income deposits',
          kind: 'linked_account',
          user_id: 1,
          account_id: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          amount: null,
          frequency: null,
          start_date: '2024-01-01',
          end_date: null,
          is_active: 1,
          notes: 'Actual income linked from deposits',
        },
      ];
    default:
      return Array.from({ length: 2 }, (_, index) => ({ id: index + 1 }));
  }
}

function buildTransactionFixtureEnvelope(mode, transactionGenerationOptions) {
  const plan = buildTransactionGenerationPlan(transactionGenerationOptions);

  if (plan.actualTransactionCount > MAX_IN_MEMORY_TRANSACTION_COUNT) {
    throw new Error(
      `Requested ${plan.actualTransactionCount.toLocaleString()} transactions exceeds the in-memory fixture limit of ${MAX_IN_MEMORY_TRANSACTION_COUNT.toLocaleString()}. Use writeTransactionFixtureEnvelope() for large transaction sets.`
    );
  }

  return {
    table: 'transactions',
    data: Array.from(iterateTransactionRows(plan)),
    meta: buildTransactionFixtureMeta(mode, plan),
  };
}

function buildTransactionGenerationPlan(transactionGenerationOptions) {
  const config = resolveTransactionGenerationOptions(transactionGenerationOptions);
  const monthlyBuckets = buildMonthlyTransactionBuckets(config);
  const baselineTransactionCount = monthlyBuckets.reduce(
    (sum, bucket) => sum + bucket.entries.length,
    0
  );
  const totalCapacity = monthlyBuckets.reduce(
    (sum, bucket) => sum + bucket.maxTransactionCount,
    0
  );
  const actualTransactionCount = Math.max(
    0,
    Math.min(config.targetTransactionCount, totalCapacity)
  );
  const monthlyTargetCounts =
    actualTransactionCount === baselineTransactionCount
      ? monthlyBuckets.map((bucket) => bucket.entries.length)
      : allocateBoundedCounts(
          actualTransactionCount,
          monthlyBuckets.map((bucket) => ({
            weight: Math.max(bucket.entries.length, 1),
            max: bucket.maxTransactionCount,
            min:
              actualTransactionCount >= monthlyBuckets.length &&
              bucket.maxTransactionCount > 0
                ? 1
                : 0,
          }))
        );

  return {
    config,
    baselineTransactionCount,
    totalCapacity,
    requestedTransactionCount: config.targetTransactionCount,
    actualTransactionCount,
    monthlyPlans: monthlyBuckets
      .map((bucket, index) =>
        buildTransactionMonthPlan(bucket, monthlyTargetCounts[index])
      )
      .filter(Boolean),
  };
}

function buildMonthlyTransactionBuckets(config) {
  const entries = buildBaselineTransactionEntries(config);
  const buckets = [];
  let currentBucket = null;

  for (const entry of entries) {
    if (!currentBucket || currentBucket.monthKey !== entry.monthKey) {
      currentBucket = {
        monthKey: entry.monthKey,
        monthDate: entry.monthDate,
        entries: [],
        maxTransactionCount: 0,
      };
      buckets.push(currentBucket);
    }

    currentBucket.entries.push(entry);
    currentBucket.maxTransactionCount += Math.abs(entry.amountCents);
  }

  return buckets;
}

function buildBaselineTransactionEntries(config) {
  const entries = [];
  const startMonth = firstDayOfMonth(config.startDate);
  const endMonth = firstDayOfMonth(config.referenceDate);
  const monthCount = diffCalendarMonths(startMonth, endMonth) + 1;
  const startYear = startMonth.getUTCFullYear();
  const rangeStart = formatDate(config.startDate);
  const rangeEnd = formatDate(config.referenceDate);

  const pushTransaction = ({
    monthDate,
    day,
    amount,
    description,
    accountId,
    categoryId,
    companyId,
    type,
    hour,
    minute,
  }) => {
    const date = buildMonthDateString(monthDate, day);

    if (date < rangeStart || date > rangeEnd) {
      return;
    }

    entries.push({
      monthKey: formatMonthKey(monthDate),
      monthDate,
      date,
      day: Number(date.slice(-2)),
      amountCents: toCents(amount),
      description,
      accountId,
      categoryId,
      companyId,
      type,
      hour,
      minute,
    });
  };

  for (let monthOffset = 0; monthOffset < monthCount; monthOffset += 1) {
    const monthDate = new Date(
      Date.UTC(
        startMonth.getUTCFullYear(),
        startMonth.getUTCMonth() + monthOffset,
        1
      )
    );
    const yearOffset = monthDate.getUTCFullYear() - startYear;
    const monthNumber = monthDate.getUTCMonth();
    const travelDestination =
      FAMILY_TRAVEL_DESTINATIONS[
        yearOffset % FAMILY_TRAVEL_DESTINATIONS.length
      ];
    const flexExpense = FLEX_EXPENSE_BUILDERS[monthOffset % FLEX_EXPENSE_BUILDERS.length];

    pushTransaction({
      monthDate,
      day: 1,
      amount: 4310 + yearOffset * 180 + (monthOffset % 3) * 24,
      description: 'Avery payroll deposit',
      accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      categoryId: FAMILY_CATEGORY_IDS.SALARY,
      companyId: FAMILY_COMPANY_IDS.PRIMARY_PAYROLL,
      type: 'income',
      hour: 8,
      minute: 15,
    });
    pushTransaction({
      monthDate,
      day: 15,
      amount: 2975 + yearOffset * 140 + (monthOffset % 4) * 18,
      description: 'Jordan payroll deposit',
      accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: FAMILY_CATEGORY_IDS.SALARY,
      companyId: FAMILY_COMPANY_IDS.SECONDARY_PAYROLL,
      type: 'income',
      hour: 8,
      minute: 40,
    });
    pushTransaction({
      monthDate,
      day: 3,
      amount: -(1825 + yearOffset * 48 + (monthNumber === 0 ? 18 : 0)),
      description: 'Monthly mortgage payment',
      accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      categoryId: FAMILY_CATEGORY_IDS.HOUSING,
      companyId: FAMILY_COMPANY_IDS.MORTGAGE_SERVICER,
      type: 'expense',
      hour: 9,
      minute: 10,
    });
    pushTransaction({
      monthDate,
      day: 6,
      amount:
        -(628 +
          yearOffset * 22 +
          seasonalGroceriesAdjustment(monthNumber) +
          (monthOffset % 2) * 34),
      description:
        monthOffset % 2 === 0
          ? 'Weekly groceries and household staples'
          : 'Warehouse restock for family pantry',
      accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: FAMILY_CATEGORY_IDS.GROCERIES,
      companyId:
        monthOffset % 2 === 0
          ? FAMILY_COMPANY_IDS.FRESH_MARKET
          : FAMILY_COMPANY_IDS.WAREHOUSE_CLUB,
      type: 'expense',
      hour: 17,
      minute: 45,
    });
    pushTransaction({
      monthDate,
      day: 9,
      amount: -(258 + yearOffset * 11 + seasonalUtilitiesAdjustment(monthNumber)),
      description:
        monthNumber >= 5 && monthNumber <= 7
          ? 'Summer cooling, water, and internet'
          : monthNumber === 11 || monthNumber <= 1
            ? 'Winter heating, power, and internet'
            : 'Utilities, water, and internet service',
      accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      categoryId: FAMILY_CATEGORY_IDS.UTILITIES,
      companyId:
        monthOffset % 2 === 0
          ? FAMILY_COMPANY_IDS.ELECTRIC_AND_GAS
          : FAMILY_COMPANY_IDS.FIBERLINK_HOME,
      type: 'expense',
      hour: 10,
      minute: 5,
    });
    pushTransaction({
      monthDate,
      day: 11,
      amount:
        -(186 +
          yearOffset * 8 +
          transportationAdjustment(monthNumber) +
          (monthOffset % 3) * 7),
      description:
        monthNumber >= 8 && monthNumber <= 10
          ? 'Fuel, parking, and school commute costs'
          : 'Fuel, tolls, and commuter costs',
      accountId: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
      categoryId: FAMILY_CATEGORY_IDS.TRANSPORTATION,
      companyId: FAMILY_COMPANY_IDS.HIGHWAY_FUEL,
      type: 'expense',
      hour: 7,
      minute: 25,
    });
    pushTransaction({
      monthDate,
      day: 18,
      amount: -schoolAndActivityAmount(yearOffset, monthNumber, monthOffset),
      description: buildSchoolExpenseDescription(monthNumber, monthOffset),
      accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: FAMILY_CATEGORY_IDS.CHILDCARE_AND_SCHOOL,
      companyId: schoolExpenseCompanyId(monthNumber),
      type: 'expense',
      hour: 14,
      minute: 20,
    });
    pushTransaction({
      monthDate,
      day: 22,
      amount: flexExpense.amount(yearOffset, monthOffset, monthNumber),
      description: flexExpense.description(monthNumber),
      accountId: flexExpense.accountId,
      categoryId: flexExpense.categoryId,
      companyId: flexExpense.companyId,
      type: 'expense',
      hour: 19,
      minute: 10,
    });

    if ([1, 4, 7, 10].includes(monthNumber)) {
      pushTransaction({
        monthDate,
        day: 24,
        amount: -(742 + yearOffset * 24 + (monthNumber === 10 ? 36 : 0)),
        description: 'Quarterly home and auto insurance premium',
        accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: FAMILY_CATEGORY_IDS.INSURANCE,
        companyId: FAMILY_COMPANY_IDS.FAMILY_SHIELD_INSURANCE,
        type: 'expense',
        hour: 11,
        minute: 30,
      });
    }

    if ([0, 3, 8].includes(monthNumber)) {
      pushTransaction({
        monthDate,
        day: 13,
        amount: -healthcareAmount(yearOffset, monthNumber),
        description: buildHealthcareDescription(monthNumber),
        accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: FAMILY_CATEGORY_IDS.HEALTHCARE,
        companyId:
          monthNumber === 8
            ? FAMILY_COMPANY_IDS.MAIN_STREET_PHARMACY
            : FAMILY_COMPANY_IDS.BRIGHTPATH_PEDIATRICS,
        type: 'expense',
        hour: 16,
        minute: 35,
      });
    }

    if (monthNumber % 2 === 1) {
      pushTransaction({
        monthDate,
        day: 27,
        amount:
          435 +
          yearOffset * 28 +
          (monthOffset % 4) * 42 +
          (monthNumber === 11 ? 95 : 0),
        description: buildSideIncomeDescription(monthNumber),
        accountId: FAMILY_ACCOUNT_IDS.RAINY_DAY_SAVINGS,
        categoryId: FAMILY_CATEGORY_IDS.SIDE_INCOME,
        companyId: FAMILY_COMPANY_IDS.FREELANCE_COLLECTIVE,
        type: 'income',
        hour: 18,
        minute: 10,
      });
    }

    if (monthNumber === 2) {
      pushTransaction({
        monthDate,
        day: 5,
        amount: 2175 + yearOffset * 90 + (monthOffset % 2) * 125,
        description: 'State tax refund',
        accountId: FAMILY_ACCOUNT_IDS.RAINY_DAY_SAVINGS,
        categoryId: FAMILY_CATEGORY_IDS.TAX_REFUND,
        companyId: FAMILY_COMPANY_IDS.STATE_REVENUE,
        type: 'income',
        hour: 9,
        minute: 5,
      });
    }

    if ([3, 5, 9].includes(monthNumber)) {
      pushTransaction({
        monthDate,
        day: monthNumber === 5 ? 25 : 26,
        amount: -homeImprovementAmount(yearOffset, monthNumber),
        description: buildHomeImprovementDescription(yearOffset, monthNumber),
        accountId:
          monthNumber === 9
            ? FAMILY_ACCOUNT_IDS.RAINY_DAY_SAVINGS
            : FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: FAMILY_CATEGORY_IDS.HOME_IMPROVEMENT,
        companyId:
          monthNumber === 5
            ? FAMILY_COMPANY_IDS.GREENFIELD_LAWN
            : FAMILY_COMPANY_IDS.MAPLE_HARDWARE,
        type: 'expense',
        hour: 15,
        minute: 45,
      });
    }

    if (monthNumber === 6) {
      pushTransaction({
        monthDate,
        day: 8,
        amount: -(486 + yearOffset * 28 + (yearOffset % 2 === 0 ? 54 : 0)),
        description: `Family vacation flights to ${travelDestination}`,
        accountId: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
        categoryId: FAMILY_CATEGORY_IDS.TRAVEL,
        companyId: FAMILY_COMPANY_IDS.SUNTRAIL_AIRLINES,
        type: 'expense',
        hour: 6,
        minute: 20,
      });
      pushTransaction({
        monthDate,
        day: 16,
        amount: -(892 + yearOffset * 44 + (yearOffset % 3 === 1 ? 86 : 0)),
        description: `${travelDestination} family lodging`,
        accountId: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
        categoryId: FAMILY_CATEGORY_IDS.TRAVEL,
        companyId: FAMILY_COMPANY_IDS.HARBOR_DUNES_RESORT,
        type: 'expense',
        hour: 12,
        minute: 50,
      });
    }

    if (monthNumber === 10) {
      pushTransaction({
        monthDate,
        day: 28,
        amount: -(362 + yearOffset * 18 + (monthOffset % 2) * 68),
        description: 'Holiday gifts and winter gear',
        accountId: FAMILY_ACCOUNT_IDS.REWARDS_VISA,
        categoryId: FAMILY_CATEGORY_IDS.SHOPPING,
        companyId: FAMILY_COMPANY_IDS.UPTOWN_OUTFITTERS,
        type: 'expense',
        hour: 20,
        minute: 5,
      });
    }

    if (monthNumber === 11) {
      pushTransaction({
        monthDate,
        day: 12,
        amount: 985 + yearOffset * 72 + (yearOffset === 4 ? 220 : 0),
        description: 'Year-end performance bonus',
        accountId: FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: FAMILY_CATEGORY_IDS.SALARY,
        companyId: FAMILY_COMPANY_IDS.PRIMARY_PAYROLL,
        type: 'income',
        hour: 8,
        minute: 55,
      });
    }
  }

  return entries;
}

function buildTransactionMonthPlan(bucket, targetCount) {
  if (!bucket || targetCount <= 0) {
    return null;
  }

  if (targetCount >= bucket.entries.length) {
    const splitPieceCounts = allocateBoundedCounts(
      targetCount,
      bucket.entries.map((candidate) => ({
        weight: Math.max(Math.abs(candidate.amountCents), 1),
        min: 1,
        max: Math.max(Math.abs(candidate.amountCents), 1),
      }))
    );

    return {
      monthKey: bucket.monthKey,
      monthDate: bucket.monthDate,
      mode: 'split',
      items: bucket.entries.map((entry, index) => ({
        entry,
        pieceCount: splitPieceCounts[index],
      })),
    };
  }

  const incomeEntries = bucket.entries.filter((entry) => entry.type === 'income');
  const expenseEntries = bucket.entries.filter((entry) => entry.type === 'expense');
  const signCounts = allocateSignCounts(
    targetCount,
    incomeEntries,
    expenseEntries
  );

  return {
    monthKey: bucket.monthKey,
    monthDate: bucket.monthDate,
    mode: 'merge',
    groups: [
      ...partitionEntriesIntoGroups(incomeEntries, signCounts.income),
      ...partitionEntriesIntoGroups(expenseEntries, signCounts.expense),
    ].sort((left, right) => left[0].date.localeCompare(right[0].date)),
  };
}

function allocateSignCounts(targetCount, incomeEntries, expenseEntries) {
  if (targetCount <= 0) {
    return { income: 0, expense: 0 };
  }

  if (incomeEntries.length === 0) {
    return { income: 0, expense: Math.min(targetCount, expenseEntries.length) };
  }

  if (expenseEntries.length === 0) {
    return { income: Math.min(targetCount, incomeEntries.length), expense: 0 };
  }

  if (targetCount === 1) {
    const incomeTotal = incomeEntries.reduce(
      (sum, entry) => sum + Math.abs(entry.amountCents),
      0
    );
    const expenseTotal = expenseEntries.reduce(
      (sum, entry) => sum + Math.abs(entry.amountCents),
      0
    );

    return incomeTotal >= expenseTotal
      ? { income: 1, expense: 0 }
      : { income: 0, expense: 1 };
  }

  const [incomeCount, expenseCount] = allocateBoundedCounts(targetCount, [
    {
      weight: incomeEntries.reduce(
        (sum, entry) => sum + Math.abs(entry.amountCents),
        0
      ),
      min: 1,
      max: incomeEntries.length,
    },
    {
      weight: expenseEntries.reduce(
        (sum, entry) => sum + Math.abs(entry.amountCents),
        0
      ),
      min: 1,
      max: expenseEntries.length,
    },
  ]);

  return {
    income: incomeCount,
    expense: expenseCount,
  };
}

function partitionEntriesIntoGroups(entries, groupCount) {
  if (groupCount <= 0 || entries.length === 0) {
    return [];
  }

  if (groupCount >= entries.length) {
    return entries.map((entry) => [entry]);
  }

  const groups = [];

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const startIndex = Math.floor((groupIndex * entries.length) / groupCount);
    const endIndex = Math.floor(
      ((groupIndex + 1) * entries.length) / groupCount
    );
    groups.push(entries.slice(startIndex, endIndex));
  }

  return groups.filter((group) => group.length > 0);
}

function* iterateTransactionRows(plan) {
  let nextId = 1;

  for (const monthPlan of plan.monthlyPlans) {
    if (monthPlan.mode === 'merge') {
      for (let groupIndex = 0; groupIndex < monthPlan.groups.length; groupIndex += 1) {
        const group = monthPlan.groups[groupIndex];

        yield buildMergedTransactionRow(group, nextId, groupIndex + 1);
        nextId += 1;
      }

      continue;
    }

    for (const item of monthPlan.items) {
      for (let pieceIndex = 0; pieceIndex < item.pieceCount; pieceIndex += 1) {
        yield buildSplitTransactionRow(
          item.entry,
          getSplitAmountAtIndex(
            item.entry.amountCents,
            item.pieceCount,
            pieceIndex
          ),
          nextId,
          pieceIndex,
          item.pieceCount,
          plan.config
        );
        nextId += 1;
      }
    }
  }
}

function buildMergedTransactionRow(group, id, variationSeed) {
  const dominantEntry = group.reduce((currentBest, candidate) =>
    !currentBest || Math.abs(candidate.amountCents) > Math.abs(currentBest.amountCents)
      ? candidate
      : currentBest
  , null);
  const amountCents = group.reduce((sum, entry) => sum + entry.amountCents, 0);
  const date = dominantEntry.date;
  const amount = fromCents(amountCents);
  const description =
    group.length === 1
      ? dominantEntry.description
      : dominantEntry.type === 'income'
        ? 'Combined household income activity'
        : 'Combined household expense activity';
  const createdAt = buildTimestamp(date, dominantEntry.hour, dominantEntry.minute);

  return {
    id,
    date,
    amount,
    description,
    account_id: dominantEntry.accountId,
    card_id: getCardIdForAccount(dominantEntry.accountId),
    category_id: dominantEntry.categoryId,
    company_id: dominantEntry.companyId,
    project_id: null,
    trip_id: null,
    type: dominantEntry.type,
    transaction_hash: buildTransactionHash(
      dominantEntry.accountId,
      date,
      amount,
      description,
      variationSeed
    ),
    hash_variation_seed: variationSeed,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function buildSplitTransactionRow(
  entry,
  amountCents,
  id,
  pieceIndex,
  pieceCount,
  config
) {
  const date = buildSplitTransactionDate(entry, pieceIndex, pieceCount, config);
  const minute = (entry.minute + pieceIndex) % 60;
  const amount = fromCents(amountCents);
  const createdAt = buildTimestamp(date, entry.hour, minute);
  const variationSeed = pieceCount === 1 ? 0 : pieceIndex + 1;

  return {
    id,
    date,
    amount,
    description: entry.description,
    account_id: entry.accountId,
    card_id: getCardIdForAccount(entry.accountId),
    category_id: entry.categoryId,
    company_id: entry.companyId,
    project_id: null,
    trip_id: null,
    type: entry.type,
    transaction_hash: buildTransactionHash(
      entry.accountId,
      date,
      amount,
      entry.description,
      variationSeed
    ),
    hash_variation_seed: variationSeed,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function getSplitAmountAtIndex(amountCents, pieceCount, pieceIndex) {
  const absoluteCents = Math.abs(amountCents);
  const clampedPieceCount = Math.max(1, Math.min(pieceCount, absoluteCents));
  const baseAmount = Math.floor(absoluteCents / clampedPieceCount);
  const remainder = absoluteCents % clampedPieceCount;
  const sign = amountCents < 0 ? -1 : 1;

  if (pieceIndex < 0 || pieceIndex >= clampedPieceCount) {
    throw new RangeError(
      `Split amount piece index ${pieceIndex} is outside the generated range of ${clampedPieceCount}.`
    );
  }

  return sign * (baseAmount + (pieceIndex < remainder ? 1 : 0));
}

function buildSplitTransactionDate(entry, pieceIndex, pieceCount, config) {
  if (pieceCount <= 1) {
    return entry.date;
  }

  const monthStartDay =
    isSameMonth(entry.monthDate, config.startDate) ? config.startDate.getUTCDate() : 1;
  const monthEndDay =
    isSameMonth(entry.monthDate, config.referenceDate)
      ? config.referenceDate.getUTCDate()
      : getDaysInMonth(entry.monthDate);
  const preferredStart = Math.max(monthStartDay, entry.day - 2);
  const preferredEnd = Math.min(monthEndDay, entry.day + 2);
  const cycleLength = Math.max(preferredEnd - preferredStart + 1, 1);
  const day = preferredStart + (pieceIndex % cycleLength);

  return buildMonthDateString(entry.monthDate, day);
}

function buildTransactionFixtureMeta(mode, plan) {
  return {
    generationMode: mode,
    referenceDate: formatDate(plan.config.referenceDate),
    startDate: formatDate(plan.config.startDate),
    endDate: formatDate(plan.config.referenceDate),
    monthsBack: plan.config.monthsBack,
    requestedTransactionCount: plan.requestedTransactionCount,
    actualTransactionCount: plan.actualTransactionCount,
    baselineTransactionCount: plan.baselineTransactionCount,
    totalTransactionCapacity: plan.totalCapacity,
    seed: plan.config.seed,
  };
}

function allocateBoundedCounts(total, buckets) {
  const counts = new Array(buckets.length).fill(0);

  if (total <= 0 || buckets.length === 0) {
    return counts;
  }

  let remaining = total;
  const useMins = total >= buckets.reduce(
    (sum, bucket) => sum + (bucket.max > 0 ? bucket.min ?? 0 : 0),
    0
  );

  if (useMins) {
    for (let index = 0; index < buckets.length; index += 1) {
      const minCount = Math.min(buckets[index].min ?? 0, buckets[index].max);
      counts[index] = minCount;
      remaining -= minCount;
    }
  }

  while (remaining > 0) {
    const candidates = buckets
      .map((bucket, index) => ({
        index,
        weight: Math.max(bucket.weight ?? 1, 1),
        capacity: bucket.max - counts[index],
      }))
      .filter((candidate) => candidate.capacity > 0);

    if (candidates.length === 0) {
      break;
    }

    const weightSum = candidates.reduce(
      (sum, candidate) => sum + candidate.weight,
      0
    );
    let assignedThisRound = 0;
    const fractions = [];

    for (const candidate of candidates) {
      const rawShare = (remaining * candidate.weight) / weightSum;
      const wholeShare = Math.min(candidate.capacity, Math.floor(rawShare));

      if (wholeShare > 0) {
        counts[candidate.index] += wholeShare;
        assignedThisRound += wholeShare;
      }

      fractions.push({
        index: candidate.index,
        fraction: rawShare - Math.floor(rawShare),
      });
    }

    remaining -= assignedThisRound;

    if (remaining <= 0) {
      break;
    }

    const fallbackOrder = fractions
      .sort((left, right) => right.fraction - left.fraction)
      .map((candidate) => candidate.index);

    if (assignedThisRound === 0) {
      for (const index of fallbackOrder) {
        if (remaining <= 0) {
          break;
        }

        if (counts[index] >= buckets[index].max) {
          continue;
        }

        counts[index] += 1;
        remaining -= 1;
      }
    }
  }

  return counts;
}

function buildMonthDateString(monthDate, day) {
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month, Math.min(day, daysInMonth)));
  return date.toISOString().slice(0, 10);
}

function buildTimestamp(dateString, hour, minute) {
  return `${dateString}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

// Mirrors public/database-hash.js (schema hash version 2): SHA-256 hex over
// "<accountId>-<date>-<amount>-<description>[-seed<n>]". Fixtures generated
// here therefore dedupe against a real CSV import of the same rows.
function buildTransactionHash(accountId, date, amount, description, variationSeed = 0) {
  const base = `${accountId}-${date}-${amount}-${description}`;
  const input = variationSeed > 0 ? `${base}-seed${variationSeed}` : base;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function normalizeReferenceDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid referenceDate: ${String(value)}`);
  }

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function parsePositiveInteger(value, label) {
  const parsedValue = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsedValue;
}

function normalizeSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(Math.trunc(value)) || 1;
  }

  const text = String(value);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash || 1;
}

function subtractUtcMonths(date, months) {
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() - months;
  const targetDay = date.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(targetYear, targetMonth, 1));
  const daysInTargetMonth = getDaysInMonth(targetMonthStart);

  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(targetDay, daysInTargetMonth)
    )
  );
}

function firstDayOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function diffCalendarMonths(startDate, endDate) {
  return (
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth())
  );
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

function getDaysInMonth(monthDate) {
  return new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)
  ).getUTCDate();
}

function isSameMonth(leftDate, rightDate) {
  return (
    leftDate.getUTCFullYear() === rightDate.getUTCFullYear() &&
    leftDate.getUTCMonth() === rightDate.getUTCMonth()
  );
}

function toCents(value) {
  return Math.round(roundCurrency(value) * 100);
}

function fromCents(value) {
  return roundCurrency(value / 100);
}

function indentMultilineJson(json, spaces) {
  const indent = ' '.repeat(spaces);
  return json.replace(/\n/g, `\n${indent}`);
}

function estimateAverageTransactionRowBytes(plan, sampleRowCount) {
  if (plan.actualTransactionCount <= 0) {
    return 2;
  }

  let totalBytes = 0;
  let count = 0;

  for (const row of iterateTransactionRows(plan)) {
    totalBytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
    count += 1;

    if (count >= sampleRowCount) {
      break;
    }
  }

  return count > 0 ? totalBytes / count : 2;
}

function estimateTransactionEnvelopeBytes({
  rowCount,
  averageRowBytes,
  meta,
  includeMeta,
}) {
  let totalBytes = Buffer.byteLength('{\n', 'utf8');
  totalBytes += Buffer.byteLength('  "table": "transactions",\n', 'utf8');

  if (includeMeta) {
    totalBytes += Buffer.byteLength(
      `  "meta": ${indentMultilineJson(JSON.stringify(meta, null, 2), 2)},\n`,
      'utf8'
    );
  }

  totalBytes += Buffer.byteLength('  "data": [\n', 'utf8');

  if (rowCount > 0) {
    totalBytes += 4 + Math.round(averageRowBytes);
    totalBytes += (rowCount - 1) * (6 + Math.round(averageRowBytes));
    totalBytes += Buffer.byteLength('\n', 'utf8');
  }

  totalBytes += Buffer.byteLength('  ]\n', 'utf8');
  totalBytes += Buffer.byteLength('}\n', 'utf8');

  return totalBytes;
}

function buildChunkRowCounts(totalRowCount, maxRowsPerFile) {
  if (totalRowCount <= 0) {
    return [];
  }

  const chunkRowCounts = [];
  let remainingRows = totalRowCount;

  while (remainingRows > 0) {
    const rowCount = Math.min(remainingRows, maxRowsPerFile);
    chunkRowCounts.push(rowCount);
    remainingRows -= rowCount;
  }

  return chunkRowCounts;
}

function isChunkedTransactionFixtureEnvelope(envelope) {
  return (
    envelope?.table === 'transactions' &&
    Array.isArray(envelope?.dataFiles) &&
    envelope.dataFiles.length > 0
  );
}

async function assertTransactionChunkFilesExist(absoluteOutputDir, envelope) {
  for (const dataFile of envelope.dataFiles) {
    if (!dataFile || typeof dataFile.file !== 'string' || dataFile.file.length === 0) {
      throw new Error('Chunked transaction manifest contains an invalid file entry.');
    }

    await fs.access(path.join(absoluteOutputDir, dataFile.file));
  }
}

function validateChunkedTransactionManifest(tableName, envelope, issues, warnings) {
  const invalidChunk = envelope.dataFiles.find(
    (dataFile) =>
      !dataFile ||
      typeof dataFile.file !== 'string' ||
      dataFile.file.length === 0 ||
      (dataFile.rowCount !== undefined &&
        (!Number.isInteger(dataFile.rowCount) || dataFile.rowCount < 0))
  );

  if (invalidChunk) {
    issues.push({
      code: 'invalid-chunk-manifest',
      tableName,
      message: 'Chunked transaction manifest contains an invalid chunk entry.',
    });
    return;
  }

  const totalChunkRows = envelope.dataFiles.reduce(
    (sum, dataFile) => sum + (dataFile.rowCount ?? 0),
    0
  );

  if (
    envelope.meta?.actualTransactionCount !== undefined &&
    totalChunkRows > 0 &&
    totalChunkRows !== envelope.meta.actualTransactionCount
  ) {
    issues.push({
      code: 'chunk-count-mismatch',
      tableName,
      message: `Chunk manifest row counts sum to ${totalChunkRows.toLocaleString()} but meta.actualTransactionCount is ${envelope.meta.actualTransactionCount.toLocaleString()}.`,
    });
  }

  warnings.push({
    code: 'chunked-transaction-validation-skipped',
    tableName,
    message:
      'Transaction fixture is chunked; row-level schema and foreign-key validation is skipped to avoid loading the entire dataset into memory.',
  });
}

async function removeExistingTransactionChunkFiles(absoluteOutputDir) {
  let entries = [];

  try {
    entries = await fs.readdir(absoluteOutputDir, { withFileTypes: true });
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
      throw error;
    }

    return;
  }

  await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && TRANSACTION_CHUNK_FILE_PATTERN.test(entry.name)
      )
      .map((entry) => fs.rm(path.join(absoluteOutputDir, entry.name), { force: true }))
  );
}

async function writeTransactionChunkFiles(
  absoluteOutputDir,
  plan,
  maxRowsPerFile
) {
  const dataFiles = [];
  let writer = null;

  for (const row of iterateTransactionRows(plan)) {
    if (!writer || writer.rowCount >= maxRowsPerFile) {
      if (writer) {
        dataFiles.push(await closeTransactionChunkWriter(writer));
      }

      writer = await openTransactionChunkWriter(
        absoluteOutputDir,
        dataFiles.length + 1
      );
    }

    await writeTransactionChunkRow(writer, row);
  }

  if (writer) {
    dataFiles.push(await closeTransactionChunkWriter(writer));
  }

  return dataFiles;
}

async function openTransactionChunkWriter(absoluteOutputDir, chunkIndex) {
  const fileName = createTransactionChunkFileName(chunkIndex);
  const stream = createWriteStream(path.join(absoluteOutputDir, fileName), {
    encoding: 'utf8',
  });

  await writeToStream(stream, '{\n');
  await writeToStream(stream, '  "table": "transactions",\n');
  await writeToStream(stream, '  "data": [\n');

  return {
    fileName,
    stream,
    rowCount: 0,
    isFirstRow: true,
  };
}

async function writeTransactionChunkRow(writer, row) {
  await writeToStream(
    writer.stream,
    `${writer.isFirstRow ? '' : ',\n'}    ${JSON.stringify(row)}`
  );
  writer.isFirstRow = false;
  writer.rowCount += 1;
}

async function closeTransactionChunkWriter(writer) {
  if (!writer.isFirstRow) {
    await writeToStream(writer.stream, '\n');
  }

  await writeToStream(writer.stream, '  ]\n');
  await writeToStream(writer.stream, '}\n');
  writer.stream.end();

  await waitForWritableStream(writer.stream);

  return {
    file: writer.fileName,
    rowCount: writer.rowCount,
  };
}

function createTransactionChunkFileName(chunkIndex) {
  return `transactions.part-${String(chunkIndex).padStart(6, '0')}.json`;
}

function waitForWritableStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function waitForStreamDrain(stream) {
  return new Promise((resolve, reject) => {
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off('drain', handleDrain);
      stream.off('error', handleError);
    };

    stream.once('drain', handleDrain);
    stream.once('error', handleError);
  });
}

async function writeToStream(stream, chunk) {
  if (stream.write(chunk)) {
    return;
  }

  await waitForStreamDrain(stream);
}

function seasonalGroceriesAdjustment(monthNumber) {
  if (monthNumber === 10 || monthNumber === 11) {
    return 58;
  }

  if (monthNumber >= 5 && monthNumber <= 7) {
    return 34;
  }

  return 0;
}

function seasonalUtilitiesAdjustment(monthNumber) {
  if (monthNumber === 11 || monthNumber <= 1) {
    return 72;
  }

  if (monthNumber >= 5 && monthNumber <= 7) {
    return 55;
  }

  return 18;
}

function transportationAdjustment(monthNumber) {
  if (monthNumber >= 8 && monthNumber <= 10) {
    return 28;
  }

  if (monthNumber >= 5 && monthNumber <= 7) {
    return 16;
  }

  return 0;
}

function schoolAndActivityAmount(yearOffset, monthNumber, monthOffset) {
  if (monthNumber >= 5 && monthNumber <= 6) {
    return roundCurrency(648 + yearOffset * 24 + (monthOffset % 2) * 42);
  }

  if (monthNumber === 7) {
    return roundCurrency(418 + yearOffset * 18 + (monthOffset % 3) * 28);
  }

  if (monthNumber >= 8 && monthNumber <= 10) {
    return roundCurrency(332 + yearOffset * 16 + (monthOffset % 3) * 22);
  }

  if (monthNumber === 4) {
    return roundCurrency(286 + yearOffset * 14 + (monthOffset % 2) * 18);
  }

  return roundCurrency(244 + yearOffset * 12 + (monthOffset % 2) * 16);
}

function buildSchoolExpenseDescription(monthNumber, monthOffset) {
  if (monthNumber >= 5 && monthNumber <= 6) {
    return monthOffset % 2 === 0
      ? 'Summer camp tuition and activity fees'
      : 'Day camp and swim lessons';
  }

  if (monthNumber === 7) {
    return 'Back-to-school supplies and registration fees';
  }

  if (monthNumber >= 8 && monthNumber <= 10) {
    return monthNumber === 9
      ? 'Fall sports dues and school activity fees'
      : 'After-school care and activity fees';
  }

  if (monthNumber === 4) {
    return 'Spring field trips and soccer registration';
  }

  return 'After-school care and classroom extras';
}

function schoolExpenseCompanyId(monthNumber) {
  if (monthNumber >= 5 && monthNumber <= 6) {
    return FAMILY_COMPANY_IDS.LITTLE_OAKS_LEARNING;
  }

  if (monthNumber === 4 || monthNumber === 9) {
    return FAMILY_COMPANY_IDS.COMMUNITY_SOCCER_CLUB;
  }

  return FAMILY_COMPANY_IDS.RIVER_COUNTY_SCHOOLS;
}

function healthcareAmount(yearOffset, monthNumber) {
  if (monthNumber === 0) {
    return roundCurrency(126 + yearOffset * 7);
  }

  if (monthNumber === 3) {
    return roundCurrency(214 + yearOffset * 11);
  }

  return roundCurrency(94 + yearOffset * 6);
}

function buildHealthcareDescription(monthNumber) {
  if (monthNumber === 0) {
    return 'Winter pediatric visit and prescriptions';
  }

  if (monthNumber === 3) {
    return 'Spring dental visits and pharmacy refill';
  }

  return 'Back-to-school physical and prescriptions';
}

function buildSideIncomeDescription(monthNumber) {
  return monthNumber === 11
    ? 'Holiday portrait side gig deposit'
    : [
        'Weekend consulting retainer',
        'Neighborhood tutoring invoice',
        'Freelance design project deposit',
      ][monthNumber % 3];
}

function homeImprovementAmount(yearOffset, monthNumber) {
  if (monthNumber === 3) {
    return roundCurrency(212 + yearOffset * 12 + (yearOffset % 2 === 0 ? 160 : 0));
  }

  if (monthNumber === 5) {
    return roundCurrency(338 + yearOffset * 15 + (yearOffset === 2 ? 620 : 0));
  }

  return roundCurrency(286 + yearOffset * 14 + (yearOffset === 4 ? 1180 : 0));
}

function buildHomeImprovementDescription(yearOffset, monthNumber) {
  if (monthNumber === 3) {
    return [
      'Spring fence repair and garden supplies',
      'Patio repair materials and mulch',
      'Driveway patch and garden supplies',
      'Garage shelving and tool refresh',
      'Spring landscaping materials',
    ][yearOffset % 5];
  }

  if (monthNumber === 5) {
    return [
      'Deck stain and yard cleanup',
      'Backyard playset maintenance',
      'Bathroom fixture refresh',
      'Outdoor seating and garden updates',
      'Summer landscaping and irrigation parts',
    ][yearOffset % 5];
  }

  return [
    'Fall gutter cleaning and weatherproofing',
    'Furnace tune-up and filter replacement',
    'Window weatherproofing materials',
    'Roof leak repair materials',
    'Water heater replacement deposit',
  ][yearOffset % 5];
}

function roundCurrency(value) {
  return Number(value.toFixed(2));
}

function normalizeRowForTable(schemaTable, baseRow, rowIndex, context) {
  const row = {};

  for (const column of schemaTable.columns) {
    const { columnName } = column;

    if (Object.prototype.hasOwnProperty.call(baseRow, columnName)) {
      row[columnName] = baseRow[columnName];
      continue;
    }

    row[columnName] = createFallbackValue(schemaTable, column, rowIndex, context);
  }

  return row;
}

function createFallbackValue(schemaTable, column, rowIndex, context) {
  const { columnName, definition, enumValues } = column;
  const foreignKey = schemaTable.foreignKeys.find(
    (candidate) => candidate.columnName === columnName
  );

  if (columnName === 'id') {
    return rowIndex + 1;
  }

  if (columnName === 'created_at' || columnName === 'updated_at') {
    return offsetTimestamp(rowIndex);
  }

  if (columnName.endsWith('_date') || columnName === 'date') {
    return offsetDate(rowIndex);
  }

  if (columnName === 'comment') {
    return null;
  }

  if (foreignKey) {
    return pickForeignKeyValue(foreignKey.referencedTable, rowIndex, context);
  }

  if (enumValues.length > 0) {
    return enumValues[rowIndex % enumValues.length];
  }

  if (/REAL|INTEGER/i.test(definition)) {
    return 0;
  }

  if (columnName === 'color') {
    return COLOR_PALETTE[rowIndex % COLOR_PALETTE.length];
  }

  if (columnName === 'last_four') {
    return String(1000 + rowIndex).padStart(4, '0');
  }

  // Optional; most generated cards don't need a full number, only ones
  // deliberately crafted to disambiguate a shared last_four do.
  if (columnName === 'full_number') {
    return null;
  }

  if (columnName.includes('display_name')) {
    return `Generated User ${rowIndex + 1}`;
  }

  if (columnName.includes('name')) {
    return `${toTitleCase(schemaTable.tableName)} ${rowIndex + 1}`;
  }

  if (
    columnName.includes('description') ||
    columnName.includes('purpose') ||
    columnName.includes('notes') ||
    columnName.includes('contact')
  ) {
    return `Generated ${schemaTable.tableName} ${rowIndex + 1}`;
  }

  if (/TEXT/i.test(definition) && column.required) {
    return `${schemaTable.tableName}-${columnName}-${rowIndex + 1}`;
  }

  return null;
}

function pickForeignKeyValue(referencedTable, rowIndex, context) {
  const ids = context.idsByTable.get(referencedTable) ?? [];

  if (ids.length === 0) {
    return null;
  }

  return ids[rowIndex % ids.length];
}

function validateRowsForSchema(schemaTable, rows, issues) {
  const schemaColumnNames = new Set(
    schemaTable.columns.map((column) => column.columnName)
  );

  rows.forEach((row, rowIndex) => {
    if (!row || typeof row !== 'object') {
      issues.push({
        code: 'invalid-row',
        tableName: schemaTable.tableName,
        message: `Row ${rowIndex + 1} is not an object.`,
      });
      return;
    }

    if (typeof row.id !== 'number') {
      issues.push({
        code: 'missing-id',
        tableName: schemaTable.tableName,
        message: `Row ${rowIndex + 1} is missing a numeric id.`,
      });
    }

    const extraFields = Object.keys(row).filter(
      (fieldName) => !schemaColumnNames.has(fieldName)
    );

    if (extraFields.length > 0) {
      issues.push({
        code: 'extra-fields',
        tableName: schemaTable.tableName,
        message: `Row ${rowIndex + 1} has fields not found in schema: ${extraFields.join(', ')}.`,
      });
    }

    const missingRequiredFields = schemaTable.columns
      .filter((column) => column.required)
      .map((column) => column.columnName)
      .filter((columnName) => row[columnName] === undefined || row[columnName] === null);

    if (missingRequiredFields.length > 0) {
      issues.push({
        code: 'missing-required-fields',
        tableName: schemaTable.tableName,
        message: `Row ${rowIndex + 1} is missing required fields: ${missingRequiredFields.join(', ')}.`,
      });
    }
  });
}

function validateForeignKeys(schemaTable, rows, allFixtureIds, issues) {
  rows.forEach((row, rowIndex) => {
    schemaTable.foreignKeys.forEach((foreignKey) => {
      const referencedIds = allFixtureIds.get(foreignKey.referencedTable);
      const value = row[foreignKey.columnName];

      if (value === null || value === undefined) {
        return;
      }

      if (!referencedIds || !referencedIds.has(value)) {
        issues.push({
          code: 'invalid-foreign-key',
          tableName: schemaTable.tableName,
          message: `Row ${rowIndex + 1} references ${foreignKey.referencedTable}.${foreignKey.referencedColumn}=${value}, but that id is not present in fixtures.`,
        });
      }
    });
  });
}

function isRequiredColumn(columnName, definition) {
  if (/\bPRIMARY KEY\b/i.test(definition) && /AUTOINCREMENT/i.test(definition)) {
    return false;
  }

  if (columnName === 'id') {
    return false;
  }

  return /\bNOT NULL\b/i.test(definition) && !/\bDEFAULT\b/i.test(definition);
}

function extractEnumValues(definition) {
  const checkInMatch = definition.match(CHECK_IN_PATTERN);

  if (!checkInMatch) {
    return [];
  }

  return checkInMatch[1]
    .split(',')
    .map((value) => value.trim().replace(/^'/, '').replace(/'$/, ''));
}

function offsetTimestamp(offsetDays) {
  const date = new Date(BASE_TIMESTAMP);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString();
}

function offsetDate(offsetDays) {
  const date = new Date(`${BASE_DATE}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function toTitleCase(value) {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function getCardIdForAccount(accountId) {
  switch (accountId) {
    case FAMILY_ACCOUNT_IDS.HOUSEHOLD_CHECKING:
      return FAMILY_ACCOUNT_CARD_IDS.HOUSEHOLD_CHECKING;
    case FAMILY_ACCOUNT_IDS.RAINY_DAY_SAVINGS:
      return FAMILY_ACCOUNT_CARD_IDS.RAINY_DAY_SAVINGS;
    case FAMILY_ACCOUNT_IDS.REWARDS_VISA:
      return FAMILY_ACCOUNT_CARD_IDS.REWARDS_VISA;
    case FAMILY_ACCOUNT_IDS.HOUSEHOLD_JOINT:
      return FAMILY_ACCOUNT_CARD_IDS.HOUSEHOLD_JOINT;
    default:
      return null;
  }
}