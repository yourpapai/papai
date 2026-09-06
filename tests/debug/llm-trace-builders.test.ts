// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildEndTrace,
  buildErrorTrace,
  buildTraceToolCall,
  resolveModel,
  resolveToolCalls,
  type PendingLlmTrace,
  type TraceEvent,
} from '../../src/debug/llm-trace-builders.js'

const userScope = { kind: 'user' as const, userId: 'u:1' }

const event = (data: Record<string, unknown>, timestamp = 5): TraceEvent => ({
  type: 'llm:end',
  timestamp,
  scope: userScope,
  data,
})

const pending = (overrides: Partial<PendingLlmTrace> = {}): PendingLlmTrace => ({
  startTimestamp: 1,
  userId: 'u:1',
  model: 'm-pending',
  toolCalls: [],
  turnId: undefined,
  ...overrides,
})

describe('buildTraceToolCall', () => {
  test('maps a full tool-call payload onto the trace shape', () => {
    expect(
      buildTraceToolCall({
        toolName: 'get_task',
        durationMs: 5,
        success: true,
        toolCallId: 'c1',
        args: { id: 'TK-1' },
        result: { ok: true },
        error: 'boom',
      }),
    ).toEqual({
      toolName: 'get_task',
      durationMs: 5,
      success: true,
      toolCallId: 'c1',
      args: { id: 'TK-1' },
      result: { ok: true },
      error: 'boom',
    })
  })

  test('coerces absent or wrong-typed fields to their zero values', () => {
    expect(buildTraceToolCall({ toolName: 7, durationMs: 'fast', success: 'yes' })).toEqual({
      toolName: '',
      durationMs: 0,
      success: false,
      toolCallId: '',
      args: undefined,
      result: undefined,
      error: '',
    })
  })
})

describe('resolveModel', () => {
  test('prefers the pending model over the event payload', () => {
    expect(resolveModel(pending(), { model: 'm-event' })).toBe('m-pending')
  })

  test('falls back to the event model when no pending matched, empty string when absent', () => {
    expect(resolveModel(undefined, { model: 'm-event' })).toBe('m-event')
    expect(resolveModel(undefined, {})).toBe('')
  })
})

describe('resolveToolCalls', () => {
  test('returns the pending tool calls, or an empty list without a pending', () => {
    const calls = [
      {
        toolName: 'get_task',
        durationMs: 1,
        success: true,
        toolCallId: 'c1',
        args: {},
        result: undefined,
        error: undefined,
      },
    ]
    expect(resolveToolCalls(pending({ toolCalls: calls }))).toEqual(calls)
    expect(resolveToolCalls(undefined)).toEqual([])
  })
})

describe('buildEndTrace', () => {
  test('maps a complete end event onto the trace, pending model wins', () => {
    const trace = buildEndTrace(
      event(
        {
          chatUserId: '4242',
          steps: 3,
          tokenUsage: { inputTokens: 10, outputTokens: 2 },
          totalDuration: 42,
          responseId: 'resp-1',
          actualModel: 'm-actual',
          finishReason: 'stop',
          messageCount: 5,
          toolCount: 2,
          exposedToolCount: 2,
          fullToolCount: 3,
          toolSchemaBytes: 2048,
          routingIntent: 'chat',
          routingConfidence: 0.5,
          routingReason: 'classifier',
          generatedText: 'Done.',
          stepsDetail: [{ stepNumber: 1 }],
          currentTimeTag: '2026-09-06 12:00',
        },
        7,
      ),
      'u:1',
      pending({ model: 'm-pending' }),
    )
    expect(trace.timestamp).toBe(7)
    expect(trace.userId).toBe('u:1')
    expect(trace.chatUserId).toBe('4242')
    expect(trace.model).toBe('m-pending')
    expect(trace.steps).toBe(3)
    expect(trace.totalTokens).toEqual({ inputTokens: 10, outputTokens: 2 })
    expect(trace.duration).toBe(42)
    expect(trace.toolCalls).toEqual([])
    expect(trace.error).toBeUndefined()
    expect(trace.responseId).toBe('resp-1')
    expect(trace.actualModel).toBe('m-actual')
    expect(trace.finishReason).toBe('stop')
    expect(trace.messageCount).toBe(5)
    expect(trace.toolCount).toBe(2)
    expect(trace.exposedToolCount).toBe(2)
    expect(trace.fullToolCount).toBe(3)
    expect(trace.toolSchemaBytes).toBe(2048)
    expect(trace.routingIntent).toBe('chat')
    expect(trace.routingConfidence).toBe(0.5)
    expect(trace.routingReason).toBe('classifier')
    expect(trace.generatedText).toBe('Done.')
    expect(trace.stepsDetail).toHaveLength(1)
    expect(trace.currentTimeTag).toBe('2026-09-06 12:00')
  })

  test('zero-fills absent fields and takes the model from the event without a pending', () => {
    const trace = buildEndTrace(event({ model: 'm-event' }, 3), 'u:2', undefined)
    expect(trace.model).toBe('m-event')
    expect(trace.steps).toBe(0)
    expect(trace.totalTokens).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(trace.duration).toBe(0)
    expect(trace.toolCalls).toEqual([])
    expect(trace.chatUserId).toBeUndefined()
    expect(trace.responseId).toBe('')
    expect(trace.generatedText).toBe('')
    expect(trace.stepsDetail).toBeUndefined()
    expect(trace.currentTimeTag).toBeUndefined()
  })
})

describe('buildErrorTrace', () => {
  test('builds an error trace with duration measured from the pending start', () => {
    const trace = buildErrorTrace(event({ error: 'boom', model: 'm' }, 6), 'u:1', pending({ startTimestamp: 2 }))
    expect(trace.error).toBe('boom')
    expect(trace.duration).toBe(4)
    expect(trace.model).toBe('m-pending')
    expect(trace.steps).toBe(0)
    expect(trace.totalTokens).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(trace.toolCalls).toEqual([])
    expect(trace.responseId).toBeUndefined()
    expect(trace.finishReason).toBeUndefined()
    expect(trace.generatedText).toBeUndefined()
    expect(trace.stepsDetail).toBeUndefined()
  })

  test('duration is 0 without a pending', () => {
    expect(buildErrorTrace(event({ error: 'boom' }, 6), 'u:1', undefined).duration).toBe(0)
  })
})
