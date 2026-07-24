// tests/smoke/harness/fake-llm-server.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const completionRequestSchema = z.object({ model: z.string().optional() })

export type LlmToolCall = { id: string; name: string; arguments: Record<string, unknown> }
export type ScriptedLlmResponse = { kind: 'tool'; call: LlmToolCall } | { kind: 'text'; content: string }

export function toolResponse(id: string, name: string, args: Record<string, unknown>): ScriptedLlmResponse {
  return { kind: 'tool', call: { id, name, arguments: args } }
}

export function textResponse(content: string): ScriptedLlmResponse {
  return { kind: 'text', content }
}

export type FakeLlmServer = {
  containerBaseUrl: string
  localBaseUrl: string
  enqueue(responses: ScriptedLlmResponse[]): void
  requestCount(): number
  stop(): Promise<void>
}

function buildCompletion(scripted: ScriptedLlmResponse, model: string, n: number): unknown {
  const base = {
    id: `chatcmpl-${n}`,
    object: 'chat.completion',
    created: 0,
    model,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
  if (scripted.kind === 'tool') {
    return {
      ...base,
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: scripted.call.id,
                type: 'function',
                function: { name: scripted.call.name, arguments: JSON.stringify(scripted.call.arguments) },
              },
            ],
          },
        },
      ],
    }
  }
  return {
    ...base,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: scripted.content } }],
  }
}

export function startFakeLlmServer(): FakeLlmServer {
  const queue: ScriptedLlmResponse[] = []
  let count = 0
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
        const rawBody: unknown = await req.json().catch(() => ({}))
        const parsedBody = completionRequestSchema.safeParse(rawBody)
        const model = parsedBody.success ? (parsedBody.data.model ?? 'unknown') : 'unknown'
        count += 1
        const scripted = queue.shift() ?? textResponse('__UNSCRIPTED__')
        return Response.json(buildCompletion(scripted, model, count))
      }
      return new Response('not found', { status: 404 })
    },
  })
  const port = server.port
  return {
    containerBaseUrl: `http://host.docker.internal:${port}/v1`,
    localBaseUrl: `http://127.0.0.1:${port}/v1`,
    enqueue(responses) {
      queue.push(...responses)
    },
    requestCount() {
      return count
    },
    async stop() {
      await server.stop(true)
    },
  }
}
