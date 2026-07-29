// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration076MemoryProfileContaminatedAt } from '../../../src/db/migrations/076_memory_profile_contaminated_at.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null }

describe('migration 076: memory_profiles.contaminated_at', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('migration id is 076_memory_profile_contaminated_at', () => {
    expect(migration076MemoryProfileContaminatedAt.id).toBe('076_memory_profile_contaminated_at')
  })

  test('adds a nullable contaminated_at column with no default', () => {
    const columns = getDrizzleDb().$client.query<ColumnInfo, []>('PRAGMA table_info(memory_profiles)').all()
    const column = columns.find((c) => c.name === 'contaminated_at')
    expect(column).toBeDefined()
    expect(column?.type).toBe('TEXT')
    expect(column?.notnull).toBe(0)
    expect(column?.dflt_value).toBeNull()
  })

  test('existing profile rows read back as not contaminated', () => {
    getDrizzleDb().$client.run(
      `INSERT INTO memory_profiles (scope_id, scope_type, profile, updated_at)
       VALUES ('u-1', 'personal', 'prose', '2026-07-25T00:00:00.000Z')`,
    )
    const row = getDrizzleDb()
      .$client.query<{ contaminated_at: string | null }, []>(
        "SELECT contaminated_at FROM memory_profiles WHERE scope_id = 'u-1'",
      )
      .get()
    expect(row?.contaminated_at).toBeNull()
  })
})
