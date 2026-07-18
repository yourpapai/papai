// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { type DebugEvent, subscribe, unsubscribe } from '../src/debug/event-bus.js'
import { buildToolCallFinishHandler, buildToolCallStartHandler } from '../src/llm-orchestrator-tool-events.js'
import type { ToolCallContext } from '../src/llm-orchestrator-types.js'
import { mockLogger } from './utils/test-helpers.js'

const baseContext = (): ToolCallContext => ({
  contextId: 'ctx-1',
  chatUserId: 'user-1',
  contextType: 'dm',
  model: 'main-model',
  modelRole: 'main',
  turnId: 'turn-1',
  progressReporter: undefined,
  liveStatus: undefined,
})

// Minimal AI SDK v7 ToolExecutionEndEvent shape (only the fields the adapter reads).
function v7EndEvent(
  toolName: string,
  output: unknown,
): Parameters<NonNullable<ReturnType<typeof buildToolCallFinishHandler>>>[0] {
  return {
    callId: 'call-1',
    toolExecutionMs: 42,
    messages: [],
    toolCall: { type: 'tool-call', toolName, toolCallId: 'tc1', input: { a: 1 }, dynamic: true },
    toolContext: undefined,
    toolOutput: { type: 'tool-result', toolCallId: 'tc1', toolName, input: { a: 1 }, output, dynamic: true },
  }
}

function v7ErrorEvent(
  toolName: string,
  error: unknown,
): Parameters<NonNullable<ReturnType<typeof buildToolCallFinishHandler>>>[0] {
  return {
    callId: 'call-1',
    toolExecutionMs: 7,
    messages: [],
    toolCall: { type: 'tool-call', toolName, toolCallId: 'tc1', input: {}, dynamic: true },
    toolContext: undefined,
    toolOutput: { type: 'tool-error', toolCallId: 'tc1', toolName, input: {}, error, dynamic: true },
  }
}

describe('tool-event handlers (AI SDK v7 adapters)', () => {
  let events: DebugEvent[]

  beforeEach(() => {
    mockLogger()
    events = []
  })

  test('buildToolCallStartHandler maps the v7 start event onto a tool:request debug event', () => {
    const handler = buildToolCallStartHandler(baseContext())
    const listener = (event: DebugEvent): void => {
      events.push(event)
    }
    subscribe(listener)
    try {
      handler?.({
        callId: 'call-1',
        messages: [],
        toolCall: { type: 'tool-call', toolName: 'get_task', toolCallId: 'tc1', input: { id: 't1' }, dynamic: true },
        toolContext: undefined,
      })
    } finally {
      unsubscribe(listener)
    }
    const request = events.find((e) => e.type === 'tool:request')
    expect(request).toBeDefined()
    expect(request?.data).toMatchObject({ toolName: 'get_task', toolCallId: 'tc1' })
  })

  test('buildToolCallFinishHandler maps a successful v7 end event (toolExecutionMs -> durationMs, success=true)', () => {
    const handler = buildToolCallFinishHandler(baseContext())
    const listener = (event: DebugEvent): void => {
      events.push(event)
    }
    subscribe(listener)
    try {
      handler?.(v7EndEvent('get_task', { title: 'done' }))
    } finally {
      unsubscribe(listener)
    }
    const end = events.find((e) => e.type === 'tool:execute_end')
    expect(end?.data).toMatchObject({ toolName: 'get_task', success: true, durationMs: 42 })
  })

  test('buildToolCallFinishHandler maps a tool-error v7 end event to success=false', () => {
    const handler = buildToolCallFinishHandler(baseContext())
    const listener = (event: DebugEvent): void => {
      events.push(event)
    }
    subscribe(listener)
    try {
      handler?.(v7ErrorEvent('get_task', new Error('boom')))
    } finally {
      unsubscribe(listener)
    }
    const end = events.find((e) => e.type === 'tool:execute_end')
    expect(end?.data).toMatchObject({ toolName: 'get_task', success: false, durationMs: 7 })
  })
})
