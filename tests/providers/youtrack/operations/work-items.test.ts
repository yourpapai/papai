import { afterEach, describe, expect, test } from 'bun:test'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  createYouTrackWorkItem,
  deleteYouTrackWorkItem,
  listYouTrackWorkItems,
  updateYouTrackWorkItem,
} from '../../../../src/providers/youtrack/operations/work-items.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import {
  FetchCallSchema,
  type FetchMockFn,
  defaultConfig,
  getFetchBodyAt,
  getLastFetchBody,
  getLastFetchMethod,
  getLastFetchUrl,
  installFetchMock,
  mockFetchError,
  mockFetchNoContent,
  mockFetchResponse,
} from '../fetch-mock-utils.js'

mockLogger()

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

const makeWorkItemResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '8-1',
  date: 1700000000000,
  duration: { minutes: 90, presentation: '1h 30m' },
  text: 'Worked on feature',
  author: { id: '1-1', login: 'alice', name: 'Alice' },
  type: { id: '5-0', name: 'Development' },
  ...overrides,
})

/**
 * Builds a paginated fetch handler. `pageMap` maps "$skip/$top" keys to the
 * items array to return for that page. All other pages return an empty array.
 */
const makePaginatedWorkItemFetch =
  (pageMap: Record<string, unknown[]>) =>
  (url: string): Promise<Response> => {
    const parsedUrl = new URL(url)
    const skip = parsedUrl.searchParams.get('$skip') ?? ''
    const top = parsedUrl.searchParams.get('$top') ?? ''
    const key = `${skip}/${top}`
    const items = Object.prototype.hasOwnProperty.call(pageMap, key) ? pageMap[key] : []
    return Promise.resolve(
      new Response(JSON.stringify(items), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

/**
 * Builds a fetch handler that returns `workItemTypes` for the
 * `/timeTrackingSettings/workItemTypes` endpoint and `workItemBody` for all
 * other requests.
 */
const makeWorkItemTypesRoutingFetch =
  (workItemTypes: unknown[], workItemBody: unknown) =>
  (url: string): Promise<Response> => {
    const parsedUrl = new URL(url)
    const body = parsedUrl.pathname.endsWith('/timeTrackingSettings/workItemTypes') ? workItemTypes : workItemBody
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

afterEach(() => {
  restoreFetch()
})

// --- listYouTrackWorkItems ---

describe('listYouTrackWorkItems', () => {
  test('returns mapped work items from API', async () => {
    mockFetchResponse(fetchMock, [makeWorkItemResponse()])
    const result = await listYouTrackWorkItems(config, 'PROJ-1')
    expect(result).toHaveLength(1)
    const wi = result[0]
    expect(wi?.id).toBe('8-1')
    expect(wi?.taskId).toBe('PROJ-1')
    expect(wi?.duration).toBe('PT1H30M')
    expect(wi?.description).toBe('Worked on feature')
    expect(wi?.author).toBe('alice')
    expect(wi?.type).toBe('Development')
  })

  test('normalises date to YYYY-MM-DD', async () => {
    mockFetchResponse(fetchMock, [makeWorkItemResponse({ date: 1700000000000 })])
    const result = await listYouTrackWorkItems(config, 'PROJ-1')
    // 1700000000000ms = 2023-11-14
    expect(result[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('returns empty array when no work items', async () => {
    mockFetchResponse(fetchMock, [])
    const result = await listYouTrackWorkItems(config, 'PROJ-1')
    expect(result).toHaveLength(0)
  })

  test('calls correct endpoint', async () => {
    mockFetchResponse(fetchMock, [])
    await listYouTrackWorkItems(config, 'PROJ-42')
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-42/timeTracking/workItems')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('passes $top and $skip when pagination params are provided', async () => {
    mockFetchResponse(fetchMock, [])

    await listYouTrackWorkItems(config, 'PROJ-42', { limit: 10, offset: 30 })

    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-42/timeTracking/workItems')
    expect(url.searchParams.get('$top')).toBe('10')
    expect(url.searchParams.get('$skip')).toBe('30')
  })

  test('uses paginated fetching for offset-only requests so results are not silently truncated', async () => {
    installFetchMock(
      fetchMock,
      makePaginatedWorkItemFetch({
        '30/100': Array.from({ length: 100 }, (_, index) => makeWorkItemResponse({ id: `8-${31 + index}` })),
        '130/100': [makeWorkItemResponse({ id: '8-131' })],
      }),
    )

    const result = await listYouTrackWorkItems(config, 'PROJ-42', { offset: 30 })

    expect(result).toHaveLength(101)
    expect(result[0]).toEqual({
      id: '8-31',
      taskId: 'PROJ-42',
      author: 'alice',
      date: '2023-11-14',
      duration: 'PT1H30M',
      description: 'Worked on feature',
      type: 'Development',
    })
    expect(result[100]?.id).toBe('8-131')
    expect(fetchMock.current?.mock.calls).toHaveLength(2)

    const firstUrl = new URL(FetchCallSchema.parse(fetchMock.current?.mock.calls[0])[0])
    const secondUrl = new URL(FetchCallSchema.parse(fetchMock.current?.mock.calls[1])[0])

    expect(firstUrl.searchParams.get('$skip')).toBe('30')
    expect(firstUrl.searchParams.get('$top')).toBe('100')
    expect(secondUrl.searchParams.get('$skip')).toBe('130')
    expect(secondUrl.searchParams.get('$top')).toBe('100')
  })

  test('uses paginated fetching for high offset-only requests without skipping the first page', async () => {
    installFetchMock(
      fetchMock,
      makePaginatedWorkItemFetch({
        '1000/100': Array.from({ length: 100 }, (_, index) => makeWorkItemResponse({ id: `8-${1001 + index}` })),
        '1100/100': [makeWorkItemResponse({ id: '8-1101' })],
      }),
    )

    const result = await listYouTrackWorkItems(config, 'PROJ-42', { offset: 1000 })

    expect(result).toHaveLength(101)
    expect(result[0]?.id).toBe('8-1001')
    expect(result[100]?.id).toBe('8-1101')
    expect(fetchMock.current?.mock.calls).toHaveLength(2)

    const firstUrl = new URL(FetchCallSchema.parse(fetchMock.current?.mock.calls[0])[0])
    const secondUrl = new URL(FetchCallSchema.parse(fetchMock.current?.mock.calls[1])[0])

    expect(firstUrl.searchParams.get('$skip')).toBe('1000')
    expect(firstUrl.searchParams.get('$top')).toBe('100')
    expect(secondUrl.searchParams.get('$skip')).toBe('1100')
    expect(secondUrl.searchParams.get('$top')).toBe('100')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404)
    await expect(listYouTrackWorkItems(config, 'PROJ-99')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

// --- createYouTrackWorkItem ---

describe('createYouTrackWorkItem', () => {
  test('creates work item and returns mapped result', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse({ id: '8-2', duration: { minutes: 60, presentation: '1h' } }))
    const result = await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h' })
    expect(result.id).toBe('8-2')
    expect(result.taskId).toBe('PROJ-1')
    expect(result.duration).toBe('PT1H')
  })

  test('parses natural duration strings in request', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '90m' })
    const body = getLastFetchBody(fetchMock.current)
    expect(body['duration']).toEqual({ minutes: 90 })
  })

  test('parses "1.5h" duration in request', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1.5h' })
    const body = getLastFetchBody(fetchMock.current)
    expect(body['duration']).toEqual({ minutes: 90 })
  })

  test('includes description in request body', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse({ text: 'Fixed bug' }))
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '30m', description: 'Fixed bug' })
    const body = getLastFetchBody(fetchMock.current)
    expect(body['text']).toBe('Fixed bug')
  })

  test('includes date in request body when provided', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h', date: '2024-01-15' })
    const body = getLastFetchBody(fetchMock.current)
    expect(typeof body['date']).toBe('number')
  })

  test('uses the start of the current UTC day when not provided', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h' })
    const body = getLastFetchBody(fetchMock.current)
    const now = new Date()
    expect(body['date']).toBe(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  })

  test('calls correct endpoint with POST', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-3', { duration: '2h' })
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-3/timeTracking/workItems')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
  })

  test('throws classified error on 400', async () => {
    mockFetchError(fetchMock, 400, { error: 'Invalid duration' })
    await expect(createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404)
    await expect(createYouTrackWorkItem(config, 'PROJ-99', { duration: '1h' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('uses a resolved stable work item type ID when type is already an ID', async () => {
    installFetchMock(
      fetchMock,
      makeWorkItemTypesRoutingFetch([{ id: '5-0', name: 'Development' }], makeWorkItemResponse()),
    )

    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h', type: '5-0' })

    expect(getFetchBodyAt(fetchMock.current, 1)['type']).toEqual({ id: '5-0' })
  })

  test('rejects unknown work item types instead of falling back to a name payload', async () => {
    installFetchMock(
      fetchMock,
      makeWorkItemTypesRoutingFetch([{ id: '5-0', name: 'Development' }], makeWorkItemResponse()),
    )

    await expect(createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h', type: 'Unknown' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
    expect(fetchMock.current?.mock.calls).toHaveLength(1)
  })
})

// --- updateYouTrackWorkItem ---

describe('updateYouTrackWorkItem', () => {
  test('updates work item and returns mapped result', async () => {
    mockFetchResponse(
      fetchMock,
      makeWorkItemResponse({ duration: { minutes: 120, presentation: '2h' }, text: 'Updated' }),
    )
    const result = await updateYouTrackWorkItem(config, 'PROJ-1', '8-1', { duration: '2h', description: 'Updated' })
    expect(result.id).toBe('8-1')
    expect(result.duration).toBe('PT2H')
    expect(result.description).toBe('Updated')
  })

  test('sends duration as minutes', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await updateYouTrackWorkItem(config, 'PROJ-1', '8-1', { duration: '2h 30m' })
    const body = getLastFetchBody(fetchMock.current)
    expect(body['duration']).toEqual({ minutes: 150 })
  })

  test('calls correct endpoint with POST', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await updateYouTrackWorkItem(config, 'PROJ-5', '8-2', { duration: '1h' })
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-5/timeTracking/workItems/8-2')
    expect(getLastFetchMethod(fetchMock.current)).toBe('POST')
  })

  test('does not send duration if not provided', async () => {
    mockFetchResponse(fetchMock, makeWorkItemResponse())
    await updateYouTrackWorkItem(config, 'PROJ-1', '8-1', { description: 'Only text update' })
    const body = getLastFetchBody(fetchMock.current)
    expect(body['duration']).toBeUndefined()
    expect(body['text']).toBe('Only text update')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404)
    await expect(updateYouTrackWorkItem(config, 'PROJ-1', '8-999', { duration: '1h' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

// --- deleteYouTrackWorkItem ---

describe('deleteYouTrackWorkItem', () => {
  test('returns the deleted work item id', async () => {
    mockFetchNoContent(fetchMock)
    const result = await deleteYouTrackWorkItem(config, 'PROJ-1', '8-5')
    expect(result.id).toBe('8-5')
  })

  test('calls correct endpoint with DELETE', async () => {
    mockFetchNoContent(fetchMock)
    await deleteYouTrackWorkItem(config, 'PROJ-3', '8-99')
    const url = getLastFetchUrl(fetchMock.current)
    expect(url.pathname).toBe('/api/issues/PROJ-3/timeTracking/workItems/8-99')
    expect(getLastFetchMethod(fetchMock.current)).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(fetchMock, 404)
    await expect(deleteYouTrackWorkItem(config, 'PROJ-1', '8-999')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 403', async () => {
    mockFetchError(fetchMock, 403)
    await expect(deleteYouTrackWorkItem(config, 'PROJ-1', '8-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
