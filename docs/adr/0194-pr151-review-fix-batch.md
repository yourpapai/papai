<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0194: PR #151 Review-Fix Batch

## Status

Implemented

## Date

2026-06-11

## Context

PR #151 introduced two experimental, flag-gated, default-OFF tool-context-reduction features on the `context-pollution` branch: **result compaction** (oversized successful tool results stored in a per-context TTL/LRU cache and replaced by a `_compacted` envelope paged by `expand_result`) and **progressive disclosure** (full tool schemas stay registered for execution/permissions but are not serialized until `search_tools`/`load_tool` load them into a turn-scoped `activeTools` set). A 2026-06-10 review by wKich produced 10 inline comments; the design (`docs/superpowers/specs/2026-06-11-pr151-review-fixes-design.md`) verified all 10 against the codebase, fixed 9, hardened one reviewer-premise-incorrect-but-suggestion-adopted gap, and wontfixed one cosmetic finding (#10, first-sentence regex).

The 9 valid findings plus the adjacent summarizer-BYOK gap cluster into eight independent fixes spanning the compaction and disclosure subsystems: an SDK `toolCallId` pass-through mismatch, a per-turn flag-snapshot split, a result store that was FIFO-not-LRU, an ask-line that advertised ungated injected meta-tools, a proactive path that registered a compaction-only pager, a BYOK-blind embedding retriever with no usage recording, a triple-duplicated LLM model builder, and a missing secondary stall guard for post-load meta-only churn. The approved spec is the source of truth for the architecture described here; the plan executed the fixes one commit per finding under repo TDD hooks (Red → Green → Refactor).

## Decision Drivers

- **Observability integrity:** `tool:failure_classified` and `tool:execute_end` events must join on `toolCallId`; a mismatched handle-as-id breaks usage attribution and the dashboard.
- **One consistent flag snapshot per turn:** `resultCompaction` and `progressiveDisclosure` are read once in `buildFullToolSet`; mid-turn cache invalidation must not split compaction/disclosure decisions.
- **Correctness over micro-optimization:** the result store's documented "TTL/LRU" wording must be true (LRU, not FIFO), and failure wording must not assert expiry the store cannot prove (eviction is indistinguishable from never-existed without extra state).
- **Prompt/runtime consistency:** the system-prompt ask line must not instruct `_permission_reason` for tools whose stored `ask` override is bypassed by post-`applyToolPreferences` injection.
- **BYOK parity and billing:** semantic-tool-retrieval embeddings and compaction summarization must resolve per-context credentials (BYOK or central) and record every call in `llm_usage_events` with correct context attribution, not silently fall back to `'global'`.
- **Honest degradation:** a rejecting injected `embed` must degrade to the lexical fallback, not surface as a non-retryable `search_tools` failure — even though `tryGetEmbedding` never rejects in production wiring today.

## Considered Options

### Option A: Per-finding surgical fixes (chosen)

Apply eight independent targeted fixes, each scoped to one finding, one commit, TDD per repo hook policy.

- **Pros:** Minimal blast radius; each fix is independently reviewable and revertible; preserves the experimental, default-OFF framing; no event-schema changes (`disclosure:*` events keep counts/lengths only, `errorCode 'expired'` retained for event-consumer stability).
- **Cons:** Touches the same handful of files across multiple commits (e.g., `expand-result.ts` edited in F1 and F3); eight commits land close together, so bisect granularity is per-finding not per-file.

### Option B: Single consolidated refactor of the compaction+disclosure subsystems

Rewrite `result-store`, `expand-result`, `wire`, `prepare-step`, and the model builder in one pass.

- **Pros:** One commit, one review pass.
- **Cons:** High blast radius on experimental code; loses per-finding bisect/revert granularity; obscures the review-traceable provenance of each fix; conflicts with the repo's TDD one-finding-per-commit convention.

### Option C: Adopt only the verified-bug fixes, drop the hardening (F6 throw-safe embeds, F8 churn guard)

- **Pros:** Smaller diff; F6's throwing path is unreachable in production wiring, F8's churn case cannot occur in a healthy turn.
- **Cons:** Leaves the disclosed subsystem fragile against a future embedding implementation that rejects; leaves the agent able to loop indefinitely on `search_tools`/`load_tool` churn after a load with no real progress. The design explicitly adopts both as hardening.

## Decision

Eight coordinated fixes implement the batch, ordered F1 → F8 (one commit each):

### F1 — `expand_result` failure carries the SDK `toolCallId`

`src/tools/compaction/expand-result.ts` `execute` accepts the SDK second parameter `opts`; the failure `toolCallId` becomes `opts?.toolCallId ?? ''`, matching `wrapToolExecution` and `search_tools`. Restores the join between `tool:failure_classified` and `tool:execute_end`.

### F2 — Single flag snapshot per turn

`maybeApplyDisclosure(tools, contextId, retriever, opts: { enabled })` (`src/tools/disclosure/wire.ts`) drops its own `resolveReductionFlags` import; the caller `buildFullToolSet` (`src/llm-orchestrator-tools.ts`) passes `flags.progressiveDisclosure` from its single resolve call. Mirrors `applyResultCompaction`'s `enabled` option.

### F3 — Result store true LRU + neutral message

`src/tools/compaction/result-store.ts` `getResultPage` refreshes recency on hit (`m.delete(handle)` then `m.set(handle, entry)`), so `putResult`'s insertion-order eviction becomes true LRU. `expand-result.ts` failure wording becomes neutral — `error: "Result handle not found, expired, or evicted"`, `agentMessage` drops the expiry assertion while keeping "re-run the original tool" guidance; `errorCode` stays `'expired'`.

### F4 — Ask line excludes post-preferences injected meta-tools

`src/tools/disclosure/core.ts` exports `DISCLOSURE_INJECTED_TOOL_NAMES: ReadonlySet<string> = new Set(['search_tools', 'load_tool'])` — exactly the names injected after `applyToolPreferences` (not `META_TOOL_NAMES`, which includes `expand_result`). `buildAskToolsLine` (`src/system-prompt.ts`) filters these out; `expand_result` stays listed when overridden because its `ask` wrapper is real.

### F5 — Proactive mode does not register `expand_result`

`src/tools/provider-independent-tools-builder.ts` adds `mode === 'normal'` to the registration condition. The proactive path never applies `applyResultCompaction`/`maybeApplyDisclosure`, so the pager would only fail misleadingly on envelopes left by recent normal turns.

### F6 — BYOK-aware retriever with usage recording

`getToolRetriever(configContextId, callContext, deps?)` (`src/tools/disclosure/embedding-tool-retriever.ts`) resolves credentials via `resolveEffectiveLlmConfig(configContextId)` (BYOK-aware); `!ok` → `LexicalToolRetriever`. `embed` delegates to `tryGetEmbedding(text, apiKey, baseUrl, embeddingModel, callContext)` so every embedding call lands in `llm_usage_events`. Brief-cache key becomes `` `${llmBaseUrl}:${embeddingModel}` `` to prevent cross-endpoint vector mixing. `EmbeddingToolRetriever.rank`/`embedBrief` wrap embeds in `safeEmbed` try/catch → null → lexical fallback. Accepted behavior change: an unset `embeddingModel` no longer short-circuits at construction; the per-search embed fails to null and lexical kicks in per call.

### F7 — Shared memoized model builder + per-context summarizer

New `src/llm-model-builder.ts`: `getOpenAICompatibleProvider(apiKey, baseUrl, deps?)` memoizes `createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL, fetch: fetchWithoutTimeout })` in a `Map` keyed `` `${apiKey}:${baseUrl}` ``, capped at 32 with oldest-entry eviction (BYOK alternates keys; a single-entry cache would thrash). `buildChatModel(apiKey, baseUrl, modelName)` returns the provider-bound model. `summarizeResult`'s default deps no longer hardcode `resolveEffectiveLlmConfig('global')`; `wrap-compaction.ts` builds summarizer deps once per turn via `buildSummarizerDeps(getConfigContextIdFromStorageContextId(storageContextId))`.

### F8 — Meta-only-churn secondary stall guard

`src/tools/disclosure/prepare-step.ts` adds `isMetaOnlyStep` (a step is meta-only if it made ≥1 tool call and every call is in `DISCLOSURE_INJECTED_TOOL_NAMES`) and `isMetaChurn` (the last `DISCLOSURE_STALL_STEPS` completed steps are all meta-only). The prepare-step returns `{}` and emits the one-shot `disclosure:fallback` event on pre-load stall, meta churn, or once the `fallbackOpen` latch is set. A step with zero tool calls does not count toward churn; a recent real-tool call breaks the pattern. Rejected alternative "steps without new loads" is a false-positive trap (healthy turns load early then work for many steps).

## Consequences

### Positive

- `tool:failure_classified`/`tool:execute_end` events re-join on the real SDK `toolCallId`, restoring usage attribution.
- One flag snapshot per turn eliminates the compaction/disclosure split-decision race under mid-turn cache invalidation.
- The result store is genuinely LRU; the documented "TTL/LRU" wording is now accurate.
- The ask line no longer instructs `_permission_reason` for tools whose overrides are bypassed by injection, eliminating a prompt/runtime contradiction.
- Proactive runs no longer register a compaction-only pager that could only fail.
- Semantic tool retrieval uses per-context BYOK credentials and records every embedding call in `llm_usage_events`; brief caches are isolated per endpoint+model.
- A single memoized model builder eliminates triple-duplicated `createOpenAICompatible` construction and fixes the dropped `fetchWithoutTimeout` in the summarizer; per-turn summarizer deps give correct BYOK billing attribution.
- A latched secondary stall guard catches post-load `search_tools`/`load_tool` churn that the pre-load guard alone missed.

### Negative

- **Proactive runs lose `expand_result` even for envelopes left in history by recent normal turns.** The envelope's own `agentMessage` instructs re-running the original tool. Proactive compaction/disclosure parity is explicitly out of scope (the flags are experimental and default OFF).
- **No tombstones in the result store.** Eviction is indistinguishable from never-existed without extra state; the agent's recovery action (re-run the original tool) is identical, so the design accepts the ambiguity and surfaces it in neutral wording.
- **An unset `embeddingModel` no longer short-circuits to lexical at construction.** It now fails per-search to null and falls back per call, matching `getEmbeddingForContext` semantics. Consistency over micro-optimization.

### Risks

- **`buildChatModel` adoption exceeded the plan's stated scope.** The plan scoped F7 to "all three duplicated callsites" (`summarizer.ts`, `conversation.ts`, `llm-orchestrator.ts`); the shipped builder is now also consumed by `src/long-term-memory/runner.ts`, `promotion.ts`, `capture.ts`, `src/web/distill.ts`, `src/tools/lookup-group-history.ts`, and `src/deferred-prompts/proactive-llm.ts` — nine callsites total. The broader adoption is consistent with the design intent (one shared builder) but means a future change to the 32-entry cache eviction policy affects more paths than the plan analyzed.
- **`safeEmbed` masks real embedding failures as `null`.** This is intentional hardening, but a persistently failing endpoint will silently degrade every `search_tools` to lexical with only a `WARN` log; there is no operator alert.
- **The `fallbackOpen` latch is permanent for the turn.** Once meta churn or a pre-load stall opens all tools, the session never re-narrows; re-narrowing would strip tools mid-flow. A noisy early churn permanently widens the turn's tool surface.

## Related Decisions

- ADR-0183: Tool Context Reduction Part 1 — Flags and Result Compaction (the feature this batch hardens).
- ADR-0184: Tool Context Reduction Part 2 — Progressive Disclosure and Semantic Tool Retrieval (the feature this batch hardens).
- ADR-0185: BYOK LLM Credentials — the per-context credential model F6 and F7 resolve against.

## Implementation Notes

Confirmed present in the shipped code:

- `src/tools/compaction/expand-result.ts:42` — `toolCallId: opts?.toolCallId ?? ''` (F1) and `expand_result handle not found (expired or evicted)` log/wording (F3).
- `src/tools/disclosure/wire.ts:24` — `opts: { enabled: boolean }` 4th parameter; no `feature-flags.js` import remains (F2).
- `src/tools/compaction/result-store.ts:55,60` — `m.delete(handle)` recency refresh in `getResultPage` (F3).
- `src/tools/disclosure/core.ts:26` — `DISCLOSURE_INJECTED_TOOL_NAMES = new Set(['search_tools', 'load_tool'])`; `META_TOOL_NAMES` (line 10) still includes `expand_result` (F4).
- `src/tools/provider-independent-tools-builder.ts:112` — `mode === 'normal' && resolveReductionFlags(contextId).resultCompaction` gate (F5).
- `src/tools/disclosure/embedding-tool-retriever.ts:83-97` — `getToolRetriever(configContextId, callContext, deps?)`, `safeEmbed` (line 28, 42, 60), `cacheKey = ${llmBaseUrl}:${embeddingModel}` (line 93), `ToolRetrieverFactoryDeps` (line 73) (F6).
- `src/llm-model-builder.ts:18,25,42` — `MAX_CACHED_PROVIDERS = 32`, `getOpenAICompatibleProvider`, `buildChatModel`; `fetchWithoutTimeout` wired into the provider (F7).
- `src/tools/disclosure/prepare-step.ts:17,24,38` — `isMetaOnlyStep`, `isMetaChurn`, and `fallbackOpen || preLoadStall || isMetaChurn(steps)` latch (F8).
- `src/llm-orchestrator-tools.ts:155-165` — `enabled: flags.resultCompaction`, `getToolRetriever(getConfigContextIdFromStorageContextId(contextId), { storageContextId, contextType, chatUserId })`, and `maybeApplyDisclosure(..., { enabled: flags.progressiveDisclosure })` — the single flag-snapshot caller wiring F2 and F6 together.

Divergence from the plan: F7's shared model builder was adopted by six additional callsites beyond the three the plan named (see Risks). No event-schema changes shipped; `disclosure:*` events still carry counts/lengths only, and `errorCode 'expired'` is retained for event-consumer stability.
