<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0424: Measure Only What Changed, Judge the Whole Branch — Fingerprint-Guarded Carried-Over Mutation Scores

## Status

Accepted

## Date

2026-08-14

## Context

The `mutation-testing` PR gate runs `bun test:mutate:changed --base=origin/master` on every push. That selects every gateable file in the branch diff and re-mutates all of them from scratch, every time. Observed cost: 39m13s on a large PR against a 90-minute job ceiling. Run 31741632357 shows what that buys — 22 files, 25 minutes, then a failure on one file whose Stryker dry run errored, so fixing that one file means re-mutating all 22 again. Runtime scales with the *branch's* size, not with the *push's* size, which is the wrong variable: a one-line follow-up on a large PR costs the same as the PR's first push.

The tempting fix is to measure and gate only what changed since the previous push. That is wrong in a way that is easy to miss, because it fails silently and in the green direction. If commit A drops file `X` below its floor and commit B changes only `Y`, a since-last-push gate sees a clean `Y` and reports success — while `X`'s regression is still sitting in the branch, and will merge. The gate would be answering "did this push make things worse?" when the question it exists to answer is "does this branch make things worse than master?"

So the two properties have to be separated: measurement may become incremental, but the verdict must stay whole-branch.

## Decision Drivers

- **A gate that forgets is worse than a slow gate.** The value of the ratchet is that a regression cannot reach master. Any speedup that lets a measured drop fall out of the verdict trades the gate's only guarantee for wall-clock.
- **Reuse must be provably safe, not probably safe.** Whatever decides that a previous score still applies has to be exact and cheap to check, so that no amount of cache weirdness — eviction, prefix matches, rebases, racing runs — can produce a wrong answer.
- **A failing run's work must survive.** A red run that discards what it measured is the exact case where re-measurement is most expensive and least informative: the next push repeats the whole thing to rediscover the same drop.
- **The committed baseline must stay trustworthy.** `baseline.json` is the floor every future PR is held to; a floor derived from a score that was carried over rather than measured is a floor nobody checked.
- **A green run must be legible as whole-branch.** If a reader cannot tell from the log whether a pass covered the branch or a fraction of it, the gate's output stops being evidence.

## Considered Options

### Option 1 — Fingerprint-guarded carried-over scores, whole-branch verdict (chosen)

Keep selecting the entire branch diff. Split those targets into files that must be measured and files whose score can be carried over from an earlier run on the same branch, then judge the union. A score is carried over only when a content fingerprint — the source's bytes, its candidate test set's paths and bytes, and a toolchain hash over the Stryker config, overrides, lockfile and mutation scripts — matches exactly. Transport is `actions/cache`, saved with `if: always()`.

- **Pros:** the verdict is unchanged in every case (a cold cache measures everything and behaves exactly as today); a regression measured on any earlier push keeps failing until it is fixed; the guard is content-addressed, so a stale, racing, or unrelated cache costs runtime and nothing else; typical pushes drop from minutes to seconds.
- **Cons:** transitive `src/` dependency changes are not tracked (see Negative Consequences); a nondeterministic score can be pinned for a branch's lifetime; three new modules and two CI steps to maintain.

### Option 2 — Measure and gate only the diff since the previous push (rejected)

The naive reading of "incremental mutation testing".

- **Pros:** simplest possible implementation; fastest possible runs; no cache, no fingerprint, no new modules.
- **Cons:** loses commit A's regression the moment commit B touches something else — the failure mode is a false green on a branch that genuinely regressed, which is the one outcome a blocking gate must never produce. Naming this option is the main reason this ADR exists: it is what "run it incrementally" sounds like it means.

### Option 3 — Commit scores to the branch (rejected)

Persist per-file scores in the repository so later pushes read them from git.

- **Pros:** survives cache eviction; no CI-provider dependency; the data is auditable in the diff.
- **Cons:** turns a read-only PR gate into a write path, and lets an author hand-edit a passing score into their own branch — the same objection that rejected PR-side seeding in [ADR-0342](0342-mutation-gate-pure-regression-ratchet.md) Option 3. Also needs write permissions that fork PRs do not have.

### Option 4 — Read the previous run's `upload-artifact` (rejected)

Recover scores from the artifact the job already uploads.

- **Pros:** no new action dependency; artifacts are already retained for 14 days.
- **Cons:** requires an authenticated API call plus run-lookup logic to find "the previous run of this PR", where `restore-keys` gives "newest on this ref" for free and offline.

## Decision

Adopt Option 1.

1. **The target list is unchanged.** `selectChangedMutationTargets` still returns the whole branch diff vs the base ref. This is what keeps the verdict whole-branch; nothing downstream may narrow it.
2. **The fingerprint is the guard, the cache key is a hint.** `scripts/mutation/score-cache.ts` checks the fingerprint inside `get`, so no call site can consume a score without proving the content it was measured from is the content on disk now.
3. **Contents only, never metadata.** `scripts/mutation/score-fingerprint.ts` hashes bytes. `scripts/test/fingerprint.ts` deliberately hashes `size + mtimeMs` for a different purpose; reusing it here would miss on every entry, because every CI job checks the repository out fresh.
4. **The candidate test universe, not the paired set.** The fingerprint covers the companion, the coverage-map candidates and any `overrides.json` entry — a superset of the tests actually paired with the file. It over-invalidates slightly and never under-invalidates on the test side.
5. **Record before gating.** A failing run persists what it measured. `if: always()` on the CI save step is part of the same decision.
6. **Never carry over what was never measured.** Errored and skipped files produce no per-file score, so neither can be recorded; both are re-attempted on the next run.
7. **Seeding always measures fresh.** `--update-baseline` disables reuse, and the master job gets no score cache. `--no-score-cache` is the operator escape hatch.
8. **The log states the split.** Every run prints the whole-branch target count, how many it measured, and each reused file with its score and measurement time.

## Rationale

The design collapses to one invariant: *the cache key decides which blob to fetch; the fingerprint decides whether any of it may be used.* Every question that would otherwise need its own answer — a `restore-keys` prefix matching an older run, a force-push rewriting history, two runs of the same PR racing, a cache evicted after seven days — reduces to "a miss costs a re-measure". None of them can reach the verdict.

That invariant is also why the fingerprint deliberately excludes the recorded baseline. When a merge from master raises a file's floor, the carried-over score must be re-judged against the new floor rather than quietly re-measured; leaving the baseline out of the fingerprint is what makes the stricter comparison happen automatically.

Verified end-to-end on a scratch branch before shipping: a commit introducing an untested branch scored 0.8696 against a 1.0000 floor and failed (37s, one file measured); a second commit touching an unrelated file measured only that file, carried the 0.8696 over, and **still failed naming the first file**; a third run with nothing changed measured nothing, finished in 0.13s, and still failed; and editing only the *test* file re-measured the source, moving it to 0.9130. That last case is the "faster is not weaker" half of the claim, demonstrated rather than argued.

## Consequences

### Positive

- A push pays for its own changes rather than the branch's history: 2m50s and 0.13s on the scratch runs above, against 37s+ per file measured from cold.
- A regression is re-asserted on every subsequent push until it is fixed, so the gate's memory now spans the branch rather than the run.
- A red run's work is not thrown away, which is exactly the case where re-measurement was most expensive.
- `reports/paired/coverage-map.cache.json` rides along in the same cache entry; it was cold on every runner before this.
- The verdict is bit-for-bit unchanged when the cache is cold, so the change cannot make a passing branch fail.

### Negative

- **Transitive `src/` dependency changes are not fingerprinted.** If commit B changes a helper that `X` imports, `X`'s carried-over score is reused even though its real score may have moved. This is narrower than it sounds — `X` is only gated because it is already in the branch diff — and it is bounded by the master seed run always measuring fresh, so `baseline.json` never inherits a stale score. It is accepted deliberately. Should it need fixing, `scripts/test/import-graph.ts` (`resolveSpecifier`, `buildReverseGraph`) can supply an N-hop closure to fold in, at the cost of many more misses.
- **A nondeterministic score can be pinned.** `Timeout` counts in the score numerator and is machine-load dependent, so a lucky measurement survives for the branch's life. The bias is toward passing. Bounded by the 30-day retention window and by any edit re-measuring.
- **Over-invalidation on the test side.** Editing one test re-measures every source in its package directory. Chosen knowingly: the alternative is running coverage attribution just to decide what to run.
- More moving parts: a fingerprint module, a cache module, a split/combine module, and two CI steps.

### Risks

- A fingerprint bug that is too *loose* would carry stale scores silently. Mitigation: the guard lives inside `get`; the fresh-checkout property is pinned by a test that copies the project to a new path with new mtimes; `SCORE_FINGERPRINT_VERSION` and the `mutation-scores-v1` key prefix both force a full re-measure.
- A cache save failure would silently cost the speedup. Accepted: `continue-on-error: true` is deliberate, because a save that fails must never turn a green gate red, and the only cost is a re-measure.

## Implementation Notes

- `scripts/mutation/score-fingerprint.ts` — `SCORE_FINGERPRINT_VERSION`, `computeToolchainFingerprint`, `computeSourceFingerprint`, `createDefaultFingerprintDeps`.
- `scripts/mutation/score-cache.ts` — `openScoreCache`, fail-open reads, batched writes, 30-day write-side retention, no read-side TTL.
- `scripts/mutation/incremental-run.ts` — `planIncrementalRun`, `combineIncrementalResult`, `formatIncrementalPlan`, `measureOnlyWhatIsNeeded`, `logFirstMeasurements`, `createIncrementalDeps`.
- `scripts/mutation/gates.ts` — `resolveErroredGate` and a pure `resolveChangedFilesGates` extracted from `changed-files.ts`, which had reached oxlint's 300-line ceiling. `GateInput` is `PerFileScore`-shaped so a carried-over score never has to fabricate run-artifact paths; `seedBaseline`/`runUpdateBaseline` moved to `seed-from.ts`, which already owns seeding.
- `scripts/mutation/score-merger.ts` — `combineMergedScores` (pools mutants, never averages file scores) and `isMergedScore` (guards cache deserialization).
- `scripts/mutation/changed-files.ts` — `--no-score-cache`; boolean flags now match exactly rather than by prefix, so a mistyped flag is rejected instead of silently ignored.
- `.github/workflows/ci.yml` — `actions/cache/restore` and `actions/cache/save` around the PR gate; save carries `if: always()` and `continue-on-error: true`. The `mutation-baseline` job is deliberately left without a score cache.

## Related Decisions

- ADR-0342: Mutation gate becomes a pure regression ratchet — defines *what* the gate compares. This ADR changes only *when* a score is measured; the ratchet contract is untouched.
- ADR-0327: CI line-coverage floor custom aggregate gate — the complementary coverage gate.

## References

- Failing run that motivated this: https://github.com/yourpapai/papai/actions/runs/31741632357/job/94586805434
- `openspec/changes/incremental-mutation-measurement/` — proposal, design and the `mutation-gate` capability spec.
