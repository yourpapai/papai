// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { GitLabClient } from '../../plugins/mcp-gitlab/client.js'
import factory from '../../plugins/mcp-gitlab/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

interface Captured {
  url: string
  method: string | undefined
  body: unknown
}

function captureFetch(responseBody: unknown): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    captured.push({ url, method: init?.method, body: rawBody === undefined ? undefined : JSON.parse(rawBody) })
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 201 }))
  }
  return { httpFetch, captured }
}

function client(httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>): GitLabClient {
  return new GitLabClient({ baseUrl: 'https://gl.example.com', token: 'tok', httpFetch })
}

describe('GitLabClient writes', () => {
  test('postComment POSTs a note and returns the noteId', async () => {
    const { httpFetch, captured } = captureFetch({ id: 7, body: 'hi' })
    const out = await client(httpFetch).postComment('group/proj', '42', 'hi')
    expect(out).toEqual({ noteId: 7 })
    expect(captured[0]?.method).toBe('POST')
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42/notes')
    expect(captured[0]?.body).toEqual({ body: 'hi' })
  })

  test('createDiscussion POSTs a discussion and returns discussionId + noteId', async () => {
    const { httpFetch, captured } = captureFetch({ id: 'abc123', notes: [{ id: 9 }] })
    const out = await client(httpFetch).createDiscussion('group/proj', '42', 'thread start')
    expect(out).toEqual({ discussionId: 'abc123', noteId: 9 })
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42/discussions')
    expect(captured[0]?.body).toEqual({ body: 'thread start' })
  })

  test('updateMr PUTs only provided fields (targetBranch -> target_branch) and shapes the MR', async () => {
    const { httpFetch, captured } = captureFetch({ title: 'New', state: 'opened' })
    const out = await client(httpFetch).updateMr('group/proj', '42', { title: 'New', targetBranch: 'main' })
    expect(out).toEqual({ title: 'New', state: 'opened' })
    expect(captured[0]?.method).toBe('PUT')
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42')
    expect(captured[0]?.body).toEqual({ title: 'New', target_branch: 'main' })
  })

  test('setMrState PUTs state_event and shapes the MR', async () => {
    const { httpFetch, captured } = captureFetch({ title: 'X', state: 'closed' })
    const out = await client(httpFetch).setMrState('group/proj', '42', 'close')
    expect(out).toEqual({ title: 'X', state: 'closed' })
    expect(captured[0]?.body).toEqual({ state_event: 'close' })
  })

  test('a non-ok write surfaces a clean error', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{}', { status: 403 }))
    await expect(client(httpFetch).postComment('group/proj', '42', 'hi')).rejects.toThrow(/GitLab API 403/u)
  })
})

function createMockLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createMockContext(overrides: { httpFetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}): {
  ctx: PluginContext
  registeredTools: Map<string, PluginTool>
} {
  const registeredTools = new Map<string, PluginTool>()

  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      registeredTools.set(tool.name, tool)
    },
    registerPromptFragment: () => {},
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerAttachmentTransformer: () => {},
    registerTaskProviderType: () => {},
  }

  const ctx: PluginContext = {
    pluginId: 'mcp-gitlab',
    contextId: '__system__',
    permissions: new Set(['http']),
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    log: createMockLogger(),
    registration,
    providerRuntime: {
      httpFetch: overrides.httpFetch ?? mock(),
      allowedHosts: new Set(['gl.example.com']),
      logger: createMockLogger(),
    },
    adminConfig: {
      get: () => undefined,
    },
  }

  return { ctx, registeredTools }
}

function createMockRuntimeContext(
  overrides: {
    allowed?: boolean
    retryAfterSec?: number
    baseUrl?: string | undefined
    token?: string | undefined
  } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  const values: Record<string, string | undefined> = {
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://gl.example.com',
    token: 'token' in overrides ? overrides.token : 'tok',
  }

  return {
    pluginId: 'mcp-gitlab',
    storageContextId: 'test-context',
    chatUserId: 'test-user',
    taskProvider: {
      getTask: () => notImplemented(),
      listTasks: () => notImplemented(),
      searchTasks: () => notImplemented(),
      createTask: () => notImplemented(),
      updateTask: () => notImplemented(),
    },
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    rateLimit: {
      check: () => ({
        allowed: overrides.allowed ?? true,
        retryAfterSec: overrides.retryAfterSec,
      }),
    },
    attachments: {
      read: () => notImplemented(),
    },
    adminConfig: {
      get: (key: string) => values[key],
    },
    contextConfig: {
      get: () => undefined,
    },
    codingSecrets: {
      resolve: () => null,
      resolveForgeToken: () => null,
      resolveAgent: () => null,
      resolveForge: () => null,
      resolveProviderHost: () => null,
      resolveModel: () => null,
      resolveMcpServers: () => ({ ok: true, servers: [] }),
      resolveMcpTokens: () => ({}),
    },
    codingRepos: { list: () => [], get: () => null },
    transcript: { mintUrl: () => null },
  } as PluginToolRuntimeContext
}

function createMockOptions(): ToolExecutionOptions {
  return {
    toolCallId: 'test-call-id',
    messages: [],
  }
}

describe('mcp-gitlab write tools', () => {
  test('gitlab_post_comment posts and returns { noteId }', async () => {
    const { httpFetch, captured } = captureFetch({ id: 7, body: 'hi' })

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_post_comment')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ projectPath: 'group/proj', mrIid: '42', body: 'hi' }, runtimeCtx, options)

    expect(result).toEqual({ noteId: 7 })
    expect(captured[0]?.method).toBe('POST')
  })

  test('gitlab_update_mr with no fields returns validation_error and issues no HTTP call', async () => {
    const { httpFetch, captured } = captureFetch({})

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_update_mr')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ projectPath: 'group/proj', mrIid: '42' }, runtimeCtx, options)

    expect(result).toHaveProperty('error', 'validation_error')
    expect(result).toHaveProperty('message', expect.stringContaining('at least one'))
    expect(captured).toHaveLength(0)
  })

  test('gitlab_set_mr_state with an invalid stateEvent returns validation_error', async () => {
    const { httpFetch, captured } = captureFetch({})

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_set_mr_state')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute(
      { projectPath: 'group/proj', mrIid: '42', stateEvent: 'bogus' },
      runtimeCtx,
      options,
    )

    expect(result).toHaveProperty('error', 'validation_error')
    expect(captured).toHaveLength(0)
  })
})
