<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks

## 1. Red: collector, persistence, and W1 tests

- [x] 1.1 Extend `tests/llm-orchestrator-messages.test.ts` with per-step `experimental_steeringMessages`: each step's steers precede its response messages, the final-step fallback includes them, and a result without the field keeps the current output; verify `bun test tests/llm-orchestrator-messages.test.ts` fails because the collector ignores the field.
- [x] 1.2 Extend `tests/llm-history.test.ts` so `recordAssistantTurn` persists delivered steering messages in place and drops excluded texts with one-removal semantics (two identical steers, one excluded, one kept); verify `bun test tests/llm-history.test.ts` fails because the exclusion parameter does not exist.
- [x] 1.3 Extend `tests/run-control/steering.test.ts` and `tests/run-control/registry.test.ts`: `requestSteer` defaults to persisting, `{ persistInHistory: false }` records the text once on the run, a new run starts with an empty exclusion list, and a failed steer still yields a leftover without an exclusion entry; verify `bun test tests/run-control/steering.test.ts tests/run-control/registry.test.ts` fails.
- [x] 1.4 Extend `tests/message-edit/handle.test.ts`: a W1 edit whose message exists in history steers with `persistInHistory: false`; a W1 edit whose message has no stored turn steers with `persistInHistory: true`; verify `bun test tests/message-edit/handle.test.ts` fails.
- [x] 1.5 Add an orchestrator-level case (`tests/llm-orchestrator.test.ts` or `tests/bot-steering.test.ts`): a delivered steer reaches persisted history once, an undelivered steer is absent from the run's persisted messages and appears only through the replay turn; verify the focused suite fails.

## 2. Green: collector, run state, persistence, and W1 signal

- [x] 2.1 Extend `StepLike`/`TurnMessagesResult` with `experimental_steeringMessages` and flatten steers before each step's response messages, including the final-step fallback; verify `bun test tests/llm-orchestrator-messages.test.ts` passes.
- [x] 2.2 Add `excludedSteerTexts: string[]` to `RunControl`, initialize it empty in `RunRegistry.begin`, and keep it out of `end()` leftovers; verify `bun test tests/run-control/registry.test.ts` passes and `bun run typecheck` succeeds.
- [x] 2.3 Add `{ persistInHistory?: boolean }` to `requestSteer` (default true) and push excluded text when false; log counts only, never text; verify `bun test tests/run-control/steering.test.ts tests/bot-steering.test.ts` passes.
- [x] 2.4 Filter excluded texts in `recordAssistantTurn` before `appendAssistantHistory`, and pass `run.excludedSteerTexts` from `runTurn`; verify `bun test tests/llm-history.test.ts tests/llm-orchestrator.test.ts` passes.
- [x] 2.5 Capture `applyEditToHistory`'s boolean in `onIncomingEdit` and pass `persistInHistory: !corrected` to the W1 steer; verify `bun test tests/message-edit/handle.test.ts` passes.
- [x] 2.6 Confirm verifier history and tool-failure detection still receive steering messages by extending the existing send/verifier tests; verify `bun test tests/llm-orchestrator-send.test.ts tests/llm-orchestrator-support.test.ts` passes.

## 3. Docs and full gate

- [x] 3.1 Document persisted delivered steering, the W1 non-duplication rule, and the trim-cadence note in `docs/architecture/behaviors.md` (`behavior:mid-run-control`) and `docs/architecture/overview.md`; verify `rg -n "steering" docs/architecture/behaviors.md docs/architecture/overview.md` matches the shipped behavior and `bun run format:check` passes.
- [ ] 3.2 Run the full gate: `bun test`, `bun run typecheck`, `bun run lint`, `bun run test:stories`, and `bun run test:mutate:changed --base=HEAD~1`; verify every command exits 0 and the docs from 3.1 are in the same commit as the behavior.

## Workflow follow-up

- Archive after review approval and a green full gate.
- Do not backfill history for runs that completed before this change; the requirement applies to turns persisted afterwards.
