// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration012UserInstructions: Migration = {
  id: '012_user_instructions',
  up(db: Database): void {
    db.run(`
      CREATE TABLE user_instructions (
        id TEXT PRIMARY KEY,
        context_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
    db.run('CREATE INDEX idx_user_instructions_context ON user_instructions(context_id)')
  },
}
