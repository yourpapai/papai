<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal

## Why

papai hand-rolls mid-run steering: `RunControl.steerQueue` is drained by a custom `prepareStep`, and text left when the run ends is replayed as a fresh turn. That queue has no delivery outcome, can silently lose a message when the loop ends early, and duplicates an AI SDK feature that already owns the step-boundary contract. The pinned SDK (`ai` 7.0.179) ships native steering, so the hand-rolled path can be replaced before more behavior is built on it.

## What Changes

- Give each active run a native `experimental_createSteering()` handle and pass it to the single `generateText` call as `experimental_steering`.
- Route a mid-run non-command message to `steering.steer(text)`; keep the immediate ack and the existing `turn_steered` analytics fact unchanged.
- Remove `createSteeringPrepareStep` and the steering half of `composePrepareSteps`; disclosure keeps its `activeTools` prepare step.
- Consume `steer()` outcomes: delivered messages need no replay; `finished`, `stop-condition`, `aborted`, `error`, `waiting-for-tool-results`, and `removed-by-prepare-step` feed the existing leftover-replay path as a fresh turn.
- Create a steering object per `generateText` call (the SDK forbids reuse); the run holds the current handle so a future retry cannot reuse a spent one.
- No public config, command, or data-shape change.

## Capabilities

### New Capabilities

- `mid-run-steering`: the durable contract for injecting a user message into a live agent turn -- routing, step-boundary delivery, ack, delivery outcomes, and the not-delivered fallback. Without it, the hand-rolled queue continues to lack a delivery contract and can drop text on early termination.

### Modified Capabilities

None. No capability spec under `openspec/specs/` covers steering; the existing module `src/run-control/` implements the behavior and this change replaces its transport, not its scope rules. `docs/architecture/overview.md` and `docs/architecture/behaviors.md` (`behavior:mid-run-control`) are updated.

## Non-goals

- `steer({ interrupt: true })`: needs a bounded interrupt budget, a billing policy, and a user-facing trigger; separate change.
- `queue()` after-task delivery: needs a user-visible "wait until the task finishes" contract; separate change.
- Changing routing (which messages steer vs enqueue), ack text, `/stop` semantics, analytics facts, platform instances, task instances, config-context/per-user/group-shared state, guest mode, or `tool_prefs`.
- No DB migration, new dependency, or settings-UI surface.

## Impact

- Code: `src/run-control/{types,registry,steering-prepare-step}.ts`, `src/llm-orchestrator-invoke.ts`, `src/llm-orchestrator-leftover-replay.ts`, `src/bot-message-handler.ts`, and their tests.
- Scope: steering state stays **thread-isolated** by `storageContextId`; config-context ids, per-user identity, group-shared config, and task instances are untouched. All platform instances (Telegram, Mattermost, Discord, Kontur Talk) share the same run registry, so behavior is uniform across them.
- Docs: `docs/architecture/overview.md`, `docs/architecture/behaviors.md`.
