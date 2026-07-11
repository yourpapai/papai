// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import {
  buildCustomFieldValue,
  fieldTypeToValueType,
  findIssueLink,
  ISSUE_LINK_FIELDS,
  linkMatches,
} from '../../plugins/mcp-youtrack/format-writes.js'
import factory from '../../plugins/mcp-youtrack/index.js'
import { YouTrackWriteClient } from '../../plugins/mcp-youtrack/write-client.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-youtrack write helpers', () => {
  describe('fieldTypeToValueType', () => {
    test('SingleUserIssueCustomField -> User', () => {
      expect(fieldTypeToValueType('SingleUserIssueCustomField')).toBe('User')
    })

    test('MultiUserIssueCustomField -> User', () => {
      expect(fieldTypeToValueType('MultiUserIssueCustomField')).toBe('User')
    })

    test('SingleGroupIssueCustomField -> UserGroup', () => {
      expect(fieldTypeToValueType('SingleGroupIssueCustomField')).toBe('UserGroup')
    })

    test('StateIssueCustomField -> StateBundleElement', () => {
      expect(fieldTypeToValueType('StateIssueCustomField')).toBe('StateBundleElement')
    })

    test('SingleVersionIssueCustomField -> VersionBundleElement', () => {
      expect(fieldTypeToValueType('SingleVersionIssueCustomField')).toBe('VersionBundleElement')
    })

    test('SingleBuildIssueCustomField -> BuildBundleElement', () => {
      expect(fieldTypeToValueType('SingleBuildIssueCustomField')).toBe('BuildBundleElement')
    })

    test('SingleOwnedIssueCustomField -> OwnedBundleElement', () => {
      expect(fieldTypeToValueType('SingleOwnedIssueCustomField')).toBe('OwnedBundleElement')
    })

    test('MultiEnumIssueCustomField -> EnumBundleElement', () => {
      expect(fieldTypeToValueType('MultiEnumIssueCustomField')).toBe('EnumBundleElement')
    })

    test('SimpleIssueCustomField -> EnumBundleElement (fallback)', () => {
      expect(fieldTypeToValueType('SimpleIssueCustomField')).toBe('EnumBundleElement')
    })
  })

  describe('buildCustomFieldValue', () => {
    test('single enum field wraps name', () => {
      expect(buildCustomFieldValue('SingleEnumIssueCustomField', 'High')).toEqual({
        $type: 'EnumBundleElement',
        name: 'High',
      })
    })

    test('single user field wraps login', () => {
      expect(buildCustomFieldValue('SingleUserIssueCustomField', 'jdoe')).toEqual({
        $type: 'User',
        login: 'jdoe',
      })
    })

    test('multi enum field maps array of values', () => {
      expect(buildCustomFieldValue('MultiEnumIssueCustomField', ['a', 'b'])).toEqual([
        { $type: 'EnumBundleElement', name: 'a' },
        { $type: 'EnumBundleElement', name: 'b' },
      ])
    })

    test('multi enum field wraps non-array value in array', () => {
      expect(buildCustomFieldValue('MultiEnumIssueCustomField', 'a')).toEqual([
        { $type: 'EnumBundleElement', name: 'a' },
      ])
    })

    test('single enum field with array value picks value[0]', () => {
      expect(buildCustomFieldValue('SingleEnumIssueCustomField', ['x', 'y'])).toEqual({
        $type: 'EnumBundleElement',
        name: 'x',
      })
    })

    test('state field with null value returns null', () => {
      expect(buildCustomFieldValue('StateIssueCustomField', null)).toBeNull()
    })

    test('period field with numeric value returns minutes', () => {
      expect(buildCustomFieldValue('PeriodIssueCustomField', 90)).toEqual({ minutes: 90 })
    })

    test('period field with string value returns presentation', () => {
      expect(buildCustomFieldValue('PeriodIssueCustomField', '1h 30m')).toEqual({ presentation: '1h 30m' })
    })

    test('text field wraps text', () => {
      expect(buildCustomFieldValue('TextIssueCustomField', 'hello')).toEqual({ text: 'hello' })
    })

    test('simple field passes value through', () => {
      expect(buildCustomFieldValue('SimpleIssueCustomField', 42)).toBe(42)
    })

    test('date field passes value through', () => {
      expect(buildCustomFieldValue('DateIssueCustomField', '2026-01-01')).toBe('2026-01-01')
    })

    test('null short-circuits before the enum/user branch', () => {
      expect(buildCustomFieldValue('SingleUserIssueCustomField', null)).toBeNull()
    })
  })

  describe('linkMatches / findIssueLink', () => {
    test('finds link by direction label matching linkType name', () => {
      const links = [
        {
          id: 's1',
          linkType: { name: 'relates', sourceToTarget: 'relates to', targetToSource: 'relates to' },
        },
      ]
      expect(findIssueLink(links, 'relates', 'sourceToTarget')).toEqual({ id: 's1' })
    })

    test('finds link by directional label', () => {
      const links = [
        {
          id: 's2',
          linkType: { name: 'Depend', sourceToTarget: 'is required for', targetToSource: 'depends on' },
        },
      ]
      expect(findIssueLink(links, 'depends on', 'targetToSource')).toEqual({ id: 's2' })
    })

    test('matches case-insensitively and trims whitespace', () => {
      const links = [{ id: 's3', linkType: { name: 'Relates' } }]
      expect(findIssueLink(links, '  RELATES  ', 'sourceToTarget')).toEqual({ id: 's3' })
    })

    test('returns undefined when no link matches', () => {
      const links = [{ id: 's1', linkType: { name: 'relates' } }]
      expect(findIssueLink(links, 'blocks', 'sourceToTarget')).toBeUndefined()
    })

    test('returns undefined for non-array links', () => {
      expect(findIssueLink('not-an-array', 'relates', 'sourceToTarget')).toBeUndefined()
      expect(findIssueLink(null, 'relates', 'sourceToTarget')).toBeUndefined()
      expect(findIssueLink(undefined, 'relates', 'sourceToTarget')).toBeUndefined()
    })

    test('skips a matching link without a string id', () => {
      const links = [{ linkType: { name: 'relates' } }, { id: 's4', linkType: { name: 'relates' } }]
      expect(findIssueLink(links, 'relates', 'sourceToTarget')).toEqual({ id: 's4' })
    })

    test('empty linkType string never matches', () => {
      expect(linkMatches({ id: 's1', linkType: { name: '' } }, '', 'sourceToTarget')).toBe(false)
    })

    test('linkMatches returns false for non-record link', () => {
      expect(linkMatches(null, 'relates', 'sourceToTarget')).toBe(false)
      expect(linkMatches('str', 'relates', 'sourceToTarget')).toBe(false)
    })

    test('linkMatches returns false when linkType is not a record', () => {
      expect(linkMatches({ id: 's1', linkType: 'relates' }, 'relates', 'sourceToTarget')).toBe(false)
      expect(linkMatches({ id: 's1' }, 'relates', 'sourceToTarget')).toBe(false)
    })
  })
})

type CapturedCall = { url: string; init: RequestInit | undefined }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function routeKey(method: string, pathname: string): string {
  return `${method} ${pathname}`
}

function createRoutedHttpFetch(
  routes: Record<string, Response>,
  calls: CapturedCall[],
): (url: string, init: RequestInit | undefined) => Promise<Response> {
  return (url: string, init: RequestInit | undefined): Promise<Response> => {
    calls.push({ url, init })
    const pathname = new URL(url).pathname
    const method = init?.method ?? 'GET'
    const route = routes[routeKey(method, pathname)]
    return Promise.resolve(route ?? jsonResponse({ error: `unexpected ${method} ${pathname}` }, 404))
  }
}

function hasCallTo(calls: CapturedCall[], url: string, method: string): boolean {
  return calls.some((c) => c.url === url && c.init?.method === method)
}

function findCall(calls: CapturedCall[], url: string, method: string): CapturedCall | undefined {
  return calls.find((c) => c.url === url && c.init?.method === method)
}

function findCallByMethod(calls: CapturedCall[], method: string): CapturedCall | undefined {
  return calls.find((c) => c.init?.method === method)
}

function parseJsonBody(body: RequestInit['body']): unknown {
  return typeof body === 'string' ? JSON.parse(body) : undefined
}

describe('YouTrackWriteClient tags + links', () => {
  const baseUrl = 'https://yt.test'
  const token = 'tok'

  test('addIssueTag resolves the tag by name then posts it to the issue', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/tags')]: jsonResponse([{ id: 't9', name: 'bug' }]),
      [routeKey('POST', '/api/issues/P-1/tags')]: jsonResponse({ id: 't9', name: 'bug' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.addIssueTag('P-1', 'bug')

    expect(calls[0]?.url).toBe('https://yt.test/api/tags?fields=id,name&query=bug')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(calls[1]?.url).toBe('https://yt.test/api/issues/P-1/tags?fields=id,name')
    expect(calls[1]?.init?.method).toBe('POST')
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ id: 't9' }))
    expect(result).toContain('bug')
    expect(result).toContain('P-1')
  })

  test('addIssueTag rejects when no exact tag name match is found', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/tags')]: jsonResponse([]),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await expect(client.addIssueTag('P-1', 'bug')).rejects.toThrow(/not found/u)
  })

  test('addIssueTag rejects when multiple exact tag name matches are found', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/tags')]: jsonResponse([
        { id: 't1', name: 'bug' },
        { id: 't2', name: 'bug' },
      ]),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await expect(client.addIssueTag('P-1', 'bug')).rejects.toThrow(/Ambiguous/u)
  })

  test('removeIssueTag resolves the tag by name then deletes it from the issue', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/tags')]: jsonResponse([{ id: 't9', name: 'bug' }]),
      [routeKey('DELETE', '/api/issues/P-1/tags/t9')]: jsonResponse(undefined, 204),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.removeIssueTag('P-1', 'bug')

    expect(calls[1]?.url).toBe('https://yt.test/api/issues/P-1/tags/t9')
    expect(calls[1]?.init?.method).toBe('DELETE')
    expect(result).toContain('bug')
    expect(result).toContain('P-1')
  })

  test('setTags adds only the missing tags and leaves existing ones alone', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-1/tags')]: jsonResponse([{ id: 't1', name: 'a' }]),
      [routeKey('GET', '/api/tags')]: jsonResponse([{ id: 't2', name: 'b' }]),
      [routeKey('POST', '/api/issues/P-1/tags')]: jsonResponse({ id: 't2', name: 'b' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.setTags('P-1', ['a', 'b'])

    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)
    const resolveCall = calls.find((c) => c.url.startsWith('https://yt.test/api/tags'))
    expect(resolveCall?.url).toBe('https://yt.test/api/tags?fields=id,name&query=b')
    const postCall = calls.find((c) => c.init?.method === 'POST')
    expect(postCall?.url).toBe('https://yt.test/api/issues/P-1/tags?fields=id,name')
    expect(postCall?.init?.body).toBe(JSON.stringify({ id: 't2' }))
    expect(result).toContain('a')
    expect(result).toContain('b')
  })

  test('setTags removes all current tags when the desired list is empty', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-1/tags')]: jsonResponse([{ id: 't1', name: 'a' }]),
      [routeKey('DELETE', '/api/issues/P-1/tags/t1')]: jsonResponse(undefined, 204),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.setTags('P-1', [])

    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
    expect(hasCallTo(calls, 'https://yt.test/api/issues/P-1/tags/t1', 'DELETE')).toBe(true)
    expect(result).toBe('Tags set on P-1: ')
  })

  test('setIssueLink sourceToTarget posts to the source issue link slot', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-1')]: jsonResponse({
        links: [{ id: 'slot1', linkType: { name: 'relates', sourceToTarget: 'relates to' } }],
      }),
      [routeKey('POST', '/api/issues/P-1/links/slot1/issues')]: jsonResponse({}),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.setIssueLink('P-1', 'P-2', 'relates', 'sourceToTarget')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-1?fields=${ISSUE_LINK_FIELDS}`)
    const postCall = calls[1]
    expect(postCall?.url).toBe('https://yt.test/api/issues/P-1/links/slot1/issues')
    expect(postCall?.init?.method).toBe('POST')
    expect(postCall?.init?.body).toBe(JSON.stringify({ id: 'P-2' }))
    expect(result).toContain('relates')
    expect(result).toContain('P-1')
    expect(result).toContain('P-2')
  })

  test('setIssueLink targetToSource posts to the target issue link slot with reversed ids', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-2')]: jsonResponse({
        links: [{ id: 'slot2', linkType: { name: 'relates', targetToSource: 'relates to' } }],
      }),
      [routeKey('POST', '/api/issues/P-2/links/slot2/issues')]: jsonResponse({}),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await client.setIssueLink('P-1', 'P-2', 'relates', 'targetToSource')

    expect(calls[0]?.url).toBe(`https://yt.test/api/issues/P-2?fields=${ISSUE_LINK_FIELDS}`)
    const postCall = calls[1]
    expect(postCall?.url).toBe('https://yt.test/api/issues/P-2/links/slot2/issues')
    expect(postCall?.init?.body).toBe(JSON.stringify({ id: 'P-1' }))
  })

  test('setIssueLink rejects when the link type has no matching slot', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-1')]: jsonResponse({ links: [] }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await expect(client.setIssueLink('P-1', 'P-2', 'blocks', 'sourceToTarget')).rejects.toThrow(/Link type not found/u)
  })

  test('addIssueTag encodes a traversal-like issue id in the tag POST path', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/tags')]: jsonResponse([{ id: 't9', name: 'bug' }]),
      [routeKey('POST', '/api/issues/..%2F..%2Fx/tags')]: jsonResponse({}),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await client.addIssueTag('../../x', 'bug')

    expect(calls[1]?.url).toBe('https://yt.test/api/issues/..%2F..%2Fx/tags?fields=id,name')
  })
})

describe('YouTrackWriteClient issues', () => {
  const baseUrl = 'https://yt.test'
  const token = 'tok'

  test('createIssue resolves a non-numeric project short name before creating', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/admin/projects/MYPROJ')]: jsonResponse({ id: '0-5' }),
      [routeKey('POST', '/api/issues')]: jsonResponse({ idReadable: '0-5-1', summary: 'S' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.createIssue({ project: 'MYPROJ', summary: 'S' })

    expect(calls[0]?.url).toBe('https://yt.test/api/admin/projects/MYPROJ?fields=id')
    const postCall = findCallByMethod(calls, 'POST')
    expect(postCall).toBeDefined()
    const body = parseJsonBody(postCall?.init?.body)
    expect(body).toMatchObject({ project: { id: '0-5' }, summary: 'S' })
    expect(result).toMatchObject({ idReadable: '0-5-1', summary: 'S' })
  })

  test('createIssue skips project resolution when project is already a numeric id', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('POST', '/api/issues')]: jsonResponse({ idReadable: '0-5-1', summary: 'S' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await client.createIssue({ project: '0-5', summary: 'S' })

    expect(calls.some((c) => c.url.includes('/admin/projects'))).toBe(false)
    const postCall = findCallByMethod(calls, 'POST')
    const body = parseJsonBody(postCall?.init?.body)
    expect(body).toMatchObject({ project: { id: '0-5' } })
  })

  test('createIssue with customFields and referenceIssueId resolves field types then builds values', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-9')]: jsonResponse({
        customFields: [{ name: 'Priority', $type: 'SingleEnumIssueCustomField' }],
      }),
      [routeKey('POST', '/api/issues')]: jsonResponse({ idReadable: '0-5-1', summary: 'S' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await client.createIssue({
      project: '0-5',
      summary: 'S',
      customFields: { Priority: 'High' },
      referenceIssueId: 'P-9',
    })

    expect(calls[0]?.url).toBe('https://yt.test/api/issues/P-9?fields=customFields(name,$type)')
    const postCall = findCallByMethod(calls, 'POST')
    const body = parseJsonBody(postCall?.init?.body)
    expect(body).toMatchObject({
      customFields: [
        { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { $type: 'EnumBundleElement', name: 'High' } },
      ],
    })
  })

  test('createIssue re-posts the summary when the server returns a different one', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('POST', '/api/issues')]: jsonResponse({ idReadable: '0-5-1', summary: 'Server-mangled summary' }),
      [routeKey('POST', '/api/issues/0-5-1')]: jsonResponse({ idReadable: '0-5-1', summary: 'S' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    const result = await client.createIssue({ project: '0-5', summary: 'S' })

    const fixupCall = findCall(calls, 'https://yt.test/api/issues/0-5-1', 'POST')
    expect(fixupCall).toBeDefined()
    expect(fixupCall?.init?.body).toBe(JSON.stringify({ summary: 'S' }))
    expect(result).toMatchObject({ summary: 'S' })
  })

  test('updateFields resolves field types then posts built custom field values', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-1')]: jsonResponse({
        customFields: [{ name: 'Priority', $type: 'SingleEnumIssueCustomField' }],
      }),
      [routeKey('POST', '/api/issues/P-1')]: jsonResponse({ idReadable: 'P-1', summary: 'S' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await client.updateFields('P-1', { Priority: 'Low' })

    expect(calls[0]?.url).toBe('https://yt.test/api/issues/P-1?fields=customFields(name,$type)')
    const postCall = findCallByMethod(calls, 'POST')
    expect(postCall?.url).toContain('https://yt.test/api/issues/P-1?fields=')
    const body = parseJsonBody(postCall?.init?.body)
    expect(body).toMatchObject({
      customFields: [
        { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { $type: 'EnumBundleElement', name: 'Low' } },
      ],
    })
  })

  test('updateFields rejects on an unknown field name', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/issues/P-1')]: jsonResponse({
        customFields: [{ name: 'Priority', $type: 'SingleEnumIssueCustomField' }],
      }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await expect(client.updateFields('P-1', { Nonexistent: 'x' })).rejects.toThrow(/Unknown field/u)
  })

  test('updateFields rejects when given no fields', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {}
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new YouTrackWriteClient({ baseUrl, token, httpFetch })

    await expect(client.updateFields('P-1', {})).rejects.toThrow(/No fields/u)
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

describe('mcp-youtrack write plugin', () => {
  test('activate registers 14 tools including the 6 write tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect(registeredTools.size).toBe(14)
    const names = new Set(registeredTools.keys())
    for (const name of [
      'youtrack_create_issue',
      'youtrack_update_fields',
      'youtrack_add_issue_tag',
      'youtrack_remove_issue_tag',
      'youtrack_set_tags',
      'youtrack_set_issue_link',
    ]) {
      expect(names.has(name)).toBe(true)
    }
  })

  test('youtrack_add_issue_tag resolves the tag then posts it to the issue', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('GET', '/api/tags')]: jsonResponse([{ id: 't9', name: 'bug' }]),
      [routeKey('POST', '/api/issues/P-1/tags')]: jsonResponse({ id: 't9', name: 'bug' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_add_issue_tag')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1', tagName: 'bug' }, runtimeCtx, options)

    expect(result).toBe('Tag "bug" added to P-1')
  })

  test('youtrack_create_issue returns the shaped created issue', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      [routeKey('POST', '/api/issues')]: jsonResponse({ idReadable: '0-5-1', summary: 'S' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_create_issue')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ project: '0-5', summary: 'S' }, runtimeCtx, options)

    expect(result).toEqual({ idReadable: '0-5-1', summary: 'S' })
  })

  test('a write tool returns not_configured when creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_create_issue')!
    const runtimeCtx = createMockRuntimeContext({ token: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ project: '0-5', summary: 'S' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'YouTrack is not configured' })
  })

  test('a write tool returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('youtrack_set_tags')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 12 })
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'P-1', tags: ['a'] }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 12 })
  })
})
