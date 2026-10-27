# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A 100% client-side personal finance / budget tracking SPA: Next.js 15 App Router (static export to `dist/`), React 19, TypeScript 5, Material UI 7, and SQLite via wa-sqlite WebAssembly. There is no backend — database execution, persistence (IndexedDB VFS), and cross-tab coordination run in a browser SharedWorker. A local AI side panel runs user-selected GGUF models in the browser via wllama (no CDN, no auto-load).

## Commands

```bash
npm run dev                  # dev server at http://localhost:3000 (Turbopack)
npm run build                # static export to dist/
npm run lint

npm test                     # default post-change verification: unit coverage + e2e smoke
npm run test:unit            # Vitest suite (src/**/*.{test,spec}.{ts,tsx})
npm run test:unit:coverage   # enforces coverage thresholds on src/lib/databaseService.ts
npm run test:unit:watch
npm run test:e2e:smoke       # Playwright tests tagged @smoke
npm run test:e2e             # full browser suite (tests/e2e/)

npx vitest run src/lib/databaseService.test.ts        # single unit test file
npx vitest run -t "test name"                         # single test by name
npx playwright test tests/e2e/database-smoke.spec.ts  # single e2e file

npm run sample-data:generate   # regenerate public/sample-data/ fixtures (schema-aware)
npm run sample-data:validate   # validate fixtures against current schema
```

`sample-data:generate` is **non-interactive** — it never prompts; every input comes from a flag or a default, so agents/CI can run it unattended. Pass flags after `--`, e.g. `npm run sample-data:generate -- --months=12 --count=5000 --seed=demo --reference-date=2026-01-01`. Run `node scripts/generate-sample-data.mjs --help` for the full flag list (`--count`/`--transactions`/`--amount`, `--seed`, `--reference-date`, `--full-schema`, `--dry-run`).

Playwright runs Chromium only, single worker, against `http://localhost:3000` (always localhost, not 127.0.0.1) and reuses an existing dev server if one is running.

## Architecture

### Database layering (the core of the app)

Every database interaction flows through these layers, top to bottom:

```
React components
  → feature-facing slice hooks         src/contexts/useDatabaseSlices.ts   (preferred in components)
  → domain hooks / provider contexts   src/contexts/DatabaseContext.tsx
  → internal provider hooks            src/contexts/useDatabase*.ts        (initialization, collections
                                       state, transaction / account / catalog-planning / subscriptions slices)
  → business logic                     src/lib/databaseService.ts + src/lib/sqlQueries.ts
                                       (SQL orchestration, row mapping, validation, analytics, duplicate detection)
  → transport                          src/lib/databaseWorkerService.ts    (messaging, timeouts, heartbeat, reconnect)
  → execution                          public/database-worker.js           (SharedWorker hosting wa-sqlite + persistence)
```

Shared entity contracts live in `src/types/database.ts`. The `@/` import alias maps to `src/`.

**Worker-side code in `public/` is plain untranspiled ES-module JavaScript, not TypeScript** — `database-worker.js`, `database-schema.js`, and `database-encryption.js` are served as static assets and loaded by the SharedWorker. `public/database-schema.js` is the schema source of truth (docs/database-schema.md has the ER diagram, but the JS file wins).

### Adding or changing a database operation

1. Update contracts in `src/types/database.ts` if the domain shape changes.
2. Add/adjust SQL in `src/lib/sqlQueries.ts`.
3. Implement the operation in `src/lib/databaseService.ts`.
4. Touch `src/lib/databaseWorkerService.ts` only if a new worker message/transport behavior is needed.
5. Touch `public/database-worker.js` only if the worker must understand a new operation.
6. If cached collections or refresh behavior change, update `src/contexts/useDatabaseCollectionsState.ts`.
7. Put mutation logic in the matching provider-domain hook (`useDatabaseTransactionSlice.ts`, `useDatabaseAccountManagementSlices.ts`, etc.) — do not grow `DatabaseContext.tsx`.
8. Expose it through the right slice hook in `useDatabaseSlices.ts`, and add focused tests for the touched layer.

### Context conventions

- Components should use the thin hooks in `useDatabaseSlices.ts`, or the dedicated domain hooks exported from `DatabaseContext.tsx` (`useDatabaseStatus`, `useDatabaseCollections`, `useDatabaseTransactions`, …). `useDatabaseContext()` is a compatibility aggregator, not the default path.
- `DatabaseProvider` owns initialization and renders the setup gate. Cached collections are provider-backed state; mutations already refresh their collections on success — do not add startup refresh effects or redundant manual refreshes in components.

### Other key pieces

- Provider composition in `src/app/layout.tsx`: `LoggingProvider` → `CustomThemeProvider` → `WllamaProvider` → `DatabaseProvider`. `src/app/page.tsx` dynamically imports the shell to avoid SSR issues; `src/components/common/Layout/AppContent.tsx` owns top-level navigation.
- Components are organized by feature under `src/components/` (accounts, ai, csv-import, dashboard, data-management, projects, settings, setup, sql-query, subscriptions, transactions, trips) — keep new components in the existing feature folders.
- AI layer: `src/contexts/WllamaContext.tsx` + `useWllamaSlices.ts`, with `src/lib/aiChatService.ts` and `src/lib/aiDatabaseTools.ts`; wllama wasm is served from `public/wllama/`.
- CSV import: `src/lib/csvImportService.ts` + `src/components/csv-import/` — column auto-detection, account matching, temp-table staging.
- Transaction classification (schema v4): `src/lib/transactionClassifier.ts` (pure: type rules, transfer pairing across accounts, refund inference) + `src/lib/databaseServiceClassification.ts` (`databaseService.classification`, SQL in `sqlQueriesClassification.ts`) + `src/contexts/useDatabaseClassificationSlice.ts` / `useClassificationSlices.ts`. It runs on the staged rows during CSV import (`ImportTransferReview`), on demand from the Transactions page (Auto-classify, Type Rules) and once per database on open. `transactions.type` is the only thing analytics read: never filter income by account type again; `type_locked` / `type_source = 'manual'` is a user decision the classifier must not override.
- Export/encryption: `src/lib/databaseArchive.ts` + `src/lib/databaseEncryption.ts` pair with worker-side `public/database-encryption.js` (AES-GCM, PBKDF2).
- Theme lives in `src/theme/theme.tsx` (MUI theme, palette, component overrides). Preserve the existing Material UI visual language unless the task is explicitly a redesign.
- Logging goes through `src/contexts/LoggingContext.tsx`; the Developer Console is a real product surface, not a temporary debug tool.
- wa-sqlite API reference: https://rhashimoto.github.io/wa-sqlite/docs/index.html

## Feature-program conventions (schema v3 foundation)

Several feature areas (notifications, logging, UI shell, CSV import, AI providers/tools, budget carry-over) are built by parallel agents. The foundation PR put every shared seam in place so feature branches only touch files they own:

- **Page registry**: `src/components/common/Layout/pageRegistry.tsx` is the one list of top-level pages (`id`, `label`, `icon`, `section`, `order`, `mobileNav`, `hiddenFromNav`, `fullScreen`, `testId`, `render`). `AppContent.tsx` renders navigation from it; a new page is one registry entry. Every control that navigates to a page carries `data-testid="nav-<id>"` **and** an accessible name equal to the label (the e2e suite clicks `getByRole('button', { name: 'SQL Query' })`; `tests/e2e/helpers/bootstrap.ts` has `navigateToPage(page, id)`). The invariants a shell rewrite must keep are listed at the top of `AppContent.tsx`.
- **Shell slots**: `Layout/slots/NotificationBellSlot.tsx` (notifications), `Layout/slots/AiLauncherSlot.tsx` (AI), `components/ai/AiPanelProvider.tsx` + `useAiPanel()` (AI panel state), `components/notifications/NotificationsRuntime.tsx` (headless effects, mounted once), `NotificationsDashboardCard.tsx` (dashboard slot), `NotificationsSettingsTab.tsx` / `common/Console/DeveloperSettingsTab.tsx` (Settings tab bodies). Each is owned by one feature; the shell only places them.
- **Sub-services**: new data domains are classes composed into `DatabaseService` (`databaseService.notifications`, `.aiTools`, `.budgetFunds`, `.appMetadata`) living in `src/lib/databaseService<Domain>.ts` with SQL in `src/lib/sqlQueries<Domain>.ts` (re-exported from the `sqlQueries.ts` hub). Money expressions live in `sqlMoneyExpressions.ts`. Domain slice hooks (`useDatabase<Domain>Slice.ts`) export their interface, which `DatabaseContext.tsx` imports, and page-facing hooks live in `use<Domain>Slices.ts`, re-exported from the `useDatabaseSlices.ts` hub. Add methods in the feature-owned files; the hubs, `DatabaseContext.tsx`, `useDatabaseCollectionsState.ts`, `src/types/database.ts` and `public/database-schema.js` are frozen for the program (a missing column goes in a later schema version, never a parallel bump).
- **`databaseService.ts`** is read-only for feature branches except the `#region budget-carry` block (budgets agent).
- **Logging**: `import { logger } from '@/lib/logging'`; `const log = logger.child({ component: 'Name' })`; `log.info('msg', { operation: 'x', error })`; `log.withOperation('x')` adds a fresh correlation id. Levels trace/debug/info/warn/error; `?debug` enables debug capture, `?debug_output_console=true` echoes everything to the console (`getDebugFlags()` in `src/lib/debugMode.ts`). Do not add new `console.*` calls in `src/lib` or `src/contexts`.
- **`app_metadata` keys** are namespaced per feature (`notifications.*`, `ai.*`, `logging.*`); `ai.provider.config` holds AI provider profiles including API keys (encrypted DB, never localStorage).
- **Account form**: `src/components/accounts/accountFormModel.ts` + `AccountFormFields.tsx` are the shared field set for the Add/Edit dialog and any inline account form; extend the dialog or the page, not these.

## Conventions and Gotchas

- **Client-only app**: check for browser-only APIs and SSR boundaries before adding runtime logic. SharedWorker support is required for the primary experience. A `Document-Isolation-Policy: isolate-and-require-corp` header is set in `next.config.ts` for multi-threaded wasm (crossOriginIsolated on Chromium 137+; other browsers fall back to single-threaded wllama). COOP/COEP is deliberately **not** used — COOP: same-origin severs the cloud-auth popup's window references (see `src/lib/cloudAuthPopup.ts`). Static-export hosts must send the equivalent header.
- **Amount sign convention**: negative = expense, positive = income.
- **Duplicate detection** is hash-based from account, date, amount, and description data.
- **The SQL Query page is intentionally read-only** (`SELECT` only). Mutations in tests or manual validation must go through real UI flows (transactions, trips, projects, accounts, data-management dialogs).
- **Vitest runs in the `node` environment by default** (see `vitest.config.ts`); component/hook tests opt into jsdom with a `// @vitest-environment jsdom` pragma at the top of the file. Setup lives in `src/test/setup.ts`.
- Coverage enforcement centers on `src/lib/databaseService.ts` (HTML report at `coverage/index.html`).
- **E2E notes**: use the shared helpers in `tests/e2e/helpers/bootstrap.ts` (`bootstrapDatabase` fills the Primary User Name + password setup screen; `runQueryAndReadFirstCell` reads the SQL page's DataGrid via `gridcell` roles — there is no `<tbody>`); the Add Transaction dialog Account/Card selects are labeled (`getByRole('combobox', { name: 'Account' })`); worker-recovery tests use `window.__budgetTrackerTestApi.disconnectWorker()` plus a full page reload.
- **Sample data**: `?loadSampleData` query param triggers sample-data bootstrap during new-database creation (`src/lib/sampleDataService.ts`, `public/sample-data/`); `?dev=true` enables developer-only sample-data export tooling. Regenerate fixtures with the sample-data scripts when the schema changes rather than hand-editing JSON.

## GitHub Strategy
- **Branches**: `main` is the production branch; `devel/latest` is the latest integration branch for feature work. Feature branches are named `feature/<short-description>`.
- All PR merges must be squashed and rebased onto `devel/latest` (or `main` for hotfixes). Do not merge `main` into feature branches; rebase instead.