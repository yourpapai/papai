<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: DB foreign keys orphan prevention (residual)

## Why

`removeUser` (`src/users.ts`) leaves dead rows in per-user tables on every
admin user removal: `user_config`, `conversation_history`, `memory_summary`,
`memory_facts`, `task_snapshots`, `memos`, and `group_members` membership
rows have no FK cascade to `users`, and the orphan cleanup in migration 023
covers only the recurring tables. ADR-0316 archived the blanket 10-table
sweep because several targets are group-shared durable assets — but the
genuinely per-user-owned tables remain a real, latent data-hygiene gap.

## What Changes

- New migration (next free slot) using the proven
  rename/recreate/copy/drop pattern: FK cascades `ON DELETE CASCADE` to
  `users.platform_user_id` for the per-user-owned tables —
  `user_config`, `conversation_history`, `memory_summary`,
  `memory_facts`, `task_snapshots`, `memos` (with `memo_links` rebuilt to
  reference `memos` and `memos_fts` triggers recreated), and
  `group_members.user_id`.
- Orphan DELETEs for those tables in the migration's `cleanupOrphans`,
  verified with `foreign_key_check`.
- Matching `.references()` declarations in `src/db/schema.ts`.
- Removal of the now-redundant manual recurring-table cleanup in
  `removeUser` (CASCADE is trusted).
- Full multi-table cascade + cross-user isolation tests
  (`tests/user-cascade.test.ts`).

## Capabilities

### New Capabilities

- `db-foreign-keys-orphan-prevention` — per-user table cascades and orphan
  cleanup so user removal leaves no dead rows, while group-shared durable
  assets deliberately survive.

### Modified Capabilities

None. `openspec/specs/` has no entries for the DB layer.

## Non-goals

- No cascade on `scheduled_prompts` / `alert_prompts`: these are
  group-shared durable assets (delivery context keyed) that MUST survive
  creator removal (ADR-0316, design.md D2).
- No FK changes for `message_metadata`, `user_instructions`,
  `context_settings`, `authorized_groups` (context/group keyed).
- No change to the shipped recurring-task cascades (migration 023 stands).
- No sweep of tables beyond the per-user-owned set listed above.

## Impact

- **Code:** one new migration; `.references()` additions in
  `src/db/schema.ts`; `removeUser` simplification; cascade tests.
- **DB:** recreate-and-copy migration on 7 tables + memo rebuilds; orphan
  rows deleted at migration time; `foreign_key_check` gate. Backfill
  strategy in design.md D4.
- **Scope model:** codifies the split — per-user data cascades,
  group-shared assets survive user removal.
- **Docs:** `docs/architecture/behaviors.md` (data lifecycle note).
- **Legacy:** completes archived
  `docs/archive/2026-04-04-db-foreign-keys-orphan-prevention.md` per
  ADR-0316 point 4; retires
  `docs/superpowers/remaining/2026-04-04-db-foreign-keys-orphan-prevention.md`
  in the same commit.
