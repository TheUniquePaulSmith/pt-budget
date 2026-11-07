---
name: sample-data
description: Generates and validates budgetApp-v2's sample data — the Parker household fixtures that ?loadSampleData imports (two adults, a teen, a child, eleven USD accounts, payroll, transfers between accounts, card payments, refunds, a mortgage, an auto loan, deferred-interest financing, subscriptions, projects, trips, budget plans and savings funds), the expectations.json manifest the generator writes beside them, and the two validation layers that prove the app's income, expense and transfer figures match it (a Vitest file running the real DatabaseService on Node's SQLite, and a Playwright spec). Use it to regenerate fixtures, to validate income/expenses/transfers with mock data, when a feature changes what the dashboard, budget, loans or subscriptions pages should show for the sample set, when extending the household with a new flow or a new table, or when sampleDataExpectations.test.ts or sample-data-validation.spec.ts fails.
argument-hint: "[generate | validate | extend]"
---

# Sample data: generate, validate, extend

Every sample fixture comes from one dated scenario, the Parker household, built relative to the
generation day so the data always reaches into the current month. Rows are emitted the way a bank
export arrives (income and expenses typed by sign, transfer legs as plain money-out / money-in rows,
refunds as merchant credits) and the app's own scans derive the rest. The generator also writes
`public/sample-data/expectations.json`: what those scans and the app's SQL should report. Validation
is comparing the app against that manifest.

| Piece | Where |
|---|---|
| CLI | `scripts/generate-sample-data.mjs` (`npm run sample-data:generate`) |
| Household scenario, flows, manifest | `scripts/lib/sample-data-household.mjs` |
| Generic machinery (schema parsing, split/merge, streaming, validation report) | `scripts/lib/sample-data-tools.mjs` |
| Runtime import (files, insert queries, parameter mapping) | `src/lib/sampleDataService.ts`, `SAMPLE_DATA_QUERIES` in `src/lib/sqlQueries.ts` |
| Node validation (seconds) | `src/lib/sampleDataExpectations.test.ts` |
| Browser validation (minutes) | `tests/e2e/sample-data-validation.spec.ts` |
| Household catalog: accounts, flows, amounts, descriptions | `references/household.md` |

## 1. Generate

```bash
node scripts/generate-sample-data.mjs --months=12 --seed=review && npm run sample-data:validate
```

- Those are the CI and `worktree:prepare` flags. No `--count`: **natural mode**, one row per household
  event (about 60 a month). `--count=<n>` splits or merges rows to hit a volume and switches the
  manifest off (`natural: false`); use it only for performance fixtures.
- `--reference-date=YYYY-MM-DD` moves "today"; `--seed` fixes the small amount/day jitter.
- Rows are written **newest month first** (ids still ascend), so `?sampleDataTransactionLimit=N` and
  the e2e bootstrap cap (500) keep the most recent months. `prepare-worktree` reads the window from the
  envelope's `meta` and regenerates when the newest row is outside the current month.
- Generated and gitignored (date-dependent): `transactions`, `accounts`, `projects`, `trips`,
  `budget_plans`, `budget_plan_categories`, `income_sources`, `loans`, `loan_match_rules`,
  `classification_rules`, `account_balance_snapshots`, `expectations`. Committed and static: `users`,
  `account_cards`, `categories`, `companies`. A generator run rewrites the committed four too; restore
  them (`git checkout -- public/sample-data/`) unless the change is deliberate.

## 2. Validate

Run both layers after regenerating, after changing the generator, and after any change to what the
dashboard, budget, loans, classification or subscription code computes.

```bash
npx vitest run src/lib/sampleDataExpectations.test.ts
npx playwright test --config playwright.local.config.ts tests/e2e/sample-data-validation.spec.ts
```

What each layer does, in order (the order matters: loan rules must claim their payments before the
subscription scan, or the mortgage shows up as a bill series):

1. **Import** every fixture file through the same insert queries and parameter mapping the browser
   uses, with foreign keys on. Row count = `transactions.total`; nothing is a transfer or refund yet.
2. **Classification scan** (`runInitialScanIfNeeded`, the one-time scan the app runs on open): pairs
   the transfer legs (`transfers.pairCount`), types the single-leg 529 contribution through its rule,
   infers the card refunds (`refunds`). Income/expense counts fall to `byExpectedType`.
3. **Money**: per month, `SUM(incomeExpr)` and `SUM(spendExpr)` equal `months[].income/expenses`;
   `getDashboardSummary` and `getBudgetStatus` agree for every complete month, category by category.
4. **Balances**: `opening_balance + SUM(amount since opening_balance_date)` equals
   `accounts[].endingBalance`; snapshot-tracked accounts (401(k), 529, loan accounts) have no rows.
5. **Loans**: `loans.applyRules()` links exactly `expectedPaymentCount` payments per loan, the ledger
   balance drops below principal, the linked loan account gets a statement snapshot, a second pass
   links nothing. The auto loan has no rule on purpose (see below).
6. **Subscriptions**: after `runSubscriptionScan()` every `subscriptions[].detectable` series exists
   with its cadence, amount and occurrence count; rule-linked loan payments never become a series.
7. **Projects, trips, funds**: linked spend and row counts; the two savings funds are listed.

The e2e spec does the same through `?loadSampleData` with no cap, the SQL page, the Loans page (rules
apply on mount), Subscriptions → Rescan, the Budget page and the Dashboard.

Both layers **skip** (not fail) when `expectations.json` is missing or `natural: false`, and the Node
layer also skips without `node:sqlite` (Node 22.13+ / 24). A skip in CI output means "not validated".

## 3. Invariants the suite depends on

- Account ids 1–4 and names (`Household Checking`, `Rainy Day Savings`, `Rewards Visa`,
  `Household Joint`), cards 1–5 (two end in `4821`, told apart by `full_number`), categories 1–15
  (`Groceries` is 2), and `Avery`/`Jordan` as the adults. Specs across `tests/e2e/` use them.
- Everything is USD; `accounts.currency = 'USD'`, no `exchange_rates`.
- Fixed series have a description nobody else uses (`COMMUNITY SOCCER CLUB DUES` vs the seasonal
  `COMMUNITY SOCCER CLUB` fees): the scan clusters by normalized description and rejects a variable
  amount. `expectations.subscriptions[].detectable` is computed from the rows, so a collision shows up
  there first.
- Transfer amounts never collide with an unrelated row of the same amount within a week in another
  account, and card payments equal the previous month's card activity to the cent. The in-leg of the
  Rewards Visa payment is `PAYMENT RECEIVED - THANK YOU`, never the exact string
  `PAYMENT - THANK YOU` that `transfer-classification.spec.ts` counts.
- The **auto loan is the unlinked loan**: no `loan_match_rules` row, `expectedPaymentCount: 0`, and
  its payments are a detectable bill series until a rule is added. `loans.spec.ts` adds that rule.
  Keep one loan in this state.
- `loans.spec.ts`, `notifications.spec.ts` ("No notifications yet."), `budget.spec.ts` (one plan per
  month after upsert) and `database-smoke.spec.ts` read the seeded state; the furnace promo ends about
  nine months out, outside the 60-day `loan_promo_ending` lead.

## 4. Extend

**A new flow** (a bill, an income, a transfer, a refund): add it to `buildHouseholdTransactionEntries`
in the household module with `push(month, {...})` or `pushTransfer(month, {...})`. Set `expectedType`
only when the sign does not say it (`'transfer'` for a one-legged transfer, `'refund'` for a merchant
credit), `recurringKey` for a fixed charge the scan should detect, `loanId` for a payment a loan rule
should claim. Amounts via `random.money(min, max)` never land on a round number. Then regenerate and
run both validation layers; the manifest picks the row up by itself.

**A new seeded table**: in `sample-data-tools.mjs` add it to `MANAGED_SAMPLE_TABLES` after the tables
it references; in `sample-data-household.mjs` return its rows from `getHouseholdBaseRows` (dates from
`scenario`, never literals); in `sqlQueries.ts` add `SAMPLE_DATA_QUERIES.INSERT_<TABLE>` with every
column the rows carry; in `sampleDataService.ts` add the file to `SAMPLE_DATA_FILES` (same order) and a
`getImportDefinition` case; list it in `public/sample-data/README.md`; add a manifest field in
`buildSampleDataExpectations` and an assertion in both validation layers.

**A schema change** that touches a seeded table: the `schema-bump` skill already says to regenerate;
`npm run sample-data:validate` reports columns the insert queries miss.

## 5. When validation fails

| Symptom | Usual cause |
|---|---|
| Node layer "skipped: fixtures are not natural" | Fixtures came from `--count`; regenerate without it |
| `transfersPaired` below `pairCount` | A new row shares an amount with a transfer leg within 7 days, or a leg lost its transfer wording (`TRANSFER`, `PAYMENT`, `PYMT`, `AUTOPAY`, `ZELLE`...) |
| Refund count off | A positive card row without a matching merchant charge still infers as refund (0.65); a positive row in a *checking* account never does |
| `<description> detected: expected undefined` | Fewer than three occurrences in the window, a shared description with other amounts, or a community merchant rule classified it as `purchase` |
| Loan payment counts off | Payment description no longer matches the rule pattern/account, or a transfer pairing claimed the payment row |
| Month totals off by a refund amount | `expectedType: 'refund'` missing on a credit (refunds reduce `spendExpr`) |
| Balances off | A flow posts to an account without passing through `push` (balances and card statements are tracked there) |
| e2e "No loans yet" / "Payments (0)" | The spec expects the seeded loans; see `loans.spec.ts` for the current contract |
| Empty "This Month" in e2e | Fixtures older than the current month: `node scripts/prepare-worktree.mjs --regenerate-fixtures` |
