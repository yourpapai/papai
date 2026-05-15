// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'
import { mockLogger } from '../utils/test-helpers.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

const getMigrationIds = (db: Database): string[] =>
  db
    .query<{ id: string }, []>('SELECT id FROM migrations ORDER BY rowid')
    .all()
    .map((row) => row.id)

describe('db index migration registration', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('registers the authorized groups migration in the production list', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')

    try {
      runMigrations(db, MIGRATIONS)

      expect(getTableNames(db)).toContain('authorized_groups')
      expect(getMigrationIds(db)).toContain('024_authorized_groups')
    } finally {
      db.close()
    }
  })
})
