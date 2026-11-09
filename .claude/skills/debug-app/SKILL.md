---
name: debug-app
description: Debugs budgetApp-v2 in the running browser app — SharedWorker + wa-sqlite + encrypted VFS, structured logs with correlation ids, read-only SQL inspection, and the dev/debug URL flags and test hooks. Use it whenever behavior in the app is wrong or confusing, a bug report describes something seen in the UI, the database never reports Connected, data looks missing or stale, a change to public/database-worker.js (or any public/*.js) seems to have no effect, the app lands on an unlock screen unexpectedly, or you need to verify a fix in the browser pane rather than only in tests.
---

# Debugging the running app

The app has no backend. Your evidence comes from four places:
1. The structured logs, which the page and the worker both write into one IndexedDB with correlation ids.
2. The database itself, read through the read-only SQL page.
3. The DOM.
4. A failing unit test at the layer that is wrong.

Work through the loop below in order. Jumping straight to edits is how this codebase's worst bugs got fixed twice.

## The loop

1. **Make sure you're debugging the right code.** Run `node scripts/prepare-worktree.mjs --check` (wrong checkout,
   missing deps, stale fixtures). Check which server the pane shows: `preview_start {name: "dev"}` is port 3000, or 3001 when
   3000 is busy, and 3000 may belong to *another worktree*. If unsure, add a temporary `data-testid` and look for it.
2. **Reproduce with logging on.** Open `/?debug&debug_output_console=true`:
   - `?debug` captures debug-level logs (page and worker, through `set_debug`) and shows debug-only UI such as Reset App.
   - `debug_output_console=true` echoes every record to the console, so `read_console_messages` sees it.
   - `?dev=true` shows the sample-data export tools.
   - `?loadSampleData` seeds new databases on create.
3. **Read the evidence** (snippets in `references/snippets.md`):
   - Logs: the Developer Console page (`nav-developer-console`) can filter by page, level, text and correlation id, and
     exports `logs-<date>.ndjson` plus a `.txt` timeline. Or read `ptbudgetapp-logs` directly with `javascript_tool`.
     It isn't encrypted, so it works before unlock.
   - Click a correlation id to see one operation across page → transport → worker.
   - Database: the SQL Query page accepts `SELECT` only. Use table-valued pragmas: `pragma_user_version`,
     `pragma_table_info('t')`, `pragma_index_list('t')`, `pragma_foreign_key_check`.
   - DOM: prefer `read_page` / `get_page_text` / `find`. Screenshots in the browser pane have timed out on this
     machine; take one only as final proof.
4. **Find the layer.** component → `use*Slices` → `useDatabase*Slice` (refreshes) → `databaseService.<domain>` (mapping,
   validation) → `sqlQueries*` → `databaseWorkerService` (timeouts, heartbeat, reconnect) → `public/database-worker.js`.
   The log `component` field tells you which layer spoke last.
5. **Pin it with a failing test** at that layer before fixing: a service test with the transport stub
   (`new DatabaseService({ query } as DatabaseWorkerTransport)`), a pure-module test, or a jsdom hook test. UI-flow bugs get an e2e spec.
6. **Fix, then verify in the browser**, and run the touched tests.

## Symptom → usual cause

| Symptom | Usual cause / first check |
|---|---|
| Unlock screen after a reload or HMR | The SharedWorker was torn down and dropped the in-memory VFS key. Expected behavior: unlock again. Adding locale JSON or editing during setup causes a Turbopack full reload. To stop it happening at all while you work, run the server as `preview_start {name: "dev-unlocked"}` / `npm run dev:unlocked`: the database is created with and unlocked by a per-clone dev secret (`src/lib/devUnlock.ts`; never in builds). A database created under plain `npm run dev` with your own password still asks for it. |
| Unlock screen never appears under `dev-unlocked` though you want to test it | That is the point of that server. Use `preview_start {name: "dev"}` for lock-screen work, or Settings → Lock, which is not overridden. |
| Never reaches `Connected` | Worker failed to start or migrate. Read `error` level logs where `context.source` is `worker`. A syntax error in `public/*.js` only appears in the worker's own console (not the page's), so check the logs and the `Failed to` entries. |
| Change to `public/database-worker.js` (or `database-schema.js`, `database-encryption.js`, key slots, VFS) has no effect | The SharedWorker survives reloads while **any** tab on that origin is open. Close every app tab (or navigate them all away), then reopen. In real Chrome, `chrome://inspect/#workers` → terminate. With `?debug`, Settings → Developer → Reset App terminates it too (and wipes data). |
| Behaves like old code / UI not on this branch | Another worktree's dev server owns the port. |
| Dashboard "This Month" empty, pies missing | Sample data dated before the current month (regenerate with `prepare-worktree --regenerate-fixtures`), or a `sampleDataTransactionLimit` so small that even the newest rows (fixtures are newest-first) miss the month. |
| Google Drive / OneDrive buttons disabled | No `NEXT_PUBLIC_*_CLIENT_ID` in the dev server env. |
| Cloud auth popup hangs for 5 minutes | Popup → opener messaging broke. See `src/lib/cloudAuthPopup.ts`; COOP is deliberately not set. |
| Wrong totals with several currencies | A missing exchange rate makes that row NULL, so `SUM` skips it (by design; the dashboard shows `MissingRatesNotice`). Check `exchange_rates`. |
| Transaction type "won't change" | `type_locked = 1` / `type_source = 'manual'` is a user decision the classifier must not override. |
| Hydration warning on the setup gate | Pre-existing (density/emotion), dev-only. Not your bug unless it changed. |

## Hooks and state

- `window.__budgetTrackerTestApi` (dev builds only): `disconnectWorker()`, `cancelSampleDataImport()`,
  `cloudSync.{getSchedulerState(), syncNow(), injectGoogleToken(token, expiresAtMs)}`.
- IndexedDB: `ptbudgetapp-v2-encrypted` (the database pages), `ptbudgetapp-keys`, `ptbudgetapp-logs` (logs: store `entries`,
  indexes `ts` and `correlationId`).
- localStorage keys worth knowing: `budgetApp_browserTestPassed`, `budgetTracker_language`, `budgetTracker_lastUnlockMethod`,
  `budgetTracker_sidebarExpanded`, `budgetTracker_themeDensity`, `budgetTracker_themePreset`, `ptbudget.logs.retention`.
- For a first-run test, wipe all of it (snippet). The in-app browser pane keeps an old encrypted database on
  `localhost:3000` across sessions.

## Adding diagnostics

- `import { logger } from '@/lib/logging'`, `const log = logger.child({ component: 'Name' })`, then
  `log.info('msg', { operation, … , error })`. `log.withOperation('x')` starts a new correlation id. No new `console.*` in
  `src/lib` or `src/contexts`.
- The worker logs through its own facade (`public/database-logger.js` mirrors `src/lib/logging/logDatabase.ts`; keep them in sync).
- The Developer Console is a real product surface. Leave useful log lines in, at the right level (debug for noisy ones).
