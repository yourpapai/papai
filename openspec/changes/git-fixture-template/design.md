# Design — git-fixture-template

## Context

Measurements (2026-08-26 survey, `docs/research/2026-08-26-test-suite-speedup-methods.md`):
today's recipe (`setupPrimary`, `tests/review-loop/worker-pool.test.ts:21`) = 5 sequential git spawns,
246 ms median; `fs.cpSync` copy of a ready template = 0.8 ms (APFS clonefile); inline `-c user.email`
trims only ~10 % (spawn count is not the cost — process startup + commit fsync is); `git worktree add`
= 31 ms and must stay real. trace2 on the two heaviest files: 312/407 git process starts,
67–69 % of standalone wall. The `setupTestDb` snapshot cache in `tests/utils/test-helpers.ts:102-126`
is the established precedent for once-per-worker template + cheap per-test clone.

## Goals / Non-Goals

**Goals:** pilot `worker-pool.test.ts` onto a template+copy fixture helper; helper unit-tested; the
pilot's assertions unchanged; before/after in-test numbers recorded from the persisted junit.

**Non-Goals:** converting the other 11 git-building files (follow-ons, same evidence gate); touching
`review-loop/src/` (production code under test); any fake-git seam (separate, declined); Windows
optimizations beyond correctness (`cpSync` falls back to a real copy where clonefile is absent —
correct, just slower).

## Decisions

### D1 — Template cached per worker by migration-shape, not global

The template is built lazily on first fixture request and cached module-locally (a `Map`-less single
instance is enough — one template shape covers all current recipes: identity + one commit + gc.auto=0).
This mirrors `migratedSnapshotCache` keying without needing keys: if a second shape ever appears
(e.g. bare repo, detached HEAD), the cache gains a key then — not speculatively.

*Why per-worker, not per-file:* bun `--parallel`/`--isolate` gives each file its own module instance
anyway, so "per worker" falls out of module locality with zero lifecycle code.

### D2 — `fs.cpSync(recursive)` as the copy primitive

Node/Bun `cpSync` already dispatches to `copyfile`/`clonefile` on APFS where possible; measured 0.8 ms
for the template shape. No direct `clonefile` binding (native module) — the syscall difference at
this scale is noise, and staying on the stdlib primitive keeps the helper dependency-free and portable.

### D3 — Template contents fixed: init + identity + one commit + `gc.auto=0`

- Identity via two `git config` spawns **in the template only** (once per worker — not worth `-c`
  gymnastics).
- `gc.auto=0` set with `git config` in the template; copies inherit repo-local config. This kills the
  39–44 auto-maintenance runs observed per traced file. `commit --no-gpg-sign` is set via the helper's
  own future commits where tests commit through `execGit` — no global config change.
- The initial commit carries a `README.md` exactly like today's recipe, so tests that assert on file
  presence keep passing.

### D4 — The helper lives in `tests/review-loop/`, not `tests/utils/`

First consumer is review-loop; `tests/utils/test-helpers.ts` is byte-frozen for story qualifications.
A second area adopting it (e.g. `tests/opencode-agent/`) promotes it to `tests/utils/` as a follow-on —
the same promotion path `grouped-assertions` never needed but `schemaValidates` took.

### D5 — What the pilot must prove

`worker-pool.test.ts` converted: `setupPrimary` becomes `makeGitFixture()` + `createWorktree` (real,
unchanged). Assertions untouched — the file still verifies worktrees, merges, rebases, conflicts
against real git. Evidence: junit in-test time before (42 s loaded-run baseline / the fresh
quiet-host before number the task records) and after; case count identical (11).

## Risks / Trade-offs

- [Copied repo differs subtly from a built one (mtime, reflog)] → reflog presence differs (`clonefile`
  copies `.git` wholesale — reflog comes along; `git init` fresh also writes one). Risk is inverted:
  a copy is *more* faithful to the template chain than a rebuild. The pilot's full assertion set is
  the check.
- [`fs.cpSync` copies symlinked `.git` objects unexpectedly] → template has no symlinks (verified
  shape: one commit, no worktrees, no hooks beyond samples). A test in the helper's own suite pins
  the template shape.
- [Contention-era numbers oversell the win] → the recorded evidence uses quiet-host before/after
  in-test times from the junit report, not wall clock, per the survey's framing fact 1.
- [Parallel workers copy concurrently] → copies are independent dirs under the file's existing
  `makeTempDir` scheme; no shared state (the template is read-only after build).

## Migration Plan

1. TDD the helper (`tests/review-loop/git-fixture.test.ts`: template shape, copy independence,
   no-subprocess-construction, worktree-on-copy parity).
2. Convert `worker-pool.test.ts`'s `setupPrimary` to the helper; run the file standalone and cite
   before/after in-test time.
3. Full `bun run test`; confirm no cross-file effects; record numbers in `tasks.md`.
4. `bun check`; commit helper + pilot + numbers together.

Rollback: revert the pilot's fixture call back to `setupPrimary`; delete the helper. No production
coupling.

## Open Questions

- None blocking. Follow-on ordering of the remaining 11 files (by measured in-test time, review-loop
  first) is a rollout decision recorded for the follow-ons, not this change.
