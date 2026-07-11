// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BUILD_TYPES_LIST_FIELDS,
  PROJECT_FIELDS,
  PROJECTS_LIST_FIELDS,
  TeamCityClient,
} from '../../plugins/mcp-teamcity/client.js'
import { sanitizeTeamCityConfig } from '../../plugins/mcp-teamcity/format.js'

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
