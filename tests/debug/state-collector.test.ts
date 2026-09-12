// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { emitGlobal, emitUser, emitGroup } from '../../src/debug/event-bus.js'
import { subscribeCountForTest } from '../../src/debug/event-bus.testing.js'
import {
  addClient,
  findTurnById,
  recentLlm,
  removeClient,
  resetCollectorForTest,
  startEventCollector,
  stats,
  STATE_INIT_LLM_TAIL,
  stopEventCollectorForTest,
} from '../../src/debug/state-collector.js'
import { recentNotifications } from '../../src/debug/turn-assembly.js'
import { resetStats, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  await setupTestDb()
})

type MockController = {
  ctrl: ReadableStreamDefaultController
  enqueueMock: ReturnType<typeof mock<(chunk: unknown) => void>>
}

function createMockController(): MockController {
  const enqueueMock = mock<(chunk: unknown) => void>(() => {})
  const closeMock = mock(() => {})
  const ctrl: ReadableStreamDefaultController = {
    enqueue: (chunk: unknown): void => enqueueMock(chunk),
    close: (): void => closeMock(),
    error: (): void => {},
    desiredSize: 1,
  }
  return { ctrl, enqueueMock }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getFirstCallArg(enqueueMock: MockController['enqueueMock']): unknown {
  const firstCall = enqueueMock.mock.calls[0]
  if (firstCall === undefined) {
    return undefined
  }
  return firstCall[0]
}

function parseSseFromUnknown(chunk: unknown): { event: string; data: Record<string, unknown> } {
  const raw = new Uint8Array(chunk instanceof Uint8Array ? chunk : [])
  const text = new TextDecoder().decode(raw)
  const eventMatch = text.match(/^event: (.+)$/mu)
  const dataMatch = text.match(/^data: (.+)$/mu)

  let event = ''
  if (eventMatch !== null) {
    const matchedEvent = eventMatch[1]
    if (matchedEvent !== undefined) {
      event = matchedEvent
    }
  }

  let parsed: unknown = {}
  if (dataMatch !== null) {
    const matchedData = dataMatch[1]
    if (matchedData !== undefined) {
      parsed = JSON.parse(matchedData)
    }
  }

  return {
    event,
    data: isRecord(parsed) ? parsed : {},
  }
}

function getAllSseEvents(
  enqueueMock: MockController['enqueueMock'],
): Array<{ event: string; data: Record<string, unknown> }> {
  return enqueueMock.mock.calls.map((call) => parseSseFromUnknown(call[0]))
}

function getEventAt(
  events: Array<{ event: string; data: Record<string, unknown> }>,
  index: number,
): {
  event: string
  data: Record<string, unknown>
} {
  const event = events[index]
  assert.ok(event !== undefined)
  return event
}

function getLastEventByName(
  events: Array<{ event: string; data: Record<string, unknown> }>,
  eventName: string,
): { event: string; data: Record<string, unknown> } {
  const matchingEvents = events.filter((event) => event.event === eventName)
  const lastEvent = matchingEvents.at(-1)
  assert.ok(lastEvent !== undefined, `expected ${eventName}`)
  return lastEvent
}

function getTraceEventData(event: { event: string; data: Record<string, unknown> }): Record<string, unknown> {
  assert.ok(isRecord(event.data), 'expected event payload')
  const eventData = event.data['data']
  assert.ok(isRecord(eventData), 'expected trace data')
  return eventData
}

describe('state-collector', () => {
  const controllers: ReadableStreamDefaultController[] = []

  beforeEach(() => {
    startEventCollector()
  })

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
    resetStats()
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('addClient sends state:init immediately', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl), undefined, 'admin-1')

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const { event, data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
    expect(event).toBe('state:init')
    expect(data['type']).toBe('state:init')
  })

  test('state:init contains all snapshot sections', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl), undefined, 'admin-1')

    const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
    const initData = data['data']
    assert.ok(isRecord(initData))
    expect(initData).toHaveProperty('sessions')
    expect(initData).toHaveProperty('scheduler')
    expect(initData).toHaveProperty('pollers')
    expect(initData).toHaveProperty('messageCache')
    expect(initData).toHaveProperty('stats')
    expect(initData).toHaveProperty('recentLlm')

    const statsSnapshot = initData['stats']
    assert.ok(isRecord(statsSnapshot))
    expect(statsSnapshot['totalMessages']).toBe(0)
    expect(statsSnapshot['totalLlmCalls']).toBe(0)
    expect(statsSnapshot['totalToolCalls']).toBe(0)
  })

  test('admin events are broadcast to clients', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl), undefined, 'admin-1')

    emitGlobal('message:received', { userId: 'admin-1', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const events = getAllSseEvents(enqueueMock)
    expect(getEventAt(events, 1).event).toBe('message:received')
  })

  test('non-admin user events are filtered out', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl), undefined, 'admin-1')

    emitUser('message:received', 'other-user', { textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('global events (no userId) pass through unfiltered', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl), undefined, 'admin-1')

    emitGlobal('scheduler:tick', { tickCount: 1, dueTaskCount: 0 })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const events = getAllSseEvents(enqueueMock)
    expect(getEventAt(events, 1).event).toBe('scheduler:tick')
  })

  test('removeClient stops delivery to that client', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(ctrl, undefined, 'admin-1')
    removeClient(ctrl)

    emitGlobal('message:received', { userId: 'admin-1', textLength: 5 })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('dead client (enqueue throws) is removed silently', () => {
    const { ctrl, enqueueMock: badEnqueue } = createMockController()
    const { ctrl: goodCtrl, enqueueMock: goodEnqueue } = createMockController()
    addClient(track(ctrl), undefined, 'admin-1')
    addClient(track(goodCtrl), undefined, 'admin-1')

    badEnqueue.mockImplementation(() => {
      throw new Error('stream closed')
    })

    expect(() => emitGlobal('test:event', { userId: 'admin-1' })).not.toThrow()

    badEnqueue.mockImplementation(() => {})
    emitGlobal('test:after', { userId: 'admin-1' })

    expect(goodEnqueue).toHaveBeenCalledTimes(3)
  })

  describe('llm trace accumulation', () => {
    test('llm:end captures full trace data', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('llm:start', {
        userId: 'admin-1',
        model: 'gpt-4',
        messageCount: 5,
        toolCount: 10,
      })
      emitUser('llm:tool_result', 'admin-1', {
        toolName: 'create_task',
        toolCallId: 'call-1',
        durationMs: 500,
        success: true,
        args: { title: 'Test' },
        result: { id: 'task-1' },
      })
      emitGlobal('llm:end', {
        userId: 'admin-1',
        chatUserId: 'admin-1',
        model: 'gpt-4',
        steps: 2,
        totalDuration: 2500,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        responseId: 'resp-123',
        actualModel: 'gpt-4-0125-preview',
        finishReason: 'stop',
        messageCount: 5,
        toolCount: 10,
        exposedToolCount: 6,
        fullToolCount: 10,
        toolSchemaBytes: 1234,
        routingIntent: 'task_read',
        routingConfidence: 0.75,
        routingReason: 'read-keyword',
        generatedText: 'Task created successfully.',
      })

      const events = getAllSseEvents(enqueueMock)
      const eventData = getTraceEventData(getLastEventByName(events, 'llm:full'))

      expect(eventData['responseId']).toBe('resp-123')
      expect(eventData['actualModel']).toBe('gpt-4-0125-preview')
      expect(eventData['finishReason']).toBe('stop')
      expect(eventData['messageCount']).toBe(5)
      expect(eventData['toolCount']).toBe(10)
      expect(eventData['exposedToolCount']).toBe(6)
      expect(eventData['fullToolCount']).toBe(10)
      expect(eventData['toolSchemaBytes']).toBe(1234)
      expect(eventData['routingIntent']).toBe('task_read')
      expect(eventData['generatedText']).toBe('Task created successfully.')

      const toolCalls: unknown = eventData['toolCalls']
      assert.ok(Array.isArray(toolCalls))
      expect(toolCalls).toHaveLength(1)
      const firstToolCall: unknown = toolCalls[0]
      assert.ok(isRecord(firstToolCall))
      expect(firstToolCall['toolCallId']).toBe('call-1')
      expect(firstToolCall['args']).toEqual({ title: 'Test' })
      expect(firstToolCall['result']).toEqual({ id: 'task-1' })
    })

    test('llm:tool_result captures error details', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emitUser('llm:tool_result', 'admin-1', {
        toolName: 'search_tasks',
        toolCallId: 'call-2',
        durationMs: 300,
        success: false,
        args: { query: 'invalid' },
        error: 'API error: 500',
      })
      emitGlobal('llm:end', {
        userId: 'admin-1',
        chatUserId: 'admin-1',
        model: 'gpt-4',
        steps: 1,
        totalDuration: 1000,
        tokenUsage: { inputTokens: 50, outputTokens: 30 },
      })

      const events = getAllSseEvents(enqueueMock)
      const eventData = getTraceEventData(getLastEventByName(events, 'llm:full'))
      const toolCalls: unknown = eventData['toolCalls']
      assert.ok(Array.isArray(toolCalls))
      expect(toolCalls).toHaveLength(1)
      const firstToolCall: unknown = toolCalls[0]
      assert.ok(isRecord(firstToolCall))
      expect(firstToolCall['success']).toBe(false)
      expect(firstToolCall['error']).toBe('API error: 500')
    })

    test('llm:end broadcasts stepsDetail with per-step info', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emitGlobal('llm:end', {
        userId: 'admin-1',
        chatUserId: 'admin-1',
        model: 'gpt-4',
        steps: 2,
        totalDuration: 2000,
        tokenUsage: { inputTokens: 200, outputTokens: 100 },
        stepsDetail: [
          {
            stepNumber: 1,
            toolCalls: [{ toolName: 'search', toolCallId: 'call-1', args: {} }],
            usage: { inputTokens: 100, outputTokens: 50 },
          },
          {
            stepNumber: 2,
            toolCalls: [{ toolName: 'create', toolCallId: 'call-2', args: {} }],
            usage: { inputTokens: 100, outputTokens: 50 },
          },
        ],
      })

      const events = getAllSseEvents(enqueueMock)
      const eventData = getTraceEventData(getLastEventByName(events, 'llm:full'))

      const stepsDetail: unknown = eventData['stepsDetail']
      assert.ok(Array.isArray(stepsDetail))

      expect(stepsDetail).toHaveLength(2)
      const firstStep: unknown = stepsDetail[0]
      const secondStep: unknown = stepsDetail[1]
      assert.ok(isRecord(firstStep))
      assert.ok(isRecord(secondStep))
      expect(firstStep['stepNumber']).toBe(1)
      expect(secondStep['stepNumber']).toBe(2)
    })

    test('llm:error broadcasts an error trace with captured message', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emitGlobal('llm:error', { userId: 'admin-1', model: 'gpt-4', error: 'boom' })

      const events = getAllSseEvents(enqueueMock)
      const eventData = getTraceEventData(getLastEventByName(events, 'llm:full'))
      expect(eventData['error']).toBe('boom')
      expect(eventData['model']).toBe('gpt-4')
      expect(eventData['steps']).toBe(0)
    })

    test('llm:error without prior llm:start still emits trace with zero duration', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('llm:error', { userId: 'admin-1', model: 'gpt-4', error: 'crash' })

      const events = getAllSseEvents(enqueueMock)
      const eventData = getTraceEventData(getLastEventByName(events, 'llm:full'))
      expect(eventData['error']).toBe('crash')
      expect(eventData['duration']).toBe(0)
    })

    test('llm:end passes through text, finishReason, and inline tool result/error', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emitGlobal('llm:end', {
        userId: 'admin-1',
        chatUserId: 'admin-1',
        model: 'gpt-4',
        steps: 1,
        totalDuration: 500,
        tokenUsage: { inputTokens: 50, outputTokens: 20 },
        stepsDetail: [
          {
            stepNumber: 1,
            text: 'Calling the search tool now.',
            finishReason: 'tool-calls',
            toolCalls: [
              {
                toolName: 'search',
                toolCallId: 'call-1',
                args: { query: 'foo' },
                result: { hits: 3 },
              },
              {
                toolName: 'create',
                toolCallId: 'call-2',
                args: { title: 'x' },
                error: 'permission denied',
              },
            ],
          },
        ],
      })

      const events = getAllSseEvents(enqueueMock)
      const eventData = getTraceEventData(getLastEventByName(events, 'llm:full'))

      const stepsDetail: unknown = eventData['stepsDetail']
      assert.ok(Array.isArray(stepsDetail))
      const first: unknown = stepsDetail[0]
      assert.ok(isRecord(first))

      expect(first['text']).toBe('Calling the search tool now.')
      expect(first['finishReason']).toBe('tool-calls')

      const toolCalls: unknown = first['toolCalls']
      assert.ok(Array.isArray(toolCalls))
      expect(toolCalls).toHaveLength(2)

      const tc0: unknown = toolCalls[0]
      const tc1: unknown = toolCalls[1]
      assert.ok(isRecord(tc0))
      assert.ok(isRecord(tc1))
      expect(tc0['result']).toEqual({ hits: 3 })
      expect(tc1['error']).toBe('permission denied')
    })

    test('llm:end with zero clients captures the trace without broadcasting any frame', () => {
      emitGlobal('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emitGlobal('llm:end', {
        userId: 'admin-1',
        model: 'gpt-4',
        steps: 1,
        totalDuration: 10,
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
      })

      expect(recentLlm).toHaveLength(1)

      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      expect(enqueueMock).toHaveBeenCalledTimes(1)
      const events = getAllSseEvents(enqueueMock)
      expect(getEventAt(events, 0).event).toBe('state:init')
      expect(events.map((e) => e.event)).not.toContain('llm:full')
    })
  })

  describe('scope-based visibility filtering', () => {
    test('user-scoped event for admin passes through', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitUser('message:received', 'admin-1', { textLength: 10 })

      const events = getAllSseEvents(enqueueMock)
      const eventNames = events.map((e) => e.event)
      expect(eventNames).toContain('message:received')
    })

    test('user-scoped event for other user is filtered out', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitUser('message:received', 'other-user', { textLength: 10 })

      const events = getAllSseEvents(enqueueMock)
      const eventNames = events.map((e) => e.event)
      expect(eventNames).not.toContain('message:received')
    })

    test('group-scoped event is filtered out when groupIds is empty', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGroup('message:received', 'group-a', { textLength: 10 })

      const events = getAllSseEvents(enqueueMock)
      const eventNames = events.map((e) => e.event)
      expect(eventNames).not.toContain('message:received')
    })

    test('global-scoped event passes through', () => {
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      emitGlobal('scheduler:tick', { tickCount: 1, dueTaskCount: 0 })

      const events = getAllSseEvents(enqueueMock)
      const eventNames = events.map((e) => e.event)
      expect(eventNames).toContain('scheduler:tick')
    })
  })

  describe('persistent capture', () => {
    beforeEach(() => {
      resetCollectorForTest()
    })

    test('startEventCollector subscribes the collector exactly once and is idempotent', () => {
      stopEventCollectorForTest()
      const before = subscribeCountForTest()

      startEventCollector()
      expect(subscribeCountForTest()).toBe(before + 1)

      startEventCollector()
      startEventCollector()
      expect(subscribeCountForTest()).toBe(before + 1)
    })

    test('admin and global events with zero clients are captured and replayed via state:init', () => {
      startEventCollector()

      emitGlobal('llm:start', { userId: 'admin-1', model: 'm-admin' })
      emitGlobal('llm:end', {
        userId: 'admin-1',
        chatUserId: 'admin-1',
        model: 'm-admin',
        steps: 1,
        totalDuration: 42,
        tokenUsage: { inputTokens: 3, outputTokens: 4 },
      })
      emitGlobal('message:received', { userId: 'admin-1', textLength: 12 })
      emitUser('turn:start', 'admin-1', { turnId: 'turn-admin', incomingMessageCount: 1 })
      emitUser('turn:end', 'admin-1', { turnId: 'turn-admin', status: 'ok' })
      emitGlobal('notify:digest', { itemCount: 1 })

      expect(stats.totalMessages).toBe(1)
      expect(stats.totalLlmCalls).toBe(1)

      const trace = recentLlm[0]
      assert.ok(trace !== undefined)
      expect(trace.userId).toBe('admin-1')
      expect(trace.model).toBe('m-admin')

      const turn = findTurnById('turn-admin')
      assert.ok(turn !== undefined)
      expect(turn.status).toBe('ok')

      expect(recentNotifications).toHaveLength(1)

      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
      const initData = data['data']
      assert.ok(isRecord(initData))

      const initLlm = initData['recentLlm']
      assert.ok(Array.isArray(initLlm))
      expect(initLlm).toHaveLength(1)
      const initTrace: unknown = initLlm[0]
      assert.ok(isRecord(initTrace))
      expect(initTrace['userId']).toBe('admin-1')

      const initTurns = initData['recentTurns']
      assert.ok(Array.isArray(initTurns))
      expect(initTurns).toHaveLength(1)
      const initTurn: unknown = initTurns[0]
      assert.ok(isRecord(initTurn))
      expect(initTurn['turnId']).toBe('turn-admin')

      const initNotifications = initData['recentNotifications']
      assert.ok(Array.isArray(initNotifications))
      expect(initNotifications).toHaveLength(1)

      const initStats = initData['stats']
      assert.ok(isRecord(initStats))
      expect(initStats['totalMessages']).toBe(1)
      expect(initStats['totalLlmCalls']).toBe(1)
    })

    test('non-admin events with zero clients are captured but anonymized in the admin state:init', () => {
      startEventCollector()

      emitUser('llm:start', 'other-user', { model: 'm-other' })
      emitUser('llm:end', 'other-user', {
        model: 'm-other',
        steps: 2,
        totalDuration: 7,
        tokenUsage: { inputTokens: 1, outputTokens: 2 },
      })
      emitUser('message:received', 'other-user', { textLength: 4 })
      emitUser('turn:start', 'other-user', { turnId: 'turn-other', incomingMessageCount: 1 })
      emitUser('turn:end', 'other-user', { turnId: 'turn-other', status: 'error', error: 'boom' })
      emitUser('notify:mention', 'other-user', { count: 1 })

      const trace = recentLlm[0]
      assert.ok(trace !== undefined)
      expect(trace.userId).toBe('other-user')

      const turn = findTurnById('turn-other')
      assert.ok(turn !== undefined)
      expect(turn.status).toBe('error')

      expect(recentNotifications).toHaveLength(1)

      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
      const initData = data['data']
      assert.ok(isRecord(initData))

      const initLlm = initData['recentLlm']
      assert.ok(Array.isArray(initLlm))
      expect(initLlm).toHaveLength(1)
      const initTrace: unknown = initLlm[0]
      assert.ok(isRecord(initTrace))
      expect(initTrace['userId']).toBeUndefined()
      expect(initTrace['chatUserId']).toBeUndefined()
      expect(initTrace['model']).toBe('m-other')

      const initTurns = initData['recentTurns']
      assert.ok(Array.isArray(initTurns))
      expect(initTurns.filter(isRecord).map((t) => t['turnId'])).not.toContain('turn-other')

      const initNotifications = initData['recentNotifications']
      assert.ok(Array.isArray(initNotifications))
      expect(initNotifications).toHaveLength(0)
    })

    test('state:init caps the LLM trace tail at the most recent 1024 admin traces', () => {
      startEventCollector()

      for (let i = 0; i < STATE_INIT_LLM_TAIL + 3; i++) {
        emitGlobal('llm:end', {
          userId: 'admin-1',
          model: 'gpt-4',
          responseId: `resp-${i}`,
        })
      }
      expect(recentLlm).toHaveLength(STATE_INIT_LLM_TAIL + 3)

      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
      const initData = data['data']
      assert.ok(isRecord(initData))

      const initLlm = initData['recentLlm']
      assert.ok(Array.isArray(initLlm))
      expect(initLlm).toHaveLength(1024)
      const responseIds = initLlm.filter(isRecord).map((trace) => trace['responseId'])
      expect(responseIds[0]).toBe('resp-3')
      expect(responseIds[1023]).toBe(`resp-${STATE_INIT_LLM_TAIL + 2}`)
      expect(responseIds).not.toContain('resp-0')
      expect(responseIds).not.toContain('resp-2')
    })

    test('stats increment with no client connected', () => {
      startEventCollector()

      emitGlobal('message:received', { userId: 'admin-1', textLength: 10 })
      emitUser('message:received', 'other-user', { textLength: 5 })
      emitUser('llm:start', 'other-user', { model: 'm-other' })
      emitUser('llm:end', 'other-user', {
        model: 'm-other',
        steps: 1,
        totalDuration: 5,
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
      })

      expect(stats.totalMessages).toBe(2)
      expect(stats.totalLlmCalls).toBe(1)
    })

    test('tool failures are captured for everyone but state:init shows only the admin scope', () => {
      startEventCollector()

      emitUser('tool:failure_classified', 'admin-1', {
        turnId: 't-admin',
        toolName: 'search_tasks',
        durationMs: 3,
        ok: false,
        failureReason: 'timeout',
      })
      emitUser('tool:failure_classified', 'other-user', {
        turnId: 't-other',
        toolName: 'search_tasks',
        durationMs: 4,
        ok: false,
        failureReason: 'denied',
      })

      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')

      const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
      const initData = data['data']
      assert.ok(isRecord(initData))
      const initToolFailures = initData['recentToolFailures']
      assert.ok(Array.isArray(initToolFailures))
      expect(initToolFailures).toHaveLength(1)
      const entry: unknown = initToolFailures[0]
      assert.ok(isRecord(entry))
      const scope = entry['scope']
      assert.ok(isRecord(scope))
      expect(scope['userId']).toBe('admin-1')
      const entryData = entry['data']
      assert.ok(isRecord(entryData))
      expect(entryData['turnId']).toBe('t-admin')
    })

    test('non-admin events are captured but broadcast anonymized to a connected client', () => {
      startEventCollector()
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')
      expect(enqueueMock).toHaveBeenCalledTimes(1)

      emitUser('llm:start', 'other-user', { model: 'm-other' })
      emitUser('llm:end', 'other-user', {
        model: 'm-other',
        steps: 1,
        totalDuration: 9,
        tokenUsage: { inputTokens: 2, outputTokens: 2 },
      })
      emitUser('message:received', 'other-user', { textLength: 4 })
      emitUser('turn:start', 'other-user', { turnId: 'turn-live', incomingMessageCount: 1 })
      emitUser('turn:end', 'other-user', { turnId: 'turn-live', status: 'ok' })

      // Only the shaped llm:full frame arrives: the trace metadata is visible,
      // its identity fields are not, and user-scoped non-log events are filtered.
      expect(enqueueMock).toHaveBeenCalledTimes(2)
      const events = getAllSseEvents(enqueueMock)
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      expect(llmFullEvents).toHaveLength(1)
      const eventData = getTraceEventData(llmFullEvents[0]!)
      expect(eventData['userId']).toBeUndefined()
      expect(eventData['chatUserId']).toBeUndefined()
      expect(eventData['model']).toBe('m-other')
      expect(eventData['generatedText']).toBeUndefined()
      expect(events.map((e) => e.event)).not.toContain('message:received')
      expect(events.map((e) => e.event)).not.toContain('turn:summary')

      const trace = recentLlm[0]
      assert.ok(trace !== undefined)
      expect(trace.userId).toBe('other-user')

      const turn = findTurnById('turn-live')
      assert.ok(turn !== undefined)
      expect(turn.status).toBe('ok')
    })

    test('production-shaped llm events expose admin traces by chatUserId, not storage scope', () => {
      startEventCollector()
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, '4242')
      expect(enqueueMock).toHaveBeenCalledTimes(1)

      emitUser('llm:start', 'pi:cGk:ctx:c3RvcmFnZQ', { model: 'm-admin' })
      emitUser('llm:end', 'pi:cGk:ctx:c3RvcmFnZQ', {
        chatUserId: '4242',
        model: 'm-admin',
        steps: 1,
        totalDuration: 9,
        tokenUsage: { inputTokens: 2, outputTokens: 2 },
      })
      emitUser('llm:start', 'pi:cGk:ctx:b3RoZXI', { model: 'm-other' })
      emitUser('llm:end', 'pi:cGk:ctx:b3RoZXI', {
        chatUserId: '777',
        model: 'm-other',
        steps: 1,
        totalDuration: 3,
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
      })

      const trace = recentLlm[0]
      assert.ok(trace !== undefined)
      expect(trace.userId).toBe('4242')

      // Both traces are broadcast; the admin's own passes verbatim, the foreign
      // one loses its identity fields but keeps its metadata.
      const events = getAllSseEvents(enqueueMock)
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      expect(llmFullEvents).toHaveLength(2)
      const ownEventData = getTraceEventData(llmFullEvents[0]!)
      expect(ownEventData['userId']).toBe('4242')
      const foreignEventData = getTraceEventData(llmFullEvents[1]!)
      expect(foreignEventData['userId']).toBeUndefined()
      expect(foreignEventData['chatUserId']).toBeUndefined()
      expect(foreignEventData['model']).toBe('m-other')

      const second = createMockController()
      addClient(track(second.ctrl), undefined, '4242')
      const { data } = parseSseFromUnknown(getFirstCallArg(second.enqueueMock))
      const initData = data['data']
      assert.ok(isRecord(initData))
      const initLlm = initData['recentLlm']
      assert.ok(Array.isArray(initLlm))
      expect(initLlm).toHaveLength(2)
      const ownInitTrace: unknown = initLlm[0]
      assert.ok(isRecord(ownInitTrace))
      expect(ownInitTrace['userId']).toBe('4242')
      const foreignInitTrace: unknown = initLlm[1]
      assert.ok(isRecord(foreignInitTrace))
      expect(foreignInitTrace['userId']).toBeUndefined()
    })

    test('resetCollectorForTest cancels an armed stats debounce so it cannot fire into a later client', async () => {
      startEventCollector()

      const first = createMockController()
      addClient(track(first.ctrl), undefined, 'admin-1')
      emitGlobal('message:received', { userId: 'admin-1', textLength: 5 })
      expect(stats.totalMessages).toBe(1)

      resetCollectorForTest()

      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl), undefined, 'admin-1')
      expect(enqueueMock).toHaveBeenCalledTimes(1)

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 600)
      })

      expect(getAllSseEvents(enqueueMock).map((e) => e.event)).toEqual(['state:init'])
    })
  })
})
