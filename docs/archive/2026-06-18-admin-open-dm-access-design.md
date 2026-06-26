<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin-Toggleable Open DM Access — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)

## Summary

Give a bot admin a per-platform-instance toggle that opens the bot to **any** user
in DMs, without pre-adding each user. When the toggle is on, an unknown user's first
DM auto-provisions a real `users` row (so the admin still sees and controls each user),
and the bot replies normally. Group authorization is unchanged.

This **replaces** the env-only `DEMO_MODE` mechanism, which did the same auto-add but
only as a global, restart-time switch with a behavioral quirk (demo users were treated
as group members). `DEMO_MODE` and its associated code are removed.

Individual users can still be **blocked** even while open access is on — a hard-delete
alone would let a blocked user re-add themselves on their next DM, so blocking is a
distinct, durable state.

## Background — current system

- **Auth gate** (`src/auth.ts` → `checkAuthorizationExtended`, ~line 187): the central
  per-message decision. Order today:
  1. group + group not authorized → deny (`group_not_allowed`)
  2. `DEMO_MODE` + unauthorized DM → `addUser({ addedBy: 'demo-auto' })`, then grant
  3. `isAdmin` → allow (bot admin)
  4. `isAuthorized` → allow
  5. unauthenticated group → platform-admin / `isGroupMember` checks
  6. unauthenticated DM + username → `resolveUserByUsername` (pending-rebind), allow if matched
  7. fallback → deny (`dm_not_allowed`)
- **DEMO_MODE specifics:** checked in `src/auth.ts` (~line 119) and `src/commands/start.ts`
  (~line 27). Demo-added users carry `added_by = 'demo-auto'`, are detected by
  `isDemoUser()`, and receive `getGroupMemberAuth()` instead of `getDmUserAuth()` — a
  subtle difference in the personal-context experience.
- **User store** (`src/users.ts`): `addUser`, `addPendingUser`, `isAuthorized`,
  `isAdmin`, `resolveUserByUsername`. `users` PK is `(platform_instance_id, platform_user_id)`;
  columns `username`, `added_at`, `added_by`. Pending entries use
  `platform_user_id = 'placeholder-<uuid>'`.
- **Instances** (`src/instances/`): DB-backed `platform_instances` with an AES-256-GCM
  encrypted `config` blob; per-table CRUD stores; DB is source of truth after migration
  `040`. Auth runs with a known `platformInstanceId`.
- **Rejection copy** (`src/bot.ts`, ~lines 48–52): `dm_not_allowed` →
  "You are not authorized to use this bot."

## Goals

- A bot admin can enable/disable open DM access **per platform instance** from the
  settings UI, taking effect without a restart.
- While on, an unknown DM user is auto-provisioned (real `users` row, `added_by =
'open-access'`) and granted normal DM auth.
- The admin can **block** an individual user durably; a blocked user is denied even
  under open access and cannot re-add on next DM.
- Remove `DEMO_MODE` entirely, replacing its only useful behavior (auto-add) with this.
- Group authorization paths are untouched.

## Non-goals

- No open access for **group** contexts (DMs only, by request).
- No global (cross-instance) open-access switch — the toggle is per platform instance.
- No rate-limiting / abuse controls beyond the existing web-fetch quota and per-user
  block (can be layered later).
- No change to the pending-username rebind flow.

## Design

### Data model (migration)

Two additive columns, both plain (unencrypted) so the hot auth path reads them without
decrypting the `config` blob:

```sql
-- platform_instances: per-instance open-access switch
ALTER TABLE platform_instances ADD COLUMN open_dm_access INTEGER NOT NULL DEFAULT 0;

-- users: durable per-user block (NULL = not blocked)
ALTER TABLE users ADD COLUMN blocked_at INTEGER;
```

`open_dm_access` lives on `platform_instances` (not the encrypted `config`) because the
auth gate must check it cheaply on every unauthorized DM; the instance row is already
loaded/cached for routing. `blocked_at` is a nullable timestamp so a block is auditable
and reversible (unblock = set NULL).

### Auth gate changes (`src/auth.ts`)

Rewrite the `checkAuthorizationExtended` decision tree:

- **Remove** the `DEMO_MODE` branch (step 2 above) and all `DEMO_MODE`/`isDemoUser`/
  `demo-auto`/`getGroupMemberAuth`-for-demo logic.
- **Add a block check** early: if a `users` row exists for `(platformInstanceId, userId)`
  with `blocked_at != NULL` → deny with a new reason `user_blocked`, regardless of open
  access or prior authorization. (A blocked admin is still an admin via `isAdmin`; block
  applies to the `users`-row path, not super/platform admins.)
- **Add the open-access branch**, positioned where `DEMO_MODE` was (after the group-not-
  authorized check, before `isAdmin`): if `contextType === 'dm'`, the user is not yet
  authorized, the instance has `open_dm_access` on, and the user is not blocked →
  `addUser({ ..., addedBy: 'open-access' })` and grant `getDmUserAuth()` (normal personal
  DM auth — **not** the old group-member treatment).

Resulting DM order: block-check → (group checks for group ctx) → open-access auto-add →
`isAdmin` → `isAuthorized` → pending-username rebind → deny.

The instance's `open_dm_access` value is read through the existing instance store/cache
(`src/instances/`), keyed by `platformInstanceId`; no per-message decryption.

### `src/users.ts`

- `addUser` accepts `addedBy: 'open-access'` (string already free-form; no schema change
  needed beyond using the new source value).
- New `blockUser({ platformInstanceId, userId })` → sets `blocked_at = now()`.
- New `unblockUser({ platformInstanceId, userId })` → sets `blocked_at = NULL`.
- `isAuthorized` continues to return true for existing rows; the **block gate lives in
  `checkAuthorizationExtended`** (so a blocked-but-present row is denied) — keep
  `isAuthorized` a pure membership check to avoid surprising other callers, and document
  that the auth gate owns block enforcement.

### Instance store / config (`src/instances/`)

- Extend the platform-instance read/CRUD store to surface `openDmAccess: boolean`.
- New store mutation `setOpenDmAccess(platformInstanceId, boolean)`; invalidate any
  cached instance snapshot so the auth gate sees the change without restart.

### Settings API

New bot-admin-scoped handler (in `src/debug/settings/admin/system-access-routes.ts`,
alongside `handleUsers`, or a small sibling file):

- `GET /settings/api/admin/open-access` → `{ openDmAccess: boolean }` for the principal's
  platform instance.
- `POST /settings/api/admin/open-access` `{ enabled: boolean }` → persists via
  `setOpenDmAccess`, returns the new state. CSRF (`X-Settings-CSRF`) + bot-admin scope
  enforced like the other admin routes.

Extend the existing **Users** GET response so each user row carries its `addedBy` source
and `blocked` boolean, and add block/unblock:

- `POST /settings/api/admin/users/block` `{ userId }` / `.../unblock` `{ userId }` (or a
  `{ action: 'block' | 'unblock' }` field on the existing user-mutation route), both
  bot-admin scoped + CSRF.

### Settings UI (`client/settings/sections/admin/AdminUsersSection.svelte`)

- A toggle card at the top: **"Open DM access"** — "Anyone can DM this bot. New users are
  added automatically and listed below; block individuals to revoke." Wired to
  `GET/POST /settings/api/admin/open-access`.
- Each user row shows a **source** label (e.g. `manual`, `open-access`, `pending`) and,
  when open access has ever been used, a **Block / Unblock** action. Blocked rows are
  visually de-emphasized with an "Unblock" affordance.
- Manual "Remove" (hard-delete) is retained; the recommended revoke action while open
  access is on is **Block** (a removed user re-adds on next DM; a blocked user does not).
- New fetchers + Zod schemas in `client/settings/admin-fetchers.ts` /
  `fetcher-schemas.ts`: open-access GET/POST, the extended user row shape, block/unblock.

### Removal of `DEMO_MODE`

- Delete the `DEMO_MODE` branch in `src/auth.ts`, `isDemoUser`, and the demo branch in
  `src/commands/start.ts`.
- Remove `DEMO_MODE` from env validation/startup (`src/index.ts`) and from `CLAUDE.md`
  "Optional runtime flags".
- Any tests asserting demo behavior are migrated to the open-access equivalents.

## Testing

- **`auth.test.ts`** (or the relevant auth suite)
  - Open access **on**: unauthorized DM → auto-added (`addedBy: 'open-access'`),
    `getDmUserAuth` granted; row exists afterward.
  - Open access **off**: unauthorized DM → `dm_not_allowed`.
  - Blocked user (`blocked_at` set): denied with `user_blocked` even with open access on,
    and not re-added.
  - Open access does **not** affect group contexts (group still requires
    `authorized_groups` / `group_members`).
  - Admin (super/platform) unaffected by `open_dm_access` and by `blocked_at` on a
    `users` row.
- **`users.test.ts`**
  - `blockUser`/`unblockUser` set/clear `blocked_at`; `addUser` with `open-access` source.
- **Instance store tests**
  - `setOpenDmAccess` persists and invalidates cache; default is `false` (0).
- **Settings route tests**
  - `GET/POST /settings/api/admin/open-access` bot-admin scope + CSRF; reflects state.
  - User block/unblock routes; Users GET exposes source + blocked.
- **Client (`tests/client/...AdminUsersSection`)**
  - Toggle renders and posts; user rows show source + block/unblock; blocked styling.
- **Regression**: a grep-level test (or knip/typecheck) confirms no remaining
  `DEMO_MODE` / `isDemoUser` / `demo-auto` references.

## Files touched

- `src/db/migrations/<next>_open_dm_access.ts` — `open_dm_access`, `blocked_at` columns.
- `src/db/schema.ts` / `src/db/instance-schema.ts` — column definitions.
- `src/auth.ts` — block gate, open-access branch, DEMO_MODE removal.
- `src/users.ts` — `blockUser`/`unblockUser`, `open-access` source.
- `src/instances/` — `openDmAccess` read + `setOpenDmAccess` mutation + cache invalidation.
- `src/commands/start.ts`, `src/index.ts` — DEMO_MODE removal.
- `src/debug/settings/admin/system-access-routes.ts` — open-access + block/unblock routes,
  extended Users response.
- `client/settings/sections/admin/AdminUsersSection.svelte` — toggle + source + block UI.
- `client/settings/admin-fetchers.ts`, `client/settings/fetcher-schemas.ts` — fetchers/schemas.
- `CLAUDE.md` — remove `DEMO_MODE`, document open-access toggle.
- Tests as above.
