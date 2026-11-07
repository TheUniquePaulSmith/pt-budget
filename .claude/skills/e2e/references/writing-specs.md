# Writing e2e specs

## Helper catalog: `tests/e2e/helpers/bootstrap.ts`

| Helper | Use |
|---|---|
| `bootstrapDatabase(page, opts?)` | Creates the database through the real setup flow and waits for `database-status-text` = `Connected`. Defaults: `?loadSampleData&sampleDataTransactionLimit=500`, password `TEST_PASSWORD`, user `TestUser`. Options: `loadSampleData: false`, `sampleDataTransactionLimit`, `masterType: 'recovery'` (returns `recoveryWords`), `extraQueryParams` (e.g. `'syncDebounceMs=1000'`). The flow is: Create New Database → password **or** recovery phrase → `skip-preferences` → `skip-initial-account` → `storage-choice-local`. If you add a setup step, update this helper; don't patch individual specs. |
| `reloadAndUnlock(page, secret?)` | Every reload. It re-enters the password or recovery words when the SharedWorker was torn down, and is a no-op when another page kept the worker alive. Never use a bare `page.reload()`. |
| `seedBrowserCompatibility(page)` | Skips the browser-compatibility test screen (already called by `bootstrapDatabase`). Call it yourself before `page.goto` in specs that load an archive rather than bootstrapping. |
| `fillDatabaseSetupForm`, `completeRecoveryPhraseSetup` | Building blocks for specs about setup itself. |
| `navigateToPage(page, id)` | Works on the desktop rail (expanded or collapsed), the phone bottom bar and the phone "More" sheet. `AppPageId` mirrors `pageRegistry.tsx`; add the new id there when you add a page. |
| `openMobileMoreSheet`, `toggleSidebar` | Shell helpers. |
| `runQuery(page, sql)` / `runQueryAndReadFirstCell(page, sql)` | Read-back through the SQL page (CodeMirror `.cm-content` + DataGrid `gridcell`). |
| `TEST_PASSWORD`, `TEST_PRIMARY_USER_NAME` | Constants. Never hardcode them. |

Other helpers: `helpers/cloudMock.ts` (Playwright route mocks for Google Drive / OneDrive, used by `cloud-sync.spec.ts`
and `auth-popup.spec.ts`).

## Locators

- Prefer `getByRole(…, { name })` and `getByLabel` with the **English** text, or `getByTestId`. Add a `data-testid` to
  the component when the visible text is ambiguous or repeated.
- `{ exact: true }` whenever the name is a prefix of another name ('Password' vs 'Confirm Password', 'Budget' vs 'Manage budget').
- The Add Transaction dialog selects are labeled: `getByRole('combobox', { name: 'Account' })`.
- MUI X DataGrid: rows are `getByRole('row')` and cells are `getByRole('gridcell')`. There is no `<table>/<tbody>`.
  `AppDataGrid` sets `columnBufferPx=2400`, so off-screen action columns stay in the DOM.
- Charts: pie slices are `[class*="MuiPieArc"]`. Entry animations take about 600 ms, so wait for the assertion, not a fixed delay.

## Read-back through SQL

The SQL page accepts `SELECT` only. Table-valued pragmas work where `PRAGMA` statements don't:

```ts
expect(await runQueryAndReadFirstCell(page, 'SELECT user_version FROM pragma_user_version')).toBe('6');
expect(await runQueryAndReadFirstCell(page, "SELECT COUNT(*) FROM pragma_table_info('loans') WHERE name = 'promo_end_date'")).toBe('1');
```

Use read-back to assert what the UI flow persisted. Never use it to set up state.

## Viewports

- Mobile: bootstrap at the default desktop viewport first (`bootstrapDatabase` waits for the desktop 'SQL Query' button,
  which is hidden below `md`), then `page.setViewportSize({ width: 390, height: 844 })`.
- Horizontal overflow check: `document.documentElement.scrollWidth <= clientWidth`.
- The docked AI sidebar only appears when `viewport − 440 ≥ 1200`, so sidebar specs use `{ width: 1700, height: 900 }`.

## Origins and mocks

Derive the app origin from the page (`new URL(page.url()).origin`); don't hardcode `localhost:3000`, because local configs
use other ports. Route mocks intercept every provider request, so no spec contacts a real identity provider.

## Fixtures

- `tests/e2e/fixtures/*.csv`: CSV import inputs.
- `v1-budget-tracker.zip`, `v2-budget-tracker.zip`: encrypted archives from older schema versions (password `TEST_PASSWORD`),
  loaded by `database-upgrade.spec.ts`. Regenerating them is covered by the `schema-bump` skill.
- Sample data comes from `public/sample-data/` (the Parker household; the `sample-data` skill describes it). Rows are
  written newest-first, so the import cap (500 by default via `sampleDataTransactionLimit`) keeps the most recent
  months and drops the oldest; a spec that needs the whole year passes a higher cap. Seeded state a spec may meet:
  three loans (the auto loan has no payment rule), four user classification rules, no notifications, no series until
  a Rescan.

## WebAuthn / passkeys

`passkey-unlock.spec.ts` uses Chromium's CDP virtual authenticator (`WebAuthn.enable`, `addVirtualAuthenticator` with
`hasPrf: true`, `transport: 'internal'`, `isUserVerified: true`). After `setUserVerified(false)` makes one assertion fail,
every later `get()` on that authenticator fails too, even after you turn verification back on. Put the failed-UV check last.

## Worker recovery

`window.__budgetTrackerTestApi.disconnectWorker()` (dev builds only) simulates a dead worker. Follow it with a full
reload (`reloadAndUnlock`). The API also exposes `cancelSampleDataImport()` and `cloudSync.{getSchedulerState, syncNow, injectGoogleToken}`.

## Checklist for a new spec

1. File name: `tests/e2e/<feature>.spec.ts`. Tag one fast happy path with `@smoke` if the feature is core.
2. `bootstrapDatabase` → navigate → act through the UI → assert in the UI → optionally read back via SQL.
3. Any reload goes through `reloadAndUnlock`.
4. Run it alone, then with the smoke set, through the local config.
5. `git checkout -- test-results/.last-run.json`.
