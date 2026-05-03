import {
  MANAGED_SAMPLE_TABLES,
  SAMPLE_DATA_GENERATION_MODES,
  buildFixtureEnvelopes,
  getGenerationTableNames,
  loadSampleDataContext,
  writeFixtureEnvelopes,
} from './lib/sample-data-tools.mjs';

const repoRoot = process.cwd();
const mode = process.argv.includes('--full-schema')
  ? SAMPLE_DATA_GENERATION_MODES.FULL_SCHEMA
  : SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;

const context = await loadSampleDataContext(repoRoot);
const tableNames = getGenerationTableNames(context.runtimeCompatibility, mode);
const fixtureEnvelopes = buildFixtureEnvelopes(
  context.schemaTables,
  context.runtimeCompatibility,
  { mode, tableNames }
);
const writtenFiles = await writeFixtureEnvelopes(repoRoot, fixtureEnvelopes);
const skippedTables = MANAGED_SAMPLE_TABLES.filter(
  (tableName) => !tableNames.includes(tableName)
);

console.log(`Sample data generation mode: ${mode}`);
console.log(`Generated tables: ${tableNames.join(', ')}`);
console.log(`Written files: ${writtenFiles.join(', ')}`);

if (skippedTables.length > 0) {
  console.log(
    `Skipped tables: ${skippedTables.join(', ')}. Run with --full-schema to generate schema-only fixtures for them.`
  );
}