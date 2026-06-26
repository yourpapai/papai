<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0205: Admin Open DM Access

## Status

Implemented

## Date

2026-06-18

## Context

Before this change, opening a bot to unknown DM users required the global `DEMO_MODE` env flag. It was a restart-time, process-wide switch with a behavioral quirk: demo-auto-added users were routed through `getGroupMemberAuth` (via `isDemoUser`) instead of normal personal DM auth, producing a subtly different personal-context experience. There was no per-instance control, no admin surface to revoke an individual, and no way to block a single user without affecting everyone else — a hard-deleted user would simply re-add on the next DM under demo mode.

The 2026-06-18 spec (`docs/superpowers/specs/2026-06-18-admin-open-dm-access-design.md`) replaced `DEMO_MODE` with a per-platform-instance, admin-toggleable "open DM access" mode plus a durable per-user block, both surfaced in the settings UI. The auto-add behavior is preserved, but corrected: open-access users get normal `getDmUserAuth`, not the old group-member treatment, and each provisioned row carries `added_by = 'open-access'` so admins retain visibility and control.

Group authorization is untouched: open access is a DM-only, per-instance switch.

## Decision Drivers

- **Per-instance control over global flag.** Operators run multiple platform instances; opening one to the public must not force all of them open, and must take effect without a restart.
- **Cheap auth hot path.** The open-access check runs on every unauthorized DM; it must not require decrypting the instance `config` blob.
- **Durable, auditable revocation.** Hard-deleting a user is not a block under open access (the user re-provisions on the next DM); blocking must be a distinct, reversible state with an audit timestamp.
- **Don't leak blocked state.** A blocked user's rejection copy must be indistinguishable from a generic unauthorized DM, to avoid revealing that a block exists.
- **Remove `DEMO_MODE` entirely.** The only useful behavior (auto-add) is absorbed by open access; the env flag, `isDemoUser`, and the `demo-auto` source are deleted, not deprecated.
- **Admin precedence.** A bot admin who is also in the `users` table must not be lockable out via the block gate.

## Considered Options

### Option A: Per-instance DB column + durable `blocked_at` timestamp (chosen)

`open_dm_access` as a plain boolean column on `platform_instances` (no config decryption); `blocked_at` as a nullable timestamp on `users`.

- **Pros:** Hot-path read is a single-column select; per-instance granularity; block is reversible (`unblock` = set NULL) and auditable; no env plumbing or restart.
- **Cons:** A new migration and two schema columns; the settings UI must learn two new controls.

### Option B: Keep `DEMO_MODE`, add only the block

Preserve the global env flag, layer `blocked_at` on top.

- **Pros:** Smaller diff; no instance-store changes.
- **Cons:** Retains the restart-time global switch and the `isDemoUser` group-member quirk; cannot open a single instance independently; the env flag is invisible to the settings UI that operators are expected to use.

### Option C: Per-instance toggle, block via hard-delete + a "re-add guard" set

No new `blocked_at` column; instead, a separate denylist consulted before the open-access branch.

- **Pros:** Keeps `users` as a pure membership table.
- **Cons:** Two stores to keep consistent; no audit timestamp; harder to surface "blocked" status and an Unblock affordance in the UI; the denylist duplicates identity that already lives in `users`.

## Decision

Implement Option A in six coordinated layers.

### 1. Data model — migration 058 (`src/db/migrations/058_open_dm_access.ts`)

Two additive, plain (unencrypted) columns so the auth hot path avoids `config` decryption:

```sql
ALTER TABLE platform_instances ADD COLUMN open_dm_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN blocked_at TEXT;
```

Drizzle schema mirrors both: `platformInstances.openDmAccess` (`integer`, boolean mode, default `false`) and `users.blockedAt` (`text`, nullable). `blocked_at` is `TEXT` holding a `datetime('now')` value (auditable and reversible), not the `INTEGER` the spec sketched.

### 2. Instance store — `src/instances/platform-store.ts`

`isOpenDmAccessEnabled(id)` selects **only** the boolean column (no config decryption), returning `false` for a missing instance. `setOpenDmAccess(id, enabled)` issues a direct `update`. There is **no in-process instance cache** for `platform_instances` — the spec's cache-invalidation assumption was corrected; these helpers read/write the column directly, so a toggle takes effect on the next message.

### 3. User store — `src/users.ts`

`blockUser(userId, platformInstanceId)` and `unblockUser(...)` set/clear `blocked_at` via `UPDATE ... RETURNING`, returning `boolean` (and `evictUser` on success so the cached lookup is dropped), and `isBlocked(...)` reads the timestamp. `blockUser` returns `false` when no row exists (admins block from the Users list, which only lists existing rows). `UserRecord` and `listUsers` are extended with `blocked_at` and `added_by`. The legacy `isDemoUser` function is deleted.

### 4. Auth gate — `src/auth.ts`, `src/chat/types.ts`

A new deny reason `'user_blocked'` joins `AuthorizationDenyReason`. `checkAuthorizationExtended` is rewritten with the order:

1. group not authorized → `group_not_allowed`
2. `isAdmin` → `getAdminAuth` (admins are never blocked by the `users`-row gate)
3. `isBlocked` → new `getBlockedAuth` (reason `user_blocked`)
4. DM + not authorized + `open_dm_access` on → `addUser({ ..., addedBy: 'open-access' })` then `getDmUserAuth` (normal personal DM auth — **not** the old group-member path)
5. `isAuthorized` → `getAuthorizedUserAuth`
6. unauthenticated group → platform-admin / `isGroupMember` checks
7. DM + username → `resolveUserByUsername` (pending-rebind), allow if matched
8. fallback → `dm_not_allowed`

The `DEMO_MODE` branch, `maybeAuthorizeDemoModeUser`, and all `isDemoUser`/`demo-auto`/`getGroupMemberAuth`-for-demo logic are removed. Admin precedence (step 2) sits **above** the block gate (step 3) so a blocked `users` row cannot lock out a bot admin.

### 5. Rejection copy — `src/bot-unauthorized-reply.ts`

`user_blocked` maps to the same generic copy as `dm_not_allowed` (`"You are not authorized to use this bot."`), so a blocked user cannot tell they are blocked. (The plan placed this mapping inline in `src/bot.ts`'s `getUnauthorizedReplyText`; the implementation factored the unauthorized-reply logic into the dedicated `src/bot-unauthorized-reply.ts` module, imported by `src/bot.ts`.)

### 6. Start command — `src/commands/start.ts`

`maybeAddDemoUser`, `StartCommandDeps`, `defaultDeps`, and the `maybeAutoProvisionProvider` call are removed; `registerStartCommand(chat)` is now a welcome-only handler. Under open access the auth gate auto-adds the user _before_ the command handler runs, so `/start` needs no add logic.

### 7. Settings API — `src/debug/settings/admin/system-access-routes.ts`, `src/debug/settings-api-router.ts`

`handleOpenAccess` (`GET /settings/api/admin/open-access` → `{ openDmAccess }`; `POST` with `{ enabled }` → persists and returns it) and `handleUserBlock` (`POST /settings/api/admin/users/block` with `{ userId, blocked }` → `blockUser`/`unblockUser`, returns `{ ok }`) are added, both bot-admin scoped with `X-Settings-CSRF` enforced on writes. The Users GET already exposes the new fields via `listUsers`. The two new paths join the system/users/groups dispatch branch.

### 8. Client — `client/settings/admin-fetchers.ts`, `fetcher-schemas.ts`, `AdminUsersSection.svelte`

`OpenAccessResponseSchema` and the extended `AdminUserRowSchema` (`added_by`, `blocked_at`) are added; fetchers `fetchOpenAccess`/`patchOpenAccess`/`setUserBlocked` wrap them. `AdminUsersSection.svelte` gains an open-access toggle card, a per-row `source` badge (`manual`/`open-access`/`pending`), a `pending` badge for `placeholder-*` rows, and a Block/Unblock action alongside Remove. (The implementation loads users and access in parallel via `Promise.all`, rather than the plan's sequential `await`.)

## Consequences

### Positive

- Open DM access is a per-instance, restart-free toggle surfaced where operators already manage access.
- Auto-provisioned users are real `users` rows (`added_by = 'open-access'`), visible in the Users list and individually controllable — no more invisible demo population.
- Block is durable, reversible, and auditable (`blocked_at`); a blocked user cannot re-add under open access.
- The auth hot path reads a single plain column, never decrypting instance config.
- `DEMO_MODE`, `isDemoUser`, and the `demo-auto` group-member quirk are gone, simplifying the auth decision tree and eliminating a behavioral wart.
- Blocked status is not leaked to the user (generic rejection copy).

### Negative

- **No abuse controls beyond per-user block.** The spec explicitly defers rate-limiting; an open instance is open to anyone until an individual is blocked. Tracked as a follow-up.
- **Block is `users`-row-scoped, not admin-scoped.** A bot admin who also has a `users` row is checked for admin first and bypasses the block gate; the block only affects the non-admin `users`-row path, which matches the design but could surprise an operator expecting a universal block.
- **`blockUser` on a missing row is a no-op (`{ ok: false }`).** Admins must block from the Users list, which only lists existing rows; there is no "block a user who has never DMed" path.
- **A removed user re-adds under open access.** Hard-delete is not revocation while open access is on; the UI points admins to Block, but Remove remains available and is a footgun if open access is on.

### Risks

- **Hot-path query per unauthorized DM.** `isOpenDmAccessEnabled` and `isBlocked` each run a DB query on the unauthorized-DM path. With no instance cache, a high-volume open instance pays two selects per first-DM message. Acceptable today; a cached read can be layered if it matters.
- **`blocked_at` is `TEXT`.** Comparisons rely on SQLite's `datetime('now')` string ordering; any future code that reads `blocked_at` must treat it as a timestamp string, not a boolean.

## Related Decisions

- ADR-0136: Settings Web UI — Access Model — the bot-admin scope, `X-Settings-CSRF`, and `requireScope` guard model these routes extend.
- ADR-0190: Pending Username Entries — the `placeholder-*` rebind flow (`resolveUserByUsername`); open-access auto-add is the no-username DM counterpart that provisions a real `users` row instead.
- ADR-0139: Settings Web UI — Command Retirement — the broader move of configuration out of chat and into the settings UI that makes an admin toggle the natural surface.
- No prior ADR existed for `DEMO_MODE`; it was an undocumented env flag. This ADR records both its replacement and its removal.

## Implementation Notes

Key files confirming the implementation:

- `src/db/migrations/058_open_dm_access.ts` — `open_dm_access` (INTEGER, default 0) + `blocked_at` (TEXT); registered as the last element of `MIGRATIONS` in `src/db/index.ts`.
- `src/db/instance-schema.ts:14` — `openDmAccess` column; `src/db/schema.ts:23` — `blockedAt` column.
- `src/instances/platform-store.ts:116,125` — `isOpenDmAccessEnabled` / `setOpenDmAccess` (direct select/update, no cache).
- `src/users.ts:214,227,240` — `blockUser` / `unblockUser` / `isBlocked`; `UserRecord` + `listUsers` carry `blocked_at` and `added_by`; `isDemoUser` deleted.
- `src/chat/types.ts` — `'user_blocked'` in `AuthorizationDenyReason`.
- `src/auth.ts:239,243,217-221` — admin → block → open-access auto-add (`addedBy: 'open-access'`, `getDmUserAuth`); `maybeAuthorizeDemoModeUser` and the demo branch removed.
- `src/bot-unauthorized-reply.ts:14` — `user_blocked` → generic copy (imported by `src/bot.ts:16`).
- `src/commands/start.ts` — welcome-only handler; demo auto-add and `StartCommandDeps` removed.
- `src/debug/settings/admin/system-access-routes.ts:111,136` — `handleOpenAccess` / `handleUserBlock`; dispatch at `:196-197`; routed in `src/debug/settings-api-router.ts`.
- `client/settings/admin-fetchers.ts:124,127,130` — `fetchOpenAccess` / `patchOpenAccess` / `setUserBlocked`; `client/settings/fetcher-schemas.ts:259` — `OpenAccessResponseSchema`.
- `client/settings/sections/admin/AdminUsersSection.svelte` — open-access toggle card (`open-access-card`), `source-badge`, `pending-badge`, Block/Unblock action; parallel load via `Promise.all`.
- `tests/no-demo-mode.test.ts` — regression guard: no `src/**` file matches `/DEMO_MODE|isDemoUser|demo-auto/`.
- `CLAUDE.md` — `DEMO_MODE` removed from "Optional runtime flags"; open-access toggle documented.
