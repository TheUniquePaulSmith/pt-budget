# Sample Data for Budget Tracker

This directory holds the fixture files that `?loadSampleData` imports when a new database is created,
for development, demos and the e2e suite.

The set models one household (the Parkers: two adults, a teen with a debit card, a younger child with
a custodial savings account) in US dollars: payroll on different cadences, transfers between their own
accounts, credit-card statements paid in full, merchant refunds, a mortgage, an auto loan and a
deferred-interest financing plan, fixed monthly charges the subscription scan can detect, home projects,
family trips, budget plans and savings funds. Every date is relative to the generation day, so the data
always reaches into the current month. Transactions are emitted the way a bank export arrives (typed by
sign only); the app's own scans pair the transfers, infer the refunds, link loan payments and detect
series after import. The scenario lives in `scripts/lib/sample-data-household.mjs`; the `sample-data`
skill in `.claude/skills/` documents it and how to validate or extend it.

## Generating

```bash
pnpm run sample-data:generate --months=12 --seed=review   # what CI and worktree:prepare run
npm run sample-data:validate                                # schema + insert-query check, JSON report
```

Fully non-interactive. Flags: `--months`, `--seed`, `--reference-date`, `--dry-run`, `--full-schema`,
and `--count` (aliases `--transactions`, `--amount`) for volume fixtures only: it splits or merges rows
to land near the requested total and the expectations manifest no longer applies.

Without `--count` the generator runs in **natural mode**: one row per household event, about sixty a
month. Rows are written **newest month first** (ids still ascend), so `?loadSampleData&sampleDataTransactionLimit=N`
keeps the most recent N rows.

Very large counts stream to disk and, above the single-file threshold, split `transactions.json` into a
manifest plus `transactions.part-*.json` chunks that the runtime loader follows automatically.

## Files

Generated and gitignored (date-dependent, regenerate rather than edit):

| File | Table | Notes |
|---|---|---|
| `accounts.json` | accounts | Eleven USD accounts with opening balances as of the window start |
| `projects.json`, `trips.json` | projects, trips | Dated relative to today; two carry savings funds |
| `budget_plans.json`, `budget_plan_categories.json` | budgets | Baseline plan at the window start, adjusted plan three months ago |
| `income_sources.json` | income_sources | Two salaries, a teen job, a linked account |
| `loans.json`, `loan_match_rules.json` | loans | Mortgage and furnace financing have rules; the auto loan has none on purpose |
| `classification_rules.json` | classification_rules | Four user transfer rules (savings sweep, card autopay, allowance, 529) |
| `account_balance_snapshots.json` | account_balance_snapshots | Monthly 401(k) and 529 statements, opening loan balances |
| `transactions.json` | transactions | Newest first; `meta` records the window, seed and `natural` flag |
| `expectations.json` | (manifest) | What the app should show for this set: per-month income/expenses, transfer pairs, refunds, loan payments, detectable series, balances, linked project/trip spend |

Committed and static: `users.json`, `account_cards.json`, `categories.json`, `companies.json`. The
generator rewrites them too; restore them with `git checkout -- public/sample-data/` unless the schema
changed on purpose.

## Validating

```bash
npx vitest run src/lib/sampleDataExpectations.test.ts                                      # seconds: real DatabaseService on Node's SQLite
npx playwright test --config playwright.local.config.ts tests/e2e/sample-data-validation.spec.ts   # minutes: the browser app
```

Both load the fixtures, run the classification, loan-rule and subscription scans, and compare the
app's own queries with `expectations.json`. They skip (with a reason) when the manifest is missing or
the fixtures were generated with `--count`.

## Source Of Truth

- Schema authority: `public/database-schema.js`
- Runtime compatibility check: `src/lib/sqlQueries.ts` (`SAMPLE_DATA_QUERIES`)
- Runtime loader: `src/lib/sampleDataService.ts`

Generation only writes tables whose insert queries match the live schema; `--full-schema` emits
schema-only placeholder fixtures for every managed table regardless.

## Usage

1. Open the app with `http://localhost:3000?loadSampleData`.
2. Click "Create New Database".
3. The fixtures load after the database is created, in the order below.

Append `&sampleDataTransactionLimit=1000` to import only the newest 1,000 transactions.

## File Format

```json
{
  "table": "table_name",
  "meta": { "...": "transactions only" },
  "data": [{ "id": 1, "field1": "value1" }]
}
```

## Loading Order

Files load in dependency order so foreign keys resolve:

1. users
2. accounts
3. account_cards
4. categories
5. companies
6. projects
7. trips
8. budget_plans
9. budget_plan_categories
10. income_sources
11. loans
12. loan_match_rules
13. classification_rules
14. account_balance_snapshots
15. transactions (last, it references most of the above)

Primary keys are preserved; after each table the auto-increment sequence is reset to the maximum id.
Tables not listed (`merchant_rules`, `recurring_series`, `transaction_series_links`, `loan_payments`,
`notifications`, `app_metadata`, ...) are filled by the app itself: community rules are seeded on
open, the rest by the scans.

## Notes

- Missing files are skipped silently; invalid JSON or a dangling foreign key fails the import.
- Sample data loads only with `?loadSampleData` in the URL, after database initialization and before
  the first data refresh.
- `npm run sample-data:validate` warns about schema tables outside the managed workflow and about
  insert queries that drifted from the schema.
