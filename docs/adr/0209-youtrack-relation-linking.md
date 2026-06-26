<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0209: YouTrack Relation Linking

## Status

Implemented

## Date

2026-06-18

## Context

`addYouTrackRelation` issued `POST /api/issues/{id}/links`. That YouTrack REST resource is read-only (`GET` only), so every call returned `405 Method Not Allowed` and all `add_task_relation` / `update_task_relation` operations against YouTrack failed. This was a regression from commit `6630fbe92` ("switch relations to REST API `/links` endpoint"), which replaced the previously-working command API with a `POST` to a write-unsupported endpoint and a body shape YouTrack does not accept. The mock-only unit tests asserted only the request the code _sent_, never the real API semantics, so CI stayed green while production failed.

The 2026-06-17 design (`docs/superpowers/specs/2026-06-17-youtrack-relation-linking-design.md`) scoped the fix: rewrite `addYouTrackRelation` to use the structured `POST /api/issues/{id}/links/{linkID}/issues` endpoint (documented `GET`+`POST`), resolve the directed `linkID` defensively — discover it from the issue's own `links` collection, falling back to `/api/issueLinkTypes` + suffix construction — resolve the related issue to its database `id`, and throw a new classified `linkTypeNotFound` provider error listing the instance's available link types when resolution fails. `removeYouTrackRelation` and `updateYouTrackRelation` stay behavior-identical (update composes remove + add).

The 2026-06-18 plan (`docs/superpowers/plans/2026-06-18-youtrack-relation-linking.md`) is the source of truth for the as-built. It pinned YouTrack's canonical singular link-type names (`Depend`/`Duplicate`/`Subtask`/`Relates`) matched case-insensitively — a correctness detail the spec left implicit, since the prior code mapped `blocks`→`'depends'`, which would never match `Depend`. The plan also corrected the undirected-suffix convention (see Implementation Notes).

## Decision Drivers

- **Correctness against the real REST contract**: write to the structured `/links/{linkID}/issues` endpoint, not the read-only `/links` resource that returns 405.
- **Defensive linkID resolution**: never guess; discover from the issue's own links, fall back to `/api/issueLinkTypes`, and fail loudly with the available types rather than emitting a silent no-op.
- **Locale stability**: match on the canonical `name` field (not `localizedName`); reject the `/api/commands` phrase parser as locale-fragile and its failure mode opaque.
- **Explicit, relayable failure**: a classified `linkTypeNotFound` carries the instance's available link types so the model can self-correct instead of permuting.
- **Provider isolation**: changes are local to `plugins/task-provider-youtrack/` plus one shared error-union member; Kaneo, the tool surface, the provider interface, and the settings UI are unaffected.
- **Honest mock coverage**: tests must assert the real call sequence, method, and body — the gap that let the original bug through.

## Considered Options

### Option 1: Structured `POST /api/issues/{id}/links/{linkID}/issues` (chosen)

- **Pros**: ID-based, locale-independent, custom-link-safe; documented `GET`+`POST`; the `linkID` is resolved rather than named.
- **Cons**: requires linkID resolution (one or two extra `GET`s) plus a per-call db-id resolution; up to 3 `GET`s + 1 `POST` per add.

### Option 2: `/api/commands` phrase parser

- **Pros**: a single call, no linkID resolution.
- **Cons**: locale-fragile (link names localize); opaque failure mode; re-introduces the fragility the original command→REST move avoided. Explicitly rejected.

### Option 3: Keep `POST /api/issues/{id}/links` and fix the body shape

- **Pros**: minimal diff.
- **Cons**: the endpoint is `GET`-only; no body shape fixes a `405`. Non-starter.

## Decision

Six coordinated changes implement the fix:

### 1. `linkTypeNotFound` provider error (shared)

`src/providers/errors.ts` gains a `link-type-not-found` member on the `ProviderError` union (`{ type: 'provider'; code: 'link-type-not-found'; linkTypeName: string; available: string[] }`), a `linkTypeNotFound(linkTypeName, available)` factory on `providerError` (mirroring `statusNotFound`), and a `getProviderMessage` case producing `Link type "<name>" was not recognised. Available link types: <a, b, c>.` The new code flows to the plugin via `src/errors.ts` → `src/providers/public-types.ts` → `papai/plugin-types` with no extra export wiring.

### 2. Canonical link-type name mapping

`mapRelationTypeToLinkType` (`plugins/task-provider-youtrack/relations.ts`) now returns YouTrack's singular built-in names — `blocks`/`blocked_by`→`Depend`, `duplicate`/`duplicate_of`→`Duplicate`, `parent`/`child`→`Subtask`, `related`→`Relates` — matched case-insensitively. `mapRelationTypeToDirection` (`OUTWARD`/`INWARD`) is retained.

### 3. `resolveYouTrackLinkId` (new private helper)

`resolveYouTrackLinkId(config, taskId, linkTypeName, direction)` resolves the directed `linkID` used by the POST:

1. **Discover:** `GET /api/issues/{taskId}/links?fields=id,direction,linkType(id,name)`. Find the entry whose `linkType.name` matches case-insensitively **and** whose `direction` matches (accepting `BOTH` for undirected types like `Relates`). Use that entry's `id` verbatim — no suffix construction.
2. **Fallback (construct):** if no matching entry is surfaced, `GET /api/issueLinkTypes?fields=id,name,directed`. Match by canonical `name` (case-insensitive); build `linkID = ${type.id}${suffix}` where `suffix` is `''` for undirected types, `'s'` for `OUTWARD`, `'t'` for `INWARD`.
3. **Not found:** if neither path resolves, throw a `YouTrackClassifiedError` wrapping `providerError.linkTypeNotFound(name, availableNames)`, where `availableNames` is the `issueLinkTypes` name list.

### 4. Rewritten `addYouTrackRelation`

Map type → name + direction → resolve `linkID` → resolve the related issue's database id (`GET /api/issues/{relatedTaskId}?fields=id`) → `POST /api/issues/{taskId}/links/${linkId}/issues` with body `{ id: relatedDbId }` and query `fields=id`. The POST body is an `Issue`; YouTrack expects the canonical database `id`, sidestepping the `id`-vs-`idReadable` ambiguity. All failures route through the module's existing `classifyYouTrackError` / `YouTrackClassifiedError` path.

### 5. Unchanged `removeYouTrackRelation` / `updateYouTrackRelation`

`removeYouTrackRelation` keeps its `GET` issue → find link → `DELETE /api/issues/{id}/links/{linkId}` sequence. `updateYouTrackRelation` keeps composing remove + add, and benefits from the add-path fix automatically.

### 6. Corrected test coverage

`tests/plugins/task-provider-youtrack/relations.test.ts` is rewritten to assert the real request sequence (discover, fallback, db-id resolution, POST shape, `linkTypeNotFound`), and `tests/providers/errors.test.ts` gains a `getProviderMessage` mapping test for the new code.

## Consequences

### Positive

- `add_task_relation` / `update_task_relation` work against YouTrack; the `405` regression is closed.
- Link-type resolution is defensive and locale-stable: the common discover path needs no suffix guessing, and matching is on canonical `name`, not `localizedName`.
- Failure is explicit and teaches: `linkTypeNotFound` lists the instance's available link types, enabling model self-correction rather than permutation.
- Mock tests assert the real call sequence, method, and body, closing the gap that hid the original bug.

### Negative

- Up to 3 `GET`s + 1 `POST` per add (discover/fallback + db-id + POST). Acceptable for a relation operation, which is not a hot path.
- Link-type name mapping is hard-coded to the four built-in types; custom or renamed link types are out of scope (YAGNI) and surface only via `linkTypeNotFound`.
- `issueLinkTypes` responses are not cached; a cache is a possible later optimization, deferred now.

### Risks

- The directed `linkID` suffix convention and the `{ id: dbId }` body are not pinned by public YouTrack docs. The discover path avoids suffix guessing in the common case, but the fallback suffix construction and body shape remain unverified against a live instance pending the documented pre-release manual probe.
- No YouTrack E2E harness exists (the Docker E2E is Kaneo-only); coverage is mock-based, so live-API drift would not surface in CI. The pre-release manual check is the release gate for the fallback path.

## Related Decisions

- ADR-0052: YouTrack Full API Implementation — the original YouTrack REST surface this bug regressed from.
- ADR-0117: YouTrack Tool Parity Closure — prior YouTrack tool-surface parity work (due-date correctness, attachment context bug, priority relaxation).
- ADR-0198: YouTrack Custom-Field Reliability — sibling YouTrack reliability fix reusing the `YouTrackClassifiedError` + teaching-error pattern.
- ADR-0202: YouTrack Dedicated Fields and Teaching Errors — extends the teaching-error pattern to field names and references this ADR as a sibling relation-linking follow-up.

## Implementation Notes

Key files confirmed present in the as-built:

- `src/providers/errors.ts:38` — `link-type-not-found` union member; `:116` `linkTypeNotFound` factory; `:170` `getProviderMessage` case.
- `plugins/task-provider-youtrack/relations.ts:36` `mapRelationTypeToLinkType` (canonical singular names); `:77` `resolveYouTrackLinkId` (discover → fallback); `:134` `addYouTrackRelation` (`POST /api/issues/${taskId}/links/${linkId}/issues`, body `{ id: relatedDbId }`); `removeYouTrackRelation` / `updateYouTrackRelation` retained.
- `tests/providers/errors.test.ts` — `getProviderMessage` mapping test for `link-type-not-found`.
- `tests/plugins/task-provider-youtrack/relations.test.ts` — corrected request-sequence tests (discover, fallback, db-id resolution, POST shape, `linkTypeNotFound`, `blocked_by`/`duplicate`/`parent`/`related` mappings, remove + update).

Divergences from the plan and spec, corrected during implementation:

- **Undirected suffix convention.** The plan snippet (`relations.ts` step 3) and spec both prescribed `linkID = ${type.id}${direction === 'OUTWARD' ? 's' : 't'}`, and the plan's test expected `/api/issues/PROJ-123/links/lt-rels/issues` (suffix `'s'`) for undirected `Relates`. The as-built (`relations.ts:114`) uses `suffix = match.directed === false ? '' : direction === 'OUTWARD' ? 's' : 't'` — **no suffix** for undirected types — and the shipped test (`relations.test.ts:173`, renamed "fallback uses no suffix for an undirected link type") asserts `lt-rel`. Undirected link types carry a single link ID with no direction suffix; the implementation and tests are self-consistent and correct.
- **`getProviderMessage` wording.** The plan prescribed `Link type "<name>" was not found on this YouTrack instance. Available link types: …`. The as-built (`errors.ts:171`) ships the generic `Link type "<name>" was not recognised. Available link types: …` — not YouTrack-specific, consistent with the shared error union.
- **Fallback field set.** The spec's fallback requested `fields=id,name,directed,sourceToTarget,targetToSource`; the as-built requests only `id,name,directed`. `sourceToTarget`/`targetToSource` are unused since the `directed` boolean plus the requested direction drive the suffix.

The spec remains the source of truth for scope and request flow; the plan pinned the canonical link-type names, and the as-built corrected the undirected-suffix detail.
