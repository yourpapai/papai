// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { toolCallEvents } from '../../src/db/schema.js'
import { emitUser } from '../../src/debug/event-bus.js'
import { initUsageRecorder, resetUsageRecorderForTesting } from '../../src/usage/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const execEndPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  toolName: 'create_task',
  toolCallId: 'call-1',
  success: true,
  durationMs: 42,
  argsBytes: 50,
  resultBytes: 100,
  chatUserId: 'user-1',
  contextType: 'dm',
  model: 'main-model',
  modelRole: 'main',
  ...overrides,
})

const classifierPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  toolName: 'create_task',
  toolCallId: 'call-1',
  errorType: 'schema_validation',
  errorCode: 'INVALID_ARGS',
  retryable: false,
  recovered: false,
  chatUserId: 'user-1',
  contextType: 'dm',
  model: 'main-model',
  modelRole: 'main',
  ...overrides,
})

describe('usage subscriber — tool call events', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetUsageRecorderForTesting()
    initUsageRecorder()
  })

  afterEach(() => {
    resetUsageRecorderForTesting()
  })

  test('tool:execute_end produces a tool_call_events row', () => {
    emitUser('tool:execute_end', 'ctx-1', execEndPayload(), 'turn-1')

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.storageContextId).toBe('ctx-1')
    expect(row?.turnId).toBe('turn-1')
    expect(row?.chatUserId).toBe('user-1')
    expect(row?.contextType).toBe('dm')
    expect(row?.model).toBe('main-model')
    expect(row?.modelRole).toBe('main')
    expect(row?.toolName).toBe('create_task')
    expect(row?.toolCallId).toBe('call-1')
    expect(row?.success).toBe(1)
    expect(row?.durationMs).toBe(42)
    expect(row?.argsBytes).toBe(50)
    expect(row?.resultBytes).toBe(100)
  })

  test('tool:failure_classified after tool:execute_end updates the row in place', () => {
    emitUser(
      'tool:execute_end',
      'ctx-2',
      execEndPayload({ toolCallId: 'call-2', success: false, resultBytes: null }),
      'turn-2',
    )
    emitUser('tool:failure_classified', 'ctx-2', classifierPayload({ toolCallId: 'call-2' }), 'turn-2')

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.success).toBe(0)
    expect(row?.errorType).toBe('schema_validation')
    expect(row?.errorCode).toBe('INVALID_ARGS')
    expect(row?.retryable).toBe(0)
    expect(row?.recovered).toBe(0)
  })

  test('tool:failure_classified arriving without a prior row is a no-op', () => {
    emitUser('tool:failure_classified', 'ctx-3', classifierPayload({ toolCallId: 'call-orphan' }), 'turn-3')

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(0)
  })

  test('llm:end still produces an llm_usage_events row (regression)', async () => {
    emitUser(
      'llm:end',
      'ctx-llm',
      {
        model: 'main-model',
        steps: 1,
        totalDuration: 100,
        tokenUsage: { inputTokens: 10, outputTokens: 20 },
        responseId: 'resp-x',
        finishReason: 'stop',
        messageCount: 2,
        chatUserId: 'user-llm',
        contextType: 'dm',
        toolCount: 0,
        exposedToolCount: 0,
        fullToolCount: 0,
        toolSchemaBytes: 0,
        generatedText: 'ok',
        stepsDetail: [],
      },
      'turn-llm',
    )

    const { llmUsageEvents } = await import('../../src/db/schema.js')
    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.chatUserId).toBe('user-llm')
  })

  test('event without chatUserId is dropped without writing a row', () => {
    emitUser(
      'tool:execute_end',
      'ctx-bad',
      {
        toolName: 'x',
        toolCallId: 'y',
        success: true,
        durationMs: 1,
        // chatUserId missing
        contextType: 'dm',
        model: 'm',
        modelRole: 'main',
      },
      'turn-bad',
    )

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(0)
  })

  test('event without turnId is dropped', () => {
    emitUser('tool:execute_end', 'ctx-noturn', execEndPayload({ toolCallId: 'call-noturn' }))

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(0)
  })
})
