<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin → Groups Authorization UX — Design

## Problem

A bot admin authorizes a group chat exclusively through the settings web UI
**Admin → Groups** section (`AdminGroupsSection.svelte` → `POST /settings/api/admin/groups`).
The current field is a bare free-text **"Group ID"** input whose value is stored
verbatim (`system-access-routes.ts` `handleGroups`). However, every consumer
expects the **scoped** context ID:

- the auth gate compares `isAuthorizedGroup(getGroupConfigContextId(contextId, platformInstanceId))`,
  which is `pi:<b64url(platformInstanceId)>:ctx:<b64url(nativeGroupId)>` (`auth.ts`);
- the bot-admin context-switcher fallback only accepts rows where
  `isScopedContextId(groupId)` is true and the embedded platform instance matches
  (`access.ts` `appendAuthorizedFallbackGroups`).

So an admin who types a raw chat/channel ID has it silently stored in a form that
never matches — the group is never authorized and never appears. There is also no
discovery: the bot already records groups it has seen, but the UI offers no way to
pick one.

## Goals

1. **Auto-scope raw IDs.** The "Add group" field accepts either a raw native group
   ID (auto-scoped server-side to the admin's platform instance) or an
   already-scoped `pi:…:ctx:…` ID (stored unchanged).
2. **Pick-list of observed groups.** Surface groups the bot has already observed on
   the admin's platform instance that are not yet authorized, each authorizable with
   one click.

Bot-admin only (existing `requireAdmin` guard is unchanged).

## Non-goals (YAGNI)

- Removing/editing observed-group entries.
- Multi-instance raw-ID disambiguation — the pick-list already carries correctly
  scoped IDs; raw-ID scoping uses the admin's session platform instance.
- Any change to the auth gate, observation recording, or the manageable-groups rule.

## Data model (existing, unchanged)

- `known_group_contexts(provider, contextId, displayName, parentName?, firstSeenAt, lastSeenAt)`
  — `contextId` is the **scoped** `pi:…:ctx:…` ID. Rows are written by
  `recordGroupObservation` whenever someone runs a command or @mentions the bot in a
  group.
- `authorized_groups(groupId, addedBy, addedAt)` — `groupId` is the scoped context ID;
  membership tested by exact string match (`isAuthorizedGroup`).

## Design

### 1. Backend reader — `listKnownGroupContextsForPlatform`

New function in `src/group-settings/admin-group-list.ts`:

```
listKnownGroupContextsForPlatform(platformInstanceId: string): KnownGroupContext[]
```

Selects all `known_group_contexts`, maps to `KnownGroupContext`, filters to rows
whose scoped `contextId` parses to the given `platformInstanceId` (reuse the existing
`matchesAdminPlatformInstance` helper already in `admin-group-list.ts`), sorted by
`displayName`. No `group_admin_observations` join — all observed groups on the
instance qualify.

### 2. Backend — auto-scope on POST

In `system-access-routes.ts` `handleGroups` (POST branch), normalize before
`addAuthorizedGroup`:

- `const raw = body.data.groupId.trim()`; empty → `422 { error: 'invalid request' }`.
- if `isScopedContextId(raw)` → `groupId = raw`.
- else → `groupId = toScopedContextId({ platformInstanceId: authed.principal.platformInstanceId, nativeContextId: raw })`.

Then `addAuthorizedGroup(groupId, authed.principal.platformUserId)`. DELETE is
unchanged (operates on the stored scoped ID, which the table provides).

### 3. Backend — GET returns observed groups

`GET /settings/api/admin/groups` response becomes:

```
{ groups: AuthorizedGroupRow[], observed: ObservedGroup[] }
```

where `observed = listKnownGroupContextsForPlatform(authed.principal.platformInstanceId)`
filtered to drop entries already authorized (`isAuthorizedGroup(contextId) === false`),
each shaped as `{ contextId, displayName, parentName }` (`parentName` omitted when null).
`groups` is the existing `listAuthorizedGroups()` output, unchanged.

### 4. Frontend — `AdminGroupsSection.svelte`

- New **"Observed groups"** block above the manual form, rendered only when
  `observed.length > 0`: one row per observed group showing `displayName`
  (and `parentName` when present) with an **Authorize** button that POSTs
  `{ groupId: row.contextId }`.
- Keep the manual input; relabel to **"Group ID or chat ID"** with a help line:
  "Raw chat IDs are scoped to your platform instance automatically."
- After any successful add/authorize, re-fetch both lists (existing `load()`).

### 5. Client schemas / fetchers

- `fetcher-schemas.ts`: extend the admin-groups response schema to
  `{ groups: …, observed: z.array(ObservedGroupSchema) }`, with
  `ObservedGroupSchema = { contextId: string, displayName: string, parentName: string optional }`.
- `fetchers.ts`: `fetchAdminGroups` parses the extended shape. `addAdminGroup` /
  `removeAdminGroup` are unchanged (still `{ groupId }`).

## Data flow

```
load() → GET /settings/api/admin/groups
       → { groups (authorized table), observed (pick-list) }

Authorize (pick-list) → POST { groupId: scoped contextId }  → as-is path
Add (manual, raw)     → POST { groupId: raw chat id }       → auto-scoped
Add (manual, scoped)  → POST { groupId: pi:…:ctx:… }        → as-is path
            → addAuthorizedGroup(scoped) → load() refreshes both lists
```

## Error handling

- Empty/whitespace POST → `422`.
- Already-authorized (manual or pick-list) → `addAuthorizedGroup` is idempotent
  (`onConflictDoNothing`); returns `200 { ok: true }`; the entry leaves the observed
  list on refresh.
- Scoped ID for another platform instance pasted manually → accepted as-is (stored
  verbatim), matching current behavior.

## Testing (TDD)

Server:

- `listKnownGroupContextsForPlatform` returns only matching-instance rows, sorted.
- POST auto-scope: raw → scoped stored value; already-scoped → unchanged; empty → 422.
- GET `observed` excludes authorized groups and other-instance groups; includes
  unauthorized same-instance groups.

Client:

- Observed pick-list renders rows; Authorize posts the row `contextId`.
- Manual raw-ID add still posts the typed value; lists refresh after add.
- Observed block hidden when `observed` is empty.

## Affected files

- `src/group-settings/admin-group-list.ts` (new reader)
- `src/debug/settings/admin/system-access-routes.ts` (auto-scope POST, GET observed)
- `client/settings/sections/admin/AdminGroupsSection.svelte` (pick-list + label)
- `client/settings/fetcher-schemas.ts`, `client/settings/fetchers.ts` (extended shape)
- Tests under `tests/group-settings/`, `tests/debug/settings/admin/`,
  `tests/client/settings/sections/`.
