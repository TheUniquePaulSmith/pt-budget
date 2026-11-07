---
name: feature-program
description: Plans and runs a multi-agent feature program in budgetApp-v2 — several features built at once by parallel Claude sessions in their own worktrees without merge conflicts, using a foundation PR that pre-builds every shared seam, an ownership matrix with frozen hubs, per-agent Playwright ports, a fixed merge order and an integration pass. Use it when the user wants to build three or more features in parallel, split a large roadmap across agents or sessions, coordinate sibling worktrees, or asks how the October 2026 program (notifications, logging, shell, CSV import, AI, budget carry-over) was organised. Also use it for large mechanical fan-outs such as translating every namespace with one subagent per language.
argument-hint: "[roadmap or list of features]"
---

# Feature programs (parallel agents)

The October 2026 program shipped seven PRs (#37 foundation, then #42 → #38 → #41 → #39 → #43 → #40) from six parallel
agents. There were zero cross-agent conflicts, and the integration pass came out green: lint, coverage, build, and 53/53 e2e.
What made that possible was ownership rules, not luck. Follow this structure.

## When it's worth it

- Use it for three or more features that are each a self-contained PR and mostly touch *their own* feature folders.
- Don't use it when the features share the same core files (for example two features that both rework
  `databaseService.ts` logic) or one depends on another's output. Sequence those, or merge them into one agent.
- Mechanical fan-out inside one PR (translation by language, extraction by feature folder) uses **subagents with strict
  folder ownership**, not sessions. The i18n program ran 6 extraction and 8 translation subagents that way.

## Phase 1: plan (the user approves it)

Write a plan file (template: `references/plan-template.md`) with these parts:
1. **Context and decisions table.** Settle every product decision the agents would otherwise ask about.
2. **Foundation section.** Every shared seam the agents will need, built *before* they start.
3. **One section per agent**: scope, owned files and folders, acceptance tests, the e2e spec it adds.
4. **Ownership matrix**: file or folder → owning agent. Frozen hubs are owned by the foundation only.
5. **Merge order.** Least-coupled first. Shell and visual rewrites go last, because everyone else's e2e depends on the shell.
6. **Integration pass** (agent "G"): what it verifies on the merged tip.

## Phase 2: foundation PR (one session, merged before any agent starts)

It puts in place everything two agents would otherwise both edit:
- **One schema version** with *all* the tables and columns every agent needs (the `schema-bump` skill). Agents never
  bump the schema. A column someone forgot goes into the next program.
- **Hubs pre-wired**: re-exports in `sqlQueries.ts` and `useDatabaseSlices.ts`, sub-service stubs composed into
  `DatabaseService`, contexts in `DatabaseContext.tsx`, collections in `useDatabaseCollectionsState.ts`, types in
  `src/types/database.ts`.
- **Shell seams**: page registry entries and slot components (`Layout/slots/*`, `AiPanelProvider`, notification runtime),
  so a feature only fills its own slot.
- **Locale namespaces** created in all nine languages, so agents add keys only to their own namespace.
- **Shared form or model extractions** (as `accountFormModel.ts` was) when two agents would otherwise edit the same component.
- **CLAUDE.md**: a "Feature-program conventions" section listing the frozen files and ownership rules. Agents read it first.

Squash-merge it into `devel/latest`, and only then start the agents.

## Phase 3: start the agents

- One session per agent, each in its **own worktree** on `feature/<section>`, cut from the post-foundation tip.
  Use the brief template in `references/agent-brief.md`.
- Every agent runs `node scripts/prepare-worktree.mjs` first. That gives it its own Playwright port with
  `reuseExistingServer: false`. In October, sibling dev servers occupied ports 3000 to 3400, and shared-port runs
  silently tested other branches.
- Each agent finishes with the `ship` skill's gates and opens its PR against `devel/latest`. Agents don't merge.

## Phase 4: supervise

- Agents tend to go idle while a background test run is pending. When one reports "waiting for tests", check its
  transcript and nudge it to collect the results and push. Use `SendMessage` to its session id; never start a duplicate session.
- Blocked on a decision? Answer it from the plan's decisions table, or ask the user. Don't let agents decide product questions.
- An agent needs a frozen file? It's almost always a missing seam. Add it to a follow-up foundation patch merged first,
  or defer it. Don't grant one agent hub edits.

## Phase 5: merge in order

For each PR in the merge order:
1. The user squash-merges it (merging is their call).
2. The next agent rebases onto the new `devel/latest` (`ship` §6 has the `rebase --onto` recipe for stacks), reruns its
   gates on its own port, and pushes.
3. Repeat until every PR is in.

## Phase 6: integration pass

On the merged tip, in a fresh worktree:
- `prepare-worktree`, then lint, `test:unit:coverage`, `build`, and the **full** e2e suite (not just smoke).
- Fix cross-feature fallout in one PR.
- Lift the freeze: delete or update the CLAUDE.md program section, and record decisions and follow-ups in memory and docs.

## Anti-patterns seen before

- Two sessions independently "finding the real work" and fixing the same bug two ways. Give each agent an explicit scope
  and a list of what it must not touch.
- Starting agents before the foundation is merged. They all fork from a base without the seams, and every PR conflicts.
- A parallel schema bump. Two `SCHEMA_VERSION = N+1` branches can't both land.
