<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack dedicated-field localization & teaching errors — design

**Date:** 2026-06-16
**Status:** Implemented (2026-06-16) — see [As-built notes](#as-built-notes)
**Area:** `plugins/task-provider-youtrack/`
**Follows:** `2026-06-15-youtrack-custom-fields-design.md` and the issue-derived schema fallback
(`fix(youtrack): derive field schema from a sample issue when admin endpoint is empty`).

## Problem

With the issue-derived schema fallback in place, `create_task` now works in projects whose
admin `customFields` endpoint is empty (non-admin token). Production logs for the localized
"Аудиты ОБВС" project (`AUDIT`, `39-1118`) confirmed the create succeeds (`AUDIT-1403`), but
only after **five** failed attempts. Every failure was a known, fixable rough edge:

| Attempt | What the model sent                            | Error                                           |
| ------- | ---------------------------------------------- | ----------------------------------------------- |
| 1       | dedicated `status` (→ hard-coded `State`)      | `incompatible-issue-custom-field-name-State`    |
| 2       | dedicated `assignee` (→ hard-coded `Assignee`) | `incompatible-issue-custom-field-name-Assignee` |
| 3       | no required field                              | `400 empty_sd_urls` (workflow assert)           |
| 4       | generic field, **truncated** localized name    | `Unknown custom field for create: URL адеса …`  |
| 5       | exact localized name                           | ✅ created                                      |

Two root causes:

- **C1 — Dedicated params are hard-coded to English field names.** `collectCreateFieldPairs`
  maps `status`/`priority`/`assignee` to `State`/`Priority`/`Assignee`, and
  `legacyDedicatedPayload` emits a fixed `{name, $type}` payload when that English name is not
  in the schema. In a localized project the real fields are `Cтaтус` / `Oтветствeнный` /
  `Срочность`, so the dedicated params produce `incompatible-issue-custom-field-name-*` 500s.
- **C2 — "Unknown custom field" errors do not teach.** When a generic field name does not match
  the schema, the error names only the bad input — not the available field names. The model
  truncated a long localized name twice and could not self-correct, because it was never shown
  the exact options. This is the original design's D4 ("errors that teach"), still unimplemented
  for field _names_.

`update_task` is also still limited: it routes generic custom fields through a string/text-only
path (`buildWriteSafeCustomFieldPayload` returns `undefined` for enum/state/user) and uses the
admin-only schema fetch — so it cannot set localized enum/state fields at all.

## Goals / non-goals

**Goals**

1. Dedicated `status`/`assignee`/`priority` params resolve to the project's actual field by
   **type**, regardless of its (localized) name — deterministically, never guessing.
2. Unknown-field errors **teach**: list the available field names so the model self-corrects in
   the same turn.
3. `update_task` reaches parity with `create_task`: any settable field type, plus the
   issue-derived schema fallback.
4. Backward compatibility for English-named projects is preserved.

**Non-goals (v1)**

- Fuzzy/synonym matching for _generic_ field names (only canonical-name tiebreaks for dedicated
  params).
- Group fields; multi-value comma-ambiguity (unchanged from the prior spec).
- Re-keying due-date enrichment to a localized field name (stays best-effort).

## Decisions (from brainstorming)

- **Scope:** A (teaching errors) + B (dedicated-param localization) + `update_task`
  generalization.
- **Dedicated resolution:** by **type, unique-or-fail**, with a **canonical-name tiebreak** only
  when more than one field of that type exists. Never guess among multiple candidates; emit a
  teaching error instead.
- **Approach:** unified schema-driven resolver shared by create and update — every field
  (dedicated or generic) becomes a `ProjectCustomField` and flows through the existing
  `resolveCustomFieldValue` engine. `legacyDedicatedPayload` is removed.

## Architecture

```
plugins/task-provider-youtrack/
  dedicated-fields.ts        NEW  resolveDedicatedField(kind, projectFields) → matches
                                  status/assignee/priority/dueDate to the real field by TYPE
                                  (unique, with canonical-name tiebreak); throws teaching error
  field-name-error.ts        NEW  unknownFieldError(name, availableNames, op) — shared
                                  "Unknown field X; available: …" teaching error (capped)
  create-field-helpers.ts    EDIT collectCreateFieldPairs tags dedicated pairs with a `kind`
                                  ('state'|'user'|'priority'|'date') instead of a hard-coded
                                  English name; resolveFieldPair routes dedicated→by-type,
                                  generic→by-name; legacyDedicatedPayload DELETED
  task-helpers.ts            EDIT buildHandledFieldSet + buildWriteSafeCustomFieldPayload throw
                                  the new teaching error; update routes through the field engine
                                  (not string/text-only) + issue-derived fallback; dedicated
                                  required-detection uses resolved names
  operations/tasks.ts        EDIT createYouTrackTask + updateYouTrackTask share one
                                  schema-driven custom-field builder (create/update parity)
```

**Core idea:** one resolution path. Dedicated params resolve to a `ProjectCustomField` by type;
generic params resolve by name; both feed `resolveCustomFieldValue`. No hard-coded `$type`/name
payloads remain.

## Components

### 1. `dedicated-fields.ts` — `resolveDedicatedField(kind, projectFields)`

`kind ∈ { state, user, priority, date }`. Matching uses the field engine's classifier
(`classifyFieldType`) plus a shared `normalize` (trim + casefold, compared against both `name`
and `localizedName`):

| Param      | kind     | Match rule                                                                                                                                |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | state    | type `state[*]`. Unique → use; if >1 → tiebreak by canonical {`State`,`Статус`}; else teaching error                                      |
| `assignee` | user     | type `user[*]`. Unique → use; if >1 → tiebreak {`Assignee`,`Ответственный`}; else teaching error                                          |
| `priority` | priority | enum is non-unique, so **require** a name match: enum field named {`Priority`,`Приоритет`}. Exactly 1 → use; 0/ambiguous → teaching error |
| `dueDate`  | date     | type `date`/`date and time`. Unique → use; if >1 → tiebreak {`Due Date`,`Дедлайн`}; else teaching error. Value via `parseDueDateValue`    |

Returns the matched `ProjectCustomField`; the caller routes it through `resolveCustomFieldValue`
with the raw value. For `AUDIT`: `status`→`Cтaтус` (sole state field), `assignee`→`Oтветствeнный`
(sole user field), `priority`→teaching error (no Priority-named enum) directing the model to set
`Срочность` via `customFields`.

### 2. `field-name-error.ts` — `unknownFieldError(name, availableNames, op)`

Builds `Unknown custom field "<name>" for <create|update>. Available fields: A; B; C (…N more)`
— names capped at 50 (reuse `capAllowedValues`), embedded in **both** the message string and the
structured `details`. Returns a `YouTrackClassifiedError` with
`providerError.validationFailed('customFields', …)`. Replaces the bare "Unknown custom field"
throws in `buildHandledFieldSet`, `resolveFieldPair`, and `buildWriteSafeCustomFieldPayload`.

### 3. Create/update parity (`tasks.ts`, `task-helpers.ts`)

A single shared builder converts `params` (dedicated + generic) into `IssueCustomFieldPayload[]`
via the engine. `legacyDedicatedPayload` is deleted. Update drops its string/text-only
restriction so enum/state/user fields become settable on update.

- **Fallback gating widens:** derive-from-issue-when-empty now fires when **any** field needs
  setting (generic `customFields` _or_ a dedicated param present), since dedicated params now need
  the schema to resolve. On admin-readable projects the admin endpoint is non-empty, so no
  fallback fires.
- `validateRequiredCreateFields` marks required fields satisfied by their **resolved** names
  (via the same resolver), not the hard-coded `State`/`Priority`/`Assignee`.

## Data flow (create, localized project)

1. `createYouTrackTask` resolves project (`id`, `shortName`).
2. Fetch schema: admin `customFields` → empty → issue-derived fallback (fires because fields need
   setting). 8 fields, exact names.
3. `validateRequiredCreateFields`: dedicated params resolved to real fields (`status`→`Cтaтус`)
   and marked handled; required-check runs against resolved names.
4. Shared builder: each pair → `ProjectCustomField` (dedicated by type, generic by name) →
   `resolveCustomFieldValue` → payload (state/enum resolve bundle values; text/string pass through).
5. `POST /api/issues`. Update follows the identical path via `POST /api/issues/{id}`.

## Error handling

- Unknown generic name → `unknownFieldError` (lists available fields).
- Dedicated no-match/ambiguous → teaching error naming the type and candidates, steering to
  `describe_project` + `customFields`.
- Bad enum/state _value_ → existing field-engine error with `allowedValues`.
- All via `YouTrackClassifiedError` + `providerError.*`, so `errorType`/`errorCode` keep flowing
  through the tool-wrapper. Option lists are embedded in the message string and `details`, both
  capped.

## Testing (DI-first per `tests/CLAUDE.md`; mock `youtrackFetch` via `setMockFetch`)

- `dedicated-fields.test.ts` — table-driven per kind: unique-type match; localized match
  (`status`→`Cтaтус`); >1 same-type → name tiebreak; `priority` with no Priority-named enum →
  teaching error; English-project regression (`status`→`State`, `assignee`→sole/`Assignee`-named
  user field).
- `field-name-error.test.ts` — message lists available names, capped, in message + details.
- create integration — dedicated param against a localized schema sets the right field; unknown
  generic name → teaching error with available list; English-project backward-compat unchanged.
- update integration — previously-"Unsupported" enum/state now settable; issue-derived fallback on
  update; dedicated param on update resolves by type.
- Update existing create/update mocks for the widened fallback gating (dedicated params against an
  empty admin schema now make an issue-derived fetch — the correct new call sequence).

## Risks

- **Backward compatibility (multiple same-type fields):** mitigated by the canonical-name
  tiebreak; if still ambiguous, a teaching error (never a silent wrong write).
- **Extra API call** for dedicated-only creates on permission-restricted projects (one issue
  fetch); none on admin-readable projects.
- **Due-date enrichment** stays keyed on the resolved field name; for localized date fields it may
  not repopulate `dueDate` (best-effort, already swallowed) — documented limitation.
- **Homoglyph names** only matter on the name-tiebreak path; the common unique-type case never
  compares names.

## As-built notes

Implemented as designed (commits `e0036ba5c` dedicated-by-type resolution, `e73279f70`
name-level teaching errors, `6d631c11a` shared `normalize` export, `a68da9a1c` create/update
unification, `6b2394b31` lint, `522186624` final-review cleanup; merged in PR #158).

- `dedicated-fields.ts` (`resolveDedicatedField`) and `field-name-error.ts`
  (`unknownFieldError`) shipped as specified.
- `create-field-helpers.ts` carries `collectFieldPairs` / `resolveFieldPair` (dedicated→by-type,
  generic→by-name); `legacyDedicatedPayload` was deleted as planned.
- `task-helpers.ts` exposes the shared `buildIssueCustomFields(config, params,
projectCustomFields, op)`, called by both `createYouTrackTask` and `updateYouTrackTask`
  (`operations/tasks.ts`, via `buildUpdateCustomFields`). Update routes generic and dedicated
  fields through the field engine — the prior string/text-only restriction is gone, so
  localized enum/state/user fields are settable on update.
- The empty-admin-schema fallback derives fields from a sample issue
  (`fetchProjectCustomFields(…, { deriveFromIssueWhenEmpty })`).

**Deployment note:** This fix removes the `Unsupported custom field for update: …` rejection.
Production logs emitting that string after the merge indicate a **stale build** — the running
binary predates `a68da9a1c` and must be rebuilt/redeployed from current `master`. The string
exists nowhere in the post-merge codebase.
