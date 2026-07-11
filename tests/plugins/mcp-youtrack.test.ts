// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { YouTrackClient } from '../../plugins/mcp-youtrack/client.js'
import {
  ACTIVITY_FIELDS,
  ATTACHMENT_FIELDS,
  COMMENT_READ_FIELDS,
  COMMENT_WRITE_FIELDS,
  ISSUE_FIELDS,
  shapeActivity,
  shapeAttachment,
  shapeComment,
  shapeFieldOptions,
  shapeFieldValue,
  shapeIssue,
  shapeUser,
} from '../../plugins/mcp-youtrack/format.js'
import factory from '../../plugins/mcp-youtrack/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-youtrack format', () => {
  test('shapeUser picks known fields and drops unknown ones', () => {
    expect(shapeUser({ login: 'u', fullName: 'U Name', x: 1 })).toEqual({ login: 'u', fullName: 'U Name' })
  })

  test('shapeUser returns undefined for non-records', () => {
    expect(shapeUser(null)).toBeUndefined()
  })

  test('shapeUser returns empty object when neither field present', () => {
    expect(shapeUser({})).toEqual({})
  })

  test('shapeFieldValue handles null', () => {
    expect(shapeFieldValue(null)).toBeNull()
  })

  test('shapeFieldValue handles string primitive', () => {
    expect(shapeFieldValue('x')).toBe('x')
  })

  test('shapeFieldValue handles number primitive', () => {
    expect(shapeFieldValue(5)).toBe(5)
  })

  test('shapeFieldValue picks known keys from a record and drops unknown ones', () => {
    expect(shapeFieldValue({ name: 'Open', extra: 1 })).toEqual({ name: 'Open' })
  })

  test('shapeFieldValue picks login/fullName from a record', () => {
    expect(shapeFieldValue({ login: 'u', fullName: 'U' })).toEqual({ login: 'u', fullName: 'U' })
  })

  test('shapeFieldValue maps arrays recursively', () => {
    expect(shapeFieldValue([{ name: 'a' }, { name: 'b' }])).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  test('shapeIssue shapes known fields, nested values, and drops unknowns', () => {
    expect(
      shapeIssue({
        idReadable: 'P-1',
        summary: 'S',
        description: 'D',
        reporter: { login: 'r', fullName: 'R' },
        tags: [{ id: 't1', name: 'bug' }],
        customFields: [
          { name: 'Priority', value: { name: 'High' } },
          { name: 'Assignee', value: { login: 'a', fullName: 'A' } },
        ],
        links: [
          {
            id: 'l1',
            direction: 'OUTWARD',
            linkType: { name: 'relates', sourceToTarget: 'relates to' },
            issues: [{ id: 'i2', idReadable: 'P-2', summary: 'S2' }],
          },
        ],
        junk: 'drop',
      }),
    ).toEqual({
      idReadable: 'P-1',
      summary: 'S',
      description: 'D',
      reporter: { login: 'r', fullName: 'R' },
      tags: [{ id: 't1', name: 'bug' }],
      customFields: [
        { name: 'Priority', value: { name: 'High' } },
        { name: 'Assignee', value: { login: 'a', fullName: 'A' } },
      ],
      links: [
        {
          id: 'l1',
          direction: 'OUTWARD',
          linkType: { name: 'relates', sourceToTarget: 'relates to' },
          issues: [{ id: 'i2', idReadable: 'P-2', summary: 'S2' }],
        },
      ],
    })
  })

  test('shapeIssue returns empty object for non-records', () => {
    expect(shapeIssue(5)).toEqual({})
  })

  test('shapeComment picks known fields and drops unknowns like deleted', () => {
    expect(
      shapeComment({
        id: 'c1',
        text: 'hi',
        created: 5,
        author: { login: 'a' },
        attachments: [{ id: 'f1', name: 'a.log', size: 10, mimeType: 'text/plain' }],
        deleted: false,
      }),
    ).toEqual({
      id: 'c1',
      text: 'hi',
      created: 5,
      author: { login: 'a' },
      attachments: [{ id: 'f1', name: 'a.log', size: 10, mimeType: 'text/plain' }],
    })
  })

  test('shapeComment returns empty object for non-records', () => {
    expect(shapeComment(null)).toEqual({})
  })

  test('shapeActivity shapes known fields', () => {
    expect(
      shapeActivity({
        timestamp: 123,
        field: { name: 'State' },
        added: [{ name: 'Open' }],
        removed: [{ name: 'Fixed' }],
        target: { idReadable: 'P-1' },
      }),
    ).toEqual({
      timestamp: 123,
      field: { name: 'State' },
      added: [{ name: 'Open' }],
      removed: [{ name: 'Fixed' }],
      target: { idReadable: 'P-1' },
    })
  })

  test('shapeActivity returns empty object for non-records', () => {
    expect(shapeActivity(5)).toEqual({})
  })

  test('shapeAttachment shapes known fields and drops unknowns', () => {
    expect(
      shapeAttachment({
        id: 'a',
        name: 'f',
        size: 9,
        mimeType: 'text/plain',
        url: '/api/files/a?sign=x',
        author: { login: 'u' },
        created: 5,
        junk: 'drop',
      }),
    ).toEqual({
      id: 'a',
      name: 'f',
      size: 9,
      mimeType: 'text/plain',
      url: '/api/files/a?sign=x',
      author: { login: 'u' },
      created: 5,
    })
  })

  test('shapeAttachment returns empty object for non-records', () => {
    expect(shapeAttachment(null)).toEqual({})
  })

  test('shapeFieldOptions builds bundle values and marks free-text fields', () => {
    expect(
      shapeFieldOptions({
        customFields: [
          {
            name: 'Priority',
            $type: 'SingleEnumIssueCustomField',
            projectCustomField: { bundle: { values: [{ name: 'High' }, { name: 'Low' }] } },
          },
          { name: 'Assignee', $type: 'SingleUserIssueCustomField' },
        ],
      }),
    ).toEqual([
      { name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['High', 'Low'] },
      { name: 'Assignee', type: 'SingleUserIssueCustomField', free: true },
    ])
  })

  test('shapeFieldOptions filters by fieldName case-insensitively', () => {
    expect(
      shapeFieldOptions(
        {
          customFields: [
            {
              name: 'Priority',
              $type: 'SingleEnumIssueCustomField',
              projectCustomField: { bundle: { values: [{ name: 'High' }, { name: 'Low' }] } },
            },
            { name: 'Assignee', $type: 'SingleUserIssueCustomField' },
          ],
        },
        'priority',
      ),
    ).toEqual([{ name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['High', 'Low'] }])
  })

  test('shapeFieldOptions returns empty array for non-records', () => {
    expect(shapeFieldOptions(5)).toEqual([])
  })

  test('shapeFieldOptions returns empty array when customFields is not an array', () => {
    expect(shapeFieldOptions({ customFields: 'nope' })).toEqual([])
  })
})

type CapturedCall = { url: string; init: RequestInit | undefined }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

function createRoutedHttpFetch(
  routes: Record<string, Response>,
  calls: CapturedCall[],
): (url: string, init: RequestInit | undefined) => Promise<Response> {
  return (url: string, init: RequestInit | undefined): Promise<Response> => {
    calls.push({ url, init })
    const pathname = new URL(url).pathname
    const route = routes[pathname]
    return Promise.resolve(route ?? jsonResponse({ error: `unexpected pathname ${pathname}` }, 404))
  }
}

function countCallsTo(calls: CapturedCall[], pathname: string): number {
  return calls.filter((c) => new URL(c.url).pathname === pathname).length
}

describe('YouTrackClient', () => {
  const baseUrl = 'https://yt.test'
  const token = 'tok'

  test('getIssue fetches and shapes the issue', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1': jsonResponse({ idReadable: 'P-1', summary: 'S', junk: 'drop' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.getIssue('P-1')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-1?fields=${ISSUE_FIELDS}`)
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('Accept')).toBe('application/json')
    expect(result).toEqual({ idReadable: 'P-1', summary: 'S' })
  })

  test('getStateActivities filters to State-field activities', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1/activities': jsonResponse([
        { timestamp: 1, field: { name: 'State' }, added: [{ name: 'Open' }] },
        { timestamp: 2, field: { name: 'Priority' }, added: [{ name: 'High' }] },
      ]),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.getStateActivities('P-1')

    expect(calls[0]?.url).toBe(
      `https://yt.test/api/issues/P-1/activities?categories=CustomFieldCategory&fields=${ACTIVITY_FIELDS}&$top=500&$orderby=timestamp`,
    )
    expect(result).toEqual([{ timestamp: 1, field: { name: 'State' }, added: [{ name: 'Open' }] }])
  })

  test('getComments drops deleted comments and never exposes a deleted key', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1/comments': jsonResponse([
        { id: 'c1', text: 'hi', deleted: false },
        { id: 'c2', text: 'bye', deleted: true },
      ]),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.getComments('P-1')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-1/comments?fields=${COMMENT_READ_FIELDS}&$top=500`)
    expect(result).toEqual([{ id: 'c1', text: 'hi' }])
    for (const comment of result) {
      expect(comment).not.toHaveProperty('deleted')
    }
  })

  test('getIssueTags returns shaped tags', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1/tags': jsonResponse([
        { id: 't1', name: 'bug', junk: 'drop' },
        { id: 't2', name: 'urgent' },
      ]),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.getIssueTags('P-1')

    expect(calls[0]?.url).toBe('https://yt.test/api/issues/P-1/tags?fields=id,name')
    expect(result).toEqual([
      { id: 't1', name: 'bug' },
      { id: 't2', name: 'urgent' },
    ])
  })

  test('getFieldOptions filters options by fieldName', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1': jsonResponse({
        customFields: [
          {
            name: 'Priority',
            $type: 'SingleEnumIssueCustomField',
            projectCustomField: { bundle: { values: [{ name: 'High' }, { name: 'Low' }] } },
          },
          { name: 'Assignee', $type: 'SingleUserIssueCustomField' },
        ],
      }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.getFieldOptions('P-1', 'Priority')

    expect(calls[0]?.url).toBe(
      `https://yt.test/api/issues/P-1?fields=customFields(name,$type,projectCustomField(bundle(values(name))))`,
    )
    expect(result).toEqual([{ name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['High', 'Low'] }])
  })

  test('getAttachments returns shaped attachments', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1/attachments': jsonResponse([{ id: 'a1', name: 'a.txt', size: 5, mimeType: 'text/plain' }]),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.getAttachments('P-1')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-1/attachments?fields=${ATTACHMENT_FIELDS}`)
    expect(result).toEqual([{ id: 'a1', name: 'a.txt', size: 5, mimeType: 'text/plain' }])
  })

  describe('readAttachment', () => {
    test('inlines text content for small text/* attachments via the pre-signed url', async () => {
      const calls: CapturedCall[] = []
      const routes: Record<string, Response> = {
        '/api/issues/P-1/attachments/A9': jsonResponse({
          id: 'A9',
          size: 100,
          mimeType: 'text/plain',
          url: '/api/files/A9?sign=x',
        }),
        '/api/files/A9': textResponse('hello'),
      }
      const httpFetch = createRoutedHttpFetch(routes, calls)
      const client = new YouTrackClient({ baseUrl, token, httpFetch })

      const result = await client.readAttachment('P-1', 'A9')

      expect(result).toEqual({
        attachment: { id: 'A9', size: 100, mimeType: 'text/plain', url: '/api/files/A9?sign=x' },
        text: 'hello',
      })
      expect(calls[1]?.url).toBe('https://yt.test/api/files/A9?sign=x')
      const headers = new Headers(calls[1]?.init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer tok')
      expect(headers.get('Accept')).toBe('*/*')
    })

    test('flags large attachments as too large without fetching content', async () => {
      const calls: CapturedCall[] = []
      const routes: Record<string, Response> = {
        '/api/issues/P-1/attachments/A9': jsonResponse({
          id: 'A9',
          size: 999_999,
          mimeType: 'text/plain',
          url: '/api/files/A9?sign=x',
        }),
      }
      const httpFetch = createRoutedHttpFetch(routes, calls)
      const client = new YouTrackClient({ baseUrl, token, httpFetch })

      const result = await client.readAttachment('P-1', 'A9')

      expect(result).toEqual({
        attachment: { id: 'A9', size: 999_999, mimeType: 'text/plain', url: '/api/files/A9?sign=x' },
        tooLarge: true,
      })
      expect(countCallsTo(calls, '/api/files/A9')).toBe(0)
    })

    test('flags non-text attachments as binary without fetching content', async () => {
      const calls: CapturedCall[] = []
      const routes: Record<string, Response> = {
        '/api/issues/P-1/attachments/A9': jsonResponse({
          id: 'A9',
          size: 100,
          mimeType: 'image/png',
          url: '/api/files/A9?sign=x',
        }),
      }
      const httpFetch = createRoutedHttpFetch(routes, calls)
      const client = new YouTrackClient({ baseUrl, token, httpFetch })

      const result = await client.readAttachment('P-1', 'A9')

      expect(result).toEqual({
        attachment: { id: 'A9', size: 100, mimeType: 'image/png', url: '/api/files/A9?sign=x' },
        isBinary: true,
        note: 'Binary attachment; content not inlined (no filesystem handoff in this MCP transport).',
      })
      expect(countCallsTo(calls, '/api/files/A9')).toBe(0)
    })
  })

  test('addComment posts and returns the shaped comment', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1/comments': jsonResponse({ id: 'c9', text: 'hi', author: { login: 'a' } }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    const result = await client.addComment('P-1', 'hi')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-1/comments?fields=${COMMENT_WRITE_FIELDS}`)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ text: 'hi' }))
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(result).toEqual({ id: 'c9', text: 'hi', author: { login: 'a' } })
  })

  test('getIssue encodes a traversal-like id so the request stays under /issues/', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/..%2F..%2Fx': jsonResponse({ idReadable: 'x' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    await client.getIssue('../../x')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/..%2F..%2Fx?fields=${ISSUE_FIELDS}`)
  })

  test('getIssue throws on a non-2xx response', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-404': jsonResponse({ error: 'not found' }, 404),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackClient({ baseUrl, token, httpFetch })

    await expect(client.getIssue('P-404')).rejects.toThrow('YouTrack API 404')
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
    pluginId: 'mcp-youtrack',
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
      allowedHosts: new Set(['yt.test']),
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

  const baseUrl = 'baseUrl' in overrides ? overrides.baseUrl : 'https://yt.test'
  const token = 'token' in overrides ? overrides.token : 'tok'

  return {
    pluginId: 'mcp-youtrack',
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
      get: (key: string) => (key === 'base_url' ? baseUrl : undefined),
    },
    contextConfig: {
      get: (key: string) => (key === 'token' ? token : undefined),
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
  } as PluginToolRuntimeContext
}

function createMockOptions(): ToolExecutionOptions {
  return {
    toolCallId: 'test-call-id',
    messages: [],
  }
}

describe('mcp-youtrack plugin', () => {
  test('activates and registers all 14 YouTrack tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'youtrack_get_issue',
        'youtrack_get_state_activities',
        'youtrack_get_comments',
        'youtrack_get_issue_tags',
        'youtrack_get_field_options',
        'youtrack_get_attachments',
        'youtrack_read_attachment',
        'youtrack_add_comment',
        'youtrack_create_issue',
        'youtrack_update_fields',
        'youtrack_add_issue_tag',
        'youtrack_remove_issue_tag',
        'youtrack_set_tags',
        'youtrack_set_issue_link',
      ].sort(),
    )
  })

  test('youtrack_get_issue returns the shaped issue and calls the correct URL', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/issues/P-1': jsonResponse({ idReadable: 'P-1', summary: 'S', junk: 'drop' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_get_issue')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1' }, runtimeCtx, options)

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-1?fields=${ISSUE_FIELDS}`)
    expect(result).toEqual({ idReadable: 'P-1', summary: 'S' })
  })

  test('returns not_configured when the context token is missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_get_issue')!
    const runtimeCtx = createMockRuntimeContext({ token: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'YouTrack is not configured' })
  })

  test('returns not_configured when the admin base_url is missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_get_issue')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'YouTrack is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_get_issue')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns youtrack_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_get_issue')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'youtrack_error', message: 'Connection refused' })
  })
})
