# Tasks: llm-base-model-selection

Test-first order follows design.md (D1–D8); each task is red before green.
design.md has no open questions.

## 1. Shared hint shape + resolution precedence

- [x] 1.1 Write failing tests for the shared hint parser: `tests/llm-providers/model-hints.test.ts` covering valid map, missing alias, empty alias, non-object value, non-string values, and tolerant `{}` normalization. Verify: `bun test tests/llm-providers/model-hints.test.ts`
- [x] 1.2 Create `src/llm-providers/model-hints.ts` (`ModelHintsSchema` + `parseModelHints`, per design D2) and add `modelHints` (default `{}`) to `LlmProviderAccount` in `src/llm-providers/types.ts`. Verify: `bun test tests/llm-providers/model-hints.test.ts && bun run typecheck`
- [x] 1.3 Write failing resolver tests in `tests/llm-providers/resolver.test.ts`: per-model hint overrides the provider-level pair for that model id; sibling and unhinted models fall through to provider-level/inference; exact-string key matching; both admin (`resolveAdminLlmConfig`) and BYOK (`resolveLlmConfig`) paths honor hints. Verify: `bun test tests/llm-providers/resolver.test.ts`
- [x] 1.4 Implement the precedence in `metadataFor` (src/llm-providers/resolver.ts:28, per design D1) — `resolveModelMetadata` stays untouched. Verify: `bun test tests/llm-providers/resolver.test.ts`

## 2. Admin persistence: migration + store

- [x] 2.1 Write failing migration test `tests/db/migrations/084_llm_provider_model_hints.test.ts`: column added, guard idempotent on re-run, pre-existing rows untouched (no backfill). Verify: `bun test tests/db/migrations/084_llm_provider_model_hints.test.ts`
- [x] 2.2 Implement `src/db/migrations/084_llm_provider_model_hints.ts` (pattern of 083: `PRAGMA table_info` guard + `ALTER TABLE llm_providers ADD COLUMN model_hints TEXT`) and register it in the `src/db/index.ts` migration list after 083; add `modelHints: text('model_hints')` to `llmProviders` in `src/db/llm-providers-schema.ts`. Verify: `bun test tests/db/migrations/084_llm_provider_model_hints.test.ts`
- [x] 2.3 Write failing store tests in `tests/llm-providers/store.test.ts`: hints persist through create/update and reload (survives restart/`primeLlmAdminCache`), `null` column reads as `{}`, malformed JSON reads as `{}`, verification/model-list updates do not clobber `model_hints`. Verify: `bun test tests/llm-providers/store.test.ts`
- [x] 2.4 Implement store changes in `src/llm-providers/store.ts` (per design D3): `toAccount` parses the column via `parseModelHints`, serialization `JSON.stringify` when non-empty else `null`, `updateLlmProvider` patch union gains `modelHints`. Verify: `bun test tests/llm-providers/store.test.ts && bun run typecheck`

## 3. BYOK encrypted blob

- [x] 3.1 Write failing tests in `tests/byok-llm/blob-codec.test.ts`: legacy blob lifts with `modelHints: {}`, v2 blob round-trips hints, missing/malformed hints on one provider decode as `{}` leaving other providers' hints intact (per design D4). Verify: `bun test tests/byok-llm/blob-codec.test.ts`
- [x] 3.2 Implement decode-time normalization in `src/byok-llm/blob-codec.ts`: map v2 providers through `parseModelHints`, `fromLegacy` sets `{}`, blob stays `v: 2`. Verify: `bun test tests/byok-llm/blob-codec.test.ts && bun run typecheck`

## 4. Settings API routes

- [x] 4.1 Write failing tests in `tests/debug/settings/admin/llm-providers-routes.test.ts`: PATCH persists `modelHints`, GET echoes it (`{}` when none), PATCH with malformed hints returns 422 and leaves stored config unchanged. Verify: `bun test tests/debug/settings/admin/llm-providers-routes.test.ts`
- [x] 4.2 Implement admin route changes in `src/debug/settings/admin/llm-providers-routes.ts` (per design D5): `ProviderPatchSchema` gains `modelHints: ModelHintsSchema.optional()`, `publicAccount` echoes `modelHints`. Verify: `bun test tests/debug/settings/admin/llm-providers-routes.test.ts`
- [ ] 4.3 Write failing tests in `tests/debug/settings/admin/byok-routes.test.ts`: `upsert-provider` accepts optional `modelHints` and round-trips it into the blob readback. Verify: `bun test tests/debug/settings/admin/byok-routes.test.ts`
- [ ] 4.4 Implement BYOK route changes: `ProviderInBlobSchema` gains optional `modelHints` (src/debug/settings/byok-routes.ts) and `publicByokProvider` echoes it (src/debug/settings/byok-field-response.ts). Verify: `bun test tests/debug/settings/admin/byok-routes.test.ts && bun run typecheck`

## 5. Settings UI

- [ ] 5.1 Write failing tests in `tests/client/settings/fetcher-schemas-llm-providers.test.ts`: `PublicProviderAccountSchema` parses `modelHints` (default `{}`), `ProviderInput`/patch accepts optional `modelHints`. Verify: `bun test tests/client/settings/fetcher-schemas-llm-providers.test.ts`
- [ ] 5.2 Implement client schema updates in `client/settings/fetcher-schemas-llm-providers.ts`. Verify: `bun test tests/client/settings/fetcher-schemas-llm-providers.test.ts`
- [ ] 5.3 Write failing tests in `tests/client/settings/model-hints-editor.test.ts`: renders one row per hint (model id, base-provider input, base-model input, remove), add-control offers only enumerated `verification.models` not yet hinted, live metadata preview per row fed with the hint pair, unresolved pair shown as unresolved, remove drops the row, emitted map reflects edits. Verify: `bun test tests/client/settings/model-hints-editor.test.ts`
- [ ] 5.4 Implement `client/settings/components/ModelHintsEditor.svelte` (per design D6: rows + add-control + per-row `ModelMetadataHint`). Verify: `bun test tests/client/settings/model-hints-editor.test.ts`
- [ ] 5.5 Write failing tests in `tests/client/settings/admin-providers-section.test.ts`: edit form renders the hints editor with the provider's enumerated models and stored hints, saved PATCH body carries `modelHints`, create form does not render the editor. Verify: `bun test tests/client/settings/admin-providers-section.test.ts`
- [ ] 5.6 Wire `client/settings/components/ProviderForm.svelte` (render `ModelHintsEditor` in `editMode` only, fold map into `ProviderFormInput`) and `client/settings/sections/admin/AdminProvidersSection.svelte` (carry `modelHints` in the saved PATCH). Verify: `bun test tests/client/settings/admin-providers-section.test.ts && bun run typecheck`

## 6. Docs + full verification

- [ ] 6.1 Update the models-dev-catalogue precedence sentence in `docs/architecture/behaviors.md` to state the per-model → provider-level → inference/prefix-table chain. Verify: `bun run lint` (format:check included) and re-read the diff
- [ ] 6.2 Run the full gate: `bun run test`, then `bun run typecheck`, `bun run lint`, and `bun check:full`; query failures via `bun run test:failures` / `bun run test:show` instead of re-running, and fix until all green
