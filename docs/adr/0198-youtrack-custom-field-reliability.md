<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0198: YouTrack Custom-Field Reliability

## Status

Implemented

## Date

2026-06-15

## Context

The bot frequently failed to create YouTrack tasks because it could not reason about a project's custom-field schema, workflow-required fields, or the project's actual allowed field values. Debug logs from 2026-06-15 (project "IF", `39-883`) show the model retrying one task four different ways, each hitting a different locked door: omitting `State` triggered `workflow-validation-failed`; setting `State` through generic `customFields[]` hit `Unsupported custom field for create: State`; passing a Kaneo-style slug (`'to-do'`) as `status` produced a YouTrack 400 (`An Open-type entity … was not found`); and the model even tried the field's description as the field name.

Four root causes (`plugins/task-provider-youtrack/operations/tasks.ts`, `task-helpers.ts`): **D1 — no value resolution** — `status`/`priority` were passed verbatim as `{name}`, and the `create_task` schema steered the model toward Kaneo slugs that never match a YouTrack bundle, fatal when state names are localized (Russian); **D2 — required non-dedicated fields were a dead-end** — `buildCreateIssueCustomField` only accepted `TextProjectCustomField` and string `SimpleProjectCustomField`, so every enum/state/user/version/ownedField field returned `undefined` → "Unsupported"; **D3 — no schema discovery** — `list_projects` returned only IDs, so the model could not see required fields, types, or allowed values before creating; **D4 — errors did not teach** — messages omitted valid field names/values, so the model permuted and re-failed instead of self-correcting.

The 2026-06-15 design (`docs/superpowers/specs/2026-06-15-youtrack-custom-fields-design.md`) scoped a full fix: a discovery tool, a generalized field-setting engine, safe-exact value resolution against project bundles, and teaching errors — and is the source of truth for the architecture described here.

## Decision Drivers

- **Write safety**: value resolution must be deterministic — no wrong guesses on a write. Bundle-backed values resolve against cached elements before the POST, so YouTrack's opaque `{1} not found` 400 no longer occurs.
- **Generality**: `create_task` must set **any** required YouTrack field type (enum, state, version, ownedField, build, user, text, simple, date, period), not just the four hard-coded dedicated fields.
- **Model self-correction**: failures must carry enough information (field names + allowed values) for the model to recover in the same turn, both proactively (`describe_project`) and reactively (teaching errors).
- **No false required errors**: required-detection must honor YouTrack `defaultValues` — a field YouTrack auto-fills must not block creation, but we never silently inject a value the model did not request (safe-exact decision).
- **Provider isolation**: non-YouTrack providers must be unaffected; the new surface is gated on an optional provider method.

## Considered Options

### Option 1: Unified schema-driven field engine (chosen)

One code path maps any `ProjectCustomField` (via `field.fieldType.id`, which encodes base type + cardinality) to the correct `IssueCustomField` payload, resolving bundle-backed values through a single cached fetcher.

- **Pros**: single source of truth; any field type settable; resolution centralized so teaching errors are uniform; trivially extensible to `update_task` later.
- **Cons**: a new module and type table to maintain; bundle fetches add a round-trip per create (mitigated by caching).

### Option 2: Incrementally extend the dedicated-field allowlist

Add more `case` branches to `buildCustomFields` for each new field type.

- **Pros**: smallest diff; no new abstraction.
- **Cons**: does not solve D2 (required non-dedicated fields remain unsettable); still no value resolution (D1) or discovery (D3); grows unbounded as projects add fields; the "Unsupported" rejection persists.

### Option 3: Two-phase create-then-command

Create the issue with minimal fields, then apply the remaining values via the YouTrack `commands` API.

- **Pros**: reuses YouTrack's own value-coercion; no client-side bundle knowledge.
- **Cons**: two writes per task (not atomic — a partial issue lingers on failure); commands API has its own error shapes that do not teach the model; does not address D3 (discovery) at all.

## Decision

Implement a unified, schema-driven field engine plus a schema-discovery tool, with safe-exact bundle resolution and teaching errors. Seven coordinated changes:

### 1. Fetch `defaultValues` + bundle-element schema

`PROJECT_CUSTOM_FIELD_FIELDS` (`plugins/task-provider-youtrack/constants.ts:57`) now requests `defaultValues(name,localizedName)`. `ProjectCustomFieldSchema` gains `defaultValues` (`schemas/bundle.ts:52`), and new `BundleElementSchema`/`BundleElementListSchema` (`schemas/bundle.ts:57`, `:63`) validate bundle-element responses.

### 2. Cached bundle-element fetcher

`bundle-values.ts` (`makeBundleElementFetcher`, `bundle-values.ts:33`) fetches `GET /api/admin/customFieldSettings/bundles/{segment}/{bundleId}/values` once per `bundleId` and caches 5 minutes, keyed by `baseUrl|segment|bundleId`. The legacy state cache stays in `bundle-cache.ts`.

### 3. Field engine — classify + resolve any field type

`field-engine.ts` exposes `classifyFieldType` (`:88`), `resolveCustomFieldValue` (`:146`), `formatAllowed` (`:104`), and `capAllowedValues` (`:109`). A `TYPE_TABLE` maps each `fieldType.id` base to its `IssueCustomField` `$type` and resolution strategy; `parseFieldTypeId` decodes the `[1]`/`[*]` cardinality. Bundle resolution normalizes (trim + casefold) and matches against both `name` and `localizedName`; a unique match returns the canonical `name`, zero/ambiguous throws a `YouTrackClassifiedError` whose message embeds `formatAllowed(allowedValues)`. Multi-value fields split on comma and resolve each element. `capAllowedValues` bounds the allowed-values list to 50 + "…N more".

### 4. Required-field detection honors `defaultValues` + teaching errors

`task-helpers.ts` exports `fetchProjectCustomFields` (`:39`); `validateRequiredCreateFields` (`:131`) now treats a field as required iff `canBeEmpty:false AND no usable defaultValues AND not supplied`, and its missing-required error lists each field with its `allowedValues` (fetched via the engine) and points the model at `describe_project`.

### 5. Route `create_task` field-building through the engine

`buildCreateCustomFields` becomes async and resolves every supplied field (dedicated `status`/`priority`/`assignee`/`dueDate` plus generic `customFields[]`) through `resolveCustomFieldValue`; `operations/tasks.ts` awaits it before the POST. (See Implementation Notes for the later rename.)

### 6. `describeProjectFields` operation + provider delegate + interface

`src/providers/types.ts` adds `ProjectFieldDescriptor` (`:46`) and the optional `describeProjectFields?(projectId)` method (`:147`); `src/providers/public-types.ts` re-exports the type (`:21`). `operations/project-fields.ts` ships `describeYouTrackProjectFields` (`:40`) — required/type/multi/default/`allowedValues` (capped) per field, with a `fetchProjectCustomFieldsViaIssue` fallback (`issue-derived-fields.ts:43`) when the admin project-fields endpoint is empty. `provider.ts` delegates (`:151`).

### 7. `describe_project` tool + registration + prompt guidance

`src/tools/describe-project.ts` (`makeDescribeProjectTool`, `:15`) returns `{ projectId, fields }`; `src/tools/tools-builder.ts` registers it only when the provider declares the `custom-fields` trait **and** implements `describeProjectFields` (`:84`). The `create_task` schema/description and the YouTrack prompt-addendum steer the model to call `describe_project` for valid values (localized State names).

## Consequences

### Positive

- Any required YouTrack field type is settable on create; the "Unsupported custom field for create" dead-end is gone.
- Bundle-backed values resolve client-side before the POST, eliminating the opaque YouTrack `{1} not found` 400.
- The model can self-correct: `describe_project` exposes required fields, types, and allowed values, and resolution/required errors carry `allowedValues` in the message string the model reliably sees.
- `defaultValues` is honored, so fields YouTrack auto-fills no longer trigger false required errors — without ever silently injecting a value the model did not request.
- Safe-exact matching (case-insensitive + localized name) handles Russian State names with no wrong guesses on writes.
- Other providers are unaffected: `describe_project` is gated on an optional provider method.

### Negative

- Each create adds bundle-element fetches (one per distinct bundle referenced); mitigated by the per-`bundleId` 5-minute cache, but a cold process start refetches.
- Multi-value `customFields[].value` splits on comma, so bundle element names containing commas are a known v1 limitation.
- `describe_project` is opt-in by the model; the logs showed the model does not reliably pre-fetch, so teaching errors remain the backstop (belt-and-suspenders by design).
- The dedicated-field legacy fallback (`legacyDedicatedPayload`) was retained for fields unknown to the project schema, preserving create behavior when project-field metadata is incomplete.

### Risks

- **`fieldType.id` coverage**: the `TYPE_TABLE` must cover the base types present in real projects; unknown `fieldType.id` falls back to a teaching error naming the unsupported type rather than a silent wrong payload.
- **In-memory bundle cache**: per-process, keyed by `baseUrl|segment|bundleId`; cache misses on restart or across processes, refetching from YouTrack.
- **Resolution moves validation client-side**: the residual YouTrack-400 path in `classifyYouTrackError` remains as a fallback with a clearer message, but is no longer the primary failure mode.

## Related Decisions

- ADR-0068: YouTrack Gap Closure — Phase-Five Tools, Custom Fields, Command Tool — the phase-five provider layer (custom-field reads, command escape hatch) this engine builds on.
- ADR-0117: YouTrack Tool Parity Closure — the immediate predecessor parity work (due-date correctness, priority contract relaxation) whose enum-from-shared-schema removal made per-project bundles the source of truth.
- ADR-0202: YouTrack Dedicated Fields — the 2026-06-16 follow-up that unified `create` and `update` into one shared builder (`buildIssueCustomFields(config, params, projectCustomFields, op)` over `collectFieldPairs`/`resolveFieldPair` in `create-field-helpers.ts`), added name-level teaching errors, and removed the legacy allowlist rejection described in the Problem section.

## Implementation Notes

Key files and confirming symbols (current codebase):

- `plugins/task-provider-youtrack/constants.ts:57` — `defaultValues(name,localizedName)` in `PROJECT_CUSTOM_FIELD_FIELDS`.
- `plugins/task-provider-youtrack/schemas/bundle.ts:52` — `defaultValues` on `ProjectCustomFieldSchema`; `:57` `BundleElementSchema`; `:63` `BundleElementListSchema`.
- `plugins/task-provider-youtrack/bundle-values.ts:33` — `makeBundleElementFetcher` (per-`bundleId` cache, 5-min TTL).
- `plugins/task-provider-youtrack/field-engine.ts:88` `classifyFieldType`; `:104` `formatAllowed`; `:109` `capAllowedValues`; `:146` `resolveCustomFieldValue`.
- `plugins/task-provider-youtrack/task-helpers.ts:39` exported `fetchProjectCustomFields`; `:131` `validateRequiredCreateFields` (honors `defaultValues`, teaching errors with `allowedValues`).
- `plugins/task-provider-youtrack/operations/project-fields.ts:40` `describeYouTrackProjectFields`; `issue-derived-fields.ts:43` `fetchProjectCustomFieldsViaIssue` (empty-admin-endpoint fallback).
- `plugins/task-provider-youtrack/provider.ts:151` `describeProjectFields` delegate.
- `src/providers/types.ts:46` `ProjectFieldDescriptor`; `:147` optional `describeProjectFields?`.
- `src/providers/public-types.ts:21` `ProjectFieldDescriptor` re-export.
- `src/tools/describe-project.ts:15` `makeDescribeProjectTool`; `src/tools/tools-builder.ts:84` registration gated on `custom-fields` trait + method presence.
- `plugins/task-provider-youtrack/operations/tasks.ts:50` — create awaits the engine-based builder before POST.

**Divergence from the design sketch:** the spec's architecture diagram named `bundle-cache.ts` (EDIT, generalized) and `operations/describe.ts` (NEW); the plan and as-built shipped the bundle-element fetcher as a separate `bundle-values.ts` (with `bundle-cache.ts` retaining the legacy state cache) and the discovery operation as `operations/project-fields.ts` → `describeYouTrackProjectFields`. The provider return type was named `ProjectFieldSchema` in the spec and shipped as `ProjectFieldDescriptor`.

**Post-follow-up shape (ADR-0202):** the plan's async `buildCreateCustomFields` (with `legacyDedicatedPayload` fallback) was later unified with the update path into `buildIssueCustomFields(config, params, projectCustomFields, op)` (`task-helpers.ts:170`) over `collectFieldPairs`/`resolveFieldPair` (`create-field-helpers.ts:31`, `:42`); `operations/tasks.ts` now calls `await buildIssueCustomFields(config, params, projectCustomFields, 'create')` (`:50`) and the same builder with `'update'` (`:92`). The "Unsupported custom field for create/update" allowlist rejection no longer exists.
