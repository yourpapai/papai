// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration078MemoryProjectionRecords } from '../../../src/db/migrations/078_memory_projection_records.js'
import { setupTestDb } from '../../utils/test-helpers.js'

describe('migration 078 memory projection records', () => {
  test('migration id is 078_memory_projection_records', () => {
    expect(migration078MemoryProjectionRecords.id).toBe('078_memory_projection_records')
  })

  test('creates the memory_projection_records table', async () => {
    await setupTestDb()

    const tables = getDrizzleDb()
      .$client.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name)

    expect(tables).toContain('memory_projection_records')
  })
})
