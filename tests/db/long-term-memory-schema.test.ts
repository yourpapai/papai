// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryExtractionState, memoryRecords } from '../../src/db/long-term-memory-schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('long-term-memory-schema', () => {
  test('memoryRecords accepts provisional status and threadContextId', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryRecords)
      .values({
        id: 'rec-1',
        scopeId: 'user-1',
        scopeType: 'personal',
        kind: 'fact',
        content: 'test fact',
        tags: '[]',
        confidence: 0.8,
        status: 'provisional',
        source: 'background',
        evidence: '{}',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-01T00:00:00Z',
        threadContextId: 'thread-abc',
      })
      .run()

    const row = getDrizzleDb().select().from(memoryRecords).get()
    expect(row?.status).toBe('provisional')
    expect(row?.threadContextId).toBe('thread-abc')
  })

  test('memoryExtractionState inserts and reads correctly', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryExtractionState)
      .values({
        contextId: 'ctx-1',
        contextType: 'dm',
        configContextId: 'cfg-ctx-1',
        lastActivityAt: '2026-01-01T00:00:00Z',
        lastExtractedAt: null,
        lastHistoryLen: 0,
      })
      .run()

    const row = getDrizzleDb().select().from(memoryExtractionState).get()
    expect(row).toMatchObject({
      contextId: 'ctx-1',
      contextType: 'dm',
      configContextId: 'cfg-ctx-1',
      lastActivityAt: '2026-01-01T00:00:00Z',
      lastExtractedAt: null,
      lastHistoryLen: 0,
    })
  })
})
