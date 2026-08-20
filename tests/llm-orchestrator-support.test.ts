// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ModelMessage } from 'ai'

import { setConfigValue } from '../src/config.js'
import { providerError } from '../src/errors.js'
import * as historyModule from '../src/history.js'
import {
  emitLlmError,
  handleLlmTurnError,
  handleOrchestratorMessageError,
  handleToolCallFinish,
} from '../src/llm-orchestrator-support.js'
import { buildToolFailureResult } from '../src/tool-failure.js'
import { llmError } from './utils/test-errors.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

type SpyInstance = { mockRestore: () => void }

describe('llm-orchestrator-support', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('handleToolCallFinish emits structured failures and replies with the user message', () => {
    const { reply, getReplies } = createMockReply()
    const emitCalls: Array<{ event: string; userId: string; payload: unknown }> = []
    const deps = {
      emit: (event: string, userId: string, payload: Record<string, unknown>): void => {
        emitCalls.push({ event, userId, payload })
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
      userId: 'ctx-1',
      payload: {
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

  test('handleToolCallFinish logs structured failures when reply is suppressed', () => {
    const emitCalls: Array<{ event: string; userId: string; payload: unknown }> = []
    const deps = {
      emit: (event: string, userId: string, payload: Record<string, unknown>): void => {
        emitCalls.push({ event, userId, payload })
      },
      log: {
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }

    handleToolCallFinish(
      'ctx-1',
      undefined,
      {
        toolCall: { toolName: 'search_tasks', toolCallId: 'call-2' },
        success: false,
        error: new Error('boom'),
        durationMs: 15,
      },
      deps,
    )

    expect(emitCalls.map((call) => call.event)).toEqual(['llm:tool_result'])
    expect(deps.log.warn).toHaveBeenCalledTimes(1)
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: 'ctx-1',
        toolName: 'search_tasks',
        error: 'boom',
      }),
      'Tool execution failed',
    )
  })

  test('handleOrchestratorMessageError replies with the app error message', async () => {
    const { reply, getReplies } = createMockReply()
    const deps = {
      emit: (_event: string, _userId: string, _payload: Record<string, unknown>): void => {},
      log: {
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }

    await handleOrchestratorMessageError(reply, 'ctx-2', providerError.projectNotFound('PRJ-1'), deps)

    expect(getReplies()).toEqual(['Project "PRJ-1" was not found.'])
  })

  describe('handleLlmTurnError', () => {
    const spies: SpyInstance[] = []

    afterEach(() => {
      for (const spy of spies) spy.mockRestore()
      spies.length = 0
    })

    const track = <T extends SpyInstance>(spy: T): T => {
      spies.push(spy)
      return spy
    }

    test('rolls back to baseHistory plus the triggering user message, not past it', async () => {
      mockLogger()
      const saveHistorySpy = track(spyOn(historyModule, 'saveHistory').mockImplementation(() => {}))

      const baseHistory: ModelMessage[] = [{ role: 'assistant', content: 'earlier reply' }]
      const userHistoryMessage: ModelMessage = { role: 'user', content: 'do the thing' }
      const { reply } = createMockReply()

      await handleLlmTurnError({
        reply,
        contextId: 'pi:inst:ctx:user',
        chatUserId: 'user1',
        contextType: 'dm',
        mainModel: 'gpt-4o',
        startedAt: Date.now(),
        baseHistory,
        userHistoryMessage,
        error: new Error('boom'),
        turnId: 'turn-1',
      })

      expect(saveHistorySpy).toHaveBeenCalledTimes(1)
      expect(saveHistorySpy).toHaveBeenCalledWith('pi:inst:ctx:user', [...baseHistory, userHistoryMessage])
    })

    test('emits resolution-phase failure analytics when no attempt was consumed', async () => {
      mockLogger()
      track(spyOn(historyModule, 'saveHistory').mockImplementation(() => {}))
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')
      const events: Array<{ type: string; data: unknown }> = []
      const listener = (event: { type: string; data: unknown }): void => {
        events.push(event)
      }
      subscribe(listener)

      try {
        const { reply } = createMockReply()
        await handleLlmTurnError({
          reply,
          contextId: 'pi:inst:ctx:user',
          chatUserId: 'user1',
          contextType: 'dm',
          mainModel: 'gpt-4o',
          startedAt: Date.now(),
          baseHistory: [],
          userHistoryMessage: { role: 'user', content: 'hi' },
          error: new Error('resolution boom'),
          turnId: 'turn-no-attempt',
        })

        const event = events.find((e) => e.type === 'llm:error')
        assert.ok(event !== undefined)
        assert.ok(isRecord(event.data))
        expect(event.data['phase']).toBe('resolution')
        expect(event.data['attemptOrdinal']).toBe(0)
        expect(event.data['modelRole']).toBe('main')
        expect(event.data['errorClass']).toBe('Error')
      } finally {
        unsubscribe(listener)
      }
    })
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

describe('orchestrator support replies per locale', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setConfigValue('ctx-support-ru', 'language', 'ru')
  })

  test('unexpected-error fallback renders in ru', async () => {
    const { reply, getReplies } = createMockReply()
    const deps = {
      emit: (_event: string, _userId: string, _payload: Record<string, unknown>): void => {},
      log: { warn: mock(() => {}), error: mock(() => {}) },
    }
    await handleOrchestratorMessageError(reply, 'ctx-support-ru', new Error('boom'), deps)
    expect(getReplies()).toEqual(['Произошла непредвиденная ошибка. Попробуйте позже.'])
  })

  test('app error reply renders in ru', async () => {
    const { reply, getReplies } = createMockReply()
    const deps = {
      emit: (_event: string, _userId: string, _payload: Record<string, unknown>): void => {},
      log: { warn: mock(() => {}), error: mock(() => {}) },
    }
    await handleOrchestratorMessageError(reply, 'ctx-support-ru', providerError.projectNotFound('PRJ-1'), deps)
    expect(getReplies()).toEqual(['Проект «PRJ-1» не найден.'])
  })

  test('llm app error reply renders in ru', async () => {
    const { reply, getReplies } = createMockReply()
    const deps = {
      emit: (_event: string, _userId: string, _payload: Record<string, unknown>): void => {},
      log: { warn: mock(() => {}), error: mock(() => {}) },
    }
    await handleOrchestratorMessageError(reply, 'ctx-support-ru', llmError.rateLimited(), deps)
    expect(getReplies()).toEqual(['Достигнут лимит запросов к ИИ-сервису. Подождите немного и попробуйте ещё раз.'])
  })

  test('tool failure envelope renders fully in ru for a thrown provider error', () => {
    const { reply, getReplies } = createMockReply()
    handleToolCallFinish('ctx-support-ru', reply, {
      toolCall: { toolName: 'get_task', toolCallId: 'call-ru' },
      success: false,
      error: providerError.taskNotFound('TASK-9'),
      durationMs: 5,
    })
    expect(getReplies()).toEqual([
      '⚠️ Инструмент "get_task" завершился ошибкой: Задача «TASK-9» не найдена. Проверьте идентификатор задачи и попробуйте ещё раз.',
    ])
  })

  test('tool failure envelope renders the unclassified failure body in ru', () => {
    const { reply, getReplies } = createMockReply()
    handleToolCallFinish('ctx-support-ru', reply, {
      toolCall: { toolName: 'search_tools', toolCallId: 'call-ru-2' },
      success: false,
      error: new Error('boom'),
      durationMs: 5,
    })
    expect(getReplies()).toEqual(['⚠️ Инструмент "search_tools" завершился ошибкой: Действие не выполнено: boom.'])
  })
})
