<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-up proposal shortlist

These are the feature candidates deferred by `design.md`. Each needs its own OpenSpec change; none belongs in this dependency refresh.

## 1. Native AI SDK steering — delivered by `native-ai-sdk-steering`

- **Source version:** `ai` 7.0.154–7.0.177 (`experimental_createSteering`, `steer`, `queue`, `interrupt`), present in the pinned 7.0.179.
- **Status:** the `steer()` half shipped in `openspec/changes/native-ai-sdk-steering/`. One `experimental_createSteering()` handle per run (`createSdkSteering`, `src/run-control/steering.ts:11`) is passed to the single `generateText` call as `experimental_steering` (`src/llm-orchestrator-invoke.ts:113`), handed off immediately before the SDK call (`src/llm-orchestrator-invoke.ts:124`). `requestSteer` (`src/run-control/steering.ts:18`) routes both steer sites (`src/bot-message-handler.ts:210`, `src/message-edit/handle.ts:183`) and `settleSteering` (`src/run-control/steering.ts:32`) keeps undelivered text for the fresh-turn replay. `createSteeringPrepareStep`/`composePrepareSteps`, `run.steerQueue`, and their test are gone; the disclosure step is the only `prepareStep` (`src/llm-orchestrator-invoke.ts:93`).
- **Deferred:** `interrupt: true` and `queue()` were ruled out of that change as non-goals and are now candidate 2 below.

## 2. Steering interrupt and after-task queue

- **Source version:** `ai` 7.0.179 (`steer({ interrupt: true })`, `queue()`); both documented on the SDK's `Steering` interface.
- **Papai fit — `interrupt: true`:** cancels a model call that has not produced output yet and redoes the same step with the message, so a user correction lands *before* the wasted answer instead of at the next boundary. Papai already steers mid-run (`src/run-control/steering.ts:18`) and owns a stop ladder for the deliberate case (`/stop` → graceful → force-abort, `src/commands/stop.ts:16`); an interrupt sits between the two. **Blockers:** a cancelled call can still be billed and is excluded from SDK usage; the step is not counted again, so `AGENT_MAX_STEPS` (`src/llm-orchestrator-invoke.ts:33`) and the no-progress guard no longer describe the turn's real cost — needs a bounded interrupt budget plus a billing/limit policy. **Trigger:** plain steer text is "fold this in"; interrupt needs its own user-facing intent (and ack, `src/i18n/locales/en.ts:118`) so a correction can opt into cancelling.
- **Papai fit — `queue()`:** delivers one message per finished task, in order, after a final answer with no tool calls — the "wait until this task finishes, then do X" contract. **Blockers:** needs a user-visible promise of that behavior (and ack), plus a leftover-replay rule for queued messages the run never reached; today the replay path (`src/llm-orchestrator-leftover-replay.ts:23`) only knows steer leftovers.
- **Required spec delta:** extend `mid-run-steering` with delivery outcomes for the interrupted and after-task paths, interrupt budget/billing bounds, queue ordering, and the not-delivered fallback for each.
- **Starting points:** `src/run-control/steering.ts:18` (`requestSteer`), `src/bot-message-handler.ts:202` (`steerActiveRun`), `src/commands/stop.ts:16`, `src/llm-orchestrator-invoke.ts:33` (`AGENT_MAX_STEPS`), `src/llm-orchestrator-leftover-replay.ts:23`.

## 3. SDK tool approvals

- **Source version:** `ai` 7.0.x tool approvals (approval replay present in 7.0.179).
- **Papai fit:** could replace the `_permission_reason` ask wrapper at `src/tools/permission-gate.ts:40` and the decision call at `src/tools/permission-gate.ts:125`. `tool_prefs` (`allow`/`ask`/`deny`) stays the source of truth; approvals would replay through the SDK instead of the current structured denial.
- **Required spec delta:** tool-permission requirements for the approval request/response shape, replay across steps, and the interaction with `tool_prefs` resolution and confirmations. The current denial result for `ask` without a user decision must remain.
- **Starting points:** `src/tools/permission-gate.ts:40` (`PERMISSION_REASON_FIELD`), `src/tools/permission-gate.ts:125` (`askPermission`).

## 4. Native tool search

- **Source version:** `ai` 7.0.104/7.0.127 (native tool search).
- **Papai fit:** could replace the heuristic/embedding disclosure at `src/tools/disclosure/search-tools.ts:38` and `src/tools/disclosure/load-tool.ts:15`. Papai's custom embedding retriever has a custom corpus and a fail-safe latch at `src/tools/disclosure/core.ts:29`.
- **Required spec delta:** tool-disclosure requirements for result-ranking parity with the embedding retriever, the open-all fallback after zero `load_tool` activity, and the disclosure `activeTools` intersection. Needs a feature flag and fallback path before it becomes the default.
- **Starting points:** `src/tools/disclosure/search-tools.ts:38`, `src/tools/disclosure/load-tool.ts:15`, `src/tools/disclosure/core.ts:29`.

Ordering: native steering shipped; its two remaining pieces (candidate 2) come next because they extend the handle papai now owns, then tool approvals (touches `tool_prefs`), then native tool search (needs parity proof with the embedding retriever).
