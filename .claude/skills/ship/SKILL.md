---
name: ship
description: Takes finished budgetApp-v2 work to a pull request on devel/latest — runs the same gates as CI locally, cleans the tracked files the tools rewrite, checks repo rules (i18n, logging, frozen hubs, docs), commits, pushes and opens the PR with gh, and handles rebasing stacked PRs after a squash merge. Invoke with /ship when the work is done and the user wants it committed and PR'd.
disable-model-invocation: true
argument-hint: "[--draft] [--skip-e2e]"
---

# Ship to devel/latest

Invoking this skill is the user's request to commit, push and open a PR for the current work. Stop and ask before
going further if any gate fails, or if the diff contains files you didn't expect.

## 1. Pre-flight

```bash
node scripts/prepare-worktree.mjs --check
git status --short
git log --oneline origin/devel/latest..HEAD
```

- Behind `devel/latest`? Sync first. In the Claude desktop app, use the `sync_with_base_branch` tool. Otherwise rebase
  onto `origin/devel/latest`. Never merge `main` in: `origin/main` has unrelated history.
- Read the whole diff (`git diff origin/devel/latest...` plus uncommitted changes). Look for files you didn't touch.
  In shared checkouts another session may be editing at the same time, so leave those files out.

## 2. Hygiene, before the gates (they read these files)

```bash
git checkout -- test-results/.last-run.json 2>/dev/null
git status --short public/sample-data/          # committed fixtures: keep only deliberate schema-driven changes
node .claude/skills/i18n/scripts/audit-diff.mjs # hard-coded strings / locales / console.* in lib+contexts
```

Then check by hand:
- [ ] No `playwright.local.config.ts`, logs, scratch files or `.env*` in the diff.
- [ ] No new `console.*` in `src/lib` or `src/contexts`. Use `logger.child({ component })`.
- [ ] Every new user-facing string has a key in all nine languages (the `i18n` skill).
- [ ] Feature program running? Frozen hubs untouched: `src/lib/sqlQueries.ts`, `src/types/database.ts`,
      `src/contexts/DatabaseContext.tsx`, `useDatabaseCollectionsState.ts`, `useDatabaseSlices.ts`,
      `public/database-schema.js`, and `databaseService.ts` outside `#region budget-carry`.
- [ ] Architecture changed (new domain, schema version, new convention)? Then CLAUDE.md is updated, along with any doc
      the change affects (`docs/database-schema.md`, `docs/Encryption.md`, `src/locales/README.md`).

## 3. Gates, mirroring `.github/workflows/ci.yml`

Run each step and stop at the first failure. Use the local Playwright config so the smoke tests can't hit another
worktree's server. The suites take minutes, so run them in the background and wait for the completion notice.

```bash
node scripts/generate-sample-data.mjs --months=12 --seed=review && npm run sample-data:validate
git checkout -- public/sample-data/              # unless the schema changed on purpose
npm run lint
npm run test:unit:coverage                       # gate: databaseService.ts 80/60/95/80
npm run build
npx playwright test --config playwright.local.config.ts --grep @smoke > "<scratchpad>/smoke.log" 2>&1; echo "exit=$?"
git checkout -- test-results/.last-run.json
```

- Run the spec files for the feature you changed as well, not only `@smoke`.
- Before a release-sized PR (a schema bump, encryption or the shell), run the full `npx playwright test --config playwright.local.config.ts`.
- `--skip-e2e` skips only the Playwright step, and the PR body must say so.

Report real numbers: test counts, coverage percentages, and any skipped step. If something fails, say what failed and
include the relevant output. Never describe a failing gate as passing.

## 4. Commit

- Stage specific paths, not `git add -A`.
- Message: a sentence-case summary of what users or developers get, with the schema version or phase in parentheses
  when relevant. Recent examples:
  - `Loans: track borrowed money, payment rules, principal vs interest, promo deadlines (schema v5)`
  - `Passkeys as a convenience unlock method via WebAuthn PRF (phase 2)`
- Body: what changed and why, grouped by area. End with the attribution line the session's instructions give.
- Never `--no-verify`, never amend a commit that's already pushed, and never `git stash` (the stash is shared across worktrees).

## 5. Push and open the PR

`gh` isn't on PATH in these shells. Call it by its full path:

```bash
git push -u origin HEAD
"/c/Program Files/GitHub CLI/gh.exe" pr create --base devel/latest --title "<title>" --body-file "<scratchpad>/pr-body.md"
```

PR body sections:
- **Summary**: what and why.
- **Changes**: by layer or area.
- **Schema / migration**: if any.
- **Testing**: each gate, with numbers.
- **Not done / follow-ups**.
- **Notes for reviewers**: native-review needed for machine translations, manual checks.

End with the attribution line. Add `--draft` when asked.

Afterwards, in the Claude desktop app, bind the PR (`get_status`, then `bind_pr` if needed). Don't poll CI yourself.

**Merging is squash-only** and is the user's call. Never enable auto-merge unless asked.

## 6. Stacked PRs after a squash merge

When the base PR of a stack is squash-merged, GitHub retargets the next PR to `devel/latest`, and it shows CONFLICTING
because it still carries the pre-squash commit. No manual conflict resolution is needed:

```bash
git fetch origin
git rebase --onto origin/devel/latest <last-commit-of-the-merged-PR> <next-branch>
git diff --stat <old-tip-of-next-branch> HEAD     # must be empty: same content, new base
git push --force-with-lease
```

Repeat for each further PR in the stack, with `--onto <new tip of the branch below>`. If `mergeStateStatus=BLOCKED`
remains afterwards, that's a review or branch-protection rule, not a conflict.

If a real conflict comes from a sibling worktree's PR, read that PR's intent (`gh pr view`, `git show`) and re-implement
it against the merged base. Then grep for symbols the merge left behind, because clean auto-merged insertions don't show up
as conflict markers.
