// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:047' })

function createSettingsAuthCodesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings_auth_codes (
      code_hash TEXT PRIMARY KEY,
      platform_instance_id TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_settings_auth_codes_principal ON settings_auth_codes (platform_instance_id, platform_user_id)`,
  )
}

function createSettingsSessionsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings_sessions (
      session_id_hash TEXT PRIMARY KEY,
      platform_instance_id TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      csrf_token_hash TEXT NOT NULL
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_settings_sessions_principal ON settings_sessions (platform_instance_id, platform_user_id)`,
  )
}

function createSettingsRateLimitTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings_rate_limit (
      bucket TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (bucket, actor_id, window_start)
    )
  `)
}

const up = (db: Database): void => {
  createSettingsAuthCodesTable(db)
  createSettingsSessionsTable(db)
  createSettingsRateLimitTable(db)
  log.info('migration 047: settings auth tables created')
}

export const migration047SettingsAuth: Migration = {
  id: '047_settings_auth',
  up,
}

export default migration047SettingsAuth
