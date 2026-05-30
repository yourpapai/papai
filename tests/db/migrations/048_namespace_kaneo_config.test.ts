// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration048NamespaceKaneoConfig } from '../../../src/db/migrations/048_namespace_kaneo_config.js'
import { mockLogger } from '../../utils/test-helpers.js'

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

describe('migration048NamespaceKaneoConfig', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('exports the expected migration id', () => {
    expect(migration048NamespaceKaneoConfig.id).toBe('048_namespace_kaneo_config')
  })

  test('renames kaneo_apikey to plugin-namespaced credential key', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'kaneo_apikey', value: 'k1' })

    migration048NamespaceKaneoConfig.up(db)

    const rows = selectAll(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      user_id: 'u1',
      key: 'plugin:task-provider-kaneo:provider:credential',
      value: 'k1',
    })
  })

  test('renames kaneo_workspace_id to plugin-namespaced workspaceId key', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'kaneo_workspace_id', value: 'ws1' })

    migration048NamespaceKaneoConfig.up(db)

    const rows = selectAll(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      user_id: 'u1',
      key: 'plugin:task-provider-kaneo:provider:workspaceId',
      value: 'ws1',
    })
  })

  test('preserves value when renaming kaneo_apikey', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'kaneo_apikey', value: 'my-secret-api-key' })

    migration048NamespaceKaneoConfig.up(db)

    const rows = selectAll(db)
    expect(rows[0]?.value).toBe('my-secret-api-key')
  })

  test('leaves non-kaneo rows untouched', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'kaneo_apikey', value: 'k1' })
    insertRow(db, { user_id: 'u1', key: 'kaneo_workspace_id', value: 'ws1' })
    insertRow(db, { user_id: 'u1', key: 'youtrack_token', value: 'perm:yt-1' })
    insertRow(db, { user_id: 'u2', key: 'timezone', value: 'UTC' })

    migration048NamespaceKaneoConfig.up(db)

    const rows = selectAll(db)
    const keys = rows.map((r) => r.key)
    expect(keys).toContain('plugin:task-provider-kaneo:provider:credential')
    expect(keys).toContain('plugin:task-provider-kaneo:provider:workspaceId')
    expect(keys).toContain('youtrack_token')
    expect(keys).toContain('timezone')
    expect(keys).not.toContain('kaneo_apikey')
    expect(keys).not.toContain('kaneo_workspace_id')
  })

  test('is idempotent: running twice does not cause a PK conflict or data loss', () => {
    createUserConfigTable(db)
    insertRow(db, { user_id: 'u1', key: 'kaneo_apikey', value: 'k1' })
    insertRow(db, { user_id: 'u1', key: 'kaneo_workspace_id', value: 'ws1' })

    migration048NamespaceKaneoConfig.up(db)
    expect(() => migration048NamespaceKaneoConfig.up(db)).not.toThrow()

    const rows = selectAll(db)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.key)).toEqual([
      'plugin:task-provider-kaneo:provider:credential',
      'plugin:task-provider-kaneo:provider:workspaceId',
    ])
  })

  test('is idempotent when target namespaced rows already exist (no-op, no PK conflict)', () => {
    createUserConfigTable(db)
    // Pre-existing namespaced rows (already migrated)
    insertRow(db, { user_id: 'u1', key: 'plugin:task-provider-kaneo:provider:credential', value: 'k1' })
    insertRow(db, { user_id: 'u1', key: 'plugin:task-provider-kaneo:provider:workspaceId', value: 'ws1' })

    expect(() => migration048NamespaceKaneoConfig.up(db)).not.toThrow()

    const rows = selectAll(db)
    expect(rows).toHaveLength(2)
  })
})
