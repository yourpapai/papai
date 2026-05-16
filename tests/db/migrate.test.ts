// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { runMigrations, type Migration } from '../../src/db/migrate.js'
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

const makeDb = (): Database => new Database(':memory:')

beforeEach(() => {
  mockLogger()
})

describe('runMigrations - basic behavior', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  test('applies pending migrations in order', () => {
    const executionOrder: string[] = []

    const migrations: readonly Migration[] = [
      {
        id: '001_first',
        up: (database: Database) => {
          executionOrder.push('001_first')
          database.run('CREATE TABLE IF NOT EXISTS test_table_1 (id INTEGER PRIMARY KEY)')
        },
      },
      {
        id: '002_second',
        up: (database: Database) => {
          executionOrder.push('002_second')
          database.run('CREATE TABLE IF NOT EXISTS test_table_2 (id INTEGER PRIMARY KEY)')
        },
      },
    ]

    runMigrations(db, migrations)

    expect(executionOrder).toEqual(['001_first', '002_second'])

    const tableNames = getTableNames(db)
      .filter((name) => name.startsWith('test_table_'))
      .sort()
    expect(tableNames).toEqual(['test_table_1', 'test_table_2'])

    expect(getMigrationIds(db)).toEqual(['001_first', '002_second'])
  })

  test('handles empty migration list', () => {
    expect(() => {
      runMigrations(db, [])
    }).not.toThrow()

    expect(getTableNames(db)).toContain('migrations')
    expect(getMigrationIds(db)).toHaveLength(0)
  })
})

describe('runMigrations - skips already-applied', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  test('skips already-applied migrations', () => {
    let firstCallCount = 0
    let secondCallCount = 0

    const migrations: readonly Migration[] = [
      {
        id: '001_first',
        up: () => {
          firstCallCount++
        },
      },
      {
        id: '002_second',
        up: () => {
          secondCallCount++
        },
      },
    ]

    db.run('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    db.run("INSERT INTO migrations (id, applied_at) VALUES ('001_first', ?)", [new Date().toISOString()])

    runMigrations(db, migrations)

    expect(firstCallCount).toBe(0)
    expect(secondCallCount).toBe(1)

    const migrationIds = getMigrationIds(db)
    expect(migrationIds).toContain('001_first')
    expect(migrationIds).toContain('002_second')
    expect(migrationIds).toHaveLength(2)
  })
})

describe('runMigrations - idempotency', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  test('is idempotent - second call applies nothing', () => {
    let callCount = 0

    const migrations: readonly Migration[] = [
      {
        id: '001_once',
        up: () => {
          callCount++
        },
      },
    ]

    runMigrations(db, migrations)
    expect(callCount).toBe(1)

    runMigrations(db, migrations)
    expect(callCount).toBe(1)

    expect(getMigrationIds(db)).toHaveLength(1)
  })
})

describe('runMigrations - rollback', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  test('rolls back on failure and rethrows', () => {
    let sideEffectVisible = false

    const migrations: readonly Migration[] = [
      {
        id: '001_will_fail',
        up: (database: Database) => {
          database.run('CREATE TABLE IF NOT EXISTS temp_table (id INTEGER PRIMARY KEY)')
          sideEffectVisible = true
          throw new Error('Migration failed intentionally')
        },
      },
    ]

    expect(() => {
      runMigrations(db, migrations)
    }).toThrow('Migration failed intentionally')

    expect(sideEffectVisible).toBe(true)

    const tableNames = getTableNames(db)
    expect(tableNames).not.toContain('temp_table')

    const migrationIds = getMigrationIds(db)
    expect(migrationIds).not.toContain('001_will_fail')
  })
})

describe('runMigrations - order validation', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  test('throws for single migration with no numeric prefix', () => {
    const migrations: readonly Migration[] = [{ id: 'initial', up: () => {} }]
    expect(() => {
      runMigrations(db, migrations)
    }).toThrow('Migration ID must start with a numeric prefix: initial')
  })

  test('throws when migrations are out of order', () => {
    const migrations: readonly Migration[] = [
      { id: '002_second', up: () => {} },
      { id: '001_first', up: () => {} },
    ]
    expect(() => {
      runMigrations(db, migrations)
    }).toThrow('Migration 001_first is out of order')
  })

  test('throws when migrations have duplicate IDs', () => {
    const migrations: readonly Migration[] = [
      { id: '001_first', up: () => {} },
      { id: '001_first', up: () => {} },
    ]
    expect(() => {
      runMigrations(db, migrations)
    }).toThrow('Migration 001_first has duplicate full ID')
  })

  test('throws when migrations have different numeric prefixes with same suffix', () => {
    const migrations: readonly Migration[] = [
      { id: '001_foo', up: () => {} },
      { id: '002_foo', up: () => {} },
    ]
    expect(() => {
      runMigrations(db, migrations)
    }).toThrow('Migration 002_foo has duplicate base name: foo')
  })
})
