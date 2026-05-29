// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import migration048SettingsAuth from '../../../src/db/migrations/048_settings_auth.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((row) => row.name)

describe('migration048SettingsAuth', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('has the expected migration id', () => {
    expect(migration048SettingsAuth.id).toBe('048_settings_auth')
  })

  test('creates settings auth tables', () => {
    migration048SettingsAuth.up(db)
    const tables = getTableNames(db)
    expect(tables).toContain('settings_auth_codes')
    expect(tables).toContain('settings_sessions')
    expect(tables).toContain('settings_rate_limit')
  })

  test('creates principal indexes', () => {
    migration048SettingsAuth.up(db)
    const indexes = getIndexNames(db)
    expect(indexes).toContain('idx_settings_auth_codes_principal')
    expect(indexes).toContain('idx_settings_sessions_principal')
  })

  test('is idempotent', () => {
    migration048SettingsAuth.up(db)
    expect(() => migration048SettingsAuth.up(db)).not.toThrow()
  })
})
