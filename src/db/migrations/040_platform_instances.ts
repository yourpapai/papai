// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:040' })

function createPlatformInstancesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_instances (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      config     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createTaskInstancesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS task_instances (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      config     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createContextSettingsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS context_settings (
      context_id           TEXT PRIMARY KEY,
      task_instance_id     TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_context_settings_task_instance ON context_settings (task_instance_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_context_settings_platform_instance ON context_settings (platform_instance_id)`)
}

function createAdminsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      user_id              TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, platform_instance_id)
    )
  `)
}

function addPlatformInstanceIdToUsers(db: Database): void {
  const cols = db
    .query<{ name: string }, []>(`PRAGMA table_info(users)`)
    .all()
    .map((r) => r.name)
  if (cols.includes('platform_instance_id')) return
  db.run(`ALTER TABLE users ADD COLUMN platform_instance_id TEXT`)
}

const up = (db: Database): void => {
  createPlatformInstancesTable(db)
  createTaskInstancesTable(db)
  createContextSettingsTable(db)
  createAdminsTable(db)
  addPlatformInstanceIdToUsers(db)
  log.info('migration 040: instance tables and users.platform_instance_id created')
}

export const migration040PlatformInstances: Migration = {
  id: '040_platform_instances',
  up,
}

export default migration040PlatformInstances
