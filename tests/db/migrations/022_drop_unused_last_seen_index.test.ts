// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration020GroupSettingsRegistry } from '../../../src/db/migrations/020_group_settings_registry.js'
import { migration022DropUnusedLastSeenIndex } from '../../../src/db/migrations/022_drop_unused_last_seen_index.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getIndexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((row) => row.name)

describe('migration022DropUnusedLastSeenIndex', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration020GroupSettingsRegistry.up(db)
  })

  afterEach(() => {
    db.close()
  })

  test('drops idx_known_group_contexts_last_seen', () => {
    expect(getIndexNames(db)).toContain('idx_known_group_contexts_last_seen')

    migration022DropUnusedLastSeenIndex.up(db)

    expect(getIndexNames(db)).not.toContain('idx_known_group_contexts_last_seen')
  })

  test('preserves idx_known_group_contexts_provider', () => {
    migration022DropUnusedLastSeenIndex.up(db)

    expect(getIndexNames(db)).toContain('idx_known_group_contexts_provider')
  })

  test('is idempotent when index is already absent', () => {
    db.run('DROP INDEX IF EXISTS idx_known_group_contexts_last_seen')

    expect(() => migration022DropUnusedLastSeenIndex.up(db)).not.toThrow()
  })
})
