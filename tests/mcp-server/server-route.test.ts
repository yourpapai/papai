// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { routePluginMcpPaths } from '../../src/mcp-server/server-route.js'
import { mintPluginMcpToken } from '../../src/mcp-server/token.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'

const CLAIMS = { storageContextId: 'pi:thread:1', chatUserId: 'u1', pluginId: 'demo' }

const listToolsResponseSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
})

const callToolResponseSchema = z.object({
  result: z.object({ content: z.array(z.object({ type: z.string(), text: z.string() })) }),
})

function post(token: string | null, method: string): Request {
  return new Request('https://bot.example.com/mcp/plugin/demo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
  })
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

describe('routePluginMcpPaths', () => {
  test('returns null for a non-matching path', async () => {
    const res = await routePluginMcpPaths(new Request('https://x/other'), new URL('https://x/other'))
    expect(res).toBeNull()
  })

  test('404 for a malformed percent-encoded plugin-id segment (does not throw)', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/%zz')
    const res = await routePluginMcpPaths(new Request(url), url)
    expect(res?.status).toBe(404)
  })

  test('404 for an empty plugin-id segment', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/')
    const res = await routePluginMcpPaths(new Request(url), url)
    expect(res?.status).toBe(404)
  })

  test('401 without a token', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const res = await routePluginMcpPaths(post(null, 'tools/list'), url)
    expect(res?.status).toBe(401)
  })

  test('401 when token pluginId != path pluginId', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const token = mintPluginMcpToken({ ...CLAIMS, pluginId: 'other' })
    const res = await routePluginMcpPaths(post(token, 'tools/list'), url)
    expect(res?.status).toBe(401)
  })

  test('401 when the plugin is ineligible for the context', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const token = mintPluginMcpToken(CLAIMS)
    const res = await routePluginMcpPaths(post(token, 'tools/list'), url, {
      verifyToken: () => CLAIMS,
      isEligible: () => ({ eligible: false }),
    })
    expect(res?.status).toBe(401)
  })

  test('lists the registered plugin tools over the streamable-HTTP transport', async () => {
    registerDemo()
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const token = mintPluginMcpToken(CLAIMS)
    const res = await routePluginMcpPaths(post(token, 'tools/list'), url, {
      verifyToken: () => CLAIMS,
      isEligible: () => ({ eligible: true }),
    })
    expect(res).not.toBeNull()
    expect(res?.status).toBe(200)
    const body = listToolsResponseSchema.parse(await res?.json())
    expect(body.result.tools).toHaveLength(1)
    expect(body.result.tools[0]?.name).toBe('echo')
  })

  test('calls a registered plugin tool over the streamable-HTTP transport', async () => {
    registerDemo()
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const token = mintPluginMcpToken(CLAIMS)
    const req = new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'hi' } },
      }),
    })
    const res = await routePluginMcpPaths(req, url, {
      verifyToken: () => CLAIMS,
      isEligible: () => ({ eligible: true }),
    })
    expect(res?.status).toBe(200)
    const body = callToolResponseSchema.parse(await res?.json())
    expect(body.result.content[0]?.text).toContain('"echoed":"hi"')
  })
})
