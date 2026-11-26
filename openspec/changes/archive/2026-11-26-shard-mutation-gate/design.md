# Design — Shard the mutation PR gate

## Context

See proposal.md — Why. What matters for the approach is what was measured, across 21 mutation job
logs and 252 per-file measurements:

| Quantity | Measured |
| --- | --- |
| Per-file Stryker cost | mean 107s, median 93s, p90 227s, max 372s |
| Total work vs. file count | near-linear (`≈107s × N`) |
| Bin-packing efficiency | ≥95% to 12 shards; knee at 12–13 |
| Hard floor | slowest single file, 5.6m on the largest runs |
| Fixed job setup | 12.0s median, 18.0s p90 (provision + checkout + bun + node + install + restore) |
| Target selection + fingerprinting | 0.2s median, 0.47s max — free |
| Coverage-map build | bimodal: 1.2s warm (8 runs) / 101.5s cold (8 runs) |
| Teardown | 2.8s median |

Two structural facts shape everything:

**Cost is already separable per file.** `pairedRun` writes one ephemeral Stryker config and one JSON
report per source file and runs them in a sequential `forEach`. Files share only the coverage map
built once per batch. There is no cross-file state to untangle.

**Score reuse is bimodal, not incremental.** In 21 runs, not one had a partial measured/reused split
— 16 measured everything, 5 measured nothing. A source's fingerprint hashes its whole candidate test
universe, which for a flat package directory is every test in it (`sdd-runner/src` has 100 sources
against 106 flat tests). One test edit invalidates the package. So the cold path is the normal path
on exactly the commits this gate provokes, and cannot be cached away within this change.

## Goals / Non-Goals

**Goals**

- Keep the verdict bit-identical to what a single-process run would produce, for any shard count.
- Make the fan-out shape cost nothing when there is nothing to fan out.
- Reuse the existing pure combination and gating functions rather than reimplementing the verdict.

**Non-Goals** (beyond proposal.md — Non-goals)

- Reducing total runner-minutes. Fan-out adds ~46s of fixed overhead per run; this trades compute
  for wall clock deliberately.
- Changing what a target is, how a score is computed, or how the ratchet reads `baseline.json`.
- Sharding the master `mutation-baseline` seed job.

## Decisions

### D1. Plan / shard / gate, over per-shard independent selection

Each shard could compute the branch diff itself and filter to its own slice by a stable hash. That
needs no artifacts and no plan job. Rejected: every shard would independently rebuild the coverage
map (+9% wall, measured), and hash-partitioning is cost-blind — it cannot balance by estimate, which
is worth as much as sizing (−8.5m vs −8.6m across the 16 measured runs; −17.7m together).

A dedicated plan job costs one job (~20s warm) and makes the division a decision made once with full
information. It also gives the gate job a manifest to reconcile against, which is what the
`mutation-gate` delta's first requirement needs to be checkable at all.

### D2. Size from estimated work, not from file count

`k = clamp(ceil(ΣW / max(B, maxW)), 1, KMAX)` where `B = T_target − orchestration`.

The `max(B, maxW)` term matters: LPT makespan is bounded below by the largest single item, so shards
past `ΣW / maxW` buy nothing. Without it, sizing overshoots by ~40% on the 38-file runs.

`ceil(N/3)` was the runner-up and tracks the optimum closely (88m vs 82m across 16 runs), but it is
blind to the 6.8x spread in per-file cost between packages and would under-shard a small set of
expensive files. Work-based sizing degrades to it when every weight is equal.

`B` is computed at plan time rather than fixed, because the plan job has already built the coverage
map and therefore knows which of the two cost regimes this run is in.

### D3. Weight by source lines, not by a duration cache

Correlation against measured duration, 226 files:

| Predictor | Pearson | Spearman |
| --- | --- | --- |
| Mutant count (prior report) | 0.698 | 0.773 |
| Source bytes × #tests | 0.553 | 0.639 |
| Source lines | 0.517 | 0.597 |
| # same-package tests | 0.253 | 0.159 |

Mutant count wins and is already persisted — `MergedScore.total` in `score-cache.json`, carried
between pushes, identical across runs for 72% of files. But consuming it means reading past the
fingerprint, which is the same seam the deferred fingerprint work touches. Keeping those apart is
worth more than the difference: chronological replay puts lines-only at 108.8m against 122.9m for a
flat constant and 84.3m for perfect knowledge — **36% of the available gain for `wc -l`**, no cache,
no schema change.

Fit: `≈12s + 0.505s × lines`. Note the slope varies ~2x by package (`sdd-runner` 0.505, `review-loop`
0.256); with n=20 and n=4 outside the dominant package there is not enough data to fit per-package
slopes, and over-estimation costs concurrency slots rather than wall clock, so the global fit fails
safe.

Test-set size is deliberately unused despite the intuition that it should matter:
`coverageAnalysis: "perTest"` means a mutant runs only its covering tests, so a larger candidate set
costs nothing — visible above as 0.159 Spearman, and as the interaction terms adding nothing over
mutants alone.

### D4. Pass the coverage map down through the existing seam

`PairedRunDeps.buildMap?: (sourceFiles) => CoverageMap` already exists as an injectable. The plan job
builds the map for all targets and publishes it; shards inject a reader over it. No new module: this
is the dependency question answered one level in — the seam that exists is the seam to use.

The spec requires a fallback (an executor that cannot consume the shared map computes its own),
which the existing production default already provides.

### D5. Reuse the existing verdict path unchanged

`combineIncrementalResult` already merges "measured now" with "carried over" into a whole-branch
`GateInput`; merging N shards is the same operation with more inputs.
`resolveChangedFilesGates` is already pure — `result` in, verdict out, caller prints. Neither needs
to know how many processes produced the per-file list. Shard artifacts must therefore carry
`perFile`, `skipped` **and** `errored`, because `resolveErroredGate` is load-bearing.

Shards exit 0 on a low score. They measure; the gate judges.

## Risks / Trade-offs

- **A lost shard silently narrows the gate** → the single most dangerous failure mode: a dead
  executor drops its files, the ratchet finds nothing to fail on, and a blocking gate goes green.
  Mitigated by the plan manifest and the reconciliation requirement in the `mutation-gate` delta,
  which is a spec-level contract with its own scenarios, not an implementation detail.
- **Concurrency pressure** → ~22 jobs per PR at KMAX=12 (12 shards + 8 existing + plan + gate).
  Over the 20-job cap on GitHub Free, fine on Team. KMAX is configurable; KMAX=8 costs ~1.5m on the
  worst measured run. Under multiple concurrent PRs, queued shards give back the wall clock they
  bought — this is the main reason to keep KMAX tunable rather than fixed.
- **Cache-key contention** → `actions/cache` entries are immutable per key and shards must not race
  to write one. The gate job is the sole writer of the merged score cache; shards publish results as
  artifacts only.
- **Estimates degrade silently** → a drifting `lines` slope makes runs slower without failing
  anything. Mitigated by the plan job logging estimated versus actual per shard, so drift is visible
  in the run log rather than inferred from wall clock.
- **`--no-score-cache` and `--update-baseline` paths** → both disable reuse and must keep working
  unchanged, including the single-shard path used by the baseline seed job.

## Migration Plan

The runner keeps a single-process path — that is what `k = 1` is — so there is no dual
implementation to maintain and no flag to retire. Rollback is reverting the workflow job to the
current single-job form; the script changes are inert under `k = 1`.

Staging: land the script-side split (plan / measure / combine as separately invocable commands)
first, verified locally against a real branch diff; then switch the workflow. The script split is
observable through its own tests before any CI topology changes.

**Hook/TDD interaction.** `isGateableImplFile` covers `src/`, `client/`, `plugins/`,
`review-loop/src/` and `sdd-runner/src/` only, so new files under `scripts/mutation/` are neither
gated by the Write/Edit TDD hook pipeline nor selected as mutation targets. Companion tests under
`tests/scripts/mutation/` are still written first here — the work is worth doing test-first
regardless of what enforces it — but nothing blocks a write that skips them. The new modules
are pure enough to test directly: sizing and packing take a target list plus weights and return an
assignment, and reconciliation takes a manifest plus results and returns a verdict — all without
spawning Stryker. Note that adding files to `scripts/mutation/` changes the toolchain fingerprint
and so invalidates every carried-over score once on merge; this is expected and self-correcting.

## Open Questions

- **KMAX default: 8 or 12.** Depends on the repository's GitHub plan and typical concurrent-PR count,
  neither of which is determinable from the run logs. Both are one-line config; the specs and task
  breakdown are identical either way.
- **`T_target`.** 6 minutes was chosen to sit just above the next-longest CI job (Hermetic Full-Stack
  Stories, 3m39s) with headroom. Worth revisiting once sharded runs exist, since the floor is the
  slowest single file (5.6m) and there is little room between them.
- **The division threshold.** Break-even for `k = 2` is ~1.5m of work; the proposed ~5.5m threshold
  targets a ≥2-minute saving. No measured run fell between 1.7m and 15.5m of work, so any threshold
  in that range behaves identically on the available data and this is an analytic choice, not a
  fitted one.
