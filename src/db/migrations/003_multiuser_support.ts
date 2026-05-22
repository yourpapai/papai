// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration003MultiuserSupport: Migration = {
  id: '003_multiuser_support',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS user_config (
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_config_user_id
      ON user_config(user_id)
    `)
  },
}
