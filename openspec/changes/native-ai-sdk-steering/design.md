<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design

## Context

See `proposal.md` for motivation and `specs/mid-run-steering/spec.md` for the behavior contract.

The current path is:

- `runTurn` (`src/llm-orchestrator.ts`) creates a `RunControl` keyed by `storageContextId` and later calls one `invokeModel`.
- `invokeModel` builds `generateText` options; when a run exists it composes a steering `prepareStep` with disclosure's `activeTools` step (`src/llm-orchestrator-invoke.ts`).
- `steerActiveRun` (`src/bot-message-handler.ts`) pushes text into `run.steerQueue`.
- `createSteeringPrepareStep` drains that queue into user messages at the next step; `runRegistry.end` returns whatever was never drained and `replayLeftoverSteerAsFreshTurn` replays it as a fresh turn.

Constraints from the pinned SDK (`ai` 7.0.179):

- Steering is experimental: `experimental_createSteering()` returns one `Steering` handle per `generateText` call; a handle cannot be reused.
- The handle is passed as `experimental_steering`; `prepareStep` and `onStepStart` already receive the steering messages.
- `steer()` resolves with a delivery outcome and never rejects; not-delivered reasons include `finished`, `stop-condition`, `aborted`, `error`, `waiting-for-tool-results`, and `removed-by-prepare-step`.
- A `prepareStep` that rebuilds `messages` can drop steering messages. Papai's disclosure step returns only `activeTools`, so it is safe.

## Goals / Non-Goals

**Goals:**

- Replace the hand-rolled queue/drain with one native steering handle per `generateText` call.
- Keep routing, ack, analytics, thread isolation, and leftover replay behavior unchanged.
- Make delivery outcomes explicit so early termination cannot silently drop text.

**Non-Goals:**

- `interrupt: true` and `queue()` (deferred by the proposal).
- Changing `/stop`, force-abort, step budgets, no-progress guard, or turn-limit behavior.
- Persisting steering state or changing `tool_prefs`/guest/capability gating.

## Decisions

### D1: The run owns one steering handle, created through the existing deps seam

`RunControl` gains `steering: Steering`, plus `steeringStarted`, `pendingSteerOutcomes` and `steerLeftovers`. `runTurn` creates the handle with a new `LlmOrchestratorDeps.createSteering` seam (default `experimental_createSteering`) and passes it to `runRegistry.begin`.

The seam returns a minimal `SteeringHandle` (`steer` plus its outcome type) so tests can fake outcomes without the full SDK `Steering` shape. It keeps the experimental SDK call in one place. The handle is created immediately before `callLlm`, which makes "one handle per `generateText` call" explicit. Papai has one call per run today; a future retry path must create a fresh handle rather than reuse the spent one.

Alternative considered: create the handle inside `RunControl`/`RunRegistry`. Rejected because it hard-codes the experimental SDK function into the registry and makes outcome tests need a real SDK loop.

### D2: Remove the steering `prepareStep`; keep disclosure's

`callGenerateText` passes `experimental_steering: run.steering` and uses the disclosure step directly (`prepareStep = disclosureStep`). `createSteeringPrepareStep` and `composePrepareSteps` are deleted with their test. Disclosure still owns `activeTools`; it never rebuilds `messages`.

Alternative considered: keep the steering prepare step as a fallback. Rejected because it would duplicate delivery, drain a queue the SDK owns, and could remove messages from the SDK's view.

### D3: Outcomes map to the existing leftover-replay path

`src/run-control/steering.ts` replaces `steering-prepare-step.ts` and owns two functions:

- `requestSteer(run, text)`: calls `run.steering.steer(text)` and records a promise that maps the outcome to the leftover it produces — `null` for `delivered`, `{ text }` for every other reason, and `{ text }` for a rejection despite the SDK's never-rejects contract.
- `settleSteering(run)`: awaits the recorded promises (which cannot reject) so outcomes that resolve after `generateText` returns are still classified before `runRegistry.end` reads the leftovers, then appends the non-null results **in arrival order** — the SDK may settle them out of order.
- Handoff guard: the SDK resolves `steer()` promises only from a started run, and a steer can arrive between `runRegistry.begin` and `callGenerateText` (the window covers remote provider setup that can throw). `callGenerateText` sets `steeringStarted` immediately before calling the SDK; when it is still false at run end, every pending text is a leftover and nothing is awaited — otherwise a turn that failed before `generateText` would hang on a promise nothing can resolve.

`runRegistry.end` becomes async and calls `settleSteering` before returning `steerLeftovers`. `runTurn` already reads its result in `finally`; it awaits it. The replay function is unchanged: undelivered text becomes one fresh turn with no originating message ids.

Alternative considered: keep the queue and only pass the handle. Rejected because the queue would be a second source of truth and the spec requires outcome-based preservation.

### D4: Ack and analytics stay where they are

`steerActiveRun` calls `requestSteer` (synchronous enqueue) and then sends the existing localized ack and `turn_steered` fact. It does not await delivery, so the ack remains immediate. The steer text is never logged or emitted, matching the current contract.

### D5: No new tool surface, persistence, or dependency

Steering is not a tool, so `tool_prefs`, capability gating, guest mode, and the confirmation flow are untouched. State stays in memory keyed by `storageContextId`; no config-context, user, group, platform-instance, or task-instance key changes. No DB migration and no new package: the AI SDK already provides the feature.

## Risks / Trade-offs

- **Experimental API drift** -> The call is isolated in `LlmOrchestratorDeps.createSteering` and `src/run-control/steering.ts`; typecheck and the native-steering tests fail loudly on a shape change.
- **Outcome promise lag or violation of the never-rejects contract** -> `requestSteer` maps a rejection to a leftover, and `settleSteering` only awaits outcomes of a handle that was actually handed to the SDK (the `steeringStarted` handoff guard), so no timeout is needed. A future `generateText` call that starts the handle and never returns would still hold `end`; the SDK ends the steering run on every exit path, so this is not possible today.
- **Accidental message dropping by a future `prepareStep`** -> The disclosure step only returns `activeTools`; the outcome test includes a not-delivered case so `removed-by-prepare-step` still becomes a leftover.
- **Handle reuse after a future retry path** -> D1 makes the handle per `callLlm`; a retry must create a new handle. The registry test pins that `end` settles and clears the handle.
- **Async `runRegistry.end`** -> The only production call site is `runTurn`'s `finally`; tests that call `end` directly must await it. The seam is small and local.

## Migration Plan

Code-only, no data migration. Deploy with the normal application build. Rollback is `git revert` of the implementation commit; the removed queue/prepareStep code returns with it. No feature flag is needed because the observable behavior is preserved and the handle is created only for interactive runs.

## Open Questions

None. Interrupt and after-task queue delivery are explicitly deferred by the proposal.
