<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# BYOK Self-Serve — Design

**Date:** 2026-06-24
**Status:** Approved (pending spec review)

## Problem

Bring-Your-Own-Key (BYOK) LLM credentials are gated behind a bot-admin
`enabled` flag stored per config-context in `byok_llm_credentials`. The only
caller that can flip that flag is the bot-admin route
(`PATCH /settings/api/admin/byok`), and the admin table
(`listByokAdminSummaries`) lists _only contexts that already have a row_. A
context only gets a row once BYOK is enabled or credentials are saved.

Consequence: a brand-new group (or personal DM) that has never touched BYOK
never appears in the admin table, so the admin UI offers **no affordance to
enable BYOK for it** — there is no input to name a context and turn it on. A
bot admin therefore cannot bootstrap BYOK for a specific group, and end users
see only the placeholder "BYOK is not enabled for this context. Ask a bot
admin to enable it first."

The gate adds no real value: the goal is that any personal or group context may
opt into BYOK on its own.

## Goal

Let a context owner enable BYOK for their own context, self-serve:

- **Personal (DM):** the user themselves.
- **Group:** group admins (and bot admins) — i.e. whoever can manage the
  group's settings.

Remove the bot-admin enable/disable gate. Keep the bot-admin view as a
read-only audit overview.

## Background — current architecture

- **Storage** (`src/db/byok-llm-schema.ts`): `byok_llm_credentials` keyed by
  `context_id`, with a boolean `enabled` column (default `false`), an encrypted
  config blob, and audit columns. Keyed by the **config-context id**
  (`getConfigContextIdFromStorageContextId`) — per-user for DMs, group-shared
  for groups. **This keying already supports personal and group scope; it does
  not change.**
- **Store** (`src/byok-llm/store.ts`): `enableByokForContext` /
  `disableByokForContext` flip `enabled`; `updateByokLlmConfig` persists fields
  (and sets `enabled: true`); `getByokCredentialState` returns
  `{ enabled, complete, missing, unreadable?, error? }`;
  `listByokAdminSummaries` lists existing rows.
- **Resolver** (`src/llm-config-resolver.ts`): `resolveEffectiveLlmConfig`
  branches on state — `!enabled` → central creds; `enabled && unreadable` →
  error; `enabled && !complete` → missing-fields error; complete → BYOK creds.
- **User route** (`src/debug/settings/byok-routes.ts`): `GET`/`PATCH` on
  `/settings/api/byok`, authorized by `resolveContextScope(principal, action,
contextId)`. `PATCH` currently 403s when `!enabled`.
- **Admin route** (`src/debug/settings/admin/byok-routes.ts`): `GET`/`PATCH` on
  `/settings/api/admin/byok`, guarded by `requireAdmin`. `PATCH` is the sole
  caller of `enableByokForContext` / `disableByokForContext`.
- **User UI** (`client/settings/sections/ByokSection.svelte`): shows the
  "ask a bot admin" placeholder when `!enabled`, else the 5-field editor.
- **Admin UI** (`client/settings/sections/admin/AdminByokSection.svelte`): a
  table with an Enable/Disable toggle column, visible only to `isBotAdmin`.

## Decisions (locked)

1. **Opt-in model:** self-serve **toggle** backed by the existing `enabled`
   flag. The context owner flips it; off = central creds (no error possible),
   on = BYOK with field editor.
2. **Incomplete config:** surface a hard config error (unchanged resolver
   behavior). Because the toggle is explicit, this only applies _after_ an
   owner has deliberately turned BYOK on.
3. **Admin section:** read-only audit overview; no enable/disable control.

## Design

### 1. Permission move — toggle on the user trust plane

Add an enable/disable capability to the existing user route
`PATCH /settings/api/byok`, distinct from the existing field-save mode:

- Extend the request body to support a toggle action, e.g.
  `{ contextId?, action: 'enable' | 'disable' }`, alongside the existing
  `{ contextId?, values }` save shape. The two shapes are discriminated (an
  `action` field selects toggle mode; a `values` field selects save mode).
- Authorize with the **existing** `resolveContextScope(principal, 'write',
contextId)`. Its group branch authorizes `manageableGroups` (group admins +
  bot admins); its personal branch authorizes the DM owner. No new permission
  concept is introduced.
- On `action: 'enable'` call `enableByokForContext(contextId,
principal.platformUserId)`; on `action: 'disable'` call
  `disableByokForContext(...)`.
- The existing field-save branch keeps its `!enabled` → 403 guard: you cannot
  save credentials into a context that is toggled off. The UI prevents this by
  only showing fields when enabled.

`enableByokForContext` / `disableByokForContext` in `store.ts` are unchanged.

### 2. Resolver — unchanged

`resolveEffectiveLlmConfig` keeps today's branching verbatim:
`!enabled` → central; `enabled && unreadable` → error;
`enabled && !complete` → missing-fields error; complete → BYOK. No change.

### 3. User BYOK section — toggle + conditional editor

`client/settings/sections/ByokSection.svelte`:

- Replace the "Ask a bot admin to enable it first" placeholder with a
  **"Use my own LLM credentials"** toggle bound to `currentData.enabled`.
- Toggle **off** → render only the toggle (central creds in use).
- Toggle **on** → reveal the existing 5-field editor and the existing
  "Missing required fields" / unreadable warnings.
- Flipping **on** calls the new enable action, then reloads fields; flipping
  **off** calls the disable action.
- New fetcher `patchByokToggle({ contextId, enabled })` (or extend `patchByok`)
  in `client/settings/fetchers.ts`.

### 4. Admin BYOK section — read-only overview

- `client/settings/sections/admin/AdminByokSection.svelte`: remove the
  Enable/Disable button column and the `toggle()` handler; keep the table
  (context, status, missing, updated-at, updated-by) as a read-only audit view.
- `src/debug/settings/admin/byok-routes.ts`: remove the `PATCH` branch (now
  returns `405`); keep `GET` (still `requireAdmin`). Drop the now-unused
  `enableByokForContext` / `disableByokForContext` imports there.

### 5. Settings UI

No sidebar/visibility changes. The user `byok` section stays in the Advanced
group (visible to all); the admin `byok-admin` section stays under Admin and
visible only to bot admins, now read-only.

## Out of scope (YAGNI)

- No migration to drop the `enabled` column — it remains load-bearing as the
  toggle backing store.
- No change to scope keying (`getConfigContextIdFromStorageContextId`).
- No change to `resolveEffectiveLlmConfig` or to the core of `store.ts` beyond
  removing the admin write path's exclusivity.
- No silent fallback for incomplete BYOK (explicitly rejected).

## Testing

- `tests/debug/settings/byok-routes.test.ts`
  - Toggle `enable`/`disable` authorized for a context the principal can write.
  - Toggle rejected (403) for a group the principal cannot manage / an
    unauthorized personal context.
  - Existing field-save still 403s when the context is toggled off.
  - Save mode and toggle mode are discriminated correctly (malformed body →
    422).
- `tests/debug/settings/admin/byok-routes.test.ts`
  - `GET` still returns the summaries to a bot admin.
  - `PATCH` now returns `405`.
- `tests/client/settings/byok-section.test.ts`
  - Toggle off → fields hidden; toggle on → fields revealed.
  - Flipping the toggle issues the enable/disable request.
- `tests/client/settings/admin/...` (admin section test, if present)
  - No toggle button rendered; table renders read-only rows.

## Files touched

| File                                                     | Change                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/debug/settings/byok-routes.ts`                      | Add discriminated toggle action to `PATCH`; keep field-save guard |
| `src/debug/settings/admin/byok-routes.ts`                | Remove `PATCH` branch (→ 405); keep `GET`                         |
| `client/settings/sections/ByokSection.svelte`            | Toggle + conditional field editor; replace placeholder            |
| `client/settings/sections/admin/AdminByokSection.svelte` | Remove toggle column/handler; read-only table                     |
| `client/settings/fetchers.ts`                            | Add/extend fetcher for the toggle action                          |
| `client/settings/fetcher-schemas.ts`                     | Extend request schema for the toggle action if needed             |
| Tests above                                              | Cover toggle authorization, admin 405, UI toggle behavior         |

No changes to `src/byok-llm/store.ts`, `src/byok-llm/types.ts`,
`src/llm-config-resolver.ts`, or `src/db/byok-llm-schema.ts`.
