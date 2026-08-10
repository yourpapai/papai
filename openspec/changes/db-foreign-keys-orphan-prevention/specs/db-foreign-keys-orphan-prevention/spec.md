<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines which tables cascade on user removal and which deliberately
survive it, so `removeUser` never leaves orphan rows in per-user tables
while group-shared durable assets outlive their creator.

## ADDED Requirements

### Requirement: Per-user table cascades

The system SHALL enforce `ON DELETE CASCADE` foreign keys from
`user_config`, `conversation_history`, `memory_summary`, `memory_facts`,
`task_snapshots`, `memos`, and `group_members.user_id` to
`users.platform_user_id`, with `memo_links` referencing `memos` and the
`memos_fts` triggers recreated.

#### Scenario: Admin removes a user

- **WHEN** `removeUser` deletes a user with rows in the per-user tables
- **THEN** all those rows (and dependent memo links/FTS entries) are
  removed by the database, and other users' rows are untouched

### Requirement: Group-shared assets survive user removal

The system SHALL NOT cascade `scheduled_prompts` or `alert_prompts` on
`created_by_user_id`, and SHALL NOT add user FK cascades to
`message_metadata`, `user_instructions`, `context_settings`, or
`authorized_groups`.

#### Scenario: Creator removed, group prompt remains

- **WHEN** a user who created a scheduled prompt delivering to a group is
  removed
- **THEN** the scheduled prompt row remains and continues to fire

### Requirement: Migration safety

The migration SHALL delete pre-existing orphan rows with logged counts
per table and SHALL pass `PRAGMA foreign_key_check` before completing.

#### Scenario: Pre-existing orphans

- **WHEN** the migration runs on a database containing rows whose user was
  previously removed
- **THEN** those rows are deleted during the migration, the counts are
  logged, and `foreign_key_check` reports no violations

### Requirement: Schema declaration parity

`src/db/schema.ts` SHALL declare `.references()` matching every enforced
foreign key.

#### Scenario: Schema inspection

- **WHEN** the drizzle schema is compared against the migrated database
- **THEN** every cascading relationship is declared in both places

### Requirement: No redundant manual cleanup

`removeUser` SHALL rely on database cascades for recurring and per-user
tables and SHALL NOT contain hand-written deletion for cascaded tables.

#### Scenario: Code inspection after migration

- **WHEN** the cascades are in place
- **THEN** `removeUser` performs only user deletion and cache eviction
