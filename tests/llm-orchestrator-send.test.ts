// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { sendLlmResponse } from '../src/llm-orchestrator-send.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

const baseResult = {
  text: undefined as string | undefined,
  finishReason: 'stop' as string | undefined,
  toolCalls: [] as unknown[],
  finalStep: { response: { messages: [] as ModelMessage[] } },
}

describe('sendLlmResponse verification wiring', () => {
  test('risky turn (empty text) invokes the verifier and delivers its text', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => {
          invoked += 1
          return Promise.resolve({ text: 'Created task TK-42.' })
        },
      },
    })
    expect(invoked).toBe(1)
    expect(reply.textCalls).toContain('Created task TK-42.')
  })

  test('normal turn (confident text) does NOT invoke the verifier', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult, text: 'All set — moved to Done.' }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => {
          invoked += 1
          return Promise.resolve({ text: 'should not be used' })
        },
      },
    })
    expect(invoked).toBe(0)
    expect(reply.textCalls).toContain('All set — moved to Done.')
  })
})

describe('sendLlmResponse beforeFirstMessage (live-status placeholder dismissal)', () => {
  test('normal turn: placeholder is dismissed immediately before the first reply message', async () => {
    mockLogger()
    const order: string[] = []
    const reply = createMockReply()
    const formatted = reply.reply.formatted
    reply.reply.formatted = (content: string): Promise<void> => {
      order.push('reply')
      return formatted(content)
    }
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult, text: 'All set.' }, undefined, undefined, () => {
      order.push('dismiss')
      return Promise.resolve()
    })
    // Placeholder dismissed first, then the real answer posts — no visible gap, no lost placeholder.
    expect(order).toEqual(['dismiss', 'reply'])
    expect(reply.textCalls).toContain('All set.')
  })

  test('risky turn: placeholder survives the verification round-trip and is dismissed just before the reply', async () => {
    mockLogger()
    const order: string[] = []
    const reply = createMockReply()
    const formatted = reply.reply.formatted
    reply.reply.formatted = (content: string): Promise<void> => {
      order.push('reply')
      return formatted(content)
    }
    await sendLlmResponse(
      reply.reply,
      'ctx-1',
      { ...baseResult },
      undefined,
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => {
            order.push('verify')
            return Promise.resolve({ text: 'Created task TK-42.' })
          },
        },
      },
      () => {
        order.push('dismiss')
        return Promise.resolve()
      },
    )
    // The placeholder stays up through the verifier call, then is dismissed right before the reply posts.
    expect(order).toEqual(['verify', 'dismiss', 'reply'])
    expect(reply.textCalls).toContain('Created task TK-42.')
  })
})
