<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0190: Pending Username Entries

## Status

Implemented

## Date

2026-06-10

## Context

The settings UI admin Users section advertised "For Telegram, you can use
@username instead of numeric ID", but adding an `@username` actually failed
with `could not resolve "@username" to a user ID`. The root cause is that the
Telegram Bot API can resolve usernames only for public supergroups and channels,
never for user accounts — no Bot API method maps a user `@username` to a user ID
(only MTProto user clients can). `TelegramChatProvider.resolveUserId` therefore
always throws and the route returned 422. A secondary defect affected Discord,
whose `resolveUserId` returns `null` for non-group contexts while the admin
route always passes `contextType: 'dm'`.

This capability existed before the settings-UI migration. The retired
`/user add @username` chat command (removed in `57d0045b9`, see ADR-0139) created
`users` rows with `platform_user_id = 'placeholder-<uuid>'` and the username. The
binding half is still live: `src/auth.ts` calls `resolveUserByUsername()`
(`src/users.ts`) for unauthorized DM users, which rebinds a matching
`placeholder-*` row to the real user ID and authorizes them. Only the creation
side was lost when the chat command was retired.

The 2026-06-10 spec restores the creation side through the settings admin route,
makes the existing binding case-insensitive, collapses two duplicated
`resolveUserIdIfNeeded` copies into a single shared resolver, and surfaces
pending rows in the UI with a badge.

## Decision Drivers

- **Restore lost functionality via the settings UI**, not a re-introduced chat command — all configuration happens in the settings web UI by policy.
- **Telegram usernames are unresolvable via the Bot API** at add time, so a deferred-binding path (placeholder row → first-DM rebind) is required.
- **Telegram usernames are case-insensitive** — an admin typing `@F4Dev` must bind against the `f4dev` Telegram reports, so the username match must be case-insensitive.
- **DRY**: two near-identical `resolveUserIdIfNeeded` copies existed in the admin and group routes; a shared resolver makes their differing policies explicit.
- **Group members need strict behavior** — no group-path binding logic exists, so the group route must keep rejecting unresolvable usernames rather than creating pending entries.
- **Operator clarity**: pending (unbound) entries must be visually distinct from resolved users so admins do not mistake a `placeholder-<uuid>` for a real ID.

## Considered Options

### Option 1: Pending placeholder rows via the settings admin route (chosen)

Restore the `placeholder-<uuid>` row creation from the settings admin Users
route, falling back to it only when `router.resolveUserId` fails or is
unavailable.

- **Pros:** reuses the existing, still-live binding path in `src/auth.ts`; no
  schema change (the partial unique index `idx_users_platform_username_unique`
  already tolerates placeholder rows); matches the retired command's proven
  behavior.
- **Cons:** the user must DM the bot once to bind (group messages do not bind);
  Telegram usernames can be reassigned, so whoever holds the username at first
  contact is authorized.

### Option 2: Local-first resolution from `group_user_observations`

Resolve `@username` to an ID previously observed in groups before falling back.

- **Pros:** could bind some users without a first DM.
- **Cons:** observation-derived IDs are best-effort and stale-prone; would only
  help users who already appeared in a shared group; adds a new data dependency
  to the add path. Deferred — the `resolved` outcome short-circuits it if layered
  on later.

### Option 3: Reject `@username` in the admin UI, numeric ID only

Remove the misleading hint and require numeric IDs everywhere.

- **Pros:** simplest; no pending state.
- **Cons:** loses a real capability Telegram admins expect; Telegram numeric IDs
  are inconvenient to obtain; regresses the pre-migration UX.

## Decision

Six coordinated changes implement the feature. The resolver result is a 3-way
discriminated union so each caller can apply its own policy.

### 1. Shared settings resolver (`src/debug/settings/resolve-user-id.ts`)

A new `resolveSettingsUserId(rawUserId, principal)` returns
`SettingsUserIdResolution`:

- `{ kind: 'id'; userId }` — input is numeric after stripping `@` (no router call).
- `{ kind: 'resolved'; userId }` — `router.resolveUserId` returned an ID.
- `{ kind: 'unresolved'; username }` — the router is unavailable or returned
  `null`; `username` is the cleaned input (leading `@` stripped).

It replaces the two duplicated `resolveUserIdIfNeeded` copies in
`src/debug/settings/admin/system-access-routes.ts` and
`src/debug/settings/group-routes.ts`.

### 2. `addPendingUser` + case-insensitive binding (`src/users.ts`)

`addPendingUser(input)` strips a leading `@`, rejects an empty result, dedupes
case-insensitively against existing rows for the instance, and inserts a
`placeholder-<uuid>` row via the same insert path as `addUser`. The username
match uses `usernameMatchesInsensitive` (`sql\`lower(users.username) = lower(?)\``)
on both sides so `@F4Dev`binds against`f4dev`.

`resolveUserByUsername` adopts the same case-insensitive comparison; behavior is
otherwise unchanged — only `placeholder-*` rows rebind, a row already holding a
different real ID never rebinds.

### 3. Pending fallback in the admin users route

`POST /settings/api/admin/users`: `id`/`resolved` → `addUser(...)` → `{ ok: true }`;
`unresolved` → `addPendingUser(...)` → `{ ok: true, pending: true }`. An
`addPendingUser` failure (e.g. an input that was only `@`) maps to 422.

### 4. Strict 422 in the group members route

`POST /settings/api/group/members`: `id`/`resolved` → unchanged; `unresolved` →
422 with a clearer message: `could not resolve "<input>" to a user ID — use the
numeric user ID`.

### 5. Client response schema + fetcher

`AddAdminUserResponseSchema` gains an optional `pending: boolean`;
`addAdminUser` returns the parsed response so the UI can branch on it.

### 6. Pending badge + first-contact message (`AdminUsersSection.svelte`)

Rows whose `platform_user_id` starts with `placeholder-` render a `pending`
badge (in place of the raw UUID) in the User ID column; on `pending: true` the
status message reads "User added — they'll be authorized when they first
message the bot."; the field hint explains the pending-entry flow.

## Consequences

### Positive

- Admins can add `@username` users on Telegram and any platform where the bot
  cannot resolve the username at add time; authorization binds automatically on
  the user's first DM.
- Case-insensitive binding matches Telegram's username semantics, fixing the
  mismatch between admin-typed and Telegram-reported casing.
- The shared resolver eliminates duplication and makes the two routes'
  differing policies (pending vs. strict 422) explicit at the call site.
- The pending badge gives operators clear visibility into unbound entries;
  `removeUser` already deletes by username, so the admin Remove button works on
  pending rows.

### Negative

- Binding is DM-only — the pending user must message the bot privately once;
  group messages do not bind.
- A pending entry for a user already authorized by ID stays orphaned until
  removed manually (the dedupe prevents a duplicate, but does not delete the
  orphan).
- Telegram usernames can be reassigned; whoever holds the username at first
  contact gets the authorization. This matches the retired command's behavior
  but is inherent to username-based deferred binding.

### Risks

- **Username reassignment/squatting** — the binding trusts the username at
  first contact. Accepted; matches prior behavior.
- **Orphan accumulation** — pending rows for users who never DM the bot persist
  in `users`. Mitigated by admin Remove; no automatic expiry is implemented
  (explicitly out of scope).
- **`lower()` folding is ASCII-only** — SQLite's `lower()` does not fold
  non-ASCII. Telegram usernames are ASCII-only, so this is harmless there;
  Mattermost/Discord usernames are lowercase, so unaffected.

## Related Decisions

- ADR-0139: Settings Web UI Command Retirement — retired `/user add`, whose
  placeholder-creation behavior this restores through the settings route.
- ADR-0136: Settings Web UI Access Model — the access/authorization model the
  admin users route operates within.
- ADR-0137: Settings Web UI HTTP API — the HTTP API surface the admin and
  group-members routes belong to.
- ADR-0138: Settings Web UI Client SPA — the Svelte settings client hosting
  `AdminUsersSection`.
- ADR-0181: Admin Groups Authorization UX — the admin group/user authorization
  UX this feature extends.
- ADR-0191: Telegram Username Resolution — the platform-side
  `resolveUserId` limitation this feature compensates for.
- ADR-0205: Admin Open-DM-Access — the per-platform open-DM toggle that also
  provisions unknown DM users (a separate, broader path).

## Implementation Notes

Key files, confirming presence in the tree:

- `src/users.ts`: `addPendingUser` (line 54, returns `AddPendingUserResult`);
  `usernameMatchesInsensitive` (line 48); `resolveUserByUsername` (line 172,
  case-insensitive `where` at line 179).
- `src/debug/settings/resolve-user-id.ts`: `resolveSettingsUserId` (line 20) with
  the `SettingsUserIdResolution` union (lines 9–11) — 3-way
  `id`/`resolved`/`unresolved`.
- `src/debug/settings/admin/system-access-routes.ts`: pending fallback
  (lines 81–96) — `unresolved` → `addPendingUser`; the router is no longer
  imported directly.
- `src/debug/settings/group-routes.ts`: shared resolver import (line 19) and use
  (line 71); `unresolved` → 422 with the guidance suffix.
- `client/settings/fetcher-schemas.ts`: `AddAdminUserResponseSchema` (line 262)
  with optional `pending`.
- `client/settings/admin-fetchers.ts`: `addAdminUser` (line 119) parses
  `AddAdminUserResponseSchema`.
- `client/settings/sections/admin/AdminUsersSection.svelte`: pending badge
  (line 212, `data-testid="user-pending-badge"`), first-contact status message
  (line 80), field hint (line 176).
- `src/auth.ts`: `resolveUserByUsername` binding call (line 262) — unchanged
  location; the binding half was already live.

**Shipped refinement vs. the plan:** the plan specified `addPendingUser` returns
`boolean`. The shipped implementation returns a discriminated
`AddPendingUserResult` (`'created' | 'pending_exists' | 'already_resolved' |
'invalid'`). The route uses the richer result to return a non-pending
`{ ok: true }` when a real user already holds the username
(`'already_resolved'`), `{ ok: true, pending: true }` for `'created'` and
`'pending_exists'`, and 422 for `'invalid'`. This makes the "username already
held by a resolved user" case return the same response shape as a normal add
rather than a spurious `pending: true`.
