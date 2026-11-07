---
name: schema-bump
description: Adds the next SQLite schema version to budgetApp-v2 end to end — CREATE_TABLES and the MIGRATIONS entry in public/database-schema.js, worker migration ops, TypeScript contracts, the staging-table mirror, hard-coded version assertions, sample-data regeneration, the upgrade e2e and its archive fixtures, and the schema docs. Use it whenever a change needs a new table, column, index or CHECK constraint, or the user mentions a migration, "schema v7", user_version, or upgrading existing databases — even if they only describe the feature ("store X on each account") and not the schema change.
argument-hint: "[what the new version adds]"
---

# Schema bump (version N → N+1)

`public/database-schema.js` is the source of truth. It is plain ES-module JavaScript served to the SharedWorker:
no TypeScript and no imports from `src/`. Read its migration comment block (just above `SCHEMA_VERSION`) before you
start; it defines the allowed op vocabulary. Each of v2 to v6 touched roughly 40 to 70 files, and the steps that get
forgotten are the boring ones at the end.

## 0. Decide

- Is a bump really needed? A new *meaning* for existing data (a new `app_metadata` key such as `preferences.*`, a new enum
  value already allowed by a CHECK) does not need one.
- One bump per feature, and never two branches bumping in parallel. During a feature program the schema file is frozen:
  the missing column goes into the next version, which the foundation PR owns (see `feature-program`).
- Read the current `SCHEMA_VERSION` and use N+1 below.

## 1. `public/database-schema.js`

1. **`CREATE_TABLES`**: add or modify the table DDL. Fresh databases are created from this alone and then stamped
   with `SCHEMA_VERSION`; they never run migrations. So `CREATE_TABLES` must describe the final shape exactly.
2. **`CREATE_INDEXES`**: always `CREATE INDEX IF NOT EXISTS …`.
3. **`MIGRATIONS`**: append `{ version: N+1, statements: [...] }` using only these ops:
   - SQL strings must be idempotent (`CREATE TABLE IF NOT EXISTS`, or `UPDATE … SET … WHERE <excludes already-changed rows>`).
     `databaseSchema.test.ts` enforces this with a regex.
   - `{ op: 'addColumn', table, column, ddl }`: skipped when the column exists. A `NOT NULL` column needs a `DEFAULT`.
   - `{ op: 'rebuild', table, guardColumn, create, columnExpressions }`: the only way to change a CHECK, FK or
     NOT NULL on an existing table. `guardColumn` must be a column that exists only after this rebuild.
   - `{ op: 'dropTable', table }`, `{ op: 'rehashTransactions' }`.
4. **Staging-table mirror**: if `transactions` gains columns or constraint changes, `temp_import_transactions` must
   match. Migrate it with `{ op: 'dropTable', table: 'temp_import_transactions' }, CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS`
   (it is empty between imports). v2 and v4 both did this.
5. Set `SCHEMA_VERSION = N+1`.
6. Update the header comment if money or type conventions change.

Migrations run inside one transaction with foreign keys **off** (so rebuilding a parent table doesn't cascade-delete
its children) and are verified with `PRAGMA foreign_key_check` before commit. Don't add `PRAGMA foreign_keys` yourself.

## 2. Worker, only if you need a new op kind

`public/database-worker.js` → the op `switch` inside `runMigrations()` (search `case 'addColumn'`). Add the op there
*and* in the `MigrationOp` union and the op switch of `src/lib/databaseSchema.test.ts`. The worker is cached
aggressively; see `debug-app` for how to make the browser load the new file.

## 3. Contracts and mapping

- `src/types/database.ts`: entity and input types.
- The row mapper (`mapTo<Entity>`) in the owning `src/lib/databaseService<Domain>.ts`. New columns must be mapped,
  with defaults for `NULL`.
- Money columns: amounts are signed (negative = out). A per-account amount is in that account's currency; aggregates
  go through `sqlMoneyExpressions.ts` (`rateExpr`) so conversion is inherited. Budget/plan amounts stay in the default currency.
- Then build the feature itself with the `new-domain` skill.

## 4. Hard-coded version numbers

```bash
grep -rn "toBe('N')\|toBe(N)\|version N\b" src/lib/databaseSchema.test.ts tests/e2e/database-smoke.spec.ts tests/e2e/database-upgrade.spec.ts
```

(Replace N with the old version.) As of v6, `user_version` is asserted in `databaseSchema.test.ts`,
`database-smoke.spec.ts` (one place) and `database-upgrade.spec.ts` (three places). Bump them all, and add to
`database-upgrade.spec.ts` an assertion that the new table or column exists on an *upgraded* database:

```ts
// Version N+1: <what it adds>.
expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM pragma_table_info('accounts') WHERE name = 'currency'")).toBe('1');
```

## 5. Upgrade archive fixtures (only when the migration transforms data)

`tests/e2e/fixtures/v1-…zip` and `v2-…zip` are encrypted exports from old builds, and `database-upgrade.spec.ts` opens them.
Purely additive bumps (v3 to v6) added no new fixture: the existing archives already prove the whole chain runs.
Capture a new `vN` baseline when the migration **rewrites rows** (rebuild, UPDATE, rehash) and you need old data to test it:

1. Create a temporary worktree at the last commit **before** the bump: `git worktree add ../schema-baseline <sha>`.
   Run `prepare-worktree` there.
2. In it, copy `tests/e2e-tools/export-v1-fixture.spec.ts` and change `OUTPUT_PATH` to `vN-budget-tracker.zip`.
   Run `npx playwright test --config playwright.fixture-export.config.ts` on a free port (copy the local-config
   pattern so it doesn't reuse a sibling's server). The spec asserts subscription links > 0 before it exports. If
   that fails, the fixtures were generated with split rows; use `--months=12 --seed=review`.
3. Copy the zip into this branch's `tests/e2e/fixtures/`, add a `vN` test to `database-upgrade.spec.ts`, and remove the
   temporary worktree.

## 6. Sample data

The generator is schema-aware (it reads `public/database-schema.js`).

```bash
node scripts/generate-sample-data.mjs --months=12 --seed=review
npm run sample-data:validate
```

If the new column needs realistic values (not just its DEFAULT), extend `scripts/lib/sample-data-tools.mjs`.
Committed fixtures (`accounts`, `users`, `categories`, `companies`, `account_cards`) should change only if the schema
change touches them. Otherwise `git checkout -- public/sample-data/`. Never hand-edit fixture JSON.

## 7. Docs

- `docs/database-schema.md`: ER diagram and table notes (the JS file wins on any disagreement).
- `CLAUDE.md`: the feature's "Other key pieces" bullet names the schema version, e.g. "Loans (schema v5): …".

## 8. Verify

```bash
npx vitest run src/lib/databaseSchema.test.ts src/lib/databaseService<Domain>.test.ts
npm run test:unit:coverage
npx playwright test --config playwright.local.config.ts tests/e2e/database-upgrade.spec.ts tests/e2e/database-smoke.spec.ts
```

Then check both paths by hand, or in one spec: a **fresh** database (created from `CREATE_TABLES`) and an **upgraded**
one (an older archive) must end up with identical columns. `SELECT name FROM pragma_table_info('<table>')` on each should match.

## Checklist

- [ ] `CREATE_TABLES` / `CREATE_INDEXES` describe the final shape
- [ ] `MIGRATIONS[N+1]` uses only known ops, and its SQL is idempotent
- [ ] `temp_import_transactions` mirrors `transactions`
- [ ] `SCHEMA_VERSION = N+1`, plus every hard-coded `user_version` assertion
- [ ] types + mappers updated
- [ ] upgrade spec asserts the new shape; new archive fixture only if rows are transformed
- [ ] fixtures regenerated + validated, committed fixture churn reverted
- [ ] `docs/database-schema.md` + CLAUDE.md bullet
