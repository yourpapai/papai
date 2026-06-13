// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { migration055UserConfigKeyIndex } from '../../../src/db/migrations/055_user_config_key_index.js'

describe('migration 055_user_config_key_index', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run(`
      CREATE TABLE user_config (
        user_id TEXT NOT NULL,
        key     TEXT NOT NULL,
        value   TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `)
    db.run(`CREATE INDEX idx_user_config_user_id ON user_config(user_id)`)
  })

  test('has correct id', () => {
    expect(migration055UserConfigKeyIndex.id).toBe('055_user_config_key_index')
  })

  test('up creates idx_user_config_key on user_config(key)', () => {
    migration055UserConfigKeyIndex.up(db)

    const indexes = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='user_config'`)
      .all()
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_user_config_key')
  })

  test('up is idempotent', () => {
    migration055UserConfigKeyIndex.up(db)
    expect(() => migration055UserConfigKeyIndex.up(db)).not.toThrow()
  })
})
