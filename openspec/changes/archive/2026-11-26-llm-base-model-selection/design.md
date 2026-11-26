<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: llm-base-model-selection (per-model base hints)

## Context

Provider-level base hints exist end to end today: `llm_providers.base_provider`/`base_model`
TEXT columns (migration 083) → `LlmProviderAccount.baseProvider`/`baseModel`
(src/llm-providers/types.ts:29) → edited in `ProviderForm.svelte` → admin
`POST/PATCH /settings/api/admin/providers(/:id)` and BYOK `upsert-provider`
(`ProviderInBlobSchema`, src/debug/settings/byok-routes.ts:65) → stored inside the BYOK
encrypted v2 blob (`ByokProvider = LlmProviderAccount`, src/byok-llm/blob-codec.ts).

Metadata resolution collapses to one seam: `resolveModelMetadata`
(src/models-dev/resolve.ts:69) fires its `via: 'override'` branch only when **both**
`baseProvider` and `baseModel` are declared; a declared-but-catalogue-absent pair skips
inference and falls to the prefix-table/none chain. The only runtime caller that knows
the serving account is `metadataFor(account, model)` (src/llm-providers/resolver.ts:28),
called per bound role by both `resolveLlmConfig` and `resolveAdminLlmConfig` — so the
model identity at call time is exactly the role binding's model string.

Constraints that shape the design:

- `resolveModelMetadata` is shared with the settings lookup route
  (`/settings/api/llm-model-metadata`, already accepting `baseProvider`/`baseModel`
  query params) and consumed by `ModelMetadataHint.svelte` for live previews.
- The account registry is an in-process cache (`src/llm-providers/store.ts`) primed
  from rows; partial updates (`updateProviderVerification`, `setProviderModels`) build
  `set` objects with only their own fields.
- `decodeByokBlob` currently trusts v2 blobs (`return raw` cast) and lifts legacy blobs
  with fixed fields — there is no per-field normalization layer yet.

Motivation and behaviour contract: see proposal.md and
`specs/llm-model-base-hints/spec.md`.

## Goals / Non-Goals

**Goals:**

- One precedence seam where a per-model hint is decided, honoring it for admin
  providers, BYOK providers, and the account-less admin resolution path alike.
- Additive storage on both persistence layers (SQLite column, BYOK blob field) with
  zero backfill and unchanged behavior for every provider that has no hints.
- Strict validation at input boundaries (HTTP 422), tolerant normalization at storage
  decode (→ no hints), one shared shape definition.
- Settings UI to author hints with a live pre-save metadata preview, reusing the
  existing metadata lookup route.

**Non-Goals:**

- Any change to `RoleBindingBlock`, main-role selection, or model-list editing
  (dropped per maintainer review; see proposal).
- BYOK hints UI (BYOK resolution honors blob hints, but nothing authors them from the
  BYOK surface in this MR — flagged follow-up).
- Changes to `resolveModelMetadata`'s catalogue semantics, `buildChatModel`'s
  account-less fallback, or the models.dev snapshot pipeline.

## Decisions

### D1. Collapse the hint into the base pair at `metadataFor`; `resolve.ts` untouched

`metadataFor` looks up `account.modelHints[model]`; when a hint exists it passes the
hint's pair as `baseProvider`/`baseModel`, otherwise the provider-level fields as
today:

```ts
const hint = account.modelHints[model]
resolveModelMetadata({
  ...,
  baseProvider: hint?.baseProvider ?? account.baseProvider,
  baseModel: hint?.baseModel ?? account.baseModel,
  model,
})
```

Rationale: the override is a provider-account concern (which pair applies to this
model), not a catalogue-resolution concern. `resolveModelMetadata` keeps its exact
current semantics — both-declared override, declared-but-unresolved → prefix-table/none
— so the spec's "hint names an absent pair" scenario falls out for free with zero
behavior drift for the shared function and its other caller (the lookup route). Because
both resolution entry points (`resolveLlmConfig`, `resolveAdminLlmConfig`) funnel
through `metadataFor`, one change point covers admin, BYOK, and mixed sources.

Alternatives considered:

- *Add a `modelHint` field to `ModelMetadataInput`* — spreads the account concern into
  the models-dev contract, which the lookup route and its tests must then model;
  rejected.
- *Resolve hints inside `resolveModelMetadata`* — it has no account and must not gain
  one; rejected.

### D2. Shape and single source of truth: `modelHints` + one Zod schema in a new `model-hints.ts`

`LlmProviderAccount` gains
`modelHints: Readonly<Record<string, { baseProvider: string; baseModel: string }>>`
(default `{}`). Both alias fields are required per entry (matching the both-declared
gate) with `min(1)` — an empty alias is treated as "missing" at validation time because
`isDeclared` in resolve.ts would render such an entry inert.

The module `src/llm-providers/model-hints.ts` exports one Zod schema
(`ModelHintsSchema`) and one tolerant wrapper (`parseModelHints(value: unknown)` → the
schema result, `{}` on any failure). Zod v4 is already the validation stack, so no new
dependency. Consumers:

- admin PATCH route: bare schema, `.optional()` — failure → 422 (strict at the input
  boundary);
- BYOK `upsert-provider` schema: same, optional;
- store `toAccount` and `decodeByokBlob`: `parseModelHints` — never throws, `{}` on
  null/malformed (tolerant at the storage boundary).

This strict-input/tolerant-storage split is deliberate: boundaries reject operator
mistakes; decodes survive data written by other versions or hand-edited rows.

Why a new module (dependency question one level in): the closest existing homes are
`src/llm-providers/types.ts` (runtime consts only, already shared by all three
consumers) and `store.ts` (has the inline-parse precedent, e.g. `parseModelsCache`, but
imports drizzle + secret crypto that `blob-codec.ts` must not inherit — the BYOK codec
is deliberately dependency-light). The helper is consumed by three layers (store, blob
codec, routes); the proposal's dedicated module keeps the codec pure and gives the
mutation ratchet a single gateable unit with its own focused test file.

### D3. Storage: additive column `llm_providers.model_hints TEXT`, no backfill

Migration `084_llm_provider_model_hints.ts`, pattern of 083: `PRAGMA table_info` guard
+ `ALTER TABLE llm_providers ADD COLUMN model_hints TEXT`, registered in the
`src/db/index.ts` migration list after 083. Serialization by the store:
`JSON.stringify(hints)` when non-empty, `null` when `{}`; reads go through
`parseModelHints` (`null`/malformed → `{}`), so every existing row keeps working
untouched and there is nothing to backfill — all pre-change rows mean "no hints" by
definition. `updateLlmProvider`'s patch union gains `modelHints`; the partial-update
paths (`updateProviderVerification`, `setProviderModels`) never touch the column, so a
model-list refresh cannot clobber hints.

Alternatives considered:

- *Per-hint child table* (`llm_provider_model_hints`) — hints are always read wholesale
  with the account during cache priming and never queried per-model; a join plus a
  second cache unit buys nothing. Rejected.
- *Fixed `base_hint_*` columns* — unbounded model count; rejected.

Drizzle: `modelHints: text('model_hints')` on the existing `llmProviders` table in
`src/db/llm-providers-schema.ts` — no new table, no foreign keys.

### D4. BYOK: optional field in the v2 blob, decode-time normalization, no version bump

`ByokProvider` (= `LlmProviderAccount`) gains the optional field; `fromLegacy` sets
`{}`. `decodeByokBlob` currently passes v2 payloads through unvalidated, so it now maps
providers through `parseModelHints` (missing/malformed → `{}` per provider; the other
providers in the blob decode untouched) — this is the spec's decode scenario, not a
change to any existing field. The blob stays `v: 2`: the field is additive-optional,
old readers of a new blob ignore the unknown key, and no version bump avoids
re-encrypt/write churn. Hints ride the blob's existing at-rest encryption
(config-context-keyed); they are catalogue aliases, never credentials, and are never
logged.

### D5. Routes: extend existing schemas, no new endpoints

- Admin: `ProviderPatchSchema` gains `modelHints: ModelHintsSchema.optional()`;
  `publicAccount` (GET list/detail) echoes `modelHints` (`{}` when none).
- BYOK: `ProviderInBlobSchema` gains optional `modelHints` (round-trip fidelity);
  `publicByokProvider` in byok-field-response.ts echoes it so a future BYOK UI can
  round-trip.
- Preview needs **no** new endpoint: `ModelMetadataHint` already calls
  `/settings/api/llm-model-metadata` with `baseProvider`/`baseModel`/`model` params
  (src/debug/settings/llm-model-metadata-routes.ts:12), so feeding it the hint pair
  previews exactly what resolution will produce.

Tool/capability gating: no chat tool surface is added or changed — `tool_prefs`,
capability gating, and confirmation flows are unaffected. Authorization is unchanged:
admin routes keep `requireAdmin` + CSRF; BYOK routes keep their config-context
credential gating.

### D6. UI: new `ModelHintsEditor.svelte`, rendered by `ProviderForm` in edit mode only

One row per existing hint (fixed model id, base-provider input, base-model input,
remove) with a live `ModelMetadataHint` per row fed with the hint pair, plus an
add-control: `Select` over the provider's `verification.models` minus already-hinted
ids, then the two alias inputs. `ProviderForm` renders it only when `editMode` (create
mode has no enumerated models — they arrive via background verification or refresh) and
folds the map into `ProviderFormInput`; `AdminProvidersSection` carries it in the saved
PATCH.

Why not convert `ProviderModelsEditor`'s textarea: that editor manages a plain string
list; hints are a structured map with two free-text aliases and a per-row preview.
Different shape, different widget — and the textarea scales to large model lists where
per-row inputs would not (rationale recorded in the proposal; restated here as the
design-level boundary).

### D7. Hint lifecycle: exact-string keys, no auto-prune

Hints are keyed by exact model id (the role binding's string). A model-list refresh
that drops a hinted id leaves the hint in place: it stays inert until some role binds
that exact id again, and the UI still lists the row (editable, not re-addable).
Auto-pruning against `verification.models` would destroy config the owner set
deliberately for ids discovery may intermittently omit. No dedup/normalization beyond
trim at the form boundary.

### D8. #437 interaction

#437 (reasoning effort) consumes `resolveLlmConfig(...).metadata` — precisely the value
hints improve — and decorates `RoleBindingBlock`, which this change does not touch.
Shared file: `src/llm-providers/resolver.ts`, and only the five-line `metadataFor`
input construction; whoever lands second rebases (stated in the MR description).

## Scope-model impact

- Admin hints: keyed by provider id in `llm_providers.model_hints` — global, visible to
  every platform instance and context through the shared provider-registry cache.
- BYOK hints: inside the per-config-context encrypted blob — keyed by config context
  id (group-shared durable config); no storage-context, user, or platform-instance
  scoping. No new context-scoped state anywhere.
- No secrets: hints hold catalogue aliases only; BYOK ones are encrypted at rest as
  part of the blob, and no hint value is ever logged.

## Risks / Trade-offs

- [Users surprised by exact-string matching (case/suffix differences silently don't
  match)] → the editor only offers exact enumerated ids and shows the live per-row
  preview, so an unresolved pair is visible pre-save; the precedence sentence in
  `docs/architecture/behaviors.md` is updated in the same PR.
- [Hinted id disappears from `verification.models` after a refresh] → hints are never
  auto-pruned (D7); the row stays visible and editable in the UI.
- [Conflict with #437 in `resolver.ts`] → the only shared hunk is `metadataFor`'s input
  construction; both changes are additive there; rebase order stated in the MR.
- [Per-decode cost of normalization in the BYOK codec] → a map pass over a handful of
  providers; BYOK bundles are decoded per config context and cached.
- [Strict 422 vs tolerant decode looks inconsistent] → deliberate: boundaries reject
  operator input; decodes tolerate cross-version data (D2). Documented here and in the
  spec scenarios.
- [JSON column hides per-hint structure from SQL inspection] → acceptable: hints are
  small, read wholesale, and exercised through typed accessors and tests; a child table
  was rejected in D3.

## Migration Plan

1. Land code with migration 084 registered after 083; it runs at startup, is guarded by
   the `PRAGMA table_info` check (idempotent on re-run), and `ALTER TABLE ADD COLUMN`
   with a NULL default is metadata-only in SQLite — instant, no downtime, no backfill
   step.
2. Behavior rollout is implicit: every provider starts with no hints, so resolution is
   byte-for-byte unchanged until the owner authors hints.
3. Rollback: `git revert` the change. The leftover column and any stored hints are
   ignored by the reverted code (old `toAccount` selects known columns only; old
   `updateLlmProvider` patches never touch the column), so no down-migration is needed
   and hint data survives a revert/re-apply cycle. Old-binary-with-new-DB is safe for
   the same reason.

## Test-first order (TDD hook interactions)

New gateable impl files the Write/Edit TDD hook will gate (tests must land first):
`src/llm-providers/model-hints.ts`,
`src/db/migrations/084_llm_provider_model_hints.ts`,
`client/settings/components/ModelHintsEditor.svelte`. The Stryker per-file ratchet
measures all of `src/` touched here, so keep branches tight while red-green-refactoring.

Order (each red before green, per the proposal's test list):

1. `tests/llm-providers/model-hints.test.ts` — schema/`parseModelHints` edges (valid,
   missing alias, empty alias, non-object, non-string values, tolerant `{}`).
2. `tests/llm-providers/resolver.test.ts` — per-model hint overrides provider-level for
   that model; siblings and provider-level-only paths unchanged; admin + BYOK
   resolution paths.
3. `tests/llm-providers/store.test.ts` +
   `tests/db/migrations/084_llm_provider_model_hints.test.ts` — persist/round-trip,
   `null` → `{}`, verification refresh doesn't clobber, column guard idempotence.
4. `tests/byok-llm/blob-codec.test.ts` — legacy blob → `{}`, v2 round-trip, malformed
   hints on one provider leaves others intact.
5. `tests/debug/settings/admin/llm-providers-routes.test.ts` (PATCH persists, GET
   echoes, 422 malformed) + `tests/debug/settings/admin/byok-routes.test.ts` (upsert
   round-trip).
6. Client: `tests/client/settings/model-hints-editor.test.ts`
   (add/remove/preview/persist),
   `tests/client/settings/admin-providers-section.test.ts` (edit form renders editor,
   saved PATCH carries `modelHints`),
   `tests/client/settings/fetcher-schemas-llm-providers.test.ts` (schema default `{}`).
