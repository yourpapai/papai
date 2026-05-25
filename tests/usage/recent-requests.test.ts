// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { listRecentRequests } from '../../src/usage/recent-requests.js'
import { setupTestDb } from '../utils/test-helpers.js'

const insertEvent = (overrides: Partial<typeof llmUsageEvents.$inferInsert> = {}): void => {
  const base = {
    eventId: `evt_${Math.random().toString(16).slice(2)}`,
    occurredAt: Date.now(),
    turnId: 'turn_abc',
    storageContextId: 'user:1',
    contextType: 'dm',
    chatUserId: 'u1',
    model: 'gpt-4o-mini',
    modelRole: 'main',
    inputTokens: 100,
    outputTokens: 50,
    stepCount: 1,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: 'stop',
    durationMs: 600,
    responseId: null,
    error: null,
  }
  getDrizzleDb()
    .insert(llmUsageEvents)
    .values({ ...base, ...overrides })
    .run()
}

describe('listRecentRequests', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns rows for the given storage context, newest first', () => {
    insertEvent({ eventId: 'e1', storageContextId: 'user:1', occurredAt: 1000 })
    insertEvent({ eventId: 'e2', storageContextId: 'user:1', occurredAt: 3000 })
    insertEvent({ eventId: 'e3', storageContextId: 'user:1', occurredAt: 2000 })
    insertEvent({ eventId: 'e4', storageContextId: 'user:2', occurredAt: 4000 })

    const rows = listRecentRequests('user:1', 10)

    expect(rows.map((r) => r.ts)).toEqual([3000, 2000, 1000])
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['ts', 'modelLabel', 'role', 'inputTokens', 'outputTokens', 'finishStatus'].sort(),
      )
    }
  })

  test('honors the limit', () => {
    for (let i = 0; i < 5; i += 1) {
      insertEvent({ eventId: `e${i}`, storageContextId: 'user:1', occurredAt: i * 1000 })
    }
    expect(listRecentRequests('user:1', 3)).toHaveLength(3)
  })

  test('clamps limit to a safe range', () => {
    expect(listRecentRequests('user:1', 0)).toHaveLength(0)
    insertEvent({ eventId: 'e1', storageContextId: 'user:1', occurredAt: 1000 })
    const huge = listRecentRequests('user:1', 1_000_000)
    expect(huge).toHaveLength(1)
  })

  test('maps finishReason to finishStatus and normalizes nulls', () => {
    insertEvent({
      eventId: 'e1',
      storageContextId: 'user:1',
      finishReason: 'stop',
      occurredAt: 1000,
    })
    insertEvent({
      eventId: 'e2',
      storageContextId: 'user:1',
      finishReason: null,
      occurredAt: 2000,
    })
    const rows = listRecentRequests('user:1', 10)
    expect(rows[0]?.finishStatus).toBe('unknown')
    expect(rows[1]?.finishStatus).toBe('stop')
  })
})
