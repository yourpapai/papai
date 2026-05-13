import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  createYouTrackTask,
  deleteYouTrackTask,
  getYouTrackTask,
  listYouTrackTasks,
  searchYouTrackTasks,
  updateYouTrackTask,
} from '../../../../src/providers/youtrack/operations/tasks.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

// --- Fetch mocking infrastructure ---

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
    Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const mockFetchNoContent = (): void => {
  installFetchMock(() => Promise.resolve(new Response(null, { status: 204 })))
}

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

// Helper for createYouTrackTask tests - resolves project, loads required custom fields, then creates issue
const mockCreateTaskResponse = (
  issueResponse: unknown,
  projectResponse: unknown = { id: '0-1', shortName: 'TEST' },
  customFieldsResponse: unknown = [],
): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      // Project lookup response
      return Promise.resolve(
        new Response(JSON.stringify(projectResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    }
    if (callCount === 2) {
      return Promise.resolve(
        new Response(JSON.stringify(customFieldsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    // Issue creation response
    return Promise.resolve(
      new Response(JSON.stringify(issueResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.looseObject({})

const getLastFetchUrl = (): URL => {
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  const parsed = FetchCallSchema.safeParse(lastCall)
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchMethod = (): string => {
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  const parsed = FetchCallSchema.safeParse(lastCall)
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const getFetchBodyAt = (index: number): z.infer<typeof BodySchema> => {
  const call = fetchMock.mock.calls[index]
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getFetchUrlAt = (index: number): URL => {
  const call = fetchMock.mock.calls[index]
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchMethodAt = (index: number): string => {
  const call = fetchMock.mock.calls[index]
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

// --- Module-level multi-step mock helpers ---

const jsonOk = (data: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }))

const jsonError = (status: number, data: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))

/** project=1, customFields=2, issue=3, followup=4 */
const mockCreateWithFollowup = (issueResponse: unknown, followupResponse: Response): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    if (callCount === 2) return jsonOk([])
    if (callCount === 3) return jsonOk(issueResponse)
    return Promise.resolve(followupResponse)
  })
}

/** project=1, customFields=2, issue-creation=3 fails with 400 */
const mockCreateWithBadRequest = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    if (callCount === 2) return jsonOk([])
    return jsonError(400, { error: 'Bad request' })
  })
}

/** project=1, customFields=2, issue-creation=3 fails with 401 */
const mockCreateWithAuthError = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    if (callCount === 2) return jsonOk([])
    return jsonError(401, { error: 'Unauthorized' })
  })
}

/** project shortName lookup=1, customFields=2, issue creation=3 */
const mockCreateWithShortName = (
  projectResponse: unknown,
  customFieldsResponse: unknown,
  issueResponse: unknown,
): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(projectResponse)
    if (callCount === 2) return jsonOk(customFieldsResponse)
    return jsonOk(issueResponse)
  })
}

/** project=1, customFields (Date required)=rest */
const mockCreateWithRequiredDateField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([
      {
        id: '82-12',
        $type: 'DateProjectCustomField',
        field: { id: '58-4', name: 'Due Date', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
    ])
  })
}

/** project=1, customFields (malformed dueDate)=rest */
const mockCreateWithMalformedDueDate = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([])
  })
}

/** project=1, customFields (unhandled required fields)=rest */
const mockCreateWithUnhandledRequiredFields = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([
      {
        id: '82-10',
        $type: 'EnumProjectCustomField',
        field: { id: '58-2', name: 'Type', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
      {
        id: '82-11',
        $type: 'SimpleProjectCustomField',
        field: { id: '58-3', name: 'Priority', $type: 'CustomField' },
        canBeEmpty: true,
        isPublic: true,
      },
    ])
  })
}

/** project=1, customFields (dedicated required fields)=rest */
const mockCreateWithDedicatedRequiredFields = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([
      {
        id: '82-17',
        $type: 'StateProjectCustomField',
        field: { id: '58-9', name: 'State', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
      {
        id: '82-18',
        $type: 'SingleEnumProjectCustomField',
        field: { id: '58-10', name: 'Priority', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
      {
        id: '82-19',
        $type: 'SingleUserProjectCustomField',
        field: { id: '58-11', name: 'Assignee', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
    ])
  })
}

/** project=1, customFields (unsupported EnumProjectCustomField)=rest */
const mockCreateWithUnsupportedEnumField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([
      {
        id: '82-14',
        $type: 'EnumProjectCustomField',
        field: {
          id: '58-6',
          name: 'Type',
          $type: 'CustomField',
          fieldType: { id: 'enum[1]', presentation: 'enum[1]' },
        },
        canBeEmpty: true,
        isPublic: true,
      },
    ])
  })
}

/** project=1, customFields (unknown field, empty list)=rest */
const mockCreateWithUnknownField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([])
  })
}

/** project=1, customFields (unsupported required EnumProjectCustomField)=rest */
const mockCreateWithRequiredUnsupportedField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([
      {
        id: '82-15',
        $type: 'EnumProjectCustomField',
        field: {
          id: '58-7',
          name: 'Type',
          $type: 'CustomField',
          fieldType: { id: 'enum[1]', presentation: 'enum[1]' },
        },
        canBeEmpty: false,
        isPublic: true,
      },
    ])
  })
}

/** project=1, customFields (non-string simple required field)=rest */
const mockCreateWithNonStringSimpleField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk([
      {
        id: '82-16',
        $type: 'SimpleProjectCustomField',
        field: {
          id: '58-8',
          name: 'Story points',
          $type: 'CustomField',
          fieldType: { id: 'integer', presentation: 'integer' },
        },
        canBeEmpty: false,
        isPublic: true,
      },
    ])
  })
}

/** getYouTrackTask: issue=1, dueDateCustomFields=2+ */
const mockGetTaskWithDueDateEnrichment = (issueResponse: unknown, dueDateCustomFieldsResponse: unknown = []): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(issueResponse)
    return jsonOk(dueDateCustomFieldsResponse)
  })
}

/** getYouTrackTask: issue=1, enrichment fetch fails=2 */
const mockGetTaskWithFailedEnrichment = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(makeIssueResponse())
    return jsonError(500, { error: 'custom field lookup failed' })
  })
}

/** getYouTrackTask: issue=1, page1 (100 fields)=2, page2 (dueDateField)=3 */
const mockGetTaskWithPaginatedCustomFields = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(makeIssueResponse())
    if (callCount === 2) {
      return jsonOk(
        Array.from({ length: 100 }, (_, index) => ({
          name: `Field ${index + 1}`,
          value: { text: `value-${index + 1}` },
        })),
      )
    }
    return jsonOk([{ name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') }])
  })
}

/** updateYouTrackTask: issue=1, customFields (simple+text)=2, updated issue=3 */
const mockUpdateWithCustomFields = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      return jsonOk(makeIssueResponse({ project: { id: '0-1', shortName: 'TEST' } }))
    }
    if (callCount === 2) {
      return jsonOk([
        {
          id: 'pcf-1',
          $type: 'SimpleProjectCustomField',
          field: { name: 'Environment', fieldType: { id: 'string', presentation: 'string' } },
          canBeEmpty: true,
        },
        {
          id: 'pcf-2',
          $type: 'TextProjectCustomField',
          field: { name: 'Steps', fieldType: { id: 'text', presentation: 'text' } },
          canBeEmpty: true,
        },
      ])
    }
    return jsonOk(makeIssueResponse())
  })
}

/** updateYouTrackTask: current issue lookup (unknown field)=1, custom fields=2 */
const mockUpdateWithUnknownField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ project: { id: '0-1' } })
    return jsonOk([])
  })
}

/** updateYouTrackTask: current issue lookup (unsupported field)=1, custom fields=2 */
const mockUpdateWithUnsupportedField = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ project: { id: '0-1' } })
    return jsonOk([
      {
        id: 'pcf-3',
        $type: 'EnumProjectCustomField',
        field: { name: 'Type', fieldType: { id: 'enum[1]', presentation: 'enum[1]' } },
        canBeEmpty: true,
      },
    ])
  })
}

/** updateYouTrackTask dedicated field rejection: current issue lookup=1, custom fields=2 */
const mockUpdateDedicatedFieldLookup = (fieldName: string): void => {
  const fieldTypeMap: Record<string, { $type: string; fieldType: { id: string; presentation: string } }> = {
    Assignee: {
      $type: 'UserProjectCustomField',
      fieldType: { id: 'user[1]', presentation: 'user[1]' },
    },
    'Due Date': {
      $type: 'DateProjectCustomField',
      fieldType: { id: 'date', presentation: 'date' },
    },
    State: {
      $type: 'SimpleProjectCustomField',
      fieldType: { id: 'string', presentation: 'string' },
    },
    Priority: {
      $type: 'SimpleProjectCustomField',
      fieldType: { id: 'string', presentation: 'string' },
    },
  }
  const fieldMeta = fieldTypeMap[fieldName] ?? {
    $type: 'SimpleProjectCustomField',
    fieldType: { id: 'string', presentation: 'string' },
  }
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk({ project: { id: '0-1' } })
    return jsonOk([
      {
        id: `pcf-${fieldName}`,
        $type: fieldMeta.$type,
        field: { name: fieldName, fieldType: fieldMeta.fieldType },
        canBeEmpty: true,
      },
    ])
  })
}

/** updateYouTrackTask: update with dueDate=1 (returns issue), enrichment=2 */
const mockUpdateWithDueDateEnrichment = (dueDateEnrichmentResponse: Response): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(makeIssueResponse())
    return Promise.resolve(dueDateEnrichmentResponse)
  })
}

/** updateYouTrackTask: update with dueDate=1 (returns issue), enrichment fails=2 */
const mockUpdateWithFailedEnrichment = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(makeIssueResponse())
    return jsonError(500, { error: 'custom field lookup failed' })
  })
}

/** updateYouTrackTask: customFields for destination project=1, updated issue=2 */
const mockUpdateValidateDestinationProject = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      return jsonOk([
        {
          id: 'pcf-2',
          $type: 'SimpleProjectCustomField',
          field: { name: 'Environment', fieldType: { id: 'string', presentation: 'string' } },
          canBeEmpty: true,
        },
      ])
    }
    return jsonOk(makeIssueResponse({ project: { id: '0-2', shortName: 'DEST' } }))
  })
}

/** listYouTrackTasks: project=1, issues=2 */
const mockListWithProject = (projectResponse: unknown, issuesResponse: unknown): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(projectResponse)
    return jsonOk(issuesResponse)
  })
}

/** listYouTrackTasks: project=1, issues with dueDate=2, empty=3 */
const mockListWithDueDateInline = (projectResponse: unknown, issuesResponse: unknown): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(projectResponse)
    if (callCount === 2) return jsonOk(issuesResponse)
    return jsonOk([])
  })
}

/** listYouTrackTasks autopaginate: project=1, pages 2-3 (100 items each)=2-3, last page (50 items)=4 */
const mockListWithAutoPagination = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      return jsonOk({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' })
    }
    if (callCount === 2 || callCount === 3) {
      const pageIndex = callCount - 2
      const items = Array.from({ length: 100 }, (_, i) =>
        makeIssueListResponse({
          id: `2-${i + pageIndex * 100}`,
          idReadable: `DEMO-${i + pageIndex * 100 + 1}`,
          summary: `Task ${i + pageIndex * 100 + 1}`,
        }),
      )
      return jsonOk(items)
    }
    if (callCount === 4) {
      const items = Array.from({ length: 50 }, (_, i) =>
        makeIssueListResponse({
          id: `2-${i + 200}`,
          idReadable: `DEMO-${i + 201}`,
          summary: `Task ${i + 201}`,
        }),
      )
      return jsonOk(items)
    }
    return jsonOk([])
  })
}

/** listYouTrackTasks maxPages: project=1, always returns 100 items */
const mockListWithMaxPages = (): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      return jsonOk({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' })
    }
    const pageIndex = callCount - 2
    const items = Array.from({ length: 100 }, (_, i) =>
      makeIssueListResponse({
        id: `2-${i + pageIndex * 100}`,
        idReadable: `DEMO-${i + pageIndex * 100 + 1}`,
        summary: `Task ${i + pageIndex * 100 + 1}`,
      }),
    )
    return jsonOk(items)
  })
}

/** searchYouTrackTasks with projectId: project=1, issues=2 */
const mockSearchWithProject = (projectResponse: unknown, issuesResponse: unknown): void => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) return jsonOk(projectResponse)
    return jsonOk(issuesResponse)
  })
}

// --- Fixtures ---

type IssueFixture = Record<string, unknown>

const makeIssueResponse = (overrides: Record<string, unknown> = {}): IssueFixture => ({
  id: '2-1',
  idReadable: 'TEST-1',
  summary: 'Test task',
  description: 'A description',
  project: { id: '0-1', shortName: 'TEST' },
  created: 1700000000000,
  updated: 1700000000000,
  customFields: [
    { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { $type: 'EnumBundleElement', name: 'Normal' } },
    { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
  ],
  tags: [],
  links: [],
  ...overrides,
})

const makeIssueListResponse = (overrides: Record<string, unknown> = {}): IssueFixture => ({
  id: '2-1',
  idReadable: 'TEST-1',
  summary: 'Test task',
  project: { id: '0-1', shortName: 'TEST' },
  customFields: [
    { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { $type: 'EnumBundleElement', name: 'Normal' } },
    { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
  ],
  ...overrides,
})

// --- Tests ---

beforeEach(() => {
  mockLogger()
})

describe('createYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('creates task and returns mapped result', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    const task = await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      description: 'A description',
    })

    expect(task.id).toBe('TEST-1')
    expect(task.title).toBe('Test task')
    expect(task.description).toBe('A description')
    expect(task.priority).toBe('Normal')
    expect(task.status).toBe('Open')
    expect(task.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    expect(task.projectId).toBe('0-1')
  })

  test('sends description when provided', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      description: 'My description',
    })

    const body = getFetchBodyAt(2)
    expect(body['description']).toBe('My description')
  })

  test('does not send description when absent', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
    })

    const body = getFetchBodyAt(2)
    expect(body['description']).toBeUndefined()
  })

  test('sends custom fields for priority and status', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      priority: 'Critical',
      status: 'In Progress',
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toEqual([
      { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } },
      { name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
    ])
  })

  test('sends assignee custom field when provided', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      assignee: 'john.doe',
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toContainEqual({
      name: 'Assignee',
      $type: 'SingleUserIssueCustomField',
      value: { login: 'john.doe' },
    })
  })

  test('sends due date custom field when provided', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      dueDate: '2026-03-25',
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toContainEqual({
      name: 'Due Date',
      $type: 'DateIssueCustomField',
      value: Date.parse('2026-03-25T12:00:00.000Z'),
    })
  })

  test('returns dueDate after create using follow-up custom fields fetch', async () => {
    mockCreateWithFollowup(
      makeIssueResponse(),
      await jsonOk([{ name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') }]),
    )

    const task = await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      dueDate: '2026-03-25',
    })

    expect(task.dueDate).toBe('2026-03-25')
  })

  test('preserves create dueDate when enrichment fetch fails', async () => {
    mockCreateWithFollowup(makeIssueResponse(), await jsonError(500, { error: 'custom field lookup failed' }))

    const task = await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      dueDate: '2026-03-25T23:45:00+02:00',
    })

    expect(task.id).toBe('TEST-1')
    expect(task.dueDate).toBe('2026-03-25')
  })

  test('canonicalizes datetime input to date-only value when creating', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      dueDate: '2026-03-25T23:45:00.000Z',
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toContainEqual({
      name: 'Due Date',
      $type: 'DateIssueCustomField',
      value: Date.parse('2026-03-25T12:00:00.000Z'),
    })
  })

  test('throws workflow validation error when due date is required but omitted', async () => {
    mockCreateWithRequiredDateField()

    await expect(createYouTrackTask(config, { projectId: 'TEST', title: 'Test task' })).rejects.toMatchObject({
      appError: {
        code: 'workflow-validation-failed',
        requiredFields: [{ name: 'Due Date' }],
      },
    })
  })

  test('rejects malformed due date before sending create request', async () => {
    mockCreateWithMalformedDueDate()

    await expect(
      createYouTrackTask(config, { projectId: '0-1', title: 'Test task', dueDate: 'not-a-date' }),
    ).rejects.toMatchObject({
      appError: { code: 'validation-failed', field: 'dueDate' },
    })

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('does not send customFields when none provided', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toBeUndefined()
  })

  test('uses POST method to /api/issues', async () => {
    mockCreateTaskResponse(makeIssueResponse())

    await createYouTrackTask(config, { projectId: '0-1', title: 'Test task' })

    const url = getFetchUrlAt(2)
    expect(url.pathname).toBe('/api/issues')
    expect(getFetchMethodAt(2)).toBe('POST')
  })

  test('throws YouTrackClassifiedError on API error', async () => {
    mockCreateWithBadRequest()

    await expect(createYouTrackTask(config, { projectId: '0-1', title: 'Test task' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws YouTrackClassifiedError on auth error', async () => {
    mockCreateWithAuthError()

    try {
      await createYouTrackTask(config, { projectId: '0-1', title: 'Test task' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('auth-failed')
    }
  })

  test('resolves project shortName to internal ID before creating task', async () => {
    // First call: get project by shortName to resolve internal ID
    // Second call: fetch project custom fields using the resolved internal ID
    // Third call: create issue with internal ID
    mockCreateWithShortName(
      { id: '0-1', shortName: 'AUDIT', name: 'Audit Project' },
      [],
      makeIssueResponse({ id: '2-1', idReadable: 'AUDIT-1', project: { id: '0-1', shortName: 'AUDIT' } }),
    )

    // Pass shortName "AUDIT" instead of internal ID
    const task = await createYouTrackTask(config, {
      projectId: 'AUDIT',
      title: 'Test task',
    })

    expect(task.id).toBe('AUDIT-1')
    expect(task.projectId).toBe('0-1')

    // Verify first call was to resolve project
    const firstParsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
    assert(firstParsed.success)
    const firstUrl = new URL(firstParsed.data[0])
    expect(firstUrl.pathname).toBe('/api/admin/projects/AUDIT')
    expect(firstParsed.data[1].method).toBe('GET')

    // Verify second call fetched custom fields with the resolved internal ID
    const secondParsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(secondParsed.success)
    const secondUrl = new URL(secondParsed.data[0])
    expect(secondUrl.pathname).toBe('/api/admin/projects/0-1/customFields')
    expect(secondUrl.searchParams.get('fields')).toContain('fieldType(id,presentation)')
    expect(secondParsed.data[1].method).toBe('GET')

    // Verify third call created issue with internal ID
    const thirdParsed = FetchCallSchema.safeParse(fetchMock.mock.calls[2])
    assert(thirdParsed.success)
    const thirdUrl = new URL(thirdParsed.data[0])
    expect(thirdUrl.pathname).toBe('/api/issues')
    expect(thirdParsed.data[1].method).toBe('POST')

    const { body: thirdBody } = thirdParsed.data[1]
    assert(thirdBody !== undefined)
    const parsedBody: unknown = JSON.parse(thirdBody)
    expect(parsedBody).toMatchObject({ project: { id: '0-1' } })
  })

  test('throws workflow validation error when project has unhandled required custom fields', async () => {
    mockCreateWithUnhandledRequiredFields()

    try {
      await createYouTrackTask(config, { projectId: 'TEST', title: 'Test task' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('workflow-validation-failed')
      assert(error.appError.code === 'workflow-validation-failed')
      expect(error.appError.requiredFields).toEqual([{ name: 'Type' }])
      expect(error.message).toContain('Type')
    }
  })

  test('treats omitted dedicated required fields as unhandled workflow requirements', async () => {
    mockCreateWithDedicatedRequiredFields()

    await expect(createYouTrackTask(config, { projectId: 'TEST', title: 'Test task' })).rejects.toMatchObject({
      appError: {
        code: 'workflow-validation-failed',
        requiredFields: [{ name: 'State' }, { name: 'Priority' }, { name: 'Assignee' }],
      },
    })

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('allows required custom fields when they are explicitly provided', async () => {
    mockCreateTaskResponse(makeIssueResponse(), { id: '0-1', shortName: 'TEST' }, [
      {
        id: '82-10',
        $type: 'SimpleProjectCustomField',
        field: {
          id: '58-2',
          name: 'Environment',
          $type: 'CustomField',
          fieldType: { id: 'string', presentation: 'string' },
        },
        canBeEmpty: false,
        isPublic: true,
      },
    ])

    await createYouTrackTask(config, {
      projectId: 'TEST',
      title: 'Test task',
      customFields: [{ name: 'Environment', value: 'production' }],
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toContainEqual({
      name: 'Environment',
      $type: 'SimpleIssueCustomField',
      value: 'production',
    })

    const customFieldsUrl = getFetchUrlAt(1)
    expect(customFieldsUrl.pathname).toBe('/api/admin/projects/0-1/customFields')
    expect(customFieldsUrl.searchParams.get('fields')).toContain('fieldType(id,presentation)')
  })

  test('sends raw string value for supported string simple project custom fields', async () => {
    mockCreateTaskResponse(makeIssueResponse(), { id: '0-1', shortName: 'TEST' }, [
      {
        id: '82-12',
        $type: 'SimpleProjectCustomField',
        field: {
          id: '58-4',
          name: 'Requester email',
          $type: 'CustomField',
          fieldType: { id: 'string', presentation: 'string' },
        },
        canBeEmpty: true,
        isPublic: true,
      },
    ])

    await createYouTrackTask(config, {
      projectId: 'TEST',
      title: 'Test task',
      customFields: [{ name: 'Requester email', value: 'test@example.com' }],
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toContainEqual({
      name: 'Requester email',
      $type: 'SimpleIssueCustomField',
      value: 'test@example.com',
    })
  })

  test('sends text object value for supported text project custom fields', async () => {
    mockCreateTaskResponse(makeIssueResponse(), { id: '0-1', shortName: 'TEST' }, [
      {
        id: '82-13',
        $type: 'TextProjectCustomField',
        field: {
          id: '58-5',
          name: 'Environment details',
          $type: 'CustomField',
          fieldType: { id: 'text', presentation: 'text' },
        },
        canBeEmpty: true,
        isPublic: true,
      },
    ])

    await createYouTrackTask(config, {
      projectId: 'TEST',
      title: 'Test task',
      customFields: [{ name: 'Environment details', value: 'Needs staging parity' }],
    })

    const body = getFetchBodyAt(2)
    expect(body['customFields']).toContainEqual({
      name: 'Environment details',
      $type: 'TextIssueCustomField',
      value: { text: 'Needs staging parity' },
    })
  })

  test('rejects explicitly supplied unsupported custom field types', async () => {
    mockCreateWithUnsupportedEnumField()

    await expect(
      createYouTrackTask(config, {
        projectId: 'TEST',
        title: 'Test task',
        customFields: [{ name: 'Type', value: 'Bug' }],
      }),
    ).rejects.toMatchObject({
      appError: {
        code: 'validation-failed',
        field: 'customFields',
      },
    })

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('rejects unknown custom field names instead of ignoring them', async () => {
    mockCreateWithUnknownField()

    try {
      await createYouTrackTask(config, {
        projectId: 'TEST',
        title: 'Test task',
        customFields: [{ name: 'Unknown field', value: 'value' }],
      })
      throw new Error('Expected createYouTrackTask to reject')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('validation-failed')
      assert(error.appError.code === 'validation-failed')
      expect(error.appError.field).toBe('customFields')
      expect(error.appError.reason).toContain('Unknown field')
    }

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('rejects supplied required custom field when its project type is unsupported', async () => {
    mockCreateWithRequiredUnsupportedField()

    try {
      await createYouTrackTask(config, {
        projectId: 'TEST',
        title: 'Test task',
        customFields: [{ name: 'Type', value: 'Bug' }],
      })
      throw new Error('Expected createYouTrackTask to reject')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('validation-failed')
      assert(error.appError.code === 'validation-failed')
      expect(error.appError.field).toBe('customFields')
      expect(error.appError.reason).toContain('Type')
    }

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('rejects supplied required simple project custom field when it is non-string', async () => {
    mockCreateWithNonStringSimpleField()

    try {
      await createYouTrackTask(config, {
        projectId: 'TEST',
        title: 'Test task',
        customFields: [{ name: 'Story points', value: '5' }],
      })
      throw new Error('Expected createYouTrackTask to reject')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('validation-failed')
      assert(error.appError.code === 'validation-failed')
      expect(error.appError.field).toBe('customFields')
      expect(error.appError.reason).toContain('Story points')
    }

    expect(fetchMock.mock.calls).toHaveLength(2)
  })
})

describe('getYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('retrieves task by id', async () => {
    mockGetTaskWithDueDateEnrichment(makeIssueResponse())

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.id).toBe('TEST-1')
    expect(task.title).toBe('Test task')
    expect(task.description).toBe('A description')
    expect(task.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
  })

  test('uses GET method with task id in path', async () => {
    mockGetTaskWithDueDateEnrichment(makeIssueResponse())

    await getYouTrackTask(config, 'TEST-1')

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
    assert(parsed.success)

    const url = new URL(parsed.data[0])
    expect(url.pathname).toBe('/api/issues/TEST-1')
    expect(parsed.data[1].method).toBe('GET')
  })

  test('maps labels from tags', async () => {
    mockGetTaskWithDueDateEnrichment(
      makeIssueResponse({
        tags: [
          { id: 'tag-1', name: 'bug', color: { id: 'c-1', background: '#ff0000' } },
          { id: 'tag-2', name: 'feature', color: null },
        ],
      }),
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.labels).toEqual([
      { id: 'tag-1', name: 'bug', color: '#ff0000' },
      { id: 'tag-2', name: 'feature', color: undefined },
    ])
  })

  test('maps relations from links', async () => {
    mockGetTaskWithDueDateEnrichment(
      makeIssueResponse({
        links: [
          {
            id: 'link-1',
            direction: 'OUTWARD',
            linkType: { id: 'lt-1', name: 'Depend' },
            issues: [{ id: '2-2', idReadable: 'TEST-2', summary: 'Other' }],
          },
        ],
      }),
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.relations).toEqual([{ type: 'blocks', taskId: 'TEST-2' }])
  })

  test('maps due date custom field to normalized dueDate', async () => {
    mockGetTaskWithDueDateEnrichment(
      makeIssueResponse({
        customFields: [
          {
            $type: 'SingleEnumIssueCustomField',
            name: 'Priority',
            value: { $type: 'EnumBundleElement', name: 'Normal' },
          },
          { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
        ],
      }),
      [{ name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') }],
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.dueDate).toBe('2026-03-25')

    const dueDateFetch = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(dueDateFetch.success)

    const dueDateUrl = new URL(dueDateFetch.data[0])
    expect(dueDateUrl.pathname).toBe('/api/issues/TEST-1/customFields')
    expect(dueDateUrl.searchParams.get('fields')).toBe('name,value')
  })

  test('degrades gracefully when get dueDate enrichment fetch fails', async () => {
    mockGetTaskWithFailedEnrichment()

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.id).toBe('TEST-1')
    expect(task.dueDate).toBeNull()
  })

  test('preserves existing dueDate when enrichment payload omits the field', async () => {
    mockGetTaskWithDueDateEnrichment(
      makeIssueResponse({
        customFields: [
          {
            $type: 'SingleEnumIssueCustomField',
            name: 'Priority',
            value: { $type: 'EnumBundleElement', name: 'Normal' },
          },
          { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
          { $type: 'DateIssueCustomField', name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') },
        ],
      }),
      [{ name: 'Priority', value: { name: 'Normal' } }],
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.dueDate).toBe('2026-03-25')
  })

  test('reads due date from mixed-type custom field responses', async () => {
    mockGetTaskWithDueDateEnrichment(makeIssueResponse(), [
      { name: 'Priority', value: { name: 'Normal' } },
      { name: 'Assignee', value: { login: 'alice' } },
      { name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') },
    ])

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.dueDate).toBe('2026-03-25')
  })

  test('paginates custom field fetch until due date is found', async () => {
    mockGetTaskWithPaginatedCustomFields()

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.dueDate).toBe('2026-03-25')

    const secondPageFetch = FetchCallSchema.safeParse(fetchMock.mock.calls[2])
    assert(secondPageFetch.success)

    const secondPageUrl = new URL(secondPageFetch.data[0])
    expect(secondPageUrl.pathname).toBe('/api/issues/TEST-1/customFields')
    expect(secondPageUrl.searchParams.get('$skip')).toBe('100')
  })

  test('returns normalized read-only custom fields alongside the standard task fields', async () => {
    mockFetchResponse(
      makeIssueResponse({
        customFields: [
          {
            $type: 'SingleEnumIssueCustomField',
            name: 'Priority',
            value: { $type: 'EnumBundleElement', name: 'High' },
          },
          { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
          { $type: 'SimpleIssueCustomField', name: 'Environment', value: 'staging' },
          { $type: 'TextIssueCustomField', name: 'Steps', value: { $type: 'TextFieldValue', text: 'Click login' } },
        ],
      }),
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.customFields).toEqual([
      { name: 'Environment', value: 'staging' },
      { name: 'Steps', value: 'Click login' },
    ])
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Issue not found /issues/' })

    try {
      await getYouTrackTask(config, 'NONEXISTENT')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('task-not-found')
    }
  })
})

describe('updateYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates task with title', async () => {
    mockFetchResponse(makeIssueResponse({ summary: 'Updated title' }))

    const task = await updateYouTrackTask(config, 'TEST-1', { title: 'Updated title' })

    expect(task.id).toBe('TEST-1')
    expect(task.title).toBe('Updated title')

    const body = getFetchBodyAt(0)
    expect(body['summary']).toBe('Updated title')
  })

  test('sends description when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', { description: 'New desc' })

    const body = getFetchBodyAt(0)
    expect(body['description']).toBe('New desc')
  })

  test('sends projectId when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', { projectId: 'proj-2' })

    const body = getFetchBodyAt(0)
    expect(body['project']).toEqual({ id: 'proj-2' })
  })

  test('sends custom fields for status, priority, and assignee', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', {
      status: 'Done',
      priority: 'Major',
      assignee: 'john',
    })

    const body = getFetchBodyAt(0)
    expect(body['customFields']).toContainEqual(expect.objectContaining({ name: 'Priority', value: { name: 'Major' } }))
    expect(body['customFields']).toContainEqual(expect.objectContaining({ name: 'State', value: { name: 'Done' } }))
    expect(body['customFields']).toContainEqual(expect.objectContaining({ name: 'Assignee', value: { login: 'john' } }))
  })

  test('sends due date custom field when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', {
      dueDate: '2026-03-25',
    })

    const body = getFetchBodyAt(0)
    expect(body['customFields']).toContainEqual({
      name: 'Due Date',
      $type: 'DateIssueCustomField',
      value: Date.parse('2026-03-25T12:00:00.000Z'),
    })
  })

  test('sends simple and text custom fields on update', async () => {
    mockUpdateWithCustomFields()

    await updateYouTrackTask(config, 'TEST-1', {
      customFields: [
        { name: 'Environment', value: 'staging' },
        { name: 'Steps', value: 'Click login' },
      ],
    })

    expect(getFetchBodyAt(2)['customFields']).toContainEqual({
      name: 'Environment',
      $type: 'SimpleIssueCustomField',
      value: 'staging',
    })
    expect(getFetchBodyAt(2)['customFields']).toContainEqual({
      name: 'Steps',
      $type: 'TextIssueCustomField',
      value: { text: 'Click login' },
    })
  })

  test('rejects unknown custom field names on update before sending the write request', async () => {
    mockUpdateWithUnknownField()

    await expect(
      updateYouTrackTask(config, 'TEST-1', {
        customFields: [{ name: 'Unknown field', value: 'value' }],
      }),
    ).rejects.toMatchObject({
      appError: {
        code: 'validation-failed',
        field: 'customFields',
      },
    })

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('rejects unsupported project custom field types on update before sending the write request', async () => {
    mockUpdateWithUnsupportedField()

    await expect(
      updateYouTrackTask(config, 'TEST-1', {
        customFields: [{ name: 'Type', value: 'Bug' }],
      }),
    ).rejects.toMatchObject({
      appError: {
        code: 'validation-failed',
        field: 'customFields',
      },
    })

    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('rejects writes to dedicated fields through customFields on update', async () => {
    const dedicatedFields = ['State', 'Priority', 'Assignee', 'Due Date'] as const

    for (const fieldName of dedicatedFields) {
      mockUpdateDedicatedFieldLookup(fieldName)

      await expect(
        updateYouTrackTask(config, 'TEST-1', {
          customFields: [{ name: fieldName, value: 'value' }],
        }),
      ).rejects.toMatchObject({
        appError: {
          code: 'validation-failed',
          field: 'customFields',
        },
      })

      expect(fetchMock.mock.calls).toHaveLength(2)
    }
  })

  test('validates custom fields against the destination project when moving an issue', async () => {
    mockUpdateValidateDestinationProject()

    await updateYouTrackTask(config, 'TEST-1', {
      projectId: '0-2',
      customFields: [{ name: 'Environment', value: 'staging' }],
    })

    const customFieldsUrl = getFetchUrlAt(0)
    expect(customFieldsUrl.pathname).toBe('/api/admin/projects/0-2/customFields')

    const updateBody = getFetchBodyAt(1)
    expect(updateBody['project']).toEqual({ id: '0-2' })
    expect(updateBody['customFields']).toContainEqual({
      name: 'Environment',
      $type: 'SimpleIssueCustomField',
      value: 'staging',
    })
  })

  test('returns dueDate after update using follow-up custom fields fetch', async () => {
    mockUpdateWithDueDateEnrichment(await jsonOk([{ name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') }]))

    const task = await updateYouTrackTask(config, 'TEST-1', {
      dueDate: '2026-03-25',
    })

    expect(task.dueDate).toBe('2026-03-25')
  })

  test('preserves update dueDate when enrichment fetch fails', async () => {
    mockUpdateWithFailedEnrichment()

    const task = await updateYouTrackTask(config, 'TEST-1', {
      dueDate: '2026-03-25T23:45:00+02:00',
    })

    expect(task.id).toBe('TEST-1')
    expect(task.dueDate).toBe('2026-03-25')
  })

  test('canonicalizes datetime input to date-only value when updating', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', {
      dueDate: '2026-03-25T23:45:00.000Z',
    })

    const body = getFetchBodyAt(0)
    expect(body['customFields']).toContainEqual({
      name: 'Due Date',
      $type: 'DateIssueCustomField',
      value: Date.parse('2026-03-25T12:00:00.000Z'),
    })
  })

  test('rejects malformed due date before sending update request', async () => {
    mockFetchResponse(makeIssueResponse())

    await expect(updateYouTrackTask(config, 'TEST-1', { dueDate: 'not-a-date' })).rejects.toMatchObject({
      appError: { code: 'validation-failed', field: 'dueDate' },
    })

    expect(fetchMock.mock.calls).toHaveLength(0)
  })

  test('does not send fields when they are not provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', {})

    const body = getFetchBodyAt(0)
    expect(body['summary']).toBeUndefined()
    expect(body['description']).toBeUndefined()
    expect(body['project']).toBeUndefined()
    expect(body['customFields']).toBeUndefined()
  })

  test('uses POST method with task id in path', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', { title: 'Updated' })

    const url = getFetchUrlAt(0)
    expect(url.pathname).toBe('/api/issues/TEST-1')
    expect(getFetchMethodAt(0)).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500, { error: 'Server error' })

    await expect(updateYouTrackTask(config, 'TEST-1', { title: 'Updated' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

describe('listYouTrackTasks', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped list items', async () => {
    mockListWithProject({ id: '39-883', shortName: 'TEST', name: 'Test Project' }, [
      makeIssueListResponse(),
      makeIssueListResponse({ id: '2-2', idReadable: 'TEST-2', summary: 'Second task' }),
    ])

    const items = await listYouTrackTasks(config, '39-883')

    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('TEST-1')
    expect(items[0]!.title).toBe('Test task')
    expect(items[0]!.status).toBe('Open')
    expect(items[0]!.priority).toBe('Normal')
    expect(items[0]!.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    expect(items[1]!.id).toBe('TEST-2')
    expect(items[1]!.title).toBe('Second task')
  })

  test('fetches project shortName and uses it in query', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883')

    // Get the second call (issues search)
    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.pathname).toBe('/api/issues')
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO}')
    expect(urlObj.searchParams.get('$top')).toBe('100')
    expect(urlObj.searchParams.getAll('customFields')).toEqual(['State', 'Priority', 'Due Date'])
  })

  test('returns empty array when no issues', async () => {
    mockListWithProject({ id: '39-883', shortName: 'EMPTY', name: 'Empty Project' }, [])

    const items = await listYouTrackTasks(config, '39-883')

    expect(items).toEqual([])
  })

  test('maps due date on list results when provided inline', async () => {
    mockListWithDueDateInline({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [
      {
        id: '2-1',
        idReadable: 'DEMO-1',
        numberInProject: 1,
        summary: 'Task with due date',
        resolved: null,
        created: 1718400000000,
        project: { id: '39-883', shortName: 'DEMO' },
        customFields: [
          { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
          { $type: 'DateIssueCustomField', name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') },
        ],
      },
    ])

    const items = await listYouTrackTasks(config, '39-883')

    expect(items).toHaveLength(1)
    expect(items[0]).toHaveProperty('dueDate', '2026-03-25')
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('requests only selected custom fields inline for list results', async () => {
    mockListWithDueDateInline({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [
      {
        id: '2-1',
        idReadable: 'DEMO-1',
        numberInProject: 1,
        summary: 'Task one',
        resolved: null,
        created: 1718400000000,
        project: { id: '39-883', shortName: 'DEMO' },
        customFields: [
          { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
          {
            $type: 'SingleEnumIssueCustomField',
            name: 'Priority',
            value: { $type: 'EnumBundleElement', name: 'Normal' },
          },
          { $type: 'DateIssueCustomField', name: 'Due Date', value: Date.parse('2026-03-25T12:00:00.000Z') },
        ],
      },
      {
        id: '2-2',
        idReadable: 'DEMO-2',
        numberInProject: 2,
        summary: 'Task two',
        resolved: null,
        created: 1718400000000,
        project: { id: '39-883', shortName: 'DEMO' },
        customFields: [{ $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } }],
      },
    ])

    const items = await listYouTrackTasks(config, '39-883')

    expect(items).toHaveLength(2)
    expect(items[0]).toHaveProperty('dueDate', '2026-03-25')
    expect(items[1]).toHaveProperty('dueDate', undefined)
    expect(items[0]).toHaveProperty('priority', 'Normal')
    expect(fetchMock.mock.calls).toHaveLength(2)

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)

    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.getAll('customFields')).toEqual(['State', 'Priority', 'Due Date'])
  })

  test('throws classified error on project fetch failure', async () => {
    mockFetchError(403, { error: 'Forbidden' })

    try {
      await listYouTrackTasks(config, 'proj-1')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('auth-failed')
    }
  })

  test('includes status filter in query when provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { status: 'In Progress' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} State: {In Progress}')
  })

  test('includes priority filter in query when provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { priority: 'high' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Priority: {high}')
  })

  test('includes assignee filter in query when provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { assigneeId: 'john.doe' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Assignee: {john.doe}')
  })

  test('includes due date range filters in query when provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { dueAfter: '2024-01-01', dueBefore: '2024-12-31' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Due date: >2024-01-01 Due date: <2024-12-31')
  })

  test('uses exclusive dueAfter filter when only lower bound is provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { dueAfter: '2024-01-01' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Due date: >2024-01-01')
  })

  test('uses exclusive dueBefore filter when only upper bound is provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { dueBefore: '2024-12-31' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Due date: <2024-12-31')
  })

  test('uses limit parameter for $top', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { limit: 25 })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('$top')).toBe('25')
  })

  test('uses page parameter with limit for pagination', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { limit: 25, page: 3 })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('$top')).toBe('25')
    expect(urlObj.searchParams.get('$skip')).toBe('50')
  })

  test('includes sort parameters in query when provided', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', { sortBy: 'priority', sortOrder: 'desc' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} sort by: priority desc')
  })

  test('combines multiple filters in query', async () => {
    mockListWithProject({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }, [])

    await listYouTrackTasks(config, '39-883', {
      status: 'Open',
      priority: 'urgent',
      assigneeId: 'jane.doe',
      limit: 10,
    })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe(
      'project: {DEMO} State: {Open} Priority: {urgent} Assignee: {jane.doe}',
    )
    expect(urlObj.searchParams.get('$top')).toBe('10')
  })

  test('automatically paginates to fetch all tasks when more than 100 exist', async () => {
    mockListWithAutoPagination()

    const items = await listYouTrackTasks(config, '39-883')

    // Should fetch all 250 tasks across 3 pages
    expect(items).toHaveLength(250)
    expect(items[0]!.id).toBe('DEMO-1')
    expect(items[99]!.id).toBe('DEMO-100')
    expect(items[199]!.id).toBe('DEMO-200')
    expect(items[249]!.id).toBe('DEMO-250')
    // 1 project + 3 list pages
    expect(fetchMock.mock.calls).toHaveLength(4)
  })

  test('respects maxPages limit to prevent excessive API calls', async () => {
    mockListWithMaxPages()

    const items = await listYouTrackTasks(config, '39-883')

    // Should stop at maxPages (10 pages = 1000 items)
    expect(items).toHaveLength(1000)
    // 1 project + 10 list pages
    expect(fetchMock.mock.calls).toHaveLength(11)
  })
})

describe('searchYouTrackTasks', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped search results', async () => {
    mockFetchResponse([makeIssueListResponse()])

    const results = await searchYouTrackTasks(config, { query: 'bug fix' })

    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('TEST-1')
    expect(results[0]!.title).toBe('Test task')
    expect(results[0]!.status).toBe('Open')
    expect(results[0]!.priority).toBe('Normal')
    expect(results[0]!.projectId).toBe('0-1')
    expect(results[0]!.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
  })

  test('prepends project filter when projectId is provided', async () => {
    mockSearchWithProject({ id: '39-883', shortName: 'MY-PROJ', name: 'My Project' }, [])

    await searchYouTrackTasks(config, { query: 'bug', projectId: '39-883' })

    // Get the second call (issues search)
    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {MY-PROJ} bug')
  })

  test('does not prepend project filter when projectId is absent', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'bug' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('query')).toBe('bug')
  })

  test('uses custom limit when provided', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'test', limit: 10 })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('$top')).toBe('10')
  })

  test('passes $top and $skip when search pagination params are provided', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'bug', limit: 25, offset: 50 })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues')
    expect(url.searchParams.get('$top')).toBe('25')
    expect(url.searchParams.get('$skip')).toBe('50')
  })

  test('defaults to limit 50', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'test' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('$top')).toBe('50')
  })

  test('returns empty array for no results', async () => {
    mockFetchResponse([])

    const results = await searchYouTrackTasks(config, { query: 'nonexistent' })

    expect(results).toEqual([])
  })

  test('throws classified error on failure', async () => {
    mockFetchError(429, { error: 'Rate limited' })

    try {
      await searchYouTrackTasks(config, { query: 'test' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('rate-limited')
    }
  })

  test('throws classified error with projectId context', async () => {
    mockFetchError(500, { error: 'Server error' })

    await expect(searchYouTrackTasks(config, { query: 'test', projectId: 'proj-1' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('prepends assignee filter when assigneeId is provided', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'bug fix', assigneeId: 'john.doe' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('query')).toBe('assignee: {john.doe} bug fix')
  })

  test('prepends both assignee and project filters when both are provided', async () => {
    mockSearchWithProject({ id: '39-883', shortName: 'MY-PROJ', name: 'My Project' }, [])

    await searchYouTrackTasks(config, { query: 'bug', projectId: '39-883', assigneeId: 'john.doe' })

    // Get the second call (issues search)
    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    assert(parsed.success)
    const [url] = parsed.data
    const urlObj = new URL(url)
    // Assignee filter comes first (prepended last), then project filter
    expect(urlObj.searchParams.get('query')).toBe('assignee: {john.doe} project: {MY-PROJ} bug')
  })
})

describe('deleteYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('deletes task and returns id', async () => {
    mockFetchNoContent()

    const result = await deleteYouTrackTask(config, 'TEST-1')

    expect(result).toEqual({ id: 'TEST-1' })
  })

  test('uses DELETE method with task id in path', async () => {
    mockFetchNoContent()

    await deleteYouTrackTask(config, 'TEST-42')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-42')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Issue not found /issues/' })

    try {
      await deleteYouTrackTask(config, 'NONEXISTENT')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('task-not-found')
    }
  })
})
