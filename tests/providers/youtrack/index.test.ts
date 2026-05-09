import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { YouTrackApiError } from '../../../src/providers/youtrack/client.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { clearBundleCache } from './test-helpers.js'

// Store reference to current fetch mock for call inspection
let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>> | undefined

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

const installFetchMock = (handler: () => Promise<Response>): void => {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
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

const mockFetchNoContent = (): void => {
  installFetchMock(() => Promise.resolve(new Response(null, { status: 204 })))
}

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  installFetchMock(() => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

/** Schema for a mock fetch call tuple: [url, init] */
const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({
    method: z.string().optional(),
    body: z.string().optional(),
  }),
])

const RequestBodySchema = z.object({
  customFields: z.array(z.unknown()).optional(),
})

/** Helper to extract the URL of the last fetch call. */
const getLastFetchUrl = (): URL => {
  if (fetchMock === undefined) return new URL('')
  const lastCall = fetchMock.mock.calls[0]
  const parsed = FetchCallSchema.safeParse(lastCall)
  if (!parsed.success) return new URL('')
  const [url] = parsed.data
  return new URL(url)
}

const getFetchUrlAt = (index: number): URL => {
  if (fetchMock === undefined) return new URL('')
  const call = fetchMock.mock.calls[index]
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return new URL('')
  const [url] = parsed.data
  return new URL(url)
}

const getFetchMethodAt = (index: number): string => {
  if (fetchMock === undefined) return ''
  const call = fetchMock.mock.calls[index]
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return ''
  const [, init] = parsed.data
  return init.method ?? ''
}

const getFetchBodyAt = (index: number): unknown => {
  if (fetchMock === undefined) return undefined
  const call = fetchMock.mock.calls[index]
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return undefined
  const [, init] = parsed.data
  if (init.body === undefined) return undefined
  return JSON.parse(init.body) as unknown
}

const parseCustomFields = (value: unknown): unknown[] => {
  const parsed = RequestBodySchema.safeParse(value)
  if (!parsed.success || parsed.data.customFields === undefined) {
    throw new Error('Expected body to have customFields')
  }
  return parsed.data.customFields
}

/** Finds the index of the first fetch call whose URL includes '/api/issues'. */
const findIssuesCreateCallIndex = (calls: unknown[]): number =>
  calls.findIndex((call) => {
    const parsed = FetchCallSchema.safeParse(call)
    if (!parsed.success) return false
    return parsed.data[0].includes('/api/issues')
  })

/** Mock handler: returns a project on the first call, issues list on subsequent calls. */
const makeListTasksHandler = (): (() => Promise<Response>) => {
  let callCount = 0
  return (): Promise<Response> => {
    callCount++
    if (callCount === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: '0-1', shortName: 'TEST', name: 'Test Project' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(
        JSON.stringify([
          {
            id: '2-1',
            idReadable: 'TEST-1',
            summary: 'First',
            project: { id: '0-1', shortName: 'TEST' },
            customFields: [],
          },
          {
            id: '2-2',
            idReadable: 'TEST-2',
            summary: 'Second',
            project: { id: '0-1', shortName: 'TEST' },
            customFields: [],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
}

/** Mock handler: returns a project on the first call, empty search results on subsequent calls. */
const makeSearchTasksHandler = (): (() => Promise<Response>) => {
  let callCount = 0
  return (): Promise<Response> => {
    callCount++
    if (callCount === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: '0-1', shortName: 'PROJ', name: 'Project' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  }
}

describe('YouTrackProvider', () => {
  let provider: YouTrackProvider

  beforeEach(() => {
    mockLogger()
    clearBundleCache()
    provider = new YouTrackProvider(createConfig())
    fetchMock = undefined
  })

  afterEach(() => {
    restoreFetch()
    fetchMock = undefined
  })

  describe('identity', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('youtrack')
    })

    test('has expected capabilities', () => {
      // Tasks (full support)
      expect(provider.capabilities.has('tasks.delete')).toBe(true)
      expect(provider.capabilities.has('tasks.count')).toBe(true)
      expect(provider.capabilities.has('tasks.relations')).toBe(true)
      expect(provider.capabilities.has('tasks.watchers')).toBe(true)
      expect(provider.capabilities.has('tasks.votes')).toBe(true)
      expect(provider.capabilities.has('tasks.visibility')).toBe(true)
      // Projects (full CRUD support)
      expect(provider.capabilities.has('projects.read')).toBe(true)
      expect(provider.capabilities.has('projects.list')).toBe(true)
      expect(provider.capabilities.has('projects.create')).toBe(true)
      expect(provider.capabilities.has('projects.update')).toBe(true)
      expect(provider.capabilities.has('projects.delete')).toBe(true)
      expect(provider.capabilities.has('projects.team')).toBe(true)
      // Comments (full CRUD support)
      expect(provider.capabilities.has('comments.read')).toBe(true)
      expect(provider.capabilities.has('comments.create')).toBe(true)
      expect(provider.capabilities.has('comments.update')).toBe(true)
      expect(provider.capabilities.has('comments.delete')).toBe(true)
      expect(provider.capabilities.has('comments.reactions')).toBe(true)
      // Labels (full CRUD + assignment)
      expect(provider.capabilities.has('labels.list')).toBe(true)
      expect(provider.capabilities.has('labels.create')).toBe(true)
      expect(provider.capabilities.has('labels.update')).toBe(true)
      expect(provider.capabilities.has('labels.delete')).toBe(true)
      expect(provider.capabilities.has('labels.assign')).toBe(true)
      // Statuses (state bundles)
      expect(provider.capabilities.has('statuses.list')).toBe(true)
      expect(provider.capabilities.has('statuses.create')).toBe(true)
      expect(provider.capabilities.has('statuses.update')).toBe(true)
      expect(provider.capabilities.has('statuses.delete')).toBe(true)
      expect(provider.capabilities.has('statuses.reorder')).toBe(true)
      // Sprints, activities, and saved queries
      expect(provider.capabilities.has('sprints.list')).toBe(true)
      expect(provider.capabilities.has('sprints.create')).toBe(true)
      expect(provider.capabilities.has('sprints.update')).toBe(true)
      expect(provider.capabilities.has('sprints.assign')).toBe(true)
      expect(provider.capabilities.has('activities.read')).toBe(true)
      expect(provider.capabilities.has('queries.saved')).toBe(true)
    })

    test('has config requirements', () => {
      expect(provider.configRequirements).toHaveLength(2)
      expect(provider.configRequirements[0]!.key).toBe('youtrack_url')
      expect(provider.configRequirements[1]!.key).toBe('youtrack_token')
    })

    test('returns prompt addendum about YouTrack', () => {
      const addendum = provider.getPromptAddendum()
      expect(addendum).toContain('YouTrack')
      expect(addendum).toContain('State')
    })

    test('exposes phase 4 methods', () => {
      expect(typeof provider.listUsers).toBe('function')
      expect(typeof provider.getCurrentUser).toBe('function')
      expect(typeof provider.listProjectTeam).toBe('function')
      expect(typeof provider.addProjectMember).toBe('function')
      expect(typeof provider.removeProjectMember).toBe('function')
      expect(typeof provider.listWatchers).toBe('function')
      expect(typeof provider.addWatcher).toBe('function')
      expect(typeof provider.removeWatcher).toBe('function')
      expect(typeof provider.addVote).toBe('function')
      expect(typeof provider.removeVote).toBe('function')
      expect(typeof provider.setVisibility).toBe('function')
      expect(typeof provider.addCommentReaction).toBe('function')
      expect(typeof provider.removeCommentReaction).toBe('function')
    })

    test('exposes phase 5 methods', () => {
      expect(typeof provider.listAgiles).toBe('function')
      expect(typeof provider.listSprints).toBe('function')
      expect(typeof provider.createSprint).toBe('function')
      expect(typeof provider.updateSprint).toBe('function')
      expect(typeof provider.assignTaskToSprint).toBe('function')
      expect(typeof provider.getTaskHistory).toBe('function')
      expect(typeof provider.listSavedQueries).toBe('function')
      expect(typeof provider.runSavedQuery).toBe('function')
      expect(typeof provider.countTasks).toBe('function')
    })
  })

  describe('createTask', () => {
    test('creates issue and returns mapped task', async () => {
      mockFetchSequence([
        // First: project lookup
        { data: { id: '0-1', shortName: 'TEST' } },
        // Second: project custom fields lookup
        { data: [] },
        // Third: issue creation response
        {
          data: {
            id: '2-1',
            idReadable: 'TEST-1',
            summary: 'New task',
            description: 'A description',
            project: { id: '0-1', shortName: 'TEST' },
            created: 1700000000000,
            updated: 1700000000000,
            customFields: [{ $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'Normal' } }],
            tags: [],
            links: [],
          },
        },
      ])

      const task = await provider.createTask({
        projectId: '0-1',
        title: 'New task',
        description: 'A description',
      })

      expect(task.id).toBe('TEST-1')
      expect(task.title).toBe('New task')
      expect(task.description).toBe('A description')
      expect(task.priority).toBe('Normal')
      expect(task.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    })

    test('sends custom fields for priority and status', async () => {
      mockFetchSequence([
        // First: project lookup
        { data: { id: '0-1', shortName: 'TEST' } },
        // Second: project custom fields lookup
        { data: [] },
        // Third: issue creation response
        {
          data: {
            id: '2-2',
            idReadable: 'TEST-2',
            summary: 'Task with fields',
            project: { id: '0-1', shortName: 'TEST' },
            created: 1700000000000,
            updated: 1700000000000,
            customFields: [],
            tags: [],
            links: [],
          },
        },
        // Fourth: enrichTaskWithDueDate fetches issue custom fields
        { data: [] },
      ])

      await provider.createTask({
        projectId: '0-1',
        title: 'Task with fields',
        priority: 'Critical',
        status: 'In Progress',
      })

      // Get the third call (issue creation - first two are GET project and GET custom fields)
      assert(fetchMock !== undefined)
      const calls = fetchMock.mock.calls
      const createCallIndex = findIssuesCreateCallIndex(calls)
      expect(createCallIndex).toBeGreaterThanOrEqual(0)
      const createCall = calls[createCallIndex]
      const parsed = FetchCallSchema.safeParse(createCall)
      expect(parsed.success).toBe(true)
      assert(parsed.success)

      const rawBody: unknown = getFetchBodyAt(createCallIndex)
      const customFields = parseCustomFields(rawBody)
      expect(customFields).toEqual([
        { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } },
        { name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
      ])
    })
  })

  describe('getTask', () => {
    test('fetches and maps issue with relations', async () => {
      mockFetchResponse({
        id: '2-5',
        idReadable: 'TEST-5',
        summary: 'Task with links',
        created: 1700000000000,
        updated: 1700000000001,
        project: { id: '0-1', shortName: 'TEST' },
        customFields: [{ $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } }],
        tags: [{ id: 'tag-1', name: 'bug', color: { background: '#ff0000' } }],
        links: [
          {
            direction: 'OUTWARD',
            linkType: { id: 'lt-1', name: 'Depend', sourceToTarget: 'is required for' },
            issues: [{ id: '2-6', idReadable: 'TEST-6', summary: 'Blocked task' }],
          },
        ],
      })

      const task = await provider.getTask('TEST-5')

      expect(task.id).toBe('TEST-5')
      expect(task.status).toBe('Open')
      expect(task.labels).toHaveLength(1)
      expect(task.labels![0]!.name).toBe('bug')
      expect(task.labels![0]!.color).toBe('#ff0000')
      expect(task.relations).toHaveLength(1)
      expect(task.relations![0]!.type).toBe('blocks')
      expect(task.relations![0]!.taskId).toBe('TEST-6')
    })
  })

  describe('updateTask', () => {
    test('sends POST to update issue', async () => {
      mockFetchResponse({
        id: '2-1',
        idReadable: 'TEST-1',
        summary: 'Updated title',
        project: { id: '0-1' },
        created: 1700000000000,
        updated: 1700000000000,
        customFields: [],
        tags: [],
        links: [],
      })

      const task = await provider.updateTask('TEST-1', { title: 'Updated title' })

      expect(task.title).toBe('Updated title')
      const url = getLastFetchUrl()
      expect(url.pathname).toContain('/api/issues/TEST-1')
    })
  })

  describe('listTasks', () => {
    test('queries issues by project shortName', async () => {
      // First call: get project to obtain shortName
      // Second call: list issues using shortName
      installFetchMock(makeListTasksHandler())

      const tasks = await provider.listTasks('0-1')

      expect(tasks).toHaveLength(2)
      expect(tasks[0]!.id).toBe('TEST-1')
      expect(tasks[1]!.id).toBe('TEST-2')
    })
  })

  describe('searchTasks', () => {
    test('searches with query parameter', async () => {
      mockFetchResponse([
        {
          id: '2-3',
          idReadable: 'TEST-3',
          summary: 'Bug fix',
          project: { id: '0-1', shortName: 'TEST' },
          customFields: [],
        },
      ])

      const results = await provider.searchTasks({ query: 'bug' })

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('TEST-3')
      const url = getLastFetchUrl()
      expect(url.searchParams.get('query')).toBe('bug')
    })

    test('fetches project shortName and includes in query', async () => {
      // First call: get project to obtain shortName
      // Second call: search issues using shortName
      installFetchMock(makeSearchTasksHandler())

      await provider.searchTasks({ query: 'test', projectId: '0-1' })

      // Get the second call (issues search)
      assert(fetchMock !== undefined)
      const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
      expect(parsed.success).toBe(true)
      assert(parsed.success)
      const [url] = parsed.data
      const urlObj = new URL(url)
      expect(urlObj.searchParams.get('query')).toBe('project: {PROJ} test')
    })
  })

  describe('deleteTask', () => {
    test('sends DELETE request', async () => {
      mockFetchNoContent()
      const result = await provider.deleteTask('TEST-1')
      expect(result.id).toBe('TEST-1')
    })
  })

  describe('deleteProject', () => {
    test('sends DELETE request', async () => {
      mockFetchNoContent()
      const result = await provider.deleteProject('proj-1')
      expect(result.id).toBe('proj-1')
    })
  })

  describe('comments', () => {
    test('addComment creates comment', async () => {
      mockFetchResponse({
        id: 'comment-1',
        text: 'Hello',
        author: { id: 'u-1', login: 'john', name: 'John' },
        created: 1700000000000,
      })

      const comment = await provider.addComment('TEST-1', 'Hello')
      expect(comment.id).toBe('comment-1')
      expect(comment.body).toBe('Hello')
      expect(comment.author).toBe('John')
    })

    test('getComments lists comments', async () => {
      mockFetchResponse([
        { id: 'c-1', text: 'First', author: { id: 'u-alice', login: 'alice' }, created: 1700000000000 },
        { id: 'c-2', text: 'Second', author: { id: 'u-bob', login: 'bob', name: 'Bob' }, created: 1700000001000 },
      ])

      const comments = await provider.getComments('TEST-1')
      expect(comments).toHaveLength(2)
      expect(comments[0]!.author).toBe('alice')
      expect(comments[1]!.author).toBe('Bob')
    })

    test('getComment fetches single comment', async () => {
      mockFetchResponse({
        id: 'c-42',
        text: 'Specific comment',
        author: { id: 'u-alice', login: 'alice', name: 'Alice' },
        created: 1700000000000,
      })

      const comment = await provider.getComment('TEST-1', 'c-42')
      expect(comment.id).toBe('c-42')
      expect(comment.body).toBe('Specific comment')
      expect(comment.author).toBe('Alice')
    })

    test('updateComment sends POST', async () => {
      mockFetchResponse({
        id: 'c-1',
        text: 'Updated text',
        author: { id: 'u-alice', login: 'alice' },
        created: 1700000000000,
      })

      const comment = await provider.updateComment({
        taskId: 'TEST-1',
        commentId: 'c-1',
        body: 'Updated text',
      })
      expect(comment.body).toBe('Updated text')
    })
  })

  describe('labels (tags)', () => {
    test('listLabels returns tags', async () => {
      mockFetchResponse([
        { id: 'tag-1', name: 'bug', color: { background: '#ff0000' } },
        { id: 'tag-2', name: 'feature', color: { background: '#00ff00' } },
      ])

      const labels = await provider.listLabels()
      expect(labels).toHaveLength(2)
      expect(labels[0]!.name).toBe('bug')
      expect(labels[0]!.color).toBe('#ff0000')
    })

    test('createLabel creates tag', async () => {
      mockFetchResponse({ id: 'tag-3', name: 'docs', color: null })

      const label = await provider.createLabel({ name: 'docs' })
      expect(label.id).toBe('tag-3')
      expect(label.name).toBe('docs')
    })

    test('removeLabel deletes tag', async () => {
      mockFetchNoContent()
      const result = await provider.removeLabel('tag-1')
      expect(result.id).toBe('tag-1')
    })
  })

  describe('phase 4 collaboration wiring', () => {
    test('listUsers delegates to the users endpoint and maps results', async () => {
      mockFetchResponse([
        { id: 'user-1', login: 'alice', name: 'Alice Example', fullName: 'Alice Example', email: 'alice@example.com' },
        { id: 'user-2', login: 'bob', name: 'Bob Example', fullName: 'Bob Example', email: 'bob@example.com' },
      ])

      const users = await provider.listUsers?.('ali', 5)

      expect(users).toEqual([{ id: 'user-1', login: 'alice', name: 'Alice Example' }])
      const url = getFetchUrlAt(0)
      expect(url.pathname).toBe('/api/users')
      expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
      expect(getFetchMethodAt(0)).toBe('GET')
    })

    test('getCurrentUser delegates to the me endpoint', async () => {
      mockFetchResponse({
        id: 'me-1',
        login: 'current-user',
        name: 'Current User',
        fullName: 'Current User',
        email: 'current@example.com',
      })

      const user = await provider.getCurrentUser?.()

      expect(user).toEqual({ id: 'me-1', login: 'current-user', name: 'Current User' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/users/me')
      expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
      expect(getFetchMethodAt(0)).toBe('GET')
    })

    test('project team methods delegate to team endpoints', async () => {
      mockFetchSequence([
        { data: { id: 'proj-1', ringId: 'project-ring-1', shortName: 'PROJ', name: 'Project One' } },
        { data: [{ id: 'ring-user-1', login: 'alice', name: 'Alice Example', type: 'user' }] },
      ])

      const team = await provider.listProjectTeam?.('proj-1')

      expect(team).toEqual([{ id: 'ring-user-1', login: 'alice', name: 'Alice Example' }])
      expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/proj-1')
      expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,ringId,shortName,name')
      expect(getFetchMethodAt(0)).toBe('GET')
      expect(getFetchUrlAt(1).pathname).toBe('/hub/api/rest/projects/project-ring-1/team/users')
      expect(getFetchUrlAt(1).searchParams.get('fields')).toBe('id,login,name')
      expect(getFetchMethodAt(1)).toBe('GET')

      mockFetchSequence([
        { data: { id: 'proj-1', ringId: 'project-ring-1', shortName: 'PROJ', name: 'Project One' } },
        {
          data: {
            id: 'user-7',
            login: 'user7',
            name: 'User 7',
            fullName: 'User 7',
            email: 'user7@example.com',
            ringId: 'ring-user-7',
          },
        },
        { data: null, status: 204 },
      ])
      const addedMember = await provider.addProjectMember?.('proj-1', 'user-7')
      expect(addedMember).toEqual({ projectId: 'proj-1', userId: 'user-7' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/proj-1')
      expect(getFetchUrlAt(1).pathname).toBe('/api/users/user-7')
      expect(getFetchUrlAt(2).pathname).toBe('/hub/api/rest/projects/project-ring-1/team/users')
      expect(getFetchMethodAt(2)).toBe('POST')
      expect(getFetchBodyAt(2)).toEqual({ id: 'ring-user-7' })

      mockFetchSequence([
        { data: { id: 'proj-1', ringId: 'project-ring-1', shortName: 'PROJ', name: 'Project One' } },
        {
          data: {
            id: 'user-7',
            login: 'user7',
            name: 'User 7',
            fullName: 'User 7',
            email: 'user7@example.com',
            ringId: 'ring-user-7',
          },
        },
        { data: null, status: 204 },
      ])
      const removedMember = await provider.removeProjectMember?.('proj-1', 'user-7')
      expect(removedMember).toEqual({ projectId: 'proj-1', userId: 'user-7' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/admin/projects/proj-1')
      expect(getFetchUrlAt(1).pathname).toBe('/api/users/user-7')
      expect(getFetchUrlAt(2).pathname).toBe('/hub/api/rest/projects/project-ring-1/team/users/ring-user-7')
      expect(getFetchMethodAt(2)).toBe('DELETE')
    })

    test('watcher methods delegate to issue watcher endpoints', async () => {
      mockFetchResponse({
        id: 'issue-1',
        watchers: {
          hasStar: true,
          issueWatchers: [
            {
              isStarred: true,
              user: { id: 'user-1', login: 'alice', fullName: 'Alice Example', email: 'alice@example.com' },
            },
          ],
        },
      })

      const watchers = await provider.listWatchers?.('TEST-1')

      expect(watchers).toEqual([{ id: 'user-1', login: 'alice', name: 'Alice Example' }])
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1')
      expect(getFetchMethodAt(0)).toBe('GET')

      mockFetchNoContent()
      const addedWatcher = await provider.addWatcher?.('TEST-1', 'user-1')
      expect(addedWatcher).toEqual({ taskId: 'TEST-1', userId: 'user-1' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1/watchers/issueWatchers')
      expect(getFetchMethodAt(0)).toBe('POST')
      expect(getFetchBodyAt(0)).toEqual({ user: { id: 'user-1' }, isStarred: true })

      mockFetchNoContent()
      const removedWatcher = await provider.removeWatcher?.('TEST-1', 'user-1')
      expect(removedWatcher).toEqual({ taskId: 'TEST-1', userId: 'user-1' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1/watchers/issueWatchers/user-1')
      expect(getFetchMethodAt(0)).toBe('DELETE')
    })

    test('vote methods delegate to REST endpoint', async () => {
      mockFetchNoContent()

      const addVoteResult = await provider.addVote?.('TEST-1')

      expect(addVoteResult).toEqual({ taskId: 'TEST-1' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1/voters')
      expect(getFetchMethodAt(0)).toBe('POST')
      expect(getFetchBodyAt(0)).toEqual({ hasVote: true })

      mockFetchNoContent()
      const removeVoteResult = await provider.removeVote?.('TEST-1')

      expect(removeVoteResult).toEqual({ taskId: 'TEST-1' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1/voters')
      expect(getFetchMethodAt(0)).toBe('DELETE')
    })

    test('setVisibility delegates with normalized response', async () => {
      mockFetchResponse({
        id: 'issue-1',
        visibility: {
          $type: 'LimitedVisibility',
          permittedUsers: [{ id: 'user-1', login: 'alice', fullName: 'Alice Example' }],
          permittedGroups: [{ id: 'group-1', name: 'Team Alpha' }],
        },
      })

      const result = await provider.setVisibility?.('TEST-1', {
        kind: 'restricted',
        userIds: ['user-1'],
        groupIds: ['group-1'],
      })

      expect(result).toEqual({
        taskId: 'TEST-1',
        visibility: {
          kind: 'restricted',
          users: [{ id: 'user-1', login: 'alice', name: 'Alice Example' }],
          groups: [{ id: 'group-1', name: 'Team Alpha' }],
        },
      })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1')
      expect(getFetchMethodAt(0)).toBe('POST')
      expect(getFetchBodyAt(0)).toEqual({
        visibility: {
          $type: 'LimitedVisibility',
          permittedUsers: [{ id: 'user-1' }],
          permittedGroups: [{ id: 'group-1' }],
        },
      })
    })

    test('comment reaction methods delegate to comment reaction endpoints', async () => {
      mockFetchResponse({
        id: 'reaction-1',
        reaction: 'thumbs_up',
        author: { id: 'user-1', login: 'alice', fullName: 'Alice Example', email: 'alice@example.com' },
      })

      const reaction = await provider.addCommentReaction?.('TEST-1', 'comment-1', 'thumbs_up')

      expect(reaction).toEqual({
        id: 'reaction-1',
        reaction: 'thumbs_up',
        author: { id: 'user-1', login: 'alice', name: 'Alice Example' },
        createdAt: undefined,
      })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1/comments/comment-1/reactions')
      expect(getFetchMethodAt(0)).toBe('POST')
      expect(getFetchBodyAt(0)).toEqual({ reaction: 'thumbs_up' })

      mockFetchNoContent()
      const removedReaction = await provider.removeCommentReaction?.('TEST-1', 'comment-1', 'reaction-1')

      expect(removedReaction).toEqual({ id: 'reaction-1', taskId: 'TEST-1', commentId: 'comment-1' })
      expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1/comments/comment-1/reactions/reaction-1')
      expect(getFetchMethodAt(0)).toBe('DELETE')
    })
  })

  describe('URL builders', () => {
    test('buildTaskUrl returns correct URL', () => {
      expect(provider.buildTaskUrl('TEST-1')).toBe('https://test.youtrack.cloud/issue/TEST-1')
    })

    test('buildProjectUrl returns correct URL', () => {
      expect(provider.buildProjectUrl('proj-1')).toBe('https://test.youtrack.cloud/projects/proj-1')
    })
  })

  describe('classifyError', () => {
    test('classifies 401 as auth-failed', () => {
      const error = new YouTrackApiError('Unauthorized', 401, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('auth-failed')
    })

    test('classifies 404 as task-not-found when message contains issue', () => {
      const error = new YouTrackApiError('YouTrack API GET /api/issues/TEST-1 returned 404', 404, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('task-not-found')
    })

    test('classifies 429 as rate-limited', () => {
      const error = new YouTrackApiError('Too many requests', 429, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('rate-limited')
    })

    test('classifies 400 as validation-failed', () => {
      const error = new YouTrackApiError('Bad request', 400, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('validation-failed')
    })

    test('classifies 500 as unexpected', () => {
      const error = new YouTrackApiError('Server error', 500, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('unexpected')
    })

    test('classifies non-YouTrackApiError as unexpected', () => {
      const error = new Error('Some internal processing error')
      const result = provider.classifyError(error)
      expect(result.code).toBe('unexpected')
    })
  })

  describe('updateRelation', () => {
    test('calls remove then add commands in sequence', async () => {
      // First fetch: get task with links to find relation
      mockFetchResponse({
        id: '2-5',
        idReadable: 'TEST-5',
        summary: 'Task with links',
        links: [
          {
            id: 'link-1',
            direction: 'OUTWARD',
            linkType: { id: 'lt-1', name: 'Depend', sourceToTarget: 'is required for' },
            issues: [{ id: '2-6', idReadable: 'TEST-6', summary: 'Related task' }],
          },
        ],
      })

      const testProvider = new YouTrackProvider(createConfig())
      const result = await testProvider.updateRelation('TEST-5', 'TEST-6', 'related')

      // Should return the result from add (which has the new type)
      expect(result.taskId).toBe('TEST-5')
      expect(result.relatedTaskId).toBe('TEST-6')
      expect(result.type).toBe('related')
    })

    test('throws when relation not found without calling add', async () => {
      // Task has no links matching the related task
      mockFetchResponse({
        id: '2-5',
        idReadable: 'TEST-5',
        summary: 'Task with no matching links',
        links: [],
      })

      const testProvider = new YouTrackProvider(createConfig())
      const promise = testProvider.updateRelation('TEST-5', 'NON-EXISTENT', 'related')

      await expect(promise).rejects.toThrow('Relation not found')
      // The fetch should only be called once (for the get task to find the link)
      expect(fetchMock?.mock.calls).toHaveLength(1)
    })
  })

  describe('listStatuses', () => {
    test('returns list of columns from state bundle', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }] } } },
        { data: [{ id: '57-1', name: 'Open', isResolved: false, ordinal: 0 }] },
      ])

      const statuses = await provider.listStatuses('proj-1')

      expect(statuses).toHaveLength(1)
      expect(statuses[0]!.id).toBe('57-1')
      expect(statuses[0]!.name).toBe('Open')
    })
  })

  describe('createStatus', () => {
    test('creates status and returns column', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }] } } },
        { data: { id: '57-2', name: 'Ready', isResolved: false, ordinal: 1 } },
      ])

      const result = await provider.createStatus('proj-1', { name: 'Ready' })

      assert(!('status' in result), 'Should not require confirmation')
      expect(result.id).toBe('57-2')
      expect(result.name).toBe('Ready')
    })

    test('returns confirmation_required for shared bundles without confirm', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } } },
      ])

      const result = await provider.createStatus('proj-1', { name: 'New' })

      expect(result).toMatchObject({ status: 'confirmation_required' })
      assert('message' in result)
      expect(result.message).toContain('shared')
    })
  })

  describe('updateStatus', () => {
    test('updates status and returns column', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }] } } },
        { data: { id: '57-1', name: 'Updated', isResolved: true, ordinal: 0 } },
      ])

      const result = await provider.updateStatus('proj-1', '57-1', { name: 'Updated', isFinal: true })

      assert(!('status' in result), 'Should not require confirmation')
      expect(result.id).toBe('57-1')
      expect(result.name).toBe('Updated')
    })

    test('returns confirmation_required for shared bundles without confirm', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } } },
      ])

      const result = await provider.updateStatus('proj-1', '57-1', { name: 'X' })

      expect(result).toMatchObject({ status: 'confirmation_required' })
      assert('message' in result)
      expect(result.message).toContain('shared')
    })
  })

  describe('deleteStatus', () => {
    test('deletes status and returns id', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }] } } },
        { data: {} },
      ])

      const result = await provider.deleteStatus('proj-1', '57-1')

      assert(!('status' in result), 'Should not require confirmation')
      expect(result).toEqual({ id: '57-1' })
    })

    test('returns confirmation_required for shared bundles without confirm', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } } },
      ])

      const result = await provider.deleteStatus('proj-1', '57-1')

      expect(result).toMatchObject({ status: 'confirmation_required' })
      assert('message' in result)
      expect(result.message).toContain('shared')
    })
  })

  describe('reorderStatuses', () => {
    test('reorders statuses', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }] } } },
        { data: { id: '57-1', name: 'Open', isResolved: false, ordinal: 0 } },
        { data: { id: '57-2', name: 'Done', isResolved: true, ordinal: 1 } },
      ])

      await provider.reorderStatuses('proj-1', [
        { id: '57-1', position: 0 },
        { id: '57-2', position: 1 },
      ])

      expect(fetchMock?.mock.calls).toHaveLength(4)
    })

    test('returns confirmation_required for shared bundles without confirm', async () => {
      mockFetchSequence([
        { data: [{ $type: 'StateProjectCustomField', field: { name: 'State' }, bundle: { id: 'bundle-1' } }] },
        { data: { id: 'bundle-1', aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } } },
      ])

      const result = await provider.reorderStatuses('proj-1', [{ id: '57-1', position: 0 }])

      expect(result).toBeDefined()
      expect(result).toMatchObject({ status: 'confirmation_required' })
      expect(JSON.stringify(result)).toContain('shared')
    })
  })

  describe('normalizeDueDateInput', () => {
    test('returns date-only, ignores time', () => {
      const result = provider.normalizeDueDateInput({ date: '2024-03-15', time: '14:30' }, 'America/New_York')
      expect(result).toBe('2024-03-15')
    })

    test('returns date-only when no time', () => {
      const result = provider.normalizeDueDateInput({ date: '2024-03-15' }, 'UTC')
      expect(result).toBe('2024-03-15')
    })

    test('returns undefined when no dueDate', () => {
      const result = provider.normalizeDueDateInput(undefined, 'UTC')
      expect(result).toBeUndefined()
    })
  })

  describe('formatDueDateOutput', () => {
    test('preserves date-only format', () => {
      const result = provider.formatDueDateOutput('2024-03-15', 'America/New_York')
      expect(result).toBe('2024-03-15')
    })

    test('returns null when null', () => {
      const result = provider.formatDueDateOutput(null, 'UTC')
      expect(result).toBeNull()
    })

    test('returns undefined when undefined', () => {
      const result = provider.formatDueDateOutput(undefined, 'UTC')
      expect(result).toBeUndefined()
    })

    test('returns non-date string as-is', () => {
      const result = provider.formatDueDateOutput('2024-03-15T18:30:00.000Z', 'UTC')
      expect(result).toBe('2024-03-15T18:30:00.000Z')
    })
  })
})
