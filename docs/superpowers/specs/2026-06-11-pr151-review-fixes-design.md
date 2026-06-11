<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# PR #151 Review-Fix Batch — Design

Date: 2026-06-11
Branch: `context-pollution` (PR #151)
Source: 10 inline review comments by wKich (2026-06-10), all verified against the codebase before this design.

## Scope

Fix the 9 valid findings plus one adjacent gap; one finding is wontfix; one reviewer premise is corrected but its suggestion adopted as hardening.

| #   | Comment id | Verdict                                                                                                                                     | Action                                                                                                                                                                    |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 3390308281 | Verified (refined: handles from recent normal turns can still resolve, so "every call fails" is overstated; gap is real)                    | Gate `expand_result` off in proactive mode                                                                                                                                |
| 2   | 3390308398 | Verified                                                                                                                                    | True LRU + neutral failure wording                                                                                                                                        |
| 3   | 3390308529 | Verified                                                                                                                                    | BYOK-aware retriever + usage recording                                                                                                                                    |
| 4   | 3390308644 | Verified (refined: only `search_tools`/`load_tool` bypass prefs; `expand_result` goes through `applyToolPreferences`)                       | Exclude injected meta-tools from ask line                                                                                                                                 |
| 5   | 3390308784 | Premise incorrect — `tryGetEmbedding` never rejects (`src/embeddings.ts:134-139`), so the throwing path is unreachable in production wiring | Adopt try/catch→null as hardening only, alongside #3                                                                                                                      |
| 6   | 3390308909 | Verified                                                                                                                                    | Use SDK `toolCallId` in failure result                                                                                                                                    |
| 7   | 3390309030 | Verified gap                                                                                                                                | Meta-only-churn secondary stall guard                                                                                                                                     |
| 8   | 3390309153 | Verified                                                                                                                                    | Shared memoized model builder, all 3 callsites; plus summarizer per-context BYOK config (adjacent gap, same class as #3)                                                  |
| 9   | 3390309269 | Verified                                                                                                                                    | Pass `enabled` into `maybeApplyDisclosure`                                                                                                                                |
| 10  | 3390309410 | Verified by reproduction; cosmetic                                                                                                          | Wontfix (YAGNI). A general lookbehind fix would swallow sentence ends after short words; an abbreviation allowlist is not warranted while no real description is affected |

No threaded PR replies as part of this work (user decision).

## Fix Designs

### F1 (#6) — `expand_result` failure `toolCallId`

`src/tools/compaction/expand-result.ts`: `execute` accepts the SDK's second
parameter; the failure result's `toolCallId` becomes `opts?.toolCallId ?? ''`,
matching `wrapToolExecution` (`src/tools/wrap-tool-execution.ts:21`) and
`search_tools` (`src/tools/disclosure/search-tools.ts:47`). This restores the
join between `tool:failure_classified` and `tool:execute_end` events.

### F2 (#9) — Single flag snapshot per turn

`maybeApplyDisclosure(tools, contextId, retriever, { enabled })` — the caller
(`buildFullToolSet`, `src/llm-orchestrator-tools.ts`) passes
`flags.progressiveDisclosure` from its single `resolveReductionFlags` call;
`src/tools/disclosure/wire.ts` drops its own resolve. Mirrors
`applyResultCompaction`'s `enabled` option. One consistent flag snapshot per
turn; a mid-turn cache invalidation can no longer split compaction/disclosure
decisions.

### F3 (#2) — Result store true LRU + neutral message

`src/tools/compaction/result-store.ts`: `getResultPage` refreshes recency on
hit (`m.delete(handle)` then `m.set(handle, entry)`), so `putResult`'s
insertion-order eviction becomes true LRU and CLAUDE.md's "TTL/LRU" wording
becomes accurate. No tombstones: the store cannot distinguish evicted from
never-existed without extra state, and the agent's recovery action is identical.

`expand-result.ts` failure wording becomes neutral: `error` "Result handle not
found, expired, or evicted"; `agentMessage` keeps "re-run the original tool"
guidance without asserting expiry. `errorCode` stays `'expired'` for event
consumer stability.

### F4 (#4) — Ask line excludes post-preferences meta-tools

`src/tools/disclosure/core.ts` exports
`DISCLOSURE_INJECTED_TOOL_NAMES: ReadonlySet<string> = {'search_tools', 'load_tool'}`
(exactly the names injected after `applyToolPreferences`; **not**
`META_TOOL_NAMES`, which includes `expand_result`).
`buildAskToolsLine` (`src/system-prompt.ts:187`) filters these names out, so a
stored `ask` override on an injected meta-tool no longer produces a prompt
instruction that contradicts runtime behavior. `expand_result` stays listed
when overridden: it is part of the cached descriptors and its `ask` wrapper is
real. `buildUnavailableLine` needs no change — metadata-less names are already
skipped (verified at `src/system-prompt.ts:171-180`).

### F5 (#1) — Proactive mode does not register `expand_result`

`src/tools/provider-independent-tools-builder.ts:86` adds `mode === 'normal'`
to the registration condition. The proactive path
(`src/deferred-prompts/proactive-llm-full.ts`) never applies
`applyResultCompaction`/`maybeApplyDisclosure`, so new results are never
compacted there; registering the pager invites calls that fail misleadingly.
Precedent: deferred-prompt tools are already proactive-excluded in the same
builder. Trade-off accepted: proactive runs lose the ability to expand
envelopes left in history by recent normal turns; the envelope's own
`agentMessage` already instructs re-running the original tool. Proactive
compaction/disclosure parity is explicitly out of scope (no current need; the
flags are experimental and default OFF).

### F6 (#3 + #5 hardening) — BYOK-aware retriever with usage recording

`getToolRetriever(configContextId: string, callContext: EmbeddingCallContext)`
(`src/tools/disclosure/embedding-tool-retriever.ts`):

- Resolves credentials via `resolveEffectiveLlmConfig(configContextId)`
  (BYOK-aware); `!ok` → `LexicalToolRetriever`.
- `embed` delegates to `tryGetEmbedding(text, apiKey, baseUrl, embeddingModel, callContext)`
  so every embedding call is recorded in `llm_usage_events` with the correct
  context attribution.
- Brief-cache map key becomes `` `${llmBaseUrl}:${embeddingModel}` `` to prevent
  cross-endpoint vector mixing when two BYOK endpoints serve the same model
  name with equal dimensions.
- Caller (`buildFullToolSet`) passes
  `getConfigContextIdFromStorageContextId(contextId)` and
  `{ storageContextId: contextId, contextType, chatUserId }` — all in scope.
  `ContextType` is structurally identical between `src/chat/types.ts` and
  `src/usage/types.ts` (`'dm' | 'group'`).
- Hardening (#5): both `deps.embed` call sites inside `EmbeddingToolRetriever`
  (`rank` and `embedBrief`) wrap in try/catch → treat-as-null, so a rejecting
  injected `embed` implementation degrades to the lexical fallback instead of
  surfacing as a non-retryable `search_tools` failure. Not a live bug today:
  `tryGetEmbedding` and `getEmbeddingForContext` never reject.

Accepted behavior change: `resolveEffectiveLlmConfig` falls back
`embeddingModel → mainModel` when unset, so "no embedding model configured" no
longer short-circuits to lexical at construction; instead the embed call fails
per search (null) and lexical kicks in per call. This matches
`getEmbeddingForContext` semantics used by memo search; consistency over
micro-optimization, and `semantic_tool_retrieval` is experimental opt-in.

### F7 (#8 + summarizer BYOK) — Shared memoized model builder

New `src/llm-model-builder.ts`:

- Provider cache: `Map` keyed `` `${apiKey}:${baseUrl}` `` over
  `createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL, fetch: fetchWithoutTimeout })`;
  capped at 32 entries with oldest-entry eviction, since BYOK alternates keys
  and a single-entry cache would thrash.
- `buildChatModel(apiKey: string, baseUrl: string, modelName: string): LanguageModel`.

Adopted by all three duplicated callsites:

- `src/tools/compaction/summarizer.ts` — also fixes the dropped
  `fetchWithoutTimeout` and per-call provider reconstruction.
- `src/conversation.ts` `buildModel` (DI default impl delegates).
- `src/llm-orchestrator.ts` `buildOpenAI` (DI seam kept; default impl delegates).

Summarizer BYOK: `summarizeResult`'s default deps no longer hardcode
`resolveEffectiveLlmConfig('global')`. `applyResultCompaction`
(`src/tools/compaction/wrap-compaction.ts`) builds summarizer deps **once per
turn** from `getConfigContextIdFromStorageContextId(storageContextId)` and
passes them down — per-context BYOK credentials, correct billing attribution,
no per-oversized-result reconstruction.

### F8 (#7) — Secondary stall guard: meta-only churn

`src/tools/disclosure/prepare-step.ts`:

- Existing pre-load guard unchanged (`stepNumber >= DISCLOSURE_STALL_STEPS && !session.hasLoaded()`).
- Local `PrepareStepArg` gains `steps?: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName: string }> }>`
  (the AI SDK passes full `StepResult[]`; we type only what we read).
- New guard: if the last `DISCLOSURE_STALL_STEPS` completed steps each made
  ≥1 tool call and every call was in `DISCLOSURE_INJECTED_TOOL_NAMES`
  (`search_tools`/`load_tool`), return `{}` and emit the same one-shot
  `disclosure:fallback` event.

Rejected alternative: "steps without new loads" — false-positive trap, since
healthy turns load tools early and then work for many steps without loading
more. Meta-only churn cannot occur in a healthy turn (any real tool call
breaks the pattern; a step with zero tool calls ends the SDK loop).

## Commit / TDD Plan

One commit per finding, TDD (Red → Green → Refactor) per repo hook policy, in
order: F1 (#6) → F2 (#9) → F3 (#2) → F4 (#4) → F5 (#1) → F6 (#3+#5) → F7 (#8)
→ F8 (#7).

Key new tests:

- F1: executor invoked with `toolCallId` option → failure result carries it.
- F2: `maybeApplyDisclosure` honors passed `enabled` and does not re-resolve flags.
- F3: read-refreshed oldest entry survives overflow while a never-read newer
  entry is evicted; neutral wording asserted.
- F4: `toolOverrides['search_tools'] = 'ask'` → not listed in ask line;
  `toolOverrides['expand_result'] = 'ask'` → still listed.
- F5: proactive mode + compaction flag ON → no `expand_result`; normal mode → present.
- F6: BYOK context resolves per-context creds; `EmbeddingCallContext` reaches
  `tryGetEmbedding` (usage recorded); throwing injected `embed` → lexical
  fallback (both `rank` and `embedBrief` paths); cache keyed by baseUrl+model.
- F7: provider memoized across calls (identity); `fetchWithoutTimeout` wired;
  summarizer deps built once per turn; per-context config resolution.
- F8: post-load meta-only churn triggers fallback; post-load real-tool work
  never triggers; pre-load guard behavior unchanged.

## Documentation Updates

- Root `CLAUDE.md` + `src/tools/CLAUDE.md`: `expand_result` registration is
  flag ON **and** `mode === 'normal'`; stall guard description gains the
  meta-only-churn signal; "TTL/LRU" wording is now accurate.
- No event schema changes: `disclosure:*` events keep counts/lengths only;
  `errorCode 'expired'` retained.

## Out of Scope

- #10 first-sentence regex (wontfix, cosmetic).
- Proactive-path compaction/disclosure parity.
- Migrating `src/embeddings.ts`'s own provider cache to the new model builder
  (embedding provider, different call shape; revisit only if a fourth chat-model
  callsite appears).
