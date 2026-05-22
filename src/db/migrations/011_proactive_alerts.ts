// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration011ProactiveAlerts: Migration = {
  id: '011_proactive_alerts',
  up(db: Database): void {
    db.run(`
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        text TEXT NOT NULL,
        task_id TEXT,
        fire_at TEXT NOT NULL,
        recurrence TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
    db.run('CREATE INDEX idx_reminders_user ON reminders(user_id)')
    db.run('CREATE INDEX idx_reminders_status_fire ON reminders(status, fire_at)')

    db.run(`
      CREATE TABLE user_briefing_state (
        user_id TEXT PRIMARY KEY,
        last_briefing_date TEXT,
        last_briefing_at TEXT
      )
    `)

    db.run(`
      CREATE TABLE alert_state (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        last_seen_status TEXT,
        last_status_changed_at TEXT,
        last_alert_type TEXT,
        last_alert_sent_at TEXT,
        suppress_until TEXT,
        overdue_days_notified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
    db.run('CREATE INDEX idx_alert_state_user ON alert_state(user_id)')
    db.run('CREATE INDEX idx_alert_state_user_task ON alert_state(user_id, task_id)')
  },
}
