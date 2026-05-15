// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration009RecurringTasks: Migration = {
  id: '009_recurring_tasks',
  up(db: Database): void {
    db.run(`
      CREATE TABLE recurring_tasks (
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
    db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
    db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
  },
}
