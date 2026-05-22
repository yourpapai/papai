// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { type DebugEvent, subscribe, unsubscribe } from '../src/debug/event-bus.js'
import { handleToolCallFinishEvent, handleToolCallStart, type ToolCallContext } from '../src/llm-orchestrator-invoke.js'
import { mockLogger } from './utils/test-helpers.js'

const baseContext = (): ToolCallContext => ({
  contextId: 'ctx-1',
  chatUserId: 'user-1',
  contextType: 'dm',
  model: 'main-model',
  modelRole: 'main',
  turnId: 'turn-1',
})

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
    handleToolCallFinishEvent(baseContext(), undefined, {
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
    handleToolCallFinishEvent(baseContext(), undefined, {
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
    handleToolCallFinishEvent(baseContext(), undefined, {
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

    handleToolCallFinishEvent(baseContext(), undefined, {
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
})
