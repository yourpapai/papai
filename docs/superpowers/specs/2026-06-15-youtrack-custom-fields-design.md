<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack custom-field reliability — design

**Date:** 2026-06-15
**Status:** Approved (pending implementation plan)
**Area:** `plugins/task-provider-youtrack/`, `src/tools/`, `src/providers/`

## Problem

The bot frequently fails to create YouTrack tasks because it does not understand
a project's custom-field schema, workflow-required fields, or the project's actual
allowed field values. Debug logs from 2026-06-15 show the model retrying a single
"IF" project task four different ways, each hitting a different locked door.

### Evidence (project "IF", `39-883`)

| Attempt | What the model sent                 | Error                                                                    | Layer                                                  |
| ------- | ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1, 4    | no `status`                         | `Project IF requires these custom fields: State`                         | provider pre-validation (`workflow-validation-failed`) |
| 2       | `State` in generic `customFields[]` | `Unsupported custom field for create: State`                             | provider allowlist (`validation-failed`)               |
| 3       | `status` = a slug                   | YT 400 `An Open-type entity with the specified name ({1}) was not found` | YouTrack API                                           |
| (04:49) | field's description as field name   | `Unknown custom field for create: URL адеса…`                            | provider lookup                                        |

### Root causes

`createTask` (`plugins/task-provider-youtrack/operations/tasks.ts`) can set a custom
field in only two ways:

- **4 hard-coded dedicated fields** — `State`, `Priority`, `Assignee`, `Due Date`
  (`buildCustomFields`, `task-helpers.ts`).
- **Generic `customFields[]`** — but `buildCreateIssueCustomField` only accepts
  `TextProjectCustomField` and string `SimpleProjectCustomField`; every enum / state /
  user / version field returns `undefined` → "Unsupported".

Four concrete defects:

- **D1 — No value resolution.** `status` / `priority` are passed verbatim as `{name}`;
  the `create_task` schema even steers the model toward Kaneo-style slugs (`'to-do'`),
  which never match a YouTrack bundle — fatal when state names are localized (Russian).
- **D2 — Required non-dedicated fields are a dead-end.** Any required enum / user /
  version / ownedField custom field cannot be set on create at all.
- **D3 — No schema discovery.** The model cannot see a project's required fields,
  types, or allowed values before calling `create_task`; `list_projects` returns only IDs.
- **D4 — Errors do not teach.** Messages omit valid field names/values, so the model
  cannot self-correct — it just permutes and re-fails.

## Goals / non-goals

**Goals**

1. The model can discover a project's field schema (required fields, types, allowed
   values) before creating.
2. `create_task` can set **any** required YouTrack field type by resolving values
   against the project's bundles.
3. Field values are resolved safely (deterministic, no wrong guesses on a write).
4. Failures return enough information for the model to self-correct in the same turn.

**Non-goals (v1)**

- `update_task` generalization (the same engine can be applied later).
- Group fields; fuzzy/synonym user resolution.
- Two-phase create via the YouTrack `commands` API.

## Decisions (from brainstorming)

- **Scope:** Full — discovery tool + generalized field-setting + value resolution +
  teaching errors.
- **Discovery:** Dedicated tool **and** teaching errors (belt-and-suspenders; the logs
  show the model does not reliably pre-fetch).
- **Value matching:** Safe-exact (case-insensitive + trimmed, against `name` and
  `localizedName`) and **fail-with-options** when there is no unique match. No fuzzy
  auto-pick; no silent injection of a value the model did not request.
- **Core approach:** A — unified schema-driven field engine (one code path, one source
  of truth), rather than incrementally extending the allowlist (B) or two-phase
  create-then-command (C).

## Architecture

```
src/tools/
  describe-project.ts        NEW  tool: returns project field schema for the model
  create-task.ts             EDIT generic customFields[] no longer string-only;
                                  schema/description rewritten to point at describe_project
src/providers/types.ts       EDIT optional describeProjectFields(projectId) on provider iface
plugins/task-provider-youtrack/
  field-engine.ts            NEW  resolveCustomFieldValue() + fieldType→$type mapping
  bundle-cache.ts            EDIT generalize beyond State: cache elements for
                                  enum/version/build/ownedField bundles
  task-helpers.ts            EDIT buildCreateCustomFields routes ALL fields through
                                  field-engine; required-detection also reads defaultValues;
                                  validation/resolution errors carry allowedValues payload
  operations/describe.ts     NEW  describeProjectFields(): required + types + allowedValues
  constants.ts               EDIT PROJECT_CUSTOM_FIELD_FIELDS adds defaultValues + bundle
                                  value expansion
```

**Required-detection change:** `required = canBeEmpty:false AND no usable defaultValues`.
Today the code ignores `defaultValues` entirely and over-reports — a field YouTrack would
auto-fill currently blocks creation. This is _detection only_: per the safe-exact decision
we do not silently inject a value the model did not request; we only stop raising false
"required" errors for fields YouTrack defaults on its own.

## Components

### 1. Field engine — `field-engine.ts`

`resolveCustomFieldValue(projectField, rawValue, ctx)` maps any
`field.fieldType.id` (which encodes base type + cardinality) to the correct
`IssueCustomField` payload:

| `fieldType.id`                 | IssueCustomField `$type`                | value shape           | resolve against      |
| ------------------------------ | --------------------------------------- | --------------------- | -------------------- |
| `enum[1]` / `enum[*]`          | `Single`/`MultiEnumIssueCustomField`    | `{name}` / `[{name}]` | enum bundle          |
| `state[1]`                     | `StateIssueCustomField`                 | `{name}`              | state bundle         |
| `version[1]`/`[*]`             | `Single`/`MultiVersionIssueCustomField` | `{name}`              | version bundle       |
| `ownedField[1]`/`[*]`          | `Single`/`MultiOwnedIssueCustomField`   | `{name}`              | ownedField bundle    |
| `build[1]`/`[*]`               | `Single`/`MultiBuildIssueCustomField`   | `{name}`              | build bundle         |
| `user[1]`/`[*]`                | `Single`/`MultiUserIssueCustomField`    | `{login}`             | user (`me`→identity) |
| `string` / `integer` / `float` | `SimpleIssueCustomField`                | raw                   | —                    |
| `text`                         | `TextIssueCustomField`                  | `{text}`              | —                    |
| `date` / `date and time`       | `DateIssueCustomField`                  | unix-ms               | —                    |
| `period`                       | `PeriodIssueCustomField`                | ISO/minutes           | —                    |

- **Resolver:** `normalize = trim + casefold`; match `rawValue` against
  `element.name` and `element.localizedName`. Unique match → canonical `element.name`.
  Zero / ambiguous → throw resolution error carrying `allowedValues`. Resolution happens
  **before** the POST, so YT's opaque `{1} not found` error no longer occurs.
- **Multi-value:** generic `customFields[].value` stays a string; for `[*]` fields,
  split on comma and resolve each element independently.

### 2. Bundles — `bundle-cache.ts`

Generalize to `resolveBundleElement(config, bundleType, bundleId, raw)` returning the
matched canonical element name (or throwing with `allowedValues`). `bundleType` derived
from `bundle.$type` (`EnumBundle`→enum, `StateBundle`→state, `VersionBundle`→version,
`OwnedFieldBundle`→ownedField, `BuildBundle`→build). Elements fetched once per `bundleId`
(`GET /api/admin/customFieldSettings/bundles/{type}/{bundleId}?fields=values(name,localizedName)`)
and cached. Existing `resolveStateBundle` usage is preserved.

### 3. Discovery tool — `src/tools/describe-project.ts`

- New optional provider method `describeProjectFields(projectId): Promise<ProjectFieldSchema[]>`.
- `ProjectFieldSchema = { name, type, multi, required, defaultValue?, allowedValues? }`.
  `allowedValues` capped (first 50 + "…N more") to bound tokens.
- Tool registered only when `provider.describeProjectFields` exists (YouTrack); other
  providers are unaffected.
- Tool description: "Inspect a project's fields before creating/updating a task: which
  fields are required, their types, and allowed values (e.g. valid State names). Call
  when `create_task` fails with a required/unknown-field error, or proactively before
  creating in an unfamiliar project."
- YouTrack prompt-addendum gains guidance to call `describe_project` before creating in
  an unfamiliar project and to use exact `allowedValues`.

### 4. `create_task` changes — `src/tools/create-task.ts`

- Generic `customFields[]` drops its string-only restriction; all entries route through
  the field engine.
- Dedicated `status` / `priority` / `assignee` / `dueDate` become thin shortcuts over
  the same engine.
- `status` description no longer suggests Kaneo slugs; points at `describe_project` for
  valid values.

### 5. Teaching errors — `task-helpers.ts`

- **Missing-required:** message + details list each required field with its
  `allowedValues`.
- **Resolution failure:** `Field "State": "<raw>" is not a valid value. Allowed: …`,
  with allowed values embedded in the **message string** (the channel the model reliably
  sees) and in structured `details`, both capped.

## Data flow (create_task, happy path)

1. Tool dispatch → `createYouTrackTask`.
2. Fetch project + custom fields (now incl. `defaultValues` and bundle refs).
3. Required-detection: required iff `canBeEmpty:false AND no usable defaultValues`.
   Missing required → teaching error (with `allowedValues`).
4. For each supplied field (dedicated + generic), `resolveCustomFieldValue` builds the
   `IssueCustomField` payload, resolving bundle-backed values against cached elements.
   Unresolvable → teaching error.
5. POST `/api/issues` with the fully-resolved body. (No more verbatim `{name: slug}`.)

## Error handling

- All new failures use the existing `YouTrackClassifiedError` + `providerError.*`
  classification so `errorType`/`errorCode` continue to flow through the tool-wrapper.
- Resolution moves value validation client-side; the residual YT-400 path in
  `classifyYouTrackError` remains as a fallback with a clearer message.

## Testing (DI-first per `tests/CLAUDE.md`; mock `youtrackFetch` via `setMockFetch`)

- `field-engine.test.ts` — table-driven per `fieldType.id`; bundle resolution incl.
  localized/Russian + case-insensitive; no-match throws with `allowedValues`; multi-value
  comma split; payload shapes.
- `describe-project` tool — output shape + gating when provider lacks support.
- required-detection — `defaultValues` present ⇒ not required; absent ⇒ required + error
  carries `allowedValues`.
- `createTask` integration — required State satisfied via localized match; omitted ⇒
  teaching error; previously-"Unsupported" enum field now settable; string/text
  `SimpleProjectCustomField` regression intact.
- `bundle-cache` — one fetch per `bundleId`; generic bundle types.

## Risks

- **Bundle fetch volume:** mitigated by per-`bundleId` caching within a provider instance.
- **fieldType.id coverage:** the mapping table must cover the types present in real
  projects; unknown `fieldType.id` falls back to a teaching error naming the unsupported
  type rather than a silent wrong payload.
- **Multi-value comma ambiguity:** values containing commas are rare for bundle elements;
  documented as a known limitation for v1.
