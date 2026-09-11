# reasoning-effort-setting — revision 2 (option-set redesign per maintainer review)

## Goal

Unchanged from revision 1: let the owner control LLM reasoning effort from the settings UI to trade response quality for latency on reasoning-capable models, with zero behavior change until they touch the control. Revision 2 replaces the hardcoded 'Provider default / low / medium / high' set with a **researched, catalogue-derived set** (union fallback for unknown models), per the maintainer's /changes review on #437.

## Research findings (the offered set is now evidence-based)

**SDK passthrough (verified in-repo):** `@ai-sdk/openai-compatible` declares `reasoningEffort: z.string().optional()` (node_modules/@ai-sdk/openai-compatible/src/chat/openai-compatible-chat-language-model-options.ts:15) and writes it to the request body as `reasoning_effort` (openai-compatible-chat-language-model.ts:310-312). Any string passes through — so the stored value stays a free string at the SDK layer and new provider-specific levels remain additive (revision 1 promise kept).

**Provider vocabularies (documented):**

| Value | Provenance |
|---|---|
| `none` | OpenAI API (openai-python generated shared type: none, minimal, low, medium, high, xhigh); gateway-neutral ladders |
| `minimal` | OpenAI GPT-5 / o-series |
| `low` / `medium` / `high` | universal (OpenAI, xAI grok-3-mini, HF-router gpt-oss, gateways) |
| `xhigh` | OpenAI gpt-5.1-codex-max / gpt-5.2+ |
| `max` | provider-neutral gateway ladders (ModelRelay ladder none→…→xhigh→max; OrcaRouter 'max on some models'); Anthropic-family subsets expose max via such gateways. NOT an OpenAI-API value |

Fallback union (order = effort ascending): `none, minimal, low, medium, high, xhigh, max`.

**models.dev catalogue (derivation source, resolves the 'ideally derived per model' ask):** v1 `api.json` model entries carry `reasoning: boolean` **and** `reasoning_options: [{kind, values, min}]` — confirmed by independent parsers of api.json (oxi-ai `MdModel`/`MdReasoningOption`; hrdr-llm `lookup_effort_levels`: 'the reasoning-effort levels the model accepts, from the catalog's reasoning_options ({type: effort, values: […]}) entries; values in catalog order, lowest effort first; the configured provider's entry wins, else the first provider serving the model id'). So per-model derivation IS possible for models the catalogue knows. `kind: 'budget'` entries (token-budget knobs, not effort strings) are deliberately ignored — `reasoning_effort` is a string param. papai's snapshot client (src/models-dev/client.ts) currently parses only `limit`; revision 1 already planned extending the parse schema — revision 2 extends it with these two fields, tolerantly (`.optional().catch(undefined)`, matching the file's existing style), so catalogue shape drift degrades to the fallback instead of breaking parse.

## Design

**Single source of truth:** a small pure helper, `src/models-dev/effort-levels.ts`, turns `ModelMetadata` into the effective value set. The UI option list, PATCH validation and the request gate all consume it, so the offered set and the sent set can never disagree.

1. **Catalogue layer** — `src/models-dev/client.ts` (parse `reasoning`, `reasoning_options` with tolerant schemas; drop null entries inside `values`; keep only string values) and `src/models-dev/resolve.ts` (thread into `ModelMetadata` as optional additive fields `reasoning?: boolean | null` and `effortLevels?: readonly string[] | null`, so existing `ModelMetadata` literals stay valid). Ambiguous model-name tie-break mirrors the existing context-window agreement rule (src/models-dev/resolve.ts:102-110): levels are kept only when every provider carrying the id agrees on the list; otherwise null. Old cached snapshots without the fields parse as unknown → union fallback until the next TTL refresh.
2. **Value-set derivation** — `effortLevelsFor(metadata)`: catalogue effort entry present and non-empty → those values verbatim in catalogue order; else `reasoning === false` → empty set; else (no/ambiguous catalogue entry) → the researched union. `hf:` models and custom gateways are the experiment target and always get the full union — never locked out.
3. **Config key + UI** — `ai_reasoning_effort` in `AiOutputConfigKey` + `ALL_CONFIG_KEYS` (src/types/config.ts) and an `AI_OUTPUT_FIELDS` entry (src/config-keys.ts, `control: 'select'`). Options are **resolved per active model** by decorating the field inside `getConfigFieldsForContext` using the synchronous `resolveLlmConfig(configContextId)` (src/llm-providers/resolver.ts:82) — the same resolution the orchestrator uses at turn time, BYOK-aware, returning `main.metadata`: options = `[{value: 'default', label: 'Provider default'}, ...levels]`; empty level set → default-only option (control effectively hidden-in-place for non-reasoning models, per the issue's 'hide the control or send nothing'). Missing/unconfigured provider → union fallback (permissive). The Svelte section (`client/settings/sections/AiOutputSection.svelte` via `ConfigFieldRow`) renders options unchanged; add one hint line and one guard: a stored value no longer among the options falls back to displaying the default (extension of the existing ''-mapping in the `visible` derived).
4. **PATCH validation** — `src/debug/settings/config-routes.ts` uses `getConfigFieldsForContext` for BOTH GET and PATCH, and `validateConfigField` (src/config-editor/validation.ts:36) checks select values against `field.options` — so the derived set automatically governs validation: a clearly invalid value → 422 with the allowed list; unset (empty value) remains allowed. Stored value remains a free string (forward-compatible with new provider-specific levels).
5. **Request wiring** (unchanged where revision 1 was already reviewed): `buildChatModel` (src/llm-model-builder.ts:43) gains an optional trailing effort param; when a level is effective it injects `providerOptions: { openaiCompatible: { reasoningEffort } }` through the existing `defaultSettingsMiddleware` wrap (merged with maxOutputTokens). Orchestrator `callLlm` (deps.buildModel at src/llm-orchestrator.ts:51, already receives `config.main.metadata`) and proactive `runFullGeneration` (src/deferred-prompts/proactive-llm.ts) read `resolveEffectiveReasoningEffort(configContextId, metadata)` (in src/ai-output-settings.ts, on top of the pure helper): the stored value must be in the model's current value set, else null → nothing sent. Consequences: stale stored values after a model switch degrade to 'not sent' (never a 400); catalog-known models only ever receive catalogue-listed values; unknown models receive the union value verbatim. Verifiers reuse the generation model instance (`buildTurnVerifier` src/llm-orchestrator-support.ts:186, `buildProactiveVerification` src/deferred-prompts/proactive-llm-helpers.ts:35), so the baked providerOptions apply to the verification pass automatically; `wrapModelForTtft` re-wraps the same model, analytics unaffected.

**Residual risk (stated for the MR description, maintainer may veto):** for models absent from the catalogue a chosen value is sent verbatim — a provider may reject an unsupported *value* with a 400; that is the owner's experiment failing visibly, not a regression. The issue's 'never 400' contract is met for the *parameter* (catalogue `reasoning: false` → nothing sent; unset → nothing sent).

## Files to touch

- `src/models-dev/client.ts` — parse `reasoning` + `reasoning_options` (tolerant).
- `src/models-dev/resolve.ts` — thread into `ModelMetadata` (additive optional fields, ambiguity rule).
- `src/models-dev/effort-levels.ts` (new, pure) — `effortLevelsFor(metadata)`, the union constant, set membership.
- `src/types/config.ts` — `ai_reasoning_effort` key.
- `src/ai-output-settings.ts` — key constant, free-string parse (`'default'`/empty/invalid → null), `resolveEffectiveReasoningEffort(contextId, metadata)`.
- `src/config-keys.ts` — field entry + per-model option decoration via `resolveLlmConfig`.
- `src/llm-model-builder.ts` — optional effort param + middleware providerOptions.
- `src/llm-orchestrator-types.ts` + `src/llm-orchestrator.ts` + `src/conversation.ts` — pass-through of the optional effort arg on the main-turn seam.
- `src/deferred-prompts/proactive-llm.ts` — same for proactive/deferred executions.
- `client/settings/sections/AiOutputSection.svelte` — hint line + unknown-stored-value display fallback.
- Optional: one bullet in `docs/architecture/behaviors.md`.

## Intended behaviour change

- Until the owner changes the setting: requests byte-identical to today (unset / 'default' / invalid stored value → no `reasoning_effort` key).
- Setting a level sends it on main user turns, the verification pass, and proactive/deferred executions for the config context (group-shared, like the other ai-output keys).
- Catalogue-known models: only catalogue-listed levels offered/accepted/sent; catalogue `reasoning: false` → default-only control, nothing sent.
- Unknown models (the `hf:` experiment target): full researched union `none/minimal/low/medium/high/xhigh/max`.
- Keep provider defaults (stated in MR description): embeddings; auxiliary LLM paths that build their own models via other `buildChatModel` call sites (long-term-memory capture/promotion/runner, compaction summarizer, context-vault summarizer, web distill, announcements humanize, lookup-group-history).
- Latency evaluation: existing traces already record turnaround (`emitLlmStart/emitLlmEnd` → `llm_usage_events.durationMs`; `wrapModelForTtft` → `timeToFirstTokenMs`) — confirmed, no new metrics.

## Verification

- `tests/models-dev/` — tolerant parse of `reasoning`/`reasoning_options` (effort kind, null entries dropped, budget kind ignored, malformed → unknown); ambiguity disagreement → null; `effortLevelsFor` matrix (catalogue levels / reasoning:false → empty / unknown → union).
- `tests/ai-output-settings.test.ts` — free-string parse; `'default'`/empty/invalid → null; `resolveEffectiveReasoningEffort` gate (in-set → value; out-of-set after model change → null).
- `tests/config-keys.test.ts` — per-model option decoration (catalogue levels / union fallback / default-only / unconfigured provider).
- config-routes tests — GET exposes derived options; PATCH accepts a union value for an unknown model, rejects a clearly invalid value with 422 listing the allowed set; unset works.
- `tests/llm-model-builder.test.ts` request-body captures via `setMockFetch`: set + in-set → body has `reasoning_effort`; unset → body byte-identical to today; catalogue `reasoning: false` + set → key absent; stored value outside catalogue levels → absent; effort + maxOutputTokens coexist in one request.
- `tests/llm-orchestrator.test.ts` + `tests/deferred-prompts/proactive-llm.test.ts` — buildModel spy asserts the effort arg for the context; unset → not passed; verifier inherits.
- `tests/client/settings/sections/AiOutputSection.test.ts` — new select renders; unknown stored value displays default.

## Gates

`bun run test:affected` in the loop; full `bun run test`, `bun check:full`, and `bun test:stories:contracts` (buildModel seam shape is a stories-compat DI point; the optional param keeps it assignable) green before finishing. One small MR, no refactors outside the listed files.
