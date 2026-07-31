<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0288: Multi-Provider LLM Configuration — Settings UI (Admin Providers/Models Sections and Generalized Personal BYOK)

## Status

Implemented (with divergence)

## Date

2026-07-15

## Context

ADR-0287 (the backend companion) shipped the multi-provider LLM registry's data model, per-role resolver, model discovery, and the **settings routes** — `GET/POST /settings/api/admin/providers`, `PATCH/DELETE …/:id`, `POST …/:id/refresh-models`, `GET/PUT /settings/api/admin/llm-roles`, and the extended `PATCH /settings/api/byok` discriminated actions (`upsert-provider` / `delete-provider` / `set-roles` / `refresh-models`). But until this UI plan landed, that registry was manageable **only via the API** — the only settings surface for LLM config was the legacy five-row `AdminSystemSection` KV table (the single-cred model ADR-0287 retired on the server), which the backend plan had already removed the backing `/settings/api/admin/system` route for.

The 2026-07-15 design (`docs/archive/2026-07-15-multi-llm-providers-design.md` §6) and the UI plan ("Plan B") replace that dead section with the client side of the multi-provider model: an admin **Providers** section (list/add/edit/delete/refresh + manual model-list editor) and an admin **Models** section (three role-binding blocks — `main` required, `small`/`embedding` inheritable), both consuming the admin routes; and a fully rewritten personal **BYOK** section that generalizes the old flat five-key form into a per-context provider list + per-role "Inherit admin" overrides, consuming the extended BYOK PATCH actions. The shared design's locked choices carry through to the UI: provider "type" is only a label + base-URL preset (every provider remains OpenAI-compatible); role bindings are per-role with graceful null-fallback for `small`/`embedding`; discovery is non-blocking and surfaces as a verification pill.

## Decision Drivers

- **Consume the ADR-0287 route contract, not re-derive it.** The UI is a thin client over the already-shipped admin provider/role routes and the extended BYOK PATCH actions; it must not encode resolver or storage logic.
- **Per-role binding is the headline UX.** The Models section and the BYOK role-override area must each render three independent role blocks (`main` required; `small`/`embedding` with an "Inherit" null-state), mirroring the resolver's per-role context→admin→main-fallback chain.
- **Provider type as label + preset only.** The type dropdown presets a base URL but never selects a native SDK adapter — the OpenAI-compatible-only decision (ADR-0287) is reflected verbatim in `PROVIDER_TYPE_BASE_URLS`.
- **Non-blocking discovery surfaces as a pill, never blocks a save.** Each provider row renders a `VerificationPill` (verified/unverified/error); model lists populate a combobox with a free-text fallback so endpoint-less or unlisted models remain usable.
- **Retire the dead `AdminSystemSection` and its schema/fetcher/MSW deadwood.** The five-row KV table is gone; the nav, the admin system fetchers/schemas, and the MSW `adminSystemHandlers`/system scenarios are removed in lockstep so the SPA cannot reference the removed route.
- **Generalize BYOK in place, not as a fork.** The personal BYOK section keeps its shell, its `contextId`-scoped `$effect` auto-load + `loadedContextId` race-guard, and its enable/disable toggle, now driving a richer multi-provider body — evolved, not rewritten from scratch.
- **One small server-side change.** The BYOK GET (`fieldResponse`) must also return v2 `providers` (masked apiKey) + `roles` so the rewritten BYOK section has its seed data — the routes gained the PATCH writers in ADR-0287 but the GET reader still returned only legacy flat fields.

## Considered Options

### Option 1 — Three new sections (Admin Providers, Admin Models, generalized BYOK); shared ProviderForm/RoleBindingBlock/VerificationPill; retire AdminSystemSection (chosen)

Add Zod schemas mirroring the server types, thin fetchers over the ADR-0287 routes, three reusable Svelte components shared by the admin and BYOK sections, two admin section components, a full rewrite of `ByokSection`, and MSW handlers + stories. One server change extends the BYOK GET.

- **Pros:** single source of truth via the route contract; shared components avoid admin/BYOK duplication; the per-role "Inherit" UX is identical in both tiers (only the inherit label differs — "Inherit main" vs "Inherit admin"); retiring `AdminSystemSection` removes the dead-route footgun.
- **Cons:** a broad client diff (8 new files, ~12 modified); the shared design is already archived by the backend ADR-0287 so the plan references it by archive path; Svelte 5 runes lifecycle must be reproduced consistently across three sections.

### Option 2 — Keep the five-row KV `AdminSystemSection` as a fallback alongside the new sections

Leave `AdminSystemSection` mounted for operators accustomed to it, pointing at... nothing (the route is gone).

- **Pros:** no nav/schema/fetcher deadwood removal churn.
- **Cons:** the section would fetch a removed route and always error; it is pure dead surface. The backend already deleted the `/settings/api/admin/system` LLM path, so keeping the client section is a broken reference, not a fallback.

### Option 3 — Admin-only UI; defer the BYOK generalization

Ship the admin Providers/Models sections now, leave the personal BYOK section on the legacy flat form.

- **Pros:** smaller diff; the admin tier is where multi-provider matters most operationally.
- **Cons:** the BYOK PATCH writers already exist (ADR-0287) with no client — a context could not self-serve per-role overrides, defeating the two-tier per-role override design. The legacy flat form would also mis-drive the v2 blob (guarded by the 409 `rejectLegacyValuesAgainstV2Blob`), so it would actively error.

## Decision

The chosen Option 1 shipped across the server GET extension, the client schemas/fetchers, three shared components, three sections, the MSW layer, the stories, and the navigation rewiring. What shipped:

1. **Server — BYOK GET returns v2 providers + roles** (`src/debug/settings/byok-field-response.ts`). `buildByokFieldResponse` masks the apiKey (`****`+last-4) and returns `providers` (public shape) + `roles` from `getByokBundle` alongside the legacy flat fields; disabled/unreadable states return empty providers + an empty-roles singleton. (Extracted to its own module rather than inline in `byok-routes.ts` — see Divergences.)
2. **Client Zod schemas** (`client/settings/fetcher-schemas-llm-providers.ts`). `LlmProviderTypesSchema` (openai/anthropic/google/openrouter/ollama/groq/custom), `PROVIDER_TYPE_BASE_URLS` preset, `VerificationSchema`, `PublicProviderAccountSchema`, `LlmRoleBindingsSchema` (main required; small/embedding nullable), `AdminProvidersResponseSchema`, `AdminLlmRolesResponseSchema`, `ProviderInputSchema`, and `PROVIDER_TYPE_OPTIONS`.
3. **BYOK response schema extended** (`client/settings/fetcher-schemas.ts`). `ByokResponseSchema` gains optional `providers` + `roles` with `.default(...)` so older server responses still parse cleanly.
4. **Admin provider/role fetchers** (`client/settings/admin-fetchers.ts`). `fetchAdminProviders`, `createAdminProvider`, `updateAdminProvider`, `deleteAdminProvider`, `fetchAdminLlmRoles`, `putAdminLlmRoles` — plus `refreshAdminProviderModels` (the synchronous refresh route added in ADR-0287). Dead `fetchAdminSystem`/`submitAdminSystem` removed.
5. **BYOK multi-provider action fetchers** (`client/settings/byok-provider-fetchers.ts`). `upsertByokProviderAction`, `deleteByokProviderAction`, `setByokRolesAction`, `refreshByokModels` — each PATCHes the BYOK route with the matching discriminated action. (Extracted to their own module rather than inlined in `fetchers.ts` — see Divergences.)
6. **Shared component — VerificationPill** (`client/settings/components/VerificationPill.svelte`). Renders a `Pill` whose tone/text is `$derived` from a `Verification` (verified=accent, error=danger, unverified=mute); consumed by both admin and BYOK provider lists.
7. **Shared component — ProviderForm** (`client/settings/components/ProviderForm.svelte`). Reusable add/edit form: type dropdown (presets base URL), label, base URL, optional apiKey. An `editMode` prop makes apiKey optional (edit pre-fills label/type/baseUrl; a blank apiKey on edit means "keep existing").
8. **Shared component — RoleBindingBlock** (`client/settings/components/RoleBindingBlock.svelte`). Provider dropdown + model combobox (free-text fallback over the provider's cached models); an optional "Inherit" checkbox drives the null binding. Selecting a different provider clears the model.
9. **Admin Providers section** (`client/settings/sections/admin/AdminProvidersSection.svelte`). Lists providers (label, type, base URL, masked key, verification pill, model count) with add/edit/delete, per-row "Refresh models", and a manual "Models" editor — wired to `ProviderForm`, `ProviderModelsEditor`, and the admin fetchers. Delete is confirm-guarded.
10. **Admin Models section** (`client/settings/sections/admin/AdminModelsSection.svelte`). Three `RoleBindingBlock`s (main `canInherit={false}`; small/embedding `canInherit={true}`); a dirty-tracking Save PUTs the role bindings; loads providers + roles in parallel.
11. **Generalized personal BYOK section** (`client/settings/sections/ByokSection.svelte`). Keeps the enable/disable toggle + context-scoped lifecycle; when enabled renders a provider list (add/delete + per-row refresh), a status pill (Active/No providers/Unreadable/Central credentials), and a role-override area with three `RoleBindingBlock`s using `inheritLabel="Inherit admin"`.
12. **Shared component — ProviderModelsEditor** (`client/settings/components/ProviderModelsEditor.svelte`). A textarea-based manual model-list editor for endpoint-less providers (the spec §6.1 feature the plan's checklist deferred — see Divergences).
13. **MSW handlers + scenarios** (`client/stories/msw/settings-handlers-admin.ts`, `settings-handlers.ts`, `scenarios.ts`). `adminProvidersHandlers` + `adminLlmRolesHandlers` replace the dead `adminSystemHandlers`; the BYOK handlers carry v2 `providers` + `roles`; new `settings-admin-providers-*` / `settings-admin-llm-roles-*` scenarios (the roles scenarios also spread the providers handlers so the Models section fully renders); `settings-shell-admin-ready` mounts the new handlers.
14. **Navigation rewired; AdminSystemSection retired** (`client/settings/SettingsApp.svelte`). The System nav item is replaced by `llm-providers` + `llm-models`; `AdminProvidersSection` + `AdminModelsSection` mount in the admin zone. `AdminSystemSection.svelte` and its stories are deleted.
15. **Stories** (`AdminProvidersSection.stories.svelte`, `AdminModelsSection.stories.svelte`, updated `ByokSection.stories.svelte`). Populated/Empty/Error/Loading stories per admin section; BYOK stories updated for the v2 payload.

## Consequences

### Positive

- The multi-provider registry is now fully self-service from the settings SPA — no API-only gap remains after ADR-0287; an operator can add providers, bind roles, and refresh models without leaving the UI.
- Both tiers share `ProviderForm`, `RoleBindingBlock`, and `VerificationPill`, so the per-role "Inherit" UX is structurally identical in admin and personal contexts (only the inherit label differs), keeping the two-tier mental model consistent.
- The dead `AdminSystemSection` and its entire client-side deadwood (fetchers, schemas, MSW handlers, scenarios, nav entry) are gone, so the SPA cannot reference the route ADR-0287 removed.
- Discovery's verification pill + free-text model combobox make a failed `/models` fetch non-fatal and non-confusing: a provider with no model list is still bindable by manual model entry.
- The manual model-list editor and the per-row Refresh button — both deferred in the plan's own checklist — shipped, closing the spec §6.1 surface fully rather than leaving a follow-up.

### Negative

- A broad client diff (8 new files, ~12 modified) for what is operationally a thin client over existing routes; the component count (three shared + two sections + the editor) is the cost of not duplicating admin/BYOK forms.
- The BYOK GET now returns v2 providers/roles alongside legacy flat fields, so the response shape carries both representations until legacy blobs are re-normalized on save (the version-tolerant reader from ADR-0287 makes this transparent, but the response is larger).
- The `AdminLlmKeyState`/`AdminLlmSnapshot` client types were **not** removed (the plan's Task 12 assumed they were dead); they remain in use for the admin BYOK dashboard (`client/debug/dashboard-types.ts`), so the plan's cleanup step was only partially applicable.

### Risks

- **Client-generated provider ids.** The BYOK section mints provider ids client-side (`prov_${Math.random().toString(36).slice(2,14)}`) before upserting; a collision is negligible-probability but the id is not server-authoritative, unlike the admin tier's `prov_<nanoid>`. A malformed id would fall through the resolver as an orphan (unset), per ADR-0287's integrity rule.
- **Background verification lag in the UI.** Admin create/update returns `200` with `verification.status:'unverified'` and the pill only updates after the background fetch resolves (ADR-0287); the manual Refresh button (synchronous) mitigates this, but a freshly-added provider shows "Unverified" transiently.
- **MSW scenario coupling.** The `settings-admin-llm-roles-*` scenarios must also spread the providers handlers for the Models section to render in Storybook; a future scenario edit that drops the providers spread would break the Models stories silently (the contract test catches it, but only at test time).
- **Free-text model entry has no validation against the provider.** The combobox allows any model string; the resolver (ADR-0287) never reads the model cache, so an invalid model is only caught at turn time by the provider itself.

## Related Decisions

- **ADR-0287** — the backend companion. It built the admin provider/role routes, the extended BYOK PATCH actions, the resolver, discovery, and migration that this UI consumes. This ADR is its client-side completion; the two share a single design doc (now in `docs/archive/`).
- **ADR-0120** — established central LLM credentials in `system_config` and the admin System section. This ADR retires the last client-side remnant of that section (`AdminSystemSection`), completing the migration ADR-0287 began.
- **ADR-0185** — introduced the per-context BYOK layer. This ADR generalizes its settings section (`ByokSection`) from the flat five-key form to the per-role multi-provider override, reusing the same section shell and context-scoped lifecycle.
- **ADR-0237** — Phase 4d model selection for the coding-session subsystem; its discovery + free-text-fallback UX pattern is the precedent this chat-bot-layer UI mirrors, but the two subsystems remain separate (per the design's out-of-scope note).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/debug/settings/byok-field-response.ts:56-87` | `buildByokFieldResponse` — BYOK GET returns v2 `providers` (masked) + `roles` alongside legacy flat fields; disabled/unreadable return empty. | `read` confirms. |
| `src/debug/settings/byok-field-response.ts:39-54` | `maskApiKey` (`****`+last-4), `publicByokProvider`, `emptyRolesResponse` singleton. | `read` confirms. |
| `src/debug/settings/byok-routes.ts:30` | `byok-routes.ts` imports `buildByokFieldResponse` from the extracted module (not inline). | `read` confirms. |
| `client/settings/fetcher-schemas-llm-providers.ts:8-26` | `LlmProviderTypesSchema` + `PROVIDER_TYPE_BASE_URLS` preset (OpenAI-compatible-only reflected as label/preset). | `read` confirms. |
| `client/settings/fetcher-schemas-llm-providers.ts:37-53` | `PublicProviderAccountSchema`, `LlmRoleBindingsSchema` (main required; small/embedding nullable). | `read` confirms. |
| `client/settings/fetcher-schemas-llm-providers.ts:56-68` | `AdminProvidersResponseSchema`, `AdminLlmRolesResponseSchema`, `ProviderInputSchema`, `ProviderPatch`. | `read` confirms. |
| `client/settings/fetcher-schemas.ts:45-61` | `ByokResponseSchema` extended with optional `providers` + `roles` (`.default(...)` for back-compat). | `read` confirms. |
| `client/settings/admin-fetchers.ts:256-279` | Admin LLM provider CRUD + roles fetchers; `refreshAdminProviderModels` for the sync refresh route. | `read` confirms. |
| `client/settings/byok-provider-fetchers.ts:19-49` | BYOK multi-provider action fetchers (`upsert-provider`/`delete-provider`/`set-roles`/`refresh-models`). | `read` confirms. |
| `client/settings/components/VerificationPill.svelte:21-35` | `$derived.by` tone/text from `Verification`; renders `Pill` with `data-testid`. | `read` confirms. |
| `client/settings/components/ProviderForm.svelte:16-56` | Reusable add/edit form; `editMode` makes apiKey optional; type-change presets base URL. | `read` confirms. |
| `client/settings/components/RoleBindingBlock.svelte:31-64` | Inherit toggle (null binding) + provider dropdown + model combobox; provider switch clears model. | `read` confirms. |
| `client/settings/components/ProviderModelsEditor.svelte` | Manual model-list editor (spec §6.1 feature the plan deferred). | `glob` + import in `AdminProvidersSection.svelte:15` confirm. |
| `client/settings/sections/admin/AdminProvidersSection.svelte:150-275` | Admin provider list + add/edit/delete + Refresh models + Models editor; confirm-guarded delete. | `read` confirms. |
| `client/settings/sections/admin/AdminProvidersSection.svelte:199-229` | Per-row Edit/Refresh/Models/Delete action buttons (Edit + Refresh + Models were deferred in the plan's checklist). | `read` confirms. |
| `client/settings/sections/admin/AdminModelsSection.svelte:70-115` | Three `RoleBindingBlock`s (main `canInherit={false}`; small/embedding `canInherit={true}`); dirty Save PUTs roles. | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:217-374` | Generalized BYOK: toggle + status pill + provider list (add/delete/refresh) + role overrides ("Inherit admin"). | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:115-147,167-178` | Client-minted provider id on add; per-row refresh-models. | `read` confirms. |
| `client/settings/SettingsApp.svelte:36-37,72-73,259-260` | Imports + nav (`llm-providers`/`llm-models`) + mounts the two new admin sections. | `read` confirms. |
| `client/stories/msw/settings-handlers-admin.ts:76-129` | `adminProvidersHandlers` + `adminLlmRolesHandlers` (GET/POST/PATCH/DELETE/PUT + error/loading). | `read` confirms. |
| `client/stories/msw/scenarios.ts:122-129,172-173` | `settings-admin-providers-*` / `settings-admin-llm-roles-*` scenarios; roles scenarios also spread providers handlers; `settings-shell-admin-ready` updated. | `read` confirms. |
| `client/stories/msw/settings-handlers.ts:72,88,105-114` | BYOK handlers carry v2 `providers` + `roles` (secretSet/disabled/missing variants). | `grep` confirms. |
| `tests/client/settings/fetcher-schemas-llm-providers.test.ts` | Zod schema parse/reject (95 lines). | `glob` confirms. |
| `tests/client/settings/admin-llm-providers-fetchers.test.ts` | Admin fetcher URL/method/body assertions (130 lines). | `glob` confirms. |
| `tests/client/settings/admin-providers-section.test.ts:68-150` | AdminProvidersSection: list/add/edit/refresh/models-editor/empty/error (150 lines). | `read` confirms. |
| `tests/client/settings/admin-models-section.test.ts` | AdminModelsSection: three role blocks, main-no-inherit, small-inherit-checked (92 lines). | `glob` confirms. |
| `tests/client/settings/byok-provider-fetchers.test.ts` | BYOK action fetcher assertions (91 lines). | `glob` confirms. |
| `tests/client/settings/byok-section.test.ts:115-305` | Generalized BYOK section: disabled/enabled/unreadable states, toggle, add/delete provider, role overrides (305 lines). | `grep` confirms. |
| `client/settings/sections/admin/AdminSystemSection.svelte`, `...stories.svelte` | Dead section — **deleted**. | `glob` finds no file. |

Plan-vs-implementation notes:

- **The implementation shipped more than the plan deferred.** The plan's own Self-Review Checklist explicitly deferred admin provider **Edit**, the **Refresh-models** button, and the **manual model-list editor**, framing them as "follow-up if needed." All three shipped: `AdminProvidersSection.svelte:199-229` wires Edit/Refresh/Models buttons, the `ProviderModelsEditor.svelte` component exists, and `refreshAdminProviderModels` fetcher (`admin-fetchers.ts:265-266`) drives the synchronous refresh route. The BYOK section also gained a per-row Refresh-models button and a confirm-guarded delete (`ByokSection.svelte:167-178,362-373`) beyond the plan. The spec §6.1/§6.2 surface is closed fully.
- **BYOK action fetchers extracted to their own module.** The plan (Task 4) added `upsertByokProviderAction`/`deleteByokProviderAction`/`setByokRolesAction`/`refreshByokModels` to `client/settings/fetchers.ts`. Shipped: they live in a dedicated `client/settings/byok-provider-fetchers.ts`, imported by `ByokSection.svelte:21-26`. Intent (PATCH the BYOK route with the discriminated actions) is preserved verbatim.
- **The server-side `fieldResponse` was extracted, not edited inline.** The plan (Task 1) modified `fieldResponse` inside `src/debug/settings/byok-routes.ts`. Shipped: the function (renamed `buildByokFieldResponse`) and `BYOK_FIELDS` live in a dedicated `src/debug/settings/byok-field-response.ts`, imported by `byok-routes.ts:30`. The masking + providers/roles return shape matches the plan's listing exactly.
- **`ProviderForm` gained an `editMode` prop.** The plan's `ProviderForm` had no edit concept (the section only wired add). Shipped adds `editMode` (`ProviderForm.svelte:22,32,47-51`) making apiKey optional on edit and pre-filling label/type/baseUrl — required because the Edit button shipped.
- **`AdminModelsSection.onRoleChange` was simplified.** The plan special-cased `main` vs `small`/`embedding`. Shipped collapses it to a single `draft = { ...draft, [role]: binding }` line (`AdminModelsSection.svelte:43-45`) — equivalent, since `main`'s `binding` is never null (its `RoleBindingBlock` has `canInherit={false}`).
- **`AdminLlmKeyState`/`AdminLlmSnapshot` were not removed.** The plan's Task 12 Step 3 assumed these client types were dead and removed them from `client/shared/api-types.ts`. Shipped keeps them: they remain in use for the admin BYOK dashboard (`client/debug/dashboard-types.ts:80-81`, `client/stories/fixtures/index.ts:134`) — a different surface from the removed admin System section. The plan's assumption was incorrect; the types are not deadwood.
- **Client-minted provider id uses `Math.random`, not `crypto.randomUUID`.** The plan's `onAddProvider` sketch used `crypto.randomUUID().slice(0,12)`. Shipped uses `Math.random().toString(36).slice(2,14)` (`ByokSection.svelte:125`) — equivalent for a non-authoritative client id (the admin tier's server-side `prov_<nanoid>` is unaffected).
- **No UI-specific design spec existed.** The plan referenced the shared `docs/superpowers/specs/2026-07-15-multi-llm-providers-design.md` §6; that design was archived by the backend companion ADR-0287. Only the plan is archived with this ADR.

The source plan `docs/superpowers/plans/2026-07-15-multi-llm-providers-ui.md` is archived alongside this ADR to `docs/archive/`. The shared design `docs/archive/2026-07-15-multi-llm-providers-design.md` was archived with the backend companion ADR-0287.
