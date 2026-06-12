// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TraceScriptStep } from './fixture-types.js'
import { buildScriptedTrace, classifyFinalReply } from './scripted-model.js'

describe('buildScriptedTrace', () => {
  test('extracts tool call sequence and final assistant text', () => {
    const script: readonly TraceScriptStep[] = [
      {
        type: 'tool_call',
        toolName: 'create_task',
        toolCallId: 'call-1',
        input: { title: 'Ship it' },
        output: { id: 't1' },
      },
      { type: 'assistant_text', text: 'Created [Ship it](https://example.test/t1).' },
    ]

    const trace = buildScriptedTrace(script)

    expect(trace.toolCalls.map((call) => call.toolName)).toEqual(['create_task'])
    expect(trace.finalText).toBe('Created [Ship it](https://example.test/t1).')
  })
})

describe('classifyFinalReply', () => {
  test('classifies clarification questions', () => {
    expect(classifyFinalReply('I found two matching tasks. Which one?')).toBe('asks_clarification')
  })

  test('classifies confirmation questions', () => {
    expect(classifyFinalReply('Delete "Auth bug"? This is permanent.')).toBe('asks_confirmation')
  })

  test('classifies cannot-do-that refusals as unsafe declines', () => {
    expect(classifyFinalReply('I cannot do that because it is unsafe.')).toBe('declines_unsafe_action')
  })
})
