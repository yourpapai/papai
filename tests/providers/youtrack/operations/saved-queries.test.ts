import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { extractAppError } from '../../../../src/errors.js'
import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  listYouTrackSavedQueries,
  runYouTrackSavedQuery,
} from '../../../../src/providers/youtrack/operations/saved-queries.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import {
  type FetchMockFn,
  defaultConfig,
  getFetchMethodAt,
  getFetchUrlAt,
  mockFetchError,
  mockFetchResponse,
  mockFetchSequence,
} from '../fetch-mock-utils.js'

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

const makeIssueListResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '2-1',
  idReadable: 'TEST-1',
  summary: 'Bug fix',
  project: { id: '0-1', shortName: 'TEST' },
  customFields: [
    { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'High' } },
    { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
  ],
  ...overrides,
})

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
})

describe('listYouTrackSavedQueries', () => {
  test('lists saved queries and maps response', async () => {
    mockFetchResponse(fetchMock, [{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }])

    const queries = await listYouTrackSavedQueries(config)

    expect(queries).toEqual([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }])
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/savedQueries')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('fields')).toBe('id,name,query')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('GET')
  })

  test('paginates beyond the first 100 saved queries', async () => {
    mockFetchSequence(fetchMock, [
      {
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `query-${index + 1}`,
          name: `Saved Query ${index + 1}`,
          query: `project: TEST sort by: created ${index + 1}`,
        })),
      },
      {
        data: [{ id: 'query-101', name: 'Saved Query 101', query: 'project: TEST #Unresolved' }],
      },
    ])

    const queries = await listYouTrackSavedQueries(config)

    expect(queries).toHaveLength(101)
    expect(queries[0]).toEqual({ id: 'query-1', name: 'Saved Query 1', query: 'project: TEST sort by: created 1' })
    expect(queries[100]).toEqual({ id: 'query-101', name: 'Saved Query 101', query: 'project: TEST #Unresolved' })
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$top')).toBe('100')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$top')).toBe('100')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$skip')).toBe('100')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(fetchMock, 403)

    await expect(listYouTrackSavedQueries(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('runYouTrackSavedQuery', () => {
  test('fetches query definition and executes issue search', async () => {
    mockFetchSequence(fetchMock, [
      { data: { id: 'query-1', name: 'Open Issues', query: 'State: Open' } },
      { data: [makeIssueListResponse()] },
    ])

    const results = await runYouTrackSavedQuery(config, 'query-1')

    expect(results).toEqual([
      {
        id: 'TEST-1',
        title: 'Bug fix',
        status: 'Open',
        priority: 'High',
        projectId: '0-1',
        url: 'https://test.youtrack.cloud/issue/TEST-1',
      },
    ])
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/savedQueries/query-1')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('fields')).toBe('id,name,query')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('GET')
    expect(getFetchUrlAt(fetchMock.current, 1).pathname).toBe('/api/issues')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('fields')).toBe(
      'id,idReadable,numberInProject,summary,resolved,created,project(id,shortName),customFields($type,name,value($type,name,login))',
    )
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('query')).toBe('State: Open')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$top')).toBe('100')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$skip')).toBe('0')
    expect(getFetchMethodAt(fetchMock.current, 1)).toBe('GET')
  })

  test('rejects saved queries whose query text is null', async () => {
    mockFetchResponse(fetchMock, { id: 'query-1', name: 'Broken Query', query: null })

    try {
      await runYouTrackSavedQuery(config, 'query-1')
      throw new Error('Expected runYouTrackSavedQuery to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      expect(extractAppError(error)).toEqual({
        type: 'provider',
        code: 'validation-failed',
        field: 'query',
        reason: 'Saved query does not define a search query',
      })
    }

    expect(fetchMock.current?.mock.calls).toHaveLength(1)
  })

  test('preserves queryId when the saved query is missing', async () => {
    mockFetchError(fetchMock, 404, { error: 'Saved query not found' })

    try {
      await runYouTrackSavedQuery(config, 'query-404')
      throw new Error('Expected runYouTrackSavedQuery to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      expect(extractAppError(error)).toEqual({
        type: 'provider',
        code: 'not-found',
        resourceType: 'Saved query',
        resourceId: 'query-404',
      })
    }

    expect(fetchMock.current?.mock.calls).toHaveLength(1)
  })
})
