<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Review Remediation - Phase 1: Incremental Hardening

**Date:** 2026-05-26
**Status:** Proposed
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)
**Depends on:** Implemented multi-provider router, instance tables, admin dashboard
**Ships independently:** Yes

## Summary

Close the highest-confidence correctness and operator UX gaps found in the multi-provider architectural review without changing the database ownership model or provider catalog architecture. This phase is deliberately small: it fixes orphaned admin rows, stale tool caches, missing instance config updates, duplicate-create error handling, and inconsistent live platform reconciliation.

The desired outcome is that normal dashboard operations are safe and predictable in the current architecture, even before deeper schema and catalog refactors land.

## Goals

- Delete platform-scoped admin rows when deleting a platform instance.
- Invalidate cached tool sets when context task assignment or task-instance configuration changes.
- Add update routes for platform and task instance configs/status where store functions already exist.
- Return explicit client errors for duplicate instance IDs instead of generic 500 responses.
- Make live `ChatRouter` reconciliation semantics consistent for platform create, status toggle, and delete.
- Bound `/api/platform-instances/apply` lifecycle concurrency with the same convention used by `ChatRouter`.
- Keep the changes reviewable and low-risk by avoiding table rebuild migrations in this phase.

## Non-Goals

- Adding DB-level foreign keys or cascades. That is Phase 2.
- Removing `users.kaneo_workspace_id`. That is Phase 2.
- Replacing provider-name checks or building platform provider catalogs. That is Phase 3.
- Completing plugin task-provider per-user credential support. That is Phase 3.
- Reworking dashboard authentication or adding user sessions.

## Verified Problems Addressed

| Problem                        | Current Behavior                                                                                                    | Phase 1 Target                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Orphaned platform admins       | Platform delete removes `context_settings` and platform row, but leaves `admins(platform_instance_id = deleted id)` | Platform delete removes platform admin rows before or with the platform row |
| Stale tool cache               | Context reassignment or task instance edits can keep old tool sets alive                                            | Any assignment/config/status change clears affected context tool caches     |
| No config update route         | Operators must delete/recreate an instance to fix config                                                            | Operators can PATCH existing platform/task instance config                  |
| Duplicate instance ID          | Bare insert throws and route returns `500 { error: "config unreadable" }`                                           | Duplicate ID returns `409 { error: "instance_exists" }`                     |
| Mixed platform apply semantics | Create/status require `/apply`, delete removes runtime inline                                                       | One explicit runtime model applies uniformly                                |
| Unbounded apply concurrency    | `Promise.all` directly starts/stops all instances                                                                   | Apply uses `p-limit` with bounded lifecycle concurrency                     |

## Design

### Admin Cleanup

Add an admin-store helper:

```typescript
deleteAdminsByPlatformInstance(platformInstanceId: string): number
```

`DELETE /api/platform-instances/:id` calls it before deleting the platform row. The helper must never delete `SUPER_ADMIN_PLATFORM_ID` rows unless the caller passes that sentinel exactly; platform deletes only pass concrete platform IDs from the URL.

This does not replace Phase 2 FK cascades. It removes the confirmed production-visible orphan leak immediately.

### Tool Cache Invalidation

Introduce a small invalidation helper near the instance/context stores or in a dedicated module:

```typescript
clearToolCachesForContexts(contextIds: readonly string[]): void
clearToolCachesForTaskInstance(taskInstanceId: string): void
```

The helper delegates to `clearCachedToolsByPrefix(contextId)` because group tool cache keys are derived from the storage context plus chat user and username.

Required call sites:

- `setContextSettings(input)` clears the old context cache and the new context cache after upsert.
- `deleteContextsByTaskInstance(taskInstanceId)` clears deleted context IDs returned by the delete statement.
- `deleteContextsByPlatformInstance(platformInstanceId)` clears deleted context IDs returned by the delete statement.
- Task instance config/status update clears all contexts returned by `listContextsByTaskInstance(id)`.
- Task instance delete clears all referencing contexts before or after deleting them.

If a store helper already returns only counts, adjust it to collect deleted context IDs before deletion or use `returning({ contextId })` as existing code already does internally.

### Instance Update Routes

Add route support in `src/debug/instance-routes.ts`:

```text
PATCH /api/platform-instances/:id  { config?: Record<string, string>, status?: "pending" | "active" | "stopped" }
PATCH /api/task-instances/:id      { config?: Record<string, string>, status?: "pending" | "active" | "stopped" }
```

Route behavior:

- Validate with Zod and reject empty patches with `400 invalid_request`.
- Return `404` if the instance does not exist before update.
- Return the masked updated row on success.
- For platform updates, mark platform runtime changes unapplied; `/apply` remains the only runtime reconciliation path.
- For task updates, invalidate tool caches for every context assigned to that task instance.

The existing `POST /api/platform-instances/:id/status` may remain as a compatibility wrapper around the new PATCH route, but dashboard code should move to PATCH to keep config and status mutations in one path.

### Duplicate Create Errors

Before insert, routes should check `getPlatformInstance(id)` or `getTaskInstance(id)` and return `409` if present. This is simpler and clearer than pattern-matching SQLite unique errors.

Response shape:

```json
{ "error": "instance_exists", "id": "telegram-default" }
```

This also avoids the misleading catch-all `config unreadable` response for ordinary operator mistakes.

### Platform Runtime Reconciliation

Choose one model for this phase: dashboard mutations remain DB-first and runtime changes are applied only by `POST /api/platform-instances/apply`.

Required changes:

- `DELETE /api/platform-instances/:id` no longer calls `router.removeInstance()` inline.
- Create/status/update/delete all make the dashboard set the same "unapplied changes" indicator.
- `/apply` is the only route that mutates the running `ChatRouter` in response to platform-instance table differences.

Rationale: this is the smallest consistent model because the existing UI already exposes an Apply button and create/status paths already rely on it.

### Bounded Apply

Use `p-limit` inside `applyPlatformInstances()` with the same effective concurrency as router lifecycle operations. If the constant is not exported by `ChatRouter`, define a local `INSTANCE_APPLY_CONCURRENCY = 4` in `instance-routes.ts`.

Apply order remains:

1. Remove runtime instances not active in DB.
2. Add and start missing active DB instances.
3. Start stopped runtime instances that are active in DB.

The phase does not add config-drift detection for already-running active instances. A changed platform config takes effect when the operator stops/applies/starts or when a later phase adds replace-on-config-change semantics.

## Error Handling

| Condition                                  | Behavior                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Duplicate platform/task ID                 | `409 { error: "instance_exists", id }`                                                                    |
| Patch unknown instance                     | `404 Not found`                                                                                           |
| Empty patch body                           | `400 invalid_request`                                                                                     |
| Invalid config shape                       | `400 invalid_request` with Zod issues                                                                     |
| Router not initialized on `/apply`         | Existing `503 { error: "router not initialised" }`                                                        |
| Runtime start/stop failure during `/apply` | Preserve existing router logging; `/apply` completes best-effort unless router methods throw unexpectedly |

## Testing Strategy

- `tests/instances/admin-store.test.ts`: `deleteAdminsByPlatformInstance()` removes platform admins and preserves unrelated platform/super admins.
- `tests/debug/instance-routes.test.ts`: platform delete removes admin rows; duplicate platform/task create returns 409; PATCH updates config/status; unknown PATCH returns 404.
- `tests/debug/instance-routes.test.ts`: platform delete no longer calls `router.removeInstance()` before `/apply`; `/apply` removes it.
- `tests/instances/context-store.test.ts` or focused cache tests: context reassignment clears old/new tool caches.
- `tests/debug/instance-routes.test.ts`: task PATCH/delete invalidates caches for assigned contexts.
- Existing router tests remain unchanged except expectations around delete/apply ordering.
- Verification commands: targeted tests, `bun typecheck`, `bun lint:agent-strict -- <touched files>`.

## Acceptance Criteria

- Deleting a platform instance leaves no `admins` rows for that platform ID.
- Reassigning a context or editing/deleting a task instance cannot keep an old provider tool surface in cache.
- Operators can update platform/task instance config without delete/recreate.
- Duplicate create attempts return 409, not 500.
- Platform create, update, status toggle, and delete all use the same apply semantics.
- `/api/platform-instances/apply` uses bounded lifecycle concurrency.

## Rollout Notes

This phase is safe to ship before schema migrations because it only adds procedural cleanup and API behavior around existing tables. It should be deployed before operators are asked to manage multiple live platform instances through the dashboard.
