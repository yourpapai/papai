// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { callPluginMcpTool, listPluginMcpTools } from '../../src/mcp-server/plugin-bridge.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'

const MANIFEST = pluginManifestSchema.parse({
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'demo',
  apiVersion: 1,
  main: 'index.ts',
  contributes: { tools: ['echo'] },
})

function registerDemo(
  execute: (input: unknown) => Promise<unknown>,
  inputSchema: z.ZodType = z.object({ message: z.string() }),
): void {
  contributionRegistry.register(
    'demo',
    {
      tools: [
        {
          name: 'echo',
          description: 'echoes the message',
          inputSchema,
          execute: (input: unknown): Promise<unknown> => execute(input),
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

describe('plugin-bridge listPluginMcpTools', () => {
  test('returns raw tool names with a JSON-schema inputSchema', async () => {
    registerDemo(() => Promise.resolve({ ok: true }))
    const tools = await listPluginMcpTools('demo')
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('echo')
    expect(tools[0]!.description).toBe('echoes the message')
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object' })
  })

  test('returns [] for an unknown plugin', async () => {
    expect(await listPluginMcpTools('nope')).toEqual([])
  })

  test('falls back to the empty-object schema when schema derivation throws', async () => {
    registerDemo(
      () => Promise.resolve({ ok: true }),
      z.custom<() => void>(() => true),
    )
    const tools = await listPluginMcpTools('demo')
    expect(tools).toHaveLength(1)
    expect(tools[0]!.inputSchema).toEqual({ type: 'object', properties: {} })
  })
})

describe('plugin-bridge callPluginMcpTool', () => {
  test('executes the tool and wraps the result as text content', async () => {
    registerDemo((input) => Promise.resolve({ echoed: z.object({ message: z.string() }).parse(input).message }))
    const result = await callPluginMcpTool({
      pluginId: 'demo',
      toolName: 'echo',
      input: { message: 'hi' },
      storageContextId: 'pi:thread:1',
      chatUserId: 'u1',
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('"echoed":"hi"')
  })

  test('returns an isError result for an unknown tool', async () => {
    registerDemo(() => Promise.resolve({}))
    const result = await callPluginMcpTool({
      pluginId: 'demo',
      toolName: 'missing',
      input: {},
      storageContextId: 'pi:thread:1',
      chatUserId: 'u1',
    })
    expect(result.isError).toBe(true)
  })

  test('returns an isError result when execute throws', async () => {
    registerDemo(() => {
      throw new Error('boom')
    })
    const result = await callPluginMcpTool({
      pluginId: 'demo',
      toolName: 'echo',
      input: { message: 'hi' },
      storageContextId: 'pi:thread:1',
      chatUserId: 'u1',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('boom')
  })
})
