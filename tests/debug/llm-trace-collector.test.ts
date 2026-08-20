// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Scope } from '../../src/debug/event-bus.js'
import {
  handleLlmTraceEvent,
  pendingTraces,
  shapeLlmTrace,
  type LlmTrace,
} from '../../src/debug/llm-trace-collector.js'

const userScope = (userId: string): Scope => ({ kind: 'user', userId })

const callbacks = (pushed: LlmTrace[]): { pushTrace: (t: LlmTrace) => void; broadcastTrace: () => void } => ({
  pushTrace: (t: LlmTrace): void => {
    pushed.push(t)
  },
  broadcastTrace: (): void => {},
})

describe('handleLlmTraceEvent', () => {
  let pushed: LlmTrace[]
  let stats: { totalLlmCalls: number; totalToolCalls: number }

  beforeEach(() => {
    pushed = []
    stats = { totalLlmCalls: 0, totalToolCalls: 0 }
    pendingTraces.clear()
  })

  test('accumulates tool calls and userId from scope across start/tool_result/end', () => {
    const ctx = 'u:42'
    handleLlmTraceEvent(
      {
        type: 'llm:start',
        timestamp: 1,
        scope: userScope(ctx),
        data: { model: 'm' },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:tool_result',
        timestamp: 2,
        scope: userScope(ctx),
        data: {
          toolName: 'get_task',
          toolCallId: 'c1',
          durationMs: 5,
          success: true,
        },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 3,
        scope: userScope(ctx),
        data: { tokenUsage: { inputTokens: 10, outputTokens: 2 }, steps: 1 },
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.userId).toBe(ctx)
    expect(pushed[0]!.toolCalls).toHaveLength(1)
    expect(pushed[0]!.toolCalls[0]!.toolName).toBe('get_task')
    expect(stats.totalToolCalls).toBe(1)
  })

  test('concurrent contexts keep separate pending traces', () => {
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('a'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('b'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:tool_result',
        timestamp: 2,
        scope: userScope('a'),
        data: { toolName: 'ta', toolCallId: 'x', durationMs: 1, success: true },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 3, scope: userScope('b'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.userId).toBe('b')
    expect(pushed[0]!.toolCalls).toHaveLength(0)
  })
})

describe('chatUserId attribution', () => {
  let pushed: LlmTrace[]
  let stats: { totalLlmCalls: number; totalToolCalls: number }

  beforeEach(() => {
    pushed = []
    stats = { totalLlmCalls: 0, totalToolCalls: 0 }
    pendingTraces.clear()
  })

  test('llm:end copies data.chatUserId onto the trace', () => {
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('u1'), data: { model: 'm' } },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 2, scope: userScope('u1'), data: { chatUserId: 'chat-9' } },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.chatUserId).toBe('chat-9')
  })

  test('llm:error copies data.chatUserId onto the trace', () => {
    handleLlmTraceEvent(
      { type: 'llm:error', timestamp: 1, scope: userScope('u2'), data: { error: 'boom', chatUserId: 'chat-7' } },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.chatUserId).toBe('chat-7')
  })

  test('llm:end without data.chatUserId leaves trace chatUserId undefined', () => {
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 1, scope: userScope('u3'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed[0]!.chatUserId).toBeUndefined()
  })

  test('legacy end-trace shape is unchanged when chatUserId is absent', () => {
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('u4'), data: { model: 'm2' } },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 5,
        scope: userScope('u4'),
        data: { tokenUsage: { inputTokens: 3, outputTokens: 1 }, steps: 2, totalDuration: 4 },
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    const trace = pushed[0]!
    expect(trace.userId).toBe('u4')
    expect(trace.model).toBe('m2')
    expect(trace.steps).toBe(2)
    expect(trace.totalTokens).toEqual({ inputTokens: 3, outputTokens: 1 })
    expect(trace.duration).toBe(4)
    expect(trace.error).toBeUndefined()
  })
})

describe('shapeLlmTrace', () => {
  const makeTrace = (overrides: Partial<LlmTrace> = {}): LlmTrace => ({
    timestamp: 10,
    userId: 'u:1',
    chatUserId: 'chat-1',
    model: 'gpt-x',
    steps: 2,
    totalTokens: { inputTokens: 10, outputTokens: 5 },
    duration: 42,
    toolCalls: [
      {
        toolName: 'get_task',
        durationMs: 5,
        success: true,
        toolCallId: 'c1',
        args: { query: 'secret query' },
        result: { tasks: [{ title: 'secret title' }] },
        error: undefined,
      },
      {
        toolName: 'create_task',
        durationMs: 7,
        success: false,
        toolCallId: 'c2',
        args: { title: 'secret title' },
        result: undefined,
        error: 'boom',
      },
    ],
    error: undefined,
    responseId: 'resp-1',
    actualModel: 'gpt-x-actual',
    finishReason: 'stop',
    messageCount: 3,
    toolCount: 2,
    exposedToolCount: 2,
    fullToolCount: 4,
    toolSchemaBytes: 2048,
    routingIntent: 'chat',
    routingConfidence: 0.5,
    routingReason: 'classifier',
    generatedText: 'secret answer',
    stepsDetail: [
      {
        stepNumber: 1,
        text: 'secret step text',
        toolCalls: [{ toolName: 'get_task', toolCallId: 'c1', args: { query: 'secret query' } }],
        usage: { inputTokens: 4, outputTokens: 2 },
      },
    ],
    ...overrides,
  })

  test('own trace passes verbatim', () => {
    const trace = makeTrace()

    expect(shapeLlmTrace(trace, 'chat-1')).toBe(trace)
  })

  test('non-own trace drops generatedText, stepsDetail and toolCall args/result, keeps the rest', () => {
    const shaped = shapeLlmTrace(makeTrace(), 'chat-2')

    expect(shaped).toEqual({
      timestamp: 10,
      userId: 'u:1',
      chatUserId: 'chat-1',
      model: 'gpt-x',
      steps: 2,
      totalTokens: { inputTokens: 10, outputTokens: 5 },
      duration: 42,
      toolCalls: [
        {
          toolName: 'get_task',
          durationMs: 5,
          success: true,
          toolCallId: 'c1',
          args: undefined,
          result: undefined,
          error: undefined,
        },
        {
          toolName: 'create_task',
          durationMs: 7,
          success: false,
          toolCallId: 'c2',
          args: undefined,
          result: undefined,
          error: 'boom',
        },
      ],
      error: undefined,
      responseId: 'resp-1',
      actualModel: 'gpt-x-actual',
      finishReason: 'stop',
      messageCount: 3,
      toolCount: 2,
      exposedToolCount: 2,
      fullToolCount: 4,
      toolSchemaBytes: 2048,
      routingIntent: 'chat',
      routingConfidence: 0.5,
      routingReason: 'classifier',
      generatedText: undefined,
      stepsDetail: undefined,
    })
  })

  test('unattributed trace is shaped even for a defined viewer', () => {
    const shaped = shapeLlmTrace(makeTrace({ chatUserId: undefined }), 'chat-2')

    expect(shaped.generatedText).toBeUndefined()
    expect(shaped.stepsDetail).toBeUndefined()
    expect(shaped.toolCalls[0]!.args).toBeUndefined()
  })

  test('shapes when no viewer is bound', () => {
    const shaped = shapeLlmTrace(makeTrace(), undefined)

    expect(shaped.generatedText).toBeUndefined()
  })

  test('does not mutate the input trace', () => {
    const trace = makeTrace()
    const snapshot = structuredClone(trace)

    shapeLlmTrace(trace, 'chat-2')

    expect(trace).toEqual(snapshot)
  })

  test('is idempotent on already-shaped traces', () => {
    const trace = makeTrace()

    const shapedOnce = shapeLlmTrace(trace, 'chat-2')
    const shapedTwice = shapeLlmTrace(shapedOnce, 'chat-2')

    expect(shapedTwice).toEqual(shapedOnce)
  })
})
