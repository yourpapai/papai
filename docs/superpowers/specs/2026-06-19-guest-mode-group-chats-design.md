<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Guest mode for group chats — design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — ready for implementation plan
**Branch:** master (current)

## Summary

Add a per-group **guest mode** toggle. When enabled on an authorized group, any user
present in that chat who is otherwise _not_ recognized by the bot (not a bot admin, not a
platform/group admin, not in the global `users` table, not in `group_members`) is allowed
to interact with the bot — but with a **read-only** toolset. Bot admins, group admins, and
group members are unaffected and keep their existing tool-permission settings.

Guest mode is off by default. With it off, behavior is exactly as today: an unrecognized
user is denied (`group_member_not_allowed`).

## Motivation

Today an unrecognized user in an authorized group is silenced (`group_member_not_allowed`),
or gets a denial reply if they `@mention` the bot. There is no way to let arbitrary chat
participants use the bot in a safe, restricted way. Guest mode opens read-only access on a
per-group basis without granting any write capability and without promoting guests to
members.

## Key decisions (from brainstorm)

1. **"Read-only" means hard deny.** Guests receive _only_ `risk: 'read'` tools. All
   `write`, `destructive`, and `open-world` tools (`web_fetch`, MCP, plugin tools) are
   removed from their toolset entirely — not `ask`-gated. A guest can never self-approve an
   escalation. (The existing `read-only` _preset_ uses `ask`, which is wrong for an
   untrusted actor; we do not reuse it.)
2. **Guests are ephemeral — never provisioned.** Unlike `open_dm_access`, guest mode does
   **not** create `users` or `group_members` rows. If it did, the guest would match the
   member branch on their next message and silently receive full member tools. Guests are
   identified only by role at runtime. **This is the core correctness invariant.**
3. **Shared history, no memory capture.** Guests read and contribute to the live thread
   conversation/history (so the bot has context), but their turns are **excluded** from
   long-term memory capture and promotion — untrusted input never enters durable,
   group-shared memory.
4. **Abuse control v1 = toggle-off.** No per-guest block list in this version. Abuse is
   handled by turning guest mode off for the group, or platform-level kick/ban. A per-group
   guest block list is explicitly deferred.
5. **Enforcement approach: role-flag threading + fixed guest filter** (Approach A). Add an
   `isGuest` flag to the auth result, propagate an `actorRole` option into `makeTools()`,
   and apply a hardcoded read-only filter for guests that bypasses the shared per-context
   `tool_prefs`. Rejected alternatives: synthetic per-guest `tool_prefs` (wrong semantics —
   `ask`, and per-user prefs rows), and baking guest into `buildToolDescriptors` (overloads
   capability gating and pollutes the per-context descriptor cache key).

## Current behavior (grounding)

- **Auth:** `checkAuthorizationExtended` (`src/auth.ts`) order for groups: `authorized_groups`
  gate → bot admin → blocked → `users` table → platform admin → `group_members` → **deny
  (`group_member_not_allowed`)**. The terminal deny lives in `getUnauthenticatedGroupAuth`
  (`src/auth.ts`).
- **Two gates:** even an allowed user only gets an LLM turn if the message is a command, an
  `@mention`, or a reply-to-bot (`shouldIgnoreGroupMessage` in `src/bot.ts`). Unchanged by
  this feature.
- **Tool permissions are per-context, not per-user.** `tool_prefs` is keyed by the group
  context and shared by every member (`applyToolPreferences` → `resolveToolPermission` in
  `src/tools/tool-preferences.ts`, `src/tools/index.ts`). There is no per-user permission
  layer today; guest mode introduces the first per-actor distinction.
- **Risk classes:** `read | write | destructive | open-world` (`src/tools/tool-metadata.ts`).
  Read-risk tools are the search/list/get family across all domains plus `get_current_time`
  and `get_current_user`. `web_fetch`, all `mcp_*`, and all `plugin_*` tools are
  `open-world`.
- **Precedent:** `open_dm_access` is a per-_instance_ boolean on `platform_instances` with
  auto-provisioning (`added_by='open-access'`) and `blocked_at`. Guest mode is per-_group_
  and adds a tool-restriction dimension open-DM does not have; it deliberately does **not**
  auto-provision.

## Design

### Data model

- New boolean column `guest_mode` on `authorized_groups`, default `false`, per-group.
- Migration adds the column.
- Store helpers in the groups store (alongside the existing group helpers, mirroring the
  `open_dm_access` store pattern in `src/instances/platform-store.ts`):
  - `isGuestModeEnabled(groupId): boolean`
  - `setGuestMode(groupId, enabled): void`
- No new `users` rows, no new `group_members` rows for guests (invariant #2).

### Auth flow (`src/auth.ts`)

In `getUnauthenticatedGroupAuth`, add a new branch immediately **before** the terminal
`group_member_not_allowed` deny:

```
if (isGuestModeEnabled(groupConfigContextId)) {
  return { allowed: true, isGuest: true, isBotAdmin: false, isGroupAdmin: false }
}
return { allowed: false, reason: 'group_member_not_allowed' }
```

- `AuthorizationResult` gains an `isGuest?: boolean` flag (default/absent = not a guest),
  alongside the existing `isBotAdmin`/`isGroupAdmin`.
- Ordering preserved: `authorized_groups` → bot admin → **blocked** → `users` → platform
  admin → `group_members` → **guest (new)** → deny. A blocked `users`-table member cannot
  re-enter as a guest because the blocked check runs earlier.
- Guest mode is only meaningful for an already-authorized group (`group_not_allowed` still
  wins first).

### Enforcement (`src/tools/`)

- `MakeToolsOptions` gains `actorRole?: 'guest' | 'member'` (default `'member'`).
- The orchestrator derives `actorRole` from `auth.isGuest` and passes it into `makeTools()`.
- In `applyToolPreferences` (or a thin wrapper applied after it), when
  `actorRole === 'guest'`: skip the context `tool_prefs` resolution entirely and keep a tool
  **iff** `getToolMetadata(name)?.risk === 'read'`; drop everything else. Result: read-risk
  tools only; all write/destructive/`open-world` removed.
- Members (`actorRole` member or absent) are completely unchanged — they still resolve
  against the shared per-context `tool_prefs`.
- Guest enforcement reads/writes **no** per-context `tool_prefs` (assertable in tests).

### System prompt

No new work. The system prompt is already permission-aware: denied domains produce the
existing "Unavailable tools" line, so a guest's prompt truthfully reflects the restricted
set.

### Memory exclusion (`src/long-term-memory/`)

The capture pipeline is armed per group-thread turn from `llm-history.ts`. Gate the arming
on `actorRole !== 'guest'` so guest turns are never extracted. The promotion backstop only
ever sees member-authored provisional records. History read/write is untouched — guests
participate in the live thread.

### Settings UI / enabling

- Toggle lives in the **group section** of the settings SPA (`client/settings/`), visible to
  whoever can already administer that group: bot admins (super/platform) and group admins
  (the platform-admin path, resolved via `src/group-settings/admin-scope.ts`).
- New endpoint `PATCH /settings/api/group/guest-mode`, mirroring the existing
  `group/members` routes: CSRF-verified (`X-Settings-CSRF`), `requireScope`-validated
  against the group `contextId`, writing `setGuestMode`.
- Read via the existing group settings fetcher; surfaced as a simple toggle with a one-line
  caption ("Anyone in this chat can use the bot, read-only").
- Only visible/effective for authorized groups.

## Edge cases

- **No auto-provisioning** — guests get no `users`/`group_members` row; they never graduate
  to member tools. (Invariant #2.)
- **Group not authorized** → `group_not_allowed` wins first; the toggle is meaningless until
  the group is authorized.
- **Blocked existing user** → blocked check precedes the guest branch; a blocked member
  cannot slip back in as a guest.
- **Mention gate unchanged** — guests must `@mention` or reply-to-bot; ambient group
  messages are still ignored.
- **Identity tools** — `set_my_identity` is a write and is dropped for guests; only
  read-identity (`get_current_user`) survives. Guests cannot rebind identities.
- **web_fetch / MCP / plugin** — all `open-world`, all denied for guests; no per-user quota
  abuse surface.
- **Toggle off** is the v1 abuse kill-switch; platform kick/ban is the other lever.
- **DMs unaffected** — guest mode is strictly a group concept; the DM `open_dm_access` path
  is untouched.

## Testing

- **Auth** (`checkAuthorizationExtended`): guest-mode on + unknown user → `allowed, isGuest`;
  guest-mode off → `group_member_not_allowed` (regression); blocked-before-guest ordering;
  member/admin paths unchanged.
- **Enforcement** (`makeTools`/`applyToolPreferences`): `actorRole: 'guest'` yields a
  read-risk-only toolset; a member in the same context is unchanged; `actorRole` defaults to
  member when absent.
- **Memory**: capture arming is skipped for guest turns; member turns in the same thread
  still capture.
- **Store**: `isGuestModeEnabled`/`setGuestMode` round-trip; default `false`.
- **Route**: `POST /settings/api/group/guest-mode` requires CSRF + group scope; rejects
  non-admins.
- **Invariant assertion**: guest enforcement does not read or write any per-context
  `tool_prefs`.

## Out of scope (deferred)

- Per-guest block list (per-group `guest_blocks` table). v1 uses toggle-off + platform
  moderation.
- Any guest access in DMs (covered by `open_dm_access`).
- Letting guests use `open-world` (web_fetch/MCP) tools.
- Rate limiting specific to guests beyond existing per-user web-fetch quotas (moot — guests
  have no `web_fetch`).
