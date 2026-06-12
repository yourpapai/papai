<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Phase 2 DB Integrity First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move multi-provider ownership integrity from route conventions into SQLite-enforced foreign keys while preserving Phase 1 cache invalidation and admin API behavior.

**Architecture:** Add a final integrity migration after `043_scoped_context_ids` that rebuilds constrained tables, splits super-admin and platform-admin storage, and asserts no FK violations. Update Drizzle schemas and stores to use the constrained model, repair deterministic scoped-context migration behavior before release, and keep route-level cache invalidation as a side effect rather than a data-integrity mechanism.

**Tech Stack:** Bun test runner, Bun SQLite migrations, Drizzle SQLite schema/stores, TypeScript, existing debug instance API routes.

---

## Context Verified

- SQLite docs confirm foreign key constraints enforce parent/child existence and support `ON DELETE CASCADE` when foreign keys are enabled.
- SQLite docs confirm `ALTER TABLE` only supports limited schema changes, so adding foreign keys to existing tables requires table rebuilds.
- Drizzle ORM docs confirm SQLite columns can use `.references(() => table.id, { onDelete: 'cascade' })`.
- Bun SQLite docs confirm `Database.transaction()` commits on callback return and rolls back on exceptions.

## File Map

- Modify: `docs/superpowers/specs/2026-05-26-multi-provider-phase-2-db-integrity-first.md` - already aligned to branch-local `043` repair and cascade-plus-cache route behavior.
- Rename: `src/db/migrations/043_scoped_context_ids_columns.ts` to `src/db/migrations/scoped-context-owned-columns.ts`.
- Modify: `src/db/migrations/043_scoped_context_ids.ts` - remove `CHAT_PROVIDER` fallback and import renamed helper.
- Create: `src/db/migrations/044_instance_integrity.ts` - cleanup orphans, split admins, rebuild constrained tables, assert FK check.
- Modify: `src/db/index.ts` - register migration `044_instance_integrity` after `043_scoped_context_ids`.
- Modify: `src/db/instance-schema.ts` - add FK references and split admin table schemas.
- Modify: `src/db/schema.ts` - make `users.platform_instance_id` reference `platform_instances(id)` with cascade, and re-export new admin table schemas.
- Modify: `src/instances/admin-store.ts` - map public admin store API onto `super_admins` and `platform_admins`.
- Modify: `src/debug/instance-routes.ts` - rely on cascades for deletes while preserving cache invalidation, and reject missing platform-admin targets before insert.
- Modify: `src/cache-db.ts` - stop mirroring workspace IDs into `users.kaneo_workspace_id`.
- Modify: `src/stats/global-mix.ts` - count Kaneo workspace presence from `user_config`.
- Modify: `src/stats/per-table-subject.ts` - read per-user workspace presence from `user_config`.
- Modify: `tests/db/migrations/043_scoped_context_ids.test.ts` - replace env-derived platform-id expectations.
- Create: `tests/db/migrations/044_instance_integrity.test.ts` - cover orphan cleanup, split admins, cascades, and FK checks.
- Modify: `tests/db/migration-registration.test.ts` - expect `044_instance_integrity` as the last migration.
- Modify: `tests/instances/admin-store.test.ts` - cover split admin store behavior and missing platform insert failure.
- Modify: `tests/debug/instance-routes.test.ts` - cover cascade-backed deletes, cache invalidation, super-admin preservation, and missing platform-admin response.
- Modify: `tests/cache-db.test.ts` - assert workspace sync writes only `user_config`.
- Modify: `tests/stats/global-mix.test.ts` - seed `user_config` for workspace counts.
- Modify: `tests/stats/per-table-user-group.test.ts` - seed `user_config` for per-subject workspace presence.

## Task 1: Repair Deterministic Scoped-Context Migration

**Files:**

- Rename: `src/db/migrations/043_scoped_context_ids_columns.ts` to `src/db/migrations/scoped-context-owned-columns.ts`
- Modify: `src/db/migrations/043_scoped_context_ids.ts`
- Test: `tests/db/migrations/043_scoped_context_ids.test.ts`

- [ ] **Step 1: Rename the helper file**

Run:

```bash
git mv src/db/migrations/043_scoped_context_ids_columns.ts src/db/migrations/scoped-context-owned-columns.ts
```

- [ ] **Step 2: Write the failing deterministic migration tests**

In `tests/db/migrations/043_scoped_context_ids.test.ts`, replace the test named `uses future bootstrap platform id when upgrading before instance bootstrap` with:

```typescript
test('preserves zero-instance legacy rows even when CHAT_PROVIDER is set', () => {
  process.env['CHAT_PROVIDER'] = 'telegram'
  db.run(`INSERT INTO user_config VALUES ('user-1', 'timezone', 'UTC')`)
  db.run(`INSERT INTO authorized_groups VALUES ('group-1', 'admin', 'now')`)

  migration043ScopedContextIds.up(db)

  expect(db.query('SELECT user_id FROM user_config').get()).toEqual({ user_id: 'user-1' })
  expect(db.query('SELECT group_id FROM authorized_groups').get()).toEqual({ group_id: 'group-1' })
})
```

Replace the test named `moves direct-upgrade legacy users to future bootstrap platform id` with:

```typescript
test('moves direct-upgrade legacy users only when exactly one platform exists', () => {
  process.env['CHAT_PROVIDER'] = 'telegram'
  db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
  db.run(`INSERT INTO users VALUES ('user-1', '__unscoped_legacy__', 'alice', '2026-01-01', 'admin')`)

  migration043ScopedContextIds.up(db)

  expect(db.query(`SELECT platform_user_id, platform_instance_id, username FROM users`).all()).toEqual([
    { platform_user_id: 'user-1', platform_instance_id: 'telegram-default', username: 'alice' },
  ])
})
```

Replace the test named `trims chat provider before deriving future bootstrap platform id` with:

```typescript
test('preserves legacy sentinel users when no platform instance exists even with trimmed CHAT_PROVIDER', () => {
  process.env['CHAT_PROVIDER'] = ' telegram '
  db.run(`INSERT INTO users VALUES ('user-1', '__unscoped_legacy__', 'alice', '2026-01-01', 'admin')`)

  migration043ScopedContextIds.up(db)

  expect(db.query(`SELECT platform_instance_id FROM users`).get()).toEqual({
    platform_instance_id: '__unscoped_legacy__',
  })
})
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run: `bun test tests/db/migrations/043_scoped_context_ids.test.ts`

Expected: FAIL because `043_scoped_context_ids.ts` still derives `telegram-default` from `CHAT_PROVIDER` when zero platform instances exist, and because the renamed helper import is not updated yet.

- [ ] **Step 4: Implement deterministic owner selection**

In `src/db/migrations/043_scoped_context_ids.ts`, update the helper import to:

```typescript
import { CONTEXT_OWNED_COLUMNS, type ContextOwnedColumn } from './scoped-context-owned-columns.js'
```

Delete the `parseBootstrapChatProvider()` function entirely.

Replace `getPlatformInstanceId()` with:

```typescript
const getPlatformInstanceId = (db: Database): string | null => {
  if (!tableExists(db, 'platform_instances')) return null
  const rows = db.query<{ id: string }, []>(`SELECT id FROM platform_instances ORDER BY id`).all()
  if (rows.length === 1) return rows[0]!.id
  return null
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `bun test tests/db/migrations/043_scoped_context_ids.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add src/db/migrations/043_scoped_context_ids.ts src/db/migrations/scoped-context-owned-columns.ts tests/db/migrations/043_scoped_context_ids.test.ts
git add -u src/db/migrations/043_scoped_context_ids_columns.ts
git commit -m "fix(db): make scoped context migration deterministic"
```

## Task 2: Add Integrity Migration 044

**Files:**

- Create: `src/db/migrations/044_instance_integrity.ts`
- Modify: `src/db/index.ts`
- Test: `tests/db/migrations/044_instance_integrity.test.ts`
- Test: `tests/db/migration-registration.test.ts`

- [ ] **Step 1: Write the migration tests**

Create `tests/db/migrations/044_instance_integrity.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration044InstanceIntegrity } from '../../../src/db/migrations/044_instance_integrity.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getRows = <T>(db: Database, sql: string): T[] => db.query<T, []>(sql).all()

const createLegacyTables = (db: Database): void => {
  db.run(
    `CREATE TABLE platform_instances (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  )
  db.run(
    `CREATE TABLE task_instances (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  )
  db.run(
    `CREATE TABLE context_settings (context_id TEXT PRIMARY KEY, task_instance_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL)`,
  )
  db.run(`CREATE INDEX idx_context_settings_task_instance ON context_settings (task_instance_id)`)
  db.run(`CREATE INDEX idx_context_settings_platform_instance ON context_settings (platform_instance_id)`)
  db.run(
    `CREATE TABLE users (platform_user_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL, username TEXT, added_at TEXT NOT NULL DEFAULT (datetime('now')), added_by TEXT NOT NULL, kaneo_workspace_id TEXT, PRIMARY KEY (platform_instance_id, platform_user_id))`,
  )
  db.run(`CREATE INDEX idx_users_platform_user ON users (platform_instance_id, platform_user_id)`)
  db.run(`CREATE INDEX idx_users_platform_username ON users (platform_instance_id, username)`)
  db.run(
    `CREATE UNIQUE INDEX idx_users_platform_username_unique ON users(platform_instance_id, username) WHERE username IS NOT NULL`,
  )
  db.run(
    `CREATE TABLE admins (user_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, platform_instance_id))`,
  )
}

describe('migration044InstanceIntegrity', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    createLegacyTables(db)
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 044_instance_integrity', () => {
    expect(migration044InstanceIntegrity.id).toBe('044_instance_integrity')
  })

  test('cleans orphan rows and splits admin storage', () => {
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('tg-default', 'telegram', '{}', 'active')`,
    )
    db.run(`INSERT INTO task_instances (id, type, config, status) VALUES ('kaneo-default', 'kaneo', '{}', 'active')`)
    db.run(`INSERT INTO context_settings VALUES ('ctx-valid', 'kaneo-default', 'tg-default')`)
    db.run(`INSERT INTO context_settings VALUES ('ctx-missing-task', 'missing-task', 'tg-default')`)
    db.run(`INSERT INTO context_settings VALUES ('ctx-missing-platform', 'kaneo-default', 'missing-platform')`)
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by) VALUES ('u1', 'tg-default', 'alice', 'admin')`,
    )
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by) VALUES ('u2', 'missing-platform', 'bob', 'admin')`,
    )
    db.run(`INSERT INTO admins (user_id, platform_instance_id, created_at) VALUES ('root', '__super__', 'now')`)
    db.run(
      `INSERT INTO admins (user_id, platform_instance_id, created_at) VALUES ('platform-admin', 'tg-default', 'now')`,
    )
    db.run(
      `INSERT INTO admins (user_id, platform_instance_id, created_at) VALUES ('orphan-admin', 'missing-platform', 'now')`,
    )

    migration044InstanceIntegrity.up(db)

    expect(getRows<{ context_id: string }>(db, `SELECT context_id FROM context_settings`)).toEqual([
      { context_id: 'ctx-valid' },
    ])
    expect(getRows<{ platform_user_id: string }>(db, `SELECT platform_user_id FROM users`)).toEqual([
      { platform_user_id: 'u1' },
    ])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM super_admins`)).toEqual([{ user_id: 'root' }])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM platform_admins`)).toEqual([
      { user_id: 'platform-admin' },
    ])
    expect(getRows(db, `PRAGMA foreign_key_check`)).toEqual([])
  })

  test('deleting parent instances cascades constrained dependents', () => {
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('tg-default', 'telegram', '{}', 'active')`,
    )
    db.run(`INSERT INTO task_instances (id, type, config, status) VALUES ('kaneo-default', 'kaneo', '{}', 'active')`)
    db.run(`INSERT INTO context_settings VALUES ('ctx-1', 'kaneo-default', 'tg-default')`)
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by) VALUES ('u1', 'tg-default', 'alice', 'admin')`,
    )
    db.run(`INSERT INTO admins (user_id, platform_instance_id) VALUES ('root', '__super__')`)
    db.run(`INSERT INTO admins (user_id, platform_instance_id) VALUES ('platform-admin', 'tg-default')`)

    migration044InstanceIntegrity.up(db)
    db.run(`DELETE FROM platform_instances WHERE id = 'tg-default'`)

    expect(getRows(db, `SELECT * FROM context_settings`)).toEqual([])
    expect(getRows(db, `SELECT * FROM users`)).toEqual([])
    expect(getRows(db, `SELECT * FROM platform_admins`)).toEqual([])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM super_admins`)).toEqual([{ user_id: 'root' }])
  })

  test('deleting task instances cascades context settings', () => {
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('tg-default', 'telegram', '{}', 'active')`,
    )
    db.run(`INSERT INTO task_instances (id, type, config, status) VALUES ('kaneo-default', 'kaneo', '{}', 'active')`)
    db.run(`INSERT INTO context_settings VALUES ('ctx-1', 'kaneo-default', 'tg-default')`)

    migration044InstanceIntegrity.up(db)
    db.run(`DELETE FROM task_instances WHERE id = 'kaneo-default'`)

    expect(getRows(db, `SELECT * FROM context_settings`)).toEqual([])
  })
})
```

In `tests/db/migration-registration.test.ts`, replace the final test with:

```typescript
test('044 is the last migration', () => {
  const lastMigration = requireDefined(MIGRATIONS.at(-1))
  expect(lastMigration.id).toBe('044_instance_integrity')
})
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `bun test tests/db/migrations/044_instance_integrity.test.ts tests/db/migration-registration.test.ts`

Expected: FAIL because `044_instance_integrity.ts` does not exist and `MIGRATIONS` still ends at `043_scoped_context_ids`.

- [ ] **Step 3: Add migration 044 implementation**

Create `src/db/migrations/044_instance_integrity.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:044' })
const SUPER_ADMIN_PLATFORM_ID = '__super__'

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const runCountedDelete = (db: Database, sql: string): number => {
  const before = db.query<{ count: number }, []>(`SELECT changes() AS count`).get()?.count ?? 0
  db.run(sql)
  const after = db.query<{ count: number }, []>(`SELECT changes() AS count`).get()?.count ?? before
  return after
}

const cleanupOrphans = (db: Database): void => {
  const contextMissingTask = runCountedDelete(
    db,
    `DELETE FROM context_settings WHERE task_instance_id NOT IN (SELECT id FROM task_instances)`,
  )
  const contextMissingPlatform = runCountedDelete(
    db,
    `DELETE FROM context_settings WHERE platform_instance_id NOT IN (SELECT id FROM platform_instances)`,
  )
  const usersMissingPlatform = runCountedDelete(
    db,
    `DELETE FROM users WHERE platform_instance_id NOT IN (SELECT id FROM platform_instances)`,
  )
  const adminsMissingPlatform = tableExists(db, 'admins')
    ? runCountedDelete(
        db,
        `DELETE FROM admins WHERE platform_instance_id <> '${SUPER_ADMIN_PLATFORM_ID}' AND platform_instance_id NOT IN (SELECT id FROM platform_instances)`,
      )
    : 0
  log.info(
    { contextMissingTask, contextMissingPlatform, usersMissingPlatform, adminsMissingPlatform },
    'migration 044: orphan cleanup complete',
  )
}

const rebuildContextSettings = (db: Database): void => {
  db.run(`DROP TABLE IF EXISTS context_settings_new`)
  db.run(`
    CREATE TABLE context_settings_new (
      context_id           TEXT PRIMARY KEY,
      task_instance_id     TEXT NOT NULL REFERENCES task_instances(id) ON DELETE CASCADE,
      platform_instance_id TEXT NOT NULL REFERENCES platform_instances(id) ON DELETE CASCADE
    )
  `)
  db.run(
    `INSERT INTO context_settings_new SELECT context_id, task_instance_id, platform_instance_id FROM context_settings`,
  )
  db.run(`DROP TABLE context_settings`)
  db.run(`ALTER TABLE context_settings_new RENAME TO context_settings`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_context_settings_task_instance ON context_settings (task_instance_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_context_settings_platform_instance ON context_settings (platform_instance_id)`)
}

const rebuildUsers = (db: Database): void => {
  db.run(`DROP TABLE IF EXISTS users_new`)
  db.run(`
    CREATE TABLE users_new (
      platform_user_id     TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL REFERENCES platform_instances(id) ON DELETE CASCADE,
      username             TEXT,
      added_at             TEXT NOT NULL DEFAULT (datetime('now')),
      added_by             TEXT NOT NULL,
      kaneo_workspace_id   TEXT,
      PRIMARY KEY (platform_instance_id, platform_user_id)
    )
  `)
  db.run(
    `INSERT INTO users_new SELECT platform_user_id, platform_instance_id, username, added_at, added_by, kaneo_workspace_id FROM users`,
  )
  db.run(`DROP TABLE users`)
  db.run(`ALTER TABLE users_new RENAME TO users`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_user ON users (platform_instance_id, platform_user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_username ON users (platform_instance_id, username)`)
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_username_unique ON users(platform_instance_id, username) WHERE username IS NOT NULL`,
  )
}

const splitAdmins = (db: Database): void => {
  db.run(
    `CREATE TABLE IF NOT EXISTS super_admins (user_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  )
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_admins (
      user_id              TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL REFERENCES platform_instances(id) ON DELETE CASCADE,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, platform_instance_id)
    )
  `)
  if (tableExists(db, 'admins')) {
    db.run(
      `INSERT OR IGNORE INTO super_admins (user_id, created_at) SELECT user_id, created_at FROM admins WHERE platform_instance_id = ?`,
      [SUPER_ADMIN_PLATFORM_ID],
    )
    db.run(
      `INSERT OR IGNORE INTO platform_admins (user_id, platform_instance_id, created_at) SELECT user_id, platform_instance_id, created_at FROM admins WHERE platform_instance_id <> ?`,
      [SUPER_ADMIN_PLATFORM_ID],
    )
    db.run(`DROP TABLE admins`)
  }
}

const assertNoForeignKeyViolations = (db: Database): void => {
  const violations = db
    .query<{ table: string; rowid: number | null; parent: string; fkid: number }, []>(`PRAGMA foreign_key_check`)
    .all()
  if (violations.length > 0) throw new Error(`migration 044 foreign key violations: ${JSON.stringify(violations)}`)
}

const up = (db: Database): void => {
  const run = db.transaction(() => {
    cleanupOrphans(db)
    rebuildContextSettings(db)
    rebuildUsers(db)
    splitAdmins(db)
    assertNoForeignKeyViolations(db)
  })
  run()
  log.info('migration 044: instance integrity constraints created')
}

export const migration044InstanceIntegrity: Migration = {
  id: '044_instance_integrity',
  up,
}

export default migration044InstanceIntegrity
```

- [ ] **Step 4: Register migration 044**

In `src/db/index.ts`, add this import beside the other migration imports:

```typescript
import { migration044InstanceIntegrity } from './migrations/044_instance_integrity.js'
```

Append `migration044InstanceIntegrity` immediately after `migration043ScopedContextIds` in `MIGRATIONS`:

```typescript
  migration043ScopedContextIds,
  migration044InstanceIntegrity,
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `bun test tests/db/migrations/044_instance_integrity.test.ts tests/db/migration-registration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add src/db/migrations/044_instance_integrity.ts src/db/index.ts tests/db/migrations/044_instance_integrity.test.ts tests/db/migration-registration.test.ts
git commit -m "feat(db): enforce instance referential integrity"
```

## Task 3: Update Drizzle Schemas and Admin Store

**Files:**

- Modify: `src/db/instance-schema.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/instances/admin-store.ts`
- Test: `tests/instances/admin-store.test.ts`

- [ ] **Step 1: Write failing admin-store tests for split storage**

In `tests/instances/admin-store.test.ts`, import `getDrizzleDb`, `platformInstances`, `superAdmins`, and `platformAdmins`:

```typescript
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { platformAdmins, platformInstances, superAdmins } from '../../src/db/schema.js'
```

Add this helper near the top of the file:

```typescript
const seedPlatform = (id: string): void => {
  getDrizzleDb()
    .insert(platformInstances)
    .values({ id, type: id.startsWith('mm') ? 'mattermost' : 'telegram', config: '{}', status: 'active' })
    .onConflictDoNothing()
    .run()
}
```

At the start of each test that calls `addAdmin()` with a non-`__super__` platform, seed the platform ID first. For example:

```typescript
seedPlatform('tg-default')
addAdmin('platform-user', 'tg-default')
```

Add these tests before `listAdmins returns all admin rows`:

```typescript
test('stores super-admin and platform-admin rows in separate tables', () => {
  seedPlatform('tg-default')

  addAdmin('root', SUPER_ADMIN_PLATFORM_ID)
  addAdmin('platform-user', 'tg-default')

  expect(
    getDrizzleDb()
      .select()
      .from(superAdmins)
      .all()
      .map((row) => row.userId),
  ).toEqual(['root'])
  expect(
    getDrizzleDb()
      .select()
      .from(platformAdmins)
      .all()
      .map((row) => row.userId),
  ).toEqual(['platform-user'])
})

test('addAdmin rejects missing platform admin targets', () => {
  expect(() => addAdmin('platform-user', 'missing-platform')).toThrow()
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test tests/instances/admin-store.test.ts`

Expected: FAIL because `superAdmins` and `platformAdmins` schema exports do not exist and `admin-store.ts` still uses `admins`.

- [ ] **Step 3: Update instance Drizzle schema**

In `src/db/instance-schema.ts`, update imports:

```typescript
import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
```

Replace `contextSettings` and `admins` with:

```typescript
export const contextSettings = sqliteTable(
  'context_settings',
  {
    contextId: text('context_id').primaryKey(),
    taskInstanceId: text('task_instance_id')
      .notNull()
      .references(() => taskInstances.id, { onDelete: 'cascade' }),
    platformInstanceId: text('platform_instance_id')
      .notNull()
      .references(() => platformInstances.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_context_settings_task_instance').on(table.taskInstanceId),
    index('idx_context_settings_platform_instance').on(table.platformInstanceId),
  ],
)

export const superAdmins = sqliteTable('super_admins', {
  userId: text('user_id').primaryKey(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const platformAdmins = sqliteTable(
  'platform_admins',
  {
    userId: text('user_id').notNull(),
    platformInstanceId: text('platform_instance_id')
      .notNull()
      .references(() => platformInstances.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.platformInstanceId] })],
)
```

Replace the admin row type export with:

```typescript
export type SuperAdminRow = typeof superAdmins.$inferSelect
export type PlatformAdminRow = typeof platformAdmins.$inferSelect
```

- [ ] **Step 4: Update root schema exports and users FK**

In `src/db/schema.ts`, add this import at the top:

```typescript
import { platformInstances } from './instance-schema.js'
```

Change `users.platformInstanceId` to:

```typescript
    platformInstanceId: text('platform_instance_id')
      .notNull()
      .references(() => platformInstances.id, { onDelete: 'cascade' }),
```

Change the instance schema re-export at the bottom to:

```typescript
export { contextSettings, platformAdmins, platformInstances, superAdmins, taskInstances } from './instance-schema.js'
```

- [ ] **Step 5: Update admin store implementation**

In `src/instances/admin-store.ts`, replace the schema import with:

```typescript
import { platformAdmins, superAdmins } from '../db/schema.js'
```

Replace `rowToRecord()` with two explicit mappers:

```typescript
const superRowToRecord = (row: typeof superAdmins.$inferSelect): AdminRecord => ({
  userId: row.userId,
  platformInstanceId: SUPER_ADMIN_PLATFORM_ID,
  createdAt: row.createdAt,
})

const platformRowToRecord = (row: typeof platformAdmins.$inferSelect): AdminRecord => ({
  userId: row.userId,
  platformInstanceId: row.platformInstanceId,
  createdAt: row.createdAt,
})
```

Replace `addAdmin()` with:

```typescript
export const addAdmin = (userId: string, platformInstanceId: string): void => {
  if (platformInstanceId === SUPER_ADMIN_PLATFORM_ID) {
    getDrizzleDb().insert(superAdmins).values({ userId }).onConflictDoNothing({ target: superAdmins.userId }).run()
  } else {
    getDrizzleDb()
      .insert(platformAdmins)
      .values({ userId, platformInstanceId })
      .onConflictDoNothing({ target: [platformAdmins.userId, platformAdmins.platformInstanceId] })
      .run()
  }
  log.info({ userId, platformInstanceId }, 'admin added')
}
```

Replace `removeAdmin()`, `deleteAdminsByPlatformInstance()`, admin checks, and list functions with:

```typescript
export const removeAdmin = (userId: string, platformInstanceId: string): void => {
  if (platformInstanceId === SUPER_ADMIN_PLATFORM_ID) {
    getDrizzleDb().delete(superAdmins).where(eq(superAdmins.userId, userId)).run()
  } else {
    getDrizzleDb()
      .delete(platformAdmins)
      .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.platformInstanceId, platformInstanceId)))
      .run()
  }
  log.info({ userId, platformInstanceId }, 'admin removed')
}

export const deleteAdminsByPlatformInstance = (platformInstanceId: string): number => {
  if (platformInstanceId === SUPER_ADMIN_PLATFORM_ID) {
    log.warn({ platformInstanceId }, 'refusing to delete super-admin rows as platform cleanup')
    return 0
  }
  const deletedRows = getDrizzleDb()
    .delete(platformAdmins)
    .where(eq(platformAdmins.platformInstanceId, platformInstanceId))
    .returning({ userId: platformAdmins.userId })
    .all()
  log.info({ platformInstanceId, deletedCount: deletedRows.length }, 'admins removed for platform instance')
  return deletedRows.length
}

export const isSuperAdmin = (userId: string): boolean =>
  getDrizzleDb()
    .select({ userId: superAdmins.userId })
    .from(superAdmins)
    .where(eq(superAdmins.userId, userId))
    .get() !== undefined

export const isPlatformAdmin = (userId: string, platformInstanceId: string): boolean =>
  getDrizzleDb()
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.platformInstanceId, platformInstanceId)))
    .get() !== undefined

export const isAdmin = (userId: string, platformInstanceId: string): boolean =>
  isSuperAdmin(userId) || isPlatformAdmin(userId, platformInstanceId)

export const listAdmins = (): AdminRecord[] => {
  const superRows = getDrizzleDb()
    .select()
    .from(superAdmins)
    .all()
    .map((row) => superRowToRecord(row))
  const platformRows = getDrizzleDb()
    .select()
    .from(platformAdmins)
    .all()
    .map((row) => platformRowToRecord(row))
  return [...superRows, ...platformRows]
}

export const listAdminsForPlatform = (platformInstanceId: string): AdminRecord[] => {
  const rows = getDrizzleDb()
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.platformInstanceId, platformInstanceId))
    .all()
  return rows.map((row) => platformRowToRecord(row))
}
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run: `bun test tests/instances/admin-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit this task**

Run:

```bash
git add src/db/instance-schema.ts src/db/schema.ts src/instances/admin-store.ts tests/instances/admin-store.test.ts
git commit -m "refactor(instances): split admin storage by scope"
```

## Task 4: Align Instance Routes With Cascades

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

In `tests/debug/instance-routes.test.ts`, update every test that calls `setContextSettings()` so the referenced `platform_instances` and `task_instances` rows exist before the context row is inserted. For example, the platform delete test should seed both parents:

```typescript
test('deleting platform instance cascades admins and contexts while preserving cache cleanup', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
  insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
  setCachedTools('ctx-1', { old_tool: {} })
  addAdmin('platform-admin', 'telegram-main')
  addAdmin('super-admin', SUPER_ADMIN_PLATFORM_ID)

  const res = expectResponse(
    await route('/api/platform-instances/telegram-main', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  )

  expect(res.status).toBe(204)
  expect(listContextsByPlatformInstance('telegram-main')).toEqual([])
  expect(listAdmins().map((admin) => `${admin.platformInstanceId}:${admin.userId}`)).toEqual(['__super__:super-admin'])
  expect(userCachesForTesting.get('ctx-1')?.tools).toBeNull()
})

test('POST admin rejects missing concrete platform', async () => {
  const res = expectResponse(
    await route('/api/admins', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ userId: 'u1', platformInstanceId: 'missing-platform' }),
    }),
  )

  expect(res.status).toBe(404)
  expect(await readJson(res)).toEqual({ error: 'platform_instance_not_found', id: 'missing-platform' })
})
```

Keep the existing runtime-router apply test unchanged except for any parent rows needed by new constraints. In the task delete and task patch tests, add `insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })` before `setContextSettings()` when the context references `telegram-main`.

- [ ] **Step 2: Run the focused route test and verify it fails**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: FAIL because the route still manually deletes platform admins and contexts, and missing platform-admin targets either throw through the store or become 500.

- [ ] **Step 3: Update route imports**

In `src/debug/instance-routes.ts`, replace the context-store import with:

```typescript
import { listContextsByPlatformInstance, listContextsByTaskInstance } from '../instances/context-store.js'
```

- [ ] **Step 4: Update platform delete behavior**

Replace the platform delete block with:

```typescript
if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'platform-instances') {
  if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
  const instanceId = parts[2]
  if (instanceId === undefined) return textResponse('Not found', 404)
  const contextIds = listContextsByPlatformInstance(instanceId).map((context) => context.contextId)
  deletePlatformInstance(instanceId)
  clearToolCachesForContexts(contextIds)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 5: Update task delete behavior**

Replace the task delete block with:

```typescript
if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'task-instances') {
  if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
  const taskInstanceId = parts[2]
  if (taskInstanceId === undefined) return textResponse('Not found', 404)
  const contextIds = listContextsByTaskInstance(taskInstanceId).map((context) => context.contextId)
  deleteTaskInstance(taskInstanceId)
  clearToolCachesForContexts(contextIds)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 6: Reject missing platform admin targets before insert**

In the `/api/admins` POST block, insert this check before `adminStore.addAdmin()`:

```typescript
if (platformInstanceId !== adminStore.SUPER_ADMIN_PLATFORM_ID && getPlatformInstance(platformInstanceId) === null) {
  return jsonResponse({ error: 'platform_instance_not_found', id: platformInstanceId }, { status: 404 })
}
```

- [ ] **Step 7: Run the focused route test and verify it passes**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit this task**

Run:

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix(admin): rely on instance cascades for deletes"
```

## Task 5: Make User Config the Workspace Source of Truth

**Files:**

- Modify: `src/cache-db.ts`
- Modify: `src/stats/global-mix.ts`
- Modify: `src/stats/per-table-subject.ts`
- Test: `tests/cache-db.test.ts`
- Test: `tests/stats/global-mix.test.ts`
- Test: `tests/stats/per-table-user-group.test.ts`

- [ ] **Step 1: Write failing workspace-source tests**

In `tests/cache-db.test.ts`, update the `syncWorkspaceToDb` test so it asserts `users.kaneo_workspace_id` stays `NULL` after workspace sync while `user_config` contains the value.

Use this assertion after the existing config assertion:

```typescript
const mirroredUser = getDrizzleDb()
  .select({ kaneoWorkspaceId: users.kaneoWorkspaceId })
  .from(users)
  .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, 'telegram-default')))
  .get()
expect(mirroredUser?.kaneoWorkspaceId).toBeNull()
```

In `tests/stats/global-mix.test.ts`, import `userConfig` from `src/db/schema.js` and replace workspace seeding through `users.kaneoWorkspaceId` with:

```typescript
getDrizzleDb()
  .insert(userConfig)
  .values([
    { userId: 'u1', key: 'kaneo_workspace_id', value: 'w1' },
    { userId: 'u2', key: 'kaneo_workspace_id', value: 'w2' },
    { userId: 'u4', key: 'kaneo_workspace_id', value: '' },
  ])
  .run()
```

In `tests/stats/per-table-user-group.test.ts`, import `userConfig`, remove `kaneoWorkspaceId: 'ws-1'` from the `users` insert, and add:

```typescript
getDrizzleDb().insert(userConfig).values({ userId: 'u1', key: 'kaneo_workspace_id', value: 'ws-1' }).run()
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `bun test tests/cache-db.test.ts tests/stats/global-mix.test.ts tests/stats/per-table-user-group.test.ts`

Expected: FAIL because runtime and stats still read or write `users.kaneo_workspace_id`.

- [ ] **Step 3: Stop workspace mirror writes**

In `src/cache-db.ts`, replace `syncWorkspaceToDb()` with:

```typescript
export function syncWorkspaceToDb(userId: string, workspaceId: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(userConfig)
        .values({ userId, key: KANEO_WORKSPACE_CONFIG_KEY, value: workspaceId })
        .onConflictDoUpdate({
          target: [userConfig.userId, userConfig.key],
          set: { value: workspaceId },
        })
        .run()
      log.debug({ userId }, 'Workspace synced to config')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync workspace to DB',
      )
    }
  })
}
```

Remove `users` from the `src/cache-db.ts` schema import if it is no longer used.

- [ ] **Step 4: Update global stats workspace count**

In `src/stats/global-mix.ts`, add `userConfig` to the schema import and replace the Kaneo workspace query with:

```typescript
const kaneoRow = getDrizzleDb()
  .select({ c: sql<number>`count(*)`.as('c') })
  .from(userConfig)
  .where(sql`${userConfig.key} = 'kaneo_workspace_id' and ${userConfig.value} != ''`)
  .all()
```

Remove `users` from the import if it is no longer used in the file.

- [ ] **Step 5: Update per-subject stats workspace presence**

In `src/stats/per-table-subject.ts`, add `userConfig` to the schema import.

Replace `userBlockForSubject()` with:

```typescript
export function userBlockForSubject(storageContextId: string): UserBlockStats | null {
  const row = getDrizzleDb()
    .select({ addedAt: users.addedAt, addedBy: users.addedBy })
    .from(users)
    .where(eq(users.platformUserId, storageContextId))
    .all()

  const r = row[0]
  if (r === undefined) return null

  const workspace = getDrizzleDb()
    .select({ value: userConfig.value })
    .from(userConfig)
    .where(and(eq(userConfig.userId, storageContextId), eq(userConfig.key, 'kaneo_workspace_id')))
    .get()

  return {
    addedAt: r.addedAt,
    addedByPresent: r.addedBy.length > 0,
    kaneoWorkspacePresent: workspace !== undefined && workspace.value !== '',
  }
}
```

Also add `and` to the `drizzle-orm` import:

```typescript
import { and, eq } from 'drizzle-orm'
```

- [ ] **Step 6: Run focused tests and verify they pass**

Run: `bun test tests/cache-db.test.ts tests/stats/global-mix.test.ts tests/stats/per-table-user-group.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit this task**

Run:

```bash
git add src/cache-db.ts src/stats/global-mix.ts src/stats/per-table-subject.ts tests/cache-db.test.ts tests/stats/global-mix.test.ts tests/stats/per-table-user-group.test.ts
git commit -m "fix(stats): read workspace presence from user config"
```

## Task 6: Full Verification

**Files:**

- All files touched by Tasks 1-5.

- [ ] **Step 1: Run focused migration/store/stats tests**

Run:

```bash
bun test tests/db/migrations/043_scoped_context_ids.test.ts tests/db/migrations/044_instance_integrity.test.ts tests/db/migration-registration.test.ts tests/instances/admin-store.test.ts tests/debug/instance-routes.test.ts tests/cache-db.test.ts tests/stats/global-mix.test.ts tests/stats/per-table-user-group.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript checks**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run strict lint on touched implementation files**

Run:

```bash
bun lint:agent-strict -- src/db/migrations/043_scoped_context_ids.ts src/db/migrations/scoped-context-owned-columns.ts src/db/migrations/044_instance_integrity.ts src/db/index.ts src/db/instance-schema.ts src/db/schema.ts src/instances/admin-store.ts src/debug/instance-routes.ts src/cache-db.ts src/stats/global-mix.ts src/stats/per-table-subject.ts
```

Expected: PASS.

- [ ] **Step 4: Run formatting check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 5: Commit final verification fixes if any**

If verification required edits, run:

```bash
git add src/db/migrations/043_scoped_context_ids.ts src/db/migrations/scoped-context-owned-columns.ts src/db/migrations/044_instance_integrity.ts src/db/index.ts src/db/instance-schema.ts src/db/schema.ts src/instances/admin-store.ts src/debug/instance-routes.ts src/cache-db.ts src/stats/global-mix.ts src/stats/per-table-subject.ts tests/db/migrations/043_scoped_context_ids.test.ts tests/db/migrations/044_instance_integrity.test.ts tests/db/migration-registration.test.ts tests/instances/admin-store.test.ts tests/debug/instance-routes.test.ts tests/cache-db.test.ts tests/stats/global-mix.test.ts tests/stats/per-table-user-group.test.ts
git commit -m "fix: address phase 2 integrity verification"
```

If no edits were required, do not create an empty commit.
