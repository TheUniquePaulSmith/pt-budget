import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildHouseholdScenario,
  buildHouseholdTransactionEntries,
  buildSampleDataExpectations as buildHouseholdExpectations,
  getCardIdForAccount,
  getHouseholdBaseRows,
} from './sample-data-household.mjs';

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
// null = "natural": one row per scheduled household event, no splitting or
// merging. The validation layers only accept natural fixtures.
const DEFAULT_TRANSACTION_TARGET_COUNT = null;
// Row count the pre-household generator produced for its 60-month default;
// still the basis of estimateDefaultTransactionCount() for perf-style requests.
const LEGACY_TRANSACTION_TARGET_COUNT = 585;
export const MAX_IN_MEMORY_TRANSACTION_COUNT = 250000;
export const MAX_TRANSACTION_ROWS_PER_FILE = 1000000;
const TRANSACTION_CHUNK_FILE_PATTERN = /^transactions\.part-\d+\.json$/;

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
  'loans',
  'loan_match_rules',
  'classification_rules',
  'account_balance_snapshots',
  'transactions',
];
/** File next to the fixtures that records what the app should show for them. */
export const EXPECTATIONS_FILE_NAME = 'expectations.json';
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
      (LEGACY_TRANSACTION_TARGET_COUNT / DEFAULT_TRANSACTION_MONTHS_BACK) *
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
  const rawTargetCount =
    options.targetTransactionCount ??
    options.amount ??
    DEFAULT_TRANSACTION_GENERATION.targetTransactionCount;
  // null / 'natural' keeps every baseline row (see DEFAULT_TRANSACTION_TARGET_COUNT).
  const targetTransactionCount =
    rawTargetCount === null || rawTargetCount === undefined || rawTargetCount === 'natural'
      ? null
      : parsePositiveInteger(rawTargetCount, 'targetTransactionCount');
  const startDate = subtractUtcMonths(referenceDate, monthsBack);
  const seed = normalizeSeed(
    options.seed ??
      `${formatDate(referenceDate)}:${monthsBack}:${targetTransactionCount ?? 'natural'}`
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
  return buildSampleDataBundle(schemaTables, runtimeCompatibility, options).fixtureEnvelopes;
}

/**
 * Builds every fixture envelope plus the expectations manifest that describes
 * them. `fixtureEnvelopes` is what buildFixtureEnvelopes() returns;
 * `expectations` is written to EXPECTATIONS_FILE_NAME next to the fixtures.
 */
export function buildSampleDataBundle(
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
  const scenario = buildHouseholdScenario(transactionGeneration);
  const context = {
    activeTables: new Set(tableNames),
    idsByTable: new Map(),
    transactionGeneration,
    scenario,
  };
  let transactionBundle = null;

  const fixtureEnvelopes = tableNames.map((tableName) => {
    const schemaTable = schemaIndex.get(tableName);

    if (!schemaTable) {
      throw new Error(`Cannot generate data for unknown schema table: ${tableName}`);
    }

    if (tableName === 'transactions') {
      transactionBundle = buildTransactionFixtureBundle(
        mode,
        context.transactionGeneration,
        scenario
      );
      const transactionEnvelope = transactionBundle.envelope;
      const rows = transactionEnvelope.data.map((baseRow, rowIndex) =>
        normalizeRowForTable(schemaTable, baseRow, rowIndex, context)
      );
      transactionBundle.rowsWithEntries = transactionBundle.rowsWithEntries.map((item, index) => ({
        ...item,
        row: rows[index],
      }));

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

  const expectations = buildSampleDataExpectations({
    scenario,
    transactionBundle,
    mode,
  });

  return { fixtureEnvelopes, expectations, scenario, transactionGeneration };
}

/**
 * The expectations manifest for a generated set. Natural mode gets the full
 * manifest (per-month totals, transfer pairs, loan payments, series, ...);
 * split / merge mode only records that the manifest does not apply.
 */
export function buildSampleDataExpectations({ scenario, transactionBundle, mode }) {
  const meta = transactionBundle?.envelope?.meta ?? null;

  if (!transactionBundle || !transactionBundle.plan.natural) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      natural: false,
      generationMode: mode,
      reason: transactionBundle
        ? 'Fixtures were generated with a target transaction count (split / merge mode); per-row expectations only hold for natural fixtures. Regenerate without --count to validate.'
        : 'Transactions were not generated in memory (streaming mode), so no expectations were derived.',
      window: {
        referenceDate: scenario.rangeEnd,
        startDate: scenario.rangeStart,
        monthsBack: scenario.config.monthsBack,
        seed: scenario.config.seed,
      },
    };
  }

  return {
    ...buildHouseholdExpectations({
      rowsWithEntries: transactionBundle.rowsWithEntries,
      scenario,
      meta,
    }),
    generationMode: mode,
  };
}

export async function writeExpectationsFile(
  repoRoot,
  expectations,
  outputDir = DEFAULT_SAMPLE_DATA_DIR
) {
  const absoluteOutputDir = path.join(repoRoot, outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const outputPath = path.join(absoluteOutputDir, EXPECTATIONS_FILE_NAME);
  await fs.writeFile(outputPath, `${JSON.stringify(expectations, null, 2)}\n`, 'utf8');
  return path.join(outputDir, EXPECTATIONS_FILE_NAME);
}

export async function readExpectationsFile(repoRoot, outputDir = DEFAULT_SAMPLE_DATA_DIR) {
  const content = await fs.readFile(path.join(repoRoot, outputDir, EXPECTATIONS_FILE_NAME), 'utf8');
  return JSON.parse(content);
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
  const householdRows = getHouseholdBaseRows(tableName, context.scenario);

  if (householdRows) {
    return householdRows;
  }

  return Array.from({ length: 2 }, (_, index) => ({ id: index + 1 }));
}

function buildTransactionFixtureBundle(mode, transactionGenerationOptions, scenario = null) {
  const plan = buildTransactionGenerationPlan(transactionGenerationOptions, scenario);

  if (plan.actualTransactionCount > MAX_IN_MEMORY_TRANSACTION_COUNT) {
    throw new Error(
      `Requested ${plan.actualTransactionCount.toLocaleString()} transactions exceeds the in-memory fixture limit of ${MAX_IN_MEMORY_TRANSACTION_COUNT.toLocaleString()}. Use writeTransactionFixtureEnvelope() for large transaction sets.`
    );
  }

  const rowsWithEntries = Array.from(iterateTransactionRowsWithEntries(plan));

  return {
    plan,
    rowsWithEntries,
    envelope: {
      table: 'transactions',
      data: rowsWithEntries.map(({ row }) => row),
      meta: buildTransactionFixtureMeta(mode, plan),
    },
  };
}

/**
 * Resolves the window, builds the household scenario for it and decides how
 * many rows each month gets. Without a target count ("natural" mode) every
 * month keeps exactly its baseline rows, which is what the validation layers
 * require; with one, months are split or merged to land near the target.
 */
function buildTransactionGenerationPlan(transactionGenerationOptions, scenario = null) {
  const config = resolveTransactionGenerationOptions(transactionGenerationOptions);
  const resolvedScenario = scenario ?? buildHouseholdScenario(config);
  const monthlyBuckets = buildMonthlyTransactionBuckets(resolvedScenario);
  const baselineTransactionCount = monthlyBuckets.reduce(
    (sum, bucket) => sum + bucket.entries.length,
    0
  );
  const totalCapacity = monthlyBuckets.reduce(
    (sum, bucket) => sum + bucket.maxTransactionCount,
    0
  );
  const natural = config.targetTransactionCount === null;
  const requestedTransactionCount = natural
    ? baselineTransactionCount
    : config.targetTransactionCount;
  const actualTransactionCount = Math.max(
    0,
    Math.min(requestedTransactionCount, totalCapacity)
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
    scenario: resolvedScenario,
    natural,
    baselineTransactionCount,
    totalCapacity,
    requestedTransactionCount,
    actualTransactionCount,
    monthlyPlans: monthlyBuckets
      .map((bucket, index) =>
        buildTransactionMonthPlan(bucket, monthlyTargetCounts[index])
      )
      .filter(Boolean),
  };
}

function buildMonthlyTransactionBuckets(scenario) {
  const entries = buildHouseholdTransactionEntries(scenario);
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
  for (const { row } of iterateTransactionRowsWithEntries(plan)) {
    yield row;
  }
}

/**
 * Yields every generated row with the baseline entry it came from. Rows are
 * emitted newest month first so that `?sampleDataTransactionLimit=N` (which
 * keeps the first N rows of the file) always keeps the most recent months.
 * Ids still ascend in emission order.
 */
function* iterateTransactionRowsWithEntries(plan) {
  let nextId = 1;

  for (let monthIndex = plan.monthlyPlans.length - 1; monthIndex >= 0; monthIndex -= 1) {
    const monthPlan = plan.monthlyPlans[monthIndex];

    if (monthPlan.mode === 'merge') {
      for (let groupIndex = monthPlan.groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
        const group = monthPlan.groups[groupIndex];
        const row = buildMergedTransactionRow(group, nextId, groupIndex + 1);
        nextId += 1;
        yield { row, entry: mergedEntryFor(group, row) };
      }

      continue;
    }

    for (let itemIndex = monthPlan.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = monthPlan.items[itemIndex];
      for (let pieceIndex = item.pieceCount - 1; pieceIndex >= 0; pieceIndex -= 1) {
        const row = buildSplitTransactionRow(
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
        yield { row, entry: item.entry };
      }
    }
  }
}

// A merged row stands for several baseline entries; its "entry" view keeps
// only what the manifest can still say about it (sign type, no transfer /
// loan / series expectations).
function mergedEntryFor(group, row) {
  return {
    expectedType: row.type,
    transferKey: null,
    loanId: null,
    recurringKey: null,
    merged: group.length,
  };
}

// Rows are emitted the way a bank export arrives: typed by sign, nothing
// paired, flagged or excluded. The app's scans fill these in after import.
const RAW_IMPORT_CLASSIFICATION_COLUMNS = Object.freeze({
  external_id: null,
  transfer_group_id: null,
  type_locked: 0,
  type_source: 'sign',
  type_confidence: null,
  is_excluded: 0,
  is_flagged: 0,
  import_batch_id: null,
});

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
    comment: null,
    account_id: dominantEntry.accountId,
    card_id: dominantEntry.cardId ?? getCardIdForAccount(dominantEntry.accountId),
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
    ...RAW_IMPORT_CLASSIFICATION_COLUMNS,
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
    comment: entry.comment ?? null,
    account_id: entry.accountId,
    card_id: entry.cardId === undefined ? getCardIdForAccount(entry.accountId) : entry.cardId,
    category_id: entry.categoryId,
    company_id: entry.companyId,
    project_id: entry.projectId ?? null,
    trip_id: entry.tripId ?? null,
    type: entry.type,
    transaction_hash: buildTransactionHash(
      entry.accountId,
      date,
      amount,
      entry.description,
      variationSeed
    ),
    hash_variation_seed: variationSeed,
    ...RAW_IMPORT_CLASSIFICATION_COLUMNS,
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
    // natural: one row per household event, nothing split or merged (what the
    // expectations manifest and the validation layers require).
    natural: plan.natural,
    // Newest month first, so a row cap keeps the most recent data.
    rowOrder: 'newest-first',
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



function formatDate(date) {
  return date.toISOString().slice(0, 10);
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
