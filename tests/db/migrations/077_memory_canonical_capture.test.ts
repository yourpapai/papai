// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration077MemoryCanonicalCapture } from '../../../src/db/migrations/077_memory_canonical_capture.js'
import { setupTestDb } from '../../utils/test-helpers.js'

const migrationsThrough076 = (): readonly (typeof MIGRATIONS)[number][] => {
  const canonicalIndex = MIGRATIONS.findIndex((m) => m.id === '077_memory_canonical_capture')
  if (canonicalIndex <= 0) throw new Error('077_memory_canonical_capture not found after a prior migration')
  return MIGRATIONS.slice(0, canonicalIndex)
}

const TABLES = [
  'memory_canonical_events',
  'memory_projection_outbox',
  'memory_canonical_capture_attempts',
  'memory_canonical_state',
]

describe('migration 077 memory canonical capture', () => {
  test('migration id is 077_memory_canonical_capture', () => {
    expect(migration077MemoryCanonicalCapture.id).toBe('077_memory_canonical_capture')
  })

  test('creates all four canonical capture tables', async () => {
    await setupTestDb()

    const tables = getDrizzleDb()
      .$client.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name)

    for (const table of TABLES) {
      expect(tables).toContain(table)
    }
  })

  test('applies on a pre-077 database and records exactly one cutover marker', () => {
    // Reproduce a real upgrade: migrate a fresh DB only through 076 (the state before this
    // feature shipped), then apply the full set.
    const db = new Database(':memory:')
    runMigrations(db, migrationsThrough076())

    const tablesBefore = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name)
    expect(tablesBefore).not.toContain('memory_canonical_state')

    runMigrations(db, MIGRATIONS)

    const tablesAfter = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name)
    expect(tablesAfter).toContain('memory_canonical_state')

    const markers = db.query<{ id: string; cutover_at: string }, []>('SELECT * FROM memory_canonical_state').all()
    expect(markers).toHaveLength(1)
    expect(markers[0]?.id).toBe('singleton')
  })

  test('running the migration twice does not duplicate the cutover marker', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    migration077MemoryCanonicalCapture.up(db)

    const markers = db.query<{ id: string }, []>('SELECT * FROM memory_canonical_state').all()
    expect(markers).toHaveLength(1)
  })
})
