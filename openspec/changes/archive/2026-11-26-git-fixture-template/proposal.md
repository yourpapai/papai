# git-fixture-template

## Why

12 test files (mostly `tests/review-loop/`) build real git repositories from scratch per test — `git init` + 2× `git config` + `add` + `commit` (the `setupPrimary` recipe) — totalling **250 s = 23.2 %** of the suite's 1 077 s serial in-test time. `GIT_TRACE2` measurement shows **67–69 %** of the two heaviest files' standalone wall is pure git-process time, and a timing experiment measured the recipe at **246 ms per fixture** versus **0.8 ms** for a template-repo + APFS-clonefile copy (300×) — the same snapshot pattern `setupTestDb` already proved at 190× (`docs/research/2026-08-26-test-suite-speedup-methods.md`, Method 2). Extrapolated: **~60–90 s serial (6–8 %)** for a test-helper-only change with zero production-code edits.

## What Changes

- A `tests/review-loop/git-fixture.ts` helper: build one template repo per worker (identity configured, initial commit present, `gc.auto=0` baked in), then clone-copy it per test via APFS `clonefile` (`fs.cpSync` already uses it where possible).
- `gc.auto=0` in the template kills the auto-maintenance runs that fire 39–44× per traced file.
- Adoption is **per-file, evidence-gated** (the `test-case-consolidation` rollout shape): the pilot converts `worker-pool.test.ts` (biggest git share, 42 s in-test) with before/after numbers cited; other files follow only when touched or via follow-on changes.
- The helper leaves `worktree add` operations real (worktree metadata holds absolute paths; a copied worktree is broken) — only repo *construction* becomes a copy.

## Capabilities

### New Capabilities

- `git-fixture-template`: governs the shared git fixture helper — what a template SHALL contain, how per-test copies SHALL be produced (filesystem copy from a per-worker template, never a fresh git process chain), what SHALL stay real-git (worktree operations, merges, rebases on the copied repo), and the per-file evidence-gated adoption contract.

### Modified Capabilities

- None. `test-case-consolidation` and `research-poc-test-isolation` untouched; no production spec moves.

## Impact

- Code: new `tests/review-loop/git-fixture.ts` + its test; pilot conversion of `tests/review-loop/worker-pool.test.ts`'s fixture construction; no `src/`, no `review-loop/src/` changes (the helper is test-side only and *calls* `execGit`/`createWorktree` rather than replacing them).
- `tests/review-loop/` fixtures are not byte-frozen (the freeze list covers `tests/utils/test-helpers.ts`, story harness, bunfig, setup files — not review-loop test files), so no sequencing constraint.
- Assertions unchanged: every test still asserts against a real git repository with real history; only how that repository comes to exist changes.
- Expected effect: pilot file's in-test time drops by roughly its git-construction share (~40–50 % of its 42 s); the other 11 files keep their current recipe until each is converted by a follow-on citing the pilot's numbers.

## Non-goals

- No fake git, no seam changes, no production-code edits — fake-at-the-seam is a separate (declined-as-campaign) change recorded in the survey.
- No mass conversion of all 12 files in this change — pilot only; rollout stays evidence-gated per file.
- No changes to `review-loop/src/worktree.ts` (its behavior is production code under test).
- No parallel-lane or CI wiring changes.
