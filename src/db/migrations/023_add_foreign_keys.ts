// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const cleanupOrphans = (db: Database): void => {
  db.run('DELETE FROM recurring_tasks WHERE user_id NOT IN (SELECT platform_user_id FROM users)')
  db.run('DELETE FROM recurring_task_occurrences WHERE template_id NOT IN (SELECT id FROM recurring_tasks)')
}

const recreateRecurringTasks = (db: Database): void => {
  db.run(`
    CREATE TABLE recurring_tasks_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  db.run(
    'INSERT INTO recurring_tasks_new (id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, cron_expression, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at) SELECT id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, cron_expression, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at FROM recurring_tasks',
  )
  db.run('DROP TABLE recurring_tasks')
  db.run('ALTER TABLE recurring_tasks_new RENAME TO recurring_tasks')
  db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
}

const recreateRecurringTaskOccurrences = (db: Database): void => {
  db.run(`
    CREATE TABLE recurring_task_occurrences_new (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  db.run(
    'INSERT INTO recurring_task_occurrences_new (id, template_id, task_id, created_at) SELECT id, template_id, task_id, created_at FROM recurring_task_occurrences',
  )
  db.run('DROP TABLE recurring_task_occurrences')
  db.run('ALTER TABLE recurring_task_occurrences_new RENAME TO recurring_task_occurrences')
  db.run('CREATE INDEX idx_recurring_occurrences_template ON recurring_task_occurrences(template_id)')
  db.run('CREATE INDEX idx_recurring_occurrences_task ON recurring_task_occurrences(task_id)')
}

const assertNoForeignKeyViolations = (db: Database): void => {
  const violations = db
    .query<{ table: string; rowid: number | null; parent: string; fkid: number }, []>('PRAGMA foreign_key_check')
    .all()

  if (violations.length > 0) {
    throw new Error(`Foreign key violations found after migration: ${JSON.stringify(violations)}`)
  }
}

export const migration023AddForeignKeys: Migration = {
  id: '023_add_foreign_keys',
  up(db: Database): void {
    cleanupOrphans(db)
    recreateRecurringTasks(db)
    recreateRecurringTaskOccurrences(db)
    assertNoForeignKeyViolations(db)
  },
}
