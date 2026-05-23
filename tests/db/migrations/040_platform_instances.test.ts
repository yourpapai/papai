// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import migration040PlatformInstances from '../../../src/db/migrations/040_platform_instances.js'

interface SqliteMasterRow {
  name: string
}

interface PragmaColumnRow {
  name: string
  type: string
  notnull: number
  pk: number
}

const getTableNames = (db: Database): string[] =>
  db
    .query<SqliteMasterRow, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<SqliteMasterRow, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name)

const getColumnNames = (db: Database, table: string): string[] =>
  db
    .query<PragmaColumnRow, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

const createUsersTable = (db: Database): void => {
  db.run(`
    CREATE TABLE users (
      platform_user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by TEXT NOT NULL,
      kaneo_workspace_id TEXT
    )
  `)
}

describe('migration040PlatformInstances', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    createUsersTable(db)
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 040_platform_instances', () => {
    expect(migration040PlatformInstances.id).toBe('040_platform_instances')
  })

  test('creates the four instance tables', () => {
    migration040PlatformInstances.up(db)
    const names = getTableNames(db)
    expect(names).toContain('platform_instances')
    expect(names).toContain('task_instances')
    expect(names).toContain('context_settings')
    expect(names).toContain('admins')
  })

  test('creates indexes for scheduler/poller scans on context_settings', () => {
    migration040PlatformInstances.up(db)
    const indexes = getIndexNames(db)
    expect(indexes).toContain('idx_context_settings_task_instance')
    expect(indexes).toContain('idx_context_settings_platform_instance')
  })

  test('adds nullable platform_instance_id column to users', () => {
    migration040PlatformInstances.up(db)
    const cols = getColumnNames(db, 'users')
    expect(cols).toContain('platform_instance_id')
    const def = db
      .query<PragmaColumnRow, []>(`PRAGMA table_info(users)`)
      .all()
      .find((c) => c.name === 'platform_instance_id')
    expect(def?.notnull).toBe(0)
  })

  test('admins table has composite primary key (user_id, platform_instance_id)', () => {
    migration040PlatformInstances.up(db)
    const pkCols = db
      .query<PragmaColumnRow, []>(`PRAGMA table_info(admins)`)
      .all()
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(pkCols).toEqual(['user_id', 'platform_instance_id'])
  })

  test('platform_instances row insert with all columns works', () => {
    migration040PlatformInstances.up(db)
    db.run(`INSERT INTO platform_instances (id, type, config, status) VALUES (?, ?, ?, ?)`, [
      'telegram-default',
      'telegram',
      'encrypted-blob',
      'active',
    ])
    const row = db
      .query<{ id: string; type: string; status: string }, []>(`SELECT id, type, status FROM platform_instances`)
      .get()
    expect(row).toEqual({ id: 'telegram-default', type: 'telegram', status: 'active' })
  })

  test('is idempotent against re-application via CREATE TABLE IF NOT EXISTS', () => {
    migration040PlatformInstances.up(db)
    expect(() => {
      migration040PlatformInstances.up(db)
    }).not.toThrow()
  })
})
