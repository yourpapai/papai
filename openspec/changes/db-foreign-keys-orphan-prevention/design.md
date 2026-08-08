<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: DB foreign keys orphan prevention (residual)

## Decisions

### D1: Cascade only per-user-owned tables

Ground truth (`src/db/migrations/scoped-context-owned-columns.ts`):
`user_config`, `conversation_history`, `memory_summary`, `memory_facts`,
`task_snapshots`, `memos` are `user_id`-owned (thread-scoped where
applicable); `group_members` rows are memberships whose `user_id` side is
dead once the user is gone. These get `ON DELETE CASCADE` to
`users.platform_user_id`.

### D2: scheduled_prompts / alert_prompts deliberately excluded (ADR-0316)

Their durable ownership is the delivery context (group-shared config
context), not the creator: a prompt created by user A delivering into
group G is a group asset. Cascading on `created_by_user_id` would delete
live group automation when an admin removes a departing member — the exact
failure ADR-0316 called out. `message_metadata`, `user_instructions`,
`context_settings`, `authorized_groups` are context/group keyed and
likewise excluded.

### D3: memos chain rebuild

`memos` recreation requires rebuilding `memo_links` (source/target FKs to
`memos`) and recreating the `memos_fts` virtual table + triggers, using the
plan's already-specced SQL and migration 023's
rename/recreate/copy/drop + `foreign_key_check` pattern as reference
technique (per ADR-0316 point 4).

### D4: Migration and backfill strategy

New migration at the next free slot (076+; renumber at apply time if
`user-profile-memory`'s 076 lands first). For each table: rename →
recreate with FK → copy rows whose parent user exists → DELETE orphan
rows in `cleanupOrphans` (logged at info with counts) → drop old table →
`PRAGMA foreign_key_check`. No data backfill needed beyond orphan
deletion; existing orphan rows (if any) are dead by definition.
`.references()` declarations in `schema.ts` mirror the SQL.

### D5: removeUser simplification

Once cascades are trusted, delete the hand-written recurring-table cleanup
in `removeUser` (`src/users.ts:138-146`) — the shipped recurring FK
already cascades. Cache eviction in `removeUser` stays as-is.

### D6: Hooks / TDD

Migration + schema edits are hook-gated: failing
`tests/user-cascade.test.ts` (all 7 child tables cascade; cross-user
isolation preserved; `scheduled_prompts` row survives creator removal)
lands before the migration. Verify with `bun test tests/user-cascade*`,
then full gate.
