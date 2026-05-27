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

  test('cleans orphan rows when parent instance ids contain null', () => {
    db.run(`INSERT INTO platform_instances (id, type, config, status) VALUES (NULL, 'telegram', '{}', 'active')`)
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('tg-default', 'telegram', '{}', 'active')`,
    )
    db.run(`INSERT INTO task_instances (id, type, config, status) VALUES (NULL, 'kaneo', '{}', 'active')`)
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
    db.run(`INSERT INTO admins (user_id, platform_instance_id) VALUES ('platform-admin', 'tg-default')`)
    db.run(`INSERT INTO admins (user_id, platform_instance_id) VALUES ('orphan-admin', 'missing-platform')`)

    migration044InstanceIntegrity.up(db)

    expect(getRows<{ context_id: string }>(db, `SELECT context_id FROM context_settings`)).toEqual([
      { context_id: 'ctx-valid' },
    ])
    expect(getRows<{ platform_user_id: string }>(db, `SELECT platform_user_id FROM users`)).toEqual([
      { platform_user_id: 'u1' },
    ])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM platform_admins`)).toEqual([
      { user_id: 'platform-admin' },
    ])
    expect(getRows(db, `PRAGMA foreign_key_check`)).toEqual([])
  })

  test('archives zero-platform legacy sentinel users without bootstrapping platform instances', () => {
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_at, added_by, kaneo_workspace_id) VALUES ('u-legacy', '__unscoped_legacy__', 'alice', '2026-01-01T00:00:00Z', 'admin', 'workspace-1')`,
    )

    migration044InstanceIntegrity.up(db)

    expect(getRows<{ count: number }>(db, `SELECT COUNT(*) AS count FROM platform_instances`)).toEqual([{ count: 0 }])
    expect(getRows(db, `SELECT * FROM users`)).toEqual([])
    expect(
      getRows<{
        platform_user_id: string
        platform_instance_id: string
        username: string | null
        added_at: string
        added_by: string
        kaneo_workspace_id: string | null
      }>(
        db,
        `SELECT platform_user_id, platform_instance_id, username, added_at, added_by, kaneo_workspace_id FROM legacy_unscoped_users`,
      ),
    ).toEqual([
      {
        platform_user_id: 'u-legacy',
        platform_instance_id: '__unscoped_legacy__',
        username: 'alice',
        added_at: '2026-01-01T00:00:00Z',
        added_by: 'admin',
        kaneo_workspace_id: 'workspace-1',
      },
    ])
    expect(getRows(db, `PRAGMA foreign_key_check`)).toEqual([])
  })

  test('archives legacy sentinel users when multiple platform instances already exist', () => {
    db.run(`INSERT INTO platform_instances (id, type, config, status) VALUES ('tg-main', 'telegram', '{}', 'active')`)
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('discord-main', 'discord', '{}', 'active')`,
    )
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_at, added_by, kaneo_workspace_id) VALUES ('u-legacy', '__unscoped_legacy__', 'alice', '2026-01-01T00:00:00Z', 'admin', 'workspace-1')`,
    )

    migration044InstanceIntegrity.up(db)

    expect(getRows<{ id: string }>(db, `SELECT id FROM platform_instances ORDER BY id`)).toEqual([
      { id: 'discord-main' },
      { id: 'tg-main' },
    ])
    expect(getRows(db, `SELECT * FROM users`)).toEqual([])
    expect(
      getRows<{
        platform_user_id: string
        platform_instance_id: string
        username: string | null
        added_at: string
        added_by: string
        kaneo_workspace_id: string | null
      }>(
        db,
        `SELECT platform_user_id, platform_instance_id, username, added_at, added_by, kaneo_workspace_id FROM legacy_unscoped_users`,
      ),
    ).toEqual([
      {
        platform_user_id: 'u-legacy',
        platform_instance_id: '__unscoped_legacy__',
        username: 'alice',
        added_at: '2026-01-01T00:00:00Z',
        added_by: 'admin',
        kaneo_workspace_id: 'workspace-1',
      },
    ])
    expect(getRows(db, `PRAGMA foreign_key_check`)).toEqual([])
  })

  test('creates super admin user id as not null primary key', () => {
    migration044InstanceIntegrity.up(db)

    const userIdColumns = getRows<{ name: string; notnull: number; pk: number }>(db, `PRAGMA table_info(super_admins)`)
      .filter((column) => column.name === 'user_id')
      .map(({ name, notnull, pk }) => ({ name, notnull, pk }))

    expect(userIdColumns).toEqual([{ name: 'user_id', notnull: 1, pk: 1 }])
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
