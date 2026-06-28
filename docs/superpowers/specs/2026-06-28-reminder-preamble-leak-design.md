<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Fix: reminder delivery leaks the LLM's "let me check the time" preamble

Date: 2026-06-28

## Problem

When a reminder fires, the bot sometimes delivers the English phrase
_"Let me first check the current date and time to give you an accurate reminder."_
instead of the actual reminder. The phrase is not a string in the codebase — it is the
model's "thinking out loud" preamble emitted _before_ it calls the `get_current_time`
tool.

## Root cause

Reminder delivery runs through `dispatchExecution` (`src/deferred-prompts/proactive-llm.ts`),
which has three modes. Two of them — `invokeLightweight` and `invokeWithContext` — called
`generateText` with the `get_current_time` tool but **without `stopWhen`**. The AI SDK
(`ai` v6) defaults `stopWhen` to `stepCountIs(1)` (verified in
`node_modules/ai/dist/index.js`), i.e. a single step. And `result.text` is strictly the
**final step's** text.

So for a date-relative reminder:

1. Step 1: model emits the preamble text + a `get_current_time` call (`finishReason: "tool-calls"`).
2. The SDK executes the tool, then stops (step cap = 1). There is no step 2 where the
   model would actually write the reminder using the time.
3. `result.text` = step-1 text = the preamble, which is delivered to the user.

`runFullGeneration` already passed `stopWhen: stepCountIs(25)` and was unaffected. The
creation path (main orchestrator) was unaffected — it uses `stepCountIs(25)`.

## Changes

### 1. Core fix

Add `stopWhen: deps.stepCountIs(25)` to `invokeLightweight` and `invokeWithContext`,
matching `runFullGeneration`. The model can now consume the `get_current_time` result and
produce the real reminder.

### 2. Defensive guard

`resultTextOrDone(text)` is replaced by a pure helper
`finalizeDeliveryText({ text, finishReason })` in `proactive-llm-helpers.ts`:
when `finishReason === 'tool-calls'` (turn truncated mid-tool-step) or the text is
empty/undefined, it returns the `'Done.'` fallback instead of surfacing a preamble. This
is belt-and-suspenders: even if a future model still ends a turn on a tool call within the
step budget, the user never sees a preamble.

### 3. Logging

A DRY `finalizeAndLog(result, userId, mode)` in `proactive-llm-helpers.ts` wraps the pure helper
and logs `finishReason` + `stepCount` for every delivery (debug normally; **warn** when the
turn ended on a pending tool call). `sendLlmResponse` (`llm-orchestrator-support.ts`) now
also logs `finishReason` on the success path and **warns** when a main-path turn ends on a
pending tool call (log-only there — the main path has a legitimate 25-step cap, so text is
not dropped). All logged fields are non-sensitive control metadata.

## Scope boundaries (YAGNI)

- No change to the creation path (already multi-step).
- No change to tool-less `generateText` callers (`memory`, `distill`, `extractor`,
  `lookup-group-history`) — single-step is correct there.
- Main-path `finishReason === 'tool-calls'` handling is log-only; text is not dropped.

## Tests

- `proactive-llm-helpers.test.ts`: `finalizeDeliveryText` returns `'Done.'` for
  `tool-calls` finish and for empty/undefined text; returns text on normal finish.
- `proactive-llm.test.ts`: lightweight & context modes pass a `stopWhen`; lightweight mode
  does not deliver the preamble when the turn ends on a pending tool call.
