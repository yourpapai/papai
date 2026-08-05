// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { type DebugEvent, subscribe, unsubscribe } from '../src/debug/event-bus.js'
import {
  handleToolCallStart,
  handleToolCallFinishEvent,
  buildToolCallFinishHandler,
  buildToolCallStartHandler,
} from '../src/llm-orchestrator-tool-events.js'
import type { ToolCallContext } from '../src/llm-orchestrator-types.js'
import { buildToolFailureResult } from '../src/tool-failure.js'
import { buildPermissionDenied } from '../src/tools/permission-gate.js'
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

describe('analytics terminal ordering', () => {
  const collect = (fn: () => void): DebugEvent[] => {
    const collected: DebugEvent[] = []
    const listener = (event: DebugEvent): void => {
      collected.push(event)
    }
    subscribe(listener)
    try {
      fn()
    } finally {
      unsubscribe(listener)
    }
    return collected
  }

  const ofType = (collected: readonly DebugEvent[], type: string): DebugEvent[] =>
    collected.filter((event) => event.type === type)

  const lifecycle = (
    event: Parameters<typeof handleToolCallFinishEvent>[1],
  ): { ctx: ToolCallContext; collected: DebugEvent[] } => {
    const ctx = baseContext()
    const collected = collect(() => {
      handleToolCallStart(ctx, { toolCall: { toolName: 'get_task', toolCallId: 'tc1', input: { id: 't1' } } })
      handleToolCallFinishEvent(ctx, event)
    })
    return { ctx, collected }
  }

  const successEvent = (output: unknown): Parameters<typeof handleToolCallFinishEvent>[1] => ({
    toolCall: { toolName: 'get_task', toolCallId: 'tc1', input: { id: 't1' } },
    durationMs: 42,
    success: true,
    output,
  })

  beforeEach(() => {
    mockLogger()
  })

  test('immediate success emits exactly one content-free terminal after execute_end with the lifecycle source id', () => {
    const { collected } = lifecycle(successEvent({ title: 'done' }))
    const terminals = ofType(collected, 'tool:analytics_completed')
    expect(terminals).toHaveLength(1)
    expect(ofType(collected, 'tool:failure_classified')).toHaveLength(0)
    const types = collected.map((event) => event.type)
    expect(types.indexOf('tool:execute_end')).toBeLessThan(types.indexOf('tool:analytics_completed'))
    const terminal = terminals[0]!
    expect(terminal.data['executionOutcome']).toBe('semantic_success')
    expect(terminal.data['errorClass']).toBeNull()
    expect(terminal.data['statusClass']).toBe('none')
    expect(terminal.data['recoveredSameTurn']).toBe(false)
    // Content-free: no output/result payload, no error text, no args.
    expect(terminal.data['output']).toBeUndefined()
    expect(terminal.data['error']).toBeUndefined()
    expect(terminal.data['input']).toBeUndefined()
    expect(JSON.stringify(terminal.data)).not.toContain('done')
    const request = ofType(collected, 'tool:request')[0]!
    expect(terminal.data['analyticsSourceId']).toBe(request.data['analyticsSourceId'])
    expect(typeof terminal.data['analyticsSourceId']).toBe('string')
  })

  test('thrown failure emits one failure classification followed by one thrown_failure terminal', () => {
    const { collected } = lifecycle({
      toolCall: { toolName: 'get_task', toolCallId: 'tc1', input: {} },
      durationMs: 7,
      success: false,
      error: new Error('boom'),
    })
    expect(ofType(collected, 'tool:failure_classified')).toHaveLength(1)
    const terminals = ofType(collected, 'tool:analytics_completed')
    expect(terminals).toHaveLength(1)
    const types = collected.map((event) => event.type)
    expect(types.indexOf('tool:failure_classified')).toBeLessThan(types.indexOf('tool:analytics_completed'))
    expect(terminals[0]!.data['executionOutcome']).toBe('thrown_failure')
    expect(terminals[0]!.data['resultBytes']).toBe(0)
    expect(typeof terminals[0]!.data['errorClass']).toBe('string')
    expect(JSON.stringify(terminals[0]!.data)).not.toContain('boom')
  })

  test('SDK-successful structured failure is never semantic success', () => {
    const failure = buildToolFailureResult(new Error('provider down'), 'get_task', 'tc1')
    const { collected } = lifecycle(successEvent(failure))
    expect(ofType(collected, 'tool:failure_classified')).toHaveLength(1)
    const terminals = ofType(collected, 'tool:analytics_completed')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]!.data['executionOutcome']).toBe('structured_failure')
    expect(terminals[0]!.data['executionOutcome']).not.toBe('semantic_success')
    expect(terminals[0]!.data['errorClass']).not.toBeNull()
  })

  test('permission denial resolves to the permission_denied terminal', () => {
    const { collected } = lifecycle(successEvent(buildPermissionDenied("User denied execution of 'get_task'.")))
    const terminals = ofType(collected, 'tool:analytics_completed')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]!.data['executionOutcome']).toBe('permission_denied')
    expect(JSON.stringify(terminals[0]!.data)).not.toContain('User denied')
  })

  test('repeated finish callbacks for the same lifecycle keep exactly one terminal', () => {
    const ctx = baseContext()
    const collected = collect(() => {
      const event = successEvent({ title: 'done' })
      handleToolCallStart(ctx, { toolCall: { toolName: 'get_task', toolCallId: 'tc1', input: { id: 't1' } } })
      handleToolCallFinishEvent(ctx, event)
      handleToolCallFinishEvent(ctx, event)
      handleToolCallFinishEvent(ctx, event)
    })
    expect(ofType(collected, 'tool:analytics_completed')).toHaveLength(1)
    expect(ofType(collected, 'tool:execute_end')).toHaveLength(3)
  })

  test('start and terminal retain identical tool identity fields', () => {
    const { collected } = lifecycle(successEvent({ title: 'done' }))
    const request = ofType(collected, 'tool:request')[0]!
    const terminal = ofType(collected, 'tool:analytics_completed')[0]!
    expect(terminal.data['toolName']).toBe(request.data['toolName'])
    expect(terminal.data['toolCallId']).toBe(request.data['toolCallId'])
    expect(terminal.data['modelRole']).toBe(request.data['modelRole'])
    expect(terminal.data['argsBytes']).toBe(request.data['argsBytes'])
  })

  test('analytics terminal rounds float durationMs; execute_end keeps the raw value', () => {
    const { collected } = lifecycle({ ...successEvent({ title: 'done' }), durationMs: 42.4 })
    const terminal = ofType(collected, 'tool:analytics_completed')[0]!
    expect(terminal.data['durationMs']).toBe(42)
    const executeEnd = ofType(collected, 'tool:execute_end')[0]!
    expect(executeEnd.data['durationMs']).toBe(42.4)
  })

  test('analytics terminal clamps negative durationMs to zero', () => {
    const { collected } = lifecycle({ ...successEvent({ title: 'done' }), durationMs: -3 })
    const terminal = ofType(collected, 'tool:analytics_completed')[0]!
    expect(terminal.data['durationMs']).toBe(0)
  })
})
