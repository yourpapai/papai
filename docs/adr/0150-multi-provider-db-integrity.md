<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0150: Multi-Provider Phase 2: DB Integrity First

## Status

Implemented

## Date

2026-05-26 – 2026-06-02

## Context

After Phase 1 added procedural dependent-row cleanup and cache invalidation to
instance deletion routes, referential integrity still depended entirely on
route-handler convention. Deleting a platform or task instance directly in
SQLite left orphan `context_settings`, `users`, and `admins` rows. The single
`admins` table stored both super-admin sentinel rows (`platform_instance_id =
'__super__'`) and platform-scoped admin rows, preventing a foreign key on
`platform_instance_id` because SQLite does not support partial foreign keys.

Migration `043_scoped_context_ids` derived a platform instance ID from
`process.env.CHAT_PROVIDER` when no platform instances existed, making
migration results nondeterministic across environments. The `users.kaneo_workspace_id`
column was mirrored at write time from `user_config`, creating a redundant
second source of truth for Kaneo workspace presence that stats code depended
on.

The spec (`docs/archive/2026-05-26-multi-provider-phase-2-db-integrity-first.md`)
and implementation plan (`docs/archive/2026-05-27-multi-provider-phase-2-db-integrity-first.md`)
defined the scope: move ownership rules from route convention into durable
database constraints, split admin storage, fix the migration, and consolidate
the workspace source of truth.

## Decision Drivers

- **DB as integrity boundary**: Invalid states should be structurally
  impossible, not merely convention-avoided.
- **Cascade over procedure**: `ON DELETE CASCADE` is simpler and more reliable
  than hand-rolled delete sequences that can miss edge cases.
- **Deterministic migrations**: Migration output must never depend on
  `process.env`; a migration run today must produce the same DB state tomorrow.
- **Preserve admin API shape**: The external `AdminRecord` type (`userId`,
  `platformInstanceId` or `'__super__'`, `createdAt`) must remain unchanged
  even though the physical storage splits.
- **Cache invalidation as side effect**: Phase 1 cache invalidation on
  instance deletion must remain, but it must not be the integrity mechanism.

## Considered Options

### Option A: Keep single `admins` table, skip FK on platform column

Add foreign keys to `context_settings` and `users` only. Leave `admins` as-is
with procedural super-admin exclusion.

- **Pros**: Smaller migration; no table split.
- **Cons**: `admins.platform_instance_id` cannot reference `platform_instances`
  while also accepting `'__super__'`. Platform admin orphans remain possible.

### Option B: Split admin tables with full FK enforcement (chosen)

Replace `admins` with `super_admins(user_id PK)` and `platform_admins(user_id,
platform_instance_id FK cascade)`. Add `ON DELETE CASCADE` foreign keys to
`context_settings` and `users`. Preflight-clean orphans before rebuilding.

- **Pros**: Every row with a platform reference is constrained; super-admin rows
  are fully isolated from platform cascades; SQLite enforces integrity for any
  code path including direct DB edits.
- **Cons**: Larger migration with table rebuilds; `listAdmins()` requires a
  union query across two tables.

### Option C: Add a follow-up corrective migration for 043

If `043_scoped_context_ids` has already shipped, append a new migration that
detects and reports env-derived IDs without guessing.

- **Pros**: Does not rewrite migration history.
- **Cons**: Corrective migration can only detect and log, not fix, because the
  correct platform ID is unknowable after the fact. Chosen as a fallback only
  if 043 has already been applied in production.

## Decision

**Option B** for the integrity model, with the following subsidiary decisions:

| Topic                       | Decision                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration                   | `044_instance_integrity` is canonical. Preflight-deletes orphans, rebuilds `context_settings` and `users` with FK cascades, splits `admins` into two tables, asserts `PRAGMA foreign_key_check`.                          |
| Admin storage               | `super_admins(user_id PK, created_at)` and `platform_admins(user_id, platform_instance_id FK cascade, created_at)`. The `'__super__'` sentinel exists only in the API compatibility layer, not in storage.                |
| Admin API compatibility     | `addAdmin()`, `removeAdmin()`, `listAdmins()`, `isAdmin()` preserve the existing `AdminRecord` shape. `isSuperAdmin()` and `isPlatformAdmin()` are new exports.                                                           |
| Scoped-context migration    | `043` repaired before release: `getPlatformInstanceId()` queries `platform_instances` rows instead of `CHAT_PROVIDER`. If zero or multiple instances exist, legacy sentinel IDs are preserved.                            |
| Route cascade behavior      | Platform/task delete routes collect affected context IDs before the delete, then clear tool caches after. The DB cascade handles dependent-row removal; the route does not.                                               |
| Platform-admin insert guard | `/api/admins` POST rejects `platformInstanceId` values that do not exist in `platform_instances` with 404, before reaching the constrained store insert.                                                                  |
| Workspace source of truth   | `user_config(key='kaneo_workspace_id')` is the single runtime and statistics source. `syncWorkspaceToDb()` writes only `user_config`. `users.kaneo_workspace_id` column is kept physically but no longer read or written. |
| Migration helper rename     | `043_scoped_context_ids_columns.ts` renamed to `scoped-context-owned-columns.ts` to avoid accidental migration registration.                                                                                              |

## Consequences

### Positive

- Deleting a platform instance cascades `context_settings`, `users`, and
  `platform_admins` at the DB level, regardless of which code path performed
  the delete.
- Super-admin rows survive platform deletion because they live in a separate
  table with no platform foreign key.
- Migrations no longer read `CHAT_PROVIDER`, eliminating environment-dependent
  DB state.
- Stats and runtime code share a single workspace source (`user_config`),
  removing the dual-write mirror and potential inconsistency.
- `PRAGMA foreign_key_check` assertion in the migration catches any constraint
  violation before the transaction commits.

### Negative

- Table rebuild migrations are higher risk than additive migrations; rollback
  requires a DB restore rather than a reverse migration.
- `listAdmins()` now unions two tables; the compatibility layer adds a thin
  abstraction cost.
- The `users.kaneo_workspace_id` column remains physically present as dead
  storage until a future cleanup migration drops it.

### Risks

- Preflight orphan deletion is irreversible within the migration transaction;
  if the backup is stale, orphaned rows that represented real intent are lost.
  Mitigation: migration logs cleanup counts; deployment should include a dry-run
  on a production-like copy.
- If `043` has already been applied in a production DB with env-derived IDs,
  the repair must ship as a follow-up migration rather than a rewrite. The
  plan explicitly calls out this conditional.

## Implementation Notes

Key artifacts:

| File                                                | Role                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/db/migrations/044_instance_integrity.ts`       | Orphan cleanup, table rebuilds with FK cascades, admin split, FK assertion           |
| `src/db/instance-schema.ts`                         | Drizzle schemas for `super_admins`, `platform_admins`, constrained `contextSettings` |
| `src/db/schema.ts`                                  | Re-exports new admin tables; `users.platformInstanceId` FK cascade                   |
| `src/instances/admin-store.ts`                      | Maps `AdminRecord` API onto `super_admins`/`platform_admins`                         |
| `src/debug/instance-routes.ts`                      | Cascade-backed deletes with cache invalidation; platform-admin insert guard          |
| `src/cache-db.ts`                                   | `syncWorkspaceToDb()` writes `user_config` only                                      |
| `src/stats/global-mix.ts`                           | Workspace counts from `user_config`                                                  |
| `src/stats/per-table-subject.ts`                    | Per-subject workspace presence from `user_config`                                    |
| `src/db/migrations/scoped-context-owned-columns.ts` | Renamed from `043_scoped_context_ids_columns.ts`                                     |

Migration: `044_instance_integrity` runs in a single transaction — orphan
cleanup, `context_settings` rebuild, `users` rebuild, admin split, FK check.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — the provider capability model
  that Phase 1 procedural cleanup built on.
- ADR-0123: Trusted-Local Plugin System — plugin storage tables (`plugin_kv`,
  `plugin_context_state`) are unaffected by this phase but share the same
  instance-scoped pattern.
- Phase 1 (unnumbered): Incremental Hardening — route-level cache invalidation
  and procedural dependent-row deletes that this phase replaces at the DB level.
