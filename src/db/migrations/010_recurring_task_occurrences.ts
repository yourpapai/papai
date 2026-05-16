// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration010RecurringTaskOccurrences: Migration = {
  id: '010_recurring_task_occurrences',
  up(db: Database): void {
    db.run(`
      CREATE TABLE recurring_task_occurrences (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
    db.run('CREATE INDEX idx_recurring_occurrences_template ON recurring_task_occurrences(template_id)')
    db.run('CREATE INDEX idx_recurring_occurrences_task ON recurring_task_occurrences(task_id)')
  },
}
