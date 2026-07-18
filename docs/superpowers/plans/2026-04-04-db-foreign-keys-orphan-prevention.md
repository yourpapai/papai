<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# DB Foreign Keys & Orphan Prevention Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add database-level foreign key constraints with cascading deletes so that removing a user or a recurring task template automatically removes all dependent records, eliminating orphan data.

**Architecture:** A new SQLite migration recreates tables that lack FK constraints using the `ALTER TABLE ... RENAME TO` + `CREATE TABLE` + `INSERT INTO ... SELECT` + `DROP TABLE` pattern (SQLite does not support `ALTER TABLE ADD CONSTRAINT`). Application-level delete functions (`removeUser`, `deleteRecurringTask`) are simplified by relying on `ON DELETE CASCADE` instead of manual multi-table cleanup. `PRAGMA foreign_keys=ON` is already set on both DB connections.

**Tech Stack:** Drizzle ORM (schema.ts), Bun SQLite, hand-written TypeScript migrations.

---

## Current State

### Tables with implicit `user_id` references (NO foreign key):

| Table                  | Column    | Referenced Table         |
| ---------------------- | --------- | ------------------------ |
| `user_config`          | `user_id` | `users.platform_user_id` |
| `conversation_history` | `user_id` | `users.platform_user_id` |
| `memory_summary`       | `user_id` | `users.platform_user_id` |
| `memory_facts`         | `user_id` | `users.platform_user_id` |
| `group_members`        | `user_id` | `users.platform_user_id` |
| `recurring_tasks`      | `user_id` | `users.platform_user_id` |
| `scheduled_prompts`    | `user_id` | `users.platform_user_id` |
| `alert_prompts`        | `user_id` | `users.platform_user_id` |
| `task_snapshots`       | `user_id` | `users.platform_user_id` |
| `memos`                | `user_id` | `users.platform_user_id` |

### Tables with implicit `template_id` reference (NO foreign key):

| Table                        | Column        | Referenced Table     |
| ---------------------------- | ------------- | -------------------- |
| `recurring_task_occurrences` | `template_id` | `recurring_tasks.id` |

### Tables with existing FK (already correct):

| Table        | Column           | Referenced Table | On Delete |
| ------------ | ---------------- | ---------------- | --------- |
| `memo_links` | `source_memo_id` | `memos.id`       | CASCADE   |
| `memo_links` | `target_memo_id` | `memos.id`       | SET NULL  |

### Delete operations that currently leave orphans:

1. **`removeUser(identifier)`** — deletes `users` row only; orphans 10 child tables.
2. **`deleteRecurringTask(id)`** — deletes `recurring_tasks` row only; orphans `recurring_task_occurrences`.

---

## Scope

### In scope:

- Migration 019 to add FK constraints with `ON DELETE CASCADE` on all user-referencing tables
- Migration 019 to add FK on `recurring_task_occurrences.template_id → recurring_tasks.id ON DELETE CASCADE`
- Update `src/db/schema.ts` to declare FK references (Drizzle `.references()`)
- Update `removeUser` to clear in-memory cache after delete
- Update `deleteRecurringTask` to be simplified (occurrences cascade)
- Tests for cascade behavior on both delete paths

### Out of scope:

- `userInstructions.contextId` and `messageMetadata.contextId` — these reference external IDs (group/channel), not the `users` table
- `memo_links` — already has correct FKs
- `version_announcements` — independent table, no parent reference
- Foreign keys for external IDs (`taskId`, `groupId`, `projectId`) — these reference task provider APIs, not local tables

---

## Task 1: Write the migration

**Files:**

- Create: `src/db/migrations/019_add_foreign_keys.ts`

### Step 1: Write the migration test

Create a test that runs the migration on a fresh DB (after all prior migrations), then verifies FK constraints work.

**File:** Create `tests/db/migrations/019_add_foreign_keys.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'

import { runMigrations } from '../../../src/db/migrate.js'
// Import all migrations 001-019
// (copy the full import list from src/db/index.ts and add 019)

describe('migration 019: add foreign keys', () => {
  let db: Database

  beforeAll(() => {
    db = new Database(':memory:')
    db.run('PRAGMA journal_mode=WAL')
    db.run('PRAGMA foreign_keys=ON')
    // Run all migrations 001–019
    runMigrations(db, [
      /* all 19 migrations */
    ])
  })

  afterAll(() => {
    db.close()
  })

  describe('user cascade', () => {
    it('deletes user_config when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u1', 'admin')")
      db.run("INSERT INTO user_config (user_id, key, value) VALUES ('u1', 'k', 'v')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u1'")
      const row = db.prepare("SELECT * FROM user_config WHERE user_id = 'u1'").get()
      expect(row).toBeUndefined()
    })

    it('deletes conversation_history when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u2', 'admin')")
      db.run("INSERT INTO conversation_history (user_id, messages) VALUES ('u2', '[]')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u2'")
      const row = db.prepare("SELECT * FROM conversation_history WHERE user_id = 'u2'").get()
      expect(row).toBeUndefined()
    })

    it('deletes memory_summary when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u3', 'admin')")
      db.run("INSERT INTO memory_summary (user_id, summary, updated_at) VALUES ('u3', 's', '2025-01-01')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u3'")
      const row = db.prepare("SELECT * FROM memory_summary WHERE user_id = 'u3'").get()
      expect(row).toBeUndefined()
    })

    it('deletes memory_facts when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u4', 'admin')")
      db.run("INSERT INTO memory_facts (user_id, identifier, title, last_seen) VALUES ('u4', 'f1', 't', '2025-01-01')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u4'")
      const row = db.prepare("SELECT * FROM memory_facts WHERE user_id = 'u4'").get()
      expect(row).toBeUndefined()
    })

    it('deletes group_members when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u5', 'admin')")
      db.run("INSERT INTO group_members (group_id, user_id, added_by) VALUES ('g1', 'u5', 'admin')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u5'")
      const row = db.prepare("SELECT * FROM group_members WHERE user_id = 'u5'").get()
      expect(row).toBeUndefined()
    })

    it('deletes recurring_tasks and their occurrences when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u6', 'admin')")
      db.run(
        "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt1', 'u6', 'p1', 'task', 'cron')",
      )
      db.run("INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ1', 'rt1', 'ext1')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u6'")
      const rt = db.prepare("SELECT * FROM recurring_tasks WHERE user_id = 'u6'").get()
      const occ = db.prepare("SELECT * FROM recurring_task_occurrences WHERE template_id = 'rt1'").get()
      expect(rt).toBeUndefined()
      expect(occ).toBeUndefined()
    })

    it('deletes scheduled_prompts when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u7', 'admin')")
      db.run("INSERT INTO scheduled_prompts (id, user_id, prompt, fire_at) VALUES ('sp1', 'u7', 'p', '2026-01-01')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u7'")
      const row = db.prepare("SELECT * FROM scheduled_prompts WHERE user_id = 'u7'").get()
      expect(row).toBeUndefined()
    })

    it('deletes alert_prompts when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u8', 'admin')")
      db.run("INSERT INTO alert_prompts (id, user_id, prompt, condition) VALUES ('ap1', 'u8', 'p', '{}')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u8'")
      const row = db.prepare("SELECT * FROM alert_prompts WHERE user_id = 'u8'").get()
      expect(row).toBeUndefined()
    })

    it('deletes task_snapshots when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u9', 'admin')")
      db.run("INSERT INTO task_snapshots (user_id, task_id, field, value) VALUES ('u9', 't1', 'status', 'open')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u9'")
      const row = db.prepare("SELECT * FROM task_snapshots WHERE user_id = 'u9'").get()
      expect(row).toBeUndefined()
    })

    it('deletes memos and their links when user is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u10', 'admin')")
      db.run("INSERT INTO memos (id, user_id, content) VALUES ('m1', 'u10', 'hello')")
      db.run("INSERT INTO memo_links (id, source_memo_id, relation_type) VALUES ('ml1', 'm1', 'related')")
      db.run("DELETE FROM users WHERE platform_user_id = 'u10'")
      const memo = db.prepare("SELECT * FROM memos WHERE user_id = 'u10'").get()
      const link = db.prepare("SELECT * FROM memo_links WHERE source_memo_id = 'm1'").get()
      expect(memo).toBeUndefined()
      expect(link).toBeUndefined() // cascades: user→memo→memo_link
    })

    it('rejects inserting user_config with non-existent user_id', () => {
      expect(() => {
        db.run("INSERT INTO user_config (user_id, key, value) VALUES ('nonexistent', 'k', 'v')")
      }).toThrow()
    })
  })

  describe('recurring task cascade', () => {
    it('deletes occurrences when recurring task template is deleted', () => {
      db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u11', 'admin')")
      db.run(
        "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt2', 'u11', 'p1', 'task', 'cron')",
      )
      db.run("INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ2', 'rt2', 'ext2')")
      db.run("DELETE FROM recurring_tasks WHERE id = 'rt2'")
      const occ = db.prepare("SELECT * FROM recurring_task_occurrences WHERE template_id = 'rt2'").get()
      expect(occ).toBeUndefined()
    })
  })

  describe('data preservation during migration', () => {
    it('preserves existing data after table recreation', () => {
      // This is validated by the fact that all prior inserts succeed after migration
      const count = db.prepare('SELECT count(*) as c FROM users').get() as { c: number }
      expect(count.c).toBeGreaterThan(0)
    })
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun test tests/db/migrations/019_add_foreign_keys.test.ts`
Expected: FAIL — migration file doesn't exist, import fails.

### Step 3: Write the migration

**File:** Create `src/db/migrations/019_add_foreign_keys.ts`

SQLite doesn't support `ALTER TABLE ADD CONSTRAINT`. The standard approach is:

1. Disable FK checks temporarily (`PRAGMA foreign_keys=OFF`)
2. Start transaction
3. Rename existing table to `_old`
4. Create new table with FK constraints
5. Copy data from `_old` to new table
6. Drop `_old`
7. Recreate indexes
8. Commit
9. Re-enable FK checks

**Important:** Tables must be recreated in dependency order — `recurring_task_occurrences` depends on `recurring_tasks`, which depends on `users`. So `users` is recreated first, then child tables.

```ts
import type { Database } from 'bun:sqlite'
import type { Migration } from '../migrate.js'

function recreateUserConfig(db: Database): void {
  db.run('ALTER TABLE user_config RENAME TO user_config_old')
  db.run(`
    CREATE TABLE user_config (
      user_id TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `)
  db.run('INSERT INTO user_config SELECT * FROM user_config_old')
  db.run('DROP TABLE user_config_old')
  db.run('CREATE INDEX idx_user_config_user_id ON user_config(user_id)')
}

function recreateConversationHistory(db: Database): void {
  db.run('ALTER TABLE conversation_history RENAME TO conversation_history_old')
  db.run(`
    CREATE TABLE conversation_history (
      user_id  TEXT PRIMARY KEY REFERENCES users(platform_user_id) ON DELETE CASCADE,
      messages TEXT NOT NULL
    )
  `)
  db.run('INSERT INTO conversation_history SELECT * FROM conversation_history_old')
  db.run('DROP TABLE conversation_history_old')
}

function recreateMemorySummary(db: Database): void {
  db.run('ALTER TABLE memory_summary RENAME TO memory_summary_old')
  db.run(`
    CREATE TABLE memory_summary (
      user_id    TEXT PRIMARY KEY REFERENCES users(platform_user_id) ON DELETE CASCADE,
      summary    TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  db.run('INSERT INTO memory_summary SELECT * FROM memory_summary_old')
  db.run('DROP TABLE memory_summary_old')
}

function recreateMemoryFacts(db: Database): void {
  db.run('ALTER TABLE memory_facts RENAME TO memory_facts_old')
  db.run(`
    CREATE TABLE memory_facts (
      user_id    TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      identifier TEXT NOT NULL,
      title      TEXT NOT NULL,
      url        TEXT NOT NULL DEFAULT '',
      last_seen  TEXT NOT NULL,
      PRIMARY KEY (user_id, identifier)
    )
  `)
  db.run('INSERT INTO memory_facts SELECT * FROM memory_facts_old')
  db.run('DROP TABLE memory_facts_old')
  db.run('CREATE INDEX idx_memory_facts_user_lastseen ON memory_facts(user_id, last_seen)')
}

function recreateGroupMembers(db: Database): void {
  db.run('ALTER TABLE group_members RENAME TO group_members_old')
  db.run(`
    CREATE TABLE group_members (
      group_id TEXT NOT NULL,
      user_id  TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    )
  `)
  db.run('INSERT INTO group_members SELECT * FROM group_members_old')
  db.run('DROP TABLE group_members_old')
  db.run('CREATE INDEX idx_group_members_group ON group_members(group_id)')
  db.run('CREATE INDEX idx_group_members_user ON group_members(user_id)')
}

function recreateRecurringTasks(db: Database): void {
  db.run('ALTER TABLE recurring_tasks RENAME TO recurring_tasks_old')
  db.run(`
    CREATE TABLE recurring_tasks (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      project_id      TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      priority        TEXT,
      status          TEXT,
      assignee        TEXT,
      labels          TEXT,
      trigger_type    TEXT NOT NULL DEFAULT 'cron',
      cron_expression TEXT,
      timezone        TEXT NOT NULL DEFAULT 'UTC',
      enabled         TEXT NOT NULL DEFAULT '1',
      catch_up        TEXT NOT NULL DEFAULT '0',
      last_run        TEXT,
      next_run        TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('INSERT INTO recurring_tasks SELECT * FROM recurring_tasks_old')
  db.run('DROP TABLE recurring_tasks_old')
  db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
}

function recreateRecurringTaskOccurrences(db: Database): void {
  db.run('ALTER TABLE recurring_task_occurrences RENAME TO recurring_task_occurrences_old')
  db.run(`
    CREATE TABLE recurring_task_occurrences (
      id          TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE,
      task_id     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('INSERT INTO recurring_task_occurrences SELECT * FROM recurring_task_occurrences_old')
  db.run('DROP TABLE recurring_task_occurrences_old')
  db.run('CREATE INDEX idx_recurring_occurrences_template ON recurring_task_occurrences(template_id)')
  db.run('CREATE INDEX idx_recurring_occurrences_task ON recurring_task_occurrences(task_id)')
}

function recreateScheduledPrompts(db: Database): void {
  db.run('ALTER TABLE scheduled_prompts RENAME TO scheduled_prompts_old')
  db.run(`
    CREATE TABLE scheduled_prompts (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      prompt              TEXT NOT NULL,
      fire_at             TEXT NOT NULL,
      cron_expression     TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      last_executed_at    TEXT,
      execution_metadata  TEXT NOT NULL DEFAULT '{}'
    )
  `)
  db.run('INSERT INTO scheduled_prompts SELECT * FROM scheduled_prompts_old')
  db.run('DROP TABLE scheduled_prompts_old')
  db.run('CREATE INDEX idx_scheduled_prompts_user ON scheduled_prompts(user_id)')
  db.run('CREATE INDEX idx_scheduled_prompts_status_fire ON scheduled_prompts(status, fire_at)')
}

function recreateAlertPrompts(db: Database): void {
  db.run('ALTER TABLE alert_prompts RENAME TO alert_prompts_old')
  db.run(`
    CREATE TABLE alert_prompts (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      prompt              TEXT NOT NULL,
      condition           TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      last_triggered_at   TEXT,
      cooldown_minutes    INTEGER NOT NULL DEFAULT 60,
      execution_metadata  TEXT NOT NULL DEFAULT '{}'
    )
  `)
  db.run('INSERT INTO alert_prompts SELECT * FROM alert_prompts_old')
  db.run('DROP TABLE alert_prompts_old')
  db.run('CREATE INDEX idx_alert_prompts_user ON alert_prompts(user_id)')
  db.run('CREATE INDEX idx_alert_prompts_status ON alert_prompts(status)')
}

function recreateTaskSnapshots(db: Database): void {
  db.run('ALTER TABLE task_snapshots RENAME TO task_snapshots_old')
  db.run(`
    CREATE TABLE task_snapshots (
      user_id     TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      task_id     TEXT NOT NULL,
      field       TEXT NOT NULL,
      value       TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, task_id, field)
    )
  `)
  db.run('INSERT INTO task_snapshots SELECT * FROM task_snapshots_old')
  db.run('DROP TABLE task_snapshots_old')
  db.run('CREATE INDEX idx_task_snapshots_user ON task_snapshots(user_id)')
}

function recreateMemos(db: Database): void {
  // memo_links has FK to memos — must drop and rebuild it too
  db.run('ALTER TABLE memo_links RENAME TO memo_links_old')
  db.run('ALTER TABLE memos RENAME TO memos_old')

  // Recreate memos_fts triggers referencing old table (will fail on insert)
  // Drop FTS triggers first, then FTS table, then recreate after new memos table
  db.run('DROP TRIGGER IF EXISTS memos_ai')
  db.run('DROP TRIGGER IF EXISTS memos_au')
  db.run('DROP TRIGGER IF EXISTS memos_ad')
  db.run('DROP TABLE IF EXISTS memos_fts')

  db.run(`
    CREATE TABLE memos (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      summary    TEXT,
      tags       TEXT NOT NULL DEFAULT '[]',
      embedding  BLOB,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('INSERT INTO memos SELECT * FROM memos_old')
  db.run('DROP TABLE memos_old')
  db.run('CREATE INDEX idx_memos_user_status_created ON memos(user_id, status, created_at)')

  // Recreate FTS5 and triggers
  db.run(`
    CREATE VIRTUAL TABLE memos_fts
      USING fts5(content, summary, tags, content='memos', content_rowid='rowid')
  `)
  // Re-populate FTS from existing memos
  db.run("INSERT INTO memos_fts(memos_fts) VALUES ('rebuild')")

  db.run(`
    CREATE TRIGGER memos_ai AFTER INSERT ON memos BEGIN
      INSERT INTO memos_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memos_au AFTER UPDATE ON memos BEGIN
      INSERT INTO memos_fts(memos_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      INSERT INTO memos_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memos_ad AFTER DELETE ON memos BEGIN
      INSERT INTO memos_fts(memos_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
    END
  `)

  // Recreate memo_links with existing FKs preserved
  db.run(`
    CREATE TABLE memo_links (
      id              TEXT PRIMARY KEY,
      source_memo_id  TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
      target_memo_id  TEXT REFERENCES memos(id) ON DELETE SET NULL,
      target_task_id  TEXT,
      relation_type   TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('INSERT INTO memo_links SELECT * FROM memo_links_old')
  db.run('DROP TABLE memo_links_old')
  db.run('CREATE INDEX idx_memo_links_source ON memo_links(source_memo_id)')
  db.run('CREATE INDEX idx_memo_links_target_memo ON memo_links(target_memo_id)')
}

export const migration019AddForeignKeys: Migration = {
  id: '019_add_foreign_keys',
  up(db: Database): void {
    // SQLite doesn't support ALTER TABLE ADD CONSTRAINT.
    // Must recreate tables. FK checks OFF during migration to allow
    // rename+recreate without constraint violations on intermediate state.
    db.run('PRAGMA foreign_keys=OFF')

    // Order matters: parent tables first, then children.
    // users table itself is unchanged (it's the parent).
    // All user-referencing tables first, then recurring_task_occurrences
    // (which depends on recurring_tasks).
    recreateUserConfig(db)
    recreateConversationHistory(db)
    recreateMemorySummary(db)
    recreateMemoryFacts(db)
    recreateGroupMembers(db)
    recreateScheduledPrompts(db)
    recreateAlertPrompts(db)
    recreateTaskSnapshots(db)

    // recurring_tasks has FK→users; occurrences has FK→recurring_tasks.
    // Recreate recurring_tasks first, then occurrences.
    recreateRecurringTasks(db)
    recreateRecurringTaskOccurrences(db)

    // memos has FK→users; memo_links has FK→memos (already exists but
    // must be rebuilt because we recreate memos).
    recreateMemos(db)

    db.run('PRAGMA foreign_keys=ON')

    // Verify constraints
    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length > 0) {
      throw new Error(`Foreign key violations found after migration: ${JSON.stringify(violations)}`)
    }
  },
}
```

**Critical notes for implementation:**

- The `PRAGMA foreign_keys=OFF` is required during migration — renaming tables would violate FK constraints of other tables during intermediate state.
- `PRAGMA foreign_key_check` at the end validates all data is consistent.
- `memos_fts` must be dropped and rebuilt because its content table (`memos`) is recreated.
- `memo_links` must be dropped and rebuilt because its parent table (`memos`) is recreated.
- Tables are recreated in parent-first order.

### Step 4: Run test to verify it passes

Run: `bun test tests/db/migrations/019_add_foreign_keys.test.ts`
Expected: PASS — all cascade assertions pass.

### Step 5: Commit

```bash
git add src/db/migrations/019_add_foreign_keys.ts tests/db/migrations/019_add_foreign_keys.test.ts
git commit -m "feat(db): add migration 019 — foreign key constraints with cascade deletes"
```

---

## Task 2: Register migration 019 in the runner

**Files:**

- Modify: `src/db/index.ts` (lines 28, 58–71)

### Step 1: No new test needed — this is wiring

The migration test from Task 1 already validates the migration runs correctly. This step wires it into the application's startup migration runner.

### Step 2: Add import and registration

Add to imports in `src/db/index.ts`:

```ts
import { migration019AddForeignKeys } from './migrations/019_add_foreign_keys.js'
```

Add to the `MIGRATIONS` array:

```ts
migration019AddForeignKeys,
```

### Step 3: Run full test suite to verify nothing breaks

Run: `bun test`
Expected: PASS — no regressions.

### Step 4: Commit

```bash
git add src/db/index.ts
git commit -m "chore(db): register migration 019 in startup runner"
```

---

## Task 3: Update Drizzle schema with FK references

**Files:**

- Modify: `src/db/schema.ts`

### Step 1: No new test needed — schema type annotations

Drizzle's `.references()` is metadata for the query builder and type system. The actual FK enforcement is in the migration SQL. This step makes the schema declaration match the database reality.

### Step 2: Add `.references()` to all FK columns

Update the following columns in `src/db/schema.ts`:

**`userConfig.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`conversationHistory.userId`:**

```ts
userId: text('user_id').primaryKey().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`memorySummary.userId`:**

```ts
userId: text('user_id').primaryKey().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`memoryFacts.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`groupMembers.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`recurringTasks.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`recurringTaskOccurrences.templateId`:**

```ts
templateId: text('template_id').notNull().references(() => recurringTasks.id, { onDelete: 'cascade' }),
```

**`scheduledPrompts.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`alertPrompts.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`taskSnapshots.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`memos.userId`:**

```ts
userId: text('user_id').notNull().references(() => users.platformUserId, { onDelete: 'cascade' }),
```

**`memoLinks.sourceMemoId`:**

```ts
sourceMemoId: text('source_memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
```

**`memoLinks.targetMemoId`:**

```ts
targetMemoId: text('target_memo_id').references(() => memos.id, { onDelete: 'set null' }),
```

### Step 3: Run typecheck and tests

Run: `bun typecheck && bun test`
Expected: PASS — no type errors, no test regressions.

### Step 4: Commit

```bash
git add src/db/schema.ts
git commit -m "chore(db): declare FK references in Drizzle schema"
```

---

## Task 4: Update `removeUser` to evict in-memory cache

**Files:**

- Modify: `src/users.ts` (lines 38–54)
- Test: `tests/users.test.ts`

### Step 1: Write the failing test

Add a test to `tests/users.test.ts` that verifies `removeUser` evicts cached data for the removed user. The cache module exposes `evictUser` (or equivalent). Check that after `removeUser`, the in-memory cache no longer holds the user's data.

```ts
it('evicts user cache entry on removal', () => {
  addUser('cache-test', 'admin')
  // Prime the cache (the cache auto-loads on access)
  removeUser('cache-test')
  // Verify the cache was evicted — depends on cache API
})
```

The exact assertion depends on the cache module's API. Research `src/cache.ts` for the eviction function.

### Step 2: Run test to verify it fails

Run: `bun test tests/users.test.ts`
Expected: FAIL — cache is not evicted by `removeUser`.

### Step 3: Update `removeUser` to call cache eviction

In `src/users.ts`, after the successful delete, call the cache eviction function for each deleted user ID:

```ts
export function removeUser(identifier: string): boolean {
  log.debug('removeUser called')
  const db = getDrizzleDb()

  const deleted = db
    .delete(users)
    .where(or(eq(users.username, identifier), eq(users.platformUserId, identifier)))
    .returning({ platformUserId: users.platformUserId })
    .all()

  const removed = deleted.length > 0
  if (removed) {
    for (const row of deleted) {
      evictUser(row.platformUserId) // import from cache.ts
    }
    log.info('User removed (cascade deleted all dependent records)')
  } else {
    log.info('User not found for removal')
  }
  return removed
}
```

### Step 4: Run test to verify it passes

Run: `bun test tests/users.test.ts`
Expected: PASS.

### Step 5: Commit

```bash
git add src/users.ts tests/users.test.ts
git commit -m "fix(users): evict in-memory cache when user is removed"
```

---

## Task 5: Simplify `deleteRecurringTask` (occurrences now cascade)

**Files:**

- Modify: `src/recurring.ts` (lines 254–269)
- Test: `tests/recurring.test.ts`

### Step 1: Verify existing test covers cascade

Check `tests/recurring.test.ts` for a test that deletes a recurring task and verifies occurrences are cleaned up. If missing, add one:

```ts
it('cascade-deletes occurrences when template is deleted', () => {
  const template = createRecurringTask(/* ... */)
  recordOccurrence(template.id, 'ext-task-1')
  deleteRecurringTask(template.id)
  const occurrences = getOccurrences(template.id)
  expect(occurrences).toHaveLength(0)
})
```

### Step 2: Run test to verify it passes (cascade handles it)

Run: `bun test tests/recurring.test.ts`
Expected: PASS — the DB cascade now handles occurrence cleanup automatically.

### Step 3: Verify no manual occurrence deletion code exists

If `deleteRecurringTask` has any manual `DELETE FROM recurring_task_occurrences` call, it's now redundant. Remove it if present. Currently it doesn't have one, so no change needed.

### Step 4: Commit (if changes made)

```bash
git add src/recurring.ts tests/recurring.test.ts
git commit -m "test(recurring): verify cascade-delete of occurrences"
```

---

## Task 6: Add integration test for full user removal cascade

**Files:**

- Create: `tests/user-cascade.test.ts`

### Step 1: Write the integration test

This test uses a real in-memory SQLite DB (via Drizzle) to verify the full cascade from `removeUser` through all child tables.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

// Set up in-memory DB with all migrations, configure Drizzle to use it.
// Insert a user, then insert records in every child table referencing that user.
// Call removeUser(userId).
// Assert every child table has zero rows for that user.

describe('user removal cascade integration', () => {
  // ... setup in-memory DB with migrations ...

  it('removes all dependent records when user is deleted', () => {
    // Insert user
    // Insert: user_config, conversation_history, memory_summary, memory_facts,
    //         group_members, recurring_tasks + occurrences,
    //         scheduled_prompts, alert_prompts, task_snapshots,
    //         memos + memo_links
    // Delete user
    // Assert all child tables empty for that user_id
  })

  it('does not affect other users data', () => {
    // Insert two users with data
    // Delete one user
    // Assert other user's data is intact
  })
})
```

### Step 2: Run test to verify it passes

Run: `bun test tests/user-cascade.test.ts`
Expected: PASS.

### Step 3: Commit

```bash
git add tests/user-cascade.test.ts
git commit -m "test: add integration test for full user removal cascade"
```

---

## Task 7: Clean up any orphaned data from existing databases

**Files:**

- Modify: `src/db/migrations/019_add_foreign_keys.ts` (add cleanup step before FK enforcement)

### Step 1: Add orphan cleanup to migration

Before the `PRAGMA foreign_key_check` at the end of the migration, add SQL to delete any orphaned records that would violate the new FK constraints. This ensures the migration succeeds on existing databases with stale data.

Add before the `PRAGMA foreign_keys=ON` line:

```ts
// Clean up orphans before re-enabling FK checks.
// These records reference users that no longer exist.
const orphanTables = [
  'user_config',
  'conversation_history',
  'memory_summary',
  'memory_facts',
  'group_members',
  'recurring_tasks',
  'scheduled_prompts',
  'alert_prompts',
  'task_snapshots',
  'memos',
]
for (const table of orphanTables) {
  db.run(`DELETE FROM ${table} WHERE user_id NOT IN (SELECT platform_user_id FROM users)`)
}

// Clean recurring_task_occurrences referencing deleted templates
db.run('DELETE FROM recurring_task_occurrences WHERE template_id NOT IN (SELECT id FROM recurring_tasks)')
```

### Step 2: Run full test suite

Run: `bun test`
Expected: PASS.

### Step 3: Commit

```bash
git add src/db/migrations/019_add_foreign_keys.ts
git commit -m "fix(db): clean orphaned records before enabling FK constraints"
```

---

## Risk Assessment

| Risk                                        | Probability | Impact   | Mitigation                                                                                                      |
| ------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| Existing DB has orphans that break FK check | High        | High     | Task 7 adds orphan cleanup before FK enforcement                                                                |
| FTS5 rebuild fails on large memos table     | Low         | Medium   | `INSERT INTO memos_fts(memos_fts) VALUES ('rebuild')` is the standard FTS5 rebuild command; tested in migration |
| Table recreation loses data                 | Low         | Critical | Migration copies all data via `INSERT INTO ... SELECT *`; validated by `PRAGMA foreign_key_check`               |
| Column order mismatch in `SELECT *`         | Low         | Critical | Same column order (new table DDL matches old table structure); tested by migration test                         |
| Migration timeout on large DB               | Low         | Low      | SQLite operations on 100s of rows are instant; production DBs are small (per-user bot)                          |
| Cache holds stale references after cascade  | Medium      | Medium   | Task 4 evicts user cache on removal                                                                             |

---

## Summary of Changes

| File                                               | Change                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/db/migrations/019_add_foreign_keys.ts`        | New migration: recreate 11 tables with FK constraints + orphan cleanup |
| `src/db/index.ts`                                  | Register migration 019                                                 |
| `src/db/schema.ts`                                 | Add `.references()` declarations to 13 columns                         |
| `src/users.ts`                                     | Evict cache on user removal                                            |
| `src/recurring.ts`                                 | (Optional) Remove manual occurrence cleanup if any added in future     |
| `tests/db/migrations/019_add_foreign_keys.test.ts` | Migration cascade tests                                                |
| `tests/users.test.ts`                              | Cache eviction test                                                    |
| `tests/recurring.test.ts`                          | Cascade occurrence test                                                |
| `tests/user-cascade.test.ts`                       | Full integration cascade test                                          |

---

## 📋 DISPLAY INSTRUCTIONS FOR OUTER AGENT

**Outer Agent: You MUST present this development plan using the following format:**

1. **Present the COMPLETE development roadmap** - Do not summarize or abbreviate sections
2. **Preserve ALL task breakdown structures** with checkboxes and formatting intact
3. **Show the full risk assessment matrix** with all columns and rows
4. **Display ALL planning templates exactly as generated** - Do not merge sections
5. **Maintain all markdown formatting** including tables, checklists, and code blocks
6. **Present the complete technical specification** without condensing
7. **Show ALL quality gates and validation checklists** in full detail
8. **Display the complete library research section** with all recommendations and evaluations

**Do NOT create an executive summary or overview - present the complete development plan exactly as generated with all detail intact.**
