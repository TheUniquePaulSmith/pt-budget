---
name: e2e
description: Runs, writes and debugs this app's Playwright end-to-end tests (tests/e2e/*.spec.ts) without the traps that make results lie — the shared :3000 dev server, hidden exit codes, Fast Refresh reloads mid-run, SharedWorker key loss on reload, and tracked files the runner rewrites. Use it whenever you run npm test / test:e2e / test:e2e:smoke / npx playwright, add or change a spec or tests/e2e/helpers, investigate a failing or flaky e2e test, or need to verify a UI change end to end — even if the user just says "run the tests" or "check it works".
argument-hint: "[spec file or --grep pattern]"
---

# E2E tests (Playwright)

Facts about the setup:
- Chromium only, `workers: 1`, `maxFailures: 1`.
- `playwright.config.ts` targets `http://localhost:3000` with `reuseExistingServer: true`, and that file is frozen.
- Specs tagged `@smoke` in the test title make up `npm run test:e2e:smoke`, which is what CI runs.
- The full suite takes several minutes.

## 1. Before running

Run `node scripts/prepare-worktree.mjs` (the `worktree-ready` skill) if this session hasn't yet. It gives the worktree
`playwright.local.config.ts`: a free per-worktree port with `reuseExistingServer: false`. Always pass that config.
Without it, whichever session started `npm run dev` on :3000 first gets tested, and that may be another branch's code.

## 2. Running

```bash
LOG="<session scratchpad dir>/e2e-$(date +%H%M%S).log"   # never inside the repo
npx playwright test --config playwright.local.config.ts tests/e2e/loans.spec.ts > "$LOG" 2>&1; echo "exit=$?"
tail -40 "$LOG"
```

- Send output to a log file and check `exit=`. Piping into `tail` or `head` reports *their* exit code, so a failed run looks green.
- The summary line counts "failed" and "did not run". With `maxFailures: 1` the run stops at the first failure, so
  "N did not run" means "not tested", not "passed".
- Use `--grep @smoke` for the smoke set, `-g "test name"` for a single test, `--debug`/`--ui` only when a human is watching.
- Anything that takes more than a minute or two (the full suite, the smoke set): run it in the background and wait for the
  completion notice, instead of polling.
- Don't edit source files while a run is in progress. Next Fast Refresh does a full page reload mid-test, and the
  spec then times out at a random bootstrap step. If you edited during a run, rerun before suspecting the code.
- Specs that need fresh server env: `auth-popup.spec.ts` and `cloud-sync.spec.ts` need the dummy
  `NEXT_PUBLIC_*_CLIENT_ID` values, which only exist when Playwright starts the server itself. The local config always does that.

## 3. After running

```bash
git checkout -- test-results/.last-run.json
```

That file is tracked and every run rewrites it. Don't commit it.

## 4. Reading a failure

Look in `test-results/<spec>-<test>-chromium/`: `error-context.md` (an accessibility snapshot of the page at failure),
`test-failed-1.png`, and `video.webm`. Then:

1. **Is it even your code?** If the snapshot shows UI that isn't on this branch, the run hit someone else's server.
   Rerun with the local config.
2. **Timed out at a random bootstrap step** (`storage-choice-local`, `skip-preferences`, …) right after you edited a file:
   Fast Refresh. Rerun untouched.
3. **Stuck on an unlock screen after `page.reload()`**: the SharedWorker dropped the in-memory page-encryption key.
   Use `reloadAndUnlock(page)`.
4. **"strict mode violation: resolved to 2 elements"**: the locator is ambiguous. Common ones: `getByLabel('Password')`
   also matches "Confirm Password", and nav 'Budget' also matches 'Manage budget'. Use `{ exact: true }` or a test id.
5. **Empty charts, `COUNT(*) = 0`, a missing `MuiPieArc`**: stale or missing sample data. Run `prepare-worktree --regenerate-fixtures`.
6. **Cloud buttons disabled**: the server wasn't started by Playwright (see above).
7. **Passes alone, fails in the suite**: state is leaking between tests in the same worker. Every test gets a new context,
   but a failed WebAuthn UV assertion poisons the virtual authenticator (see the reference).

Then reproduce the narrowest case: a single test with `-g`, and add `--headed` only if you can look at it.

## 5. Writing or changing a spec

Read `references/writing-specs.md` before writing a spec or touching a helper. It covers the helper catalog in
`tests/e2e/helpers/bootstrap.ts`, locator rules (labels and test ids, DataGrid roles), the mobile-viewport pattern, the
SQL-page read-back pattern, fixtures, and tagging.

The rules that matter most:
- Drive mutations through the real UI. The SQL Query page is `SELECT`-only by design; use it only to *read back* state.
- Start every spec with `bootstrapDatabase(page)`, and follow every reload with `reloadAndUnlock(page)`.
- Navigate with `navigateToPage(page, '<registry id>')`. Every nav control has `data-testid="nav-<id>"` and an accessible
  name equal to its label.
- Tests match **English** text. The app language is a device preference that defaults to en-US, so don't set it in e2e
  unless the test is about localization.
- Add `@smoke` to a test title only for a fast, high-value path. CI runs every `@smoke` test on every PR.
