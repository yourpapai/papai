<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal

## Why

Delivered steering text lives only inside the run: `collectTurnMessages` flattens `steps[].response.messages` and never reads `steps[].experimental_steeringMessages`, so a mid-run correction vanishes from stored history when the turn ends. The next turn, a resumed turn after the step cap, trimming, and memory extraction all see the assistant's answer without the user text that changed it.

## What Changes

- Persist every steering message the SDK reports as delivered, per step, in the same position the model saw it: before that step's assistant/tool messages.
- Keep W1 edits non-duplicating: when `applyEditToHistory` rewrote the original stored user turn, the synthetic `⟲ Your earlier message was edited…` steer is excluded from persistence; when the edited message was never in history (a steer-only message), the note is persisted so the correction is not lost.
- Keep the undelivered contract unchanged: the run writes nothing for a leftover, and the existing replay persists it as a fresh user turn.
- Feed the per-step steering messages into the shared collector so the verifier and tool-failure detection read the same trace the model saw; only the history path applies exclusions.
- No DB or history-shape change: persisted steering messages are ordinary text `ModelMessage`s.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mid-run-steering`: adds the persisted-history requirement for delivered steering text and the W1 non-duplication rule. Base spec: `openspec/specs/mid-run-steering/spec.md`; implementing modules: `src/llm-orchestrator-messages.ts`, `src/llm-history.ts`, `src/run-control/`, `src/message-edit/handle.ts`.

## Non-goals

- Author attribution for group steers; stored user messages keep today's shape.
- Rewriting persisted steer rows through `providerOptions.papai.messageIds`, so a later edit of a steer-only message is not applied retroactively.
- Persisting undelivered steering text; replay owns it.
- Changing delivery timing, the interrupt budget, acknowledgements, analytics facts, trim thresholds, or thread isolation.
- Backfilling history for runs that completed before this change.

## Impact

- Code: `src/llm-orchestrator-messages.ts`, `src/llm-history.ts`, `src/llm-orchestrator.ts`, `src/run-control/{types,steering}.ts`, `src/message-edit/handle.ts`, plus collector/history/steering tests.
- Docs: `docs/architecture/behaviors.md` (`behavior:mid-run-control`) and `docs/architecture/overview.md`.
- Platforms: Telegram, Mattermost, Discord, and Kontur Talk share the run registry and history writer, so behavior is uniform.
- Scope: persistence is keyed by the existing `storageContextId` (thread-isolated live state), the same scope as conversation history. No config-context, group-shared, per-user, task-instance, or platform-instance state changes.
- Guests: steering keeps its existing authorization; a guest's delivered text persists like any member's.
- No migration, dependency, environment variable, config key, or settings-UI change.
