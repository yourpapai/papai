# llm-base-model-selection — revised per maintainer review (pivot to interpretation Б)

## Goal

Let the owner attach a models.dev catalogue-alias **base hint (`baseProvider` + `baseModel`) to a specific model id** of a provider, so individual models that don't match the models.dev catalogue (e.g. `hf:`-routed ids) resolve real metadata — context window, max output tokens, and (via #437's consumer) reasoning/effort data — instead of falling back to prefix-table/none. Provider-level hints keep working unchanged; a per-model hint **overrides** the provider-level one for that model id. The cross-provider base-model control in `RoleBindingBlock` is **dropped** (that flow is fine as-is); main-role selection is out of scope.

## Capabilities

- New capability `llm-model-base-hints` — per-provider, per-model catalogue-alias hints overriding provider-level base refs in `resolveModelMetadata`. No existing spec covers this area (`openspec/specs/` holds no corpus).

## Current structure (explored)

- Provider-level hints today: `llm_providers.base_provider`/`base_model` TEXT columns (migration 083), carried on `LlmProviderAccount` (src/llm-providers/types.ts:29), edited in `ProviderForm.svelte` ("Base provider/Base model (optional)"), persisted via admin `POST/PATCH /settings/api/admin/providers(/:id)` and BYOK `upsert-provider` (`ProviderInBlobSchema` in src/debug/settings/byok-routes.ts), stored inside the BYOK encrypted v2 blob (`ByokProvider = LlmProviderAccount`, src/byok-llm/blob-codec.ts).
- Resolution: `resolveModelMetadata` fires its `via: 'override'` branch only when **both** `baseProvider` and `baseModel` are declared (src/models-dev/resolve.ts:73). The only runtime caller that knows the serving account is `metadataFor(account, model)` (src/llm-providers/resolver.ts:28), called per bound role (main/small/embedding) — so the model identity at call time is the role binding's model string. → a **per-provider map keyed by model id on the account** fits exactly (verified against call sites).
- Individual models are plain strings enumerated in `provider.verification.models` (discovery refresh, or the admin `ProviderModelsEditor` textarea; BYOK has refresh-only, no edit flow).

## Intended behaviour change

- `LlmProviderAccount` gains `modelHints: Readonly<Record<string, { baseProvider: string; baseModel: string }>>` (default `{}`); both fields required per entry, matching the both-declared override semantics.
- `metadataFor` precedence becomes: per-model hint for the bound model id → provider-level `baseProvider`/`baseModel` → unchanged inference/prefix-table/none chain. Models without a hint are unaffected.
- Storage: additive migration **084** adds `llm_providers.model_hints TEXT` (JSON; null = no hints; no backfill; existing configs keep working untouched). BYOK: additive optional `modelHints` in the v2 blob; `decodeByokBlob` normalizes missing/malformed to `{}` per provider, legacy lift sets `{}` — old blobs decode unchanged.
- Routes: admin `PATCH /settings/api/admin/providers/:id` accepts `modelHints` (422 on malformed), `GET .../providers` returns it; BYOK `upsert-provider` schema accepts optional `modelHints` for round-trip fidelity. No new endpoints.
- Settings UI: per-model hints editor in **ProviderForm edit mode** (Admin → Providers → Edit), below the existing provider-level base fields — one row per existing hint (model id, base-provider input, base-model input, remove, live `ModelMetadataHint` preview fed with the hint pair so resolved metadata is visible pre-save) plus an add-control (model Select from the provider's `verification.models` not yet hinted + the two inputs). Chosen over converting `ProviderModelsEditor`'s textarea into rows (large lists, admin-only surface); stated in the MR description.
- Docs: update the precedence sentence in `docs/architecture/behaviors.md` (models-dev-catalogue bullet) in the same PR.

## Files to touch

- `src/db/migrations/084_llm_provider_model_hints.ts` (new, pattern of 083); `src/db/llm-providers-schema.ts`
- `src/llm-providers/types.ts`; new `src/llm-providers/model-hints.ts` (defensive parse helper shared by store + blob codec); `src/llm-providers/store.ts`
- `src/llm-providers/resolver.ts` (`metadataFor` precedence only)
- `src/byok-llm/blob-codec.ts`; `src/debug/settings/admin/llm-providers-routes.ts`; `src/debug/settings/byok-routes.ts`
- `client/settings/fetcher-schemas-llm-providers.ts`; new `client/settings/components/ModelHintsEditor.svelte`; `client/settings/components/ProviderForm.svelte`; `client/settings/sections/admin/AdminProvidersSection.svelte`
- `docs/architecture/behaviors.md`

## Tests

- Unit: new `tests/llm-providers/model-hints.test.ts` (parse/normalize edges); `tests/llm-providers/store.test.ts` (persist + round-trip + null→`{}`); `tests/llm-providers/resolver.test.ts` (hint overrides provider-level for that model; siblings unaffected); `tests/byok-llm/blob-codec.test.ts` (old blob → `{}`, round-trip, legacy → `{}`); new `tests/db/migrations/084_llm_provider_model_hints.test.ts`.
- Routes: `tests/debug/settings/admin/llm-providers-routes.test.ts` (PATCH persists + GET returns + 422 malformed); `tests/debug/settings/admin/byok-routes.test.ts` (`upsert-provider` round-trips hints).
- Client: new `tests/client/settings/model-hints-editor.test.ts` (render/add/remove/persist); `tests/client/settings/admin-providers-section.test.ts` (edit form renders the hints editor; saved PATCH carries `modelHints`); `tests/client/settings/fetcher-schemas-llm-providers.test.ts` (schema defaults).

## #437 interaction (stronger; stated in MR description)

#437 (reasoning effort, in flight on `agent/issue-437`) derives effort levels from `resolveLlmConfig(configContextId).metadata` — exactly the value per-model hints improve. #437 also decorates `RoleBindingBlock` model options, which this change does not touch. Shared file: `src/llm-providers/resolver.ts` (`metadataFor`); whoever lands second rebases.

## Non-goals

- Cross-provider base-model selection in `RoleBindingBlock`; main-role selection entirely (dropped per review).
- BYOK provider edit flow (create/refresh/delete only): BYOK resolution honors hints stored in the blob, but no BYOK hints UI in this MR — flagged as follow-up.
- Provider-level `baseProvider`/`baseModel` fields, model-list editing, `buildChatModel`'s account-less fallback path (all current call sites pass resolver metadata).

## Scope-model impact

Admin hints are global (all platform instances/contexts); BYOK hints live in the per-config-context encrypted blob (group-shared durable config). No new context-scoped state; no secrets involved (hints are catalogue ids).

## Verification

TDD per task; `bun run test:affected` in the edit loop; full `bun run test`, `bun run lint`, and `bun check:full` green before finishing.

## Suspicious / assumptions

- Hint matching is exact-string against the bound model id (e.g. `hf:zai-org/GLM-5.3-Flash`).
- If a hint names a (provider, model) pair absent from the catalogue, existing declared-but-unresolved semantics apply (skip inference → prefix-table/none) — no behaviour invented there.
- Assumption: "base hint" = the models.dev catalogue-alias pair, not the main role binding — per the maintainer's confirmed interpretation Б.
