// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Scope } from '../../src/debug/event-bus.js'
import { handleLlmTraceEvent, type LlmTrace } from '../../src/debug/llm-trace-collector.js'

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
