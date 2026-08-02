// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/harness/fake-llm-server.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { startFakeLlmServer, textResponse, toolResponse } from './fake-llm-server.js'

const toolCompletionSchema = z.object({
  model: z.string(),
  choices: z.tuple([
    z.object({
      finish_reason: z.string(),
      message: z.object({
        content: z.null(),
        tool_calls: z.tuple([z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })]),
      }),
    }),
  ]),
})

const textCompletionSchema = z.object({
  choices: z.tuple([
    z.object({
      finish_reason: z.string(),
      message: z.object({ content: z.string() }),
    }),
  ]),
})

describe('fake LLM server', () => {
  test('serves scripted tool then text responses with JSON-encoded arguments', async () => {
    const llm = startFakeLlmServer()
    try {
      llm.enqueue([toolResponse('call_1', 'load_tool', { names: ['list_memory'] }), textResponse('all done')])

      const first = toolCompletionSchema.parse(
        await (
          await fetch(`${llm.localBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'smoke-model', messages: [] }),
          })
        ).json(),
      )
      expect(first.model).toBe('smoke-model')
      expect(first.choices[0].finish_reason).toBe('tool_calls')
      const toolCall = first.choices[0].message.tool_calls[0]
      expect(toolCall.function.name).toBe('load_tool')
      expect(typeof toolCall.function.arguments).toBe('string')
      expect(JSON.parse(toolCall.function.arguments)).toEqual({ names: ['list_memory'] })

      const second = textCompletionSchema.parse(
        await (
          await fetch(`${llm.localBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'smoke-model', messages: [] }),
          })
        ).json(),
      )
      expect(second.choices[0].finish_reason).toBe('stop')
      expect(second.choices[0].message.content).toBe('all done')
      expect(llm.requestCount()).toBe(2)
    } finally {
      await llm.stop()
    }
  })
})
