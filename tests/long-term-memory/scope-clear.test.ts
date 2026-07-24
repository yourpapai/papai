// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { conversationHistory, memoryTombstones } from '../../src/db/schema.js'
import { clearMemoryScope } from '../../src/long-term-memory/scope-clear.js'
import { saveMemoryProfile, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'preference',
  content: 'User prefers concise implementation plans.',
  summary: 'Concise plans',
  tags: ['style'],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

describe('scope-clear', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('wipes records, profile, and tombstones for the scope, and leaves other scopes untouched', () => {
    const db = getDrizzleDb()
    saveMemoryProfile({ scopeId: 'user-1', scopeType: 'personal' }, 'profile', '2026-06-11T00:00:00.000Z')
    saveMemoryRecord(memoryRecordInput({ id: 'mem-1', scopeId: 'user-1', scopeType: 'personal' }))
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'old forgotten', '2026-07-24T00:00:00.000Z')
    db.insert(conversationHistory).values({ userId: 'other-user', messages: '[]' }).run()

    const counts = clearMemoryScope({ scopeId: 'user-1', scopeType: 'personal' })

    expect(counts).toEqual({
      profileDeleted: 1,
      recordsDeleted: 1,
      workingMemoryKeysCleared: 0,
      extractionStateDeleted: 0,
      tombstonesDeleted: 1,
    })
    expect(db.select().from(memoryTombstones).all().length).toBe(0)
    expect(
      db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'other-user')).get(),
    ).toBeDefined()
  })
})
