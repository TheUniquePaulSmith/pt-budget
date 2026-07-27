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

// Maps `--flag=value` / `--flag value` argument pairs to the option key they
// set. Aliases share a key (e.g. --count/--transactions/--amount all set the
// transaction count; --amount is kept for backward compatibility even though it
// means a count, not a dollar amount). Declared before parseCliOptions runs so
// the hoisted function does not read them from the temporal dead zone.
const VALUE_FLAGS = {
  '--months': 'monthsBack',
  '--count': 'targetTransactionCount',
  '--transactions': 'targetTransactionCount',
  '--amount': 'targetTransactionCount',
  '--seed': 'seed',
  '--reference-date': 'referenceDate',
};

const BOOLEAN_FLAGS = {
  '--full-schema': 'fullSchema',
  '--dry-run': 'dryRun',
  '--help': 'help',
  '-h': 'help',
};

const repoRoot = process.cwd();
const cliOptions = parseCliOptions(process.argv.slice(2));

if (cliOptions.help) {
  printUsage();
  process.exit(0);
}

const mode = cliOptions.fullSchema
  ? SAMPLE_DATA_GENERATION_MODES.FULL_SCHEMA
  : SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;
// Non-interactive: every value comes from a flag or a default, so the script
// runs unattended (CI, agents) without ever prompting.
const generationInputs = resolveGenerationOptions(cliOptions);
const transactionGeneration = resolveTransactionGenerationOptions({
  referenceDate: generationInputs.referenceDate,
  monthsBack: generationInputs.monthsBack,
  targetTransactionCount: generationInputs.targetTransactionCount,
  ...(generationInputs.seed !== null ? { seed: generationInputs.seed } : {}),
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
    help: false,
    monthsBack: null,
    targetTransactionCount: null,
    seed: null,
    referenceDate: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (Object.prototype.hasOwnProperty.call(BOOLEAN_FLAGS, argument)) {
      options[BOOLEAN_FLAGS[argument]] = true;
      continue;
    }

    // `--flag=value`
    const equalsIndex = argument.indexOf('=');
    if (argument.startsWith('--') && equalsIndex !== -1) {
      const flag = argument.slice(0, equalsIndex);
      if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, flag)) {
        options[VALUE_FLAGS[flag]] = argument.slice(equalsIndex + 1);
        continue;
      }
      throw new Error(`Unknown option: ${flag}. Run with --help for usage.`);
    }

    // `--flag value`
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, argument)) {
      options[VALUE_FLAGS[argument]] = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${argument}. Run with --help for usage.`);
  }

  return options;
}

// Resolves every generation input from CLI flags, falling back to defaults.
// No prompting: absent flags simply use their default.
function resolveGenerationOptions(cliOptions) {
  const fallbackMonths = Number.parseInt(
    String(DEFAULT_TRANSACTION_GENERATION.monthsBack),
    10
  );
  const monthsBack =
    parseOptionalPositiveInteger(cliOptions.monthsBack, 'months') ?? fallbackMonths;
  const targetTransactionCount =
    parseOptionalPositiveInteger(cliOptions.targetTransactionCount, 'count') ??
    estimateDefaultTransactionCount(monthsBack);
  const seed =
    cliOptions.seed !== null &&
    cliOptions.seed !== undefined &&
    cliOptions.seed !== ''
      ? String(cliOptions.seed)
      : null;
  const referenceDate = parseReferenceDate(cliOptions.referenceDate);

  return { monthsBack, targetTransactionCount, seed, referenceDate };
}

function parseReferenceDate(value) {
  if (value === null || value === undefined || value === '') {
    return new Date();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `reference-date must be a valid date (e.g. 2026-01-01), got: ${value}`
    );
  }

  return parsed;
}

function printUsage() {
  const defaultMonths = Number.parseInt(
    String(DEFAULT_TRANSACTION_GENERATION.monthsBack),
    10
  );

  console.log(`Usage: node scripts/generate-sample-data.mjs [options]

Generates sample-data fixtures under public/sample-data/. Fully non-interactive:
every value comes from a flag or a default.

Options:
  --months=<n>             Months of history to cover (default: ${defaultMonths}).
  --count=<n>              Approx transactions for the full period
                          (aliases: --transactions, --amount; default: scaled to months).
  --seed=<string>         Seed for deterministic output
                          (default: derived from reference date + months + count).
  --reference-date=<date> Reference "today" for the window, e.g. 2026-01-01
                          (default: the current date).
  --full-schema           Emit schema-only fixtures for every managed table.
  --dry-run               Print an estimate summary without writing files.
  -h, --help              Show this help and exit.

Examples:
  npm run sample-data:generate -- --months=12 --count=5000
  npm run sample-data:generate -- --count=250000 --seed=perf --reference-date=2026-01-01
  npm run sample-data:generate -- --dry-run --count=1000000`);
}

function parseOptionalPositiveInteger(value, label = 'value') {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return parseRequiredPositiveInteger(value, label);
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