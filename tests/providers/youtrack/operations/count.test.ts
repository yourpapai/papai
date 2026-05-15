// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import { countYouTrackTasks } from '../../../../src/providers/youtrack/operations/count.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>> | undefined
const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: () => Promise<Response>): void => {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
}

const createJsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  installFetchMock(() => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(createJsonResponse({}, 200))
    }
    return Promise.resolve(createJsonResponse(response.data, response.status ?? 200))
  })
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.looseObject({})

const getFetchUrlAt = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchMethodAt = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const getFetchBodyAt = (index: number): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
  fetchMock = undefined
})

describe('countYouTrackTasks', () => {
  test('retries after a short delay until the count api returns a concrete value', async () => {
    mockFetchSequence([{ data: { count: -1 } }, { data: { count: 7 } }])
    const startedAt = Date.now()

    const count = await countYouTrackTasks(config, { query: 'State: Open' })

    expect(count).toBe(7)
    expect(fetchMock?.mock.calls).toHaveLength(2)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(450)
    expect(getFetchUrlAt(0).pathname).toBe('/api/issuesGetter/count')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('count')
    expect(getFetchMethodAt(0)).toBe('POST')
    expect(getFetchBodyAt(0)).toEqual({ query: 'State: Open' })
  })

  test('prefixes project short name when projectId is provided', async () => {
    mockFetchSequence([{ data: { id: '0-1', shortName: 'PROJ', name: 'Project' } }, { data: { count: 5 } }])

    const count = await countYouTrackTasks(config, { query: 'assignee: me', projectId: '0-1' })

    expect(count).toBe(5)
    expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/0-1')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,name,shortName,description,archived')
    expect(getFetchMethodAt(0)).toBe('GET')
    expect(getFetchUrlAt(1).pathname).toBe('/api/issuesGetter/count')
    expect(getFetchBodyAt(1)).toEqual({ query: 'project: {PROJ} assignee: me' })
  })

  test('throws classified error after exhausting retries', async () => {
    mockFetchSequence([{ data: { count: -1 } }, { data: { count: -1 } }, { data: { count: -1 } }])

    await expect(countYouTrackTasks(config, { query: 'bug' })).rejects.toBeInstanceOf(YouTrackClassifiedError)
    expect(fetchMock?.mock.calls).toHaveLength(3)
  })
})
