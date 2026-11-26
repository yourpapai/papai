<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See `proposal.md` — Goal and Research findings (SDK passthrough, provider vocabularies, models.dev `reasoning_options` shape); requirements live in `specs/llm-reasoning-effort/spec.md`. Current state that shapes the approach:

- The models.dev snapshot client parses only `limit` today, per-field tolerantly (`z.number().optional().catch(undefined)`, src/models-dev/client.ts:33-40); `resolveModelMetadata` returns `ModelMetadata` (src/models-dev/resolve.ts:36-43) and already has an ambiguous-name agreement rule — trust the catalogue only when every provider carrying the id agrees (resolve.ts:102-110). Snapshot refresh is TTL-based (1 h) with a prewarm at boot, so stale-but-parseable caches self-heal.
- AI-output settings are plain strings read via `getCachedConfig(configContextId, key)` and parsed in src/ai-output-settings.ts:23-35 — all keyed by the **config context id** (group-shared). The settings UI fields are static constants in `AI_OUTPUT_FIELDS` (src/config-keys.ts:50-103); GET and PATCH both flow through `getConfigFieldsForContext` (src/debug/settings/config-routes.ts:36, 69) and select values are validated against `field.options` (src/config-editor/validation.ts:36-39 → 422 with the allowed list; empty value always allowed).
- `buildChatModel` (src/llm-model-builder.ts:43-57) wraps with `defaultSettingsMiddleware` only when a max-output cap is known; the provider instance is created with `name: 'openai-compatible'` (line 34). The installed AI SDK maps `providerOptions['openai-compatible' | 'openaiCompatible'].reasoningEffort` (any string, `z.string().optional()`) to the `reasoning_effort` body key — verified in node_modules/@ai-sdk/openai-compatible (chat/openai-compatible-chat-language-model-options.ts:15, openai-compatible-chat-language-model.ts:300-312, docs/index.mdx:543).
- Main-role model seams: the orchestrator builds via `LlmOrchestratorDeps.buildModel(config: EffectiveLlmConfig)` (src/llm-orchestrator-types.ts:24, default impl src/llm-orchestrator.ts:51) inside `callLlm`, which has `configId` and `resolvedLlm.main.metadata` at hand; proactive builds via `ProactiveLlmDeps.buildModel(config, modelId, metadata)` (src/deferred-prompts/proactive-llm.ts:48-61, 191) with `configContextId` and `config.metadata` (= main metadata, proactive-llm-config.ts:46-51) in scope. The turn verifier (src/llm-orchestrator-support.ts:186-208) and proactive verification (proactive-llm-helpers `buildProactiveVerification`, called with the same model at proactive-llm.ts:171) reuse the generation model instance, so anything baked into the model propagates.
- `resolveLlmConfig(configContextId)` (src/llm-providers/resolver.ts:82) is synchronous, BYOK-aware, and reads only cached BYOK bundles + in-memory admin role bindings — the exact resolution the orchestrator uses at turn time.

## Goals / Non-Goals

**Goals:**

- One derivation source for the effort value set, consumed by the UI option list, PATCH validation, and the request gate, so the offered set and the sent set cannot disagree.
- Tolerant catalogue ingestion: shape drift degrades to the union fallback, never breaks parse or blocks a turn.
- Byte-identical requests until a level is effective; additive, DI-preserving seam changes (optional trailing params keep existing deps implementations assignable, including the stories-compat `buildModel` seam).

**Non-Goals:**

- **No new tool surface.** Nothing enters the chat toolset: capability gating, `tool_prefs` resolution (allow/ask/deny), confirmations, and the guest-mode read-only toolset are untouched.
- **No DB changes.** No drizzle migration and no backfill: the setting is one more string key in the existing per-config-context config store; an absent key is the unset state.
- **No new dependency.** The AI SDK already passes `reasoningEffort` through for openai-compatible providers; Zod covers the tolerant parse; nothing else is needed.
- **No auxiliary-path wiring.** Embeddings and the other `buildChatModel` call sites (long-term-memory capture/promotion/runner, tools/compaction summarizer, context-vault summarizer, web distill, announcements humanize, lookup-group-history) keep provider defaults; no new latency metrics (existing `durationMs`/`timeToFirstTokenMs` traces suffice); no chat-command surface (settings UI only); no per-user or per-thread effort.

## Decisions

### D1: One pure helper owns the value set — `src/models-dev/effort-levels.ts`

`effortLevelsFor(metadata)`, the union constant (`none, minimal, low, medium, high, xhigh, max`, effort-ascending), and set membership live in one small pure module over `ModelMetadata`: catalogue effort entry present and non-empty → those values verbatim in catalogue order; `reasoning === false` → empty set; otherwise → union.

Why a new module: nothing existing derives effort levels — `resolve.ts` owns metadata *resolution* (snapshot lookup, precedence, ambiguity) and `ai-output-settings.ts` owns *parsing* ai-output values; the derivation must be importable by both without pulling in the snapshot singleton or the config cache, and it must be trivially unit-testable. Alternatives: duplicating the derivation in config-keys and the gate (rejected — the offered and sent sets can drift, the exact failure revision 2 exists to prevent), or putting it in `resolve.ts` (rejected — conflates catalogue facts with resolution and grows an already-shaped module).

### D2: Tolerant catalogue ingestion, additive metadata fields

Extend the parse schema in the file's existing style: `reasoning: z.boolean().optional().catch(undefined)` and `reasoning_options` parsed as `{kind, values}` entries where `values` keeps only strings and drops null entries; `kind: 'budget'` entries are ignored. Thread into `ModelMetadata` as optional additive fields `reasoning?: boolean | null` and `effortLevels?: readonly string[] | null`, so every existing `ModelMetadata` literal stays valid. The ambiguous-name tie-break mirrors the context-window agreement rule (resolve.ts:102-110): levels are kept only when every provider carrying the id agrees on the list, else `null`.

Why tolerant per-field rather than strict entry-level schemas: a strict parse that drops a model entry on shape drift would also lose that model's known context window and output cap — a regression far beyond this setting. Alternative rejected: renaming/migrating the on-disk cache — unnecessary, since old cached snapshots simply parse the new fields as unknown and yield the union fallback until the next TTL refresh (≤ 1 h) or boot prewarm.

### D3: Options resolved per active model inside `getConfigFieldsForContext`

The `ai_reasoning_effort` field's `options` are decorated at field-assembly time using the synchronous `resolveLlmConfig(configContextId)` — the same resolution the orchestrator uses at turn time, so a BYOK context sees the levels of *its* active model. Unresolved/unconfigured provider → union fallback (permissive; the experiment target must never be locked out). Empty level set → the default-only option (the control is effectively hidden in place for non-reasoning models). Decoration clones the effort field only — the other `AI_OUTPUT_FIELDS` entries are returned as the shared constants (no mutation of module state).

Because GET (config-routes.ts:36) and PATCH (config-routes.ts:69-90) both consume `getConfigFieldsForContext`, and `validateConfigField` already checks select values against `field.options`, the derived set governs validation with **no new validation code**: a clearly invalid value → 422 listing the allowed values; empty/`default` always acceptable; the stored value remains a free string. Alternative: resolving options client-side via the metadata lookup endpoint — rejected, it creates a second resolution path that can disagree with turn time.

### D4: Free-string storage, parse-to-null gate, config-context scope

`ai_reasoning_effort` joins `AiOutputConfigKey`/`ALL_CONFIG_KEYS` (src/types/config.ts) and `AI_OUTPUT_FIELDS` (`control: 'select'`). Unlike the existing ai-output parsers that coerce unknown values to a default level, the new parser in src/ai-output-settings.ts maps `default`/empty/unknown → `null` ("not sent") — coercion would silently send a level the owner did not pick. The request gate `resolveEffectiveReasoningEffort(configContextId, metadata)` sits on the pure helper: stored value ∈ `effortLevelsFor(metadata)` → that value, else `null`.

Scope model impact: the only new persisted state is this one config key, keyed by the **config context id** exclusively (group-shared across the group's threads, platform-instance- and user-independent, like every other ai-output key). It is a non-secret preference; BYOK credentials consulted during option resolution never enter the stored value or any payload/log.

### D5: Effort baked into the model at build time; two seams extended

`buildChatModel` gains an optional trailing `reasoningEffort?: string | null` param after `metadata`; when a level is effective it wraps with `defaultSettingsMiddleware` merging `providerOptions: { openaiCompatible: { reasoningEffort } }` alongside `maxOutputTokens` (single wrap — the wrap condition becomes "cap or effort present", so a capless model with an effort still gets the middleware and both settings coexist in one request). Baking into the model — rather than per-call `generateText` options — is what makes the verification pass inherit for free: the verifier reuses the generation model instance (llm-orchestrator-support.ts:186, proactive-llm.ts:171), and `wrapModelForTtft` re-wraps the same instance without touching analytics. Alternative (pass `providerOptions` per `generateText` call) rejected: it would touch every generation call site including both verifiers, with no benefit.

Seam changes stay minimal and optional-trailing: `LlmOrchestratorDeps.buildModel` (llm-orchestrator-types.ts:24) and `ProactiveLlmDeps.buildModel` (proactive-llm.ts:51) each gain an optional trailing effort argument; `callLlm` and `runFullGeneration` resolve it via the gate (both have `configContextId` + main metadata in scope). **`ConversationDeps.buildModel` is deliberately not extended**: its only call site is the background working-memory trim (src/conversation.ts:131, small role) — an auxiliary path, not a main user turn, verification pass, or proactive/deferred execution; its default impl forwards to `buildChatModel` positionally and remains valid unchanged. The optional trailing param also keeps the seam assignable for story-contract tests (`bun test:stories:contracts` gates this shape).

### D6: UI hint plus display-only fallback

`AiOutputSection.svelte` gains one hint line (same pattern as the existing `ai_output_detail_level` hint, keyed on `field.key`) and extends the `visible` derived: a stored value no longer among the returned options displays as the first option ("Provider default"). Display-only — the stored string is never rewritten on read; the gate (nothing sent) and PATCH validation (current-model options) carry the effect. Alternative (silently unsetting an out-of-options value) rejected: it destroys the owner's stored choice without consent.

## Risks / Trade-offs

- [models.dev changes the `reasoning_options` shape] → per-field tolerant parse (`optional().catch(undefined)`, string-filtered values) degrades to the union fallback; parse stays green and the TTL refresh self-heals — mirrors the file's existing drift posture.
- [Provider rejects an unsupported *value* with a 400 for a catalogue-unknown model] → accepted residual, stated in the proposal: the owner's experiment fails visibly through the standard request-failure path; catalogue-known models cannot hit it because only catalogue-listed values are offered, accepted, and sent.
- [Stored value invalidated by a model switch] → gate degrades to "not sent" (never a turn failure) and the UI displays the default; the string is preserved so switching back restores the choice.
- [Options/validation are now context- and model-dependent] → PATCH validates against the *current* active model's set and rejects with the allowed list; clearing always works; the request gate re-checks at send time, so a set edited against a stale model cannot send an out-of-set value.
- [`getConfigFieldsForContext` now resolves LLM config per call] → synchronous, cached, in-memory reads (BYOK bundle + admin bindings), once per GET/PATCH — negligible; it already happens at every turn.
- [New `src/` file enters the mutation ratchet] → `src/models-dev/effort-levels.ts` is pure with a small decision surface; the TDD matrix below (catalogue levels / `reasoning:false` → empty / unknown → union / membership) gives it real kill power for the per-file floor seeded from this PR.

## Migration Plan

No DB migration or backfill: the key lives in the existing config-context store and is inert until the owner saves a level; deploy is a single small MR. Cached snapshots without the new fields keep working (union fallback) until the first TTL refresh. Rollback: revert the MR — the gate disappears, so a stored level simply stops being sent; the orphaned string stays in config storage harmless (unknown to the UI and to `isAllowedDynamicConfigKey`), no cleanup step.

## TDD / hook interactions

The Write/Edit TDD hook gates every file below; the new `src/models-dev/effort-levels.ts` is a product file the mutation ratchet will floor. Red-first order:

1. `tests/models-dev/` — tolerant parse of `reasoning`/`reasoning_options` (effort kind kept, null entries dropped, budget kind ignored, malformed → unknown); ambiguity disagreement → `null`; then `tests/models-dev/effort-levels.test.ts` for the `effortLevelsFor` matrix.
2. `tests/ai-output-settings.test.ts` — free-string parse (`default`/empty/unknown → null) and the gate (in-set → value; out-of-set after model change → null).
3. `tests/config-keys.test.ts` — per-model option decoration (catalogue levels / union fallback / default-only / unconfigured provider).
4. Config-routes tests — GET exposes derived options; PATCH accepts a union value for an unknown model, rejects an invalid value with 422 listing the allowed set, unsetting works.
5. `tests/llm-model-builder.test.ts` — request-body captures via `setMockFetch`: set + in-set → body has `reasoning_effort`; unset → byte-identical body; `reasoning: false` + set → key absent; stored value outside catalogue levels → absent; effort + maxOutputTokens coexist.
6. `tests/llm-orchestrator.test.ts` + `tests/deferred-prompts/proactive-llm.test.ts` — `buildModel` spy asserts the effort arg; unset → not passed; verifier inherits.
7. `tests/client/settings/sections/AiOutputSection.test.ts` — new select renders; unknown stored value displays the default.

`bun run test:affected` in the loop; full `bun run test`, `bun check:full`, and `bun test:stories:contracts` before finishing (proposal Gates).

## Open Questions

None. The one maintainer-veto candidate (union values sent verbatim for catalogue-unknown models) is accepted in the proposal as a stated residual risk, and the conversation.ts trim-path exclusion (D5) is pinned here per the spec's exhaustive send surfaces.
