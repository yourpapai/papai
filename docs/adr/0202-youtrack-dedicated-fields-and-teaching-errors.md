<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0202: YouTrack Dedicated Fields and Teaching Errors

## Status

Implemented

## Date

2026-06-16

## Context

The 2026-06-15 YouTrack custom-field reliability work (ADR-0198) shipped a schema-driven field engine, bundle-value resolution, and `describe_project`, but retained two rough edges. Dedicated params (`status`/`priority`/`assignee`/`dueDate`) still mapped to hard-coded English field names (`State`/`Priority`/`Assignee`) with a `legacyDedicatedPayload` fallback that emitted a fixed `{name, $type}` payload when the English name was absent from the schema. And "Unknown custom field" errors named only the bad input, never the available fields. Production logs from the localized "Аудиты ОБВС" project (`AUDIT`, `39-1118`) showed `create_task` succeeding only after **five** failed attempts: dedicated `status`/`assignee` produced `incompatible-issue-custom-field-name-State`/`-Assignee` 500s because the real fields were `Cтaтус` / `Oтветствeнный` / `Срочность`, and a truncated localized generic name failed twice because the model was never shown the exact options. This was the original design's D4 ("errors that teach"), still unimplemented for field _names_.

`update_task` was also still limited. It routed generic custom fields through a string/text-only path (`buildWriteSafeCustomFieldPayload` returned `undefined` for enum/state/user fields) and used the admin-only schema fetch, so it could not set localized enum/state/user fields at all and could not benefit from the issue-derived schema fallback on permission-restricted projects.

The 2026-06-16 design (`docs/superpowers/specs/2026-06-16-youtrack-dedicated-fields-and-teaching-errors-design.md`) scoped the fix: resolve dedicated params to the project's actual field by **type** (unique-or-fail with a canonical-name tiebreak), make unknown-field errors teach by listing the available field names, and bring `update_task` to create-parity through one shared builder. That design is the source of truth for the architecture described here.

## Decision Drivers

- **Determinism on writes**: dedicated params must resolve to the real field by type, never guessing among multiple candidates.
- **Localized projects**: the bot must set `status`/`assignee`/`priority`/`dueDate` regardless of the field's display name (Russian `Cтaтус`, etc.).
- **Model self-correction**: unknown-field errors must list the project's available field names so the model recovers in the same turn.
- **Create/update parity**: one schema-driven path should serve both operations; the string/text-only update restriction must go.
- **Backward compatibility**: English-named projects (`State`/`Assignee`/`Priority`) must keep working unchanged.
- **Provider isolation**: non-YouTrack providers must be unaffected; all changes are local to `plugins/task-provider-youtrack/`.

## Considered Options

### Option 1: Type-based dedicated resolver + shared builder (chosen)

One resolver matches `status`/`assignee`/`priority`/`dueDate` to the project's real `ProjectCustomField` by type, with a canonical-name tiebreak; a shared builder routes both create and update through the existing `resolveCustomFieldValue` engine; unknown names produce a teaching error listing the available fields.

- **Pros**: single source of truth; localized projects work without per-project config; create and update share one path; teaching errors are uniform.
- **Cons**: a new module (`dedicated-fields.ts`) and type table to maintain; dedicated-only operations on permission-restricted projects add one issue fetch.

### Option 2: Extend the hard-coded English allowlist with localized aliases

Add `Cтaтус`/`Oтветствeнный`/`Срочность` entries to the dedicated mapping and the legacy fallback.

- **Pros**: smallest diff; no new abstraction.
- **Cons**: unbounded growth as new locales/projects appear; still does not teach on unknown names; does not address `update_task` parity; `legacyDedicatedPayload` keeps emitting fixed `$type` payloads that bypass the engine's value resolution.

### Option 3: Two-phase create-then-command

Create with minimal fields, then apply the rest via the YouTrack `commands` API (already rejected in ADR-0198).

- **Pros**: reuses YouTrack's own value coercion; no client-side type knowledge for dedicated params.
- **Cons**: two writes per task (not atomic — a partial issue lingers on failure); commands errors do not teach the model; does not solve unknown-field teaching; does not address update parity.

## Decision

Six coordinated changes, all local to `plugins/task-provider-youtrack/`:

### 1. Export `normalize` from the field engine

`field-engine.ts:117` promotes the private trim+casefold helper to `export const normalize`. No behavior change; the dedicated resolver reuses the engine's own normalization for canonical-name comparison.

### 2. `field-name-error.ts` — teaching error for unknown names

`unknownFieldError(name, availableNames, op)` (`field-name-error.ts:16`) builds `Unknown custom field "<name>" for <create|update>. Available fields: A; B; C (…N more)` — names capped at 50 via `capAllowedValues`, embedded in **both** the message string (the channel the model reliably reads) and the structured `details` — and returns a `YouTrackClassifiedError` with `providerError.validationFailed('customFields', …)`.

### 3. `dedicated-fields.ts` — type-based dedicated resolver

`resolveDedicatedField(kind, projectFields)` (`dedicated-fields.ts:57`) plus the `DedicatedKind` type (`:15`) and `CANONICAL_NAMES` table (`:17`, English + Russian per kind). `state`/`user`/`date` match by type via `classifyFieldType`: unique → use; >1 → tiebreak by canonical name against both `name` and `localizedName`; else a teaching error naming the type and candidates. `priority` always requires a canonical-name match because enum fields are non-unique. Never guesses; a teaching error replaces any ambiguous case.

### 4. `create-field-helpers.ts` rewrite

`collectFieldPairs` (`create-field-helpers.ts:31`) tags dedicated params with a `kind` and generic `customFields` by name into a flat `FieldPair[]`; `resolveFieldPair` (`:42`) routes dedicated→by-type (via `resolveDedicatedField`) and generic→by-name, throwing `unknownFieldError` on a missing generic. `legacyDedicatedPayload` is deleted; every field now flows through the engine.

### 5. Shared builder + widened fallback gating (`task-helpers.ts`)

`buildIssueCustomFields(config, params, projectCustomFields, op)` (`task-helpers.ts:170`) is the single builder for create and update: it builds a by-name map, resolves each pair, and awaits `resolveCustomFieldValue` per field. `markDedicatedParamFields` (`:108`) now marks required fields satisfied by their **resolved** names; `buildHandledFieldSet` (`:73`) throws the teaching error. `validateRequiredCreateFields` widens its `needsSchema` gate (`:140`) so the issue-derived schema fallback fires whenever any dedicated param is present, not only when generic `customFields` are supplied.

### 6. Create/update parity (`operations/tasks.ts`)

`buildCreateIssueBody` calls `await buildIssueCustomFields(config, params, projectCustomFields, 'create')` (`operations/tasks.ts:50`). `buildUpdateCustomFields` (`:71`) fetches the schema (with `deriveFromIssueWhenEmpty: true`) and calls `buildIssueCustomFields(..., 'update')` (`:92`). The string/text-only `buildWriteSafeCustomField*` path and the `Unsupported custom field for update` rejection are deleted; localized enum/state/user fields are now settable on update.

## Consequences

### Positive

- Dedicated params set the real field in localized projects (`status`→`Cтaтус`) with no hard-coded English names; the `incompatible-issue-custom-field-name-*` 500s are gone.
- Unknown-field errors teach: available field names are listed in-message, enabling same-turn self-correction (the AUDIT five-attempt path collapses).
- `update_task` reaches create-parity: any settable field type works on update, plus the issue-derived schema fallback on permission-restricted projects.
- One resolution path for both operations removes the duplicate string/text-only update builder and unifies the teaching-error surface.
- Backward compatibility preserved: English-named projects resolve via the canonical-name tiebreak or the unique-type match.

### Negative

- An extra issue fetch occurs for dedicated-only creates/updates on permission-restricted projects (empty admin schema); none on admin-readable projects.
- `priority` never auto-maps among multiple enums — it requires a canonical-name match or a teaching error.
- Due-date enrichment stays keyed on the resolved field name; localized date fields may not repopulate `dueDate` (best-effort, documented limitation).
- No fuzzy/synonym matching for generic field names; only canonical-name tiebreaks for dedicated params.

### Risks

- **Multiple same-type fields with no canonical-name match** produce a teaching error rather than a silent wrong write — mitigation by design (never guess).
- **Canonical-name matching** uses `normalize` against both `name` and `localizedName`; homoglyphs only matter on the tiebreak path, so the common unique-type case never compares names.
- **Stale-build signal**: the `Unsupported custom field for update: …` string no longer exists post-merge; production logs emitting it indicate a binary that predates the merge and must be rebuilt/redeployed.

## Related Decisions

- ADR-0198: YouTrack Custom-Field Reliability — the 2026-06-15 predecessor that shipped the field engine, value resolution, and `describe_project`, whose retained `legacyDedicatedPayload` and bare unknown-field error this ADR removes.
- ADR-0117: YouTrack Tool Parity Closure — the earlier parity work whose enum-from-shared-schema removal made per-project bundles the source of truth.
- ADR-0209: YouTrack Relation Linking — a sibling YouTrack follow-up extending the tool surface to issue relations/links.

## Implementation Notes

Key files and confirming symbols (current codebase):

- `plugins/task-provider-youtrack/field-engine.ts:117` — `export const normalize` (promoted from private; reused by the dedicated resolver).
- `plugins/task-provider-youtrack/field-name-error.ts:16` — `unknownFieldError(name, availableNames, op)`; message + `details` both capped via `capAllowedValues`.
- `plugins/task-provider-youtrack/dedicated-fields.ts:15` `DedicatedKind`; `:17` `CANONICAL_NAMES` (English + Russian); `:57` `resolveDedicatedField` (type match + canonical-name tiebreak, teaching error on no-match/ambiguity).
- `plugins/task-provider-youtrack/create-field-helpers.ts:31` `collectFieldPairs`; `:42` `resolveFieldPair` (dedicated→by-type, generic→by-name); `legacyDedicatedPayload` removed.
- `plugins/task-provider-youtrack/task-helpers.ts:73` `buildHandledFieldSet` (throws `unknownFieldError`); `:108` `markDedicatedParamFields` (resolved names); `:140` widened `needsSchema` gating; `:170` `buildIssueCustomFields(config, params, projectCustomFields, op)`.
- `plugins/task-provider-youtrack/operations/tasks.ts:50` create `await buildIssueCustomFields(..., 'create')`; `:71` `buildUpdateCustomFields` (schema fetch + issue-derived fallback); `:92` update `buildIssueCustomFields(..., 'update')`.

**Divergence from the design sketch:** the plan's `matchesType` used a `switch (kind)`; the shipped version uses early-return `if` chains — behaviorally identical. The plan referenced `field.field?.localizedName` directly; the shipped `matchesCanonicalName` guards it with `?? undefined` since `ProjectCustomFieldSchema` makes `localizedName` optional. As-built commits: `e0036ba5c` (dedicated-by-type), `e73279f70` (name-level teaching errors), `6d631c11a` (shared `normalize` export), `a68da9a1c` (create/update unification), merged in PR #158.
