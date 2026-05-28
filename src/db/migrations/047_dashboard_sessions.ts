// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createClaimsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS dashboard_claims (
      nonce_hash TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )
  `)
}

const createSessionsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS dashboard_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_seen_at INTEGER,
      last_seen_ip TEXT,
      user_agent TEXT
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_admin ON dashboard_sessions (admin_user_id)`)
}

export const migration047DashboardSessions: Migration = {
  id: '047_dashboard_sessions',
  up(db) {
    createClaimsTable(db)
    createSessionsTable(db)
  },
}
