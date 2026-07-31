<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0302: Remove Deferred-Prompt Execution Modes — Unify the Proactive Firing Path With Progressive Disclosure

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

Every deferred prompt (a scheduled reminder or a task alert) stores an `executionMetadata` JSON blob whose `mode` field used to be one of `lightweight` / `context` / `full`. At fire time `dispatchExecution` branched three ways:

| Mode          | Model       | Live history + memory | Tools                       |
| ------------- | ----------- | --------------------- | --------------------------- |
| `lightweight` | small model | no                    | `get_current_time` only     |
| `context`     | main model  | yes                   | `get_current_time` only     |
| `full`        | main model  | yes                   | entire task-tracker toolset |

The modes existed purely to keep fire-time context small: a trivial "remind me to drink water" avoided serializing conversation history and the full tool schemas. The LLM classified each prompt into a mode at creation time via `executionInputSchema` in `src/deferred-prompts/types.ts`, and `mergeExecutionMetadata` in `poller-scheduled.ts` resolved a batch's modes by priority.

Two facts made the taxonomy obsolete:

1. **Progressive disclosure arrived** (`search_tools` / `load_tool`, per-step tool-schema gating) — the model loads only the tool schemas it actually needs, so a single "always full" run can stay lean without the mode taxonomy.
2. **But disclosure was never wired into the proactive path.** `maybeApplyDisclosure` ran only in the normal chat orchestrator; the proactive path called `generateText` directly with its own `buildFullToolSet` that applied neither disclosure nor compaction. So `full` mode serialized the entire toolset with full schemas on every fire — exactly the cost the three modes were invented to avoid. Naively removing the modes and always calling the old `invokeFull` would have made trivial reminders _heavier_, not lighter.

The design (`docs/superpowers/specs/2026-07-19-remove-deferred-prompt-modes-design.md`) and plan (`docs/superpowers/plans/2026-07-19-remove-deferred-prompt-modes.md`) therefore made disclosure wiring the **linchpin**: first make the `full` path lean by adding disclosure (additive, de-risks the unknowns of running disclosure standalone on a direct `generateText` call), then route every prompt through it, then delete the now-dead `mode` field and its branches. No DB migration — Zod strips the legacy `mode` key from old rows automatically.

## Decision Drivers

- **Delete the obsolete abstraction.** The three-mode taxonomy must collapse into a single unified proactive run that always loads live history + memory and always exposes the full task-tracker toolset on the main model (no small-model branch).
- **Wire disclosure as the linchpin, before removing anything.** The proactive full path must apply `maybeApplyDisclosure` and attach a standalone `createDisclosurePrepareStep` so tool schemas stay lean per-step — otherwise the removal regresses trivial reminders.
- **No DB migration.** The `execution_metadata` column is retained; Zod's unknown-key stripping must parse a stored `{ "mode": "context", … }` row into the mode-less shape and fire it as the unified run.
- **`delivery_brief` and `context_snapshot` are orthogonal and stay.** Only `mode` is removed; the brief/snapshot pair is preserved across the schema, the batch merge, and the tool input types.
- **Result compaction stays out of scope.** The proactive path gains disclosure only; `expand_result` is not registered there (proactive runs still never compact).
- **Mint a synthetic `turnId` for disclosure events.** The proactive path has no turn id; a stable synthetic id must be synthesized so `disclosure:*` debug events key cleanly and do not collide across concurrent fires.

## Considered Options

### Option 1 — Remove modes, unify on the full run, and wire progressive disclosure into the proactive path first (chosen)

Add `maybeApplyDisclosure` + a standalone `createDisclosurePrepareStep` to the proactive full path (additive, de-risks the linchpin), route every deferred prompt through the now-lean full run, then delete the `mode` field, the `lightweight`/`context` invocation branches, the dead helpers, and the batch priority logic. `delivery_brief`/`context_snapshot` preserved.

- **Pros:** collapses a three-way branch into one; tool-token cost is bounded by per-step disclosure rather than a creation-time classification guess; trivial reminders no longer need a separate small-model invocation; the mode taxonomy and its priority merge are deleted entirely.
- **Cons:** trivial reminders now pay the main-model + loaded-history floor (previously small model, no history) — accepted per the model-tier decision; disclosure runs for the first time in a `generateText`-direct context without the run-registry/steering composition that surrounds it in normal chat.

### Option 2 — Remove modes and always call the old `invokeFull` without wiring disclosure (rejected)

Drop the `mode` field and branches; every prompt runs the existing full path unchanged.

- **Pros:** smallest diff; no new disclosure wiring.
- **Cons:** makes trivial reminders _heavier_, not lighter — `full` mode already serialized the entire toolset with full schemas on every fire because disclosure was never wired in. This is the regression the spec's "critical gap" section exists to call out; strictly worse than the status quo for the common case.

### Option 3 — Keep the mode taxonomy; wire disclosure into each branch (rejected)

Preserve `lightweight`/`context`/`full`; add disclosure to whichever branches serialize tools.

- **Pros:** no behavioral change for lightweight/context prompts.
- **Cons:** keeps the creation-time classification surface, the priority merge, and the small-model branch the codebase set out to remove; disclosure's per-step gating already achieves the context-size goal the modes existed for, making the taxonomy redundant. Defeats the simplification.

## Decision

The chosen Option 1 shipped across the schema, the proactive full path, the unified dispatch, the batch merge, the tool surface, and the docs. What shipped — enumerated as deletions and their replacements:

1. **`mode` deleted from the schema.** `EXECUTION_MODES` and `ExecutionMode` are gone from `src/deferred-prompts/types.ts`; `executionMetadataSchema` is now `{ delivery_brief; context_snapshot }`; `DEFAULT_EXECUTION_METADATA` matches; `executionInputSchema`'s description no longer instructs the model to classify a mode.
2. **The `lightweight`/`context` invocation branches deleted.** `invokeLightweight` and `invokeWithContext` are gone from `src/deferred-prompts/proactive-llm.ts`; `dispatchExecution` collapses to a single call into `invokeFull` regardless of stored metadata.
3. **The small-model branch deleted.** `smallModel` is dropped from `LlmConfig` and `getLlmConfig` (now `{ apiKey; baseURL; mainModel }`); `modelIdForLightweight` is gone. Every deferred prompt fires on the main model.
4. **The dead helpers deleted.** `modelIdForLightweight`, `buildContextMessages`, `buildMinimalSystemPrompt`, `persistLightweightResponse`, and `persistContextResponse` are gone from `src/deferred-prompts/proactive-llm-helpers.ts`.
5. **The batch priority merge deleted.** `MODE_PRIORITY` / `MODE_BY_PRIORITY` are gone from `src/deferred-prompts/poller-scheduled.ts`; `mergeExecutionMetadata` just concatenates `delivery_brief`s and `context_snapshot`s across the batch.
6. **The `mode` field purged from logs and input types.** The poller log, `ExecutionInput`, `parseExecution`'s input type, and `finalizeAndLog`'s signature/call site no longer carry `mode`.
7. **The tool description cleaned.** `create_deferred_prompt`'s description no longer mentions classifying an execution mode.
8. **Replacement: progressive disclosure wired into the proactive path (the linchpin).** `buildFullToolSet` (`src/deferred-prompts/proactive-llm-full.ts`) applies `maybeApplyDisclosure` after `applyToolPreferences` and returns the `DisclosureSession` alongside the toolset; `buildFullSystemPrompt` passes `progressiveDisclosure: true`; `runFullGeneration` synthesizes a `turnId` and attaches a standalone `createDisclosurePrepareStep` to its direct `generateText` call. `expand_result` is not registered (compaction stays out of scope).
9. **Docs updated.** `docs/architecture/tools.md` and `src/tools/CLAUDE.md` now state the proactive/deferred path applies disclosure via its own `buildFullToolSet` and that the three execution modes were removed.

## Consequences

### Positive

- A three-way fire-time branch collapses into one: every deferred prompt runs the same unified full-generation path on the main model, with live history + memory and the full task-tracker toolset.
- Tool-token cost is bounded per-step by progressive disclosure (`search_tools`/`load_tool`) rather than by a creation-time classification guess the model had to make up front — the taxonomy, the priority merge, and the small-model invocation are all deleted.
- The proactive path and the normal chat path now both disclose; `docs/architecture/tools.md` and `src/tools/CLAUDE.md` no longer carry the false claim that disclosure runs only via the chat orchestrator's `buildFullToolSet`.
- Backward compatibility is free: a stored `{ "mode": "context", … }` row parses cleanly into the mode-less shape via Zod's unknown-key stripping and fires as the unified run — no migration.

### Negative

- **Cost/latency up for trivial reminders.** "Drink water" now runs the main model with history loaded (previously small model, no history). Disclosure keeps _tool_ tokens small, but the main-model + history floor is the accepted cost per the model-tier decision.
- **Disclosure's first `generateText`-direct run.** `createDisclosurePrepareStep` previously ran only composed with the steering prepareStep inside `invokeModel`; in the proactive path it is attached standalone. (Confirmed working — see Implementation Notes.)
- **A synthetic `turnId` is now part of the proactive contract.** Disclosure debug events key on `turnId`; the proactive path mints `proactive:<storageContextId>:<timestamp>` so events do not collide across concurrent fires.

### Risks

- **Disclosure correctness in the standalone context.** If the standalone prepareStep mis-gates (e.g. fails to latch open, or over-serializes), a fired prompt either cannot reach its tools or pays full-schema cost. The latched stall fallback (`disclosure:fallback` after 2 steps with no real loads) bounds the failure mode to one turn, and the unified-dispatch + per-step-gating tests exercise the closure before any load.
- **No migration relies on Zod's unknown-key behavior.** If a future schema change re-introduces a `mode` key or makes the schema strict, legacy rows would stop parsing. The legacy-row parse test pins the current behavior.
- **`turnId` collisions are timestamp-derived.** Two fires for the same storage context in the same millisecond would share a `turnId`; the storage-context prefix scopes the collision to one conversation, and disclosure events are debug-only.

## Related Decisions

- [ADR-0034](README.md) — Deferred Prompt Execution Modes: introduced the `lightweight`/`context`/`full` taxonomy this ADR **supersedes and deletes**. The mode classification surface, the priority merge, and the small-model invocation are all removed; ADR-0034's `delivery_brief`/`context_snapshot` inputs are preserved. (ADR-0034's source file was pruned with the 0001-0100 batch; referenced via the index.)
- [ADR-0030](README.md) — Deferred Prompts System: the original deferred-prompt abstraction whose fire-time execution path this ADR simplifies to a single unified full run. (ADR-0030's source file was pruned with the 0001-0100 batch; referenced via the index.)
- [ADR-0116](0116-deferred-prompt-delivery-redesign.md) — Deferred Prompt Delivery Redesign: the delivery redesign whose `full`-generation path (`buildFullToolSet` / `runFullGeneration` / `finalizeAndLog`) this ADR collapses all prompts onto and augments with progressive disclosure. ADR-0116's verify-and-report risky-delivery path is preserved verbatim.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. The no-residue verification (`grep -rniE "lightweight|EXECUTION_MODES|ExecutionMode|MODE_PRIORITY|modelIdForLightweight|invokeLightweight|invokeWithContext|buildMinimalSystemPrompt|persistLightweightResponse|persistContextResponse|buildContextMessages" src`) returns only (a) the planned doc sentence in `src/tools/CLAUDE.md:77` noting the modes were removed, and (b) two `TaskListItem`-derived comments in `src/deferred-prompts/fetch-tasks.ts:93` and `src/deferred-prompts/change-gate.ts:9` that call a list-item-derived Task "lightweight" — unrelated to execution modes. No mode code, type, branch, helper, priority constant, or field remains.

| File | Role | Evidence |
| --- | --- | --- |
| `src/deferred-prompts/types.ts:111-121` | `executionMetadataSchema` = `{ delivery_brief; context_snapshot }`; `DEFAULT_EXECUTION_METADATA` matches; no `mode`. | `read` confirms. |
| `src/deferred-prompts/types.ts:216-229` | `executionInputSchema` — `delivery_brief` + optional `context_snapshot` only; description is "Delivery instructions for the firing LLM." (no mode classification). | `read` confirms. |
| `src/deferred-prompts/types.ts` (whole file) | No `EXECUTION_MODES`, no `ExecutionMode` — **both absent**. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts:159-165` | `dispatchExecution` always calls `invokeFull`; no `switch`, no `mode` read. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts` (whole file) | No `invokeLightweight`, no `invokeWithContext`, no `modelIdForLightweight` import — **both branch functions absent**. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-config.ts:11` | `LlmConfig = { apiKey; baseURL; mainModel }`; no `smallModel`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-config.ts:40-44` | `getLlmConfig` returns `{ apiKey, baseURL, mainModel }`; no small-model line. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-helpers.ts` (whole file) | No `modelIdForLightweight`/`buildContextMessages`/`buildMinimalSystemPrompt`/`persistLightweightResponse`/`persistContextResponse` — **all dead helpers absent**. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-helpers.ts:110-116` | `finalizeAndLog(result, userId, verification?)` — no `mode` positional param; log meta is `{ userId, finishReason, stepCount }`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts:122-126` | `finalizeAndLog` call site — no `'full'` argument; passes verification only. | `read` confirms. |
| `src/deferred-prompts/poller-scheduled.ts:13-27` | `mergeExecutionMetadata` concatenates briefs/snapshots with `'\n---\n'`; no `MODE_PRIORITY`/`MODE_BY_PRIORITY`. | `read` confirms. |
| `src/deferred-prompts/poller.ts:52` | Poller log = `{ userId, promptCount, promptIds }`; no `mode`. | `read` confirms. |
| `src/deferred-prompts/tool-handlers.ts:56` | `ExecutionInput = { delivery_brief: string } & Partial<Readonly<{ context_snapshot: string }>>`; no `mode`. | `read` confirms. |
| `src/deferred-prompts/schedule-update-helpers.ts:21-23` | `parseExecution` input type drops `mode`; signature matches the mode-less shape. | `read` confirms. |
| `src/tools/create-deferred-prompt.ts:51` | Tool description: "Create a scheduled task or monitoring alert. Provide either a schedule … or a condition …" — no mode-classification instruction. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-full.ts:21-49` | `buildFullToolSet` applies `maybeApplyDisclosure` after `applyToolPreferences`/`makeTools` and returns `{ tools, enabledToolNames, disclosure }` (replacement wiring). | `read` confirms. |
| `src/deferred-prompts/proactive-llm-full.ts:42-47` | Retriever from `getToolRetriever(getConfigContextIdFromStorageContextId(storageContextId), { storageContextId, contextType, chatUserId })`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-helpers.ts:73-79` | `FullGenerationInput` carries `disclosure: DisclosureSession` (the threaded session). | `read` confirms. |
| `src/deferred-prompts/proactive-llm-helpers.ts:156-169` | `buildFullSystemPrompt` passes `progressiveDisclosure: true` for both provider and providerless cases. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts:14` | Imports `createDisclosurePrepareStep` from `../tools/disclosure/prepare-step.js`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts:64-81` | `prepareFullGenerationInput` captures `disclosure` from `buildFullToolSet` and includes it in the returned `FullGenerationInput`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts:98-110` | `runFullGeneration` mints `turnId = proactive:<storageContextId>:<Date.now()>` and attaches `createDisclosurePrepareStep(disclosure, storageContextId, turnId)` to `generateText`. | `read` confirms. |
| `docs/architecture/tools.md:28` | "Progressive disclosure (always on)" paragraph states the proactive/deferred path applies disclosure via its own `buildFullToolSet` and attaches a standalone `createDisclosurePrepareStep`; every deferred prompt runs the unified full-generation path. | `read` confirms. |
| `src/tools/CLAUDE.md:71-79` | Documents the proactive path wiring disclosure independently and notes the three execution modes were removed. | `read` confirms. |
| `tests/deferred-prompts/types.test.ts:288-290` | `parseExecutionMetadata('{"mode":"context",…}')` drops the legacy `mode` key — backward-compat / no-migration proof. | `read` confirms. |
| `tests/deferred-prompts/tools.test.ts:768,799,829,865` | Legacy-row migration tests insert `executionMetadata: JSON.stringify({ mode: 'full', … })` and assert it parses/routs cleanly — no-migration proof. | `read` confirms. |
| `tests/deferred-prompts/proactive-llm.test.ts:165-179` | Unified-dispatch test: `dispatchExecution` always builds the full toolset with `search_tools`/`load_tool` regardless of stored metadata. | `read` confirms. |
| `tests/deferred-prompts/proactive-llm.test.ts:182-194` | Per-step-gating test: the disclosure `prepareStep` gates `activeTools` to core + meta before any tool is loaded. | `read` confirms. |

Plan-vs-implementation notes:

- **`LlmConfig` / `getLlmConfig` were extracted into their own `proactive-llm-config.ts`.** The plan placed `LlmConfig` and `getLlmConfig` inline in `proactive-llm.ts` and edited them there (Task 2 Step 4). Shipped, they live in a new `src/deferred-prompts/proactive-llm-config.ts` (`proactive-llm-config.ts:11,19-45`), imported by `proactive-llm.ts:15`. The substantive change (`smallModel` dropped, only `mainModel` returned) is preserved exactly; only the file location differs.
- **The `generateText` call hoists the system prompt into messages.** The plan's Task 1 Step 6 showed `generateText({ model, system: prepared.systemPrompt, messages: prepared.messages, … })`. Shipped (`proactive-llm.ts:103-110`) spreads `...hoistSystemMessages(prepared.systemPrompt, prepared.messages)` instead of passing `system`/`messages` as separate keys. `buildProactiveVerification` (`proactive-llm-helpers.ts:37-43`) uses the same `hoistSystemMessages` pattern, so this is a consistent message-shape refactor; the system prompt is still applied to the generation. Intent preserved.
- **The legacy-row parse test landed in `types.test.ts`, not `proactive-llm-helpers.test.ts`.** The plan's Task 3 Step 1 said to add the `parseExecutionMetadata` legacy-key test to "`proactive-llm-helpers.test.ts` (or the file that tests `parseExecutionMetadata`)." Shipped, it is in `tests/deferred-prompts/types.test.ts:288-290` — the file that actually tests `parseExecutionMetadata`, since the function lives in `types.ts`. The plan explicitly offered this alternative; behaviorally identical.
- **The unified-dispatch test dropped the plan's `as unknown as ExecutionMetadata` cast.** The plan's Task 2 Step 1 fixture cast a `{ delivery_brief, context_snapshot: null }`-with-extra-keys object through `as unknown as ExecutionMetadata`. Shipped (`proactive-llm.test.ts:168-171`), the metadata is a plain typed `ExecutionMetadata` literal — cleaner, since `mode` is no longer a field the test needs to smuggle in. Same assertion (`search_tools`/`load_tool` present in the toolset).

The source plan `docs/superpowers/plans/2026-07-19-remove-deferred-prompt-modes.md` and design `docs/superpowers/specs/2026-07-19-remove-deferred-prompt-modes-design.md` are archived alongside this ADR to `docs/archive/`.
