// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { collectTurnMessages } from '../src/llm-orchestrator-messages.js'

const msg = (role: 'assistant' | 'user', content: string): ModelMessage => ({ role, content })

describe('collectTurnMessages', () => {
  test('flattens every step so the full tool trace is preserved, not just the final answer', () => {
    const toolCall = msg('assistant', 'call create_task')
    const toolResult = msg('user', 'created task-1')
    const answer = msg('assistant', 'Created the task.')
    const result = {
      steps: [{ response: { messages: [toolCall, toolResult] } }, { response: { messages: [answer] } }],
      finalStep: { response: { messages: [answer] } },
    }

    expect(collectTurnMessages(result)).toEqual([toolCall, toolResult, answer])
  })

  test('falls back to the final step when no steps are present', () => {
    const answer = msg('assistant', 'Done.')
    const result = { finalStep: { response: { messages: [answer] } } }

    expect(collectTurnMessages(result)).toEqual([answer])
  })

  test('falls back to the final step when steps is empty', () => {
    const answer = msg('assistant', 'Done.')
    const result = { steps: [], finalStep: { response: { messages: [answer] } } }

    expect(collectTurnMessages(result)).toEqual([answer])
  })

  test('returns an empty list when neither steps nor a final step are present', () => {
    expect(collectTurnMessages({})).toEqual([])
  })

  test('tolerates steps that carry no response messages', () => {
    const answer = msg('assistant', 'Created tasks')
    const result = {
      steps: [{ toolCalls: [{ toolName: 'create_task' }] }, { response: { messages: [answer] } }],
      finalStep: { response: { messages: [answer] } },
    }

    expect(collectTurnMessages(result)).toEqual([answer])
  })
})
