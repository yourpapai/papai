<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: DB foreign keys orphan prevention (residual)

## 1. Cascade tests first

- [ ] 1.1 Extend `tests/user-cascade.test.ts` with failing assertions:
      removing a user cascades `user_config`, `conversation_history`,
      `memory_summary`, `memory_facts`, `task_snapshots`, `memos` (incl.
      `memo_links` and `memos_fts` rows) and `group_members` rows; a second
      user's rows are untouched; a `scheduled_prompts` /
      `alert_prompts` row created by the removed user but delivering to a
      group SURVIVES.
      Verify: `bun test tests/user-cascade.test.ts` (fails)

## 2. Migration

- [ ] 2.1 Write the migration (next free slot): rename/recreate/copy/drop
      per table with FK `ON DELETE CASCADE` to `users.platform_user_id`;
      rebuild `memo_links`; recreate `memos_fts` + triggers;
      `cleanupOrphans` DELETEs with logged counts; `foreign_key_check`.
      Verify: `bun test tests/user-cascade.test.ts` (passes) plus
      migration apply/rollback on a scratch DB
- [ ] 2.2 Add matching `.references()` declarations in
      `src/db/schema.ts`.
      Verify: `bun run typecheck` + schema snapshot test if present

## 3. removeUser cleanup

- [ ] 3.1 Remove the redundant manual recurring-table deletion in
      `src/users.ts` (CASCADE trusted); keep cache eviction.
      Verify: `bun test tests/user*` (existing + cascade suites)

## 4. Gate

- [ ] 4.1 Full `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run format:check`; data-lifecycle note in
      `docs/architecture/behaviors.md`.
      Verify: all pass
