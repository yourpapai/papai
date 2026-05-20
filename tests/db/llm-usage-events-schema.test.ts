// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents, type LlmUsageEventRow } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('llmUsageEvents Drizzle table', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('inserts and selects a fully populated row', () => {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId: 'evt-1',
        occurredAt: 1_700_000_000_000,
        turnId: 'turn-1',
        storageContextId: 'ctx-1',
        contextType: 'dm',
        chatUserId: 'user-1',
        model: 'main-model',
        modelRole: 'main',
        inputTokens: 100,
        outputTokens: 200,
        stepCount: 1,
        toolCallCount: 0,
        messageCount: 3,
        finishReason: 'stop',
        durationMs: 1234,
        responseId: 'resp-1',
        error: null,
      })
      .run()

    const rows: LlmUsageEventRow[] = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      eventId: 'evt-1',
      occurredAt: 1_700_000_000_000,
      turnId: 'turn-1',
      storageContextId: 'ctx-1',
      contextType: 'dm',
      chatUserId: 'user-1',
      model: 'main-model',
      modelRole: 'main',
      inputTokens: 100,
      outputTokens: 200,
      stepCount: 1,
      toolCallCount: 0,
      messageCount: 3,
      finishReason: 'stop',
      durationMs: 1234,
      responseId: 'resp-1',
      error: null,
      forwardedAt: null,
      forwardAttempts: 0,
      forwardError: null,
    })
  })

  test('round-trips NULLs in optional columns', () => {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId: 'evt-nulls',
        occurredAt: 1_700_000_000_000,
        turnId: null,
        storageContextId: 'ctx',
        contextType: 'group',
        chatUserId: 'user',
        model: 'm',
        modelRole: 'embedding',
        inputTokens: null,
        outputTokens: null,
        stepCount: 0,
        toolCallCount: 0,
        messageCount: 0,
        finishReason: null,
        durationMs: 5,
        responseId: null,
        error: null,
      })
      .run()

    const rows: LlmUsageEventRow[] = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.turnId).toBeNull()
    expect(row?.inputTokens).toBeNull()
    expect(row?.outputTokens).toBeNull()
    expect(row?.finishReason).toBeNull()
    expect(row?.responseId).toBeNull()
    expect(row?.error).toBeNull()
  })

  test('records an error row with the error column populated', () => {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId: 'evt-err',
        occurredAt: 1_700_000_000_000,
        turnId: 'turn-err',
        storageContextId: 'ctx',
        contextType: 'dm',
        chatUserId: 'user',
        model: 'main-model',
        modelRole: 'main',
        inputTokens: null,
        outputTokens: null,
        stepCount: 0,
        toolCallCount: 0,
        messageCount: 2,
        finishReason: null,
        durationMs: 42,
        responseId: null,
        error: 'network error',
      })
      .run()

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.error).toBe('network error')
  })
})
