// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration008GroupMembers: Migration = {
  id: '008_group_members',
  up(db: Database): void {
    db.run(`
      CREATE TABLE group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        added_by TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now')) NOT NULL,
        PRIMARY KEY (group_id, user_id)
      )
    `)
    db.run('CREATE INDEX idx_group_members_group ON group_members(group_id)')
    db.run('CREATE INDEX idx_group_members_user ON group_members(user_id)')
  },
}
