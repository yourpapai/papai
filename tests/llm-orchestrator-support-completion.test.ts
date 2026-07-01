// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { sendLlmResponse } from '../src/llm-orchestrator-support.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

const baseResult = {
  text: undefined as string | undefined,
  finishReason: 'stop' as string | undefined,
  toolCalls: [] as unknown[],
  response: { messages: [] as ModelMessage[] },
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
