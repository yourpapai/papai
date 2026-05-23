<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router — Phase 4: Admin Model & Dashboard

**Date:** 2026-04-13
**Status:** Approved
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)
**Depends on:** Phase 1 (Instance Data Model), Phase 3 (ChatRouter) for the Apply endpoint
**Ships independently:** Yes for the auth half; the dashboard half depends on Phase 1's tables and Phase 3's router.

## Summary

Introduce a super-admin / platform-admin / group-admin hierarchy backed by the `admins` table from Phase 1, retarget `/user add`, `/user remove`, and `/plugin approve|reject` to that hierarchy, and add `/admin#instances` dashboard pages plus REST endpoints that CRUD `platform_instances`, `task_instances`, and `admins`. The Platform Instances form's "Apply" button re-syncs the running `ChatRouter` from DB.

## Requirements

- `isAdmin(userId, platformInstanceId)` is the single authorization predicate
- `isAuthorized(userId, platformInstanceId)` accepts users added to that specific platform instance and accepts any super-admin
- `/user add` and `/user remove` insert into `users` with `platform_instance_id = msg.platformInstanceId`
- `/plugin approve` and `/plugin reject` are super-admin only; `/plugin enable|disable [context-id]` follows the existing per-context admin scoping
- Dashboard API endpoints for platform/task/admin CRUD, with secret masking
- `POST /api/platform-instances/apply` reconciles the running `ChatRouter` with the DB

## Section 1: Admin Hierarchy

| Role           | Backing                                              | Powers                                                               |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Super-admin    | `admins(user_id, '__super__')`                       | Everything; manages instances, platform admins, plugin approval      |
| Platform admin | `admins(user_id, '<platformInstanceId>')`            | Manages users on that platform instance, enables plugins per context |
| Group admin    | Existing group membership / `chat.user.isAdmin` flag | Group-level settings (unchanged)                                     |

### Predicates

```typescript
isSuperAdmin(userId): boolean
isPlatformAdmin(userId, platformInstanceId): boolean
isAdmin(userId, platformInstanceId): boolean // = isSuperAdmin || isPlatformAdmin
isAuthorized(userId, platformInstanceId): boolean // = isSuperAdmin || row in users
```

### Bootstrap source

`ADMIN_USER_ID` from env, processed during Phase 1 bootstrap, is the seed for both `admins(__super__)` and `admins(<bootstrapped-platform-id>)`. After bootstrap the env var is ignored.

## Section 2: Command Re-scoping

### `/user add` / `/user remove`

- Authorization: `isAdmin(msg.user.id, msg.platformInstanceId)`
- New user rows are written with `platform_instance_id = msg.platformInstanceId`
- A super-admin executing `/user add` on platform A only adds the user to platform A — to cover both platforms they must run it on each

### `/plugin` subcommand gating

| Subcommand          | Gating                                                  |
| ------------------- | ------------------------------------------------------- |
| `list`, `info`      | DM-only, any admin (super or platform)                  |
| `approve`, `reject` | DM-only, **super-admin only** (plugin trust is global)  |
| `enable`, `disable` | DM-only, any admin authorized for the target context-id |

Approve/reject takes effect on next startup; enable/disable on next tool/prompt assembly.

## Section 3: Dashboard Surfaces

New tab under `/admin#instances` with three sections:

1. **Platform Instances** — table, add form, per-row Start / Stop / Delete, top-level "Apply changes" button with an "unapplied changes" indicator
2. **Task Instances** — table, add form, per-row Delete (with confirmation that lists referencing contexts), no Apply button
3. **Admins** — super-admins list + per-platform admins list, add and remove rows

All forms POST to the API in Section 4. Configs are entered as key/value pairs and displayed with secret-masking from the server.

## Section 4: API Endpoints

All routes live under `src/debug/instance-routes.ts` and follow the existing `DEBUG_TOKEN` gating used by `admin-llm.ts`: GET is open when `DEBUG_TOKEN` is unset, POST/DELETE require the token.

```
GET    /api/platform-instances
POST   /api/platform-instances             { id, type, config }
DELETE /api/platform-instances/:id
POST   /api/platform-instances/apply

GET    /api/task-instances
POST   /api/task-instances                  { id, type, config }
DELETE /api/task-instances/:id

GET    /api/admins
POST   /api/admins                          { userId, platformInstanceId? }
DELETE /api/admins/:userId/:instanceId
```

- POST returns `201` and the created row with `maskConfig`-masked secrets
- DELETE returns `204`
- POST validates `id`, `type`, and `config` against a Zod schema; secret values are encrypted via Phase 1's helper before insert
- Missing `platformInstanceId` on `POST /api/admins` means super-admin (`__super__`)

## Section 5: `POST /api/platform-instances/apply`

Reconciles the running `ChatRouter` against `listActivePlatformInstances()`:

1. Compute `desired = listActivePlatformInstances()`
2. For each `existing` in `router.listInstances()` whose `id` is not in `desired`, call `router.removeInstance(existing.id)`
3. For each `want` in `desired` whose `id` is not in `router.listInstances()`, call `router.addInstance(want.id, want.type, want.config)` then `router.startInstance(want.id)`
4. Return `200 { applied: desired.length }`

If the router has not been initialized (e.g., on a brand-new install) the endpoint returns `503 { error: 'router not initialised' }`. The dashboard renders that as "Apply needs the bot to be running with `bun start`."

## Section 6: Error Handling

| Condition                                                  | Behavior                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Delete a task instance with referencing `context_settings` | Confirm-once warning; on confirmation, delete the row and the orphaned context_settings |
| Delete a platform instance still serving connections       | `removeInstance` stops the adapter first, then deletes; in-flight calls complete        |
| Encryption key missing/wrong                               | Decryption throws — surface to the dashboard as `500 { error: 'config unreadable' }`    |
| Apply with no router target set                            | `503 router not initialised`                                                            |

## Section 7: Testing Strategy

- **`tests/debug/instance-routes.test.ts`** — CRUD coverage, masked-secret response shape, 400 on schema violation, 503 on apply-without-router
- **`tests/users.test.ts`** — per-platform `isAuthorized`, super-admin shortcut
- **`tests/commands/user.test.ts`** — `/user add` writes `platform_instance_id`
- **`tests/commands/plugin.test.ts`** — `/plugin approve` rejects platform-admin, accepts super-admin; `/plugin enable` accepts any admin on the target context
- **`tests/client/admin/instances-page.test.tsx`** — Instances page renders API responses and forwards form submissions correctly

## Section 8: Out of Scope

- Cross-platform user identity linking
- Remote (non-localhost) authentication for the dashboard — still localhost-only
- Plugin capability gating per context → Phase 5
