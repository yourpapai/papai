<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack relation linking — structured `/links/{linkID}/issues` fix

**Date:** 2026-06-17
**Status:** Approved (design)
**Area:** `plugins/task-provider-youtrack/relations.ts`

## Problem

`addYouTrackRelation` issues `POST /api/issues/{id}/links`. That YouTrack REST
resource is **read-only** (`GET` only), so every call returns `405 Method Not
Allowed` and all `add_task_relation` / `update_task_relation` operations against
YouTrack fail. Observed in production:

```
POST /api/issues/IF-2530/links → 405 Method Not Allowed
tool:add-task-relation  error: "YouTrack API POST /api/issues/IF-2530/links returned 405"
```

This is a regression from commit `6630fbe92` ("switch relations to REST API
`/links` endpoint"), which replaced the previously-working command API with a
`POST` to a write-unsupported endpoint and a body shape YouTrack does not accept.
Mock-only unit tests asserted only the request the code _sent_, never the real
API semantics, so CI stayed green.

### Source confirmation (JetBrains Developer Portal)

- [Issue Links](https://www.jetbrains.com/help/youtrack/devportal/resource-api-issues-issueID-links.html)
  — `/api/issues/{issueID}/links` supports **`GET` only** ("lets you **read**
  links of the issue").
- [Link Issues](https://www.jetbrains.com/help/youtrack/devportal/resource-api-issues-issueID-links-linkID-issues.html)
  — `/api/issues/{issueID}/links/{linkID}/issues` supports **`GET` and `POST`**;
  `POST` adds a link. Body is an `Issue`.
- [IssueLink](https://www.jetbrains.com/help/youtrack/devportal/api-entity-IssueLink.html)
  — `IssueLink.id` (read-only), `direction ∈ {OUTWARD, INWARD, BOTH}`.

## Decisions

| Decision           | Choice                                                   | Rationale                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                | Structured `POST /api/issues/{id}/links/{linkID}/issues` | ID-based, locale-independent, custom-link-safe — vs. the locale-fragile `/api/commands` phrase parser.                                                                                      |
| Risk posture       | **Build defensively, no live probe**                     | The directed `linkID` suffix convention and the `id`-vs-`idReadable` body shape are not pinned down by public docs; the implementation handles both at runtime.                             |
| Link-type matching | **Built-in names only**, matched by canonical `name`     | Tool exposes a fixed `RelationType` enum mapping to the four built-in link types; config-driven custom/localized overrides are out of scope (YAGNI). Failure mode is made explicit (below). |
| Resolve failure    | **Classified error + available types**                   | Throw `providerError.linkTypeNotFound(name, available[])`; no silent no-op, no command-API fallback.                                                                                        |

## Scope

In scope:

- Rewrite `addYouTrackRelation` in `plugins/task-provider-youtrack/relations.ts`.
- New private helper `resolveYouTrackLinkId` (same file).
- New `providerError.linkTypeNotFound(linkTypeName, available: string[])`
  factory in `src/providers/errors.ts`, mirroring `statusNotFound`.
- Rewrite `tests/plugins/task-provider-youtrack/relations.test.ts` to assert the
  corrected request sequence.

Out of scope (unchanged):

- `removeYouTrackRelation` — already correct (`GET` issue → find link → `DELETE
/api/issues/{id}/links/{linkId}`). `DELETE` on the specific link is supported.
- `updateYouTrackRelation` — keeps composing remove + add; benefits from the
  add-path fix automatically.
- Tool / provider-interface / settings-UI surfaces — no changes.
- `issueLinkTypes` response caching — possible later optimization, not now.

## Corrected request flow

`addYouTrackRelation(config, taskId, relatedTaskId, type)`:

1. **Map** `type` → built-in link-type name + direction via the existing
   `mapRelationTypeToLinkType` (`relates`/`depends`/`duplicate`/`subtask`) and
   `mapRelationTypeToDirection` (`OUTWARD`/`INWARD`) helpers.
2. **Resolve the directed `linkID`** via `resolveYouTrackLinkId(config, taskId,
name, direction)`:
   1. **Primary (discover):** `GET /api/issues/{taskId}/links?fields=id,direction,linkType(id,name)`.
      Find the entry whose `linkType.name` matches the target name
      (case-insensitive) **and** whose `direction` matches. Use that entry's
      `id` verbatim as `{linkID}` — no suffix construction.
   2. **Fallback (construct):** if no matching entry is present (instance does
      not surface empty link-type entries on the issue), `GET
/api/issueLinkTypes?fields=id,name,directed,sourceToTarget,targetToSource`,
      match the type by canonical `name` (case-insensitive), and build `linkID =
${type.id}${direction === 'OUTWARD' ? 's' : 't'}`.
   3. **Not found:** if neither path resolves, throw
      `providerError.linkTypeNotFound(name, availableNames)` wrapped in
      `YouTrackClassifiedError`. `availableNames` is sourced from the
      `issueLinkTypes` fetch (or the issue-links `linkType.name` set).
3. **Resolve related issue to its db id:** `GET
/api/issues/{relatedTaskId}?fields=id` → `dbId`. The POST body uses the
   canonical `id`, sidestepping the `id`-vs-`idReadable` ambiguity.
4. **Link:** `POST /api/issues/{taskId}/links/{linkID}/issues` with body `{ id:
dbId }`, query `fields=id`.
5. **Return** the unchanged shape `{ taskId, relatedTaskId, type }`.

Cost: up to 3 `GET`s + 1 `POST` per relation; acceptable for a relation
operation.

## Error handling

- All failures route through the module's existing `classifyYouTrackError` /
  `YouTrackClassifiedError` path.
- New `providerError.linkTypeNotFound(linkTypeName, available: string[])` in
  `src/providers/errors.ts`, alongside `statusNotFound`. Produces a relayable
  message, e.g. _"Link type 'Depends' not found on this YouTrack instance.
  Available: Relates, Duplicate, Subtask."_
- The `/api/commands` fallback is explicitly rejected to keep the failure signal
  clean and avoid re-introducing locale fragility.

## Testing

No YouTrack E2E harness exists (the Docker E2E is Kaneo-only), so coverage is
mock-based via `setMockFetch` sequences — corrected to assert the **real** call
sequence and method (the gap that let the original bug through):

- **Add happy path (discover):** issue-links `GET` returns a matching
  name+direction entry → assert `POST
/api/issues/{id}/links/{linkID}/issues`, body `{ id: <dbId> }`, and the
  related-issue db-id `GET`.
- **Add fallback (construct):** issue-links `GET` returns no matching entry →
  assert `issueLinkTypes` `GET` and the constructed-suffix `linkID`.
- **`linkTypeNotFound`:** unknown/renamed type on both paths → assert the
  classified error carries the available-types list.
- **Mapping cases:** port the existing `blocked_by` / `duplicate` /
  `duplicate_of` / `parent` / `child` / `related` direction+linkType assertions
  to the new request shape.
- **`updateYouTrackRelation` / `removeYouTrackRelation`:** update only where the
  shared add-path shape changed; remove-path assertions stay.

### Manual verification (pre-release)

Because we opted out of a live probe, run one real link against a YouTrack
instance before release to confirm the directed `linkID` suffix convention and
the `{ id: dbId }` body are accepted end-to-end:

```
add_task_relation(taskId=<A>, relatedTaskId=<B>, type="related")
# expect: 200, link visible in YouTrack UI on both issues
```
