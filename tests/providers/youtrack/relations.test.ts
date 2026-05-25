// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import {
  addYouTrackRelation,
  removeYouTrackRelation,
  updateYouTrackRelation,
} from '../../../src/providers/youtrack/relations.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: () => Promise<Response>): void => {
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1]!
    callIndex++
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchUrl = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const BodySchema = z.looseObject({})

const getFetchBody = (index: number): Record<string, unknown> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getFetchMethod = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

beforeEach(() => {
  mockLogger()
})

describe('addYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('uses REST API instead of command', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-123/links')
    expect(getFetchMethod(0)).toBe('POST')
    const body = getFetchBody(0)
    expect(body).toEqual({
      linkType: { name: 'depends' },
      direction: 'OUTWARD',
      issues: [{ id: 'PROJ-456' }],
    })
  })

  test('uses correct direction for blocked_by', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocked_by')

    const body = getFetchBody(0)
    expect(body['direction']).toBe('INWARD')
  })

  test('uses correct linkType for duplicate', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate')

    const body = getFetchBody(0)
    expect(body['linkType']).toEqual({ name: 'duplicate' })
    expect(body['direction']).toBe('OUTWARD')
  })

  test('uses correct direction for duplicate_of', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate_of')

    const body = getFetchBody(0)
    expect(body['linkType']).toEqual({ name: 'duplicate' })
    expect(body['direction']).toBe('INWARD')
  })

  test('uses correct linkType for parent', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'parent')

    const body = getFetchBody(0)
    expect(body['linkType']).toEqual({ name: 'subtask' })
    expect(body['direction']).toBe('OUTWARD')
  })

  test('uses correct linkType for related', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'related')

    const body = getFetchBody(0)
    expect(body['linkType']).toEqual({ name: 'relates' })
  })

  test('uses correct linkType and direction for child', async () => {
    mockFetchResponse({ id: 'link-1' })

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'child')

    const body = getFetchBody(0)
    expect(body['linkType']).toEqual({ name: 'subtask' })
    expect(body['direction']).toBe('INWARD')
  })
})

describe('removeYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('uses REST DELETE endpoint', async () => {
    mockFetchSequence([
      {
        data: {
          id: 'issue-1',
          links: [
            {
              id: 'link-1',
              direction: 'OUTWARD',
              linkType: { id: 'lt-1', name: 'depends' },
              issues: [{ id: 'PROJ-456', idReadable: 'PROJ-456' }],
            },
          ],
        },
      },
      { data: {} },
    ])

    await removeYouTrackRelation(config, 'PROJ-123', 'PROJ-456')

    const firstUrl = getFetchUrl(0)
    expect(firstUrl.pathname).toBe('/api/issues/PROJ-123')
    expect(getFetchMethod(0)).toBe('GET')

    const secondUrl = getFetchUrl(1)
    expect(secondUrl.pathname).toBe('/api/issues/PROJ-123/links/link-1')
    expect(getFetchMethod(1)).toBe('DELETE')
  })

  test('throws when relation not found', async () => {
    mockFetchResponse({ id: 'issue-1', links: [] })

    await expect(removeYouTrackRelation(config, 'PROJ-123', 'PROJ-456')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes old relation and adds new one', async () => {
    mockFetchSequence([
      {
        data: {
          id: 'issue-1',
          links: [
            {
              id: 'link-1',
              direction: 'OUTWARD',
              linkType: { id: 'lt-1', name: 'depends' },
              issues: [{ id: 'PROJ-456', idReadable: 'PROJ-456' }],
            },
          ],
        },
      },
      { data: {} },
      { data: { id: 'link-2' } },
    ])

    await updateYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate')

    expect(fetchMock.mock.calls).toHaveLength(3)
    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-123/links/link-1')
    expect(getFetchMethod(1)).toBe('DELETE')
    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links')
    expect(getFetchMethod(2)).toBe('POST')
  })
})
