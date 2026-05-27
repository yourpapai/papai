// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:044' })
const SUPER_ADMIN_PLATFORM_ID = '__super__'
const LEGACY_UNSCOPED_PLATFORM_ID = '__unscoped_legacy__'

type ForeignKeyViolation = Readonly<{
  table: string
  rowid: number | null
  parent: string
  fkid: number
}>

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const runCountedDelete = (db: Database, sql: string, params: string[]): number => {
  db.run(sql, params)
  const row = db.query<{ count: number }, []>(`SELECT changes() AS count`).get()
  return row === null ? 0 : row.count
}

const archiveLegacyUnscopedUsers = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS legacy_unscoped_users (
      platform_user_id     TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      username             TEXT,
      added_at             TEXT NOT NULL,
      added_by             TEXT NOT NULL,
      kaneo_workspace_id   TEXT,
      PRIMARY KEY (platform_instance_id, platform_user_id)
    )
  `)

  db.run(
    `INSERT OR IGNORE INTO legacy_unscoped_users
     SELECT platform_user_id, platform_instance_id, username, added_at, added_by, kaneo_workspace_id
     FROM users
     WHERE platform_instance_id = ?`,
    [LEGACY_UNSCOPED_PLATFORM_ID],
  )
}

const cleanupOrphans = (db: Database): void => {
  const contextMissingTask = runCountedDelete(
    db,
    `DELETE FROM context_settings
     WHERE NOT EXISTS (SELECT 1 FROM task_instances WHERE task_instances.id = context_settings.task_instance_id)`,
    [],
  )
  const contextMissingPlatform = runCountedDelete(
    db,
    `DELETE FROM context_settings
     WHERE NOT EXISTS (SELECT 1 FROM platform_instances WHERE platform_instances.id = context_settings.platform_instance_id)`,
    [],
  )
  const usersMissingPlatform = runCountedDelete(
    db,
    `DELETE FROM users
     WHERE NOT EXISTS (SELECT 1 FROM platform_instances WHERE platform_instances.id = users.platform_instance_id)`,
    [],
  )
  const adminsMissingPlatform = tableExists(db, 'admins')
    ? runCountedDelete(
        db,
        `DELETE FROM admins
         WHERE platform_instance_id <> ?
           AND NOT EXISTS (SELECT 1 FROM platform_instances WHERE platform_instances.id = admins.platform_instance_id)`,
        [SUPER_ADMIN_PLATFORM_ID],
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
    `CREATE TABLE IF NOT EXISTS super_admins (user_id TEXT NOT NULL PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  )
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_admins (
      user_id              TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL REFERENCES platform_instances(id) ON DELETE CASCADE,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, platform_instance_id)
    )
  `)

  if (!tableExists(db, 'admins')) return

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

const assertNoForeignKeyViolations = (db: Database): void => {
  const violations = db.query<ForeignKeyViolation, []>(`PRAGMA foreign_key_check`).all()
  if (violations.length > 0) {
    throw new Error(`migration 044 foreign key violations: ${JSON.stringify(violations)}`)
  }
}

const up = (db: Database): void => {
  db.transaction(() => {
    archiveLegacyUnscopedUsers(db)
    cleanupOrphans(db)
    rebuildContextSettings(db)
    rebuildUsers(db)
    splitAdmins(db)
    assertNoForeignKeyViolations(db)
  })()

  log.info('migration 044: instance integrity constraints created')
}

export const migration044InstanceIntegrity: Migration = {
  id: '044_instance_integrity',
  up,
}
