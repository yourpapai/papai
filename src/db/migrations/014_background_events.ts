// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration014BackgroundEvents: Migration = {
  id: '014_background_events',
  up(db: Database): void {
    db.run(`
      CREATE TABLE background_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        injected_at TEXT
      )
    `)
    db.run('CREATE INDEX idx_background_events_user_injected ON background_events(user_id, injected_at)')
  },
}
