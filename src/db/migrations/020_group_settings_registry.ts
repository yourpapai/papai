// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

function createKnownGroupContextsTable(db: Database): void {
  db.run(`
    CREATE TABLE known_group_contexts (
      context_id    TEXT PRIMARY KEY,
      provider      TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      parent_name   TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX idx_known_group_contexts_provider ON known_group_contexts(provider)`)
  db.run(`CREATE INDEX idx_known_group_contexts_last_seen ON known_group_contexts(last_seen_at)`)
}

function createGroupAdminObservationsTable(db: Database): void {
  db.run(`
    CREATE TABLE group_admin_observations (
      context_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      username     TEXT,
      is_admin     INTEGER NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (context_id, user_id)
    )
  `)
  db.run(`CREATE INDEX idx_group_admin_observations_user_admin ON group_admin_observations(user_id, is_admin)`)
}

export const migration020GroupSettingsRegistry: Migration = {
  id: '020_group_settings_registry',
  up(db: Database): void {
    createKnownGroupContextsTable(db)
    createGroupAdminObservationsTable(db)
  },
}
