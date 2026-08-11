## Why

Dogfooding `sdd-runner` (M-profile run on `shared-tui-renderer`, runId `2026-08-10T17-15-37-540Z-1828d7a9`) surfaced a spec gap in the cap-hit gate. The `sdd-automation` capability spec (`openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md` — delta, not yet archived) defines the early cap-hit gate only for the unresolved-BLOCKERs case (spec:103/113/164/183). When the loop hits the round cap with **0 BLOCKERs but MATERIAL findings still open** — the common case for any healthy reviewer that keeps finding fixable gaps — the implementation halts and presents a gate with an empty surface (no blockers, no assumptions) that `parseGateResponse` approves vacuously. The run above hit this exactly: rounds trended 6m→1m→2m with the resolver editing every finding, but the human was asked to approve blind, with no view into what the reviewer kept raising or whether the loop was healthy vs pathological. This change closes the gap.

## What Changes

- **Early-gate surface**: when cap-hit fires with open MATERIAL findings (regardless of BLOCKERs), the gate digest SHALL list the final round's open MATERIAL findings with their gaps + resolver outcomes, plus a per-round burndown trajectory so the human can distinguish a converging loop from a stuck one.
- **Vacuous-approval guard** *(correctness bug)*: an early gate SHALL NOT be trivially approvable when cap-hit fired. The gate SHALL require an explicit positive signal (a "trajectory reviewed" ack box) even when no BLOCKERs and no assumptions are present. `--confirm-all` SHALL check it like any other.
- **BLOCKER-cap-hit semantics unchanged** — existing answer/OVERRIDE protocol preserved.
- **Spec amendment** *(deferred landing)*: new scenarios for the MATERIAL-only cap-hit case. Language captured in design.md D2; lands by amending `auto-sdd-pipeline`'s `sdd-automation` delta pre-archive (preferred) or as a follow-on change post-archive.
- *(Correction during planning: an earlier verification note claimed `tests/sdd-runner/` was missing — that was a bad search. The directory exists with 23 test files. This change adds new cases to existing files; no new directory.)*

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (currently delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, **not yet archived to `openspec/specs/`**): the "Objective convergence predicate" (spec:103) and "Single human gate" (spec:164) requirements gain scenarios covering the MATERIAL-only cap-hit case. This change's `.openspec.yaml` sets `skip_specs: true` because the capability is not yet in `openspec/specs/` (same condition `sdd-runner-orchestrate` used); the amendment language lives in `design.md` D2 and lands by editing `auto-sdd-pipeline`'s delta.

## Non-goals

- No change to BLOCKER-cap-hit semantics (answer/OVERRIDE protocol unchanged).
- No change to the resolver's taxonomy or prompting — **Thread B** (resolver rarely emits `assumed` because `edited` is almost always available, leaving the assumption-checkbox surface chronically idle) is documented in design.md D4 as a deferred thread.
- No cost estimation for providers that skip `costUsd` — **Thread C1** (`$0.00` display) documented in design.md D4 as deferred.
- No papai runtime impact: no platform/task instances, no DB, no scope-model, no `tool_prefs`/capability gating. `sdd-runner` is local developer tooling; run state stays gitignored under `.sdd-runner/`.
- No new third-party deps.

## Impact

- **Code**: `sdd-runner/src/gate-digest.ts` (`blockersOf` → generalize to surface open MATERIAL + trajectory), `sdd-runner/src/gate-model.ts` (`writeGateDigest` adds trajectory + ack box; `finalizeResponse` rejects vacuous approval), `sdd-runner/src/review-loop.ts` (`ReviewLoopResult` carries final-round open findings), `sdd-runner/src/orchestrator.ts` (wire richer result through `presentGateAt`). The trajectory block reuses `formatTrajectoryBlock` from `renderer.ts` and `DigestRecord` / `replayEvents` from `replay.ts` (both shipped by `sdd-renderer-canonical-digest`).
- **Tests**: new cases in existing `tests/sdd-runner/{gate-digest,gate-model,review-loop,orchestrator}.test.ts`.
- **Docs**: `docs/architecture/sdd-pipeline.md` (gate protocol — note MATERIAL-only cap-hit path + ack box).
- **Spec**: `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md` (preferred landing) — new scenarios under "Objective convergence predicate" and "Single human gate".
- **Affected platform/task instances**: none. **Config-context scope impact**: none (no per-user / group-shared / thread-isolated state).
