// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import {
  BUILD_TYPES_LIST_FIELDS,
  PROJECT_FIELDS,
  PROJECTS_LIST_FIELDS,
  TeamCityClient,
} from '../../plugins/mcp-teamcity/client.js'
import { sanitizeTeamCityConfig } from '../../plugins/mcp-teamcity/format.js'
import factory from '../../plugins/mcp-teamcity/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-teamcity sanitizeTeamCityConfig', () => {
  test('redacts a deeply nested secret inside a build-config tree', () => {
    const input = {
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: {
              property: [
                { name: 'env.SECRET_TOKEN', value: 'abc' },
                { name: 'system.foo', value: 'ok' },
              ],
            },
          },
        ],
      },
    }

    const result = sanitizeTeamCityConfig(input)

    expect(result).toEqual({
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: {
              property: [
                { name: 'env.SECRET_TOKEN', value: '[REDACTED]' },
                { name: 'system.foo', value: 'ok' },
              ],
            },
          },
        ],
      },
    })
  })

  test('regex covers common secret-name patterns and spares non-secret names', () => {
    const secretNames = ['password', 'apiToken', 'db.secret', 'ssh_key', 'my.credential.x']
    for (const name of secretNames) {
      const result = sanitizeTeamCityConfig({ name, value: 'v' })
      expect(result).toEqual({ name, value: '[REDACTED]' })
    }

    const nonSecretNames = ['buildNumber', 'system.teamcity.version', 'id']
    for (const name of nonSecretNames) {
      const result = sanitizeTeamCityConfig({ name, value: 'v' })
      expect(result).toEqual({ name, value: 'v' })
    }
  })

  test('does not redact falsy secret values', () => {
    expect(sanitizeTeamCityConfig({ name: 'token', value: '' })).toEqual({ name: 'token', value: '' })
    expect(sanitizeTeamCityConfig({ name: 'token', value: 0 })).toEqual({ name: 'token', value: 0 })
    expect(sanitizeTeamCityConfig({ name: 'token' })).toEqual({ name: 'token' })
  })

  test('redacts top-level parameters', () => {
    const input = { parameters: { property: [{ name: 'secret.x', value: 'y' }] } }

    const result = sanitizeTeamCityConfig(input)

    expect(result).toEqual({ parameters: { property: [{ name: 'secret.x', value: '[REDACTED]' }] } })
  })

  test('does not mutate the original input', () => {
    const original = {
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: {
              property: [{ name: 'env.SECRET_TOKEN', value: 'abc' }],
            },
          },
        ],
      },
    }

    sanitizeTeamCityConfig(original)

    expect(original.steps.step[0]?.properties.property[0]?.value).toBe('abc')
  })

  test('passes through non-record inputs unchanged', () => {
    expect(sanitizeTeamCityConfig(null)).toBe(null)
    expect(sanitizeTeamCityConfig('x')).toBe('x')
    expect(sanitizeTeamCityConfig(42)).toBe(42)
    expect(sanitizeTeamCityConfig([1, 'a', { name: 'token', value: 'z' }])).toEqual([
      1,
      'a',
      { name: 'token', value: '[REDACTED]' },
    ])
  })

  test('does not redact when name is not a string', () => {
    const result = sanitizeTeamCityConfig({ name: 123, value: 'x' })

    expect(result).toEqual({ name: 123, value: 'x' })
  })
})

interface CapturedRequest {
  url: string
  headers: Record<string, string>
}

interface MockHttpFetchResponse {
  status?: number
  body: unknown
}

interface MockHttpFetch {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: CapturedRequest[]
}

function headersToRecord(headers: RequestInit['headers']): Record<string, string> {
  const record: Record<string, string> = {}
  if (headers === undefined || headers instanceof Headers || Array.isArray(headers)) {
    return record
  }
  for (const [k, v] of Object.entries(headers)) {
    record[k] = v
  }
  return record
}

function createMockHttpFetch(
  responses: MockHttpFetchResponse | ((captured: CapturedRequest) => MockHttpFetchResponse),
): MockHttpFetch {
  const captured: CapturedRequest[] = []
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    const record = { url, headers: headersToRecord(init?.headers) }
    captured.push(record)
    const resolved = typeof responses === 'function' ? responses(record) : responses
    const status = resolved.status ?? 200
    return Promise.resolve(new Response(JSON.stringify(resolved.body), { status }))
  }
  return { httpFetch, captured }
}

describe('TeamCityClient', () => {
  test('getProjects() requests the projects list with field selection and auth headers', async () => {
    const { httpFetch, captured } = createMockHttpFetch({ body: { project: [{ id: 'A' }] } })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    const result = await client.getProjects()

    expect(captured).toHaveLength(1)
    const req = captured[0]!
    expect(req.url.startsWith('https://tc.test/app/rest/projects?fields=')).toBe(true)
    const parsedUrl = new URL(req.url)
    expect(parsedUrl.searchParams.get('fields')).toBe(PROJECTS_LIST_FIELDS)
    expect(req.headers['Authorization']).toBe('Bearer tok')
    expect(req.headers['Accept']).toBe('application/json')
    expect(result).toEqual([{ id: 'A' }])
  })

  test('getProjects() returns [] when the response has no project array', async () => {
    const { httpFetch } = createMockHttpFetch({ body: {} })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    const result = await client.getProjects()

    expect(result).toEqual([])
  })

  test('getProjectConfig() requests the project by id and sanitizes the response', async () => {
    const { httpFetch, captured } = createMockHttpFetch({
      body: { id: 'MyProj', parameters: { property: [{ name: 'secret.x', value: 'zzz' }] } },
    })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    const result = await client.getProjectConfig('MyProj')

    const req = captured[0]!
    expect(req.url.startsWith('https://tc.test/app/rest/projects/id:MyProj?fields=')).toBe(true)
    const parsedUrl = new URL(req.url)
    expect(parsedUrl.searchParams.get('fields')).toBe(PROJECT_FIELDS)
    expect(result).toEqual({
      id: 'MyProj',
      parameters: { property: [{ name: 'secret.x', value: '[REDACTED]' }] },
    })
  })

  test('getProjectBuildTypes() requests build types under a project', async () => {
    const { httpFetch, captured } = createMockHttpFetch({ body: { buildType: [{ id: 'Bt_1' }] } })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    const result = await client.getProjectBuildTypes('MyProj')

    const req = captured[0]!
    expect(req.url.startsWith('https://tc.test/app/rest/projects/id:MyProj/buildTypes?fields=')).toBe(true)
    const parsedUrl = new URL(req.url)
    expect(parsedUrl.searchParams.get('fields')).toBe(BUILD_TYPES_LIST_FIELDS)
    expect(result).toEqual([{ id: 'Bt_1' }])
  })

  test('getProjectBuildTypes() returns [] when the response has no buildType array', async () => {
    const { httpFetch } = createMockHttpFetch({ body: {} })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    const result = await client.getProjectBuildTypes('MyProj')

    expect(result).toEqual([])
  })

  test('getBuildTypeConfig() requests the build type by id and sanitizes secrets nested in steps', async () => {
    const { httpFetch, captured } = createMockHttpFetch({
      body: {
        id: 'Bt_1',
        steps: {
          step: [
            {
              id: 'RUNNER_1',
              properties: { property: [{ name: 'env.DEPLOY_TOKEN', value: 'abc' }] },
            },
          ],
        },
      },
    })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    const result = await client.getBuildTypeConfig('Bt_1')

    const req = captured[0]!
    expect(req.url.startsWith('https://tc.test/app/rest/buildTypes/id:Bt_1?fields=')).toBe(true)
    expect(result).toEqual({
      id: 'Bt_1',
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: { property: [{ name: 'env.DEPLOY_TOKEN', value: '[REDACTED]' }] },
          },
        ],
      },
    })
  })

  test('percent-encodes locator values so path traversal cannot escape the projects path', async () => {
    const { httpFetch, captured } = createMockHttpFetch({ body: { id: 'x' } })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    await client.getProjectConfig('../../x')

    const req = captured[0]!
    const parsedUrl = new URL(req.url)
    expect(parsedUrl.pathname.startsWith('/app/rest/projects/')).toBe(true)
    expect(parsedUrl.pathname).not.toContain('/app/rest/x')
    expect(req.url).toContain('id:..%2F..%2Fx')
  })

  test('rejects when the response is not ok', async () => {
    const { httpFetch } = createMockHttpFetch({ status: 404, body: { message: 'not found' } })
    const client = new TeamCityClient({ baseUrl: 'https://tc.test', token: 'tok', httpFetch })

    await expect(client.getProjectConfig('MyProj')).rejects.toThrow('TeamCity API 404')
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
    pluginId: 'mcp-teamcity',
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
      allowedHosts: new Set(['tc.test']),
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
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://tc.test',
    token: 'token' in overrides ? overrides.token : 'tok',
  }

  return {
    pluginId: 'mcp-teamcity',
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

describe('mcp-teamcity plugin', () => {
  test('activates and registers all 4 TeamCity tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'teamcity_get_projects',
        'teamcity_get_project_config',
        'teamcity_get_project_pipelines',
        'teamcity_get_pipeline_config',
      ].sort(),
    )
  })

  test('teamcity_get_projects requires no input and returns the projects list', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ project: [{ id: 'A' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_projects')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(capturedUrl.startsWith('https://tc.test/app/rest/projects?fields=')).toBe(true)
    expect(result).toEqual([{ id: 'A' }])
  })

  test('returns not_configured when admin creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_projects')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'TeamCity is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_projects')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns teamcity_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_projects')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'teamcity_error', message: 'Connection refused' })
  })

  test('returns timeout when httpFetch aborts', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    const httpFetch = (): Promise<Response> => Promise.reject(abortError)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_projects')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'timeout', message: 'The operation was aborted' })
  })

  test('teamcity_get_project_config validates required projectId and calls getProjectConfig', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'MyProj' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_project_config')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ projectId: 'MyProj' }, runtimeCtx, options)

    expect(capturedUrl.startsWith('https://tc.test/app/rest/projects/id:MyProj?fields=')).toBe(true)
    expect(result).toEqual({ id: 'MyProj' })

    const validationResult = await tool.execute({}, runtimeCtx, options)
    expect(validationResult).toEqual({ error: 'validation_error', message: 'projectId must be a non-empty string' })
  })

  test('teamcity_get_project_pipelines calls getProjectBuildTypes', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ buildType: [{ id: 'Bt_1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_project_pipelines')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ projectId: 'MyProj' }, runtimeCtx, options)

    expect(capturedUrl.startsWith('https://tc.test/app/rest/projects/id:MyProj/buildTypes?fields=')).toBe(true)
    expect(result).toEqual([{ id: 'Bt_1' }])
  })

  test('teamcity_get_pipeline_config calls getBuildTypeConfig', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'Bt_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('teamcity_get_pipeline_config')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ buildTypeId: 'Bt_1' }, runtimeCtx, options)

    expect(capturedUrl.startsWith('https://tc.test/app/rest/buildTypes/id:Bt_1?fields=')).toBe(true)
    expect(result).toEqual({ id: 'Bt_1' })
  })
})
