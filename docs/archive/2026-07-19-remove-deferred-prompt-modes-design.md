<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remove deferred-prompt execution modes

**Date:** 2026-07-19
**Status:** Approved (design)

## Problem

Every deferred prompt (scheduled reminder or task alert) stores an `executionMetadata`
JSON blob whose `mode` field is one of `lightweight` / `context` / `full`. At fire time
`dispatchExecution` (`src/deferred-prompts/proactive-llm.ts`) branches three ways:

| Mode          | Model       | Live history + memory | Tools                       |
| ------------- | ----------- | --------------------- | --------------------------- |
| `lightweight` | small model | no                    | `get_current_time` only     |
| `context`     | main model  | yes                   | `get_current_time` only     |
| `full`        | main model  | yes                   | entire task-tracker toolset |

The LLM classifies each prompt into a mode at creation time (`executionInputSchema` in
`types.ts`). The modes exist purely to keep fire-time context small: a trivial "remind me
to drink water" avoids serializing history and the full tool schemas.

Since then the codebase gained **progressive disclosure** (`search_tools` / `load_tool`):
the model loads only the tool schemas it actually needs, per step. That makes a single
"always full" run lean without the mode taxonomy — provided disclosure is actually wired
into the firing path.

### The critical gap

Progressive disclosure is **not** active in the proactive/deferred execution path today.
It only runs in the normal chat orchestrator:

- `maybeApplyDisclosure` is called exactly once, in `src/llm-orchestrator-tools.ts`.
- The per-step gate `createDisclosurePrepareStep` is attached only in
  `src/llm-orchestrator-invoke.ts`.
- The proactive path calls `generateText` **directly** (`proactive-llm.ts`) with its own
  `buildFullToolSet` (`proactive-llm-full.ts`) that applies neither disclosure nor
  compaction. `docs/architecture/tools.md` confirms: _"proactive runs never compact"_.

So `full` mode currently serializes the entire toolset, with full schemas, on every fire —
exactly the cost the three modes were invented to avoid. Removing the modes and naively
always calling `invokeFull` would make trivial reminders _heavier_, not lighter.

## Goal

Collapse the three modes into a single unified proactive run that:

1. always loads live history + memory and exposes the full task-tracker toolset, and
2. keeps fire-time context lean by **wiring progressive disclosure into the proactive
   path**.

`delivery_brief` and `context_snapshot` are orthogonal to modes and are kept. Only `mode`
is removed. Every deferred prompt fires on the **main model** (no small-model branch).
Result compaction stays out of scope (disclosure only).

## Design

### Removal / simplification

- **`src/deferred-prompts/types.ts`**
  - Delete `EXECUTION_MODES` and `ExecutionMode`.
  - Drop `mode` from `executionMetadataSchema`, `executionInputSchema`, and
    `DEFAULT_EXECUTION_METADATA`.
  - Rewrite the `executionInputSchema` description so it no longer instructs the model to
    classify a mode; it now only documents `delivery_brief` and `context_snapshot`.
- **`src/deferred-prompts/proactive-llm.ts`**
  - Delete `invokeLightweight` and `invokeWithContext`.
  - Collapse `dispatchExecution`'s `switch` into a single call into the (renamed) unified
    run built on today's `invokeFull`.
  - Drop `smallModel` from `LlmConfig` and remove the `modelIdForLightweight` call.
- **`src/deferred-prompts/proactive-llm-helpers.ts`**
  - Remove `modelIdForLightweight`, `buildContextMessages`, `buildMinimalSystemPrompt`,
    `persistLightweightResponse`, and `persistContextResponse` (all lightweight/context
    only).
  - Drop the `mode` argument from `finalizeAndLog`'s log metadata.
- **`src/deferred-prompts/poller-scheduled.ts`**
  - `mergeExecutionMetadata` loses `MODE_PRIORITY` / `MODE_BY_PRIORITY`; it just
    concatenates `delivery_brief`s and `context_snapshot`s across the batch.
- **`src/deferred-prompts/poller.ts`** — remove `mode: metadata.mode` from the log call.
- **`src/deferred-prompts/tool-handlers.ts`** — `ExecutionInput` drops `mode`.
- **`src/deferred-prompts/schedule-update-helpers.ts`** — `parseExecution`'s input type
  drops `mode`.
- **`src/tools/create-deferred-prompt.ts`** — remove "Always classify the execution mode…"
  from the tool description; `executionInputSchema` no longer carries `mode`.
- **`src/tools/update-deferred-prompt.ts`** — same `executionInputSchema` change flows
  through.

### Additive: disclosure wiring (the linchpin)

In the proactive full path (`src/deferred-prompts/proactive-llm-full.ts` +
`runFullGeneration` in `proactive-llm.ts`):

- `buildFullToolSet` applies `maybeApplyDisclosure(tools, storageContextId, retriever)`
  after `applyToolPreferences`, and returns the `DisclosureSession` alongside the toolset.
  The retriever comes from `getToolRetriever(configContextId, { storageContextId,
contextType, chatUserId })` (already BYOK-aware, with lexical fallback).
- `buildFullSystemPrompt` passes `progressiveDisclosure: true` so the system prompt gains
  the TOOL DISCOVERY preamble. Because compaction is out of scope, `expand_result` is not
  registered — the disclosure code already advertises `expand_result` "only when
  registered", so this is safe.
- `runFullGeneration`'s `generateText` call attaches
  `createDisclosurePrepareStep(session, storageContextId, turnId)` so each step's
  `activeTools` = core ∪ meta ∪ explicitly-loaded names. The proactive path has no
  run-registry / steering machinery, so the disclosure prepareStep is attached
  standalone (in normal chat it is composed with the steering prepareStep).
- **`turnId` synthesis:** the proactive path has no turn id. Mint a stable synthetic id
  (e.g. derived from the prompt id + fire timestamp) so `disclosure:*` debug events key
  cleanly and do not collide.

### Data & backward compatibility

- **No DB migration.** The `execution_metadata` column is retained. Zod strips the now
  unknown `mode` key from existing rows automatically, so a stored
  `{ "mode": "context", "delivery_brief": "…", "context_snapshot": null }` parses cleanly
  into the mode-less shape and fires as the unified full run. `parseExecutionMetadata`'s
  fallback path is unchanged.

## Risks & caveats

1. **Cost / latency up for trivial reminders.** "Drink water" now runs the main model with
   history loaded (previously small model, no history). Disclosure keeps _tool_ tokens
   small, but history + main model is the floor. Accepted per the model-tier decision.
2. **Disclosure has never run in a `generateText`-direct (non-`invokeModel`) context.**
   Confirm `createDisclosurePrepareStep` behaves correctly attached standalone, without the
   run-registry / steering composition that surrounds it in normal chat. To resolve during
   implementation.
3. **`turnId` synthesis.** Disclosure debug events key on `turnId`; the proactive path
   lacks one. Mint a stable id so events don't collide across concurrent fires.
4. **Test surface.** Nine test files reference modes (`proactive-llm*`, `poller*`,
   `tool-handlers`, `tools`, `tools-builder`, `long-term-memory/maintenance`). Mode-branch
   tests are deleted; a new test asserts the disclosure meta-tools appear in the proactive
   toolset and that the prepareStep gates tools per step.
5. **Docs drift.** `docs/architecture/tools.md` and `src/tools/CLAUDE.md` state disclosure
   runs only via the normal `buildFullToolSet`; both must be updated to note the proactive
   path now discloses too (while still not compacting).

## Testing strategy

- **Unit**
  - Unified dispatch always builds the full toolset and a disclosure session; no
    mode branch remains.
  - `mergeExecutionMetadata` merges `delivery_brief`s and `context_snapshot`s with no
    priority logic.
  - `parseExecutionMetadata` drops a legacy `mode` key from an old row without error.
- **Integration**
  - A fired deferred prompt exposes `search_tools` / `load_tool`, and the prepareStep gates
    `activeTools` to core ∪ meta until a tool is loaded.
  - A tool-needing reminder can `load_tool` and complete its task.

## Out of scope

- Result compaction / `expand_result` in the proactive path (disclosure only).
- Any change to the small-model bindings used elsewhere (memory extraction,
  group-history lookup) — only the deferred firing path stops using the small model.
- DB schema changes.
