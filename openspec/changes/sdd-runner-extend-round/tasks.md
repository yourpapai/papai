## 1. Run state — `state.roundCap` field (design D3)

- [x] 1.1 Failing test in `tests/sdd-runner/run-state.test.ts`: `loadRunState` populates `roundCap` from `ROUND_CAPS[depth]` when the field is missing, preserves an explicit `roundCap` when present, and survives a `saveRunState` → `loadRunState` round-trip. Verify: `bun test tests/sdd-runner/run-state.test.ts` (fails)
- [x] 1.2 Add optional `roundCap?: number` to `RunState` (`sdd-runner/src/run-state.ts`); add a `resolveRoundCap(state)` helper that returns `state.roundCap ?? ROUND_CAPS[state.depth ?? 'S']`; use it at every cap-consumption site. Verify: `bun test tests/sdd-runner/run-state.test.ts`; `bun run typecheck`

## 2. Gate parser — `→ RUN 1 MORE` directive (design D2 + D6)

- [x] 2.1 Failing tests in `tests/sdd-runner/gate-model.test.ts`: (a) at an early gate, `→ RUN 1 MORE` on its own line produces a `GateResponse` with `extend: true`; (b) at a final gate, the same line throws with an error naming the line and explaining that extend is cap-hit-only; (c) `→ RUN 2 MORE`, `→ RUN MORE`, `→ RUN 1 MORE x` all throw with an error naming the line (only the literal `RUN 1 MORE` is accepted). Verify: `bun test tests/sdd-runner/gate-model.test.ts` (fails)
- [x] 2.2 Extend `parseGateResponse` (`sdd-runner/src/gate-model.ts`): add `gateMode: 'early' | 'final'` to `ExpectedGateContent`; add `extend: boolean` to `GateResponse`; recognize the regex `^\s*→\s*RUN 1 MORE\s*$` on a top-level line (no preceding unchecked box); reject at `gateMode === 'final'` with a clear error. Verify: `bun test tests/sdd-runner/gate-model.test.ts`; `bun run typecheck`

## 3. Review loop — parameterized entry point (design D4)

- [x] 3.1 Failing test in `tests/sdd-runner/review-loop.test.ts`: `runReviewLoop(deps, options, { startRound: 4, cap: 4 })` runs exactly one round, emits `round_open` with `round=4, cap=4`, emits no `round_open` for round 1, and threads `prevOpenBlockers` from the prior cap-hit sidecar (read via `readResolutionsLedger(sidecarDir, 4)` which finds `resolutions-3.json`). Verify: `bun test tests/sdd-runner/review-loop.test.ts` (fails)
- [x] 3.2 Change `runReviewLoop` (`sdd-runner/src/review-loop.ts`) signature to accept optional `{ startRound?: number; cap?: number }` (default `{ startRound: 1, cap: ROUND_CAPS[depth] }`); pass them through to `runRound`. The fresh-run caller (`runPlanningStages`) and resume caller (`runResume`) keep their existing behavior via defaults. Verify: `bun test tests/sdd-runner/review-loop.test.ts`; `bun test tests/sdd-runner/orchestrator.test.ts` (no regression); `bun run typecheck`

## 4. Gate digest — render the directive (design D2)

- [x] 4.1 Failing test in `tests/sdd-runner/gate-digest.test.ts` (or extend an existing renderer test): for an early-gate digest with `capHitFired: true`, the rendered MD contains a `### Extend` section with the line `→ RUN 1 MORE`; for a final-gate digest, no such section appears. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 4.2 Extend `writeGateDigest` (`sdd-runner/src/gate-digest.ts`) to append an `### Extend` section (with the directive and a one-line explanation "runs one more review round, then re-gates") when `input.mode === 'early' && input.capHitFired`. Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 5. Orchestrator — `runGateResume` extend branch (design D1 + D5)

- [x] 5.1 Failing test in `tests/sdd-runner/orchestrator.test.ts`: at an early cap-hit gate, writing `→ RUN 1 MORE` into `gate-1.md` and calling `runGateResume` produces: (a) `state.roundCap` bumped by 1; (b) a `round_open` event for round `state.round + 1` with the bumped cap; (c) `gate-2.md` with the appended trajectory row; (d) result `{ outcome: 'extend', version: 2, gateMdPath }`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 5.2 Failing test in `tests/sdd-runner/orchestrator.test.ts`: when the extended round converges (mocked/spied `runReviewLoop` returns `outcome: 'converged'`), `runGateResume` flows into decompose + atomicity and re-presents at `gate-2.md` with `mode: 'final'`; result is still `{ outcome: 'extend', version: 2 }`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 5.3 Failing test in `tests/sdd-runner/orchestrator.test.ts`: repeated extend — at `gate-2.md` (cap-hit again), a second `→ RUN 1 MORE` produces `gate-3.md` with `state.roundCap` bumped twice and a third trajectory row. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 5.4 Implement the extend branch in `runGateResume` (`sdd-runner/src/orchestrator.ts`): on `response.extend`, bump `state.roundCap`, re-enter `runReviewLoop({ startRound: state.round + 1, cap: state.roundCap })`, set `state.round = reviewResult.rounds`, then either re-present at early gate (cap-hit) or fall through `runDecomposeStages` + `presentGateAt` (converged). Add `'extend'` to `RunGateResumeResult['outcome']`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts`; `bun run typecheck`

## 6. Docs + final verification

- [x] 6.1 Update `docs/architecture/sdd-pipeline.md` "Gate protocol" section: document the `→ RUN 1 MORE` directive (early-gate only, Shape B, bumps `state.roundCap`, re-gates), with a worked example showing the trajectory growing by one row per extend. Note the state addition (`state.roundCap`) and the depth-vs-budget distinction. Verify: manual read
- [x] 6.2 Full verification: `bun test`, `bun run typecheck`, `bun run lint`, `openspec validate sdd-runner-extend-round --strict`. Update any other affected `docs/architecture/*.md` pages surfaced by the run.
