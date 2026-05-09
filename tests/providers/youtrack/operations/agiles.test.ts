import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  assignYouTrackTaskToSprint,
  createYouTrackSprint,
  listYouTrackAgiles,
  listYouTrackSprints,
  updateYouTrackSprint,
} from '../../../../src/providers/youtrack/operations/agiles.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import {
  type FetchMockFn,
  defaultConfig,
  getFetchBodyAt,
  getFetchMethodAt,
  getFetchUrlAt,
  mockFetchError,
  mockFetchResponse,
  mockFetchSequence,
} from '../fetch-mock-utils.js'

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

const makeSprintResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sprint-1',
  name: 'Sprint 1',
  archived: false,
  goal: 'Ship it',
  isDefault: true,
  start: 1700000000000,
  finish: 1700600000000,
  unresolvedIssuesCount: 7,
  ...overrides,
})

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
})

describe('listYouTrackAgiles', () => {
  test('lists agiles and maps response', async () => {
    mockFetchResponse(fetchMock, [{ id: 'agile-1', name: 'Team Board' }])

    const agiles = await listYouTrackAgiles(config)

    expect(agiles).toEqual([{ id: 'agile-1', name: 'Team Board' }])
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/agiles')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('fields')).toBe('id,name')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('GET')
  })

  test('paginates beyond the first agile page', async () => {
    mockFetchSequence(fetchMock, [
      {
        data: Array.from({ length: 100 }, (_, index) => ({ id: `agile-${index + 1}`, name: `Agile ${index + 1}` })),
      },
      {
        data: [{ id: 'agile-101', name: 'Agile 101' }],
      },
    ])

    const agiles = await listYouTrackAgiles(config)

    expect(agiles).toHaveLength(101)
    expect(agiles.at(100)).toEqual({ id: 'agile-101', name: 'Agile 101' })
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$skip')).toBe('100')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(fetchMock, 401)

    await expect(listYouTrackAgiles(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('listYouTrackSprints', () => {
  test('lists sprints and maps timestamps to iso strings', async () => {
    mockFetchResponse(fetchMock, [makeSprintResponse()])

    const sprints = await listYouTrackSprints(config, 'agile-1')

    expect(sprints).toEqual([
      {
        id: 'sprint-1',
        agileId: 'agile-1',
        name: 'Sprint 1',
        start: new Date(1700000000000).toISOString(),
        finish: new Date(1700600000000).toISOString(),
        archived: false,
        goal: 'Ship it',
        isDefault: true,
        unresolvedIssuesCount: 7,
      },
    ])
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/agiles/agile-1/sprints')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('fields')).toBe(
      'id,name,archived,goal,isDefault,start,finish,unresolvedIssuesCount',
    )
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('GET')
  })

  test('paginates beyond the first sprint page', async () => {
    mockFetchSequence(fetchMock, [
      {
        data: Array.from({ length: 100 }, (_, index) =>
          makeSprintResponse({
            id: `sprint-${index + 1}`,
            name: `Sprint ${index + 1}`,
          }),
        ),
      },
      {
        data: [makeSprintResponse({ id: 'sprint-101', name: 'Sprint 101' })],
      },
    ])

    const sprints = await listYouTrackSprints(config, 'agile-1')

    expect(sprints).toHaveLength(101)
    expect(sprints.at(100)).toEqual({
      id: 'sprint-101',
      agileId: 'agile-1',
      name: 'Sprint 101',
      start: new Date(1700000000000).toISOString(),
      finish: new Date(1700600000000).toISOString(),
      archived: false,
      goal: 'Ship it',
      isDefault: true,
      unresolvedIssuesCount: 7,
    })
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$skip')).toBe('100')
  })
})

describe('createYouTrackSprint', () => {
  test('creates sprint with converted timestamps and previous sprint link', async () => {
    const start = '2024-01-15T00:00:00.000Z'
    const finish = '2024-01-22T00:00:00.000Z'
    mockFetchResponse(
      fetchMock,
      makeSprintResponse({
        start: new Date(start).getTime(),
        finish: new Date(finish).getTime(),
      }),
    )

    const sprint = await createYouTrackSprint(config, 'agile-1', {
      name: 'Sprint 1',
      goal: 'Ship it',
      start,
      finish,
      previousSprintId: 'sprint-0',
      isDefault: true,
    })

    expect(sprint).toEqual({
      id: 'sprint-1',
      agileId: 'agile-1',
      name: 'Sprint 1',
      start,
      finish,
      archived: false,
      goal: 'Ship it',
      isDefault: true,
      unresolvedIssuesCount: 7,
    })
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/agiles/agile-1/sprints')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('fields')).toBe(
      'id,name,archived,goal,isDefault,start,finish,unresolvedIssuesCount',
    )
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('POST')
    expect(getFetchBodyAt(fetchMock.current, 0)).toEqual({
      name: 'Sprint 1',
      goal: 'Ship it',
      start: new Date(start).getTime(),
      finish: new Date(finish).getTime(),
      previousSprint: { id: 'sprint-0' },
      isDefault: true,
    })
  })

  test('rejects invalid start and finish timestamps before sending request', async () => {
    mockFetchResponse(fetchMock, makeSprintResponse())

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        start: 'not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        finish: 'also-not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)
  })

  test('rejects impossible ISO datetimes before sending request', async () => {
    mockFetchResponse(fetchMock, makeSprintResponse())

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        start: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        finish: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)
  })
})

describe('updateYouTrackSprint', () => {
  test('updates sprint with null reset fields and archived flag', async () => {
    mockFetchResponse(
      fetchMock,
      makeSprintResponse({
        id: 'sprint-2',
        name: 'Sprint 2',
        archived: true,
        goal: 'Updated goal',
        isDefault: false,
        start: null,
        finish: null,
      }),
    )

    const sprint = await updateYouTrackSprint(config, 'agile-1', 'sprint-2', {
      name: 'Sprint 2',
      goal: 'Updated goal',
      start: null,
      finish: null,
      previousSprintId: null,
      isDefault: false,
      archived: true,
    })

    expect(sprint).toEqual({
      id: 'sprint-2',
      agileId: 'agile-1',
      name: 'Sprint 2',
      start: undefined,
      finish: undefined,
      archived: true,
      goal: 'Updated goal',
      isDefault: false,
      unresolvedIssuesCount: 7,
    })
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/agiles/agile-1/sprints/sprint-2')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('POST')
    expect(getFetchBodyAt(fetchMock.current, 0)).toEqual({
      name: 'Sprint 2',
      goal: 'Updated goal',
      start: null,
      finish: null,
      previousSprint: null,
      isDefault: false,
      archived: true,
    })
  })

  test('clears sprint goal when null is provided', async () => {
    mockFetchResponse(fetchMock, makeSprintResponse({ id: 'sprint-3', goal: null }))

    const sprint = await updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
      goal: null,
    })

    expect(sprint.goal).toBeNull()
    expect(getFetchBodyAt(fetchMock.current, 0)).toEqual({ goal: null })
  })

  test('rejects invalid update timestamps before sending request', async () => {
    mockFetchResponse(fetchMock, makeSprintResponse())

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        start: 'not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        finish: 'also-not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)
  })

  test('rejects impossible ISO datetimes when updating before sending request', async () => {
    mockFetchResponse(fetchMock, makeSprintResponse())

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        start: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        finish: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)
  })
})

describe('assignYouTrackTaskToSprint', () => {
  test('resolves issue id and agile board before assigning sprint', async () => {
    mockFetchSequence(fetchMock, [
      { data: { id: 'issue-db-1' } },
      {
        data: [
          { id: 'agile-1', sprints: [{ id: 'sprint-2' }] },
          { id: 'agile-2', sprints: [{ id: 'sprint-9' }] },
        ],
      },
      { data: null, status: 204 },
    ])

    const result = await assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-2')

    expect(result).toEqual({ taskId: 'TEST-1', sprintId: 'sprint-2' })
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/issues/TEST-1')
    expect(getFetchUrlAt(fetchMock.current, 0).searchParams.get('fields')).toBe('id')
    expect(getFetchMethodAt(fetchMock.current, 0)).toBe('GET')
    expect(getFetchUrlAt(fetchMock.current, 1).pathname).toBe('/api/agiles')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('fields')).toBe('id,sprints(id)')
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(fetchMock.current, 1)).toBe('GET')
    expect(getFetchUrlAt(fetchMock.current, 2).pathname).toBe('/api/agiles/agile-1/sprints/sprint-2/issues')
    expect(getFetchMethodAt(fetchMock.current, 2)).toBe('POST')
    expect(getFetchBodyAt(fetchMock.current, 2)).toEqual({ id: 'issue-db-1', $type: 'Issue' })
  })

  test('searches across paginated agile results when resolving sprint ownership', async () => {
    mockFetchSequence(fetchMock, [
      { data: { id: 'issue-db-1' } },
      {
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `agile-${index + 1}`,
          sprints: [{ id: `other-${index}` }],
        })),
      },
      {
        data: [{ id: 'agile-101', sprints: [{ id: 'sprint-2' }] }],
      },
      { data: null, status: 204 },
    ])

    const result = await assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-2')

    expect(result).toEqual({ taskId: 'TEST-1', sprintId: 'sprint-2' })
    expect(getFetchUrlAt(fetchMock.current, 1).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(fetchMock.current, 2).searchParams.get('$skip')).toBe('100')
    expect(getFetchUrlAt(fetchMock.current, 3).pathname).toBe('/api/agiles/agile-101/sprints/sprint-2/issues')
  })

  test('throws classified error on api failure', async () => {
    mockFetchError(fetchMock, 404, { error: 'Issue not found' })

    await expect(assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-2')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('classifies missing sprint lookup as a not found provider error', async () => {
    mockFetchSequence(fetchMock, [
      { data: { id: 'issue-db-1' } },
      {
        data: [
          { id: 'agile-1', sprints: [{ id: 'sprint-1' }] },
          { id: 'agile-2', sprints: [{ id: 'sprint-9' }] },
        ],
      },
    ])

    try {
      await assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-404')
      throw new Error('Expected assignYouTrackTaskToSprint to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError).toEqual({
        type: 'provider',
        code: 'not-found',
        resourceType: 'Sprint',
        resourceId: 'sprint-404',
      })
    }

    expect(fetchMock.current?.mock.calls).toHaveLength(2)
  })
})
