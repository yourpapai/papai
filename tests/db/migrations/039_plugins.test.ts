// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import migration039Plugins from '../../../src/db/migrations/039_plugins.js'

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

describe('migration039Plugins', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('uses the next migration id after central LLM billing migrations', () => {
    expect(migration039Plugins.id).toBe('039_plugins')
  })

  test('creates plugin state and runtime tables', () => {
    migration039Plugins.up(db)

    expect(getTableNames(db)).toEqual(expect.arrayContaining(['plugin_admin_state', 'plugin_context_state', 'plugin_kv', 'plugin_runtime_events']))
  })

  test('creates lookup indexes for plugin context and runtime queries', () => {
    migration039Plugins.up(db)

    expect(getIndexNames(db)).toEqual(
      expect.arrayContaining([
        'idx_plugin_context_state_context',
        'idx_plugin_kv_plugin_context',
        'idx_plugin_kv_context',
        'idx_plugin_runtime_events_plugin',
        'idx_plugin_runtime_events_occurred',
      ]),
    )
  })
})
