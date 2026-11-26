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

  test("places each step's delivered steering messages before that step's response messages", () => {
    const firstSteer = msg('user', 'only project X')
    const toolCall = msg('assistant', 'call create_task')
    const secondSteer = msg('user', 'and use tabs')
    const answer = msg('assistant', 'Done.')
    const result = {
      steps: [
        { experimental_steeringMessages: [firstSteer], response: { messages: [toolCall] } },
        { experimental_steeringMessages: [secondSteer], response: { messages: [answer] } },
      ],
      finalStep: { response: { messages: [answer] } },
    }

    expect(collectTurnMessages(result)).toEqual([firstSteer, toolCall, secondSteer, answer])
  })

  test('includes steering messages in the final-step fallback', () => {
    const steer = msg('user', 'only project X')
    const answer = msg('assistant', 'Done.')
    const result = {
      finalStep: { experimental_steeringMessages: [steer], response: { messages: [answer] } },
    }

    expect(collectTurnMessages(result)).toEqual([steer, answer])
  })

  test('keeps the current output when a result carries no steering field', () => {
    const toolCall = msg('assistant', 'call create_task')
    const answer = msg('assistant', 'Done.')
    const result = {
      steps: [{ response: { messages: [toolCall] } }, { response: { messages: [answer] } }],
      finalStep: { response: { messages: [answer] } },
    }

    expect(collectTurnMessages(result)).toEqual([toolCall, answer])
  })
})
