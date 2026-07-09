// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { routePluginMcpPaths, type PluginMcpRouteDeps } from '../../src/mcp-server/server-route.js'
import { mintPluginMcpToken } from '../../src/mcp-server/token.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'

const CLAIMS = { storageContextId: 'pi:thread:1', chatUserId: 'u1', pluginId: 'demo' }
const TOKEN = mintPluginMcpToken(CLAIMS)

const DEPS: PluginMcpRouteDeps = {
  verifyToken: (raw: string) => (raw === TOKEN ? CLAIMS : null),
  isExposedInternalServer: () => true,
}

const MANIFEST = pluginManifestSchema.parse({
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'demo',
  apiVersion: 1,
  main: 'index.ts',
  contributes: { tools: ['echo'] },
})

function registerDemo(): void {
  contributionRegistry.register(
    'demo',
    {
      tools: [
        {
          name: 'echo',
          description: 'echoes the message',
          inputSchema: z.object({ message: z.string() }),
          execute: (input: unknown): Promise<unknown> =>
            Promise.resolve({ echoed: z.object({ message: z.string() }).parse(input).message }),
        },
      ],
      promptFragments: [],
      commands: [],
      jobs: [],
      attachmentTransformers: [],
    },
    MANIFEST,
  )
}

afterEach(() => {
  contributionRegistry.deregister('demo')
})

const listToolsResponseSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
})

const callToolResponseSchema = z.object({
  result: z.object({ content: z.array(z.object({ type: z.string(), text: z.string() })) }),
})

async function call(
  method: string,
  params: unknown,
  token: string,
  deps: PluginMcpRouteDeps = DEPS,
): Promise<{
  status: number
  body: unknown
}> {
  const url = new URL('https://bot.example.com/mcp/plugin/demo')
  const req = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const res = await routePluginMcpPaths(req, url, deps)
  expect(res).not.toBeNull()

  const contentType = res!.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const text = await res!.text()
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    if (dataLine === undefined) throw new Error('no data: line found in SSE response')
    return { status: res!.status, body: JSON.parse(dataLine.slice('data:'.length).trim()) }
  }
  return { status: res!.status, body: await res!.json() }
}

describe('plugin MCP endpoint (integration)', () => {
  test('tools/list then tools/call round-trips through the bridge', async () => {
    registerDemo()

    const listed = await call('tools/list', {}, TOKEN)
    expect(listed.status).toBe(200)
    const listedBody = listToolsResponseSchema.parse(listed.body)
    expect(listedBody.result.tools.map((t) => t.name)).toContain('echo')

    const called = await call('tools/call', { name: 'echo', arguments: { message: 'hi' } }, TOKEN)
    expect(called.status).toBe(200)
    const calledBody = callToolResponseSchema.parse(called.body)
    expect(calledBody.result.content[0]!.text).toContain('hi')
  })

  test('401s when the exposure gate rejects the plugin for the context', async () => {
    registerDemo()

    const result = await call('tools/list', {}, TOKEN, {
      verifyToken: DEPS.verifyToken,
      isExposedInternalServer: () => false,
    })
    expect(result.status).toBe(401)
  })
})
