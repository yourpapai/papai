// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration049NamespaceYoutrackConfig } from '../../../src/db/migrations/049_namespace_youtrack_config.js'
import { mockLogger } from '../../utils/test-helpers.js'

const YOUTRACK_TOKEN_KEY = 'plugin:task-provider-youtrack:provider:token' as const

interface UserConfigRow {
  user_id: string
  key: string
  value: string
}

const createUserConfigTable = (db: Database): void => {
  db.run(`
    CREATE TABLE user_config (
      user_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `)
}

const insertRow = (db: Database, row: UserConfigRow): void => {
  db.run('INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [row.user_id, row.key, row.value])
}

const selectAll = (db: Database): UserConfigRow[] =>
  db.query<UserConfigRow, []>('SELECT user_id, key, value FROM user_config ORDER BY user_id, key').all()

describe('migration049NamespaceYoutrackConfig', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('exports the expected migration id', () => {
    expect(migration049NamespaceYoutrackConfig.id).toBe('049_namespace_youtrack_config')
  })

  test('renames youtrack_token to plugin-namespaced token key', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'youtrack_token', value: 't1' })

    migration049NamespaceYoutrackConfig.up(db)

    const rows = selectAll(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      user_id: 'u1',
      key: YOUTRACK_TOKEN_KEY,
      value: 't1',
    })
  })

  test('preserves value when renaming youtrack_token', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'youtrack_token', value: 'perm:my-secret-token' })

    migration049NamespaceYoutrackConfig.up(db)

    const rows = selectAll(db)
    expect(rows[0]?.value).toBe('perm:my-secret-token')
  })

  test('leaves non-youtrack rows untouched', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'youtrack_token', value: 't1' })
    insertRow(db, { user_id: 'u1', key: 'timezone', value: 'UTC' })
    insertRow(db, { user_id: 'u2', key: 'kaneo_apikey', value: 'k2' })

    migration049NamespaceYoutrackConfig.up(db)

    const rows = selectAll(db)
    const keys = rows.map((r) => r.key)
    expect(keys).toContain(YOUTRACK_TOKEN_KEY)
    expect(keys).toContain('timezone')
    expect(keys).toContain('kaneo_apikey')
    expect(keys).not.toContain('youtrack_token')
  })

  test('is idempotent: running twice does not cause a PK conflict or data loss', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'youtrack_token', value: 't1' })

    migration049NamespaceYoutrackConfig.up(db)
    expect(() => migration049NamespaceYoutrackConfig.up(db)).not.toThrow()

    const rows = selectAll(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe(YOUTRACK_TOKEN_KEY)
  })

  test('is idempotent when target namespaced row already exists (no-op, no PK conflict)', () => {
    createUserConfigTable(db)
    // Pre-existing namespaced row (already migrated)
    insertRow(db, { user_id: 'u1', key: YOUTRACK_TOKEN_KEY, value: 't1' })

    expect(() => migration049NamespaceYoutrackConfig.up(db)).not.toThrow()

    const rows = selectAll(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe(YOUTRACK_TOKEN_KEY)
  })
})
