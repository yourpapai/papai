// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration070MemoryRecordInjection } from '../../../src/db/migrations/070_memory_record_injection.js'
import { memoryProfiles } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

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
})
