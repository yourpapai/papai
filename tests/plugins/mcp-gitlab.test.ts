// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { GitLabClient } from '../../plugins/mcp-gitlab/client.js'
import {
  buildMrQuery,
  shapeJob,
  shapeMr,
  shapeTreeEntry,
  shapeUser,
  truncateText,
} from '../../plugins/mcp-gitlab/format.js'
import factory from '../../plugins/mcp-gitlab/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-gitlab format', () => {
  test('shapeUser picks known fields and drops unknown ones', () => {
    expect(shapeUser({ id: 1, name: 'A', username: 'a', extra: 'x' })).toEqual({
      id: 1,
      name: 'A',
      username: 'a',
    })
  })

  test('shapeUser returns undefined for non-records', () => {
    expect(shapeUser(null)).toBeUndefined()
  })

  test('shapeTreeEntry picks known fields and drops unknown ones', () => {
    expect(shapeTreeEntry({ id: 'h', name: 'f.ts', type: 'blob', path: 'src/f.ts', mode: '100644', x: 1 })).toEqual({
      id: 'h',
      name: 'f.ts',
      type: 'blob',
      path: 'src/f.ts',
      mode: '100644',
    })
  })

  test('shapeTreeEntry returns empty object for non-records', () => {
    expect(shapeTreeEntry(5)).toEqual({})
  })

  test('shapeMr picks known fields, nested users, filtered labels, and drops unknowns', () => {
    expect(
      shapeMr({
        title: 'T',
        description: 'D',
        state: 'opened',
        web_url: 'u',
        source_branch: 's',
        target_branch: 'm',
        author: { id: 1, name: 'A', username: 'a' },
        assignee: null,
        reviewers: [{ id: 2, name: 'B', username: 'b' }],
        labels: ['x', 'y', 3],
        ignored: 'z',
      }),
    ).toEqual({
      title: 'T',
      description: 'D',
      state: 'opened',
      web_url: 'u',
      source_branch: 's',
      target_branch: 'm',
      author: { id: 1, name: 'A', username: 'a' },
      reviewers: [{ id: 2, name: 'B', username: 'b' }],
      labels: ['x', 'y'],
    })
  })

  test('shapeMr preserves an empty labels array', () => {
    expect(shapeMr({ title: 'T', labels: [] })).toEqual({ title: 'T', labels: [] })
  })

  test('shapeMr returns empty object for non-records', () => {
    expect(shapeMr(5)).toEqual({})
  })

  test('shapeJob picks known fields and always sets log/logTruncated', () => {
    expect(
      shapeJob(
        {
          id: 5,
          name: 'build',
          status: 'success',
          stage: 'test',
          web_url: 'u',
          ref: 'main',
          created_at: 't1',
          duration: 12,
          extra: 'drop',
        },
        'LOG',
        false,
      ),
    ).toEqual({
      id: 5,
      name: 'build',
      status: 'success',
      stage: 'test',
      web_url: 'u',
      ref: 'main',
      created_at: 't1',
      duration: 12,
      log: 'LOG',
      logTruncated: false,
    })
  })

  test('shapeJob returns only log/logTruncated for non-record raw', () => {
    expect(shapeJob(null, 'X', true)).toEqual({ log: 'X', logTruncated: true })
  })

  test('truncateText truncates when over the byte cap', () => {
    expect(truncateText('x'.repeat(10), 5)).toEqual({ text: 'xxxxx', truncated: true })
  })

  test('truncateText leaves short text untouched', () => {
    expect(truncateText('abc', 100)).toEqual({ text: 'abc', truncated: false })
  })

  test('buildMrQuery caps perPage and defaults page', () => {
    const params = new URLSearchParams(buildMrQuery({ state: 'opened', perPage: 150, orderBy: 'updated_at' }))
    expect(params.get('state')).toBe('opened')
    expect(params.get('per_page')).toBe('100')
    expect(params.get('order_by')).toBe('updated_at')
    expect(params.get('page')).toBe('1')
    expect(params.has('search')).toBe(false)
    expect(params.has('labels')).toBe(false)
  })

  test('buildMrQuery omits state=all and uses default perPage', () => {
    const params = new URLSearchParams(buildMrQuery({ state: 'all' }))
    expect(params.has('state')).toBe(false)
    expect(params.get('per_page')).toBe('20')
    expect(params.get('page')).toBe('1')
  })

  test('buildMrQuery maps sourceBranch and explicit page', () => {
    const params = new URLSearchParams(buildMrQuery({ sourceBranch: 'dev', page: 3 }))
    expect(params.get('source_branch')).toBe('dev')
    expect(params.get('page')).toBe('3')
  })
})

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

function createRoutedFetch(routes: Record<string, Response>, calls: string[]): (url: string) => Promise<Response> {
  return (url: string): Promise<Response> => {
    calls.push(url)
    const found = routes[url]
    return Promise.resolve(found ?? jsonResponse({ error: `unexpected url ${url}` }, 404))
  }
}

describe('GitLabClient', () => {
  const baseUrl = 'https://gl.test'
  const token = 'tok'

  test('getRepositoryTree builds the tree query, sends PRIVATE-TOKEN auth, and returns shaped entries', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const rawEntry = { id: 'h', name: 'f.ts', type: 'blob', path: 'src/f.ts', mode: '100644' }
    const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
      capturedUrl = url
      capturedInit = init
      return Promise.resolve(jsonResponse([rawEntry]))
    }
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    const result = await client.getRepositoryTree('group/proj', { path: 'src', ref: 'main', recursive: true })

    const parsed = new URL(capturedUrl)
    expect(parsed.origin + parsed.pathname).toBe('https://gl.test/api/v4/projects/group%2Fproj/repository/tree')
    expect(parsed.searchParams.get('path')).toBe('src')
    expect(parsed.searchParams.get('ref')).toBe('main')
    expect(parsed.searchParams.get('recursive')).toBe('true')
    expect(parsed.searchParams.get('per_page')).toBe('100')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('PRIVATE-TOKEN')).toBe('tok')
    expect(headers.get('Accept')).toBe('application/json')
    expect(result).toEqual([shapeTreeEntry(rawEntry)])
  })

  test('getRepositoryTree returns an empty array when the response body is not an array', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ not: 'an array' }))
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    const result = await client.getRepositoryTree('group/proj', {})

    expect(result).toEqual([])
  })

  test('getFileContent requests the raw file at ref=HEAD by default and returns the text', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(textResponse('hello world'))
    }
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    const result = await client.getFileContent('group/proj', 'src/a.ts')

    expect(capturedUrl).toBe('https://gl.test/api/v4/projects/group%2Fproj/repository/files/src%2Fa.ts/raw?ref=HEAD')
    expect(result).toBe('hello world')
  })

  test('getFileContent uses the given ref when provided', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(textResponse('dev content'))
    }
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    await client.getFileContent('group/proj', 'a.ts', { ref: 'dev' })

    expect(capturedUrl).toBe('https://gl.test/api/v4/projects/group%2Fproj/repository/files/a.ts/raw?ref=dev')
  })

  test('getFileContent truncates and prefixes a warning when the file exceeds ~1MB', async () => {
    const big = 'x'.repeat(1_000_001)
    const httpFetch = (): Promise<Response> => Promise.resolve(textResponse(big))
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    const result = await client.getFileContent('group/proj', 'big.txt')

    expect(result).toBe(`[WARNING: file truncated to ~1MB]\n\n${'x'.repeat(1_000_000)}`)
  })

  test('getMrInfo requests the merge request by iid and returns the shaped MR', async () => {
    let capturedUrl = ''
    const rawMr = { title: 'T', web_url: 'https://gl.test/group/proj/-/merge_requests/42' }
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse(rawMr))
    }
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    const result = await client.getMrInfo('group/proj', '42')

    expect(capturedUrl).toBe('https://gl.test/api/v4/projects/group%2Fproj/merge_requests/42')
    expect(result).toEqual(shapeMr(rawMr))
  })

  test('getMrInfo encodes a traversal-like projectPath so the request stays under /projects/', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse({}))
    }
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    await client.getMrInfo('../../x', '1')

    expect(capturedUrl).toContain('projects/..%2F..%2Fx/')
  })

  test('getMrInfo rejects on a non-2xx response', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({}, 404))
    const client = new GitLabClient({ baseUrl, token, httpFetch })

    await expect(client.getMrInfo('group/proj', '1')).rejects.toThrow(
      'GitLab API 404 for /projects/group%2Fproj/merge_requests/1',
    )
  })

  describe('getMrs', () => {
    test('reads items and pagination from response headers, capping per_page at 100', async () => {
      let capturedUrl = ''
      const rawMr = { title: 'T1' }
      const httpFetch = (url: string): Promise<Response> => {
        capturedUrl = url
        return Promise.resolve(
          new Response(JSON.stringify([rawMr]), {
            status: 200,
            headers: { 'x-total': '7', 'x-total-pages': '2', 'x-page': '1', 'x-per-page': '100' },
          }),
        )
      }
      const client = new GitLabClient({ baseUrl, token, httpFetch })

      const result = await client.getMrs('group/proj', { state: 'opened', perPage: 150 })

      const parsed = new URL(capturedUrl)
      expect(parsed.searchParams.get('state')).toBe('opened')
      expect(parsed.searchParams.get('per_page')).toBe('100')
      expect(parsed.searchParams.get('page')).toBe('1')
      expect(result).toEqual({ items: [shapeMr(rawMr)], total: 7, totalPages: 2, page: 1, perPage: 100 })
    })

    test('omits the state param for state=all', async () => {
      let capturedUrl = ''
      const httpFetch = (url: string): Promise<Response> => {
        capturedUrl = url
        return Promise.resolve(jsonResponse([]))
      }
      const client = new GitLabClient({ baseUrl, token, httpFetch })

      await client.getMrs('group/proj', { state: 'all' })

      const parsed = new URL(capturedUrl)
      expect(parsed.searchParams.has('state')).toBe(false)
    })

    test('throws when the response is not ok', async () => {
      const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({}, 404))
      const client = new GitLabClient({ baseUrl, token, httpFetch })

      await expect(client.getMrs('group/proj', {})).rejects.toThrow('GitLab API 404 for merge_requests')
    })
  })

  describe('getJob', () => {
    test('fetches job metadata and trace in parallel and shapes the result', async () => {
      const calls: string[] = []
      const rawJob = { id: 123, name: 'build', status: 'success' }
      const routes: Record<string, Response> = {
        'https://gl.test/api/v4/projects/group%2Fproj/jobs/123': jsonResponse(rawJob),
        'https://gl.test/api/v4/projects/group%2Fproj/jobs/123/trace': textResponse('LOG OUTPUT'),
      }
      const httpFetch = createRoutedFetch(routes, calls)
      const client = new GitLabClient({ baseUrl, token, httpFetch })

      const result = await client.getJob('group/proj', '123')

      expect([...calls].sort()).toEqual(
        [
          'https://gl.test/api/v4/projects/group%2Fproj/jobs/123',
          'https://gl.test/api/v4/projects/group%2Fproj/jobs/123/trace',
        ].sort(),
      )
      expect(result).toEqual(shapeJob(rawJob, 'LOG OUTPUT', false))
    })

    test('marks the trace as truncated when it exceeds ~1MB', async () => {
      const bigTrace = 'x'.repeat(1_000_001)
      const rawJob = { id: 123, name: 'build', status: 'success' }
      const routes: Record<string, Response> = {
        'https://gl.test/api/v4/projects/group%2Fproj/jobs/123': jsonResponse(rawJob),
        'https://gl.test/api/v4/projects/group%2Fproj/jobs/123/trace': textResponse(bigTrace),
      }
      const httpFetch = createRoutedFetch(routes, [])
      const client = new GitLabClient({ baseUrl, token, httpFetch })

      const result = await client.getJob('group/proj', '123')

      expect(result.logTruncated).toBe(true)
    })
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
      allowedHosts: new Set(['gl.test']),
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
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://gl.test',
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

describe('mcp-gitlab plugin', () => {
  test('activates and registers all 5 GitLab tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'gitlab_get_repository_tree',
        'gitlab_get_file_content',
        'gitlab_get_mr_info',
        'gitlab_get_mrs',
        'gitlab_get_job',
      ].sort(),
    )
  })

  test('gitlab_get_mr_info returns the shaped MR and calls the correct URL', async () => {
    let capturedUrl = ''
    const rawMr = { title: 'T', web_url: 'https://gl.test/group/proj/-/merge_requests/42' }
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify(rawMr), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_get_mr_info')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ projectPath: 'group/proj', mrIid: '42' }, runtimeCtx, options)

    expect(capturedUrl).toBe('https://gl.test/api/v4/projects/group%2Fproj/merge_requests/42')
    expect(result).toEqual(shapeMr(rawMr))
  })

  test('returns not_configured when admin creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_get_mr_info')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ projectPath: 'group/proj', mrIid: '42' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'GitLab is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_get_mr_info')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ projectPath: 'group/proj', mrIid: '42' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns gitlab_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('gitlab_get_mr_info')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ projectPath: 'group/proj', mrIid: '42' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'gitlab_error', message: 'Connection refused' })
  })
})
