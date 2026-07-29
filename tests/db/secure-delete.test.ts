// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb, resetDrizzleDbForTesting } from '../../src/db/drizzle.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('drizzle connection pragmas', () => {
  const originalDbPath = process.env['DB_PATH']

  beforeEach(() => {
    resetDrizzleDbForTesting()
    process.env['DB_PATH'] = ':memory:'
  })

  afterEach(() => {
    resetDrizzleDbForTesting()
    if (originalDbPath === undefined) delete process.env['DB_PATH']
    else process.env['DB_PATH'] = originalDbPath
  })

  test('secure_delete is enabled on the connection', () => {
    const db = getDrizzleDb()
    const row = db.$client.query<{ secure_delete: number }, []>('PRAGMA secure_delete').get()
    expect(row?.secure_delete).toBe(1)
  })
})

describe('memory_tombstones migration', () => {
  test('table exists after migrations', async () => {
    await setupTestDb()
    const cols = getDrizzleDb().$client.query<{ name: string }, []>('PRAGMA table_info(memory_tombstones)').all()
    expect(cols.map((c) => c.name).sort()).toEqual(['content_hash', 'forgotten_at', 'scope_id', 'scope_type'])
  })
})
