<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0427: Baseline Records Carry Their Kill Counts — the Ratchet Fails Regression and Warns on Dilution

## Status

Accepted

## Date

2026-08-30

## Context

`scripts/mutation/baseline.json` records one number per file — the aggregate `(killed + timeout) / scored` ratio — and the PR ratchet (ADR-0342) fails any baselined file whose score drops below that floor. A ratio alone cannot say *why* a score moved. Adding new, not-yet-fully-tested functionality to a well-baselined file grows the scored population with survivors while every old test still kills every old mutant — the score sinks below the floor, the gate reports a "regression", and the PR blocks even though killing power never dropped. The ratchet cannot distinguish real test weakening (the numerator fell) from new-code dilution (the numerator held while the denominator grew), so it blocks legitimate feature work and rewards gaming the ratio with throwaway assertions.

Every measurement point already carries the raw counts: `MergedScore` holds `killed`, `timeout`, and `scored`, and the score cache persists a full `MergedScore` per file (so carried-over scores from ADR-0424 get the richer verdict for free). Only the committed baseline threw the counts away.

## Decision Drivers

- **The ratchet exists to catch weakening, not growth.** A floor must compare what a run achieved against what was actually achieved before — absolute kills against absolute kills — not a percentage of a population that legitimately changes size.
- **A committed floor must be self-validating.** `baseline.json` is an enforcement artifact edited by humans (hand-tuned floors) and merged by machines; a corrupt or merge-mangled entry must fail loudly rather than silently gate on nonsense.
- **Migration cannot demand a full re-measure.** Most entries cannot be re-measured on demand: the master seed measures only changed files, and a full-suite mutation run is hours. Whatever shape change happens must work under changed-files-only cadence and never weaken enforcement mid-migration.
- **Two writers, two readers, one interpretation.** The CI master seed and the improvement runner both write the baseline; the PR gate and the runner both read it. The record contract must live in exactly one place so all four interpret entries identically by construction.

## Considered Options

### Option 1 — Rich records `{score, killed, timeout, scored}`, dual-shape lazy migration, dilution warns (chosen)

Each baseline entry becomes either a rich record — the score plus the three counts that produced it, stored decomposed exactly as `MergedScore` names them — or, during migration, a bare legacy number. The ratchet verdict per file becomes: score at or above the recorded score passes silently; below it, the numerators decide — fewer kills than the record is a true regression (fail the PR, naming score and kills against the recorded ones), kills held or better is new-code dilution (exit 0 with a visible `WARN` naming the file, its held kill count, and both scores). A score-only legacy record is judged by score alone — it cannot classify dilution, so it keeps the stricter judgment until its file is next measured at or above its recorded score and gains counts.

- **Pros:** the gate stops failing the exact PRs it exists to unblock; a corrupted record is detectable at load (arithmetic consistency); score stays committed for human-readable diffs and a graceful legacy fallback; merges stay monotonic per-key max with counts riding along; no big-bang re-measure.
- **Cons:** a hand-tuned floor must now keep its counts consistent with the formula or the gate fails at load; legacy entries keep failing diluting-but-not-weakening PRs until converted; rollback must pair code and data (old code rejects rich entries).

### Option 2 — Numerator-only records `{killed, scored}` (rejected)

Store the numerator and denominator without decomposing the kill side.

- **Pros:** two fields instead of four.
- **Cons:** hides the timeout contribution, breaks exact score recomputation, and reuses the name `killed` with a different meaning than `MergedScore.killed` — a standing bug farm. The verdict compares `killed + timeout` numerators, so a killed→timeout reclassification (slower tests, same killing power) must not read as a kill change.

### Option 3 — One-time full reseed to the new shape (rejected)

Delete `baseline.json` and regenerate from a full `bun test:mutate` run.

- **Pros:** every entry converts immediately; no dual-shape reader needed.
- **Cons:** needs a full-suite mutation run (hours); re-floors every file from a single fresh measurement, so transient flakes seed permanently low floors; discards the tuned history the ratchet exists to preserve.

## Decision

Adopt Option 1.

1. **Record shape.** A rich entry is `{score, killed, timeout, scored}`. `killed` and `timeout` are stored separately, not pre-summed, so field names are `MergedScore`'s own (zero translation at write/read time) and the score is exactly recomputable; the shared `recordNumerator`/`measurementNumerator` helpers export the `killed + timeout` sum so no consumer hand-rolls it against the wrong fields. The top-level file stays a bare sorted JSON map — migration is per-entry shape sniffing, which a file-level version wrapper cannot express.
2. **Verdict rule.** `resolveRatchet` returns `{exitCode, regressions, dilutions}`. Score ≥ floor passes silently; score < floor with fewer kills is a regression (exit 1, message `file score < floor, kills m < n recorded`); score < floor with kills held is dilution (exit 0, one `WARN` log line — not a CI annotation; the failure surface stays exactly one exit code). First-touch and `scored === 0` files stay skipped.
3. **Integrity at load.** A rich record must satisfy: the three counts finite non-negative integers with `scored > 0`; `score` finite in [0, 1]; `killed + timeout ≤ scored`; and `score ≈ (killed + timeout) / scored` within 1e-9. Violations throw at load naming the file and the expected relation. Provenance is unverifiable; arithmetic consistency is, and it is exactly what a badly auto-resolved merge conflict or hand edit breaks.
4. **Lazy dual-shape migration.** Readers accept bare or rich per entry; writers always emit rich records; the committed `baseline.json` is not rewritten wholesale. A legacy entry converts the first time its file is measured at or above its recorded score by a seeding or bumping run — the equal case being the ordinary one, since mutation scoring is deterministic and marginal merges tie. A below-floor measurement leaves the legacy entry untouched: the floor must not drop, and counts cannot be paired with a score they did not produce. Merges stay per-key max: a strictly-higher score replaces the record wholesale (score and counts of the measurement that achieved it, never a mix); equal-or-lower over a rich record leaves score and counts untouched by reference (no flake churn, and the runner's no-op commit suppression keeps working); the single carve-out is the equal-score legacy→rich shape upgrade at an unchanged floor.
5. **One record contract.** The record type, guards, numerators, and arithmetic validation live in `scripts/mutation/baseline-record.ts`, re-exported through `scripts/mutation/baseline.ts`; the improvement runner imports them from there instead of keeping a hand-synced copy, and its record-level `bumpScore` shares the same per-entry merge function.

## Rationale

The gate's guarantee — "a merged regression cannot have been scored below its floor unnoticed" — does not require failing dilution; it requires telling dilution apart from weakening so that only weakening blocks. Storing the counts decomposed is what makes the distinction computable at all, and validating them at load is what makes the new channel trustworthy: a floor that quietly mixed a score from one measurement with counts from another would misclassify both ways. Lazy conversion fits the changed-files cadence because the tie is the common case, and the score-only fallback for unconverted entries is the *stricter* rule — migration can only add information, never weaken a floor.

## Consequences

### Positive

- Feature work on well-baselined files no longer fails the gate when tests did not weaken; dilution is visible instead of blocking.
- A failing run names the measured score and kill count against the recorded ones, so the fix (restore kills) is legible from the failure alone.
- A corrupted, hand-mangled, or merge-mangled record fails the run at load with the file and expected relation named.
- Carried-over scores (ADR-0424) get the full verdict for free — the score cache already persists counts.

### Negative

- A hand-tuned floor must be recorded with consistent counts (compute them from the intended score, or re-measure); the load error makes the fix mechanical.
- Legacy score-only entries keep the stricter judgment — a diluting-but-not-weakening PR still fails on not-yet-converted files. Bounded and self-healing: each file converts at its next equal-or-higher master-seed measurement; the optional one-time full-run conversion (delete + regenerate, or `bun test:mutate --update-baseline` as a full run) closes the window for teams that prefer it.
- Deleting covered code shrinks the population and drops the absolute numerator, so a score dip with fewer kills still fails — identical to the previous score-only ratchet; floors only tighten, so removal is resolved the way it always was: a hand-adjusted floor, kept count-consistent.

### Risks

- **Rollback pairs code and data.** Old `loadBaseline` rejects rich entries, so reverting the code while keeping the new `baseline.json` bricks the gate. Roll back together: revert the change-set commit *and* `git checkout <pre-change> -- scripts/mutation/baseline.json`. A partially-converted baseline rolls back cleanly to score-only floors — scores are identical in both shapes, so no floor is lost.
- Per-entry shape sniffing means a typo'd record throws instead of degrading — intended; a wrong record was never safe to gate on, and the error names the file.

## Implementation Notes

- `scripts/mutation/baseline-record.ts` — record type, `isBaselineRecord`, `recordNumerator`/`measurementNumerator`, `parseBaselineEntry` with arithmetic validation; `scripts/mutation/baseline.ts` — dual-shape `BaselineMap`, `buildBaselineFromPerFile`, `mergeBaselineEntry` (shared with the runner's `bumpScore`), `resolveRatchet` verdict; `scripts/mutation/gates.ts` — `GateVerdict.warnings` and the kills-rendering regression message; `scripts/mutation/changed-files.ts` — `reportGateVerdict` `WARN` printing; `scripts/mutation/seed-from.ts` — record-aware snapshot through the shared helpers; `mutation-improve/src/` — shared-contract `baseline.ts`, counts-bearing `MeasuredScore`/`GateOutcome`, measurement-passing bump call sites, mixed-shape SELECT prompt.
- `scripts/mutation/baseline.json` itself is not edited by this change: conversion happens lazily at each file's next equal-or-higher measurement.

## Related Decisions

- ADR-0342: Mutation gate becomes a pure regression ratchet — this decision extends it; the ratchet stays pure-regression, and dilution is surfaced, never failed.
- ADR-0424: Fingerprint-guarded carried-over scores — untouched by this decision; carried-over scores simply receive the richer verdict through the same `MergedScore` counts.

## References

- Change artifacts: `openspec/changes/mutation-testing-baseline-json-improve/`
- Policy documentation: `scripts/mutation/README.md`
