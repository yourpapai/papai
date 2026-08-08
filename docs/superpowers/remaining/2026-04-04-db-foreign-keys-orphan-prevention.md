<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2026 04 04 db foreign keys orphan prevention

**Status:** partially_implemented
**Generated:** 2026-08-07
**Plan:** `docs/superpowers/plans/2026-04-04-db-foreign-keys-orphan-prevention.md`

## Completed

- Task 2 — migration registered (as renumbered 023): `migration023AddForeignKeys` wired in `src/db/index.ts:36,146`
- Task 4 — `removeUser` cache eviction: calls `evictUser(row.platformUserId)` at `src/users.ts:148` (imported from `./cache.js`)
- Task 5 — `deleteRecurringTask` simplified: `src/recurring.ts:245-259` deletes only the template row, relies on DB cascade (no manual occurrence cleanup)
- Task 1 (partial) — migration exists but renumbered/ narrowed: `src/db/migrations/023_add_foreign_keys.ts` recreates `recurring_tasks` + `recurring_task_occurrences` with `ON DELETE CASCADE`; companion test `tests/db/migrations/023_add_foreign_keys.test.ts`
- Task 3 (partial) — one of 13 planned Drizzle `.references()` present: `recurringTaskOccurrences.templateId → recurringTasks.id` at `src/db/schema.ts:152`
- Task 6 (partial) — integration test file exists: `tests/user-cascade.test.ts`, but only exercises the recurring_tasks/occurrences cascade

## Remaining

- Task 1 — 9 of 11 planned tables still lack FK migration: `user_config`, `conversation_history`, `memory_summary`, `memory_facts`, `group_members`, `scheduled_prompts`, `alert_prompts`, `task_snapshots`, `memos` (plus the `memo_links` rebuild + `memos_fts` re-trigger that depend on `memos` recreation)
- Task 3 — 12 of 13 Drizzle `.references()` declarations missing in `src/db/schema.ts`: userConfig.userId, conversationHistory.userId, memorySummary.userId, memoryFacts.userId, groupMembers.userId, recurringTasks.userId, scheduledPrompts.userId, alertPrompts.userId, taskSnapshots.userId, memos.userId, memoLinks.sourceMemoId, memoLinks.targetMemoId
- Task 7 — orphan cleanup in `023_add_foreign_keys.ts` `cleanupOrphans` covers only `recurring_tasks` + `recurring_task_occurrences`; the 10 user-referencing-table orphan DELETEs are absent
- Task 6 — `tests/user-cascade.test.ts` only asserts recurring cascade; missing the full multi-table cascade assertion (all 10 child tables) and the cross-user isolation already sketched in the plan
- Numbering reconciliation: plan specified `019_add_foreign_keys.ts` but 019 is taken by `019_user_identity_mappings.ts`; remaining work must extend `023_add_foreign_keys.ts` (or a new later migration) rather than 019
- Redundant manual cleanup in `removeUser` (`src/users.ts:138-146`) still hand-deletes recurringTaskOccurrences + recurringTasks despite the existing CASCADE FK — should be removed once the migration is trusted

## Suggested Next Steps

1. 1. Extend `src/db/migrations/023_add_foreign_keys.ts` (new migration 076+) with the recreate+copy+rebuild pattern for the 9 remaining user-referencing tables in parent-first order, including the `memos` recreation that forces the `memo_links` rebuild and `memos_fts` trigger drop/rebuild per Task 1 spec
2. 2. Add the orphan-cleanup DELETE block for all 10 user-referencing tables before `PRAGMA foreign_key_check` in that migration (Task 7), so existing DBs with stale rows don't fail the FK check
3. 3. Declare the 12 missing `.references(() => users.platformUserId, { onDelete: 'cascade' })` (and the two memo_links refs) in `src/db/schema.ts` (Task 3) so Drizzle types match DB reality
4. 4. Expand `tests/user-cascade.test.ts` to insert rows in every child table, delete the user, and assert all are gone plus a second-user isolation case (Task 6); also add a migration-level test mirroring the planned `019` test for the new tables
5. 5. After the cascade is verified end-to-end, drop the now-redundant manual `recurringTaskOccurrences`/`recurringTasks` deletes in `removeUser` (`src/users.ts:138-146`) and run `bun typecheck && bun test` to confirm no regressions
6. 6. Update the tracker `docs/superpowers/remaining/2026-04-04-db-foreign-keys-orphan-prevention.md` (currently Status: unclear) to reflect completion once the above lands
