# <Program name>: plan

## Context

Why this program, what the user asked for, and the base commit (`devel/latest` @ <sha>).

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | e.g. How are foreign-currency accounts handled? | Converted with manual rates | Offline/local-first |

## Foundation (one PR, merged before agents start)

- 0.1 Schema vN: tables/columns for every agent (list them by agent)
- 0.2 Sub-service stubs composed into `DatabaseService` (`.<domain>`)
- 0.3 Hubs: `sqlQueries.ts`, `useDatabaseSlices.ts`, `DatabaseContext.tsx`, `useDatabaseCollectionsState.ts`, `src/types/database.ts`
- 0.4 Page registry entries / shell slots
- 0.5 Locale namespaces (all nine languages)
- 0.6 Shared extractions (forms, models)
- 0.7 CLAUDE.md "Feature-program conventions" (frozen files, ownership)
- 0.8 Fixtures (archive for the upgrade spec if rows are transformed)

## Agent A: <feature>

- **Scope:** …
- **Owns:** `src/components/<folder>/**`, `src/lib/databaseService<Domain>.ts`, `src/lib/sqlQueries<Domain>.ts`,
  `src/contexts/useDatabase<Domain>Slice.ts`, `src/contexts/use<Domain>Slices.ts`, `src/locales/*/<ns>.json`,
  `tests/e2e/<feature>.spec.ts`
- **Must not touch:** frozen hubs, other agents' folders
- **Acceptance:** unit tests for …; e2e spec covering …; CLAUDE.md bullet text (handed to G)

(repeat per agent)

## Ownership matrix

| Path | Owner |
|---|---|
| `public/database-schema.js`, hubs | Foundation only (frozen) |
| `src/lib/databaseService.ts` | Read-only (except `#region <x>` → Agent F) |
| `src/components/<folder>/**` | Agent … |

## Merge order

B → D → F → A → E → C (least coupled first; shell/visual last)

## Integration pass (G)

Lint, unit coverage, build and the full e2e suite on the merged tip. Fix cross-feature fallout. Lift the freeze.
