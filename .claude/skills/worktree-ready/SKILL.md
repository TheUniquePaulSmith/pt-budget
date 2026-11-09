---
name: worktree-ready
description: Gets a budgetApp-v2 checkout into a state where builds and tests can be trusted — installs node_modules, provisions the gitignored generated sample-data fixtures (transactions, accounts, loans, rules, budgets, expectations.json and the rest), reports the branch against devel/latest, and gives the worktree its own Playwright port and local config. Use this at the start of every session in a .claude/worktrees checkout (before the first npm run dev, vitest or Playwright run), and whenever you see a Turbopack "Next.js package not found" panic, missing public/sample-data/*.json, sample-data bootstraps importing 0 transactions, an empty "This Month" dashboard, cloud buttons rendered disabled in e2e, or e2e failures showing UI that is not on this branch.
---

# Worktree ready

Many parallel sessions share this repo. A fresh worktree is missing things that the
tests depend on, and when those things are missing the tests usually fail in confusing
ways rather than saying what is wrong. Each item below has cost a session real time:

| Missing piece | What it looks like |
|---|---|
| `node_modules` | `npm run dev` panics: `FATAL: An unexpected Turbopack error occurred … Next.js package not found`. Builds and vitest can still resolve from the parent checkout, which hides the problem. |
| Generated fixtures (`transactions`, `accounts`, `projects`, `trips`, `budget_plans`, `budget_plan_categories`, `income_sources`, `loans`, `loan_match_rules`, `classification_rules`, `account_balance_snapshots`, `expectations` in `public/sample-data/`, all gitignored) | `?loadSampleData` imports 0 rows or no accounts; `sampleDataTools.test.ts` fails; `sampleDataExpectations.test.ts` skips. |
| Fixtures dated before the current month | The dashboard shows an empty "This Month", the `database-smoke` reopen count is 0, and the `mobile-dashboard` pie never renders. |
| Own Playwright port | `reuseExistingServer: true` on `:3000` quietly tests **another worktree's** dev server, and the cloud specs fail because the dummy client ids only get injected when Playwright starts the server itself. |
| Branch behind `devel/latest` | Code a task refers to "doesn't exist", or a fix "that was just merged" is missing. |

## Run it

```bash
node scripts/prepare-worktree.mjs
```

It is idempotent, so rerun it whenever you are unsure. Each step prints `OK`, `FIXED`, `WARN` or `FAIL`,
and it exits 1 if anything fails. Options:

- `--check`: report only, change nothing (fast; use it to diagnose).
- `--offline`: skip `git fetch`.
- `--no-install`: never run `npm ci`.
- `--regenerate-fixtures`: regenerate the sample data even if the files look fine.
- `--port=<n>`: pick the Playwright port yourself.
- `--json`: also print machine-readable results.

`npm ci` takes a few minutes. Run the script in the background and keep reading the code in the meantime.

## What it does and does not change

- It **writes** `node_modules/`, the gitignored generated fixtures, and `playwright.local.config.ts`. It also adds that
  config to the shared `.git/info/exclude` so it is never committed.
- It regenerates fixtures with the CI flags (`--months=12 --seed=review`): twelve months of natural household rows
  (about 60 a month, newest first so the e2e import caps keep the recent months) plus `expectations.json`. Fixtures
  count as stale once their newest row is outside the current month. If the generator rewrites a *committed* fixture
  that was clean beforehand, the script restores it, so only a deliberate schema change shows up in `git status`.
  The `sample-data` skill covers what the set contains and how to validate it.
- It **never** rebases, merges, stashes or switches branches. For the branch step it only prints the safe next move:
  - `0 ahead` and a clean tree: `git merge --ff-only origin/devel/latest` cannot go wrong.
  - Behind with your own commits: in the Claude desktop app, use the `sync_with_base_branch` tool. Elsewhere, rebase onto
    `origin/devel/latest` (repo policy is rebase, never merge `main` in).
  - Never `git stash` here. The stash stack is shared with every worktree.

## Reading the result

- `checkout FAIL … stale 'main' prototype`: the worktree was cut from `main`. `origin/main` has unrelated history
  and the old `budget-tracker/src` layout, and the real app lives on `devel/latest`. Don't try to recreate missing
  files by hand; ask the user to recreate the worktree from `devel/latest`.
- `checkout WARN … primary checkout`: `C:/source/budetApp-v2` itself often holds other sessions' uncommitted WIP.
  Reading it is fine. Ask before editing it.
- `port WARN … currently in use`: probably this worktree's own dev server from an earlier run. Stop it, or pass `--port`.
- `hygiene WARN`: `test-results/.last-run.json` and the committed fixtures are rewritten by tools. Restore them before
  committing unless the change is intentional (the `ship` skill does this too).

## After it says READY

- Run e2e through the local config: `npx playwright test --config playwright.local.config.ts …`. The `e2e` skill covers
  running and reading results.
- The browser pane's `preview_start {name: "dev-unlocked"}` (default for debugging: the database auto-unlocks on every
  reload) and `{name: "dev"}` (plain server, for password/unlock-screen work) use `.claude/launch.json` (port 3000; it
  moves to 3001 when 3000 is busy). Either is fine for manual looks, but neither is the server Playwright uses — and
  stop it before running Playwright in the same worktree, since two `next dev` processes share `dist/`.
