# Shard the mutation PR gate across a sized job matrix

## Why

The mutation gate is the CI wall clock. On run
[33292465702](https://github.com/yourpapai/papai/actions/runs/33292465702) every other job finished
in 5 minutes while mutation testing ran 73m21s — 81% of its own 90-minute timeout. Work is linear in
changed-file count (~107s/file over 252 measurements) and `pairedRun` runs files strictly
sequentially, one independent Stryker process each. Measured per-file timings bin-pack at ≥95%
efficiency to 12 shards; sharding is worth ~5x.

## What Changes

- Split the PR gate job into **plan → k × shard → gate**. Plan selects whole-branch targets, applies
  the existing reuse split, builds the coverage map once, and emits a matrix. Shards measure only.
  The gate combines every shard's results and renders the verdict.
- **Size the matrix from estimated work, not a constant:**
  `k = clamp(ceil(ΣW / max(B, maxW)), 1, 12)`, where `B = T_target − orchestration` and `W` is a
  per-file weight from source lines (`≈12s + 0.505·lines`). Below ~5.5 min of estimated work the plan
  emits a single shard — a 1–3 file PR must not spawn a matrix.
- **Weight the bin-packing by the same estimate.** Worth as much as sizing (−8.5m vs −8.6m across the
  16 measured runs; −17.7m together).
- Pass the coverage map to shards via the existing `PairedRunDeps.buildMap` seam instead of rebuilding
  it per shard (+9% wall otherwise).
- Move the `if: always()` score-cache save to the gate job.

## Capabilities

### New Capabilities

- `mutation-shard-planning`: how a run divides its measurement work — shard sizing, per-file
  weighting, the single-shard floor, the shard cap. Without it there is no rule for `k`, so the gate
  must either always fan out (12 jobs for a 1-file PR) or never. No existing capability covers work
  division; `mutation-gate` deliberately covers only the verdict.

### Modified Capabilities

- `mutation-gate`: the verdict is now assembled from distributed measurement. Adds one requirement —
  the gate SHALL fail when any planned target is missing from the combined results. Without it a
  crashed or timed-out shard silently drops its files and the ratchet finds nothing to fail on,
  turning a blocking gate green. Existing requirements are unchanged in substance.

## Non-goals

- **Narrowing the score fingerprint.** 16 of 21 runs measured everything because one test edit in a
  flat package dir invalidates every source in it. Likely a larger win, but it is the one change that
  can let a stale score past the ratchet. Declined here: sharding is verdict-neutral and lands first.
- **A duration hint cache.** ~13m more across the measured runs; deferred until real sharded runs can
  measure it instead of a replay.
- **Per-package cost slopes.** Slope varies 2x by package, but n=20 and n=4 outside `sdd-runner`. Not
  fittable yet; over-estimation costs slots, not wall clock, so it fails safe.
- **KMAX above 12** (identical at 16 and 24 — the slowest file, 5.6m, floors it), and any change to
  the master `mutation-baseline` seed job.

## Impact

- `.github/workflows/ci.yml` (`mutation-testing`), `scripts/mutation/{changed-files,paired-run,incremental-run}.ts`.
- Reused unmodified: `combineIncrementalResult`, `resolveChangedFilesGates`.
- Docs: `scripts/mutation/README.md`, `CLAUDE.md` testing notes, ADR-0424.
- **Scope impact: none** — CI tooling; no platform instance, task instance, or config context.
- Peak concurrency ~22 jobs/PR at KMAX=12; KMAX=8 costs ~1.5 min on the worst run.
