import { createInterface } from 'node:readline/promises';

import {
  DEFAULT_TRANSACTION_GENERATION,
  MANAGED_SAMPLE_TABLES,
  MAX_IN_MEMORY_TRANSACTION_COUNT,
  SAMPLE_DATA_GENERATION_MODES,
  buildFixtureEnvelopes,
  estimateTransactionFixtureOutput,
  estimateDefaultTransactionCount,
  getGenerationTableNames,
  loadSampleDataContext,
  resolveTransactionGenerationOptions,
  writeTransactionFixtureEnvelope,
  writeFixtureEnvelopes,
} from './lib/sample-data-tools.mjs';

const repoRoot = process.cwd();
const cliOptions = parseCliOptions(process.argv.slice(2));
const mode = cliOptions.fullSchema
  ? SAMPLE_DATA_GENERATION_MODES.FULL_SCHEMA
  : SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;
const promptAnswers = await resolvePromptedGenerationOptions(cliOptions);
const transactionGeneration = resolveTransactionGenerationOptions({
  referenceDate: new Date(),
  monthsBack: promptAnswers.monthsBack,
  targetTransactionCount: promptAnswers.targetTransactionCount,
});

const context = await loadSampleDataContext(repoRoot);
const tableNames = getGenerationTableNames(context.runtimeCompatibility, mode);
const includesTransactions = tableNames.includes('transactions');
const shouldStreamTransactions =
  includesTransactions &&
  transactionGeneration.targetTransactionCount > MAX_IN_MEMORY_TRANSACTION_COUNT;
const staticTableNames = shouldStreamTransactions || cliOptions.dryRun
  ? tableNames.filter((tableName) => tableName !== 'transactions')
  : tableNames;
const fixtureEnvelopes = buildFixtureEnvelopes(
  context.schemaTables,
  context.runtimeCompatibility,
  {
    mode,
    tableNames: staticTableNames,
    transactionGeneration,
  }
);
const transactionEstimate = includesTransactions
  ? estimateTransactionFixtureOutput({
      mode,
      transactionGeneration,
    })
  : null;
const staticFixtureSummaries = fixtureEnvelopes.map((fixtureEnvelope) => ({
  table: fixtureEnvelope.table,
  rowCount: fixtureEnvelope.data.length,
  estimatedBytes: Buffer.byteLength(
    `${JSON.stringify(fixtureEnvelope, null, 2)}\n`,
    'utf8'
  ),
}));

if (cliOptions.dryRun) {
  printDryRunSummary({
    mode,
    tableNames,
    skippedTables: MANAGED_SAMPLE_TABLES.filter(
      (tableName) => !tableNames.includes(tableName)
    ),
    staticFixtureSummaries,
    transactionEstimate,
  });
} else {
  const writtenFiles = await writeFixtureEnvelopes(repoRoot, fixtureEnvelopes);
let transactionResult = null;
  let transactionMeta = includesTransactions
    ? transactionEstimate?.meta ??
      fixtureEnvelopes.find(
        (fixtureEnvelope) => fixtureEnvelope.table === 'transactions'
      )?.meta
    : null;

  if (shouldStreamTransactions) {
    transactionResult = await writeTransactionFixtureEnvelope(repoRoot, {
      mode,
      transactionGeneration,
    });
    writtenFiles.push(
      transactionResult.filePath,
      ...(transactionResult.additionalFilePaths ?? [])
    );
    transactionMeta = transactionResult.meta;
  }

  const skippedTables = MANAGED_SAMPLE_TABLES.filter(
    (tableName) => !tableNames.includes(tableName)
  );

  console.log(`Sample data generation mode: ${mode}`);
  console.log(`Generated tables: ${tableNames.join(', ')}`);
  console.log(`Written files: ${writtenFiles.join(', ')}`);

  if (transactionMeta) {
    console.log(
      `Transaction window: ${transactionMeta.startDate} through ${transactionMeta.endDate} (${transactionMeta.monthsBack} months back from the reference day)`
    );
    console.log(
      `Requested transactions: ${transactionMeta.requestedTransactionCount.toLocaleString()}`
    );
    console.log(
      `Generated transactions: ${transactionMeta.actualTransactionCount.toLocaleString()}`
    );

    if (
      transactionMeta.actualTransactionCount !==
      transactionMeta.requestedTransactionCount
    ) {
      console.log(
        `Requested transaction volume exceeded the non-zero cent capacity of the generated budgets, so the output was clipped to ${transactionMeta.actualTransactionCount.toLocaleString()} transactions.`
      );
    }

    if (shouldStreamTransactions) {
      console.log(
        `Transactions were written in streaming mode because the request exceeded the in-memory threshold of ${MAX_IN_MEMORY_TRANSACTION_COUNT.toLocaleString()} transactions.`
      );

      if (transactionResult?.isChunked) {
        console.log(
          `Transactions were split across ${transactionResult.additionalFilePaths.length.toLocaleString()} chunk files with up to ${transactionResult.maxRowsPerFile.toLocaleString()} rows per file.`
        );
      }
    }
  }

  if (skippedTables.length > 0) {
    console.log(
      `Skipped tables: ${skippedTables.join(', ')}. Run with --full-schema to generate schema-only fixtures for them.`
    );
  }
}

function parseCliOptions(argv) {
  const options = {
    fullSchema: false,
    dryRun: false,
    monthsBack: null,
    targetTransactionCount: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--full-schema') {
      options.fullSchema = true;
      continue;
    }

    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (argument.startsWith('--months=')) {
      options.monthsBack = argument.slice('--months='.length);
      continue;
    }

    if (argument === '--months') {
      options.monthsBack = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--amount=')) {
      options.targetTransactionCount = argument.slice('--amount='.length);
      continue;
    }

    if (argument === '--amount') {
      options.targetTransactionCount = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

async function resolvePromptedGenerationOptions(cliOptions) {
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const fallbackMonths = Number.parseInt(
    String(DEFAULT_TRANSACTION_GENERATION.monthsBack),
    10
  );
  const parsedCliMonths = parseOptionalPositiveInteger(cliOptions.monthsBack);
  const monthsBack =
    parsedCliMonths ??
    (isInteractive ? await promptForMonthsBack(fallbackMonths) : fallbackMonths);
  const fallbackTransactionCount = estimateDefaultTransactionCount(monthsBack);
  const parsedCliTransactionCount = parseOptionalPositiveInteger(
    cliOptions.targetTransactionCount
  );
  const targetTransactionCount =
    parsedCliTransactionCount ??
    (isInteractive
      ? await promptForTransactionCount(fallbackTransactionCount)
      : fallbackTransactionCount);

  return {
    monthsBack,
    targetTransactionCount,
  };
}

async function promptForMonthsBack(defaultValue) {
  const response = await promptWithDefault(
    `How many months back from today should the sample data cover?`,
    defaultValue
  );

  return parseRequiredPositiveInteger(response, 'months');
}

async function promptForTransactionCount(defaultValue) {
  const response = await promptWithDefault(
    `Roughly how many transactions should be generated for that full period?`,
    defaultValue
  );

  return parseRequiredPositiveInteger(response, 'amount');
}

async function promptWithDefault(question, defaultValue) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await readline.question(`${question} [${defaultValue}]: `);
    return answer.trim() || String(defaultValue);
  } finally {
    readline.close();
  }
}

function parseOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return parseRequiredPositiveInteger(value, 'value');
}

function parseRequiredPositiveInteger(value, label) {
  const parsedValue = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsedValue;
}

function printDryRunSummary({
  mode,
  tableNames,
  skippedTables,
  staticFixtureSummaries,
  transactionEstimate,
}) {
  const staticEstimatedBytes = staticFixtureSummaries.reduce(
    (sum, fixtureSummary) => sum + fixtureSummary.estimatedBytes,
    0
  );
  const staticEstimatedBatchCount = staticFixtureSummaries.reduce(
    (sum, fixtureSummary) => sum + Math.ceil(fixtureSummary.rowCount / 250),
    0
  );
  const estimatedFileCount =
    staticFixtureSummaries.length + (transactionEstimate?.totalFileCount ?? 0);
  const estimatedImportFileFetchCount =
    MANAGED_SAMPLE_TABLES.length + (transactionEstimate?.chunkCount ?? 0);
  const estimatedDiskUsageBytes =
    staticEstimatedBytes + (transactionEstimate?.estimatedTotalBytes ?? 0);
  const estimatedImportBatchCount =
    staticEstimatedBatchCount +
    (transactionEstimate?.estimatedImportBatchCount ?? 0);

  console.log('Dry run only. No files were written.');
  console.log(`Sample data generation mode: ${mode}`);
  console.log(`Generated tables: ${tableNames.join(', ')}`);
  console.log(`Estimated written files: ${estimatedFileCount.toLocaleString()}`);
  console.log(
    `Approximate disk usage: ${formatBytes(estimatedDiskUsageBytes)}`
  );
  console.log(
    `Estimated runtime import cost: ${estimatedImportFileFetchCount.toLocaleString()} file fetches, ${estimatedImportBatchCount.toLocaleString()} insert batches`
  );

  if (transactionEstimate) {
    const transactionMeta = transactionEstimate.meta;

    console.log(
      `Transaction window: ${transactionMeta.startDate} through ${transactionMeta.endDate} (${transactionMeta.monthsBack} months back from the reference day)`
    );
    console.log(
      `Requested transactions: ${transactionMeta.requestedTransactionCount.toLocaleString()}`
    );
    console.log(
      `Generated transactions: ${transactionMeta.actualTransactionCount.toLocaleString()}`
    );
    console.log(`Estimated output mode: ${transactionEstimate.outputMode}`);

    if (transactionEstimate.isChunked) {
      console.log(
        `Estimated transaction chunk files: ${transactionEstimate.chunkCount.toLocaleString()} data chunks plus 1 manifest file`
      );
    }

    console.log(
      `Approximate transaction fixture size: ${formatBytes(transactionEstimate.estimatedTotalBytes)}`
    );
    console.log(
      `Estimated transaction import batches: ${transactionEstimate.estimatedImportBatchCount.toLocaleString()}`
    );

    if (
      transactionMeta.actualTransactionCount !==
      transactionMeta.requestedTransactionCount
    ) {
      console.log(
        `Requested transaction volume exceeded the non-zero cent capacity of the generated budgets, so the output would be clipped to ${transactionMeta.actualTransactionCount.toLocaleString()} transactions.`
      );
    }

    if (transactionEstimate.usesStreaming) {
      console.log(
        `Transactions would use the streaming writer because the request exceeds the in-memory threshold of ${MAX_IN_MEMORY_TRANSACTION_COUNT.toLocaleString()} transactions.`
      );
    }
  }

  if (skippedTables.length > 0) {
    console.log(
      `Skipped tables: ${skippedTables.join(', ')}. Run with --full-schema to generate schema-only fixtures for them.`
    );
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;

  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}