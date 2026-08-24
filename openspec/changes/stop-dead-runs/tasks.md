## 1. Holder record (design D1)

- [x] 1.1 Failing tests in `tests/sdd-runner/stop-controller.test.ts`: holder schema (pid + startedAt, Zod-validated), write at entry / remove on exit, and `isAlive`-injected liveness (alive pid, ESRCH dead, EPERM alive, missing file → dead). Then implement in `sdd-runner/src/stop-controller.ts`. Verify: `bun test tests/sdd-runner/stop-controller.test.ts`
- [x] 1.2 Failing tests that `runStart`, `runResume`, and `runContinue` write the holder before stage work and remove it in their exit path (crash left behind). Wire into `sdd-runner/src/orchestrator.ts`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (or the closest existing suites for these entry points)

## 2. Liveness-aware stop seam (design D2 + D3)

- [x] 2.1 Failing tests for `stopRun(workDir, runId, deps)` in `tests/sdd-runner/stop-controller.test.ts`: no-op on non-running status; marker-requested when holder alive; settled-stopped when dead mid-pipeline; settled-aborted when dead at `intake` with `depth: null`; stale `stop-requested` marker consumed on settle; `updatedAt` bumped via `saveRunState`. Then implement `stopRun` in `sdd-runner/src/stop-controller.ts` (injectable `isAlive`). Verify: `bun test tests/sdd-runner/stop-controller.test.ts`
- [x] 2.2 Failing tests for the outcome → stdout line mapping (design D4: marker / settled·resumable / settled·nothing-to-resume / no-op). Implement as a pure formatter next to `stopRun`. Verify: `bun test tests/sdd-runner/stop-controller.test.ts`

## 3. Wiring

- [x] 3.1 Replace the harness `requestCalmStop` body (index.ts) with a `stopRun` wrapper; failing test first covering the CLI stop verb (`sdd stop <id>`) message for each outcome. Verify: `bun test tests/sdd-runner/cli.test.ts` (or the existing CLI-verb suite)
- [x] 3.2 Session screen `s` key: extend the scripted-key picker test to assert the stop target executes `stopRun` outcomes and that `session-flow.ts` prints the mapped line instead of the hardcoded message. Verify: `bun test tests/sdd-runner/tui-session-picker.test.ts` (or the existing session-flow suite)

## 4. Close-out

- [x] 4.1 Update the stop-semantics paragraph in `docs/architecture/sdd-pipeline.md` (runner commands: liveness-aware stop, per-stage settle, legacy runs settle on first stop). Verify: `bun run lint && bun run format:check`
- [x] 4.2 Full gates: `bun test`, `bun run typecheck`, `bun run lint` — plus manual smoke on the current zombie run `.sdd-runner/runs/2026-08-22T04-07-55-953Z-0fea03ec` (expect: settles aborted, bare `sdd` no longer routes to it). Verify: `bun run test:status`

## 5. Routing follow-up (design D5, discovered in apply)

- [x] 5.1 Failing routing test: on a TTY a sole completed run opens the session screen (both runs selectable, create reachable) while non-TTY keeps the direct report; drop the sole-completed direct-route in `routeBySoleCandidate`'s tty branch. Update the routing paragraph in `docs/architecture/sdd-pipeline.md`. Verify: `bun test tests/sdd-runner/cli-routing.test.ts && bun run format:check`
