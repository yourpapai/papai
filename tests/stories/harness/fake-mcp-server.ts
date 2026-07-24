// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ScenarioEvents } from './events.js'
import type { StrictHttpDispatcher } from './strict-http.js'

export type FakeMcpTool = Readonly<{ name: string; description: string; inputSchema: object }>

export type FakeMcpServer = Readonly<{
  expectConnect(serverInfo?: { name?: string; version?: string }): void
  expectToolsList(tools: readonly FakeMcpTool[]): void
  expectToolCall(expected: { name: string }, result: { text: string }): void
  verifyConsumed(): void
}>

const jsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
})

type JsonRpc = z.infer<typeof jsonRpcSchema>

const initializeParamsSchema = z.object({ protocolVersion: z.string().optional() })
const toolCallParamsSchema = z.object({ name: z.string().optional() })

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function readRpc(request: Request, route: string): Promise<JsonRpc> {
  const body: unknown = await request.json()
  const parsed = jsonRpcSchema.safeParse(body)
  if (!parsed.success) throw new Error(`FakeMcpServer rejected ${route}: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

function assertMethod(rpc: JsonRpc, expected: string): void {
  if (rpc.method !== expected) throw new Error(`FakeMcpServer expected JSON-RPC ${expected}, got ${rpc.method}`)
}

function parseParams<Schema extends z.ZodType>(rpc: JsonRpc, schema: Schema, route: string): z.infer<Schema> {
  const parsed = schema.safeParse(rpc.params ?? {})
  if (!parsed.success) throw new Error(`FakeMcpServer rejected ${route} params: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

type Options = Readonly<{ http: StrictHttpDispatcher; events: ScenarioEvents; url: string }>

export function createFakeMcpServer(options: Options): FakeMcpServer {
  const { http, events, url } = options
  return {
    expectConnect(serverInfo): void {
      // 1. initialize. (The real StreamableHTTPClientTransport v1.29.0 does not
      // issue a GET SSE probe during Client.connect(); the GET listening stream
      // is only opened via an auth provider, a resumption token, or an explicit
      // resumeStream() call — none of which the basic connect/list/call flow uses.)
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request, 'POST initialize')
        assertMethod(rpc, 'initialize')
        const { protocolVersion = '2025-06-18' } = parseParams(rpc, initializeParamsSchema, 'initialize')
        events.record('mcp.server.initialize', { url })
        return jsonResponse({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: serverInfo?.name ?? 'fake-mcp', version: serverInfo?.version ?? '1.0.0' },
          },
        })
      })
      // 2. notifications/initialized (no id) → 202 empty.
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request, 'POST notifications/initialized')
        assertMethod(rpc, 'notifications/initialized')
        return new Response(null, { status: 202 })
      })
    },
    expectToolsList(tools): void {
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request, 'POST tools/list')
        assertMethod(rpc, 'tools/list')
        events.record('mcp.server.tools_list', { url, count: tools.length })
        return jsonResponse({ jsonrpc: '2.0', id: rpc.id, result: { tools: [...tools] } })
      })
    },
    expectToolCall(expected, result): void {
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request, 'POST tools/call')
        assertMethod(rpc, 'tools/call')
        const { name } = parseParams(rpc, toolCallParamsSchema, 'tools/call')
        if (name !== expected.name) throw new Error(`FakeMcpServer expected tools/call ${expected.name}, got ${name}`)
        events.record('mcp.server.tools_call', { url, name })
        return jsonResponse({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { content: [{ type: 'text', text: result.text }], isError: false },
        })
      })
    },
    verifyConsumed: http.verifyConsumed,
  }
}
