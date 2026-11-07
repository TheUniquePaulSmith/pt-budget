# Agent brief template

Start each agent session with `context: "fresh"` and `use_worktree: true`, and a brief like this one. Fill in every `<…>`.

---

You are Agent <X> of the <program> feature program in budgetApp-v2. Build **<feature>** as one PR into `devel/latest`.

**Read first:**
1. `CLAUDE.md`, especially "Feature-program conventions".
2. The plan file `<path>`: the "Agent <X>" section, the Decisions table and the Ownership matrix.

**Setup:**
- Create a branch `feature/<section>` from the current `devel/latest`. It must include foundation PR #<n>.
- Run `node scripts/prepare-worktree.mjs` and use `playwright.local.config.ts` for every e2e run.

**You own:** <list of files and folders>.
**Frozen; do not edit:** `public/database-schema.js`, `src/lib/sqlQueries.ts`, `src/types/database.ts`,
`src/contexts/DatabaseContext.tsx`, `src/contexts/useDatabaseCollectionsState.ts`, `src/contexts/useDatabaseSlices.ts`,
`src/lib/databaseService.ts` <except `#region …`>, and other agents' folders.
If you need a change in one of these, stop and report it. Don't work around it.

**Decisions already made:** <copy the relevant rows>. Don't re-decide them. Ask the coordinator if something is missing.

**Done means:**
- Unit tests for <…>, an e2e spec `tests/e2e/<feature>.spec.ts`, and strings in all nine languages under `src/locales/*/<ns>.json`.
- The `ship` skill's gates pass on your port: lint, unit coverage, build, smoke, and your spec.
- A PR is open against `devel/latest`, with test numbers in the body.
- Your final message gives the PR URL, the gate results and anything left over, plus the CLAUDE.md bullet text for the integration pass.

When a background test run finishes, collect its result and continue. Don't end your turn while a run is pending
without saying so.
