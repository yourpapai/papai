// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:039' })

function createPluginAdminStateTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_admin_state (
      plugin_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'discovered',
      approved_by TEXT,
      approved_manifest_hash TEXT,
      last_seen_manifest_hash TEXT,
      compatibility_reason TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createPluginContextStateTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_context_state (
      plugin_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, context_id)
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_plugin_context_state_context ON plugin_context_state (context_id)`)
}

function createPluginKvTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_kv (
      plugin_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, context_id, key)
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_plugin_kv_plugin_context ON plugin_kv (plugin_id, context_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_plugin_kv_context ON plugin_kv (context_id)`)
}

function createPluginRuntimeEventsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_runtime_events (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_plugin_runtime_events_plugin ON plugin_runtime_events (plugin_id)`)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_plugin_runtime_events_occurred ON plugin_runtime_events (plugin_id, occurred_at)`,
  )
}

const up = (db: Database): void => {
  createPluginAdminStateTable(db)
  createPluginContextStateTable(db)
  createPluginKvTable(db)
  createPluginRuntimeEventsTable(db)
  log.info('migration 039: plugin tables created')
}

export const migration039Plugins: Migration = {
  id: '039_plugins',
  up,
}

export default migration039Plugins
