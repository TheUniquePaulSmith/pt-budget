---
name: new-domain
description: Implements database-backed features in budgetApp-v2 the way the codebase expects — either one new operation on an existing domain, or a whole new data domain (sub-service class, SQL module, provider slice hook, page-facing slice, cached collection, page registry entry, locale namespace, unit and e2e tests). Use it whenever a task adds or changes something that reads or writes the SQLite database ("let users save X", "add a delete button for Y", "show Z on the dashboard", "new Loans-like page"), touches databaseService*, sqlQueries*, useDatabase*Slice or use*Slices files, or asks where new data logic should live.
argument-hint: "[operation or domain name]"
---

# Database operations and new domains

Every database interaction flows top to bottom through these layers. Skipping one makes the next feature harder to build:

```
component → use<Domain>Slices.ts (page-facing) → useDatabase<Domain>Slice.ts (provider domain, refreshes)
  → databaseService.<domain> (src/lib/databaseService<Domain>.ts: validation, mapping, orchestration)
  → sqlQueries<Domain>.ts (SQL text) → databaseWorkerService.ts (transport) → public/database-worker.js (wa-sqlite)
```

**Loans (schema v5) is the canonical, most recent full example.** When unsure, open the loans file at the same layer and copy its shape.

First, decide which mode you're in:
- **A. New operation on an existing domain**: steps 1–5, 8, 9.
- **B. New domain**: all steps. If it needs tables, do the `schema-bump` skill first.

Is a feature program running (several agents in parallel)? Then the hubs are frozen: `sqlQueries.ts`,
`src/types/database.ts`, `DatabaseContext.tsx`, `useDatabaseCollectionsState.ts`, `useDatabaseSlices.ts`,
`public/database-schema.js`, and all of `databaseService.ts` except `#region budget-carry`. Your foundation PR already
wired the seams, so only touch the files you own. Outside a program, the domain owner edits the hubs as below.

## Steps

1. **Contracts**: `src/types/database.ts` (entity + `<Entity>Input`), or a feature types file such as
   `src/types/loans.ts` for non-row shapes (summaries, scan results).
2. **SQL**: `src/lib/sqlQueries<Domain>.ts` exports `<DOMAIN>_QUERIES` (an object of named SQL strings, `?` params only,
   never string-built values). Re-export it from the `src/lib/sqlQueries.ts` hub. Money aggregates use the helpers in
   `sqlMoneyExpressions.ts` (`rateExpr`), so currency conversion is inherited: a single amount stays in its account's
   currency, a cross-account total comes out in the default currency.
3. **Service**: `src/lib/databaseService<Domain>.ts`, a class taking `Pick<DatabaseWorkerTransport, 'query'>`. It owns
   row mappers (`mapTo<Entity>`), input validation (throw an error **code** or English message; components translate),
   and orchestration. Logging: `const log = logger.child({ component: '<Domain>Service' })`. No `console.*`.
   Pure maths and rules go in their own pure module (like `loanMath.ts`, `transactionClassifier.ts`) so they can be tested without SQL.
4. **Compose** (mode B): add `readonly <domain>: <Domain>Service` to `DatabaseService` in `databaseService.ts` and construct it
   in the constructor next to `this.loans = new LoansService(workerService)`.
5. **Transport and worker**: almost never needed. `query`/`batch_query`/`exec` cover SQL. Only add a worker message (the
   `switch` near `case 'query':` in `public/database-worker.js`, plus `databaseWorkerService.ts`) for something that must
   run inside the worker (encryption, VFS, snapshots).
6. **Cached collection** (mode B, if pages list the data): in `useDatabaseCollectionsState.ts` add the state, the initial
   `loadAll` entry and `refresh<Domain>()`. Mutations refresh collections. **Never** add startup refresh effects or manual
   refreshes in components.
7. **Provider slice**: `src/contexts/useDatabase<Domain>Slice.ts` exports `interface Database<Domain>Slice` and
   `useDatabase<Domain>Slice({ databaseService, refresh<Domain>, … })`. Every mutation awaits the service, then refreshes
   exactly the collections it changed (a loan delete refreshes loans **and** transactions). Wire it into `DatabaseContext.tsx`:
   import, `Database<Domain>Context`, the `useDatabase<Domain>()` hook, the aggregator entry, the slice construction, and the provider element.
8. **Page-facing slice**: `src/contexts/use<Domain>Slices.ts` returns exactly what one page or dialog needs
   (`use<Domain>PageSlice`). Re-export it from the `useDatabaseSlices.ts` hub. Components import from the hub, not from `DatabaseContext`.
9. **Tests**:
   - Service: `src/lib/databaseService<Domain>.test.ts` with the transport stub (`references/templates.md`). Assert SQL
     *keys* (`LOAN_QUERIES.CREATE`) and params, mapping of NULLs, and validation errors.
   - Changing `databaseService.ts` itself? The coverage gate (80 lines / 60 branches / 95 functions on that file only)
     fails if a new method has no test.
   - Pure module: its own `*.test.ts`.
   - Hook/component: `// @vitest-environment jsdom` pragma; DataGrid tests need `disableVirtualization`.
10. **UI** (mode B): `src/components/<domain>/` (a new feature folder is fine). Page registration is one entry in
    `pageRegistry.tsx` (`id`, `label`, `icon`, `section`, `order`, `testId: 'nav-<id>'`, `render`) plus a lazy import.
    Also add the id to `AppPageId` in `tests/e2e/helpers/bootstrap.ts` and add `shell:nav.<id>` in every language.
    Strings: the `i18n` skill (a new namespace for a new folder). Amounts: `useFormatters().money(amount, account_currency)`.
11. **E2E** (mode B): `tests/e2e/<domain>.spec.ts` driving the real UI (the `e2e` skill).
12. **Docs**: add a CLAUDE.md "Other key pieces" bullet for a new domain (files, the pure module, the slice hooks, where the UI
    lives, cross-feature interactions).

Templates for steps 2, 3, 7, 8 and 9 are in `references/templates.md`.

## Rules that are easy to break

- Amount sign: negative = money out, positive = money in. `transactions.type` is the only thing analytics read. A
  `type_locked` or `type_source = 'manual'` row is a user decision that no automatic process may override.
- Interactions between domains go through services, not components. Example: the subscription scan asks
  `databaseService.loans.getLinkedTransactionIds()` and skips loan payments.
- Settings-like values live in `app_metadata` under a feature namespace (`<feature>.*`) via `databaseService.appMetadata`,
  not localStorage. Secrets in particular (API keys) go only in the encrypted database.
- Don't grow `DatabaseContext.tsx` with logic. It only wires slices.
- The SQL Query page is read-only. Tests and manual checks mutate through real UI flows.

## Verify

```bash
npx vitest run src/lib/databaseService<Domain>.test.ts src/contexts/useDatabase<Domain>Slice*.test.ts*
npm run test:unit:coverage
npm run lint
npx playwright test --config playwright.local.config.ts tests/e2e/<domain>.spec.ts
```
