<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool-Context Reduction Design (Progressive Disclosure + Result Compaction + Semantic Tool Retrieval)

**Date:** 2026-06-05
**Status:** Approved (design); pending implementation plan
**Author:** brainstorming session

## 1. Overview

papai assembles a capability- and context-gated `ToolSet` per turn in
`makeTools()` / `buildToolDescriptors()` (`src/tools/index.ts`) and passes the
**entire** set to a single `generateText` call that runs an agentic loop of up to
25 steps (`src/llm-orchestrator-invoke.ts:231-240`). Every tool's JSON schema is
serialized into the prompt on every step, and every tool result flows back
through the model verbatim. As the tool surface grows — especially with
externally-sourced MCP and plugin tools — this produces two distinct forms of
context pollution:

- **Definition pollution** — all tool schemas occupy the prompt every turn,
  whether or not they are used. This inflates cost/latency, bloats the KV cache,
  and degrades tool-selection accuracy as the set grows.
- **Result pollution** — large tool outputs (e.g. `list_tasks`, `web_fetch`,
  MCP/plugin dumps) flood the window and crowd out the agent's working context.

This design introduces three independent, feature-flagged units that layer
**after** the existing capability/context/permission gating without replacing it:

- **C — Progressive disclosure:** the model is shown a minimal always-on core
  plus discovery meta-tools; it discovers and explicitly loads the tools it needs
  mid-task. Built on the AI SDK v6 `prepareStep` / `activeTools` mechanism.
- **F — Result compaction:** oversized tool results are replaced by a query-aware
  SMALL_MODEL summary plus a handle; the model pages the full raw result on demand
  via `expand_result`. Intercepts at `wrapToolExecution()`.
- **B — Semantic tool retrieval:** ranks the `search_tools` results using the
  existing embedding infrastructure (reused from memo semantic search), with a
  lexical fallback when no embedding model is configured.

This is the principled, model-driven successor to the previously-removed
regex heuristic `src/tools/tool-router.ts` (removed per
`2026-06-03-providerless-task-tracker-fallback-design.md` for being "not trusted
enough for vague real-world requests"). Discovery here is explicit and auditable:
the model itself searches and loads, rather than a heuristic silently pruning.

## 2. Goals / Non-goals

### Goals

- Reduce per-turn tool-definition tokens by showing only the tools actually in
  use, while preserving multi-step, mid-task tool discovery.
- Bound large tool-result tokens via query-aware summarization with on-demand
  paging of the full result.
- Improve tool-selection ranking quality as the tool count grows, reusing the
  existing embedding infrastructure with a graceful lexical fallback.
- Build all three generically so they scale to hundreds of MCP/plugin tools.
- Ship behind per-context feature flags, default OFF, with a guarantee that
  flag-OFF behavior is byte-identical to today and independently measurable.

### Non-goals

- No change to capability/context gating, `applyToolPreferences`
  (`allow`/`ask`/`deny`), MCP/plugin merge order, or the descriptor cache.
- No code-execution / sandbox "code mode" (a separate, heavier future option).
- No external tool-proxy / MCP gateway.
- No multi-agent decomposition.
- No persistence of disclosure sessions or compacted results across turns.

## 3. Locked design decisions

| #   | Decision                  | Choice                                                                                              |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Scope                     | Build B + C + F as an integrated, scale-oriented spec                                               |
| 2   | Disclosure aggressiveness | **Aggressive** — minimal core, discover everything else                                             |
| 3   | Compaction mechanism      | **SMALL_MODEL query-aware summary** + `expand_result` paging; deterministic-truncation fallback     |
| 4   | Retrieval scope           | **Embedding-backed now** (reuse memo embedding infra), **lexical fallback**                         |
| 5   | Rollout                   | **Feature-flagged, opt-in per context, default OFF**, global kill switch, three independent toggles |

## 4. Architecture

Three independent units behind one feature flag each, touching three distinct
seams. None replaces the existing gating — they layer after it.

```
                       makeTools() / buildToolDescriptors()         <- unchanged gating
                                    |  (full post-gating ToolSet)
                                    v
        +----------------------------------------------------------+
        |  llm-orchestrator-tools.ts  (prepareLlmInvocation)        |
        |   - feature flag check (context_settings + global)        |
        |   - if OFF -> today's behavior (all tools eager)          |
        |   - if ON  -> register full set, expose only CORE + meta  |
        +----------------------------------------------------------+
              | tools = full set          | meta-tools injected
              v                           v
   +-----------------------+   +--------------------------------------+
   | C: Progressive disc.  |   | search_tools / load_tool / expand_   |
   | prepareStep ->        |   | result   (new provider-independent   |
   | activeTools(core +    |   | meta-tools)                          |
   | loaded set)           |   +--------------------------------------+
   |  (invokeModel)        |            | ranks via
   +-----------------------+            v
              ^                 +----------------------+
              | every result    | B: ToolRetriever     |
              | flows through   |  embedding | lexical |  <- reuses tryGetEmbedding
              v                 +----------------------+
   +-----------------------------------------------+
   | F: Result compaction                          |
   |  wrapToolExecution -> size-gate -> SMALL_MODEL |
   |  query-aware summary + store handle            |
   |  expand_result pages the stored raw result     |
   +-----------------------------------------------+
```

| Unit                         | Seam (existing code)                                                                        | New module(s)                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C** Progressive disclosure | `invokeModel` `generateText` → add `prepareStep`; `prepareLlmInvocation` registers full set | `src/tools/disclosure/registry.ts`, `src/tools/disclosure/search-tools.ts`, `src/tools/disclosure/load-tool.ts`, `src/tools/disclosure/core.ts`            |
| **B** Semantic retrieval     | backs `search_tools` ranking                                                                | `src/tools/disclosure/tool-retriever.ts`                                                                                                                   |
| **F** Result compaction      | `wrapToolExecution()` post-success hook                                                     | `src/tools/compaction/summarizer.ts`, `src/tools/compaction/result-store.ts`, `src/tools/compaction/size-gate.ts`, `src/tools/compaction/expand-result.ts` |
| Flags                        | resolution layer                                                                            | `src/tools/disclosure/flags.ts`, `src/tools/compaction/flags.ts`                                                                                           |

**Key invariant:** flag OFF ⇒ byte-for-byte today's behavior. C, B, and F are
each independently toggleable, so they ship and are measured separately.

## 5. Components

### 5.1 C — Progressive disclosure

**`disclosure/registry.ts` — turn-scoped loaded set.** Created once per
`prepareLlmInvocation`, closed over by the meta-tools and `prepareStep`. Never
cached across turns.

```ts
// META_TOOL_NAMES = {'search_tools', 'load_tool', 'expand_result'} — the
// always-on disclosure machinery (module constant in disclosure/core.ts).
interface DisclosureSession {
  readonly coreNames: ReadonlySet<string>   // domain essentials, always-active
  readonly allNames: ReadonlySet<string>    // full gated set (validation)
  loaded: Set<string>                       // mutated by load_tool
  activeToolNames(): string[]               // coreNames ∪ META_TOOL_NAMES ∪ loaded
}
createDisclosureSession(fullTools: ToolSet, coreNames: ReadonlySet<string>): DisclosureSession
```

**Always-on set** (`disclosure/core.ts`, constants) = **domain-essential CORE**
(`coreNames`) ∪ **disclosure META**:

- **CORE** (`coreNames`, domain essentials): `get_current_time`.
- **META** (`META_TOOL_NAMES`, disclosure machinery): `search_tools`,
  `load_tool`, `expand_result`.

So four tool schemas are always active. Everything else (all CRUD, memos,
web_fetch, MCP, plugins) is discover-only. `coreNames` is the single tuning knob
if a larger always-on core is wanted later.

**`search_tools`** — input `{ query: string, limit?: number = 8 }` → returns
ranked **briefs** `[{ name, summary, domain, alreadyLoaded }]`. No JSON schemas
(cheap). Ranking delegated to B.

**`load_tool`** — input `{ names: string[] }` (batch, to cut round-trips) →
validates against `allNames`, adds to `loaded`, returns
`{ loaded, unknown, nowActive }`. Idempotent.

**`prepareStep` integration** (in `invokeModel`):

```ts
prepareStep: ({ stepNumber }) => ({ activeTools: session.activeToolNames() })
```

Only active tools' schemas are serialized (SDK `filterActiveTools` behavior).
The `tools` object passed to `generateText` remains the full registered set so
execution, wrapping, and permissions are intact.

**Discovery preamble** — a new system-prompt fragment, included only when
disclosure is ON: instructs the model that most tools are unloaded, to call
`search_tools` then `load_tool` (batching related tools) before use.

### 5.2 B — Semantic retrieval (ranks `search_tools`)

**`disclosure/tool-retriever.ts`**

```ts
interface ToolRetriever {
  rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]>
}
```

- **EmbeddingToolRetriever** (default when `embedding_model` set): embeds each
  brief's text **once per process**, cached in-memory keyed by
  `embeddingModel + sha(briefText)`; ranks by `cosineSimilarity` (mirrors
  `src/tools/search-memos.ts`). Query embedded per call.
- **LexicalToolRetriever** (fallback): token-overlap / substring scoring over
  `summary + name + domain`. Always available, zero deps.
- `getToolRetriever()` selects embedding when configured and reachable, else
  lexical — same available-check pattern as `trySemanticMode`. An embedding
  failure at call time falls back to lexical and never throws.

**Briefs** derive from `src/tools/tool-metadata.ts` (already has `domain` +
descriptions); a brief = `{ name, summary: first sentence of description,
domain }`. MCP/plugin tools without metadata fall back to `tool.description`,
and to name-only when description is empty.

### 5.3 F — Result compaction

**`wrapToolExecution()` extension** — gains an optional
`CompactionContext { storageContextId, toolName, toolInput, userIntent, enabled }`.
On **success only** (failures pass through untouched), the wrapper serializes the
result and measures `Buffer.byteLength`. Under threshold → returned as-is. Over →
compacted. `wrapToolExecution` is invoked from `wrapToolSet()` in
`buildToolDescriptors`, which already has `contextId`, so the context threads in
cleanly.

**`compaction/size-gate.ts`** — pure: serialize + measure + threshold decision;
double-compaction guard (an already-`_compacted` value is never re-compacted);
non-serializable values skip compaction.

**`compaction/summarizer.ts`** — query-aware: prompt to SMALL_MODEL (fallback
`main_model`) includes the user intent + tool name + tool input so the summary
keeps relevant fields. Built via `createOpenAICompatible` like
`src/embeddings.ts`. Returns `{ summary, omittedBytes }`. On failure/timeout →
deterministic truncation (`summary: null`, `preview` head retained).

**`compaction/result-store.ts`** — per-context in-memory LRU, bounded + TTL'd,
mapping `handle → { raw, contentType, createdAt }`. Handle = `res_<short-hash>`.

**Compacted envelope** returned to the model:

```ts
{
  _compacted: true,
  handle: 'res_ab12',
  summary: '...',          // null when summarizer fell back to truncation
  totalBytes: 40213,
  preview: '<first N chars>',
  hint: 'Call expand_result with this handle to page the full result.',
}
```

**`compaction/expand-result.ts`** — `expand_result` tool, input
`{ handle, offset?, limit? }` → pages the raw stored result (byte/item window) →
`{ chunk, nextOffset, done }`. Missing/expired handle → structured
`ToolFailureResult` (`errorCode: 'expired'`, `retryable`) telling the model to
re-run the source tool. `expand_result` is part of the always-on META set.

### 5.4 Feature flags

- `src/tools/disclosure/flags.ts` and `src/tools/compaction/flags.ts`.
- Three independent booleans: `progressive_disclosure`, `result_compaction`,
  `semantic_tool_retrieval` (the last only meaningful when disclosure is ON;
  defaults to embedding-when-available).
- Per-context override via `context_settings`; global default via a system flag.
- Resolution: per-context override → global → `false`.

## 6. End-to-end data flow

Flag ON. Context has Kaneo + a GitHub MCP server (~60 tools). User: _"Find my
overdue tasks in the Auth project and summarize the linked GitHub issues."_

**Turn setup** (`prepareLlmInvocation`):

1. `buildToolDescriptors` builds the full 60-tool gated set (unchanged).
2. Flag resolves ON → `createDisclosureSession(fullTools, CORE)`; `loaded = {}`.
3. System prompt gains the discovery preamble.
4. `generateText` called with `tools = full 60`,
   `prepareStep → activeTools = core + meta` (4 schemas on step 0, not 60).

**Agentic loop** (single `generateText`, ≤ 25 steps):

| Step | Model action                               | activeTools sent | Effect                                                                                    |
| ---- | ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| 0    | `search_tools("overdue tasks in project")` | 4                | B ranks → `list_tasks`, `search_tasks`, `get_project`, `count_tasks` (briefs, no schemas) |
| 1    | `load_tool(["list_tasks","get_project"])`  | 4                | `loaded += {list_tasks, get_project}` → `nowActive: 6`                                    |
| 2    | `list_tasks({project:"Auth", overdue})`    | 6                | 40 KB result → **F compacts** → ~600-token envelope + `handle res_x1`                     |
| 3    | `search_tools("github issue details")`     | 6                | B → `github_mcp__get_issue`, `github_mcp__list_issues` briefs                             |
| 4    | `load_tool(["github_mcp__get_issue"])`     | 6                | active 7                                                                                  |
| 5    | `github_mcp__get_issue(...)` × N           | 7                | large issue bodies compacted as needed                                                    |
| 6    | final text answer                          | 7                | done                                                                                      |

**Where each unit acts:**

- **C** decides _which schemas are visible_ per step via `prepareStep`;
  `load_tool` is the only thing that widens visibility.
- **B** only ranks `search_tools` output — never executes or loads; the model
  still explicitly `load_tool`s, so disclosure is auditable.
- **F** acts at execution time inside `wrapToolExecution`, independent of C —
  even an always-core tool gets compacted if its result is huge; detail is pulled
  back via `expand_result` only when the summary is insufficient.

**Caching / state:** the descriptor set is still cached per context (unchanged).
The `DisclosureSession` and result-store are per-turn / per-context-ephemeral,
created fresh each invocation — never cached, so no staleness.
`applyToolPreferences` still runs first; a denied tool is absent from
`fullTools`, so it can never be searched or loaded.

**Proactive/deferred path:** `src/deferred-prompts/proactive-llm-full.ts` builds
tools the same way and receives the same flag treatment (`askPermission` stays
undefined there, as today).

## 7. Error handling & edge cases

Failure philosophy: every new path degrades toward today's behavior (eager
tools, raw results), never toward a broken turn. Each unit is independently
fail-safe.

### C — Progressive disclosure

- **Model never calls `search_tools`/`load_tool`:** after
  `DISCLOSURE_STALL_STEPS` (default 2) with no `load_tool`, `prepareStep` returns
  `activeTools: undefined` (all tools active), so a confused model still
  completes — just without savings. Logged as `disclosure:fallback`.
- **`load_tool` unknown names** → returned in `unknown[]`, not an error; model
  self-corrects. Already-loaded names → no-op.
- **`prepareStep` throws** → caught; return `{}` (SDK default = all tools);
  disclosure silently disengages for that step.
- **Hallucinated call for an unloaded tool** → not in `activeTools`; the SDK
  rejects it as unknown; loop surfaces a tool-not-available result → model
  recovers via `search_tools`; we add a one-shot hint naming the tool.
- **25-step cap:** discovery consumes steps; mitigated by batched `load_tool`
  and 8-brief `search_tools`. Hitting the cap is the existing
  `stepCountIs(25)` behavior, unchanged, just logged.

### B — Retrieval

- **`embedding_model` unset / embed fails / provider down** → lexical fallback;
  never throws into `search_tools`.
- **Embedding cache cold** → first `search_tools` of the process pays one
  batch-embed, then cached. Bounded by tool count, not user count.
- **Brief text empty** → indexed by name; lexical still matches.
- **Empty ranking** → `search_tools` returns `[]` with a broaden-query hint.

### F — Compaction

- **Summarizer fails/times out** → deterministic truncation: store full raw,
  return `preview` head + `hint`, `summary: null`. Never returns nothing.
- **Result not serializable** → skip compaction, return as-is.
- **Under threshold** → zero overhead, untouched (no model call, no store write).
- **`expand_result` missing/expired handle** → `ToolFailureResult`
  (`errorCode: 'expired'`, retryable) → re-run source tool. Handles are
  per-context and TTL-bounded; a new turn won't see a stale handle.
- **Failures never compacted** — `ToolFailureResult` passes through untouched, so
  `emitFailureClassified` classification/telemetry is unaffected.
- **Double-compaction guard** — already-`_compacted` envelopes (e.g.
  `expand_result` output) are never re-compacted.

### Cross-cutting

- **Flag OFF** → none of the new code runs; `wrapToolExecution` keeps its current
  path (compaction context `enabled: false`); no `prepareStep` attached.
- **Permissions** — ask-gated tools work normally once loaded
  (`_permission_reason` / `gatedExecute` wrap the registered tool, independent of
  disclosure). A denied tool is never in `fullTools`, so never searchable.
- **Telemetry** — new debug events: `disclosure:search`, `disclosure:load`,
  `disclosure:fallback`, `compaction:applied`
  (`totalBytes`/`summaryBytes`/`mode: summary|truncated`), `compaction:expand`.

### Anonymity contract

New telemetry events carry **sizes, counts, tool names, and enum modes only** —
never result content, query text, summaries, or previews. This preserves the
`/stats/*` anonymity contract (content leakage from these surfaces is a
release-blocking defect).

## 8. Testing strategy

DI-first, each unit isolated, then one integration test for the loop. Helpers
from `tests/utils/test-helpers.ts` (`getToolExecutor`, `schemaValidates`).

### C

- `disclosure/registry.test.ts` — `activeToolNames()` = core ∪ meta ∪ loaded;
  `load_tool` idempotency; unknown-name partitioning; never returns a name absent
  from `allNames`.
- `search_tools` / `load_tool` — schema validation; `load_tool` mutates session;
  `search_tools` returns briefs with no `inputSchema` leakage.
- `prepareStep` unit — correct `activeTools`; stall-fallback after N steps returns
  `undefined`; throw → `{}`.
- **Flag OFF regression** — `prepareLlmInvocation` produces byte-identical
  `tools` and no `prepareStep` (snapshot vs current behavior). Critical guard.

### B

- `tool-retriever.test.ts` — inject a fake `embed` (DI like `EmbeddingsDeps`):
  embedding path ranks by cosine; `embedding_model` unset → lexical; embed throws
  → lexical; brief-embedding cache hits on second call (`embed` called once per
  brief).
- Lexical ranker — deterministic ordering for token overlap; empty query → `[]`.

### F

- `compaction/summarizer.test.ts` — inject fake model: query-aware prompt
  includes tool name + input; model failure → truncation fallback.
- `result-store.test.ts` — put/get/expire; LRU bound; TTL.
- `wrap-tool-execution.test.ts` (extend) — under threshold untouched; over →
  envelope shape; `ToolFailureResult` passes through uncompacted; already-
  `_compacted` not re-compacted; non-serializable untouched.
- `expand-result` — paging windows, `done` flag; missing handle →
  `ToolFailureResult` `errorCode: 'expired'`.

### Integration

- `tests/llm-orchestrator-disclosure.test.ts` — DI a scripted `generateText`
  driving steps (`search_tools` → `load_tool` → use → large result → compaction →
  `expand_result`); assert `activeTools` widens across steps and the large result
  is compacted (mirrors §6).
- Permission interaction — `deny` tool absent from briefs and rejected by
  `load_tool`; `ask` tool still gates after load.
- Proactive path honors the flag.

### Non-functional

- Token-savings assertion: serialized step-0 tool-schema bytes ON ≪ OFF (guards
  against accidental eager-loading regressions).
- Mutation testing (`bun test:mutate:file`) on registry, retriever ranking, and
  size-gate — the pure-logic cores.

## 9. Rollout

1. Land all three units behind flags, default OFF (byte-identical to today).
2. Enable `result_compaction` first on a test context (lowest behavior-change
   risk); measure `compaction:applied` rates and result-token reduction.
3. Enable `progressive_disclosure` (+ `semantic_tool_retrieval` when an embedding
   model is present) on the same test context; measure step-0 schema bytes,
   `disclosure:fallback` rate, and task success.
4. Widen per-context as metrics hold; the global default flips only after a
   measurement window. Global kill switch disables instantly.

## 10. Open questions (resolve during planning)

- Exact byte thresholds: compaction size-gate trigger, `search_tools` brief
  count (default 8), `expand_result` page size, result-store LRU size + TTL,
  `DISCLOSURE_STALL_STEPS` (default 2). Pick conservative defaults; expose as
  constants first, admin-tunable only if needed.
- Storage location for the global flag (a new `system_config` entry vs a small
  dedicated table) — decide against the existing migration conventions.
- Whether `userIntent` for the summarizer is the latest user message verbatim or
  a trimmed form (privacy + token trade-off).

## 11. References

- Anthropic — Code execution with MCP (Nov 2025): definition + result token cost.
- RAG-MCP (arXiv 2505.03275): retrieval ranking, selection-accuracy at scale.
- Tool Attention / lazy schema loading (arXiv 2604.21816): the "tools tax".
- AI SDK v6 docs: `prepareStep`, `activeTools`, `filterActiveTools`.
- Existing code: `src/tools/index.ts`, `src/tools/wrap-tool-execution.ts`,
  `src/llm-orchestrator-invoke.ts`, `src/llm-orchestrator-tools.ts`,
  `src/embeddings.ts`, `src/tools/search-memos.ts`, `src/system-prompt.ts`,
  `src/tools/tool-metadata.ts`.
- `2026-06-03-providerless-task-tracker-fallback-design.md`: removal of the
  prior regex `tool-router.ts` heuristic.
