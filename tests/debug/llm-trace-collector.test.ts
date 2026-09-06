// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Scope } from '../../src/debug/event-bus.js'
import {
  handleLlmTraceEvent,
  pendingTraces,
  pushTrace,
  recentLlm,
  resetLlmBuffers,
  shapeLlmTrace,
  LLM_TRACE_CAPACITY,
  type LlmTrace,
} from '../../src/debug/llm-trace-collector.js'

const userScope = (userId: string): Scope => ({ kind: 'user', userId })

const callbacks = (pushed: LlmTrace[]): { pushTrace: (t: LlmTrace) => void; broadcastTrace: () => void } => ({
  pushTrace: (t: LlmTrace): void => {
    pushed.push(t)
  },
  broadcastTrace: (): void => {},
})

const outcomeOf = (trace: LlmTrace): unknown => {
  const record: Record<string, unknown> = trace
  return record['verifierOutcome']
}

const recordingCallbacks = (
  pushed: LlmTrace[],
  broadcasts: Array<{ trace: LlmTrace; ts: number }>,
): { pushTrace: (t: LlmTrace) => void; broadcastTrace: (t: LlmTrace, ts: number) => void } => ({
  pushTrace: (t: LlmTrace): void => {
    pushed.push(t)
  },
  broadcastTrace: (t: LlmTrace, ts: number): void => {
    broadcasts.push({ trace: t, ts })
  },
})

describe('handleLlmTraceEvent', () => {
  let pushed: LlmTrace[]
  let stats: { totalLlmCalls: number; totalToolCalls: number }

  beforeEach(() => {
    pushed = []
    stats = { totalLlmCalls: 0, totalToolCalls: 0 }
    resetLlmBuffers()
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

  test('llm:end chatUserId payload overrides the storage-context scope key as trace userId', () => {
    const storageContextId = 'pi:cGk:ctx:Y2hhdA'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(storageContextId), data: { model: 'm' } },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 2,
        scope: userScope(storageContextId),
        data: { chatUserId: '4242', model: 'm', steps: 1, tokenUsage: { inputTokens: 1, outputTokens: 1 } },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:error',
        timestamp: 3,
        scope: userScope(storageContextId),
        data: { chatUserId: '4242', model: 'm', error: 'boom' },
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(pushed[0]!.userId).toBe('4242')
    expect(pushed[1]!.userId).toBe('4242')
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

  test('concurrent generations in one context consume their own turn pendings', () => {
    const ctx = 'u:dm'
    handleLlmTraceEvent(
      {
        type: 'llm:start',
        timestamp: 1,
        scope: userScope(ctx),
        data: { model: 'm-interactive' },
        turnId: 'turn-interactive',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:start',
        timestamp: 2,
        scope: userScope(ctx),
        data: { model: 'm-proactive' },
        turnId: 'proactive:u:dm:1',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:tool_result',
        timestamp: 3,
        scope: userScope(ctx),
        data: { toolName: 'get_task', toolCallId: 'c1', durationMs: 5, success: true },
        turnId: 'turn-interactive',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 4,
        scope: userScope(ctx),
        data: { model: 'm-proactive' },
        turnId: 'proactive:u:dm:1',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 5,
        scope: userScope(ctx),
        data: { model: 'm-interactive' },
        turnId: 'turn-interactive',
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(pushed[0]!.model).toBe('m-proactive')
    expect(pushed[0]!.toolCalls).toHaveLength(0)
    expect(pushed[1]!.model).toBe('m-interactive')
    expect(pushed[1]!.toolCalls.map((call) => call.toolName)).toEqual(['get_task'])
    expect(pendingTraces.size).toBe(0)
  })

  test('llm:error consumes only its own turn pending under concurrency', () => {
    const ctx = 'u:err'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 2, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:error',
        timestamp: 5,
        scope: userScope(ctx),
        data: { model: 'm-a', error: 'boom' },
        turnId: 'turn-a',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 6, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(pushed[0]!.model).toBe('m-a')
    expect(pushed[0]!.duration).toBe(4)
    expect(pushed[1]!.model).toBe('m-b')
    expect(pendingTraces.size).toBe(0)
  })

  test('llm:end with an unmatched turnId consumes nothing', () => {
    const ctx = 'u:miss'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 2, scope: userScope(ctx), data: { model: 'm-x' }, turnId: 'turn-unknown' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 3, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(pushed[0]!.model).toBe('m-x')
    expect(pushed[1]!.model).toBe('m-a')
    expect(pendingTraces.size).toBe(0)
  })

  test('per-user pendings stay bounded when terminal events never arrive', () => {
    const ctx = 'u:cap'
    for (let i = 0; i < 6; i++) {
      handleLlmTraceEvent(
        { type: 'llm:start', timestamp: i, scope: userScope(ctx), data: { model: `m-${i}` }, turnId: `turn-${i}` },
        callbacks(pushed),
        stats,
        () => {},
      )
    }

    expect(pendingTraces.size).toBe(4)

    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 9, scope: userScope(ctx), data: { model: 'm-5' }, turnId: 'turn-5' },
      callbacks(pushed),
      stats,
      () => {},
    )
    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.model).toBe('m-5')
  })

  test('turn-less end with ambiguous pendings consumes nothing', () => {
    const ctx = 'u:legacy'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 2, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 3, scope: userScope(ctx), data: { model: 'm-x' } },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.model).toBe('m-x')
    expect(pendingTraces.size).toBe(2)

    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 4, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    expect(pendingTraces.size).toBe(1)
  })

  test('turn-less tool_result attaches to the most recent pending for the user', () => {
    const ctx = 'u:legacy-tool'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 2, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:tool_result',
        timestamp: 3,
        scope: userScope(ctx),
        data: { toolName: 'ta', toolCallId: 'x', durationMs: 1, success: true },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 4, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 5, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(pushed[0]!.toolCalls.map((call) => call.toolName)).toEqual(['ta'])
    expect(pushed[1]!.toolCalls).toHaveLength(0)
  })

  test('llm:verifier with a turnId applies the outcome to exactly that turn trace', () => {
    const ctx = 'u:verifier-exact'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 2, scope: userScope(ctx), data: {}, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 3, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 4, scope: userScope(ctx), data: {}, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )

    handleLlmTraceEvent(
      {
        type: 'llm:verifier',
        timestamp: 5,
        scope: userScope(ctx),
        data: { verifierOutcome: 'empty' },
        turnId: 'turn-a',
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(outcomeOf(pushed[0]!)).toBe('empty')
    expect(outcomeOf(pushed[1]!)).toBeUndefined()
  })

  test('turn-less llm:verifier attaches to the most recent trace for the user', () => {
    const ctx = 'u:verifier-legacy'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 2, scope: userScope(ctx), data: {}, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 3, scope: userScope(ctx), data: { model: 'm-b' }, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 4, scope: userScope(ctx), data: {}, turnId: 'turn-b' },
      callbacks(pushed),
      stats,
      () => {},
    )

    handleLlmTraceEvent(
      { type: 'llm:verifier', timestamp: 5, scope: userScope(ctx), data: { verifierOutcome: 'error' } },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(2)
    expect(outcomeOf(pushed[1]!)).toBe('error')
    expect(outcomeOf(pushed[0]!)).toBeUndefined()
  })

  test('the verifier trace registry prunes per user, so pruned turns no longer attach', () => {
    const ctx = 'u:verifier-cap'
    for (let i = 0; i < 6; i++) {
      handleLlmTraceEvent(
        { type: 'llm:start', timestamp: i, scope: userScope(ctx), data: { model: `m-${i}` }, turnId: `turn-${i}` },
        callbacks(pushed),
        stats,
        () => {},
      )
      handleLlmTraceEvent(
        { type: 'llm:end', timestamp: 10 + i, scope: userScope(ctx), data: {}, turnId: `turn-${i}` },
        callbacks(pushed),
        stats,
        () => {},
      )
    }

    handleLlmTraceEvent(
      {
        type: 'llm:verifier',
        timestamp: 100,
        scope: userScope(ctx),
        data: { verifierOutcome: 'empty' },
        turnId: 'turn-0',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    expect(outcomeOf(pushed[0]!)).toBeUndefined()

    handleLlmTraceEvent(
      {
        type: 'llm:verifier',
        timestamp: 101,
        scope: userScope(ctx),
        data: { verifierOutcome: 'ok' },
        turnId: 'turn-5',
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    expect(outcomeOf(pushed[5]!)).toBe('ok')
  })

  test('llm:verifier re-broadcasts the updated trace in place', () => {
    const ctx = 'u:verifier-broadcast'
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope(ctx), data: { model: 'm-a' }, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 2, scope: userScope(ctx), data: {}, turnId: 'turn-a' },
      callbacks(pushed),
      stats,
      () => {},
    )

    const broadcasts: Array<{ trace: LlmTrace; ts: number }> = []
    handleLlmTraceEvent(
      {
        type: 'llm:verifier',
        timestamp: 9,
        scope: userScope(ctx),
        data: { verifierOutcome: 'ok' },
        turnId: 'turn-a',
      },
      recordingCallbacks(pushed, broadcasts),
      stats,
      () => {},
    )

    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]!.trace).toBe(pushed[0]!)
    expect(outcomeOf(broadcasts[0]!.trace)).toBe('ok')
    expect(broadcasts[0]!.ts).toBe(9)
  })

  test('resetLlmBuffers clears both captured traces and pending traces after capture', () => {
    pushTrace({
      timestamp: 1,
      userId: 'u',
      chatUserId: undefined,
      model: 'm',
      steps: 1,
      totalTokens: { inputTokens: 1, outputTokens: 1 },
      duration: 2,
      toolCalls: [],
      error: undefined,
      responseId: undefined,
      actualModel: undefined,
      finishReason: undefined,
      messageCount: undefined,
      toolCount: undefined,
      exposedToolCount: undefined,
      fullToolCount: undefined,
      toolSchemaBytes: undefined,
      routingIntent: undefined,
      routingConfidence: undefined,
      routingReason: undefined,
      generatedText: undefined,
      stepsDetail: undefined,
    })
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 5, scope: userScope('pending-user'), data: { model: 'm' } },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(recentLlm).toHaveLength(1)
    expect(pendingTraces.size).toBe(1)

    resetLlmBuffers()

    expect(recentLlm).toHaveLength(0)
    expect(pendingTraces.size).toBe(0)
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

  test('llm:end copies data.currentTimeTag onto the trace', () => {
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('u6'), data: { model: 'm' } },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 2,
        scope: userScope('u6'),
        data: { currentTimeTag: '2026-05-25 09:30 (Monday)' },
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed[0]!.currentTimeTag).toBe('2026-05-25 09:30 (Monday)')
  })

  test('llm:end without a captured tag leaves trace currentTimeTag undefined', () => {
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('u7'), data: { model: 'm' } },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 2, scope: userScope('u7'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed[0]!.currentTimeTag).toBeUndefined()
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

  test('non-own trace drops identity, generatedText, stepsDetail and toolCall args/result, keeps the rest', () => {
    const shaped = shapeLlmTrace(makeTrace(), 'chat-2')

    expect(shaped.userId).toBeUndefined()
    expect(shaped.chatUserId).toBeUndefined()
    expect(shaped).toEqual({
      timestamp: 10,
      userId: undefined,
      chatUserId: undefined,
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

describe('buffer capacity exports', () => {
  test('LLM_TRACE_CAPACITY equals the recentLlm ring buffer capacity', () => {
    expect(LLM_TRACE_CAPACITY).toBe(65535)
  })
})
