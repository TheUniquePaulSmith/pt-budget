# Sample Data for Budget Tracker

This directory contains sample data files that can be automatically loaded into the database for development and testing purposes.

The default runtime-compatible fixture set models a suburban family household from May 2021 through April 2026, with 585 transactions spanning housing, groceries, utilities, transportation, childcare and school, healthcare, insurance, travel, home improvement, salary, side income, and tax refunds.

The repo now includes schema-aware commands to validate and regenerate these files from the live database schema in `public/database-schema.js`.

## Schema-Aware Workflow

Validate the current sample-data set against the live schema and the runtime sample-data queries:

```bash
npm run sample-data:validate
```

Generate the default runtime-compatible fixture set:

```bash
npm run sample-data:generate
npm run sample-data:generate -- --months 60 --amount 6000
npm run sample-data:generate -- --months 120 --amount 100000000 --dry-run
```

Generate the broader schema-only fixture set, including tables that are currently out of sync with the runtime sample-data queries:

```bash
npm run sample-data:generate -- --full-schema
```

The validation command writes a JSON report to `dist/sample-data/schema-validation-report.json`.

By default, the generator now prompts for two inputs:

1. How many months back from today the generated data should cover.
2. Roughly how many transactions should be produced over that full period.

For non-interactive or repeatable runs, pass the values directly:

```bash
npm run sample-data:generate -- --months 60 --amount 6000
```

Add `--dry-run` to print the planned date window, output mode, chunk count, approximate disk usage, and estimated runtime import work without modifying any fixture files.

The requested transaction count is approximate. The generator preserves the modeled monthly income and expense ranges and changes transaction granularity to land near the requested total. Very large requests can be clipped if the chosen date window does not have enough non-zero cent precision to split the modeled budgets further.

When a generated transaction set exceeds the single-file threshold, the generator writes `transactions.json` as a manifest and emits `transactions.part-*.json` chunk files alongside it. The runtime sample-data loader reads that manifest automatically.

## Source Of Truth

- Schema authority: `public/database-schema.js`
- Runtime compatibility check: `src/lib/sqlQueries.ts` (`SAMPLE_DATA_QUERIES`)
- Runtime loader: `src/lib/sampleDataService.ts`

By default, generation only writes tables that are currently compatible with both the live schema and the runtime sample-data insert queries.

## Usage

To load sample data when creating a new database:

1. Navigate to the app with the query parameter: `http://localhost:3000?loadSampleData=true`
2. Click "Create New Database"
3. Sample data will automatically be loaded

## File Format

Each JSON file should follow this structure:

```json
{
  "table": "table_name",
  "data": [
    {
      "id": 1,
      "field1": "value1",
      "field2": "value2",
      ...
    }
  ]
}
```

## Available Files

- **users.json** - User accounts
- **accounts.json** - Bank accounts, credit cards, etc.
- **account_cards.json** - Card records linked to accounts
- **categories.json** - Transaction categories (income/expense)
- **companies.json** - Company/merchant names
- **transactions.json** - Sample transactions

Additional schema-aware outputs are available in `--full-schema` mode:

- **projects.json** - Project planning fixtures
- **trips.json** - Trip planning fixtures

Tables such as `budgets` and `temp_import_transactions` exist in the schema but are not currently managed by the sample-data workflow.

## Loading Order

Files are loaded in dependency order to maintain foreign key relationships:

1. users
2. accounts
3. account_cards
4. categories
5. companies
6. projects
7. trips
8. transactions (last, as it depends on all other tables)

The default generator currently writes only the runtime-compatible subset: `users`, `accounts`, `account_cards`, `categories`, `companies`, and `transactions`. Use `--full-schema` only when you explicitly want schema-only fixture files for currently incompatible tables.

## Primary Keys

The sample data loader preserves primary key IDs, so you can create relationships between tables. After loading, the auto-increment sequence is reset to the maximum ID to prevent conflicts.

## Creating Sample Data

### Option 0: Generate From The Live Schema

1. Run `npm run sample-data:validate` to see what is missing or out of sync.
2. Run `npm run sample-data:generate` to refresh the runtime-compatible fixture set, or pass `--months` and `--amount` to make the run repeatable without prompts.
3. If you intentionally need schema-only fixtures for currently incompatible tables, run `npm run sample-data:generate -- --full-schema`.

You can export existing database tables to create sample data files:

1. Use the Developer Console (when implemented)
2. Click "Export [table_name]" button
3. Save the JSON file to this directory
4. Edit as needed to create sample data

## Notes

- Missing files are silently skipped (no error)
- Invalid JSON or missing foreign keys will cause errors
- Sample data only loads when `?loadSampleData=true` is in the URL
- Sample data loads after database initialization, before data refresh
- `npm run sample-data:validate` will warn when schema tables are unmanaged or when runtime sample-data queries have drifted from the schema
- Full-schema generation can create files for tables that the current runtime sample-data queries cannot yet import; use the validation report before relying on `?loadSampleData=true`
