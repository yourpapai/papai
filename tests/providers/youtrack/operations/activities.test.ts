// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { extractAppError } from '../../../../src/errors.js'
import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import { getYouTrackTaskHistory } from '../../../../src/providers/youtrack/operations/activities.js'
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

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[0])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[0])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const makeActivityResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'activity-1',
  timestamp: 1700000000000,
  author: {
    id: 'user-1',
    login: 'alice',
    fullName: 'Alice Example',
  },
  category: { id: 'SprintCategory' },
  field: { name: 'Sprint' },
  added: [{ name: 'Sprint 1' }, { presentation: 'Sprint 2' }],
  removed: { text: 'Backlog' },
  ...overrides,
})

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
  fetchMock = undefined
})

describe('getYouTrackTaskHistory', () => {
  test('uses default categories and maps activity values', async () => {
    mockFetchResponse([makeActivityResponse()])

    const activities = await getYouTrackTaskHistory(config, 'TEST-1')

    expect(activities).toEqual([
      {
        id: 'activity-1',
        timestamp: new Date(1700000000000).toISOString(),
        author: 'Alice Example',
        category: 'SprintCategory',
        field: 'Sprint',
        added: 'Sprint 1, Sprint 2',
        removed: 'Backlog',
      },
    ])
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1/activities')
    expect(getLastFetchUrl().searchParams.get('fields')).toBe(
      'id,timestamp,author(id,login,name,fullName),category(id),field(name),targetMember,added,removed',
    )
    expect(getLastFetchUrl().searchParams.get('categories')).toBe(
      [
        'CommentsCategory',
        'CommentTextCategory',
        'CustomFieldCategory',
        'LinksCategory',
        'AttachmentsCategory',
        'WorkItemCategory',
        'IssueCreatedCategory',
        'IssueResolvedCategory',
        'SummaryCategory',
        'DescriptionCategory',
        'IssueVisibilityCategory',
        'CommentVisibilityCategory',
        'AttachmentVisibilityCategory',
        'ProjectCategory',
        'SprintCategory',
        'TagsCategory',
        'VotersCategory',
        'TotalVotesCategory',
      ].join(','),
    )
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('passes through custom filters and fallback field mapping', async () => {
    const start = '2024-01-01T00:00:00.000Z'
    const end = '2024-01-31T00:00:00.000Z'
    mockFetchResponse([
      makeActivityResponse({
        id: 'activity-2',
        field: undefined,
        targetMember: 'Assignee',
        added: 2,
        removed: null,
      }),
    ])

    const activities = await getYouTrackTaskHistory(config, 'TEST-2', {
      categories: ['SprintCategory', 'TagsCategory'],
      limit: 10,
      offset: 20,
      reverse: true,
      start,
      end,
      author: 'alice',
    })

    expect(activities).toEqual([
      {
        id: 'activity-2',
        timestamp: new Date(1700000000000).toISOString(),
        author: 'Alice Example',
        category: 'SprintCategory',
        field: 'Assignee',
        added: '2',
        removed: undefined,
      },
    ])
    expect(getLastFetchUrl().searchParams.get('categories')).toBe('SprintCategory,TagsCategory')
    expect(getLastFetchUrl().searchParams.get('$top')).toBe('10')
    expect(getLastFetchUrl().searchParams.get('$skip')).toBe('20')
    expect(getLastFetchUrl().searchParams.get('reverse')).toBe('true')
    expect(getLastFetchUrl().searchParams.get('start')).toBe(String(new Date(start).getTime()))
    expect(getLastFetchUrl().searchParams.get('end')).toBe(String(new Date(end).getTime()))
    expect(getLastFetchUrl().searchParams.get('author')).toBe('alice')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(getYouTrackTaskHistory(config, 'TEST-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('rejects invalid start timestamp before request execution', async () => {
    await expect(getYouTrackTaskHistory(config, 'TEST-1', { start: 'not-a-date' })).rejects.toMatchObject({
      appError: {
        type: 'provider',
        code: 'validation-failed',
        field: 'start',
      },
    })
    expect(fetchMock).toBeUndefined()
  })

  test('rejects invalid end timestamp before request execution', async () => {
    try {
      await getYouTrackTaskHistory(config, 'TEST-1', { end: '2026-99-99T00:00:00Z' })
      throw new Error('Expected getYouTrackTaskHistory to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      expect(extractAppError(error)).toEqual({
        type: 'provider',
        code: 'validation-failed',
        field: 'end',
        reason: 'Expected an ISO datetime with timezone information',
      })
    }
    expect(fetchMock).toBeUndefined()
  })

  test('rejects timezone-less start timestamp before request execution', async () => {
    try {
      await getYouTrackTaskHistory(config, 'TEST-1', { start: '2026-04-01T00:00:00' })
      throw new Error('Expected getYouTrackTaskHistory to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      expect(extractAppError(error)).toEqual({
        type: 'provider',
        code: 'validation-failed',
        field: 'start',
        reason: 'Expected an ISO datetime with timezone information',
      })
    }
    expect(fetchMock).toBeUndefined()
  })
})
