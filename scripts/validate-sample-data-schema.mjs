import {
  SAMPLE_DATA_GENERATION_MODES,
  formatValidationReport,
  loadSampleDataContext,
  readFixtureEnvelopes,
  validateFixtureEnvelopes,
  writeValidationReport,
} from './lib/sample-data-tools.mjs';

const repoRoot = process.cwd();
const mode = process.argv.includes('--full-schema')
  ? SAMPLE_DATA_GENERATION_MODES.FULL_SCHEMA
  : SAMPLE_DATA_GENERATION_MODES.RUNTIME_COMPATIBLE;

const context = await loadSampleDataContext(repoRoot);
const fixtureFiles = await readFixtureEnvelopes(repoRoot);
const report = validateFixtureEnvelopes(
  context.schemaTables,
  context.runtimeCompatibility,
  fixtureFiles,
  { mode }
);
const reportFile = await writeValidationReport(repoRoot, report);

console.log(formatValidationReport(report));
console.log(`JSON report: ${reportFile}`);

if (!report.ok) {
  process.exitCode = 1;
}