// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { createScenarioEvents } from './events.js'
import { createFakeMcpServer } from './fake-mcp-server.js'
import { createStrictHttpDispatcher } from './strict-http.js'

const MCP_URL = 'https://mcp.invalid/rpc'
const originalFetch = globalThis.fetch

describe('createFakeMcpServer', () => {
  afterEach(() => {
    Reflect.set(globalThis, 'fetch', originalFetch)
  })

  test('a real StreamableHTTP client connects, lists, and calls a tool over the dispatcher', async () => {
    const events = createScenarioEvents('fake-mcp')
    const http = createStrictHttpDispatcher(events)
    const server = createFakeMcpServer({ http, events, url: MCP_URL })
    server.expectConnect()
    server.expectToolsList([{ name: 'echo', description: 'echoes', inputSchema: { type: 'object' } }])
    server.expectToolCall({ name: 'echo' }, { text: 'server-sourced-token' })

    // The story harness patches globalThis.fetch; the contract test does it directly
    // (matching the io-guard's own Reflect.set seam, which sidesteps the `fetch.preconnect`
    // property that a plain function assignment/cast would unsafely paper over).
    Reflect.set(globalThis, 'fetch', http.fetch)

    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name)).toContain('echo')
    const called = await client.callTool({ name: 'echo', arguments: {} })
    expect(JSON.stringify(called.content)).toContain('server-sourced-token')
    await client.close()
    server.verifyConsumed()
  })
})
