// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { applyModuleMigrations } from '../../src/db/index.js'
import type { Migration } from '../../src/db/migrate.js'

describe('applyModuleMigrations', () => {
  test('applies a module migration to the given db and records it in the bookkeeping table', () => {
    const db = new Database(':memory:')
    const migration: Migration = {
      id: '9001_fake_module_table',
      up: (d) => {
        d.run('CREATE TABLE fake_module (id TEXT)')
      },
    }
    applyModuleMigrations([migration], db)
    const table = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='fake_module'").all()
    expect(table.length).toBe(1)
    const recorded = db.query("SELECT id FROM migrations WHERE id = '9001_fake_module_table'").all()
    expect(recorded.length).toBe(1)
  })

  test('is idempotent — a second call skips the already-applied migration', () => {
    const db = new Database(':memory:')
    const migration: Migration = {
      id: '9001_fake',
      up: (d) => {
        d.run('CREATE TABLE fake (id TEXT)')
      },
    }
    applyModuleMigrations([migration], db)
    // Would throw ("table fake already exists") if the migration ran twice.
    applyModuleMigrations([migration], db)
    expect(db.query("SELECT id FROM migrations WHERE id = '9001_fake'").all().length).toBe(1)
  })
})
