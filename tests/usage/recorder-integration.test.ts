// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { emitUser, subscribe, unsubscribe } from '../../src/debug/event-bus.js'
import { initUsageRecorder, resetUsageRecorderForTesting } from '../../src/usage/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const noopListener = (): void => {}

describe('usage recorder bus integration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetUsageRecorderForTesting()
    initUsageRecorder()
  })

  afterEach(() => {
    resetUsageRecorderForTesting()
  })

  test('llm:end event produces a recorder row with main model role', () => {
    emitUser(
      'llm:end',
      'ctx-1',
      {
        model: 'main-model',
        steps: 2,
        totalDuration: 1500,
        tokenUsage: { inputTokens: 100, outputTokens: 200 },
        responseId: 'resp-1',
        actualModel: 'main-model',
        finishReason: 'stop',
        messageCount: 4,
        chatUserId: 'user-1',
        contextType: 'dm',
        toolCount: 5,
        exposedToolCount: 5,
        fullToolCount: 5,
        toolSchemaBytes: 1000,
        generatedText: 'response text',
        stepsDetail: [],
      },
      'turn-1',
    )

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.storageContextId).toBe('ctx-1')
    expect(row?.chatUserId).toBe('user-1')
    expect(row?.contextType).toBe('dm')
    expect(row?.model).toBe('main-model')
    expect(row?.modelRole).toBe('main')
    expect(row?.inputTokens).toBe(100)
    expect(row?.outputTokens).toBe(200)
    expect(row?.stepCount).toBe(2)
    expect(row?.toolCallCount).toBe(5)
    expect(row?.messageCount).toBe(4)
    expect(row?.finishReason).toBe('stop')
    expect(row?.durationMs).toBe(1500)
    expect(row?.responseId).toBe('resp-1')
    expect(row?.turnId).toBe('turn-1')
    expect(row?.error).toBeNull()
  })

  test('llm:end accepts NULL token counts when tokenUsage fields are undefined', () => {
    emitUser(
      'llm:end',
      'ctx-2',
      {
        model: 'm',
        steps: 1,
        totalDuration: 10,
        tokenUsage: { inputTokens: undefined, outputTokens: undefined },
        responseId: undefined,
        actualModel: undefined,
        finishReason: 'stop',
        messageCount: 1,
        chatUserId: 'user-2',
        contextType: 'group',
        toolCount: 0,
        exposedToolCount: 0,
        fullToolCount: 0,
        toolSchemaBytes: 0,
        generatedText: '',
        stepsDetail: [],
      },
      'turn-2',
    )

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.inputTokens).toBeNull()
    expect(row?.outputTokens).toBeNull()
    expect(row?.responseId).toBeNull()
    expect(row?.contextType).toBe('group')
  })

  test('llm:error event produces a recorder row with error populated', () => {
    emitUser(
      'llm:error',
      'ctx-3',
      {
        error: 'boom',
        model: 'main-model',
        chatUserId: 'user-3',
        contextType: 'dm',
        durationMs: 42,
        messageCount: 2,
      },
      'turn-3',
    )

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.error).toBe('boom')
    expect(row?.model).toBe('main-model')
    expect(row?.modelRole).toBe('main')
    expect(row?.chatUserId).toBe('user-3')
    expect(row?.contextType).toBe('dm')
    expect(row?.durationMs).toBe(42)
    expect(row?.messageCount).toBe(2)
    expect(row?.inputTokens).toBeNull()
    expect(row?.outputTokens).toBeNull()
    expect(row?.responseId).toBeNull()
    expect(row?.finishReason).toBeNull()
    expect(row?.turnId).toBe('turn-3')
    expect(row?.stepCount).toBe(0)
    expect(row?.toolCallCount).toBe(0)
  })

  test('unrelated event types are ignored', () => {
    emitUser('tool:request', 'ctx-4', { toolName: 'x', toolCallId: 'c-1', args: {} }, 'turn-4')
    emitUser('llm:start', 'ctx-4', { model: 'm', messageCount: 1, toolCount: 0 }, 'turn-4')

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toEqual([])
  })

  test('a second initUsageRecorder() does not register a duplicate subscriber', () => {
    initUsageRecorder()
    initUsageRecorder()

    emitUser(
      'llm:end',
      'ctx-dup',
      {
        model: 'm',
        steps: 1,
        totalDuration: 1,
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
        messageCount: 1,
        chatUserId: 'user',
        contextType: 'dm',
        toolCount: 0,
        exposedToolCount: 0,
        fullToolCount: 0,
        toolSchemaBytes: 0,
        generatedText: '',
        stepsDetail: [],
      },
      'turn-dup',
    )

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
  })

  test('a malformed event is dropped without disrupting other subscribers', () => {
    const received: string[] = []
    const otherListener = (event: { type: string }): void => {
      received.push(event.type)
    }
    subscribe(otherListener)

    try {
      // Missing required fields — recorder must not throw.
      emitUser('llm:end', 'ctx-bad', { partial: 'payload' }, 'turn-bad')
      // Bus should still deliver to other subscribers.
      expect(received).toEqual(['llm:end'])
    } finally {
      unsubscribe(otherListener)
    }
  })

  test('listener references are kept stable so unsubscribe (resetUsageRecorderForTesting) works', () => {
    // First emit goes through.
    emitUser(
      'llm:end',
      'ctx-stable',
      {
        model: 'm',
        steps: 1,
        totalDuration: 1,
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
        messageCount: 1,
        chatUserId: 'user',
        contextType: 'dm',
        toolCount: 0,
        exposedToolCount: 0,
        fullToolCount: 0,
        toolSchemaBytes: 0,
        generatedText: '',
        stepsDetail: [],
      },
      'turn-stable-1',
    )

    resetUsageRecorderForTesting()
    // Bus has no listeners (recorder unsubscribed); add a noop so emitUser
    // still dispatches and we can verify the recorder didn't write.
    subscribe(noopListener)

    try {
      emitUser(
        'llm:end',
        'ctx-stable',
        {
          model: 'm',
          steps: 1,
          totalDuration: 1,
          tokenUsage: { inputTokens: 1, outputTokens: 1 },
          finishReason: 'stop',
          messageCount: 1,
          chatUserId: 'user',
          contextType: 'dm',
          toolCount: 0,
          exposedToolCount: 0,
          fullToolCount: 0,
          toolSchemaBytes: 0,
          generatedText: '',
          stepsDetail: [],
        },
        'turn-stable-2',
      )

      const rows = getDrizzleDb().select().from(llmUsageEvents).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.turnId).toBe('turn-stable-1')
    } finally {
      unsubscribe(noopListener)
    }
  })
})
