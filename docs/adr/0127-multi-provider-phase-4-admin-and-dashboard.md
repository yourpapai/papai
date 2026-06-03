<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0127: Multi-Provider Phase 4: Admin Authorization & Dashboard

## Status

Implemented

## Date

2026-04-13 – 2026-05-24

## Context

After Phase 1 (instance data model with `platform_instances`, `task_instances`,
`admins` tables) and Phase 3 (`ChatRouter` with `addInstance`/`removeInstance`/
`startInstance`), authorization still relied on `process.env.ADMIN_USER_ID` and
global `users` rows. Every platform instance shared the same flat admin and user
list, so a Telegram admin could manage Discord users and vice-versa. The
`users.platform_instance_id` column added by migration 040 was not wired into
the Drizzle schema or authorization helpers.

The `/admin` dashboard had no UI for managing platform instances, task
instances, or admin rows — operators had to edit the database directly. There
was no way to re-sync the running `ChatRouter` after making DB changes.

Spec: `docs/archive/2026-04-13-multi-provider-phase-4-admin-and-dashboard.md`
Plan: `docs/archive/2026-05-24-multi-provider-phase-4-admin-and-dashboard-plan.md`

## Decision Drivers

- **Platform-scoped authority**: Admins on one platform instance must not
  implicitly hold authority over another.
- **Super-admin trust boundary**: Plugin approval and cross-platform operations
  need a role above platform admin.
- **No env-var runtime auth**: `ADMIN_USER_ID` is for first-run bootstrap only;
  runtime reads the `admins` table.
- **Live reconciliation**: Operators must be able to apply DB changes to the
  running router without a full restart.
- **Secret masking**: Dashboard API must never return plaintext credentials.

## Considered Options

### Option A: Keep global `ADMIN_USER_ID` as sole admin source

All platform instances share one admin identity from env; no hierarchy.

- **Pros**: No migration; simplest implementation.
- **Cons**: Cannot distinguish operators across platforms; no delegated admin;
  env-var dependency at runtime.

### Option B: Super-admin / platform-admin hierarchy with dashboard CRUD (chosen)

`admins` table rows define a two-tier hierarchy. Dashboard API exposes masked
CRUD for all instance types. Apply endpoint reconciles the live router.

- **Pros**: Platform-scoped delegation; no runtime env-var dependency; operators
  can manage instances from the dashboard; live apply avoids restarts.
- **Cons**: More surface area (API routes, client section, migration 041);
  apply only works when the bot process is running.

### Option C: Per-platform admin with separate auth tables per instance

Each platform instance gets its own `admins` table.

- **Pros**: Full isolation.
- **Cons**: Schema explosion; super-admin role becomes awkward; no cross-platform
  visibility for operators.

## Decision

**Option B** with the following subsidiary decisions:

| Topic                        | Decision                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Admin hierarchy              | Super-admin (`admins(user_id, '__super__')`) has all powers; platform admin (`admins(user_id, '<platformInstanceId>)`) manages users and plugin enablement on that instance. |
| Auth predicates              | `isSuperAdmin(userId)`, `isPlatformAdmin(userId, platformInstanceId)`, `isAdmin(userId, platformInstanceId) = isSuperAdmin \|\| isPlatformAdmin`.                            |
| User authorization           | `isAuthorized(userId, platformInstanceId)` checks `users` rows scoped by `platform_instance_id` and also accepts any super-admin.                                            |
| Command scoping              | `/user add`/`/user remove` write and delete rows scoped to `msg.platformInstanceId`. `/plugin approve                                                                        | reject` is super-admin only. |
| `checkAuthorizationExtended` | Receives `platformInstanceId` as a parameter; replaces env-var admin check with `isAdmin()` from `admins` table.                                                             |
| Dashboard API                | `src/debug/instance-routes.ts` — JSON CRUD for platform instances, task instances, admins; Zod-validated; secret masking via `maskConfig()`.                                 |
| Apply endpoint               | `POST /api/platform-instances/apply` reconciles the running `ChatRouter` against `listActivePlatformInstances()`. Returns `503` when the router is not initialized.          |
| Router listing               | `ChatRouter.listInstances()` returns readonly snapshots of managed instances for apply reconciliation.                                                                       |
| Runtime router access        | `src/debug/chat-router-runtime.ts` holds the active `ChatRouter` reference; set at startup, cleared at shutdown.                                                             |
| Migration                    | `041_users_platform_instance_index` adds composite indexes on `users(platform_instance_id, platform_user_id)` and `(platform_instance_id, username)`.                        |
| Client section               | `/admin#instances` — three tables (platform instances, task instances, admins) with add forms, start/stop/delete actions, and apply button.                                  |

## Consequences

### Positive

- Platform-scoped authority prevents cross-instance privilege escalation.
- Super-admin / platform-admin split allows delegated operations without
  exposing plugin trust (approve/reject) to platform admins.
- Runtime authorization reads `admins`, not `ADMIN_USER_ID`, so adding or
  removing admins takes effect immediately without restart.
- Dashboard API with secret masking lets operators manage instances safely.
- Apply endpoint enables live router reconfiguration without full process
  restart.
- Migration 041 indexes make platform-scoped user queries efficient.

### Negative

- Apply only works when the bot is running; a stopped bot requires restart to
  pick up DB changes.
- Admin hierarchy adds complexity to command handlers — every admin-gated
  command must pass `platformInstanceId`.
- Task instance deletion cascades to `context_settings`, requiring confirmation
  in the dashboard UI.

### Risks

- If the runtime router reference (`chat-router-runtime.ts`) is not cleared
  during a crash shutdown, a stale reference could be returned by
  `getRuntimeChatRouter()`. Mitigation: apply returns `503` when the router is
  null, which is the safe default.
- `SUPER_ADMIN_PLATFORM_ID` (`__super__`) is a magic string in the `admins`
  table. A future migration could normalize this into a dedicated column or
  enum, but the current sentinel value is unambiguous and indexed.

## Implementation Notes

Key modules:

| File                                            | Role                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `src/instances/admin-store.ts`                  | `isSuperAdmin()`, `isPlatformAdmin()`, `isAdmin()`, `listAdmins()` predicates                           |
| `src/auth.ts`                                   | `checkAuthorizationExtended()` receives `platformInstanceId`, delegates to `isAdmin()`                  |
| `src/users.ts`                                  | Platform-scoped `addUser()`, `removeUser()`, `isAuthorized()`, `resolveUserByUsername()`, `listUsers()` |
| `src/commands/admin.ts`                         | `/user`, `/users`, `/announce` gated by `isAdmin()` and scoped to source platform                       |
| `src/commands/plugin.ts`                        | `/plugin approve                                                                                        | reject`gated by`isSuperAdmin()`; `enable | disable` checks target context ownership |
| `src/debug/instance-routes.ts`                  | CRUD handlers for `/api/platform-instances`, `/api/task-instances`, `/api/admins`; apply endpoint       |
| `src/debug/chat-router-runtime.ts`              | Holds and clears the active `ChatRouter` reference for apply                                            |
| `src/chat/router.ts`                            | `listInstances()` returns readonly snapshots                                                            |
| `client/admin/sections/InstancesSection.svelte` | `/admin#instances` dashboard section with three tables and apply button                                 |

Migration: `041_users_platform_instance_index`.

Integration points: `src/bot.ts` (passes `msg.platformInstanceId` to auth),
`src/index.ts` (registers/clears runtime router, stops seeding admin into
`users`), `src/debug/server.ts` (routes `/api/*` to `instance-routes.ts`).

## Related Decisions

- ADR-0124: Multi-Provider Phase 1 — Instance Data Model (tables, encryption,
  env bootstrap).
- ADR-0123: Trusted-Local Plugin System — plugin approval gating that Phase 4
  re-scopes to super-admin only.
- ADR-0014: Multi-Chat Provider Abstraction — `ChatProvider` interface extended
  by Phase 3's `ChatRouter`.
- ADR-0036: Centralized Scheduler Utility — scheduler access that plugins use;
  Phase 4's admin hierarchy gates plugin enablement per context.
