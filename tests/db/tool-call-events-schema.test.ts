// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents, toolCallEvents, type ToolCallEventRow } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('toolCallEvents Drizzle table', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('inserts and selects a fully populated row', () => {
    getDrizzleDb()
      .insert(toolCallEvents)
      .values({
        eventId: 'evt-1',
        turnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        storageContextId: 'ctx-1',
        contextType: 'dm',
        chatUserId: 'user-1',
        model: 'main-model',
        modelRole: 'main',
        toolName: 'create_task',
        toolCallId: 'call-1',
        success: 1,
        durationMs: 42,
        errorType: null,
        errorCode: null,
        retryable: null,
        recovered: null,
        argsBytes: 100,
        resultBytes: 200,
        responseId: 'resp-1',
        forwardedAt: null,
        forwardError: null,
      })
      .run()

    const rows: ToolCallEventRow[] = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      eventId: 'evt-1',
      turnId: 'turn-1',
      occurredAt: 1_700_000_000_000,
      storageContextId: 'ctx-1',
      contextType: 'dm',
      chatUserId: 'user-1',
      model: 'main-model',
      modelRole: 'main',
      toolName: 'create_task',
      toolCallId: 'call-1',
      success: 1,
      durationMs: 42,
      errorType: null,
      errorCode: null,
      retryable: null,
      recovered: null,
      argsBytes: 100,
      resultBytes: 200,
      responseId: 'resp-1',
      forwardedAt: null,
      forwardAttempts: 0,
      forwardError: null,
    })
  })

  test('forward_attempts defaults to 0 when omitted', () => {
    getDrizzleDb()
      .insert(toolCallEvents)
      .values({
        eventId: 'evt-default',
        turnId: 'turn-x',
        occurredAt: 1_700_000_000_000,
        storageContextId: 'ctx',
        contextType: 'dm',
        chatUserId: 'user',
        model: 'm',
        modelRole: 'main',
        toolName: 'noop',
        toolCallId: 'call',
        success: 1,
      })
      .run()

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.forwardAttempts).toBe(0)
    expect(row?.forwardedAt).toBeNull()
    expect(row?.forwardError).toBeNull()
  })

  test('round-trips NULLs in optional columns', () => {
    getDrizzleDb()
      .insert(toolCallEvents)
      .values({
        eventId: 'evt-nulls',
        turnId: 'turn-nulls',
        occurredAt: 1_700_000_000_000,
        storageContextId: 'ctx',
        contextType: 'group',
        chatUserId: 'user',
        model: 'm',
        modelRole: 'small',
        toolName: 't',
        toolCallId: 'call',
        success: 0,
        durationMs: null,
        argsBytes: null,
        resultBytes: null,
        responseId: null,
        errorType: null,
        errorCode: null,
        retryable: null,
        recovered: null,
      })
      .run()

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.durationMs).toBeNull()
    expect(row?.argsBytes).toBeNull()
    expect(row?.resultBytes).toBeNull()
    expect(row?.responseId).toBeNull()
    expect(row?.success).toBe(0)
  })
})

describe('llmUsageEvents Drizzle table — outbox columns (Phase 4)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('outbox columns default to inert values', () => {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId: 'evt-1',
        occurredAt: 1_700_000_000_000,
        turnId: 'turn-1',
        storageContextId: 'ctx',
        contextType: 'dm',
        chatUserId: 'user',
        model: 'm',
        modelRole: 'main',
        durationMs: 10,
      })
      .run()

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.forwardedAt).toBeNull()
    expect(row?.forwardAttempts).toBe(0)
    expect(row?.forwardError).toBeNull()
  })

  test('outbox columns persist when set', () => {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId: 'evt-2',
        occurredAt: 1_700_000_000_000,
        turnId: 'turn-2',
        storageContextId: 'ctx',
        contextType: 'dm',
        chatUserId: 'user',
        model: 'm',
        modelRole: 'main',
        durationMs: 10,
        forwardedAt: 1_700_000_000_500,
        forwardAttempts: 2,
        forwardError: 'connection refused',
      })
      .run()

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.forwardedAt).toBe(1_700_000_000_500)
    expect(row?.forwardAttempts).toBe(2)
    expect(row?.forwardError).toBe('connection refused')
  })
})
