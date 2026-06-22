// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import factory from '../../../plugins/acp/index.js'
import type { PluginContext } from '../../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../../src/plugins/types.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function activate(httpFetch: HttpFetch): Map<string, PluginTool> {
  const tools = new Map<string, PluginTool>()
  const ctx = {
    pluginId: 'acp',
    contextId: '__system__',
    permissions: new Set(['http', 'storage', 'commands']),
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registration: {
      registerTool: (t: PluginTool) => {
        tools.set(t.name, t)
      },
      registerPromptFragment: () => {},
      registerCommand: () => {},
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
      registerTaskProviderType: () => {},
    },
    providerRuntime: {
      httpFetch,
      allowedHosts: new Set<string>(),
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    },
    adminConfig: { get: () => undefined },
  } as PluginContext
  factory().activate(ctx)
  return tools
}

function runtimeCtx(adminGet?: (k: string) => string | undefined): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  return {
    pluginId: 'acp',
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    adminConfig: {
      get:
        adminGet ??
        ((k: string) => (k === 'magi_base_url' ? 'http://magi:8787' : k === 'magi_token' ? 'tok' : undefined)),
    },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => notImplemented() },
  } as PluginToolRuntimeContext
}

function makeOptions(): ToolExecutionOptions {
  return { toolCallId: 'c1', messages: [] }
}

function getAuthHeader(init: RequestInit | undefined): string {
  return new Headers(init?.headers).get('authorization') ?? ''
}

describe('acp read tools', () => {
  test('list_projects GETs /projects with bearer auth', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const httpFetch: HttpFetch = (url, init) => {
      seenUrl = url
      seenAuth = getAuthHeader(init)
      return Promise.resolve(
        jsonResponse([{ name: 'demo', baseBranch: 'main', forgeKind: 'github', agent: 'claude-code-acp' }]),
      )
    }
    const tools = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), makeOptions())
    expect(seenUrl).toBe('http://magi:8787/projects')
    expect(seenAuth).toBe('Bearer tok')
    expect(result).toEqual([{ name: 'demo', baseBranch: 'main', forgeKind: 'github', agent: 'claude-code-acp' }])
  })

  test('list_agents GETs /agents', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([{ name: 'claude-code-acp' }])))
    const tools = activate(httpFetch)
    const result = await tools.get('list_agents')!.execute({}, runtimeCtx(), makeOptions())
    expect(result).toEqual([{ name: 'claude-code-acp' }])
  })

  test('returns not_configured when admin config is missing', async () => {
    const tools = activate(mock())
    const result = await tools.get('list_projects')!.execute(
      {},
      runtimeCtx(() => undefined),
      makeOptions(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
  })

  test('surfaces a magi error response', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ error: 'boom' }, 500))
    const tools = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), makeOptions())
    expect(result).toEqual({ error: 'magi_error', status: 500, body: { error: 'boom' } })
  })
})
