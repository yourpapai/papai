// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration073MemoryTombstones } from '../../../src/db/migrations/073_memory_tombstones.js'
import { memoryTombstones } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

describe('migration 073 memory tombstones', () => {
  test('migration id is 073_memory_tombstones', () => {
    expect(migration073MemoryTombstones.id).toBe('073_memory_tombstones')
  })

  test('creates the memory_tombstones table with the expected columns', async () => {
    await setupTestDb()

    const cols = getDrizzleDb().$client.query<{ name: string }, []>('PRAGMA table_info(memory_tombstones)').all()
    expect(cols.map((c) => c.name).sort()).toEqual(['content_hash', 'forgotten_at', 'scope_id', 'scope_type'])
  })

  test('round-trips a tombstone row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryTombstones)
      .values({
        scopeId: 'user-1',
        scopeType: 'personal',
        contentHash: 'hash-1',
        forgottenAt: '2026-07-24T00:00:00.000Z',
      })
      .run()

    const row = getDrizzleDb().select().from(memoryTombstones).where(eq(memoryTombstones.contentHash, 'hash-1')).get()
    expect(row?.scopeId).toBe('user-1')
    expect(row?.scopeType).toBe('personal')
    expect(row?.forgottenAt).toBe('2026-07-24T00:00:00.000Z')
  })

  test('rejects a duplicate (scopeType, scopeId, contentHash) primary key', async () => {
    await setupTestDb()

    const db = getDrizzleDb()
    db.insert(memoryTombstones)
      .values({
        scopeId: 'user-1',
        scopeType: 'personal',
        contentHash: 'hash-2',
        forgottenAt: '2026-07-24T00:00:00.000Z',
      })
      .run()

    expect(() =>
      db
        .insert(memoryTombstones)
        .values({
          scopeId: 'user-1',
          scopeType: 'personal',
          contentHash: 'hash-2',
          forgottenAt: '2026-07-24T01:00:00.000Z',
        })
        .run(),
    ).toThrow()
  })

  test('rejects an invalid scope_type via CHECK constraint', async () => {
    await setupTestDb()

    const db = getDrizzleDb()
    // Drizzle's typed insert restricts scopeType to the 'personal' | 'group' enum, so an
    // invalid value is inserted via raw SQL to exercise the DB-level CHECK constraint itself.
    const insertRaw = (scopeType: string, contentHash: string): void => {
      db.$client
        .query('INSERT INTO memory_tombstones (scope_id, scope_type, content_hash, forgotten_at) VALUES (?, ?, ?, ?)')
        .run('user-1', scopeType, contentHash, '2026-07-24T00:00:00.000Z')
    }

    expect(() => insertRaw('bogus', 'hash-3')).toThrow()

    expect(() => insertRaw('personal', 'hash-valid-personal')).not.toThrow()
    expect(() => insertRaw('group', 'hash-valid-group')).not.toThrow()
  })
})
