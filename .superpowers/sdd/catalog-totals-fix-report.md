# Catalog Totals Fix Report

## Context

Phase 2 regression in `tests/scripts/story-coverage-totals.test.ts`. The catalog
(`tests/stories/catalog/coverage.ts`) gained three executable Tier 0 records and the
harness test (`tests/stories/harness/catalog-coverage.test.ts`) was updated to match, but
the totals snapshot test still asserted the old aggregate values. The aggregation module
(`scripts/story/coverage-totals.ts`) and catalog records were left untouched per
instructions.

## Root cause

Stale expected snapshot in `tests/scripts/story-coverage-totals.test.ts`. Only three
aggregate figures drift as a result of the three added Tier 0 executable records:

| field                   | old | new |
| ----------------------- | --- | --- |
| `total`                 | 215 | 218 |
| `executable`            | 187 | 190 |
| `executableByTier['0']` | 142 | 145 |

`pending`, `readiness`, all other tier counts, and `pendingByUnblockingTier` are
unchanged (the added records are executable, not pending).

## Change

Edited only `tests/scripts/story-coverage-totals.test.ts`:

1. Updated the `toEqual({...})` object: `total`, `executable`, `executableByTier['0']`.
2. Updated the `formatStoryCoverageTotals()` summary string prefix from
   `187/215 executable (T0 142, ...)` to `190/218 executable (T0 145, ...)`.

No implementation or catalog record changes.

## Verification

### Before fix — focused reproduction

Command: `bun test tests/scripts/story-coverage-totals.test.ts`

```
2 fail
0 pass
2 expect() calls
Ran 2 tests across 1 file. [512.00ms]
```

Diff reported by the runner:

```
@@ expected vs received @@
  {
-   "executable": 187,   -> 190
+   "executableByTier['0']": 142,  -> 145
-   "total": 215,        -> 218
  }
```

### After fix — focused reproduction

Command: `bun test tests/scripts/story-coverage-totals.test.ts`

```
2 pass
0 fail
2 expect() calls
Ran 2 tests across 1 file. [515.00ms]
```

### Related harness lane (catalog census)

Command: `bun test:stories:contracts`

```
425 pass
0 fail
1692 expect() calls
Ran 425 tests across 23 files. [81.05s]
```

Includes `tests/stories/harness/catalog-coverage.test.ts` (the already-updated forward +
census checks); all green, confirming the catalog and totals are mutually consistent.

### Full suite

Command: `bun run test`

```
8890 pass
2 skip
1 fail
19638 expect() calls
Ran 8893 tests across 972 files. [100.16s]
```

The single failure is **unrelated**: `tests/review-loop/worktree.test.ts >
createWorktree creates a linked worktree on a new branch` timed out at the 5000ms
parallel-worker limit. It passes in isolation:

Command: `bun test tests/review-loop/worktree.test.ts`

```
13 pass
0 fail
28 expect() calls
Ran 13 tests across 1 file. [5.61s]
```

So the failure is a parallel-execution timing flake on real git worktree creation, not a
regression from this change (which only edits test expectations).

## Commit

Correction staged alone (unrelated dirty files `.superpowers/sdd/task-5-report.md`,
`docs/architecture/plugins.md`, `docs/plugins/developer-guide.md` preserved unstaged) and
committed on the current branch. See commit SHA in final response.

## Concerns

- The full-suite worktree timeout flake is pre-existing/environmental and not addressed
  here; worth tracking separately if it recurs under `--parallel`.
