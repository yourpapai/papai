## Why

The cap-hit early gate is the moment the human has the most information about whether the review loop is converging or stuck — but today the only choices are approve, veto, abort. A trajectory like `2m → 4m → 2m` with steady 0 blockers is almost certainly one round from closure, yet the only way to find out is to override and proceed to decomposition with material findings unresolved. The cap exists to bound spend, not to terminate a converging loop short of closure.

## What Changes

- **New gate payload type `extend`**: at an early cap-hit gate, the human may write `→ RUN 1 MORE` on its own line. The runner bumps the round cap by 1, executes the next review round, and re-presents the gate at version `n+1` with the new trajectory appended.
- **Shape B — extend-and-re-cap**: each `→ RUN 1 MORE` runs exactly one round and re-gates. One decision binds one round of spend; repeated extends converge only when the human approves or the loop converges naturally.
- **Early-gate only**: the parser rejects `→ RUN 1 MORE` in a final gate (post-convergence there is nothing to extend) with a clear error.
- **State**: new optional `state.roundCap` field defaults to `ROUND_CAPS[depth]` and is bumped by each extend. The depth profile itself is preserved — `state.depth` stays `M` even after three extends raise the effective cap to 6.
- **Carry-forward**: the extended round reads the prior `resolutions-<k>.json` as its ledger (existing sidecar behavior) and `prevOpenBlockers` flows from the cap-hit state (existing lens-escalation rule).
- **Outcome wiring**: `runGateResume` gains an `'extend'` outcome kind returning `{ runId, outcome: 'extend', version: n+1, gateMdPath }`. If the extended round converges, the run flows into decompose → atomicity → final gate as a fresh `runPostReviewToGate` would.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (currently delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, **not yet archived to `openspec/specs/`**): this change's `.openspec.yaml` sets `skip_specs: true` per the precedent set by `sdd-veto-resolver-pass` — the capability is not yet in `openspec/specs/`. The "Single human gate" requirement currently enumerates four payload types (approve / veto / answer / abort); this change adds **extend** as a fifth, scoped to early-gate mode only, with a new scenario. The "Adaptive depth profiles" requirement's static `ROUND_CAPS = { S: 1, M: 3, L: 4 }` becomes the *initial* cap; the cap is now extensible upward by per-run human decisions while the depth profile itself stays fixed.

## Non-goals

- No `→ RUN N MORE` parameterization — each extend is exactly +1 round; repeated extends require writing the directive again at each successive gate.
- No extend-and-auto-resume (Shape A) — each extend runs one round and re-gates; the human renews the decision every time.
- No extend at the final gate — the final gate fires post-convergence, where there is nothing to extend.
- No mid-run budget cap — `budgetUsd` exists in `RunnerConfig` but is not enforced today; threading it is independent.
- No agent-summarizer, change digest, trajectory verdict, or cost-fix — scoped under separate explorations.
- No new agent roles, no new external dependencies, no DB migration, no scope-model impact.

## Impact

- **Code**: `sdd-runner/src/gate-model.ts` (parser branch for `→ RUN 1 MORE`; reject at final gate; new outcome kind `'extend'` on `GateOutcome`), `sdd-runner/src/orchestrator.ts` (`runGateResume` extend branch — bump `state.roundCap`, re-enter the review loop at `state.round + 1`, re-present gate via `presentGateAt`; converged-after-extend path falls through to `runPostReviewToGate`), `sdd-runner/src/run-state.ts` (add optional `roundCap` with defaulting), `sdd-runner/src/review-loop.ts` (`runReviewLoop` accepts starting round + cap instead of re-reading `ROUND_CAPS[depth]`), `sdd-runner/src/gate-digest.ts` (`writeGateDigest` emits the `→ RUN 1 MORE` directive at early gates). File-by-file breakdown in design D2.
- **Tests**: new cases in `tests/sdd-runner/gate-model.test.ts` (parser accept/reject across modes), `tests/sdd-runner/orchestrator.test.ts` (extend outcome produces `gate-<n+1>` with bumped cap and appended trajectory; extended round converging flows to decompose/final gate; repeated extends).
- **Docs**: `docs/architecture/sdd-pipeline.md` Gate protocol section — extend payload type, scenario, state semantics.
- **Affected platform/task instances**: none. **Config-context scope impact**: none — runner-internal dev tool, no papai runtime touch.
