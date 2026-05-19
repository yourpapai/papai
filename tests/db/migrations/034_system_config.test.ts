// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration034SystemConfig } from '../../../src/db/migrations/034_system_config.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

interface SystemConfigRow {
  key: string
  value: string
  updated_at: number
  updated_by: string
}

describe('migration034SystemConfig', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates the system_config table', () => {
    migration034SystemConfig.up(db)

    expect(getNames(db, 'table')).toContain('system_config')
  })

  test('rows have key as primary key, value and audit columns NOT NULL', () => {
    migration034SystemConfig.up(db)

    db.run('INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'llm_apikey',
      'sk-abc',
      1_700_000_000_000,
      'env',
    ])

    const rows = db.query<SystemConfigRow, []>('SELECT key, value, updated_at, updated_by FROM system_config').all()
    expect(rows).toEqual([{ key: 'llm_apikey', value: 'sk-abc', updated_at: 1_700_000_000_000, updated_by: 'env' }])
  })

  test('duplicate key inserts fail because key is the primary key', () => {
    migration034SystemConfig.up(db)

    db.run('INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'llm_apikey',
      'sk-one',
      1_700_000_000_000,
      'env',
    ])

    expect(() =>
      db.run('INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
        'llm_apikey',
        'sk-two',
        1_700_000_000_001,
        'admin-123',
      ]),
    ).toThrow()
  })

  test('inserting NULL into value, updated_at, or updated_by fails', () => {
    migration034SystemConfig.up(db)

    expect(() =>
      db.run('INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
        'llm_apikey',
        null,
        1_700_000_000_000,
        'env',
      ]),
    ).toThrow()

    expect(() =>
      db.run('INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
        'llm_apikey',
        'sk-abc',
        null,
        'env',
      ]),
    ).toThrow()

    expect(() =>
      db.run('INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
        'llm_apikey',
        'sk-abc',
        1_700_000_000_000,
        null,
      ]),
    ).toThrow()
  })

  test('running the migration twice is idempotent', () => {
    migration034SystemConfig.up(db)
    expect(() => {
      migration034SystemConfig.up(db)
    }).not.toThrow()
    expect(getNames(db, 'table')).toContain('system_config')
  })
})
