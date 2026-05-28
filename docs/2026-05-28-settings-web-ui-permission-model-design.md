<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Permission & Scope Model Spec

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-overview-design.md`](./2026-05-28-settings-web-ui-overview-design.md)

## Scope

Given an authenticated principal (sub-spec 2), this spec defines: how the
server resolves the principal's live capabilities, how the UI switches
between editable **contexts** (personal vs each managed group), and the
exact capability matrix for each tier. It is the authority for the
server-side scope guard that every write route in sub-spec 4 must call.

## Principal

A settings principal is `(platformInstanceId, platformUserId)`, resolved
from the session. From it we derive, **per request** (not cached on the
session — see sub-spec 2 §"When is scope resolved"):

| Property | Source |
| --- | --- |
| `isBotAdmin` | `isAdmin(userId, platformInstanceId)` — `src/instances/admin-store.ts` (super or platform admin) |
| `isSuperAdmin` | `isSuperAdmin(userId)` |
| authorized? | `isAuthorized(userId, platformInstanceId)` — `src/users.ts` |
| manageable groups | groups where the principal is group admin / member-with-rights (`src/group-settings/access.ts` `listManageableGroups`, `src/groups.ts`) |

This mirrors `checkAuthorizationExtended` in `src/auth.ts`. The settings
layer should reuse that function (or a thin variant of it) rather than
re-implement the decision tree, so chat and web stay consistent.

## Context model

papai config is keyed by `storageContextId`, but **config** edits target
the *config context* (thread suffix stripped). The mapping helpers
already exist in `src/chat/scoped-context.ts`:

- Personal context: `toScopedContextId({ platformInstanceId, nativeContextId: userId })`
- Group config context: `getConfigContextIdFromStorageContextId(groupStorageContextId)`

The settings UI presents a **context switcher** whose options are:

1. **Personal** — always available to an authorized principal.
2. **Each managed group** — from `listManageableGroups(principal)`.

Every config/tool/MCP/plugin read & write carries the selected
`contextId`. The server validates that the principal is allowed to act on
that context (reuse `src/group-settings/target-validation.ts`
`getValidatedDmTargetContextId` semantics) before touching any store.

## The scope guard

A single server-side guard, called by every `/settings/api/*` handler
before it reads/writes. Conceptually:

```
requireScope(principal, {
  action: 'read' | 'write',
  target: { kind: 'personal' } | { kind: 'group', contextId } | { kind: 'admin' },
}) -> resolved contextId | 403
```

Rules:

- `kind: 'personal'` → allowed for any authorized principal; resolves to
  the principal's personal config context. A principal may only edit
  **their own** personal context — never another user's, even a
  bot admin (admins manage *system/instance* config, not other users'
  personal preference contexts, through the user-tier routes; cross-user
  changes go through admin-tier routes explicitly).
- `kind: 'group'` → allowed only if `contextId` ∈
  `listManageableGroups(principal)` **or** principal is bot admin.
- `kind: 'admin'` → allowed only if `principal.isBotAdmin` (some
  sub-actions require `isSuperAdmin`, e.g. plugin approve/reject and
  admin-roster changes — match current `/plugin` and `/user` gating).

The guard returns the concrete, validated `contextId` the handler must
use, so handlers never trust a client-supplied context blindly.

## Capability matrix

Legend: ✓ allowed, ✗ denied, (own) = only the principal's own context,
(mg) = only managed groups, (SA) = super-admin only.

| Capability | Regular user | Group admin | Bot admin |
| --- | :--: | :--: | :--: |
| Edit personal `timezone` | ✓ (own) | ✓ (own) | ✓ (own) |
| Edit personal task-provider creds (`kaneo_apikey`, `youtrack_token`) | ✓ (own) | ✓ (own) | ✓ (own) |
| Personal tool toggles (`tool_prefs`) | ✓ (own) | ✓ (own) | ✓ (own) |
| Personal MCP endpoints | ✓ (own) | ✓ (own) | ✓ (own) |
| Personal plugin enable/disable | ✓ (own) | ✓ (own) | ✓ (own) |
| Identity mapping (own context) | ✓ (own) | ✓ (own) | ✓ (own) |
| Group config (timezone/creds/tools/MCP) | ✗ | ✓ (mg) | ✓ |
| Group plugin enable/disable | ✗ | ✓ (mg) | ✓ |
| Group task-instance selection | ✗ | ✓ (mg) | ✓ |
| Group member add/remove (`group_members`) | ✗ | ✓ (mg) | ✓ |
| Authorize/de-authorize groups (`authorized_groups`) | ✗ | ✗ | ✓ |
| Authorized users add/remove (`users`) | ✗ | ✗ | ✓ |
| Admin roster (super/platform admins) | ✗ | ✗ | ✓ (SA) |
| Platform/task instances CRUD | ✗ | ✗ | ✓ |
| System LLM config | ✗ | ✗ | ✓ |
| Plugin approve/reject | ✗ | ✗ | ✓ (SA) |
| Announce to all users | ✗ | ✗ | ✓ |

This matrix is the canonical reference for the route table in sub-spec 4
and the section gating in sub-spec 5.

## Config-field visibility

Within an allowed context, the *set of editable config fields* is still
computed by `getConfigFieldsForContext(contextId)` (`src/config-keys.ts`),
which already filters by the context's assigned task provider and hides
reserved keys (e.g. `kaneo_workspace_id`). The UI must render fields from
this function rather than a hardcoded list, so provider differences
(Kaneo vs YouTrack vs plugin providers) flow through unchanged.

Sensitive fields (`isSensitiveKey`) are masked on read (mirror
`maskSensitiveValue`) and write-only on update.

## Consistency requirement

Because chat-side authorization and web-side authorization must never
diverge, the implementation should:

- Reuse `checkAuthorizationExtended` / the `src/instances/admin-store.ts`,
  `src/users.ts`, `src/authorized-groups.ts`, `src/groups.ts` stores
  directly.
- Reuse `src/group-settings/access.ts` + `target-validation.ts` for the
  manageable-group set and target validation.
- Add no parallel permission tables. The web layer is a new *caller* of
  existing authorization, not a new authority.

## Open questions

- OQ-P1 — Should a bot admin be able to edit *another user's* personal
  context through the UI (impersonation-style support), or strictly only
  system/instance/authorization config? This spec assumes the latter;
  confirm.
- OQ-P2 — Group "admin" definition for the web context switcher: today it
  derives from `isPlatformAdmin`-in-context + `listManageableGroups`.
  Confirm whether web sessions (which lack live chat-platform admin
  signals) can determine group-admin status purely from stored state, or
  need a cached `isGroupAdmin` snapshot taken at code-issuance time in
  chat.
