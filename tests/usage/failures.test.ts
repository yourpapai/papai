// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents, toolCallEvents } from '../../src/db/schema.js'
import { listRecentFailures } from '../../src/usage/failures.js'
import { setupTestDb } from '../utils/test-helpers.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const insertLlmEvent = (overrides: Partial<typeof llmUsageEvents.$inferInsert> = {}): void => {
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

const insertToolEvent = (overrides: Partial<typeof toolCallEvents.$inferInsert> = {}): void => {
  const base = {
    eventId: `tool_${Math.random().toString(16).slice(2)}`,
    turnId: 'turn_abc',
    occurredAt: Date.now(),
    storageContextId: 'user:1',
    contextType: 'dm',
    chatUserId: 'u1',
    model: 'gpt-4o-mini',
    modelRole: 'main',
    toolName: 'create_task',
    toolCallId: `call_${Math.random().toString(16).slice(2)}`,
    success: 0,
    durationMs: 250,
    errorType: 'ToolError',
    errorCode: 'E_TOOL',
    retryable: 1,
    recovered: 0,
  }
  getDrizzleDb()
    .insert(toolCallEvents)
    .values({ ...base, ...overrides })
    .run()
}

describe('listRecentFailures', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns only failed rows from both sources', () => {
    insertLlmEvent({ eventId: 'ok-llm', error: null, occurredAt: Date.now() - 4 * MINUTE })
    insertLlmEvent({ eventId: 'bad-llm', error: 'rate limited', occurredAt: Date.now() - 3 * MINUTE })
    insertToolEvent({ eventId: 'ok-tool', success: 1, occurredAt: Date.now() - 2 * MINUTE })
    insertToolEvent({ eventId: 'bad-tool', occurredAt: Date.now() - MINUTE })

    const rows = listRecentFailures()

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.kind).sort()).toEqual(['llm', 'tool'])
  })

  test('merges both sources newest-first', () => {
    insertToolEvent({ eventId: 't-old', occurredAt: 1000 })
    insertLlmEvent({ eventId: 'l-mid', error: 'boom', occurredAt: 2000 })
    insertToolEvent({ eventId: 't-new', occurredAt: 3000 })
    insertLlmEvent({ eventId: 'l-new', error: 'crash', occurredAt: 4000 })

    const rows = listRecentFailures({})

    expect(rows.map((row) => row.kind)).toEqual(['llm', 'tool', 'llm', 'tool'])
    expect(rows.map((row) => row.ts)).toEqual([4000, 3000, 2000, 1000])
  })

  test('applies the clamped limit after merging, newest failures first', () => {
    insertLlmEvent({ eventId: 'l-old', error: 'boom', occurredAt: 1000 })
    insertToolEvent({ eventId: 't-newest', occurredAt: 2000 })

    const rows = listRecentFailures({ limit: 1 })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('tool')
  })

  test('zero limit returns an empty result', () => {
    insertLlmEvent({ eventId: 'l1', error: 'boom', occurredAt: 1000 })
    insertToolEvent({ eventId: 't1', occurredAt: 2000 })

    expect(listRecentFailures({ limit: 0 })).toEqual([])
  })

  test('fractional limit floors to an integer', () => {
    for (let i = 0; i < 11; i += 1) {
      insertToolEvent({ eventId: `t${i}`, occurredAt: 1000 + i })
    }

    expect(listRecentFailures({ limit: 10.9 })).toHaveLength(10)
  })

  test('oversized limit clamps to 200', () => {
    for (let i = 0; i < 205; i += 1) {
      insertLlmEvent({ eventId: `l${i}`, error: 'boom', occurredAt: 1000 + i })
    }

    const rows = listRecentFailures({ limit: 500 })

    expect(rows).toHaveLength(200)
    expect(rows[0]?.ts).toBe(1204)
    expect(rows[199]?.ts).toBe(1005)
  })

  test('default limit is 25', () => {
    for (let i = 0; i < 40; i += 1) {
      insertToolEvent({ eventId: `t${i}`, occurredAt: 1000 + i })
    }

    const rows = listRecentFailures({})

    expect(rows).toHaveLength(25)
    expect(rows[0]?.ts).toBe(1039)
    expect(rows[24]?.ts).toBe(1015)
  })

  test('positive window keeps only rows at or after now - window', () => {
    const now = Date.now()
    insertLlmEvent({ eventId: 'recent', error: 'five minutes ago', occurredAt: now - 5 * MINUTE })
    insertToolEvent({ eventId: 'ancient', occurredAt: now - 3 * DAY })

    const rows = listRecentFailures({ windowMs: HOUR })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('llm')
  })

  test('null window covers all time', () => {
    const now = Date.now()
    insertLlmEvent({ eventId: 'recent', error: 'five minutes ago', occurredAt: now - 5 * MINUTE })
    insertToolEvent({ eventId: 'ancient', occurredAt: now - 3 * DAY })

    expect(listRecentFailures({ windowMs: null })).toHaveLength(2)
  })

  test('omitted window covers all time', () => {
    insertToolEvent({ eventId: 'ancient', occurredAt: 1000 })

    expect(listRecentFailures({})).toHaveLength(1)
  })

  test('maps llm failure rows with normalized nullable fields', () => {
    insertLlmEvent({
      eventId: 'l1',
      error: 'rate limited',
      finishReason: null,
      durationMs: 1200,
      occurredAt: 1000,
    })

    const rows = listRecentFailures({})

    expect(rows).toEqual([
      {
        kind: 'llm',
        ts: 1000,
        turnId: 'turn_abc',
        storageContextId: 'user:1',
        contextType: 'dm',
        chatUserId: 'u1',
        model: 'gpt-4o-mini',
        modelRole: 'main',
        durationMs: 1200,
        error: 'rate limited',
        finishReason: null,
      },
    ])
  })

  test('maps tool failure rows with normalized nullable fields', () => {
    insertToolEvent({
      eventId: 't1',
      toolName: 'create_task',
      errorType: 'TimeoutError',
      errorCode: null,
      retryable: 1,
      recovered: 0,
      durationMs: null,
      occurredAt: 1000,
    })

    const rows = listRecentFailures({})

    expect(rows).toEqual([
      {
        kind: 'tool',
        ts: 1000,
        turnId: 'turn_abc',
        storageContextId: 'user:1',
        contextType: 'dm',
        chatUserId: 'u1',
        model: 'gpt-4o-mini',
        modelRole: 'main',
        durationMs: null,
        toolName: 'create_task',
        errorType: 'TimeoutError',
        errorCode: null,
        retryable: true,
        recovered: false,
      },
    ])
  })

  test('normalizes every unrecorded nullable field to null', () => {
    insertToolEvent({
      eventId: 't1',
      errorType: null,
      errorCode: null,
      retryable: null,
      recovered: null,
      durationMs: null,
      occurredAt: 1000,
    })
    insertLlmEvent({ eventId: 'l1', error: 'boom', finishReason: null, occurredAt: 2000 })

    const rows = listRecentFailures({})

    expect(rows[0]).toMatchObject({
      kind: 'llm',
      finishReason: null,
    })
    expect(rows[1]).toMatchObject({
      kind: 'tool',
      errorType: null,
      errorCode: null,
      retryable: null,
      recovered: null,
      durationMs: null,
    })
  })
})
