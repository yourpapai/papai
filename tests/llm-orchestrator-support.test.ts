// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import assert from 'node:assert/strict'

import { generateText, stepCountIs, tool } from 'ai'
import type { ModelMessage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'

import type { AiProgressReporter } from '../src/ai-progress-reporter.js'
import { NO_ANALYTICS_SCOPE } from '../src/analytics/provider-request-scope.js'
import type { ReplyFn, StatusHandle } from '../src/chat/types.js'
import { setConfigValue } from '../src/config.js'
import { providerError } from '../src/errors.js'
import * as historyModule from '../src/history.js'
import {
  emitLlmError,
  handleLlmTurnError,
  handleOrchestratorMessageError,
  handleToolCallFinish,
  invokeWithLiveStatus,
} from '../src/llm-orchestrator-support.js'
import type { InvokeModelArgs } from '../src/llm-orchestrator-types.js'
import { logger, logMultistream } from '../src/logger.js'
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

  test('handleToolCallFinish forwards the event turnId to the llm:tool_result emit', () => {
    const emitCalls: Array<{ event: string; turnId: string | undefined }> = []
    const deps = {
      emit: (event: string, _userId: string, _payload: Record<string, unknown>, turnId?: string): void => {
        emitCalls.push({ event, turnId })
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
        toolCall: { toolName: 'get_task', toolCallId: 'call-1' },
        success: true,
        output: { id: 'task-1' },
        durationMs: 5,
        turnId: 'turn-9',
      },
      deps,
    )

    expect(emitCalls).toEqual([{ event: 'llm:tool_result', turnId: 'turn-9' }])
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

describe('invokeWithLiveStatus locale', () => {
  const model = new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: 'Готово!' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    },
  })

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  const makeStatusReply = (): { reply: ReplyFn; created: string[]; updates: string[] } => {
    const created: string[] = []
    const updates: string[] = []
    const base = createMockReply()
    const handle: StatusHandle = {
      update: (text: string): Promise<void> => {
        updates.push(text)
        return Promise.resolve()
      },
      dismiss: (): Promise<void> => Promise.resolve(),
    }
    const reply: ReplyFn = {
      ...base.reply,
      createStatus: (initialText: string): Promise<StatusHandle> => {
        created.push(initialText)
        return Promise.resolve(handle)
      },
    }
    return { reply, created, updates }
  }

  const makeInvokeArgs = (contextId: string): InvokeModelArgs & { turnId: string } => ({
    contextId,
    chatUserId: 'user-1',
    contextType: 'dm',
    mainModel: 'gpt-4o',
    model,
    provider: null,
    tools: {},
    enabledToolNames: new Set<string>(),
    messages: [{ role: 'user', content: 'привет' }],
    turnId: 'turn-live-status-locale',
    providerRequestScope: NO_ANALYTICS_SCOPE,
    deps: {
      generateText: (options) => generateText(options),
      stepCountIs,
      buildModel: () => model,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    },
  })

  const makeProgressReporter = (): AiProgressReporter => ({
    toolStarted: (): void => {},
    toolFinished: (): void => {},
    reasoning: (): void => {},
    flush: () => Promise.resolve(),
  })

  test('a ru context drives the thinking status and the preparing placeholder in ru', async () => {
    setConfigValue('ctx-live-ru', 'language', 'ru')
    const { reply, created, updates } = makeStatusReply()

    await invokeWithLiveStatus({
      reply,
      invokeArgs: makeInvokeArgs('ctx-live-ru'),
      progressReporter: makeProgressReporter(),
      liveStatusEnabled: true,
    })

    expect(created).toEqual(['💭 Думаю…'])
    expect(updates).toContain('💬 Готовлю ответ…')
    expect(updates).not.toContain('💬 Preparing response…')
  })

  test('an unset context stays en and renders the en placeholder', async () => {
    const { reply, created, updates } = makeStatusReply()

    await invokeWithLiveStatus({
      reply,
      invokeArgs: makeInvokeArgs('ctx-live-en'),
      progressReporter: makeProgressReporter(),
      liveStatusEnabled: true,
    })

    expect(created).toEqual(['💭 Thinking…'])
    expect(updates).toContain('💬 Preparing response…')
  })
})

// Real-logger capture window (logging-privacy pattern): the shared logger is
// constructed at 'silent' by tests/setup, so its fixed-level multistream legs
// stay quiet even while a test raises the root level; this dedicated
// debug-level tap is the only destination during the window.
const realLogger = logger
const supportWarnLines: string[] = []
logMultistream.add({
  level: 'debug',
  stream: {
    write: (chunk: string): void => {
      supportWarnLines.push(chunk)
    },
  },
})

const supportWarns = (): Array<Record<string, unknown>> => {
  const warns: Array<Record<string, unknown>> = []
  for (const line of supportWarnLines) {
    const parsed: unknown = JSON.parse(line)
    if (isRecord(parsed) && parsed['level'] === 40 && parsed['scope'] === 'llm-orchestrator:support') {
      warns.push(parsed)
    }
  }
  return warns
}

// Synthetic turn shapes: each mock model bills a realistic response but returns
// exactly the content under test, so the real generateText result reaching
// invokeWithLiveStatus carries the anomalous combination.
const makeTurnModel = (
  content: Array<
    { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
  >,
  outputTokens: number,
  unified: 'stop' | 'tool-calls',
): MockLanguageModelV3 =>
  new MockLanguageModelV3({
    doGenerate: {
      content,
      finishReason: { unified, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: outputTokens, text: 0, reasoning: 0 },
      },
      warnings: [],
    },
  })
const stubTool = tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

describe('invokeWithLiveStatus anomalous empty-turn warn', () => {
  const CANARY_USER_TEXT = 'CANARY-USER-TEXT-4f'

  beforeEach(async () => {
    // No mockLogger here: the warn capture window relies on the real logger.
    await setupTestDb()
  })

  const runTurn = async (contextId: string, model: MockLanguageModelV3, tools: 'none' | 'time'): Promise<void> => {
    await invokeWithLiveStatus({
      reply: createMockReply().reply,
      invokeArgs: {
        contextId,
        chatUserId: 'user-1',
        contextType: 'dm',
        mainModel: 'gpt-4o',
        model,
        provider: null,
        tools: tools === 'time' ? { get_current_time: stubTool } : {},
        enabledToolNames: new Set<string>(),
        messages: [{ role: 'user', content: CANARY_USER_TEXT }],
        turnId: `turn-${contextId}`,
        providerRequestScope: NO_ANALYTICS_SCOPE,
        deps: {
          generateText: (options) => generateText(options),
          // Single-step turns: the mock model would otherwise answer identically
          // every step, and the pending-tool-call case must stay bounded.
          stepCountIs: () => stepCountIs(1),
          buildModel: () => model,
          resolve: () => null,
          maybeAutoProvision: () => Promise.resolve(false),
        },
      },
      progressReporter: {
        toolStarted: (): void => {},
        toolFinished: (): void => {},
        reasoning: (): void => {},
        flush: () => Promise.resolve(),
      },
      liveStatusEnabled: false,
    })
  }

  const runWithCapture = async (
    contextId: string,
    model: MockLanguageModelV3,
    tools: 'none' | 'time',
  ): Promise<void> => {
    supportWarnLines.length = 0
    realLogger.level = 'debug'
    try {
      await runTurn(contextId, model, tools)
    } finally {
      realLogger.level = 'silent'
    }
  }

  test('empty turn billed at outputTokens >= 64 warns once with outputTokens and finishReason and no message content', async () => {
    const model = makeTurnModel([], 200, 'stop')
    await runWithCapture('ctx-warn-anomaly', model, 'none')

    const warns = supportWarns()
    expect(warns).toHaveLength(1)
    assert.ok(warns[0] !== undefined)
    expect(warns[0]['contextId']).toBe('ctx-warn-anomaly')
    expect(warns[0]['outputTokens']).toBe(200)
    expect(warns[0]['finishReason']).toBe('stop')
    expect(JSON.stringify(warns)).not.toContain(CANARY_USER_TEXT)
  })

  test('a turn with non-empty text produces no anomaly warn', async () => {
    const model = makeTurnModel([{ type: 'text', text: 'All overdue tasks are listed.' }], 200, 'stop')
    await runWithCapture('ctx-warn-text', model, 'none')
    expect(supportWarns()).toHaveLength(0)
  })

  test('a turn that ended with a pending tool call produces no anomaly warn', async () => {
    const model = makeTurnModel(
      [{ type: 'tool-call', toolCallId: 'call-tc', toolName: 'get_current_time', input: '{}' }],
      200,
      'tool-calls',
    )
    await runWithCapture('ctx-warn-toolcall', model, 'time')
    expect(supportWarns()).toHaveLength(0)
  })

  test('a cheap empty turn below the output threshold produces no anomaly warn', async () => {
    const model = makeTurnModel([], 5, 'stop')
    await runWithCapture('ctx-warn-cheap', model, 'none')
    expect(supportWarns()).toHaveLength(0)
  })
})
