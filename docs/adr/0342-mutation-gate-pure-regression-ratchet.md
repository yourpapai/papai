<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — Drop the 0.5 Floor, First-Touch Warn-and-Seed, Coverage-Derived Test Sets

## Status

Accepted

## Date

2026-07-28

## Context

The per-file mutation PR gate (`bun test:mutate:changed`) enforced a threshold of `max(0.5, baseline[file])` for every changed file. The hardcoded 0.5 floor made broad PRs cliff: any change touching a core file that had never been baselined failed the gate at 0.5 even when nothing regressed, because there was no recorded baseline to compare against. First-touch files were treated as failures instead of as missing data.

Two further problems compounded this. Test selection was companion-only (each source file mutated against its own `*.test.ts`), so measured scores systematically undercounted killing power from non-companion tests — meaning the recorded baselines themselves were depressed. And the master `mutation-baseline` job ran the full mutation suite to refresh `baseline.json` via `ratchetMerge`, which drops any key absent from the latest run — the wrong merge for partial (changed-files) seeding, and too slow for per-merge cadence.

The design spec (`docs/superpowers/specs/2026-07-28-mutation-gate-ratchet-fix-design.md`) and implementation plan (`docs/superpowers/plans/2026-07-28-mutation-gate-ratchet-fix.md`) split the fix into Phase A (unblock: drop the floor, warn on first touch) and Phase B (accuracy: coverage-derived test selection, changed-files master seeding via `seedMerge`).

## Decision Drivers

- **The gate must measure regression, not absolute quality.** A blocking PR gate that fails on never-baselined files conflates "this PR made things worse" with "we have no data", and trains authors to route around the gate.
- **First-touch is missing data, not failure.** New or never-baselined files should warn and be seeded after merge, becoming enforced floors for future PRs — the ratchet only ever tightens.
- **Baselines must be preserved across partial runs.** A changed-files seed run measures a subset of files; merging it must keep every untouched entry (per-key max), never drop them.
- **Test selection should reflect actual coverage.** Companion-only selection undercounts killing power; a coverage-derived map (`sourceFile → covering testFiles`) with `overrides.json` as an additive escape hatch measures what the test suite actually kills.
- **Master seeding must be cheap enough to run per merge.** A full-suite mutation run per master push does not scale; measuring only files changed since the previous master commit does.

## Considered Options

### Option 1 — Pure regression ratchet with warn-and-seed first-touch (chosen)

`resolveRatchet(perFile, baseline)` drops the `floor` param: a file regresses only when it has a recorded baseline entry and scores below it. First-touch files emit a WARN (`First measurement for <file>: score … — seeded`) and pass. Master CI runs `bun test:mutate:changed --base=HEAD~1 --update-baseline`, merging results into `baseline.json` via `seedMerge` (preserve existing keys, per-key max). Test selection uses a coverage map built from per-test-file coverage runs (candidate-narrowed by static import scan, content-key cached), unioned with `overrides.json`, falling back to the companion test when no coverage entry exists.

- **Pros:** broad PRs stop cliffing at 0.5 on unbaselined core files; the ratchet is monotonic (scores only go up, enforcement only tightens); baselines reflect real coverage; master seeding is scoped to changed files and cheap; concurrency-safe retries (per-key max means re-seeds never conflict).
- **Cons:** first-touch files are ungated until the post-merge seed lands — a merged PR can introduce a low-score file that only becomes enforced afterwards; the coverage map adds a build step and cache to maintain; the first master run after Phase B produces a large one-time `baseline.json` diff.

### Option 2 — Keep the 0.5 floor, add a per-repo exemption list (rejected)

Maintain the floor but exempt never-baselined files via a hand-maintained list until they are baselined.

- **Pros:** minimal code change; keeps an absolute quality bar for known files.
- **Cons:** the exemption list is a second, manually-curated source of truth that drifts; it still conflates regression with absolute quality; every new core file needs a human to edit the list — the gate remains a friction generator rather than a ratchet.

### Option 3 — Seed baselines eagerly in the PR itself (rejected)

Have the PR job write baseline entries for first-touch files and require the author to commit the updated `baseline.json`.

- **Pros:** no ungated window; baselines land with the code they describe.
- **Cons:** PR authors can self-seed a low baseline to pass the gate (no independent enforcement); mutation runs in PRs become write paths, complicating the gate's trust model; concurrent PRs seeding different files create merge conflicts on `baseline.json`.

### Option 4 — Keep full-suite master seeding with `ratchetMerge` (rejected)

Leave the master job running the entire mutation suite per merge.

- **Pros:** complete re-measurement every time; no partial-merge semantics needed.
- **Cons:** full-suite mutation is far too slow for a per-merge cadence; `ratchetMerge` drops keys absent from the latest run, so any scoped/flaky subset silently erases baselines; the cost pressure incentivizes skipping the job, leaving the baseline stale.

## Decision

Adopt Option 1. The mutation PR gate is a pure regression ratchet:

1. **No floor.** `resolveRatchet` compares only against recorded baseline entries; unbaselined files are skipped (not regressions).
2. **First-touch warn-and-seed.** The gate logs a WARN for unbaselined changed files; the master `mutation-baseline` job seeds them after merge via `seedMerge`.
3. **`seedMerge` for partial runs.** Changed-files seeding preserves all existing baseline entries (per-key max); `ratchetMerge` remains correct only for full runs.
4. **Coverage-derived test selection.** A `buildCoverageMap` step inverts per-test-file coverage into `sourceFile → testFiles`; `overrides.json` is an additive escape hatch; the companion test is the fallback when no covering test is found.
5. **Master seeds changed files broadly.** `bun test:mutate:changed --base=HEAD~1 --update-baseline` replaces the full-suite master job.

## Rationale

A ratchet works because it is monotonic and cheap to enforce: recorded scores only rise, and the PR gate only asks "did you make a measured file worse?" The 0.5 floor broke both properties — it was a static absolute bar that produced false failures on unmeasured files. Warn-and-seed converts first-touch from a failure mode into the ratchet's tightening mechanism. `seedMerge` exists precisely because partial seeding with `ratchetMerge` would silently erase baselines for unmeasured files. Coverage-derived selection fixes the systematic undercount that depressed every recorded baseline, and the content-keyed cache keeps its cost bounded.

## Consequences

### Positive

- Broad PRs touching never-baselined core files no longer cliff at 0.5; the gate only fails on true regressions.
- The baseline tightens automatically: every merge seeds/raises entries, and future PRs enforce ≥ the seeded score.
- Recorded baselines reflect real killing power (coverage-derived test sets), not companion-only undercounts.
- Master seeding is scoped to changed files — fast enough to run per merge, and retry-safe (per-key max merge never conflicts on concurrent master movement).

### Negative

- Brief ungated window: a first-touch file is unenforced between its PR merging and the master seed completing. Accepted because the alternative (PR-side seeding, Option 3) destroys the gate's independence.
- One-time catch-up: the first master run after Phase B seeds every recently-changed unbaselined file — a large `baseline.json` diff, expected and correct.
- Existing companion-only baselines are undercounts; they ratchet upward only as files are re-measured with coverage-derived test sets.
- New moving parts to maintain: `coverage-map.ts`, its cache, and the `seedMerge`/`--update-baseline` path in the changed-files CLI.

### Risks

- Coverage-map staleness (cache invalidation bugs) could select wrong test sets and corrupt baselines. Mitigation: content-keyed cache (src+tests tree hash); `overrides.json` remains as a manual corrective.
- Master seed job failure leaves first-touch files unenforced longer. Mitigation: the job is serialized per workflow and retries with a fresh-base re-seed loop.

## Implementation Notes

- `scripts/mutation/baseline.ts` — `resolveRatchet` (no floor), `seedMerge`; `scripts/mutation/changed-files.ts` — first-touch WARN, `--update-baseline`; `scripts/mutation/coverage-map.ts` — `buildCoverageMap`; `scripts/mutation/paired-run.ts` — `buildMap` dep; `.github/workflows/ci.yml` — `mutation-baseline` job runs `bun test:mutate:changed --base=HEAD~1 --update-baseline` with a retry loop that re-seeds via `test:mutate:seed --fresh-base` when master moves mid-run (an extension beyond the original plan).
- Migration note (documented in `scripts/mutation/README.md`): the first master run after Phase B produces a large one-time baseline diff; this is expected.

## Implementation Status

Implemented. Verified in codebase on 2026-08-08:

- `scripts/mutation/baseline.ts` — `resolveRatchet` has no `floor` param (regression-only); `seedMerge` exported; JSDoc updated. No `ratchetFloor`/`DEFAULT_RATCHET_FLOOR` remnants anywhere in `scripts/mutation/` or CI.
- `scripts/mutation/changed-files.ts` — first-touch WARN (`First measurement for …`), `--update-baseline` flag, `seedMerge` path.
- `scripts/mutation/coverage-map.ts` + `paired-run.ts` `buildMap` dep — coverage-derived test selection in place.
- `.github/workflows/ci.yml` — gate comment corrected; `mutation-baseline` job runs `bun test:mutate:changed --base=HEAD~1 --update-baseline` plus a fresh-base re-seed retry loop (`test:mutate:seed --fresh-base`), an extension beyond the original plan.
- `scripts/mutation/README.md` — documents the regression-only policy and the one-time catch-up migration note.

## Related Decisions

- ADR-0328: Drop the TS7-incompatible typescript-checker — the same mutation infrastructure this ratchet gates.
- ADR-0327: CI line-coverage floor custom aggregate gate — the complementary line-coverage gate.

## References

- Design spec: `docs/superpowers/specs/2026-07-28-mutation-gate-ratchet-fix-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-28-mutation-gate-ratchet-fix.md`
- Policy documentation: `scripts/mutation/README.md`
