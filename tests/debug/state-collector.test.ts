import { afterEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { emit } from '../../src/debug/event-bus.js'
import { addClient, init, removeClient } from '../../src/debug/state-collector.js'
import { resetStats } from '../utils/test-helpers.js'

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
  return enqueueMock.mock.calls[0]?.[0]
}

function parseSseFromUnknown(chunk: unknown): { event: string; data: Record<string, unknown> } {
  const raw = new Uint8Array(chunk instanceof Uint8Array ? chunk : [])
  const text = new TextDecoder().decode(raw)
  const eventMatch = text.match(/^event: (.+)$/m)
  const dataMatch = text.match(/^data: (.+)$/m)
  const parsed: unknown = JSON.parse(dataMatch?.[1] ?? '{}')
  return {
    event: eventMatch?.[1] ?? '',
    data: isRecord(parsed) ? parsed : {},
  }
}

function getAllSseEvents(
  enqueueMock: MockController['enqueueMock'],
): Array<{ event: string; data: Record<string, unknown> }> {
  return enqueueMock.mock.calls.map((call) => parseSseFromUnknown(call[0]))
}

describe('state-collector', () => {
  const controllers: ReadableStreamDefaultController[] = []

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
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const { event, data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
    expect(event).toBe('state:init')
    expect(data['type']).toBe('state:init')
  })

  test('state:init contains all snapshot sections', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
    const initData = data['data']
    assert(isRecord(initData))
    expect(initData).toHaveProperty('sessions')
    expect(initData).toHaveProperty('wizards')
    expect(initData).toHaveProperty('scheduler')
    expect(initData).toHaveProperty('pollers')
    expect(initData).toHaveProperty('messageCache')
    expect(initData).toHaveProperty('stats')
    expect(initData).toHaveProperty('recentLlm')

    const stats = initData['stats']
    assert(isRecord(stats))
    expect(stats['totalMessages']).toBe(0)
    expect(stats['totalLlmCalls']).toBe(0)
    expect(stats['totalToolCalls']).toBe(0)
  })

  test('admin events are broadcast to clients', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('message:received', { userId: 'admin-1', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const events = getAllSseEvents(enqueueMock)
    expect(events[1]?.event).toBe('message:received')
  })

  test('non-admin user events are filtered out', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('message:received', { userId: 'other-user', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('global events (no userId) pass through unfiltered', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('scheduler:tick', { tickCount: 1, dueTaskCount: 0 })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const events = getAllSseEvents(enqueueMock)
    expect(events[1]?.event).toBe('scheduler:tick')
  })

  test('removeClient stops delivery to that client', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(ctrl)
    removeClient(ctrl)

    emit('message:received', { userId: 'admin-1', textLength: 5 })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('dead client (enqueue throws) is removed silently', () => {
    init('admin-1')
    const { ctrl, enqueueMock: badEnqueue } = createMockController()
    const { ctrl: goodCtrl, enqueueMock: goodEnqueue } = createMockController()
    addClient(track(ctrl))
    addClient(track(goodCtrl))

    badEnqueue.mockImplementation(() => {
      throw new Error('stream closed')
    })

    expect(() => emit('test:event', { userId: 'admin-1' })).not.toThrow()

    badEnqueue.mockImplementation(() => {})
    emit('test:after', { userId: 'admin-1' })

    expect(goodEnqueue).toHaveBeenCalledTimes(3)
  })

  describe('llm trace accumulation', () => {
    test('llm:end captures full trace data', () => {
      init('admin-1')
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl))

      emit('llm:start', { userId: 'admin-1', model: 'gpt-4', messageCount: 5, toolCount: 10 })
      emit('llm:tool_result', {
        userId: 'admin-1',
        toolName: 'create_task',
        toolCallId: 'call-1',
        durationMs: 500,
        success: true,
        args: { title: 'Test' },
        result: { id: 'task-1' },
      })
      emit('llm:end', {
        userId: 'admin-1',
        model: 'gpt-4',
        steps: 2,
        totalDuration: 2500,
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        responseId: 'resp-123',
        actualModel: 'gpt-4-0125-preview',
        finishReason: 'stop',
        messageCount: 5,
        toolCount: 10,
        generatedText: 'Task created successfully.',
      })

      const events = getAllSseEvents(enqueueMock)
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      expect(llmFullEvents.length).toBeGreaterThanOrEqual(1)

      const llmFull = llmFullEvents[llmFullEvents.length - 1]
      assert(isRecord(llmFull?.data))

      // The data field contains the event object, trace data is in data.data
      const eventData = llmFull.data['data']
      assert(isRecord(eventData))

      expect(eventData['responseId']).toBe('resp-123')
      expect(eventData['actualModel']).toBe('gpt-4-0125-preview')
      expect(eventData['finishReason']).toBe('stop')
      expect(eventData['messageCount']).toBe(5)
      expect(eventData['toolCount']).toBe(10)
      expect(eventData['generatedText']).toBe('Task created successfully.')

      const toolCalls: unknown = eventData['toolCalls']
      assert(Array.isArray(toolCalls))
      expect(toolCalls).toHaveLength(1)
      const firstToolCall: unknown = toolCalls[0]
      assert(isRecord(firstToolCall))
      expect(firstToolCall['toolCallId']).toBe('call-1')
      expect(firstToolCall['args']).toEqual({ title: 'Test' })
      expect(firstToolCall['result']).toEqual({ id: 'task-1' })
    })

    test('llm:tool_result captures error details', () => {
      init('admin-1')
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl))

      emit('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emit('llm:tool_result', {
        userId: 'admin-1',
        toolName: 'search_tasks',
        toolCallId: 'call-2',
        durationMs: 300,
        success: false,
        args: { query: 'invalid' },
        error: 'API error: 500',
      })
      emit('llm:end', {
        userId: 'admin-1',
        model: 'gpt-4',
        steps: 1,
        totalDuration: 1000,
        tokenUsage: { inputTokens: 50, outputTokens: 30 },
      })

      const events = getAllSseEvents(enqueueMock)
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      const llmFull = llmFullEvents[llmFullEvents.length - 1]

      assert(isRecord(llmFull?.data))
      const eventData = llmFull.data['data']
      assert(isRecord(eventData))
      const toolCalls: unknown = eventData['toolCalls']
      assert(Array.isArray(toolCalls))
      expect(toolCalls).toHaveLength(1)
      const firstToolCall: unknown = toolCalls[0]
      assert(isRecord(firstToolCall))
      expect(firstToolCall['success']).toBe(false)
      expect(firstToolCall['error']).toBe('API error: 500')
    })

    test('llm:end broadcasts stepsDetail with per-step info', () => {
      init('admin-1')
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl))

      emit('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emit('llm:end', {
        userId: 'admin-1',
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
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      const llmFull = llmFullEvents[llmFullEvents.length - 1]

      assert(isRecord(llmFull?.data))
      // The data field contains the event object, trace data is in data.data
      const eventData = llmFull.data['data']
      assert(isRecord(eventData))

      const stepsDetail: unknown = eventData['stepsDetail']
      assert(Array.isArray(stepsDetail))

      expect(stepsDetail).toHaveLength(2)
      const firstStep: unknown = stepsDetail[0]
      const secondStep: unknown = stepsDetail[1]
      assert(isRecord(firstStep))
      assert(isRecord(secondStep))
      expect(firstStep['stepNumber']).toBe(1)
      expect(secondStep['stepNumber']).toBe(2)
    })

    test('llm:error broadcasts an error trace with captured message', () => {
      init('admin-1')
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl))

      emit('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emit('llm:error', { userId: 'admin-1', model: 'gpt-4', error: 'boom' })

      const events = getAllSseEvents(enqueueMock)
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      const llmFull = llmFullEvents[llmFullEvents.length - 1]
      assert(isRecord(llmFull?.data), 'expected llm:full')
      const eventData = llmFull.data['data']
      assert(isRecord(eventData), 'expected trace data')
      expect(eventData['error']).toBe('boom')
      expect(eventData['model']).toBe('gpt-4')
      expect(eventData['steps']).toBe(0)
    })

    test('llm:error without prior llm:start still emits trace with zero duration', () => {
      init('admin-1')
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl))

      emit('llm:error', { userId: 'admin-1', model: 'gpt-4', error: 'crash' })

      const events = getAllSseEvents(enqueueMock)
      const llmFull = events.filter((e) => e.event === 'llm:full').pop()
      assert(isRecord(llmFull?.data), 'expected llm:full')
      const eventData = llmFull.data['data']
      assert(isRecord(eventData), 'expected trace data')
      expect(eventData['error']).toBe('crash')
      expect(eventData['duration']).toBe(0)
    })

    test('llm:end passes through text, finishReason, and inline tool result/error', () => {
      init('admin-1')
      const { ctrl, enqueueMock } = createMockController()
      addClient(track(ctrl))

      emit('llm:start', { userId: 'admin-1', model: 'gpt-4' })
      emit('llm:end', {
        userId: 'admin-1',
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
      const llmFullEvents = events.filter((e) => e.event === 'llm:full')
      const llmFull = llmFullEvents[llmFullEvents.length - 1]

      assert(isRecord(llmFull?.data))
      const eventData = llmFull.data['data']
      assert(isRecord(eventData))

      const stepsDetail: unknown = eventData['stepsDetail']
      assert(Array.isArray(stepsDetail))
      const first: unknown = stepsDetail[0]
      assert(isRecord(first))

      expect(first['text']).toBe('Calling the search tool now.')
      expect(first['finishReason']).toBe('tool-calls')

      const toolCalls: unknown = first['toolCalls']
      assert(Array.isArray(toolCalls))
      expect(toolCalls).toHaveLength(2)

      const tc0: unknown = toolCalls[0]
      const tc1: unknown = toolCalls[1]
      assert(isRecord(tc0))
      assert(isRecord(tc1))
      expect(tc0['result']).toEqual({ hits: 3 })
      expect(tc1['error']).toBe('permission denied')
    })
  })
})
