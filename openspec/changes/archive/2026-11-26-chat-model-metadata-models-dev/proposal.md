# chat-model-metadata-models-dev (rev 3 — resolved model settings shown in the settings UI)

## Capability

`llm-model-metadata` (new — `openspec/specs/` holds no archived corpus).

## Goal

Main and small LLM roles get zero per-model configuration today: `buildChatModel` (src/llm-model-builder.ts:42) builds an `@ai-sdk/openai-compatible` model with default settings regardless of the bound model, and papai's only model awareness is the hardcoded prefix table (`MODEL_CONTEXT_WINDOWS`, src/model-context.ts:9), which returns null for any model outside ~30 prefixes — disabling the token-ratio trim trigger and leaving `/context` without a ceiling.

Rev 1: load per-model facts (context window, output cap) from the models.dev catalogue (`https://models.dev/api.json`, the source opencode uses) and apply them automatically.
Rev 2: when the user's custom model/provider isn't in the catalogue, let the user declare which known models.dev provider+model it corresponds to (`baseProvider`/`baseModel` on the provider account).
Rev 3 (this revision, per the maintainer): **when the user selects a model/provider in the settings UI, the settings papai will apply must be shown right there** — context window, max output tokens, and where they came from — instead of the feedback loop living only in the `/context` chat command.

## Interpretation note (stated assumption)

"When user selects model/provider" is read as *at selection time, show what applies* — not *add a catalogue picker*. Base provider/model stay free-text inputs; the new preview validates them live. A catalogue autocomplete dropdown stays a non-goal (veto by /changes if a picker was intended).

## Design

### Carried over from rev 2 (unchanged)

- **new `src/models-dev/client.ts`** — catalogue reader following `opencode-agent/src/pricing.ts`: pinned `MODELS_DEV_URL`, 10s-bounded fetch, 60-min TTL, lenient Zod schemas with per-field `.catch` degradation, empty DB + warn on failure, in-memory snapshot with boot prewarm + background refresh, on-disk cache (`~/.cache/papai/models.json`).
- **new `src/models-dev/provider-id.ts` + `resolve.ts`** — provider-id inference (providerType 1:1 map for `openai|anthropic|google|openrouter|groq|ollama`; baseUrl-host map for `custom`) and the ref-coalescing precedence chain: explicit override (`baseProvider`/`baseModel` on `LlmProviderAccount`, src/llm-providers/types.ts:27) → inferred → prefix table → null.
- **Persistence** — two nullable columns on `llm_providers` (src/db/llm-providers-schema.ts), `baseProvider`/`baseModel` through store patch paths, BYOK blob-codec (additive, old blobs decode unchanged), admin + byok routes accept/echo them, `PublicProviderAccount` extended, optional `LLM_BASE_PROVIDER`/`LLM_BASE_MODEL` in src/llm-providers/env-bootstrap.ts, two optional fields on both provider forms.
- **Runtime application** — `resolveMaxTokens` (src/model-context.ts:54) consults the snapshot first, then prefix table, then null; `buildChatModel` wraps known models with `defaultSettingsMiddleware` (ai) sending `maxOutputTokens: limit.output`; unknown models unchanged.

### New in rev 3: settings preview at the selection point

**Single resolution engine.** `src/models-dev/resolve.ts` exports a pure `resolveModelMetadata({ providerType, baseUrl, baseProvider, baseModel, model })` → `{ providerId, modelId, contextWindow, maxOutputTokens, source: 'models-dev' | 'prefix-table' | 'none', via: 'override' | 'inferred' | null }`. Inputs are all public fields — no secrets in, no secrets out. The runtime resolver (src/llm-providers/resolver.ts) and the preview route both call this one function, so what the UI shows is exactly what the runtime applies; drift is structurally impossible.

**Preview endpoint.** new `src/debug/settings/llm-model-metadata-routes.ts`: `GET /settings/api/llm-model-metadata?providerType=&baseUrl=&baseProvider=&baseModel=&model=` → `settingsJson(200, { ...metadata, snapshotFetchedAt })`. Mounted in `src/debug/settings-api-router.ts` (alongside the providers routes at line 82 and byok at line 105). Authenticated settings principal required, same `authenticate` gate as every settings route; **no context scope and no admin guard** — it is a pure catalogue lookup over client-supplied public fields, and the BYOK/group forms are member-facing. It never fetches models.dev synchronously; it reads the in-memory/disk snapshot. Empty snapshot → `source: 'none'` + `snapshotFetchedAt: null` so the client can distinguish "catalogue unavailable" from "model unknown".

**Preview component.** new `client/settings/components/ModelMetadataHint.svelte` — one muted read-only line:
- catalogue hit: `models.dev · gpt-4o · ctx 128k · max out 16,384` (plus `via override` marker when `via === 'override'`);
- miss with prefix-table fallback: `not in catalogue · prefix guess ctx 128k`;
- miss without fallback: `no limits known`;
- `snapshotFetchedAt === null`: `catalogue unavailable`.

Debounced (~300 ms) fetch keyed on its inputs, superseded requests aborted, per-key result cache. Follows existing component conventions (`SettingsFieldShell`-style sizing, `data-testid` props).

**Wiring.**
- `client/settings/components/RoleBindingBlock.svelte` — render the hint under the model Combobox whenever a provider is selected and the model field is non-empty. Inputs are the `PublicProviderAccount` the component already receives (which rev 2 extends with `baseProvider`/`baseModel`) plus the typed/selected model name. Because the block is shared, the admin models section (`AdminModelsSection.svelte`), BYOK (`ByokSection.svelte`), and group surfaces get the preview for free — covering every place a user selects provider+model.
- `client/settings/components/ProviderForm.svelte` — render the hint under the `baseProvider`/`baseModel` fields, resolving `baseProvider ?? inferred(providerType, baseUrl)` + `baseModel`; the user sees the catalogue entry they are pointing at (ctx/output) before saving, so a mistyped id is visible immediately.
- `client/settings/fetcher-schemas-llm-providers.ts` — `LlmModelMetadataResponseSchema` + a GET fetcher next to the existing schemas; the BYOK provider fetchers need no change (the endpoint is context-independent).

## Files

- new `src/debug/settings/llm-model-metadata-routes.ts` (preview endpoint); `src/debug/settings-api-router.ts` (mount).
- new `client/settings/components/ModelMetadataHint.svelte`; `client/settings/components/RoleBindingBlock.svelte`; `client/settings/components/ProviderForm.svelte`; `client/settings/fetcher-schemas-llm-providers.ts`.
- rev 2 set: new `src/models-dev/client.ts` / `provider-id.ts` / `resolve.ts`; `src/llm-providers/types.ts` + `store.ts` + `resolver.ts`; `src/db/llm-providers-schema.ts`; `src/byok-llm/blob-codec.ts`; `src/debug/settings/admin/llm-providers-routes.ts`; `src/debug/settings/byok-routes.ts`; `src/llm-providers/env-bootstrap.ts`; `src/model-context.ts`; `src/llm-model-builder.ts`; `client/settings/sections/admin/AdminProvidersSection.svelte`; `client/settings/sections/ByokSection.svelte`; `client/settings/byok-provider-fetchers.ts`; tests + docs (`docs/architecture/environment.md`, `docs/architecture/behaviors.md`).

## Intended behaviour change

- Models absent from the hardcoded prefix table now get a real context window → the token-budget trim trigger fires for them and `/context` displays a ceiling.
- Generation calls carry the catalogue's output cap when known; unchanged for unknown models.
- A user with a custom gateway/model can set base provider+model on the provider account and the bound roles borrow that entry's limits.
- **New:** selecting a provider+model in any settings surface shows inline the settings that will apply (context window, max output, source badge), updating live; entering base refs on a provider form previews the resolved catalogue entry before save.
- models.dev becomes a best-effort outbound host: 10s timeout, disk-cached, offline-safe fallback to the prefix table. The preview endpoint adds no outbound calls.

## Non-goals

- Per-model temperature / reasoning-effort, tool-gating from `tool_call`.
- Per-role-binding overrides (provider-level only; two provider accounts cover multi-model gateways).
- Catalogue autocomplete dropdown / model-browser UI (free text + live preview instead).
- Any change to embedding-role behavior or the BYOK encryption scheme.
- The endpoint returning or accepting anything sensitive; no new auth surface beyond the standard settings gate.

## Verification

- `bun run test tests/models-dev/ tests/debug/settings/ tests/client/settings/` — new route tests: auth required, precedence override > inferred > prefix > none, empty-snapshot → `source: 'none'` + `snapshotFetchedAt: null`, no outbound fetch during preview; schema tests for `LlmModelMetadataResponseSchema`.
- Storybook story for `ModelMetadataHint` covering the three states (catalogue hit / prefix fallback / unavailable) feeding the screenshot lane.
- Affected suites (model-context, conversation/context-collector, llm-providers store + resolver, byok blob-codec, settings routes, env-bootstrap) — hermetic via injected fetch; tests never reach models.dev.
- Full `bun run test` and `bun check:full` before finishing.
