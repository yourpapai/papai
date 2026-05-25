// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { AiProgressReporter, ToolFinishedEvent, ToolStartedEvent } from '../src/ai-progress-reporter.js'
import { type DebugEvent, subscribe, unsubscribe } from '../src/debug/event-bus.js'
import { handleToolCallFinishEvent, handleToolCallStart, type ToolCallContext } from '../src/llm-orchestrator-invoke.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

const baseContext = (): ToolCallContext => ({
  contextId: 'ctx-1',
  chatUserId: 'user-1',
  contextType: 'dm',
  model: 'main-model',
  modelRole: 'main',
  turnId: 'turn-1',
})

function createReporterSpy(): {
  reporter: AiProgressReporter
  startedEvents: ToolStartedEvent[]
  finishedEvents: ToolFinishedEvent[]
} {
  const startedEvents: ToolStartedEvent[] = []
  const finishedEvents: ToolFinishedEvent[] = []
  return {
    startedEvents,
    finishedEvents,
    reporter: {
      toolStarted: (event) => {
        startedEvents.push(event)
      },
      toolFinished: (event) => {
        finishedEvents.push(event)
      },
      reasoning: () => {},
      flush: () => Promise.resolve(),
    },
  }
}

describe('handleToolCallStart', () => {
  const captured: DebugEvent[] = []
  const listener = (event: DebugEvent): void => {
    captured.push(event)
  }

  beforeEach(() => {
    mockLogger()
    captured.length = 0
    subscribe(listener)
  })

  afterEach(() => {
    unsubscribe(listener)
  })

  test('emits tool:request with chatUserId, contextType, model, modelRole, and argsBytes', () => {
    handleToolCallStart(baseContext(), {
      toolCall: {
        toolName: 'create_task',
        toolCallId: 'call-1',
        input: { title: 'hello', body: 'world' },
      },
    })

    const request = captured.find((e) => e.type === 'tool:request')
    expect(request).toBeDefined()
    expect(request?.data['toolName']).toBe('create_task')
    expect(request?.data['toolCallId']).toBe('call-1')
    expect(request?.data['chatUserId']).toBe('user-1')
    expect(request?.data['contextType']).toBe('dm')
    expect(request?.data['model']).toBe('main-model')
    expect(request?.data['modelRole']).toBe('main')
    expect(typeof request?.data['argsBytes']).toBe('number')
    expect(request?.data['argsBytes']).toBe(
      Buffer.byteLength(JSON.stringify({ title: 'hello', body: 'world' }), 'utf8'),
    )
  })

  test('does not leak raw args content into the event payload', () => {
    const secret = 'this-string-must-not-appear-in-the-event'

    handleToolCallStart(baseContext(), {
      toolCall: {
        toolName: 'create_task',
        toolCallId: 'call-2',
        input: { title: secret },
      },
    })

    const request = captured.find((e) => e.type === 'tool:request')
    expect(request).toBeDefined()
    const serialised = JSON.stringify(captured.map((e) => e.data))
    expect(serialised).not.toContain(secret)
  })

  test('forwards tool name, id, and input to progress reporter while preserving debug tool:request', () => {
    const { reporter, startedEvents } = createReporterSpy()
    const input = { query: 'x' }

    handleToolCallStart(
      { ...baseContext(), progressReporter: reporter },
      {
        toolCall: {
          toolName: 'search_tasks',
          toolCallId: 'call-start',
          input,
        },
      },
    )

    expect(startedEvents).toEqual([{ toolName: 'search_tasks', toolCallId: 'call-start', input }])
    expect(captured.some((e) => e.type === 'tool:request')).toBe(true)
  })
})

describe('handleToolCallFinishEvent', () => {
  const captured: DebugEvent[] = []
  const listener = (event: DebugEvent): void => {
    captured.push(event)
  }

  beforeEach(() => {
    mockLogger()
    captured.length = 0
    subscribe(listener)
  })

  afterEach(() => {
    unsubscribe(listener)
  })

  test('emits tool:execute_end with the full context envelope and resultBytes on success', () => {
    handleToolCallFinishEvent(baseContext(), {
      toolCall: {
        toolName: 'create_task',
        toolCallId: 'call-1',
        input: { title: 'hello' },
      },
      durationMs: 42,
      success: true,
      output: { id: 'task-1', title: 'hello' },
    })

    const execEnd = captured.find((e) => e.type === 'tool:execute_end')
    expect(execEnd).toBeDefined()
    expect(execEnd?.data['toolName']).toBe('create_task')
    expect(execEnd?.data['toolCallId']).toBe('call-1')
    expect(execEnd?.data['success']).toBe(true)
    expect(execEnd?.data['durationMs']).toBe(42)
    expect(execEnd?.data['chatUserId']).toBe('user-1')
    expect(execEnd?.data['contextType']).toBe('dm')
    expect(execEnd?.data['model']).toBe('main-model')
    expect(execEnd?.data['modelRole']).toBe('main')
    expect(typeof execEnd?.data['argsBytes']).toBe('number')
    expect(typeof execEnd?.data['resultBytes']).toBe('number')
  })

  test('resultBytes is null when the tool failed (success=false)', () => {
    handleToolCallFinishEvent(baseContext(), {
      toolCall: {
        toolName: 'search',
        toolCallId: 'call-2',
        input: { q: 'x' },
      },
      durationMs: 10,
      success: false,
      error: new Error('boom'),
    })

    const execEnd = captured.find((e) => e.type === 'tool:execute_end')
    expect(execEnd?.data['resultBytes']).toBeNull()
  })

  test('tool:failure_classified carries chatUserId and contextType', () => {
    handleToolCallFinishEvent(baseContext(), {
      toolCall: {
        toolName: 'search',
        toolCallId: 'call-3',
        input: { q: 'x' },
      },
      durationMs: 5,
      success: false,
      error: new Error('boom'),
    })

    const classified = captured.find((e) => e.type === 'tool:failure_classified')
    expect(classified).toBeDefined()
    expect(classified?.data['chatUserId']).toBe('user-1')
    expect(classified?.data['contextType']).toBe('dm')
    expect(classified?.data['model']).toBe('main-model')
    expect(classified?.data['modelRole']).toBe('main')
    expect(classified?.data['toolName']).toBe('search')
    expect(classified?.data['toolCallId']).toBe('call-3')
  })

  test('does not leak raw result content into the billing event payload', () => {
    const secretResult = 'sensitive-result-string-must-stay-out'

    handleToolCallFinishEvent(baseContext(), {
      toolCall: {
        toolName: 'create_task',
        toolCallId: 'call-4',
        input: { title: 'x' },
      },
      durationMs: 5,
      success: true,
      output: { secret: secretResult },
    })

    const billingEventTypes = new Set(['tool:execute_end', 'tool:request', 'tool:failure_classified'])
    const billingEvents = captured.filter((e) => billingEventTypes.has(e.type))
    const serialised = JSON.stringify(billingEvents.map((e) => e.data))
    expect(serialised).not.toContain(secretResult)
  })

  test('forwards tool finish details to progress reporter while preserving debug events', () => {
    const { reporter, finishedEvents } = createReporterSpy()
    const input = { query: 'x' }
    const output = { count: 2 }

    handleToolCallFinishEvent(
      { ...baseContext(), progressReporter: reporter },
      {
        toolCall: {
          toolName: 'search_tasks',
          toolCallId: 'call-finish',
          input,
        },
        durationMs: 9,
        success: true,
        output,
      },
    )

    expect(finishedEvents).toEqual([
      {
        toolName: 'search_tasks',
        toolCallId: 'call-finish',
        input,
        durationMs: 9,
        success: true,
        output,
        error: undefined,
      },
    ])
    expect(captured.some((e) => e.type === 'tool:execute_end')).toBe(true)
    expect(captured.some((e) => e.type === 'llm:tool_result')).toBe(true)
  })

  test('does not send legacy warning reply from hook handling while keeping llm:tool_result debug event', () => {
    const { reporter, finishedEvents } = createReporterSpy()
    const { textCalls } = createMockReply()
    const input = { query: 'x' }
    const error = new Error('boom')

    handleToolCallFinishEvent(
      { ...baseContext(), progressReporter: reporter },
      {
        toolCall: {
          toolName: 'search_tasks',
          toolCallId: 'call-warning',
          input,
        },
        durationMs: 11,
        success: false,
        error,
      },
    )

    expect(textCalls).toEqual([])
    expect(finishedEvents).toEqual([
      {
        toolName: 'search_tasks',
        toolCallId: 'call-warning',
        input,
        durationMs: 11,
        success: false,
        output: undefined,
        error,
      },
    ])
    expect(captured.some((e) => e.type === 'llm:tool_result')).toBe(true)
  })

  test('keeps debug failure events when progress reporter throws on tool finish', () => {
    const reporter: AiProgressReporter = {
      toolStarted: () => {},
      toolFinished: () => {
        throw new Error('reporter failed')
      },
      reasoning: () => {},
      flush: () => Promise.resolve(),
    }

    expect(() => {
      handleToolCallFinishEvent(
        { ...baseContext(), progressReporter: reporter },
        {
          toolCall: {
            toolName: 'search_tasks',
            toolCallId: 'call-reporter-fails',
            input: { query: 'x' },
          },
          durationMs: 13,
          success: false,
          error: new Error('tool failed'),
        },
      )
    }).not.toThrow()

    expect(captured.some((e) => e.type === 'tool:failure_classified')).toBe(true)
    expect(captured.some((e) => e.type === 'llm:tool_result')).toBe(true)
  })
})
