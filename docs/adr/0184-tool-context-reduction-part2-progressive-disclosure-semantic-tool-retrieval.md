<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0184: Tool-Context Reduction — Part 2: Progressive Disclosure and Semantic Tool Retrieval

## Status

Implemented

## Date

2026-06-05

## Context

`makeTools()` / `buildToolDescriptors()` assembles a capability- and context-gated `ToolSet` per turn and passes the **entire** set to a single `generateText` agentic loop (up to 25 steps). Every tool's JSON schema is serialized into the prompt on every step whether or not it is used — the "tools tax". As the surface grows (especially via externally-sourced MCP and plugin tools), this inflates cost/latency, bloats the KV cache, and degrades tool-selection accuracy. The shared design (`docs/superpowers/specs/2026-06-05-tool-context-reduction-design.md`) specified three independent, feature-flagged units that layer **after** the existing capability/context/permission gating: progressive disclosure (C), result compaction (F), and semantic tool retrieval (B).

This ADR covers **Part 2** — units **C** and **B**. Part 1 (ADR-0183) shipped the `tool_context_flags` resolution layer and result compaction (F); this plan depends on `feature-flags.ts`, the `expand_result` registration, and compaction wiring in `buildFullToolSet`. The goal: behind the per-context `progressive_disclosure` flag (default OFF), show the model only a minimal always-on core plus `search_tools` / `load_tool` / `expand_result` meta-tools, and let it discover and explicitly load the tools it needs mid-task via the AI SDK v6 `prepareStep` / `activeTools` mechanism. `search_tools` results are ranked by a `ToolRetriever` — embedding-backed when `semantic_tool_retrieval` is ON and an embedding model is resolvable, lexical otherwise. Flag OFF must be byte-identical to today's eager behavior.

## Decision Drivers

- **Definition-token cost**: serialize only the schemas actually in use per step, while preserving multi-step, mid-task tool discovery.
- **Scale to hundreds of tools**: the mechanism must degrade gracefully as MCP/plugin tool counts grow, without per-tool tuning.
- **Auditable, model-driven discovery**: the model itself searches and loads, replacing the removed regex `tool-router.ts` heuristic that was "not trusted enough for vague real-world requests".
- **Fail-safe degradation**: every new path degrades toward today's eager behavior, never toward a broken turn; each unit independently fail-safe.
- **Flag-OFF invariant**: byte-for-byte today's behavior when the flag is off; independently toggleable from compaction.
- **Anonymity contract**: telemetry carries sizes, counts, tool names, and enum modes only — never query text, summaries, or schemas.

## Considered Options

### A. Disclosure aggressiveness: minimal core (chosen) vs. keep common tools eager

- **Minimal core (`get_current_time` only) + discover everything else** — Pros: maximal step-0 token savings, scales with tool count; the `coreNames` knob is the single tuning lever if a larger always-on core is wanted later. Cons: even trivial intents cost a `search_tools` round-trip; a confused model that never loads stalls (mitigated by the stall fallback).
- **Keep a hand-picked common set eager** — Pros: fewer round-trips for common intents. Cons: a static "common" set ages poorly as tools are added; reintroduces the heuristic-pruning trust problem the removed `tool-router.ts` had.

### B. Retrieval: embedding-backed with lexical fallback (chosen) vs. lexical-only

- **Embedding-backed (reuse `tryGetEmbedding`/`cosineSimilarity`)** — Pros: ranks semantically related tools above lexical noise; selection-accuracy at scale. Cons: an embedding call per query (briefs cached per process); needs an embedding model + creds, BYOK-aware.
- **Lexical-only** — Pros: zero deps, always available. Cons: token-overlap misses paraphrase ("overdue" vs. "list tasks by due date"); quality degrades as vocabulary diverges.

### C. `prepareStep` integration: single shared hook (chosen) vs. disclosure-only

- **Compose steering + disclosure into the one SDK hook** — Pros: composes with the existing mid-run steering `prepareStep` (`RunControl`); both features coexist. Cons: a merging layer (`composePrepareSteps`) must split ownership (steering owns `messages`, disclosure owns `activeTools`).
- **Disclosure owns the hook exclusively** — Pros: simpler factory. Cons: impossible — mid-run steering already occupies the hook; the SDK allows one `prepareStep`.

## Decision

Seven coordinated changes implement the architecture, all gated by `resolveReductionFlags(contextId).progressiveDisclosure` and layered after `applyResultCompaction` in `buildFullToolSet` (`src/llm-orchestrator-tools.ts`):

### 1. Turn-scoped `DisclosureSession` + core/meta split (`src/tools/disclosure/`)

`core.ts` defines `CORE_TOOL_NAMES = {get_current_time}` and `META_TOOL_NAMES = {search_tools, load_tool, expand_result}`; `ALWAYS_ON_TOOL_NAMES` is their union (intersected with registered names, since `expand_result` is registered only by the compaction flag). `registry.ts` exposes `createDisclosureSession(fullTools, coreNames)` returning a `DisclosureSession` whose `activeToolNames()` = core ∪ meta ∪ loaded (intersected with `allNames`), `markLoaded(names)` partitions known/unknown and is idempotent, and `hasLoaded()` is true only when a **non-always-on** name has been loaded (so loading only meta-tools does not bypass the stall guard). The session is created once per `prepareLlmInvocation` and never cached across turns.

### 2. `search_tools` and `load_tool` meta-tools

`search-tools.ts` returns ranked **schema-less** briefs `{name, summary, domain, alreadyLoaded}`; `summary` is the first sentence of the tool's own `.description` (capped 160 chars, with an abbreviation guard so `e.g.`/`i.e.` don't truncate), and `domain` from `getToolMetadata(name)`. Always-on tools are not surfaced as discoverable. `load-tool.ts` batch-activates names, returning `{loaded, unknown, nowActive}`. Both are injected after `applyToolPreferences` so stored ask/deny overrides cannot wrap them; a loaded tool keeps its `ask` wrapper. `wire.ts` (`maybeApplyDisclosure(tools, contextId, retriever, { enabled })`) pre-populates the meta-tool keys with placeholders so the session's `allNames` snapshot includes them, then overwrites with real implementations bound to the session.

### 3. `ToolRetriever`: lexical + BYOK-aware embedding

`tool-retriever.ts` defines the `ToolRetriever` interface and `LexicalToolRetriever` (token-overlap + substring bonus over `name + summary + domain`, deterministic ordering, empty query → `[]`). `embedding-tool-retriever.ts` holds `EmbeddingToolRetriever` (embeds the query, embeds each brief cached by name, ranks by `cosineSimilarity`, falls back to lexical on null query embedding or zero scored briefs) and `getToolRetriever(configContextId, callContext)`, which resolves the **effective** LLM config via `resolveEffectiveLlmConfig` (BYOK-aware — central or per-context credentials), returning a `LexicalToolRetriever` when unresolvable. Brief-embedding caches are keyed per endpoint+model (`${baseUrl}:${model}`) with a dimension-mismatch guard; `semantic_tool_retrieval` OFF forces lexical.

### 4. `prepareStep` with stall + meta-churn fallback (`prepare-step.ts`)

`createDisclosurePrepareStep(session, contextId, turnId?)` returns `{ activeTools: session.activeToolNames() }` normally. It latches open (`{}` — all tools active) and emits `disclosure:fallback` once when **either** (a) no real load has happened by `DISCLOSURE_STALL_STEPS` (2), or (b) the trailing 2 completed steps contain **only** `search_tools`/`load_tool` calls ("meta-churn" — discovery without progress). Once latched, it stays open for the turn. `turnId` threads into the fallback event.

### 5. `composePrepareSteps` — run-control integration

The AI SDK allows one `prepareStep` hook, already occupied by mid-run steering (`RunControl`). `composePrepareSteps` (`src/run-control/steering-prepare-step.ts`) merges the two: steering owns `messages` injection, disclosure owns `activeTools`. `invokeModel` picks the disclosure step when no run is active, the composed step otherwise.

### 6. System-prompt discovery preamble (`src/system-prompt.ts`)

A `DISCLOSURE_PROTOCOL` constant is pushed via `buildDisclosureFragment(enabledToolNames)` only when `progressiveDisclosure` is true. It advertises `expand_result` **only when registered** (disclosure ON + compaction ON), so the preamble never names a nonexistent tool. `system-prompt-prefs.ts` excludes `DISCLOSURE_INJECTED_TOOL_NAMES` from preference-gating advertisement.

### 7. Flag-off pass-through

`maybeApplyDisclosure` returns `{ tools, disclosure: undefined }` unchanged (same reference) when `enabled` is false; `invokeModel` omits `prepareStep`, so the SDK leaves all tools active — today's behavior. `enabledToolNames` passed to the prompt stays the full registered set; `activeTools` — not `enabledToolNames` — controls per-step callability.

## Consequences

### Positive

- Step-0 serializes ~4 tool schemas instead of the full gated set; savings scale with tool count and compound with compaction across steps.
- Discovery is explicit and auditable: the model itself searches and loads, and `disclosure:search`/`disclosure:load`/`disclosure:fallback` events carry counts/lengths for measurement (never query text or schemas, preserving the anonymity contract).
- A stalled or churning model still completes via the latched-open fallback — no broken turns.
- Retrieval is BYOK-aware and degrades to lexical with zero deps; per-model+endpoint caches bound embedding cost by tool count, not user count.
- Composes with mid-run steering without either feature knowing the other's internals.
- Flag OFF is a reference-identical pass-through; independently toggleable from compaction.

### Negative

- **Discovery round-trips cost steps.** Even trivial intents pay a `search_tools` + `load_tool` pair; the 25-step cap is unchanged, so a verbose discovery path can hit it. Mitigated by batched `load_tool` and 8-brief `search_tools` default, but not eliminated.
- **Lexical fallback is weak for paraphrase.** Without an embedding model, "overdue tasks" may not rank `list_tasks` if the description lacks the word. Quality depends on tool descriptions being well-written.
- **`resolveReductionFlags` may be read twice per turn** when disclosure is ON (`buildFullToolSet` + inside feature-flag resolution paths). Harmless cached read; left to keep `wire.ts` self-contained. Candidate for a later cleanup.

### Risks

- **Stall fallback masks a confused model silently.** A model that never learns to use `search_tools` degrades to eager behavior with a `warn` log; operators must watch the `disclosure:fallback` rate to detect poor model fit rather than treating fallback as healthy.
- **Brief quality governs retrieval quality.** A tool with an empty or vague `.description` indexes by name only; embedding and lexical both weaken. Tool authors must keep descriptions precise (the `firstSentence` cap and abbreviation guard help but cannot fix missing text).

## Related Decisions

- ADR-0183: Tool-Context Reduction — Part 1: Flags and Result Compaction — the `tool_context_flags` layer, `expand_result`, and compaction wiring this plan depends on and composes after.
- ADR-0141: User-Configurable Tool Access — the `tool_prefs` `allow`/`ask`/`deny` gating that runs before disclosure; a denied tool is never in `fullTools`, so never searchable or loadable.
- ADR-0142: Tool Ask Permission Gate — the `ask` wrapper a loaded tool retains.
- Run-control steering (`src/run-control/`) — `composePrepareSteps` shares the single SDK `prepareStep` hook with disclosure.

## Implementation Notes

Key files confirmed present:

- `src/tools/disclosure/core.ts` — `CORE_TOOL_NAMES`, `META_TOOL_NAMES`, `ALWAYS_ON_TOOL_NAMES`, `DISCLOSURE_INJECTED_TOOL_NAMES`, `DISCLOSURE_STALL_STEPS`.
- `src/tools/disclosure/registry.ts` — `createDisclosureSession` / `DisclosureSession`.
- `src/tools/disclosure/tool-brief.ts` — `ToolBrief`, `buildBriefs`.
- `src/tools/disclosure/tool-retriever.ts` — `ToolRetriever`, `LexicalToolRetriever`, `RankedBrief`.
- `src/tools/disclosure/embedding-tool-retriever.ts` — `EmbeddingToolRetriever`, `getToolRetriever` (BYOK-aware via `resolveEffectiveLlmConfig`).
- `src/tools/disclosure/search-tools.ts` / `load-tool.ts` — meta-tools.
- `src/tools/disclosure/prepare-step.ts` — `createDisclosurePrepareStep` (stall + meta-churn).
- `src/tools/disclosure/wire.ts` — `maybeApplyDisclosure(tools, contextId, retriever, { enabled })`.
- `src/system-prompt.ts` — `DISCLOSURE_PROTOCOL`, `buildDisclosureFragment`; `AssembleOptions.progressiveDisclosure`.
- `src/llm-orchestrator-tools.ts` — `applyCompactionAndDisclosure` / `buildFullToolSet` threads `disclosure` outward; retriever chosen by `semanticToolRetrieval`.
- `src/llm-orchestrator-invoke.ts` — attaches `createDisclosurePrepareStep` (or `composePrepareSteps` when a run is active); passes `progressiveDisclosure: disclosure !== undefined` to the prompt builder.
- `src/run-control/steering-prepare-step.ts` — `composePrepareSteps`.

Divergences from the plan (resolved during execution, recorded in the plan's drift log):

- `EmbeddingToolRetriever` / `getToolRetriever` were split into a dedicated `embedding-tool-retriever.ts` (single-responsibility) and made BYOK-aware via `resolveEffectiveLlmConfig(configContextId)` rather than reading `getSystemConfig` directly; per-model+endpoint caches and a dimension-mismatch guard were added.
- `maybeApplyDisclosure` takes an `{ enabled }` opts object (caller resolves flags once) and uses a placeholder-key single-session pattern instead of the plan's create-twice dance.
- `createDisclosurePrepareStep` gained an optional `turnId` (threaded into `disclosure:fallback`) and a second stall trigger — **meta-churn** (trailing 2 steps only `search_tools`/`load_tool`) — beyond the plan's pre-load stall; it reads the SDK `steps` array in addition to `stepNumber`.
- `composePrepareSteps` was added to share the single SDK `prepareStep` hook with mid-run steering, which the plan did not anticipate.
- `DISCLOSURE_INJECTED_TOOL_NAMES` was added to `core.ts` so `system-prompt-prefs.ts` and meta-churn detection treat the injected meta-tools uniformly.
- `markLoaded` no longer counts always-on names toward `hasLoaded()`, so loading only meta-tools cannot bypass the stall guard.
