// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration013DeferredPrompts: Migration = {
  id: '013_deferred_prompts',
  up(db: Database): void {
    db.run(`
      CREATE TABLE scheduled_prompts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        fire_at TEXT NOT NULL,
        cron_expression TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')) NOT NULL,
        last_executed_at TEXT
      )
    `)
    db.run('CREATE INDEX idx_scheduled_prompts_user ON scheduled_prompts(user_id)')
    db.run('CREATE INDEX idx_scheduled_prompts_status_fire ON scheduled_prompts(status, fire_at)')

    db.run(`
      CREATE TABLE alert_prompts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        condition TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')) NOT NULL,
        last_triggered_at TEXT,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60
      )
    `)
    db.run('CREATE INDEX idx_alert_prompts_user ON alert_prompts(user_id)')
    db.run('CREATE INDEX idx_alert_prompts_status ON alert_prompts(status)')

    db.run(`
      CREATE TABLE task_snapshots (
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        captured_at TEXT DEFAULT (datetime('now')) NOT NULL,
        PRIMARY KEY (user_id, task_id, field)
      )
    `)
    db.run('CREATE INDEX idx_task_snapshots_user ON task_snapshots(user_id)')

    // Drop old proactive tables
    db.run('DROP TABLE IF EXISTS reminders')
    db.run('DROP TABLE IF EXISTS user_briefing_state')
    db.run('DROP TABLE IF EXISTS alert_state')
  },
}
