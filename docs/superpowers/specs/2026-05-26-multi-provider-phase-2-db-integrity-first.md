<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Review Remediation - Phase 2: DB Integrity First

**Date:** 2026-05-26
**Status:** Proposed
**Parent:** [`2026-05-26-multi-provider-phase-1-incremental-hardening.md`](./2026-05-26-multi-provider-phase-1-incremental-hardening.md)
**Depends on:** Phase 1 cache invalidation and procedural cleanup
**Ships independently:** Yes, after migration tests pass

## Summary

Move multi-provider ownership rules from route-handler convention into durable database constraints where SQLite can enforce them. This phase adds foreign keys and cascades for platform/task dependents, fixes nondeterministic migration behavior, and removes the legacy `users.kaneo_workspace_id` mirror from runtime/statistics paths.

Phase 1 makes current behavior safe. Phase 2 makes invalid states harder to create through any code path, test helper, script, or manual DB edit.

## Goals

- Add DB-enforced referential integrity for `context_settings`, `users`, and platform-scoped admins.
- Preserve the `__super__` admin sentinel without blocking foreign keys for platform-admin rows.
- Make scoped-context backfill deterministic from DB state, not `process.env.CHAT_PROVIDER`.
- Remove runtime/statistics dependence on `users.kaneo_workspace_id` and make `user_config` the single workspace source of truth.
- Standardize migration naming so helper modules do not look like runnable migrations.
- Keep all migrations idempotent and covered by focused migration tests.

## Non-Goals

- Provider catalog unification or dynamic platform provider forms. That is Phase 3.
- Replacing provider-specific traits in tool construction. That is Phase 3.
- Changing the external admin API shape beyond what is needed to preserve behavior through schema changes.
- Cross-platform user identity linking.

## Integrity Model

### Target Tables

The final DB model after this phase:

```text
platform_instances(id primary key)
task_instances(id primary key)

context_settings(
  context_id primary key,
  task_instance_id references task_instances(id) on delete cascade,
  platform_instance_id references platform_instances(id) on delete cascade
)

users(
  platform_instance_id references platform_instances(id) on delete cascade,
  platform_user_id,
  username,
  added_at,
  added_by,
  primary key(platform_instance_id, platform_user_id)
)

super_admins(
  user_id primary key,
  created_at
)

platform_admins(
  user_id,
  platform_instance_id references platform_instances(id) on delete cascade,
  created_at,
  primary key(user_id, platform_instance_id)
)
```

`admins(user_id, platform_instance_id)` cannot cleanly enforce a foreign key while also storing `__super__` because SQLite does not support partial foreign keys. Splitting super-admin and platform-admin rows is the cleanest integrity-preserving model.

### Compatibility View

To minimize application churn, expose existing store functions in `src/instances/admin-store.ts` with the same public return shape:

```typescript
type AdminRecord = {
  userId: string
  platformInstanceId: string // concrete platform id or "__super__"
  createdAt: string
}
```

Implementation details:

- `addAdmin(userId, "__super__")` writes `super_admins`.
- `addAdmin(userId, platformInstanceId)` writes `platform_admins` and fails if the platform does not exist.
- `removeAdmin()` deletes from the correct table.
- `listAdmins()` unions both tables and maps super-admin rows back to `platformInstanceId: "__super__"`.
- `isAdmin()` checks `super_admins` OR `platform_admins`.

If keeping a single physical `admins` table is preferred for a smaller migration, then platform admin rows must remain procedurally cleaned. That is less aligned with this phase's purpose and should be documented as an explicit compromise.

## Migration Plan

### 1. Preflight Cleanup

Before creating constrained tables:

- Delete `context_settings` rows whose `task_instance_id` does not exist.
- Delete `context_settings` rows whose `platform_instance_id` does not exist.
- Delete `users` rows whose `platform_instance_id` does not exist.
- Split `admins` rows into super-admin and platform-admin sets.
- Drop platform-admin rows whose platform no longer exists.

Every cleanup should log counts. Tests should assert the resulting row sets, not log output.

### 2. Rebuild Constrained Tables

SQLite cannot add foreign keys to an existing table with `ALTER TABLE ADD CONSTRAINT`. Rebuild affected tables in a transaction:

1. Create `*_new` table with the constrained schema.
2. Copy cleaned rows from old table.
3. Drop old table.
4. Rename `*_new`.
5. Recreate indexes.

Affected existing tables:

- `context_settings`
- `users`
- optionally `admins` if not split; preferred path replaces it with `super_admins` and `platform_admins`

New tables:

- `super_admins`
- `platform_admins`

### 3. Update Drizzle Schema

Update `src/db/instance-schema.ts` and `src/db/schema.ts` exports to match the constrained model. Drizzle schema should use `.references(..., { onDelete: 'cascade' })` for new foreign keys. Raw SQL migrations remain the source of truth for existing DBs.

### 4. Deterministic Scoped Context Migration

Replace the env-dependent fallback in `043_scoped_context_ids.ts` for future runs or add a follow-up corrective migration if 043 is already applied in production.

Required rule:

- If exactly one platform instance exists, use that ID.
- If zero or multiple platform instances exist, preserve legacy context IDs and log ambiguity.
- Never derive a platform ID from `CHAT_PROVIDER` inside a migration.

If a deployment may already have applied 043 with env-derived IDs, the follow-up migration must not attempt to guess. It should only detect impossible references and report counts through logs/tests.

### 5. Workspace Source of Truth

`user_config(user_id, key = "kaneo_workspace_id")` becomes the single runtime and statistics source.

Changes:

- Stop writing `users.kaneo_workspace_id` in `syncWorkspaceToDb()`.
- Update stats code to count/read Kaneo workspace presence from `user_config`.
- Keep the old column physically present until a later destructive cleanup migration, or rebuild `users` without it in this phase if migration risk is acceptable.

Preferred Phase 2 target: stop using the column but do not drop it yet. Dropping it can be a later cleanup once production DBs have passed through the new stats/runtime path.

### 6. Migration Helper Rename

Rename `src/db/migrations/043_scoped_context_ids_columns.ts` to a non-migration-looking helper name, for example:

```text
src/db/migrations/scoped-context-owned-columns.ts
```

Update imports from `043_scoped_context_ids.ts`. The file is not registered today, but the rename avoids future confusion and accidental migration registration.

## Error Handling

| Condition                                  | Behavior                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Platform admin insert for missing platform | Store throws typed/recognizable error; route returns 400 or 404                            |
| Deleting platform instance                 | SQLite cascades `context_settings`, `users`, and `platform_admins`                         |
| Deleting task instance                     | SQLite cascades `context_settings`; application cache invalidation from Phase 1 still runs |
| Existing orphan rows during migration      | Delete or preserve according to preflight rules, with deterministic counts                 |
| Ambiguous scoped-context migration owner   | Preserve legacy ID; do not read env; log warning                                           |

## Testing Strategy

- Migration test: orphaned `context_settings` rows are removed before FK rebuild.
- Migration test: orphaned `users` rows are removed before FK rebuild.
- Migration test: `admins('__super__')` rows become `super_admins`; platform rows become `platform_admins`.
- Migration test: deleting a platform cascades platform admins, users, and context settings.
- Migration test: deleting a task cascades context settings.
- Migration test: zero platform instances does not use `CHAT_PROVIDER` to scope legacy context IDs.
- Store tests: `listAdmins()`, `isSuperAdmin()`, `isPlatformAdmin()`, and `isAdmin()` preserve current external behavior after table split.
- Stats tests: Kaneo workspace counts come from `user_config`, not `users.kaneo_workspace_id`.
- Verification commands: focused migration/store/stats tests, `bun typecheck`, `bun lint:agent-strict -- <touched files>`.

## Acceptance Criteria

- Foreign key enforcement prevents new `context_settings` rows pointing to missing platform/task instances.
- Deleting a platform instance cascades dependent platform-admin, user, and context-setting rows at the DB level.
- Super-admin rows no longer block platform-admin foreign keys.
- Migrations do not read `CHAT_PROVIDER` or `TASK_PROVIDER` to derive persisted ownership.
- Runtime and stats no longer depend on `users.kaneo_workspace_id`.
- The 043 columns helper no longer uses a migration-number filename.

## Rollout Notes

This phase should be deployed with a DB backup and migration dry-run on a production-like copy. Table rebuild migrations are higher risk than Phase 1 route/store changes. The rollback plan should be a DB restore, not a reverse migration, because dropped orphan rows and split admin tables intentionally change persisted shape.
