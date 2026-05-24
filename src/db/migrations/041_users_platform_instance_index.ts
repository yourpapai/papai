// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const UNSCOPED_LEGACY_PLATFORM_INSTANCE_ID = '__unscoped_legacy__'

const getSingleActivePlatformInstanceId = (db: Database): string | null => {
  const rows = db.query<{ id: string }, []>(`SELECT id FROM platform_instances WHERE status = 'active' ORDER BY id`).all()
  if (rows.length !== 1) return null
  const row = rows[0]
  if (row === undefined) return null
  return row.id
}

const createUsersNewTable = (db: Database): void => {
  db.run(`
    CREATE TABLE users_new (
      platform_user_id     TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      username             TEXT,
      added_at             TEXT NOT NULL DEFAULT (datetime('now')),
      added_by             TEXT NOT NULL,
      kaneo_workspace_id   TEXT,
      PRIMARY KEY (platform_instance_id, platform_user_id)
    )
  `)
}

const copyUsers = (db: Database, legacyPlatformInstanceId: string): void => {
  db.run(
    `
      INSERT INTO users_new (
        platform_user_id,
        platform_instance_id,
        username,
        added_at,
        added_by,
        kaneo_workspace_id
      )
      SELECT
        platform_user_id,
        COALESCE(platform_instance_id, ?),
        username,
        added_at,
        added_by,
        kaneo_workspace_id
      FROM users
    `,
    [legacyPlatformInstanceId],
  )
}

const recreateUsersTable = (db: Database): void => {
  const singleActivePlatformInstanceId = getSingleActivePlatformInstanceId(db)
  // Ambiguous unscoped legacy users are preserved under a sentinel that never
  // matches a real platform id, so authorization still requires explicit scope.
  const legacyPlatformInstanceId = singleActivePlatformInstanceId ?? UNSCOPED_LEGACY_PLATFORM_INSTANCE_ID
  createUsersNewTable(db)
  copyUsers(db, legacyPlatformInstanceId)
  db.run(`DROP TABLE users`)
  db.run(`ALTER TABLE users_new RENAME TO users`)
}

const createIndexes = (db: Database): void => {
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_user ON users (platform_instance_id, platform_user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_username ON users (platform_instance_id, username)`)
}

const tableExists = (db: Database, tableName: string): boolean => {
  const row = db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
  return row !== null
}

const recreateRecurringTaskOccurrences = (db: Database): void => {
  db.run(`
    CREATE TABLE recurring_task_occurrences_041 (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  db.run(`
    INSERT INTO recurring_task_occurrences_041 (id, template_id, task_id, created_at)
    SELECT id, template_id, task_id, created_at FROM recurring_task_occurrences
  `)
  db.run(`DROP TABLE recurring_task_occurrences`)
}

const restoreRecurringTaskOccurrences = (db: Database): void => {
  db.run(`ALTER TABLE recurring_task_occurrences_041 RENAME TO recurring_task_occurrences`)
  db.run(`CREATE INDEX idx_recurring_occurrences_template ON recurring_task_occurrences(template_id)`)
  db.run(`CREATE INDEX idx_recurring_occurrences_task ON recurring_task_occurrences(task_id)`)
}

const recreateRecurringTasksWithoutUserForeignKey = (db: Database): void => {
  if (!tableExists(db, 'recurring_tasks')) return
  recreateRecurringTaskOccurrences(db)
  db.run(`
    CREATE TABLE recurring_tasks_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      rrule TEXT,
      dtstart_utc TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  db.run(`
    INSERT INTO recurring_tasks_new
    (id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, rrule, dtstart_utc, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at)
    SELECT id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, rrule, dtstart_utc, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at
    FROM recurring_tasks
  `)
  db.run(`DROP TABLE recurring_tasks`)
  db.run(`ALTER TABLE recurring_tasks_new RENAME TO recurring_tasks`)
  db.run(`CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)`)
  db.run(`CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)`)
  restoreRecurringTaskOccurrences(db)
}

const up = (db: Database): void => {
  recreateRecurringTasksWithoutUserForeignKey(db)
  recreateUsersTable(db)
  createIndexes(db)
}

export const migration041UsersPlatformInstanceIndex: Migration = {
  id: '041_users_platform_instance_index',
  up,
}

export default migration041UsersPlatformInstanceIndex
