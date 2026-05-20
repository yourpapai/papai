// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { providerError } from '../src/errors.js'
import { emitLlmError, handleOrchestratorMessageError, handleToolCallFinish } from '../src/llm-orchestrator-support.js'
import { buildToolFailureResult } from '../src/tool-failure.js'
import { createMockReply } from './utils/test-helpers.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

describe('llm-orchestrator-support', () => {
  test('handleToolCallFinish emits structured failures and replies with the user message', () => {
    const { reply, getReplies } = createMockReply()
    const emitCalls: Array<{ event: string; payload: unknown }> = []
    const deps = {
      emit: (event: string, payload: unknown): void => {
        emitCalls.push({ event, payload })
      },
      log: {
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }
    const failure = buildToolFailureResult(providerError.taskNotFound('TASK-9'), 'get_task', 'call-1')

    handleToolCallFinish(
      'ctx-1',
      reply,
      {
        toolCall: { toolName: 'get_task', toolCallId: 'call-1' },
        success: true,
        output: failure,
        durationMs: 25,
      },
      deps,
    )

    expect(emitCalls).toHaveLength(1)
    expect(emitCalls[0]).toEqual({
      event: 'llm:tool_result',
      payload: {
        userId: 'ctx-1',
        toolName: 'get_task',
        toolCallId: 'call-1',
        durationMs: 25,
        success: false,
        result: failure,
        error: failure.error,
      },
    })
    expect(getReplies()).toEqual([
      '⚠️ Tool "get_task" failed: Task "TASK-9" was not found. Please check the task ID and try again.',
    ])
  })

  test('handleOrchestratorMessageError replies with the app error message', async () => {
    const { reply, getReplies } = createMockReply()
    const deps = {
      emit: (_event: string, _payload: unknown): void => {},
      log: {
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }

    await handleOrchestratorMessageError(reply, 'ctx-2', providerError.projectNotFound('PRJ-1'), deps)

    expect(getReplies()).toEqual(['Project "PRJ-1" was not found.'])
  })

  describe('emitLlmError', () => {
    test('emits llm:error with chatUserId, contextType, durationMs, messageCount', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const events: Array<{ type: string; data: unknown; turnId?: string }> = []
      const listener = (event: { type: string; data: unknown; turnId?: string }): void => {
        events.push(event)
      }
      subscribe(listener)

      try {
        emitLlmError('ctx-err', 'user-err', 'group', 'main-model', Date.now() - 50, 7, new Error('boom'), 'turn-err')

        expect(events).toHaveLength(1)
        const event = events[0]
        assert.ok(event !== undefined)
        expect(event.type).toBe('llm:error')
        assert.ok(isRecord(event.data))
        const data = event.data
        expect(data['error']).toBe('boom')
        expect(data['model']).toBe('main-model')
        expect(data['chatUserId']).toBe('user-err')
        expect(data['contextType']).toBe('group')
        expect(data['messageCount']).toBe(7)
        expect(data['durationMs']).toEqual(expect.any(Number))
        expect(Number(data['durationMs'])).toBeGreaterThanOrEqual(50)
        expect(event.turnId).toBe('turn-err')
      } finally {
        unsubscribe(listener)
      }
    })

    test('extracts message from non-Error error values', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const events: Array<{ type: string; data: unknown }> = []
      const listener = (event: { type: string; data: unknown }): void => {
        events.push(event)
      }
      subscribe(listener)

      try {
        emitLlmError('ctx', 'user', 'dm', 'm', Date.now(), 1, 'plain-string-error')
        expect(events).toHaveLength(1)
        const event = events[0]
        assert.ok(event !== undefined)
        expect(event.type).toBe('llm:error')
        assert.ok(isRecord(event.data))
        expect(event.data['error']).toBe('plain-string-error')
      } finally {
        unsubscribe(listener)
      }
    })
  })
})
