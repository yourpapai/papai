<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0183: Tool-Context Reduction — Part 1: Feature Flags and Result Compaction

## Status

Implemented

## Date

2026-06-05

## Context

papai assembles a capability- and context-gated `ToolSet` per turn and passes the entire set to a single `generateText` agentic loop of up to 25 steps. Every tool's JSON schema is serialized into the prompt on every step, and every tool result flows back through the model verbatim. As the tool surface grows — especially with externally-sourced MCP and plugin tools — this produces two distinct forms of context pollution: _definition_ pollution (all schemas occupy the prompt every turn) and _result_ pollution (large outputs from `list_tasks`, `web_fetch`, or MCP/plugin dumps flood the window).

The 2026-06-05 design spec (`docs/superpowers/specs/2026-06-05-tool-context-reduction-design.md`) proposes three independent, feature-flagged units that layer _after_ the existing capability/context/permission gating without replacing it: **C** progressive disclosure, **F** result compaction, and **B** semantic tool retrieval. This ADR covers **F** plus the shared feature-flag layer that all three units read. Part 2 (ADR-0184, forthcoming) covers C and B.

The goal of Part 1 is narrow and bounded: behind a per-context feature flag (default OFF), replace oversized tool _results_ with a query-aware SMALL_MODEL summary plus a handle, and let the model page the full raw result on demand via an `expand_result` tool. Definition pollution is out of scope here; the flag layer is shared so Part 2 can read the same module.

## Decision Drivers

- **Token/latency cost of large results** without changing capability/context/permission gating or the descriptor cache.
- **Default-OFF is byte-identical to today**, with a global kill switch and three independent per-context toggles.
- **Query-aware summaries** (not naive truncation) so the agent retains relevant identifiers, counts, names, and statuses.
- **Per-context, group-shared scope** — flags resolve at the config-context id (group-shared across threads), mirroring `tool_prefs`.
- **Fail-safe degradation** — every new path degrades toward today's behavior; failures, non-serializable values, already-compacted envelopes, and `expand_result` pages are never compacted.
- **Anonymity contract** — telemetry carries sizes, counts, tool names, and modes only; never result content, summaries, or previews.

## Considered Options

### Option 1: Per-turn wrap layer (chosen)

Compose compaction in `prepareLlmInvocation` per turn, _after_ `applyToolPreferences`, wrapping each executable tool's `execute`.

- **Pros:** sees the current turn's `userText` (the cached descriptor wrap cannot); leaves the cached `wrapToolExecution`/descriptor path unchanged; flag-OFF returns the toolset reference unchanged (zero overhead).
- **Cons:** runs a wrap pass every turn; the wrap must be careful to skip non-executable and never-compact tools.

### Option 2: Modify the cached `wrapToolExecution`

Thread a `CompactionContext` through the descriptor wrap.

- **Pros:** single wrap site.
- **Cons:** the descriptor `ToolSet` is cached per context and cannot carry per-turn user intent; would conflate cached and per-turn state. **Rejected** — the cached wrap has no access to the latest user message.

### Option 3: Deterministic truncation only (no model summary)

Replace oversized results with a head preview + handle, no SMALL_MODEL call.

- **Pros:** zero model cost, fully deterministic.
- **Cons:** loses the query-relevance signal; the agent must `expand_result` more often, costing _more_ round-trips. **Rejected** as the sole mechanism; retained as the summarizer-failure fallback.

## Decision

Six coordinated changes implement the architecture. The flag layer and compaction primitives are new; the wiring composes them into the per-turn invocation path.

### 1. Feature-flag module (`src/tools/feature-flags.ts`)

A reserved, non-user-visible config key `tool_context_flags` holds JSON `{ progressive_disclosure?, result_compaction?, semantic_tool_retrieval? }`. `resolveReductionFlags(storageContextId)` resolves per-context (at the config-context id, group-shared) → all-off; only a literal `true` enables a flag. The global env var `TOOL_CONTEXT_REDUCTION_DISABLED=true` is a kill switch that forces every flag OFF regardless of config. `parseReductionFlagsJson` is exported so the admin Feature flags UI (`src/debug/admin-feature-flags.ts`) can read/write the same key and report the kill switch.

### 2. Compaction primitives (`src/tools/compaction/`)

- `constants.ts` — `COMPACTION_THRESHOLD_BYTES = 8_000`, `COMPACTION_PREVIEW_BYTES = 600`, `RESULT_STORE_MAX_ENTRIES = 64`, `RESULT_STORE_TTL_MS = 30 * 60_000`, `EXPAND_DEFAULT_LIMIT_BYTES = 4_000`.
- `types.ts` — `CompactedEnvelope` (`_compacted: true`, `handle`, `summary: string | null`, `totalBytes`, `preview`, `hint`) and `isCompactedEnvelope` guard.
- `size-gate.ts` — pure `evaluateForCompaction(result)`: returns `{ compact: false }` for `undefined`/`null`, `ToolFailureResult`, already-`_compacted` envelopes, non-serializable values, and under-threshold results; otherwise `{ compact: true, serialized, totalBytes }`.
- `result-store.ts` — per-context in-memory `Map<contextId, Map<handle, Entry>>`. `putResult` generates `res_<hex>` from a monotonic counter (no `Math.random`/`Date.now` in hot paths). LRU eviction at `RESULT_STORE_MAX_ENTRIES` (insertion/access order, recency refreshed on read) and TTL expiry on read. Clock is injectable for deterministic tests.
- `summarizer.ts` — `buildSummarizerDeps(configContextId)` resolves **BYOK-aware** credentials once per turn via `resolveEffectiveLlmConfig` + `buildChatModel` (small model), returning `SummarizerDeps | null`. `summarizeResult(input, deps)` issues a query-aware prompt (tool name + user intent + 12 KB slice); any error or empty text returns `{ summary: null }` so the caller falls back to truncation.
- `expand-result.ts` — `makeExpandResultTool(contextId)`: pages the stored raw result (`{ chunk, nextOffset, done }`); a missing/expired/evicted handle returns a structured `ToolFailureResult` (`errorCode: 'expired'`, `retryable`) telling the agent to re-run the source tool.

### 3. Per-turn wrap layer (`src/tools/compaction/wrap-compaction.ts`)

`applyResultCompaction(tools, ctx, deps?)` returns a new `ToolSet` whose every executable tool is wrapped so that, after a successful execution, the result runs through the size-gate; over-threshold results are stored and replaced by a `CompactedEnvelope`. `expand_result` is in a `NEVER_COMPACT` set (guard by name) so its pages are never re-compacted. When `ctx.enabled === false` it returns `tools` unchanged (same reference). When `deps` is omitted it builds turn-scoped deps via `buildTurnDeps(storageContextId)`, so credentials resolve once per turn, not per oversized result.

### 4. `expand_result` registration (`src/tools/provider-independent-tools-builder.ts`)

`expand_result` is registered in `addProviderIndependentTools` when `contextId !== undefined && mode === 'normal' && resolveReductionFlags(contextId).resultCompaction`. The `mode === 'normal'` gate excludes proactive runs, which never apply compaction and therefore must not be offered the pager.

### 5. Per-turn wiring (`src/llm-orchestrator-tools.ts`)

A shared `applyCompactionAndDisclosure(prefTools, contextId, chatUserId, contextType, userText, deps)` helper resolves the flags, calls `applyResultCompaction` with `userIntent: userText`, then layers progressive disclosure (Part 2) and builds the `ToolRetriever`. Both `resolveReductionFlags` and `applyResultCompaction` are injected via a `PrepareLlmInvocationDeps` seam for testability. `enabledToolNames` is computed from the final (compacted + disclosed) set.

### 6. Flag-OFF regression guard

Flag OFF is a reference-identical pass-through: `applyResultCompaction` returns the same `ToolSet` object it was given, so behavior matches today exactly. This is asserted by a dedicated test.

## Consequences

### Positive

- Oversized tool results are compressed to a query-aware summary + handle, with on-demand paging of the full raw content.
- Flag OFF is reference-identical to today; the kill switch disables instantly; the three flags are independently toggleable.
- The summarizer is BYOK-aware, so contexts with their own credentials use them; central creds are the fallback.
- Failures, non-serializable values, already-compacted envelopes, and `expand_result` pages pass through uncompacted, leaving failure classification/telemetry unaffected.
- Proactive runs are excluded: no compaction, no `expand_result` offered.
- The flag layer is shared with Part 2 (disclosure + retrieval), so the spec's three units ship and are measured separately against one resolution module.

### Negative

- An extra SMALL*MODEL call is incurred per \_oversized* result only (under-threshold results have zero overhead). Cost/latency is traded for token savings.
- The result store is in-memory and per-process; handles are TTL-bounded (30 min) and LRU-bounded (64 per context). A restart or eviction forces re-running the source tool.
- Summaries are model-generated; faithfulness depends on SMALL_MODEL quality. The truncation fallback (preview head + handle, `summary: null`) mitigates worst cases but loses query-relevance.

### Risks

- A summary that omits a field the agent needs mid-task forces an `expand_result` round-trip. Mitigated by the query-aware prompt instruction to preserve concrete identifiers, counts, names, and statuses.
- A stale handle after TTL/eviction returns `ToolFailureResult` (`errorCode: 'expired'`, `retryable`), prompting the model to re-run the source tool. The hint text documents that `offset`/`limit` are character offsets, not bytes (the store slices characters via `String.slice`).
- Compaction and disclosure share one helper; a regression in the shared seam could affect both. Mitigated by the flag-OFF reference-identical guard and per-unit DI-first tests.

## Related Decisions

- ADR-0141: User-Configurable Tool Access — the `allow`/`ask`/`deny` permission tier that compaction layers after; a denied tool is absent before compaction runs, an `ask` tool keeps its gate through the wrap.
- ADR-0142: Tool `ask` Permission Gate — `ask`-gated tools remain gated once compaction is applied; the compaction wrap composes outside the permission wrap.
- ADR-0184 (forthcoming): Progressive Disclosure + Semantic Tool Retrieval — Part 2; shares `src/tools/feature-flags.ts` and the `applyCompactionAndDisclosure`/`PrepareLlmInvocationDeps` seam introduced here.
- `docs/superpowers/specs/2026-06-05-tool-context-reduction-design.md` — the approved design this implements (F portion).

## Implementation Notes

All key files are present and confirmed:

- `src/tools/feature-flags.ts` — `resolveReductionFlags`, `REDUCTION_FLAGS_CONFIG_KEY`, `parseReductionFlagsJson` (exported for the admin UI).
- `src/tools/compaction/` — `constants.ts`, `types.ts` (`CompactedEnvelope`/`isCompactedEnvelope`), `size-gate.ts` (`evaluateForCompaction`), `result-store.ts` (`putResult`/`getResultPage`, injected clock, LRU recency refresh on read), `summarizer.ts` (`buildSummarizerDeps`/`summarizeResult`), `expand-result.ts` (`makeExpandResultTool`), `wrap-compaction.ts` (`applyResultCompaction`, `NEVER_COMPACT`).
- Wiring — `src/llm-orchestrator-tools.ts` (`applyCompactionAndDisclosure`, `PrepareLlmInvocationDeps`); `src/tools/provider-independent-tools-builder.ts` (registers `expand_result` under the flag + `mode === 'normal'` gate); `src/debug/admin-feature-flags.ts` (admin UI read/write of `tool_context_flags`).

Notable divergences from the plan, all intentional:

1. **BYOK-aware summarizer.** The plan used central `getSystemConfig` + inline `createOpenAICompatible` with a `small_model` → `main_model` fallback. The shipped `summarizer.ts` resolves per-context credentials via `resolveEffectiveLlmConfig` + `buildChatModel`, and `wrap-compaction.ts` builds the deps once per turn (`buildTurnDeps`), not per oversized result.
2. **`expand_result` is also gated on `mode === 'normal'`.** Proactive runs never compact, so the pager is not offered there; the plan's gate omitted the mode check.
3. **`parseReductionFlagsJson` is exported.** The admin Feature flags UI (`src/debug/admin-feature-flags.ts`) reads/writes the same key and reports the kill switch; the plan kept the parser private.
4. **Compaction is co-wired with disclosure.** A single `applyCompactionAndDisclosure` helper and a `PrepareLlmInvocationDeps` injection seam handle both Part 1 and Part 2; the plan wired compaction inline. The `ToolRetriever` (lexical vs semantic) is also selected here.
5. **`expand_result` robustness.** The executor uses `opts?.toolCallId ?? ''` for the failure payload and applies `offset`/`limit` defaults defensively (some SDK/test paths bypass schema parsing); `result-store` refreshes recency on read for true LRU; tool descriptions clarify that offsets are character offsets.
