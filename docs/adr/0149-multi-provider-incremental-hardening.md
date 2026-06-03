<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0149: Multi-Provider Phase 1 Incremental Hardening

## Status

Implemented

## Date

2026-05-26 – 2026-06-02

## Context

After the multi-provider router and instance dashboard shipped, an architectural
review found several correctness and operator-UX gaps that made normal dashboard
operations unsafe or unpredictable. None of these required schema migrations or
provider catalog changes, but together they meant that deleting a platform
instance left orphaned admin rows, reassigning contexts or editing task
instances kept stale tool surfaces in cache, operators had to delete/recreate
instances to fix config, duplicate instance IDs caused misleading 500 errors,
and platform delete bypassed the apply-then-reconcile model that every other
mutation already used.

The spec (`docs/archive/2026-05-26-multi-provider-phase-1-incremental-hardening.md`)
defined these as Phase 1: close the highest-confidence gaps without changing
the DB ownership model or provider catalog architecture.

## Decision Drivers

- **Operator safety**: Normal dashboard workflows must not leave orphaned rows
  or stale caches that cause silent misbehavior in downstream tool assembly.
- **Consistent reconciliation**: All platform-instance mutations (create,
  update, status toggle, delete) should use the same DB-first, apply-later
  runtime model rather than mixing inline and deferred router changes.
- **Clear error semantics**: Duplicate instance IDs and missing-instance
  patches must return explicit HTTP status codes, not generic 500s.
- **Bounded concurrency**: Apply lifecycle operations (start/stop instances)
  must not open an unbounded fan-out against external platform APIs.
- **Low risk**: Avoid table-rebuild migrations; add procedural cleanup and
  route behavior around existing tables only.

## Considered Options

### Option A: Wait for Phase 2 schema migrations to fix everything

Fix admin orphans with FK cascades, cache invalidation with trigger-like
patterns, and add update routes as part of a broader schema redesign.

- **Pros**: Cleaner long-term architecture; cascades guarantee referential
  integrity at the DB level.
- **Cons**: Phase 2 is large and uncertain in timeline; operators encounter
  the gaps immediately in production.

### Option B: Incremental procedural hardening (chosen)

Add store helpers, centralize tool-cache invalidation, extend debug instance
routes, and normalize apply semantics — all within the existing schema.

- **Pros**: Ships immediately; each change is small and reviewable; no
  migration risk; fixes the confirmed production-visible problems.
- **Cons**: Procedural cleanup does not replace FK cascades; future Phase 2
  must still add declarative constraints.

### Option C: Inline runtime removal on delete only

Fix the admin-orphan and cache problems but keep the mixed apply semantics
(delete removes runtime inline, create/status require `/apply`).

- **Pros**: Smallest diff for the delete path.
- **Cons**: Two mental models for platform mutations; operators cannot predict
  whether a dashboard action takes effect immediately or requires an explicit
  apply step.

## Decision

**Option B** with the following subsidiary decisions:

| Topic                   | Decision                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin cleanup           | `deleteAdminsByPlatformInstance(platformInstanceId)` removes platform admin rows on platform delete. Does not delete `SUPER_ADMIN_PLATFORM_ID` rows unless that sentinel is passed.                                           |
| Tool cache invalidation | `clearToolCachesForContexts(contextIds)` delegates to `clearCachedToolsByPrefix()`. Called from `setContextSettings()`, `deleteContextsByTaskInstance()`, `deleteContextsByPlatformInstance()`, and task PATCH/DELETE routes. |
| Instance update routes  | `PATCH /api/platform-instances/:id` and `PATCH /api/task-instances/:id` accept `{ config?, status? }`, validate with Zod, return masked row. Empty patches rejected with 400.                                                 |
| Duplicate create errors | Pre-insert existence check returns `409 { error: "instance_exists", id }` instead of letting SQLite unique constraints surface as 500.                                                                                        |
| Platform apply model    | All platform mutations (create, PATCH, status, delete) are DB-first; `POST /api/platform-instances/apply` is the sole runtime reconciliation path. Delete no longer calls `router.removeInstance()` inline.                   |
| Bounded apply           | `applyPlatformInstances()` uses `p-limit(4)` for lifecycle start/stop calls, matching `ChatRouter` convention.                                                                                                                |
| Client migration        | Dashboard status toggle moves from `POST /api/platform-instances/:id/status` to `PATCH /api/platform-instances/:id { status }`. All mutations set the unapplied-changes indicator.                                            |

## Consequences

### Positive

- Deleting a platform instance no longer leaves orphaned admin rows that
  reference a nonexistent platform.
- Context reassignment, task-instance edits, and task-instance deletes all
  invalidate affected tool caches, preventing stale provider tool surfaces.
- Operators can fix config typos or rotate credentials without delete/recreate.
- Duplicate ID attempts return a clear 409 instead of a misleading 500.
- One consistent apply model eliminates the "did this take effect?" ambiguity
  for platform mutations.
- Bounded concurrency prevents unbounded fan-out during apply when many
  instances change at once.

### Negative

- Procedural admin cleanup does not guarantee referential integrity if a
  future code path deletes platform rows without calling the helper.
- Cache invalidation is eager: any assignment change clears the full context
  prefix, including group-derived keys that may not be affected.
- Apply-only delete means a deleted platform instance stays live until the
  operator clicks Apply, which may surprise operators used to immediate removal.

### Risks

- If a caller deletes a platform row through a path that bypasses
  `deleteAdminsByPlatformInstance()`, admin orphans return. Phase 2 FK
  cascades are the intended structural fix.
- Eager cache clearing adds a cold-start cost on reassignment; the next
  `makeTools()` call repopulates the cache from provider metadata.

## Implementation Notes

Key modules and changes:

| File                                            | Role                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/instances/admin-store.ts`                  | Added `deleteAdminsByPlatformInstance()` helper                                                                              |
| `src/instances/tool-cache-invalidation.ts`      | New: `clearToolCachesForContexts()` wrapper around `clearCachedToolsByPrefix()`                                              |
| `src/instances/context-store.ts`                | Wired cache invalidation into `setContextSettings()`, `deleteContextsByTaskInstance()`, `deleteContextsByPlatformInstance()` |
| `src/debug/instance-routes.ts`                  | Added PATCH routes, duplicate 409 checks, admin cleanup on delete, apply-only delete, bounded `p-limit(4)` apply             |
| `client/admin/fetchers.ts`                      | Added `updatePlatformInstance()` and `updateTaskInstance()` PATCH fetchers                                                   |
| `client/admin/sections/InstancesSection.svelte` | Status toggle migrated to PATCH; all mutations mark platform unapplied                                                       |

No new database migrations. All changes are procedural additions and route
behavior adjustments around existing tables.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — the provider model whose
  tool surfaces must be kept consistent via cache invalidation.
- ADR-0014: Multi-Chat Provider Abstraction — the `ChatRouter` reconciliation
  model that this decision normalizes.
- ADR-0123: Trusted-Local Plugin System — plugin eligibility evaluation depends
  on correct tool cache state; invalidation prevents stale plugin tool surfaces.
