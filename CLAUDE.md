# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A 100% client-side personal finance / budget tracking SPA: Next.js 15 App Router (static export to `dist/`), React 19, TypeScript 5, Material UI 7, and SQLite via wa-sqlite WebAssembly. There is no backend — database execution, persistence (IndexedDB VFS), and cross-tab coordination run in a browser SharedWorker. A local AI side panel runs user-selected GGUF models in the browser via wllama (no CDN, no auto-load).

## Project skills

Step-by-step workflows live in `.claude/skills/`; use them instead of re-deriving the procedure:

| Skill | For |
|---|---|
| `worktree-ready` | First thing in any worktree (`npm run worktree:prepare`): deps, gitignored sample-data fixtures, branch vs `devel/latest`, a private Playwright port |
| `e2e` | Running, writing and debugging Playwright specs |
| `schema-bump` | Any new table / column / constraint (schema version N+1) |
| `new-domain` | Adding a database operation or a whole data domain through every layer |
| `i18n` | Any user-facing string, translation, formatting; `scripts/audit-diff.mjs` finds hard-coded text |
| `debug-app` | Debugging the running app: `dev-unlocked` server, logs, worker, SQL inspection, symptom table |
| `ship` | `/ship` only: CI-equivalent gates, hygiene, commit, PR, stacked-PR rebases |
| `sample-data` | Regenerating the Parker-household fixtures, validating income/expenses/transfers against `expectations.json` (Vitest on Node SQLite + Playwright), extending the household or seeding a new table |
| `feature-program` | Building several features with parallel agents (foundation PR, ownership, merge order) |
| `landing-site` | Updating ptbudget.com, the marketing site in the separate `ptbudget-site` repo: retaking its screenshots from the sample household, showing a new feature in its tour, copy and pricing edits, desktop/phone QA |

## Commands

```bash
npm run worktree:prepare     # fresh worktree: deps, fixtures, branch status, playwright.local.config.ts
npm run dev:unlocked         # dev server at http://localhost:3000 whose database auto-unlocks on every reload — the default for debugging
                             #   (browser pane: preview_start {name: "dev-unlocked"}; gate in src/lib/devUnlock.ts, compiled out of builds)
npm run dev                  # plain dev server (Turbopack): only for work on the setup password step, the unlock screen or key slots
npm run build                # static export to dist/
npm run lint

npm test                     # default post-change verification: unit coverage + e2e smoke
npm run test:unit            # Vitest suite (src/**/*.{test,spec}.{ts,tsx})
npm run test:unit:coverage   # enforces coverage thresholds on src/lib/databaseService.ts
npm run test:unit:watch
npm run test:e2e:smoke       # Playwright tests tagged @smoke (what CI runs)
npm run test:e2e             # full browser suite (tests/e2e/)
npm run test:e2e:headed      # same suite in a visible Chromium window (smoke tests included); picks playwright.local.config.ts
npm run test:e2e:smoke:headed  # only @smoke, visible; extra args pass through: npm run test:e2e:headed -- -g "name"

npx vitest run src/lib/databaseService.test.ts        # single unit test file
npx vitest run -t "test name"                         # single test by name
npx playwright test --config playwright.local.config.ts tests/e2e/database-smoke.spec.ts  # single e2e file

npm run sample-data:generate   # regenerate public/sample-data/ fixtures + expectations.json (schema-aware, non-interactive)
npm run sample-data:validate   # validate fixtures against current schema
npx vitest run src/lib/sampleDataExpectations.test.ts   # prove the app's totals/scans match expectations.json (sample-data skill)
```

Playwright runs Chromium only, one worker, `maxFailures: 1`. The base config targets `http://localhost:3000` (always localhost, not 127.0.0.1) and **reuses whatever dev server owns :3000** — in parallel worktrees that can be another branch, so pass the untracked `playwright.local.config.ts` that `worktree:prepare` writes (own port, `reuseExistingServer: false`).

`sample-data:generate` never prompts; every input is a flag (`--months`, `--seed`, `--reference-date`, `--full-schema`, `--dry-run`, and `--count`/`--transactions`/`--amount` for volume fixtures only; see `--help`), so agents and CI can run it unattended. CI and `worktree:prepare` use `--months=12 --seed=review` (natural mode: one row per household event, newest month first, with the `expectations.json` manifest the validation layers compare against; `--count` turns the manifest off).

## Architecture

### Database layering (the core of the app)

Every database interaction flows through these layers, top to bottom:

```
React components
  → page-facing slice hooks            src/contexts/use<Domain>Slices.ts, re-exported from useDatabaseSlices.ts (preferred in components)
  → domain hooks / provider contexts   src/contexts/DatabaseContext.tsx (wiring only)
  → provider-domain slices             src/contexts/useDatabase<Domain>Slice.ts (mutations + collection refreshes),
                                       useDatabaseCollectionsState.ts (cached collections), useDatabaseInitialization.ts
  → business logic                     src/lib/databaseService.ts + sub-services src/lib/databaseService<Domain>.ts
                                       (SQL orchestration, row mapping, validation, analytics, duplicate detection)
  → SQL text                           src/lib/sqlQueries<Domain>.ts, re-exported from the sqlQueries.ts hub; money in sqlMoneyExpressions.ts
  → transport                          src/lib/databaseWorkerService.ts    (messaging, timeouts, heartbeat, reconnect)
  → execution                          public/database-worker.js           (SharedWorker hosting wa-sqlite + persistence)
```

Shared entity contracts live in `src/types/database.ts`. The `@/` import alias maps to `src/`. New data domains are classes composed into `DatabaseService` (`databaseService.loans`, `.classification`, `.preferences`, `.notifications`, `.aiTools`, `.budgetFunds`, `.appMetadata`); the `new-domain` skill has the full recipe and templates. Loans is the most complete recent example.

**Worker-side code in `public/` is plain untranspiled ES-module JavaScript, not TypeScript** — `database-worker.js`, `database-schema.js`, `database-encryption.js`, `database-encrypted-vfs.js`, `database-key-slots.js`, `database-logger.js` and friends are served as static assets and loaded by the SharedWorker (which survives reloads while any app tab is open). `public/database-schema.js` is the schema source of truth (docs/database-schema.md has the ER diagram, but the JS file wins); the `schema-bump` skill covers migrations.

### Context conventions

- Components use the page-facing hooks from `useDatabaseSlices.ts`, or the domain hooks exported from `DatabaseContext.tsx` (`useDatabaseStatus`, `useDatabaseCollections`, `useDatabaseTransactions`, …). `useDatabaseContext()` is a compatibility aggregator, not the default path.
- `DatabaseProvider` owns initialization and renders the setup gate. Cached collections are provider-backed state; mutations refresh their collections on success — do not add startup refresh effects or redundant manual refreshes in components. Put logic in the domain slice hook, never in `DatabaseContext.tsx`.

### Shell

- Provider composition in `src/app/layout.tsx`: `LoggingProvider` → `LocaleProvider` → `CustomThemeProvider` → `WllamaProvider` → `DatabaseProvider`. `src/app/page.tsx` dynamically imports the shell to avoid SSR issues; `src/components/common/Layout/AppContent.tsx` renders navigation (its header lists the invariants a shell rewrite must keep).
- **Page registry**: `src/components/common/Layout/pageRegistry.tsx` is the one list of top-level pages (`id`, `label`, `icon`, `section`, `order`, `mobileNav`, `hiddenFromNav`, `fullScreen`, `testId`, `render`); a new page is one entry. Every control that navigates to a page carries `data-testid="nav-<id>"` **and** an accessible name equal to the label (e2e clicks `getByRole('button', { name: 'SQL Query' })` and `navigateToPage(page, id)`).
- **Shell slots**, each owned by one feature: `Layout/slots/NotificationBellSlot.tsx`, `Layout/slots/AiLauncherSlot.tsx`, `components/ai/AiPanelProvider.tsx` + `useAiPanel()`, `components/notifications/NotificationsRuntime.tsx` (headless, mounted once), `NotificationsDashboardCard.tsx`, and the Settings tab bodies (`NotificationsSettingsTab.tsx`, `common/Console/DeveloperSettingsTab.tsx`).
- **Page actions and report filters**: a page puts its own controls into the shell with `<PageActions slot="appBar" | "statusBar">` (`Layout/slots/PageActionsSlot.tsx`; inline outside the shell). The report pages (Dashboard, Subscriptions) use `common/Filters/PeriodFilter.tsx` (Filter button in the app bar: optional All time, This week/month/year = calendar, Past week/month/year = rolling to today, custom range; dates from `src/lib/periodRange.ts`) and `common/Filters/ScopeFilters.tsx` (accounts/users section + status-bar chips; the selection lives in `ScopeFiltersProvider` in AppShell so it carries over between those pages). A new report page reuses both instead of its own date chips.
- Components are organized by feature under `src/components/` (accounts, ai, budget, common, csv-import, dashboard, data-management, loans, not-found, notifications, projects, settings, setup, sql-query, subscriptions, transactions, trips) — keep new components in the matching folder, or add a folder for a new domain.
- **Account form**: `src/components/accounts/accountFormModel.ts` + `AccountFormFields.tsx` are the shared field set for the Add/Edit dialog and any inline account form; extend the dialog or the page, not these.
- Theme lives in `src/theme/theme.tsx`. Preserve the existing Material UI visual language unless the task is explicitly a redesign.

### Feature domains

- AI layer: `src/contexts/WllamaContext.tsx` + `useWllamaSlices.ts`, with `src/lib/aiChatService.ts` and `src/lib/aiDatabaseTools.ts`; wllama wasm is served from `public/wllama/`.
- CSV import: `src/lib/csvImportService.ts` + `src/components/csv-import/` — column auto-detection, account matching, temp-table staging (`temp_import_transactions` mirrors `transactions`).
- Transaction classification (schema v4): `src/lib/transactionClassifier.ts` (pure: type rules, transfer pairing across accounts, refund inference) + `databaseService.classification` (`databaseServiceClassification.ts`, SQL in `sqlQueriesClassification.ts`) + `useDatabaseClassificationSlice.ts` / `useClassificationSlices.ts`. It runs on the staged rows during CSV import (`ImportTransferReview`), on demand from the Transactions page (Auto-classify, Type Rules) and once per database on open. `transactions.type` is the only thing analytics read: never filter income by account type again; `type_locked` / `type_source = 'manual'` is a user decision the classifier must not override.
- Loans (schema v5): `src/lib/loanMath.ts` (pure: daily simple interest, principal/interest split with manual overrides, payoff projection, deferred-interest promo status) + `databaseService.loans` (`databaseServiceLoans.ts`, SQL in `sqlQueriesLoans.ts`) + `useDatabaseLoansSlice.ts` / `useLoansSlices.ts`; UI in `src/components/loans/`. Loan-owned match rules (`loan_match_rules`) claim outgoing transactions as `loan_payments`; they run before the subscription scan, which skips loan payments (never a series or an unmatched cluster). The Subscriptions page hosts a Loans section for rule management. A linked loan/credit account gets its computed balance written to `account_balance_snapshots` after every loan mutation; the notifications scan raises `loan_promo_ending` alerts ahead of a deferred-interest pay-by date.
- **Currencies (schema v6)**: `accounts.currency` (ISO 4217) + `exchange_rates` (manual rates into the default currency; NULL = unknown) + `app_metadata` `preferences.defaultCurrency`. `src/lib/currencies.ts` (pure: supported list, display names, `convertToDefault`, `missingRateCurrencies`), `databaseService.preferences` (default currency with rate rebasing, rate CRUD; SQL in `sqlQueriesPreferences.ts`), cached as `collections.currencyPreferences` via `useDatabasePreferencesSlice.ts` / `usePreferencesSlices.ts` (`useCurrencyPreferencesSlice`). `sqlMoneyExpressions.ts` multiplies every money row by `rateExpr` (a correlated subquery; the default currency rates 1, unknown rates make the row NULL so `SUM` skips it) — every aggregate inherits conversion without query edits. UI: setup `PreferencesSetup` step (skippable), Settings → Preferences (`PreferencesSettingsTab`, `ExchangeRatesEditor`), dashboard `MissingRatesNotice`, `CurrencySelect` / `LanguageMenu` in `src/components/common/`. Budget plans, income sources and project/trip costs are amounts in the default currency and are never converted.
- **Statement import (schema v7, being built by the Import Wizard program)**: a pure pipeline in `src/lib/statementImport/` (`readStatement` bytes → `StatementTable`, `proposeLayout` → column roles / date order / decimal / sign, `analyzeStatement` → normalised rows plus the issue catalog in `issueCodes.ts`; contract in `types.ts`, shared parsers in `shared/`) + `databaseService.imports` (`databaseServiceImports.ts`, SQL in `sqlQueriesImports.ts`: saved layouts in `import_profiles`, what files call an account in `account_identifiers`, account resolution, staging, commit, history) + `useDatabaseImportsSlice.ts` / `useImportsSlices.ts` (`useImportWizardSlice`, `useImportManageSlice`). UI: the full-screen `import` page (`src/components/import-wizard/ImportPage.tsx` with `wizard/` and `manage/`). Rules: the file decides the date order and decimal separator, never the UI language, and one file is read with one date order (`parseCsvDate(…, { strict: true })`); only a full account number is "recognised", everything else is an assumption shown for confirmation; fixtures live in `tests/fixtures/statements/` (synthetic data only, byte-exact). Until the wizard lands, the old dialog (`src/components/csv-import/`, `csvImportService.ts`) is still what users reach.
- Encryption (envelope / key slots, see `docs/Encryption.md`): a random root key encrypts the live pages (`public/database-encrypted-vfs.js`) and exports; every unlock method is a key slot wrapping that root key (`public/database-key-slots.js`: exactly one master slot — password or 12-word recovery phrase — plus optional passkey/cloud slots). `public/database-encryption.js` is the archive envelope (format v2, master slot embedded). The page never holds key material: `src/lib/encryptionTypes.ts` has the contracts, `src/lib/databaseEncryption.ts` only reads archive headers (parity-tested against the worker module), `src/lib/recoveryPhrase/` decodes the BIP-39 words to the 16 entropy bytes the worker gets. Changing the master re-wraps 32 bytes; nothing is re-encrypted. Header/archive v1 are rejected (reset), and `scripts/convert-archive-v1-to-v2.mjs` re-wraps old fixtures. Passkeys (WebAuthn PRF): `src/lib/passkeyUnlock.ts` runs the ceremony on the page (user verification always required; the 32-byte PRF output goes to the worker's `add_slot` / `unlock_database`; codes `PASSKEY_CANCELLED|PASSKEY_PRF_UNSUPPORTED|PASSKEY_FAILED`). `UnlockScreen` leads with the passkey view when slots exist, `PasskeySlotsSection` (Settings → Security) manages them, and `src/lib/lastUnlockMethod.ts` remembers the last slot type (auto-trigger only after Settings → Lock).
- 404 page: `src/app/not-found.tsx` → `src/components/not-found/` (static export writes `dist/404.html`; it sits outside `(main)`, so it never boots the database worker): a seeded pixel galaxy (`src/lib/pixelGalaxy.ts`), a SMIL winged-money flock and a local-only "flight recorder" of where the visitor came from (`notFoundOrigin.ts`, nothing sent). The 💸 art is one shared sprite (`pixelMoneySprite.json/.ts`) also used by `WingedMoneySprite.tsx` / `AppLogo.tsx` (sidebar rail, phone app bar, Welcome screen); re-run `npm run favicon:generate` after editing it. Under `prefers-reduced-motion` the animation is calmed, not frozen.

### Cross-cutting rules

- **i18n**: `i18next` in `src/lib/i18n.ts`, nine languages (`en-US` source/fallback, `es`, `fr`, `de`, `zh`→zh-CN, `ja`, `ko`, `pt`→pt-BR, `it`), bundles in `src/locales/<lang>/<namespace>.json` (conventions in `src/locales/README.md`, terms in `GLOSSARY.md`). Keys are typed from the English JSON and `src/locales/locales.test.ts` checks every language against it. **No new hard-coded user-facing strings**: every label/message goes through a key whose English value is copied verbatim (tests match English text), in all nine languages. The language is a device preference (`localStorage` `budgetTracker_language`), never `navigator.language`. Details: `i18n` skill.
- **Formatting**: never `Intl.NumberFormat`/`toLocaleString` with a hard-coded locale or currency in components; use `useFormatters()` (`money`, `number`, `percent`, `date`, `month`, `dateTime`, `symbol`) or the pure helpers in `src/lib/formatting.ts`. A single transaction/account/loan amount is shown in its account's currency (`account_currency`); cross-account totals arrive converted from SQL and use `money(total)`.
- **Logging**: `import { logger } from '@/lib/logging'`; `const log = logger.child({ component: 'Name' })`; `log.info('msg', { operation: 'x', error })`; `log.withOperation('x')` adds a fresh correlation id. Page and worker records share the `ptbudgetapp-logs` IndexedDB; `?debug` captures debug level, `?debug_output_console=true` echoes to the console (`src/lib/debugMode.ts`). No new `console.*` in `src/lib` or `src/contexts`. The Developer Console is a real product surface, not a temporary debug tool.
- **App version**: the status-bar footer prints `v` + `NEXT_PUBLIC_APP_VERSION`, resolved once per build by `next.config.ts` with the pure rules in `src/lib/appVersion.ts`: a build of `main` (app.ptbudget.com) shows the release tag (`vX.Y.Z`) pointing at the built commit, everything else (dev.ptbudget.com, previews, local) the short commit hash, and the `APP_VERSION` build variable overrides both. Cloudflare checkouts carry no tags, so a CI build of `main` looks the tag up with `git ls-remote --tags origin`.
- **`app_metadata` keys** are namespaced per feature (`notifications.*`, `ai.*`, `logging.*`, `preferences.*`); `ai.provider.config` holds AI provider profiles including API keys (encrypted DB, never localStorage).
- **Parallel feature programs** freeze the shared hubs (`sqlQueries.ts`, `src/types/database.ts`, `DatabaseContext.tsx`, `useDatabaseCollectionsState.ts`, `useDatabaseSlices.ts`, `public/database-schema.js`) while they run. **The Import Wizard program is active**: see "Feature-program conventions" below and the `feature-program` skill.
- wa-sqlite API reference: https://rhashimoto.github.io/wa-sqlite/docs/index.html

## Feature-program conventions (Import Wizard program, active)

Five agents build the Import Wizard in parallel on top of the foundation PR (schema v7, the contract, a working
skeleton). The integration pass removes this section when the last PR is in.

**Frozen: no agent edits these.** A change you need here is a missing seam: stop and report it to the coordinator,
who lands it as a foundation patch first. Don't work around it.
- The usual hubs: `public/database-schema.js`, `src/types/database.ts`, `src/lib/sqlQueries.ts`,
  `src/contexts/DatabaseContext.tsx`, `src/contexts/useDatabaseCollectionsState.ts`, `src/contexts/useDatabaseSlices.ts`,
  `src/components/common/Layout/pageRegistry.tsx`, `src/lib/i18n.ts`.
- The import contract: `src/lib/statementImport/types.ts`, `index.ts`, `shared/**`, `testing/**`,
  `src/components/import-wizard/ImportPage.tsx` (the props of the two views), and the public method signatures of
  `ImportsService` and `DatabaseImportsSlice`.
- Read-only for everyone: `src/lib/databaseService.ts`, `databaseServiceClassification.ts`, `transactionClassifier.ts`,
  the loans files, `src/lib/dateOnly*.ts`.

**Ownership** (an agent edits only its own rows):

| Agent | Branch | Owns |
|---|---|---|
| A Readers | `feature/import-readers` | `src/lib/statementImport/readers/**`, `tests/fixtures/statements/raw/**`, the `#region reader codes` block of `issueCodes.ts` |
| B Interpretation + analysis | `feature/import-analysis` | `src/lib/statementImport/interpret/**`, `ai/**`, `issueCodes.ts` (rest), `corpus.test.ts`, `pipeline.test.ts`, `tests/fixtures/statements/layouts/**`, `src/locales/*/importIssues.json` |
| C Import data | `feature/import-data` | `src/lib/databaseServiceImports.ts` (+ test), `src/lib/sqlQueriesImports.ts`, `src/contexts/useDatabaseImportsSlice.ts`, `src/contexts/useImportsSlices.ts` |
| D Wizard flow | `feature/import-wizard-ui` | `src/components/import-wizard/wizard/**`, `src/locales/*/importWizard.json`, `tests/e2e/import-wizard.spec.ts`, `tests/e2e/import-flow.spec.ts`, `tests/e2e/helpers/importFlow.ts`; the shell rewiring (`AppShell.tsx`, `SidebarRail.tsx`, `MobileBottomNav.tsx`, `AppContent.test.tsx`, `shell:nav.importCsv`); removing `src/components/csv-import/**`, `csvImportService.ts`, the `csvImport` namespace (and its `i18n.ts` registration) and `tests/e2e/csv-import.spec.ts`; the import steps of `transfer-classification.spec.ts` and `landing-screenshots.spec.ts` |
| E History & saved formats | `feature/import-manage` | `src/components/import-wizard/manage/**`, `src/locales/*/importManage.json`, `tests/e2e/import-manage.spec.ts` |

**Merge order: C → A → B → D → E.** Each agent rebases onto `devel/latest` after the PR before it merges, reruns its
gates on its own Playwright port, and never merges its own PR.

**Rules of the build**
- Decisions are made: the plan's decisions table (D1–D16) answers product questions. Ask the coordinator, don't re-decide.
- Every issue the analysis can report is a code in `issueCodes.ts` with a text in `importIssues` (`issues.<code>.title`
  / `.detail`, `assumptions.<code>`); the wizard renders codes, never its own wording for a finding.
- Specs that only need imported rows call `importStatementFile` (`tests/e2e/helpers/importFlow.ts`), never the import UI.
- No new dependency without the coordinator's say-so (PapaParse and date-fns are there; OFX is parsed by hand).

## Conventions and Gotchas

- **Client-only app**: check for browser-only APIs and SSR boundaries before adding runtime logic. SharedWorker support is required for the primary experience. A `Document-Isolation-Policy: isolate-and-require-corp` header is set in `next.config.ts` for multi-threaded wasm (crossOriginIsolated on Chromium 137+; other browsers fall back to single-threaded wllama). COOP/COEP is deliberately **not** used — COOP: same-origin severs the cloud-auth popup's window references (see `src/lib/cloudAuthPopup.ts`). Static-export hosts must send the equivalent header.
- **Amount sign convention**: negative = expense, positive = income.
- **Duplicate detection** is hash-based (SHA-256) from account id, date, amount, and description data.
- **The SQL Query page is intentionally read-only** (`SELECT` only; use table-valued pragmas such as `pragma_table_info('t')`). Mutations in tests or manual validation must go through real UI flows.
- **Vitest runs in the `node` environment by default** (see `vitest.config.ts`); component/hook tests opt into jsdom with a `// @vitest-environment jsdom` pragma at the top of the file. Setup lives in `src/test/setup.ts`. Service tests stub the transport (`new DatabaseService({ query } as DatabaseWorkerTransport)`).
- Coverage enforcement centers on `src/lib/databaseService.ts` (80 lines / 60 branches / 95 functions; HTML report at `coverage/index.html`).
- **Debugging in the browser pane**: start the app with `preview_start {name: "dev-unlocked"}` so reloads and Fast Refresh never stop at the unlock screen; plain `dev` only when the password or unlock flow itself is under test. Stop the preview server before running Playwright in the same worktree (two `next dev` processes share `dist/`). Procedure and symptom table: `debug-app` skill.
- **E2E**: use the helpers in `tests/e2e/helpers/bootstrap.ts` (`bootstrapDatabase`, `reloadAndUnlock` after every reload — the worker drops the encryption key —, `navigateToPage`, `runQueryAndReadFirstCell`). Patterns and failure triage: `e2e` skill.
- **Landing site**: `tests/e2e/landing-screenshots.spec.ts` is not a test. It takes the screenshots for ptbudget.com (the separate `ptbudget-site` repo), is skipped unless `LANDING_SHOTS_DIR` is set, and is run through `.claude/skills/landing-site/scripts/landing-site.mjs capture`. When a change renames a label, test id or flow that it drives, update its step too; the site's screenshots go stale whenever visible UI changes (`landing-site` skill).
- **Sample data**: `?loadSampleData` bootstraps sample data during new-database creation (`src/lib/sampleDataService.ts`, `public/sample-data/`). The set is the Parker household (`scripts/lib/sample-data-household.mjs`: four users, eleven USD accounts, transfers, refunds, loans with match rules, subscription-like fixed charges, projects, trips, budget plans and funds), emitted raw so the app's own scans classify it; the date-dependent fixtures (transactions, accounts, projects, trips, budgets, income sources, loans, rules, snapshots, `expectations.json`) are generated and gitignored, only users/cards/categories/companies are committed. `?dev=true` enables developer-only sample-data export tooling. Regenerate with the scripts rather than hand-editing JSON, revert churn in the committed four unless the schema changed, and keep the invariants listed in the `sample-data` skill (account ids 1–4 and names, cards ending 4821, the intentionally unlinked auto loan).
- Tool-rewritten tracked files: `test-results/.last-run.json` (every Playwright run) and the committed `public/sample-data/*.json` (every generator run) — restore them before committing.

## GitHub Strategy
- **Branches**: `main` is the production branch; `devel/latest` is the latest integration branch for feature work and the GitHub default. Feature branches are named `feature/<short-description>`.
- All PR merges must be squashed and rebased onto `devel/latest` (or `main` for hotfixes). Do not merge `main` into feature branches; rebase instead.
- **Releases**: `main` deploys to app.ptbudget.com (a coming-soon placeholder until the first release), `devel/latest` to dev.ptbudget.com. A release pushes `devel/latest` to `main` and tags that commit `vX.Y.Z`. Push the tag in the same `git push` as the branch (or re-run the Cloudflare build after tagging): the footer shows the tag only if it exists when the build starts, otherwise the commit hash.
- **Do not offer Auto-fix** (the desktop app's PR monitor) after `/ship` or opening a PR, until the owner says the app is live. Bind the PR and report CI as usual; leave Auto-fix and auto-merge off.
