<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: chat-model-metadata-models-dev

## Context

`buildChatModel` (src/llm-model-builder.ts:42) builds an `@ai-sdk/openai-compatible` model with default settings for every model; papai's only model awareness is the hardcoded prefix table `MODEL_CONTEXT_WINDOWS` (src/model-context.ts:9), consumed name-only by `resolveMaxTokens(modelName)`. That name-only seam has exactly three consumers: the trim-trigger predicate (`exceedsTokenBudget` in src/conversation.ts:87, called from src/llm-history.ts:52 and src/deferred-prompts/proactive-llm-persist.ts:54) and `/context` (src/commands/context-collector.ts:224, whose deps expose `getMainModel()` — a name). Generation flows resolve credentials per role through `resolveLlmConfig` / `resolveAdminLlmConfig` (src/llm-providers/resolver.ts), which returns `ResolvedRole = { apiKey, baseUrl, model, source }` — no provider identity. Provider accounts live in two stores: global rows in `llm_providers` (admin, src/llm-providers/store.ts with an in-process cache) and per-config-context encrypted BYOK blobs (src/byok-llm/blob-codec.ts, `v: 2`, additive-legacy decode). Eleven call sites construct models via `buildChatModel(apiKey, baseUrl, modelName)`; every one of them already holds the resolved role in scope at the call.

The catalogue reader pattern to copy exists in `opencode-agent/src/pricing.ts` (pinned `MODELS_DEV_URL`, 10s-bounded fetch, 60-min TTL, lenient per-field `.catch` Zod schemas, on-disk cache) — but that workspace is a standalone spike, not a runtime dependency ("nothing under `src/` imports it", opencode-agent/CLAUDE.md), so the code is a model, not an import. Motivation and scope: see proposal.md; behavioral requirements: see specs/llm-model-metadata/spec.md.

## Goals / Non-Goals

**Goals:**

- One resolution engine, one precedence (override → inferred → prefix → none), shared by runtime and preview so the UI shows what the runtime applies.
- models.dev ingestion that can never block or fail a request, chat turn, or boot.
- Output-cap application at the single choke point every generation path already goes through (`buildChatModel`), with overrides honored.
- Preview rendered at every settings surface where provider+model is selected, including pre-save preview of base references on provider forms.

**Non-Goals:**

- Restating the proposal's scope exclusions (no per-model temperature/tool-gating, no per-role overrides, no catalogue picker UI, no BYOK encryption changes). Design-level exclusions: no change to the embedding-model builder path, no new npm dependencies, no new chat tools, no change to `/context`'s output format beyond the ceiling value.

## Decisions

### D1: One pure resolution function, three callers

`src/models-dev/resolve.ts` exports `resolveModelMetadata({ providerType?, baseUrl?, baseProvider?, baseModel?, model })` → `{ providerId, modelId, contextWindow, maxOutputTokens, source: 'models-dev' | 'prefix-table' | 'none', via: 'override' | 'inferred' | null }`. All inputs are public fields; no secrets in, no secrets out. Callers: the role resolver (runtime), `buildChatModel` (degraded path, D6), and the preview route (D7). The function reads the process-wide snapshot via an injected getter (default: the D2 singleton) so tests stay hermetic.

*Alternatives considered:* separate preview-side resolver — rejected, drift between what the UI shows and what the runtime applies is the failure this change exists to prevent; resolution inside the catalogue client — rejected, it would entangle network lifecycle with pure lookup.

### D2: Snapshot singleton, not per-call `loadDb`

`src/models-dev/client.ts` adapts the `opencode-agent/src/pricing.ts` reader (same pinned URL, 10s `AbortSignal.timeout`, 60-min TTL, lenient schemas with per-field `.catch`, disk cache at `~/.cache/papai/models.json`) into a process-lifetime singleton: boot prewarm (fire-and-forget), background refresh on TTL expiry, in-memory snapshot as the only read path. No consumer ever awaits a fetch. A failed refresh keeps the last snapshot; a failed first fetch leaves the empty snapshot with `fetchedAt: null`.

*Why not reuse `pricing.ts` directly:* it is in a non-importable workspace, and its `loadDb` shape (await per call) is wrong for this change — the preview endpoint must answer from memory alone and the runtime must never block. *Why not fetch on demand in the preview route:* forbidden by spec (no outbound calls while serving); also a slow models.dev would hang the settings UI. *Why not a second endpoint/format:* the catalogue is the single source opencode uses; a mirror adds an operational surface for no fidelity gain.

### D3: Provider-id inference

`src/models-dev/provider-id.ts`: a 1:1 map `providerType → catalogue provider id` for the six typed providers (`openai|anthropic|google|openrouter|groq|ollama`), and a baseUrl-host map for `custom` gateways (e.g. `openrouter.ai → openrouter`); unknown host/type → null. Inference needs only public fields, so it works in `buildChatModel` where only `baseUrl` is known.

*Alternative:* per-provider URL-pattern matching — rejected; the host map covers every gateway papai can name today and the override (D5) is the precise instrument for anything else.

### D4: Name-only catalogue lookup for the existing seams

`resolveMaxTokens(modelName)` keeps its signature and consults the snapshot first: collect every catalogue entry whose model id equals the name; if all matches agree on the context window, use it; if they disagree (model ids reused across providers), fall through to the prefix table — conservative, deterministic, and unchanged when the snapshot is empty. This avoids threading `baseUrl`/role objects through `shouldTriggerTrim`, `proactive-llm-persist`, and the `/context` collector deps, whose interfaces carry a model name only.

*Alternative:* widen those call chains to pass resolved roles — rejected for now: a cross-module interface change in three consumers for marginal fidelity; the generation path (D6) resolves with full inputs, and the prefix-table fallback bounds the damage of a rare ambiguous name. Revisit if real-world ambiguity shows up in logs.

### D5: Persistence — two nullable columns, blob stays v2, no backfill

Migration `083_llm_provider_base_refs`: `ALTER TABLE llm_providers ADD COLUMN base_provider TEXT` / `ADD COLUMN base_model TEXT` (nullable; drizzle schema gains the two columns). No backfill — existing rows decode to `null` = pure inference, which is the intended default. `NewLlmProviderInput` / `updateLlmProvider` patch paths gain the optional fields; `publicAccount` in the admin routes and `ProviderInBlobSchema` in the BYOK routes echo them. BYOK: `ByokBlobV2` providers gain optional `baseProvider`/`baseModel`; the version stays `2` — additive optional fields, `decodeByokBlob` passes unknown-shaped v2 blobs through, so blobs written by the new code decode on old binaries (ignored) and old blobs decode with the fields absent. Env bootstrap: `LLM_BASE_PROVIDER` / `LLM_BASE_MODEL` read in src/llm-providers/env-bootstrap.ts and applied only when the env seed actually creates the provider.

**Scope model impact:** the new persisted state keys on nothing conversational — `llm_providers.base_*` are global admin rows; BYOK base refs live inside the encrypted blob keyed by **config context id** (group-shared across a group's threads, never per storage context or platform instance). The catalogue snapshot and the preview endpoint are process-global and context-free.

### D6: Output cap applied inside `buildChatModel`, metadata threaded from the resolver

`ResolvedRole` gains a `metadata` field (the `resolveModelMetadata` result computed in `resolveLlmConfig`/`resolveAdminLlmConfig`, where providerType, baseUrl, declared base refs, and model are all at hand). `buildChatModel` gains an optional trailing `metadata` parameter; when present it wraps the model with `defaultSettingsMiddleware` from the already-installed `ai` package sending `maxOutputTokens: metadata.maxOutputTokens` (only when non-null) via `wrapLanguageModel`; when absent it resolves internally from `baseUrl` + name (D3 inference + D4 lookup) — same engine, fewer inputs. Unknown/`none` models get no middleware and byte-identical requests. Because all eleven call sites already hold the resolved role at the call, threading is a mechanical one-argument change per site; the middleware wraps the per-call `LanguageModel`, so the `(apiKey, baseUrl)` provider cache is untouched.

*Alternative:* apply the cap at each generation call site via generate options — rejected: eleven places to remember, and background paths (summarizers, trim) would silently diverge from the chat path. *Fallback if the pinned `ai` version lacks `defaultSettingsMiddleware`:* a one-field middleware via `wrapLanguageModel` achieving the same request shape; the decision (cap applied in the builder, not the call sites) is unaffected.

**Tool-prefs / capability gating impact:** none. This change adds no chat tool, so no toolset, `tool_prefs`, or confirmation-flow surface is touched; guest-mode read-only toolsets are unaffected.

### D7: Preview endpoint — member-readable, context-free, read-only

`src/debug/settings/llm-model-metadata-routes.ts`: `GET /settings/api/llm-model-metadata?providerType=&baseUrl=&baseProvider=&baseModel=&model=` mounted in src/debug/settings-api-router.ts alongside the other non-admin routes. Auth: `authenticate(req)` only — same gate as every settings route; **no `resolveContextScope`, no `requireAdmin`**, because the BYOK and group forms are member-facing. GET needs no CSRF. The handler validates inputs with a lenient schema (all fields optional strings), calls `resolveModelMetadata`, and answers `settingsJson(200, { ...metadata, snapshotFetchedAt })`. It reads the in-memory snapshot only and never fetches. Empty snapshot → `source: 'none'`, `snapshotFetchedAt: null`.

*Alternative:* reuse the admin providers route — rejected: admin-gating the preview would break the BYOK/group surfaces it exists to serve. *Alternative:* PUT/POST with a body — rejected: it is a pure lookup; GET keeps it cacheable and CSRF-free.

### D8: Client hint — one component, four states, debounced lookup

`client/settings/components/ModelMetadataHint.svelte`: props `{ providerType?, baseUrl?, baseProvider?, baseModel?, model }`; renders one muted read-only line — catalogue hit (`models.dev · <provider/model> · ctx … · max out …`, plus `via override` when `via === 'override'`), prefix guess, `no limits known`, or `catalogue unavailable`. Lookup: ~300 ms debounce, `AbortController` per request with superseded requests aborted, a per-input-key `Map` cache, and a "newest input wins" guard. Wired into `RoleBindingBlock.svelte` (under the model Combobox, shown when a provider is selected and the model field is non-empty — the block is shared, so admin models, BYOK, and group surfaces get it for free) and `ProviderForm.svelte` (under the base-reference fields, resolving `baseProvider ?? inferred(providerType, baseUrl)` + `baseModel` so a mistyped id is visible pre-save). `fetcher-schemas-llm-providers.ts` gains `LlmModelMetadataResponseSchema` + a GET fetcher; `PublicProviderAccountSchema` gains the nullable base fields.

## Risks / Trade-offs

- [models.dev changes its JSON shape] → Lenient per-field `.catch` Zod schemas (the pattern proven in `opencode-agent/src/pricing.ts` after the metrics.dev incident); a malformed field degrades that field, a malformed entry degrades that entry, and a failed parse degrades to the previous snapshot — never to a crash or a blocked request.
- [Model ids reused across catalogue providers mislead the name-only lookup] → D4's agreement tiebreak falls back to the prefix table on disagreement; the override remains the precise instrument, and the generation path resolves with full inputs.
- [A strict gateway rejects the injected `max_tokens` parameter] → The cap is applied only when the catalogue entry (direct or via override) declares `limit.output`, so the blast radius is per-model and opt-in; unknown models send byte-identical requests.
- [Previously-unbounded models suddenly hit the trim trigger] → This is the intended behavior change (proposal); trimming is background, bounded (TRIM_MIN/TRIM_MAX), and already exercised by prefix-table models. Watch `/stats` trim counters after rollout.
- [Preview endpoint hammered while a user types] → Client debounce + supersede + per-key cache; server-side the handler is a pure in-memory lookup with no outbound I/O, so worst case is cheap 200s.
- [Disk cache unwritable (read-only FS, permissions)] → Cache writes are best-effort and swallowed (pricing.ts precedent); the in-memory snapshot remains authoritative and refreshes on TTL.
- [Catalogue unavailable on a fresh install] → Preview reports `catalogue unavailable`, runtime stays on the prefix table — identical to today's behavior until the first successful fetch.

## Migration Plan

1. Land `src/models-dev/` (client, provider-id, resolve) + migration 083 + schema/store/route/BYOK additions — all additive; existing behavior unchanged (snapshot empty until first fetch, base refs null).
2. Flip the consumers: `resolveMaxTokens` snapshot consultation, `ResolvedRole.metadata` + `buildChatModel` threading, env bootstrap, preview endpoint, client component + wiring. Each step is independently revertible.
3. Deploy: migration runs at boot (`bun:sqlite` `ALTER TABLE` is instant on any realistic `llm_providers` row count); the prewarm fetches models.dev in the background.
4. Rollback: `git revert`; the nullable columns and optional blob fields are inert on old code (old decode ignores unknown v2 blob fields, old `resolveMaxTokens` never reads the snapshot). No data migration is ever needed in reverse.

## Test-first order (TDD hook interactions)

The Write/Edit TDD hook pipeline gates every new product file below (`isGateableImplFile`: `src/`, `client/`); each must land with its test. Order:

1. `src/models-dev/resolve.ts` — pure precedence table tests (override > inferred > prefix > none, ambiguous-name tiebreak, `via` marking).
2. `src/models-dev/client.ts` — injected `fetchImpl`; TTL, timeout, malformed-body degradation, empty-snapshot `fetchedAt: null`, disk-cache round-trip (tests never reach models.dev).
3. `src/models-dev/provider-id.ts` — type map + host map + unknown → null.
4. Migration 083 + drizzle schema + `updateLlmProvider`/create paths — store round-trip, legacy-row decode.
5. `src/debug/settings/llm-model-metadata-routes.ts` — auth required, non-admin allowed, no context scope, precedence echoed, empty-snapshot shape, **no outbound fetch during a request** (assert the injected fetch sees zero calls).
6. `ResolvedRole.metadata` + `buildChatModel` — cap present/absent in the captured request body, middleware skipped for `none`, provider-cache untouched.
7. `src/byok-llm/blob-codec.ts` + BYOK/admin routes — old blobs decode unchanged, new fields echo, public shape stays credential-free.
8. env-bootstrap optional vars.
9. `client/settings/fetcher-schemas-llm-providers.ts` + `ModelMetadataHint.svelte` + wiring — schema tests, component states, and a Storybook story covering the four hint states for the screenshot lane.

Mutation gate: new `src/` files join the Stryker ratchet via `test:mutate:changed --base=HEAD~1 --update-baseline`; the pure `resolve.ts` is where the score floor will be earned, so keep branches decision-dense and test-covered.
