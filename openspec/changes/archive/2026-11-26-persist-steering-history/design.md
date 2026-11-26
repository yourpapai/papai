<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design

## Context

See `proposal.md` — Why. The current path:

- `collectTurnMessages` (`src/llm-orchestrator-messages.ts`) flattens `result.steps[].response.messages`, so delivered steering text — which the SDK adds to a step's *input* — is absent from persistence, verifier history, and tool-failure detection.
- The pinned SDK (`ai` 7.0.179) exposes `StepResult.experimental_steeringMessages`: the delivered `UserModelMessage`s added to that step's input, including messages that arrived through an interrupt redo (`node_modules/ai/dist/index-CM_8u8gB.d.ts:1907`, populated at `node_modules/ai/dist/index.js:1910`).
- `runTurn` (`src/llm-orchestrator.ts`) holds the `RunControl` and calls `recordAssistantTurn` after `callLlm`, before `runRegistry.end`. The result therefore already contains every delivered steer, and the run still carries request-time state.
- `applyEditToHistory` (`src/history.ts`) returns whether it rewrote a stored user turn; `onIncomingEdit` (`src/message-edit/handle.ts`) currently discards that boolean before the W1 steer.
- History rows are plain `ModelMessage`s; user turns that support edit correction also carry `providerOptions.papai.messageIds`, which a steered message cannot supply.

## Goals / Non-Goals

**Goals:**

- Persist every delivered steering message once, at its step position, without touching the delivery rules.
- Keep W1 edits non-duplicating while never losing a correction the model actually saw.
- Leave the shared collector accurate for every reader (persistence, verifier, failure detection) and confine exclusions to the history path.
- No history-shape, DB, analytics, or trim-policy change.

**Non-Goals:**

- Author attribution or `providerOptions.papai` metadata on persisted steers.
- Retroactively editing a persisted steer, or backfilling pre-change runs.
- Persisting undelivered text (the replay path owns it).
- Changing trim thresholds, the `truncated` rule, or delivery/acknowledgement behavior.

## Decisions

### D1: Read delivered steers from per-step SDK results

Extend `TurnMessagesResult`/`StepLike` with `experimental_steeringMessages`, and flatten each step as `[...(steeringMessages ?? []), ...(response.messages ?? [])]`. The final-step fallback does the same.

Why: the SDK reports exactly what each step received, so placement is exact and only delivered text appears. Alternatives rejected: reconstructing from `pendingSteerOutcomes` (knows delivery but not which step received it, so order would be wrong); a custom `prepareStep` that injects messages (the disclosure step is the only `prepareStep`, and the SDK's steering already carries the text); writing at request time (would persist undelivered text).

### D2: Exclude only in the history path

`collectTurnMessages` includes steering messages for every caller. `recordAssistantTurn` accepts the run's excluded texts and drops matching messages before appending history.

Why: the verifier and `detectToolFailure`/`turnHasToolActivity` should read the same trace the model saw, including a W1 notice. Only persistence must deduplicate. Alternative rejected: filtering inside the collector, which would hide delivered correction text from verification.

### D3: W1 exclusion is driven by the baseline-correction result

`requestSteer` gains `{ persistInHistory?: boolean }` (default `true`); `false` records the text on the run as excluded. `onIncomingEdit` captures `applyEditToHistory`'s boolean and passes `persistInHistory: !corrected` to the W1 steer.

Why: when the original user turn was rewritten, that rewrite is the durable record and the synthetic `⟲ Your earlier message was edited…` notice would be a second copy. When the correction was a no-op — the edited message was only ever a steer and has no stored turn — the notice is the only record of the correction the model saw, so it must persist. Alternatives rejected: excluding every W1 notice (loses the steer-only correction); persisting every notice (duplicates stored edits); a special marker in the notice text (couples persistence to user-facing copy).

### D4: Filter by text with one-removal semantics

The run keeps excluded texts as an ordered array; filtering walks the collected messages and, on a match, removes one occurrence and drops the message. No `Set` collapse.

Why: two identical steers in one run are possible, and one may be excluded while the other is persisted. The SDK exposes no id or tag on steering messages, so text is the only correlation key. The W1 notice has a distinctive prefix, making accidental collision unlikely. Logs stay identifier-only; no steering text is logged.

### D5: Extend existing modules, no new module

Changes stay in `src/llm-orchestrator-messages.ts`, `src/llm-history.ts`, `src/llm-orchestrator.ts`, `src/run-control/{types,steering}.ts`, and `src/message-edit/handle.ts`. `RunControl` gains `excludedSteerTexts: string[]`.

Why: the collector already owns turn reconstruction, `recordAssistantTurn` already owns persistence, and `requestSteer` already owns the steering request. No new persisted state, so the scope model is unchanged: the excluded list is in-memory and thread-isolated by the run's `storageContextId`; history itself keeps its existing `storageContextId` scope. No config-context, group-shared, per-user, platform-instance, or task-instance state is added.

### D6: Test-first through the existing hook pipeline

New/changed test files (`tests/llm-orchestrator-messages.test.ts`, `tests/llm-history*.test.ts`, steering/run-control suites, message-edit W1 tests) go through the Write/Edit TDD hook like any product change. Red tests come first and must fail for the intended reason.

## Risks / Trade-offs

- **Trim cadence shifts** — persisted steers add `role: 'user'` messages, and periodic trimming counts them (`src/conversation.ts:99`) → accepted: the text is real user input; thresholds and `SMART_TRIM_INTERVAL` stay unchanged, and tests only assert the count semantics.
- **Verifier sees more context** — a delivered correction now reaches the verifier's history → intended accuracy; existing verification tests establish the baseline.
- **SDK experimental field drift** — the option is experimental → typed access plus collector tests fail loudly on a shape change.
- **Group attribution is lost** — a steer from another member persists without an author → non-goal; stored user messages keep today's anonymous shape.
- **Steer-only W1 ordering** — if the original steer was undelivered, its replay turn is persisted after the notice → accepted edge; the notice is still true and text is never dropped.
- **Multiset matching cost** — linear in excluded texts and steps → both are tiny per run; no measurable cost.

## Migration Plan

Code-only; no data migration and no backfill. Deploy with the normal build; rollback is a revert of the implementation commit, which restores the prior collector and persistence unchanged. Existing history rows are untouched.
