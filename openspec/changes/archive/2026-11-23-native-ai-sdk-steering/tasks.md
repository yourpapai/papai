<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks

## 1. Red: native steering seam tests

- [x] 1.1 Create `tests/run-control/steering.test.ts` with a fake `SteeringHandle` covering `delivered`, `finished`, `stop-condition`, `aborted`, `error`, `waiting-for-tool-results`, `removed-by-prepare-step`, and a rejected `steer()`; assert `requestSteer` records only undelivered text and `settleSteering` awaits every pending outcome before leftovers are read; verify `bun test tests/run-control/steering.test.ts` fails because the module does not exist.
- [x] 1.2 Update `tests/run-control/registry.test.ts` to start a run with a fake handle, leave one delivered and one undelivered steer pending, and expect async `end()` to settle both, clear the handle, and return only the undelivered text; verify `bun test tests/run-control/registry.test.ts` fails.
- [x] 1.3 Update `tests/run-control/invoke-wiring.test.ts` so an active run asserts `experimental_steering` is the run's handle and no steering `prepareStep` is composed; keep the no-active-run assertion free of `experimental_steering`; verify `bun test tests/run-control/invoke-wiring.test.ts` fails.

## 2. Green: run-control and orchestrator wiring

- [x] 2.1 Add a minimal `SteeringHandle` type and `createSteering` to `LlmOrchestratorDeps`/`defaultDeps`; extend `RunControl` with `steering`, `pendingSteerOutcomes`, and `steerLeftovers`, and accept the handle in `RunRegistry.begin`; verify `bun run typecheck` passes while the new tests are still red.
- [x] 2.2 Replace `src/run-control/steering-prepare-step.ts` with `src/run-control/steering.ts` implementing `requestSteer` and `settleSteering`, and make `RunRegistry.end` async; verify `bun test tests/run-control/steering.test.ts tests/run-control/registry.test.ts` passes.
- [x] 2.3 Pass `experimental_steering` from `callGenerateText`, use the disclosure step directly as `prepareStep`, delete `createSteeringPrepareStep`/`composePrepareSteps` and their test, and verify `bun test tests/run-control/invoke-wiring.test.ts tests/llm-orchestrator*` and `bun run typecheck` pass.
- [x] 2.4 Create the handle in `runTurn`, route `steerActiveRun` through `requestSteer`, keep the immediate ack and `turn_steered` fact, and verify `bun test tests/bot-steering.test.ts tests/llm-orchestrator-leftover-replay.test.ts` passes.

## 3. Docs and final gate

- [x] 3.1 Update `docs/architecture/overview.md` and `docs/architecture/behaviors.md` (`behavior:mid-run-control`) for native steering and outcome-based leftovers; verify `rg -n "steerQueue|createSteeringPrepareStep|composePrepareSteps" src docs` returns no stale references and `bun run format:check` passes.
- [x] 3.2 Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run test:stories`, and `bun run test:mutate:changed --base=HEAD~1`; verify all exit 0 and the architecture pages from 3.1 are in the same commit.

## Workflow follow-up

- Archive this change after review approval and a green full gate.
- Open a separate proposal for `interrupt: true` and `queue()` once their user-facing triggers and billing policy are defined.
