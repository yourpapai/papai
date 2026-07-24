// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration070MemoryRecordInjection } from '../../../src/db/migrations/070_memory_record_injection.js'
import { memoryProfiles } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

const migrationsThrough069 = (): readonly (typeof MIGRATIONS)[number][] => {
  const injectionIndex = MIGRATIONS.findIndex((m) => m.id === '070_memory_record_injection')
  if (injectionIndex <= 0) throw new Error('070_memory_record_injection not found after a prior migration')
  return MIGRATIONS.slice(0, injectionIndex)
}

describe('migration 070 memory record injection', () => {
  test('migration id is 070_memory_record_injection', () => {
    expect(migration070MemoryRecordInjection.id).toBe('070_memory_record_injection')
  })

  test('adds the inject_records column to memory_profiles', async () => {
    await setupTestDb()

    const cols = getDrizzleDb().$client.query<{ name: string }, []>('PRAGMA table_info(memory_profiles)').all()
    expect(cols.map((c) => c.name)).toContain('inject_records')
  })

  test('defaults inject_records to false for a freshly inserted profile', async () => {
    await setupTestDb()

    const db = getDrizzleDb()
    db.insert(memoryProfiles)
      .values({
        scopeId: 'user-1',
        scopeType: 'personal',
        profile: 'hello',
        updatedAt: '2026-07-24T00:00:00.000Z',
      })
      .run()

    const row = getDrizzleDb()
      .$client.query<{ inject_records: number }, []>(
        "SELECT inject_records FROM memory_profiles WHERE scope_id = 'user-1'",
      )
      .get()
    expect(row?.inject_records).toBe(0)
  })

  test('applies on a pre-070 database and defaults pre-existing profiles to inject_records off', () => {
    // Reproduce a real upgrade: migrate a fresh DB only through 069 (the state before this
    // feature shipped), write a profile the way pre-070 code would, then apply the full set.
    const db = new Database(':memory:')
    runMigrations(db, migrationsThrough069())

    const cols = db
      .query<{ name: string }, []>('PRAGMA table_info(memory_profiles)')
      .all()
      .map((c) => c.name)
    expect(cols).not.toContain('inject_records')

    db.run(
      'INSERT INTO memory_profiles (scope_id, scope_type, profile, enabled, version, updated_at) VALUES (?, ?, ?, 1, 1, ?)',
      ['user-legacy', 'personal', 'legacy profile', '2026-07-24T00:00:00.000Z'],
    )

    // 070 is now the only pending migration; runMigrations skips the already-applied ones.
    runMigrations(db, MIGRATIONS)

    const upgradedCols = db
      .query<{ name: string }, []>('PRAGMA table_info(memory_profiles)')
      .all()
      .map((c) => c.name)
    expect(upgradedCols).toContain('inject_records')

    const row = db
      .query<{ inject_records: number; profile: string }, [string]>(
        'SELECT inject_records, profile FROM memory_profiles WHERE scope_id = ?',
      )
      .get('user-legacy')
    expect(row?.profile).toBe('legacy profile')
    expect(row?.inject_records).toBe(0)
  })
})
