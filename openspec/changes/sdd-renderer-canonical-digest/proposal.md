## Why

The dogfood run that surfaced `sdd-runner-cap-hit-fidelity` also exposed two pre-existing renderer issues, both invisible while `renderBurndown` and `renderGateScreen` sat dormant:

- The **live burndown** (`formatEvent(convergence)` at `renderer.ts:57`) is non-compliant with `sdd-automation` spec:57 — it omits `resolved` and `dismissed` counts (the spec's "e.g." is permissive on format details, not on field set). The closest-to-spec formatter (`renderBurndown`) is dead code. Four consumers (spec example, dead `renderBurndown`, live `formatEvent`, `materializeReview`) currently use three different format strings.
- **`renderGateScreen`** (exported, tested, never called) and **`--wait`** (parsed in `cli.ts:64`, plumbed through `StartOptions`, never read in the orchestrator) are forward-compat placed for a live-watching future with **no current consumer** — not even `/sdd:auto`, which is documented at `docs/architecture/sdd-pipeline.md:62` but not implemented.

`cap-hit-fidelity` needs trajectory rendering at the gate file; writing a bespoke formatter there is refactor-bait. This change establishes the canonical digest shape first so `cap-hit-fidelity` consumes it cleanly, and closes the spec:57 gap as a side effect.

## What Changes

- **`DigestRecord` type** (per-round: `{ round, counts, resolved, dismissed, verdict }`) + a reducer deriving `ReplayState.perRound: DigestRecord[]` from `finding` + `convergence` events. Honors the spec's "rebuild by replay" (spec:32): records derived from the event log, not renderer-private state.
- **`formatBurndownLine(record)`** — spec:57-compliant; wired at `round_close` (replaces `formatEvent(convergence)` ad-hoc formatting). The live scroll region now shows the same line the spec mandates.
- **`formatTrajectoryBlock(records[])`** — multi-round block formatter for the gate file. Speculative API; consumed by `sdd-runner-cap-hit-fidelity` (next change in the stack).
- **Delete `renderBurndown`** + its test (dead, subsumed by `formatBurndownLine`).
- **Delete `renderGateScreen`** + its test, and **remove `--wait`** from CLI parse + `StartOptions` + the index.ts help line. No live consumer exists; re-add fresh together when one materializes.
- **Align `materializeReview`'s round header** (`materialize.ts:63`) to format from a `DigestRecord` — closes the fourth-format drift; one shape, all consumers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (still delta-`ADDED` by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, not yet archived): no new requirements — this change brings impl into compliance with the existing "Round-close burndown" scenario (spec:57) and honors the existing "Replay reconstruction" property (spec:32). `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- No gate-file enrichment (open MATERIAL checkboxes, T1 ack, trajectory block wired into `writeGateDigest`) — `sdd-runner-cap-hit-fidelity`'s scope. This change ships only the formatter it will call.
- No cap-hit spec amendment — `sdd-runner-cap-hit-fidelity`.
- No live gate screen / `--wait` re-implementation — deleted here; restored together when a real consumer (e.g. `/sdd:auto`) materializes and pulls it.
- No change to the resolver's taxonomy or prompting (Thread B) or cost-display work (Thread C1) — both deferred in `sdd-runner-cap-hit-fidelity`'s design D4.
- No papai runtime impact: no platform/task instances, no DB, no scope-model. `sdd-runner` is local developer tooling.
- No new third-party deps.

## Impact

- **Code**: `sdd-runner/src/events.ts` (`DigestRecord` type + reducer; `ReplayState.perRound`); `sdd-runner/src/renderer.ts` (delete `renderBurndown` + `renderGateScreen`; drop `convergence` from `formatEvent`; add `formatBurndownLine` + `formatTrajectoryBlock`); `sdd-runner/src/materialize.ts` (round header alignment); `sdd-runner/src/cli.ts` + `orchestrator.ts` + `index.ts` (remove `--wait`).
- **Tests**: `tests/sdd-runner/renderer.test.ts` (delete two describe blocks; add burndown + trajectory tests); `tests/sdd-runner/events.test.ts` (reducer); `tests/sdd-runner/materialize.test.ts` (header alignment).
- **Docs**: `docs/architecture/sdd-pipeline.md` (command surface: drop `--wait` from documented flags).
- **Cross-change coordination**: `openspec/changes/shared-tui-renderer/{proposal.md, design.md}` claim `renderGateScreen` is preserved unchanged (proposal:10, design:110) — this change deletes that function. Task 6.1 updates those references; the prose drift is otherwise cleaned up at archive.
- **Affected platform/task instances**: none. **Config-context scope impact**: none (no per-user / group-shared / thread-isolated state).
