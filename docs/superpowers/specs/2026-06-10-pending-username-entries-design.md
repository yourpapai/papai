<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Pending Username Entries for Authorized Users

Date: 2026-06-10
Status: Approved

## Problem

The settings UI admin Users section (`client/settings/sections/admin/AdminUsersSection.svelte`)
promises "For Telegram, you can use @username instead of numeric ID", but adding
`@username` fails with `could not resolve "@username" to a user ID`.

Root cause: `TelegramChatProvider.resolveUserId` (`src/chat/telegram/index.ts`)
calls `bot.api.getChat('@username')`, but the Telegram Bot API resolves
usernames only for public supergroups and channels — never for user accounts.
No Bot API method can map a user `@username` to a user ID; only MTProto user
clients can. The call always throws 400 "Bad Request: chat not found" and the
route returns 422.

Secondary defect: `DiscordChatProvider.resolveUserId` returns `null` for
non-group contexts, and the admin route always passes `contextType: 'dm'`, so
Discord username adds fail there too.

History: this capability existed before the settings-UI migration. The retired
`/user add @username` chat command (removed in `57d0045b9`) created `users`
rows with `platform_user_id = 'placeholder-<uuid>'` and the username. The
binding half is still live: `src/auth.ts` calls `resolveUserByUsername()`
(`src/users.ts`) for unauthorized DM users, which rebinds a matching
`placeholder-*` row to the real user ID and authorizes them. Only the creation
side was lost. This design restores it through the settings route.

## Decisions

1. **Scope: authorized users only.** Pending entries apply to the admin Users
   route (`/settings/api/admin/users`). The group-members route
   (`/settings/api/group/members`) keeps requiring a resolvable ID, since
   group-side binding logic does not exist.
2. **Resolve first, then pending.** The route still attempts
   `router.resolveUserId` (Mattermost resolves via its REST API; Discord may
   resolve in group contexts). Only when resolution fails — or the chat router
   is unavailable — does the route create a pending entry instead of a 422.
3. **Case-insensitive binding.** Telegram usernames are case-insensitive;
   matching uses `lower()` on both sides so `@F4Dev` typed by an admin binds
   against `f4dev` reported by Telegram. Mattermost/Discord usernames are
   lowercase, so this is harmless there.
4. **UI: pending badge.** Placeholder rows render a `pending` badge instead of
   the raw `placeholder-<uuid>`, and the add-success message explains that the
   user is authorized on first contact.

## Design

### Data model

No schema change. A pending entry is a `users` row:

- `platform_user_id = 'placeholder-' + crypto.randomUUID()`
- `username` = input with leading `@` stripped (stored as typed otherwise)
- `platform_instance_id`, `added_by`, `added_at` as for normal rows

The partial unique index `idx_users_platform_username_unique`
(`(platform_instance_id, username) WHERE username IS NOT NULL`) guarantees one
entry per username per instance. Migration `043` and
`src/commands/announce-broadcast.ts` already tolerate placeholder rows.

### Server

**New shared helper** `src/debug/settings/resolve-user-id.ts` replaces the two
duplicated `resolveUserIdIfNeeded` copies in
`src/debug/settings/admin/system-access-routes.ts` and
`src/debug/settings/group-routes.ts`. Result union:

- `{ kind: 'id', userId }` — input is numeric (after stripping `@`).
- `{ kind: 'resolved', userId }` — `router.resolveUserId` returned an ID.
- `{ kind: 'unresolved', username }` — resolution returned `null` or the
  runtime chat router is unavailable; `username` is the cleaned input.

**Admin users route** (`POST /settings/api/admin/users`):

- `id` / `resolved` → `addUser(...)` exactly as today → `{ ok: true }`.
- `unresolved` → `addPendingUser({ username, platformInstanceId, addedBy })`
  → `{ ok: true, pending: true }`.

**Group members route** (`POST /settings/api/group/members`):

- `id` / `resolved` → unchanged.
- `unresolved` → 422 with a clearer message:
  `could not resolve "<input>" to a user ID — use the numeric user ID`.

**New function** `addPendingUser` in `src/users.ts`:

- Strips a leading `@`; rejects an empty result.
- Dedupes case-insensitively against existing rows for the instance
  (idempotent: an existing entry with the same username is a no-op success).
- Inserts the placeholder row via the same insert path as `addUser`.

**Changed function** `resolveUserByUsername` in `src/users.ts`: the username
comparison becomes case-insensitive (`lower(users.username) = lower(?)`).
Behavior is otherwise unchanged: only `placeholder-*` rows are rebound; a row
already holding a different real ID never rebinds.

### Binding flow (existing, unchanged location)

When an unauthorized user DMs the bot, `checkAuthorizationExtended`
(`src/auth.ts`) calls `resolveUserByUsername(userId, username,
platformInstanceId)`; on a placeholder match the row's `platform_user_id` is
updated to the real ID and the user is authorized.

Known limitations (accepted):

- Binding is DM-only — the pending user must message the bot privately once.
  Group messages from them do not bind.
- A pending entry for a user who is already authorized by ID stays orphaned
  until removed manually; `removeUser` already deletes by username, so the
  admin UI's Remove button works on pending rows.
- Telegram usernames can be reassigned; whoever holds the username at first
  contact gets the authorization. This matches the retired command's behavior.

### Client (`client/settings/`)

- `fetcher-schemas.ts`: add-user response schema gains optional
  `pending: boolean`.
- `admin-fetchers.ts`: `addAdminUser` returns the parsed `pending` flag.
- `AdminUsersSection.svelte`:
  - Rows whose `platform_user_id` starts with `placeholder-` render a
    `pending` badge in the User ID column instead of the raw UUID.
  - On `pending: true`, the status message reads: "User added — they'll be
    authorized when they first message the bot."
  - The field hint becomes: "For Telegram, @username adds a pending entry
    that activates when the user first messages the bot."

### Testing

TDD per repo policy (tests first, `bun run test`).

- `tests/users.test.ts` (or current location): `addPendingUser` placeholder
  shape, `@`-stripping, empty-input rejection, case-insensitive dedupe;
  `resolveUserByUsername` case-insensitive rebinding; real rows never rebind.
- Admin route tests: `@username` POST creates a pending row and returns
  `pending: true`; numeric input unchanged; router-resolved input unchanged;
  router-unavailable creates pending instead of erroring.
- Group route tests: unresolved username still 422s with the new message.
- Client tests (`tests/client/`): pending badge rendering and pending status
  message.

## Out of scope

- Pending entries for group members (would need group-path binding).
- Local-first resolution from `group_user_observations` (option 1 from the
  investigation; can be layered on later — `resolved` short-circuits it).
- Binding on group messages.
- Expiry of pending entries.
