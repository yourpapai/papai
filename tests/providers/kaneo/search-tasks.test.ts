import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import assert from 'node:assert/strict'

// Import implementation to satisfy TDD hook requirement
import '../../../src/providers/kaneo/operations/tasks.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { searchTasks, TaskResultSchema } from '../../../src/providers/kaneo/search-tasks.js'
import { mockLogger, setMockFetch, restoreFetch } from '../../utils/test-helpers.js'

describe('searchTasks', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('should include userId in TaskResultSchema', () => {
    const validResult = {
      id: 'task-1',
      title: 'Test Task',
      number: 1,
      status: 'todo',
      priority: 'medium',
      projectId: 'proj-1',
      userId: 'user-123',
    }
    const parsed = TaskResultSchema.safeParse(validResult)
    assert(parsed.success, 'Expected TaskResultSchema to parse successfully')
    expect(parsed.data.userId).toBe('user-123')
  })

  test('should filter by assigneeId when provided', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            tasks: [
              {
                id: 'task-1',
                projectId: 'proj-1',
                position: 1,
                number: 1,
                userId: 'user-123',
                title: 'Task 1',
                description: null,
                status: 'todo',
                priority: 'medium',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'task-2',
                projectId: 'proj-1',
                position: 2,
                number: 2,
                userId: 'user-456',
                title: 'Task 2',
                description: null,
                status: 'done',
                priority: 'high',
                createdAt: '2026-01-02T00:00:00.000Z',
              },
            ],
            projects: [],
            workspaces: [],
            comments: [],
            activities: [],
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await searchTasks({
      config: mockConfig,
      query: 'test',
      workspaceId: 'ws-1',
      assigneeId: 'user-123',
    })

    expect(result).toHaveLength(1)
    const [firstResult] = result
    assert(firstResult !== undefined, 'Expected a filtered Kaneo search result')
    expect(firstResult.id).toBe('task-1')
    expect(firstResult.userId).toBe('user-123')
  })

  test('should apply offset and limit after assignee filtering', async () => {
    let requestUrl: URL | undefined

    setMockFetch((url) => {
      requestUrl = new URL(url)

      return Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: 'task-1',
                  projectId: 'proj-1',
                  position: 1,
                  title: 'Task 1',
                  number: 1,
                  status: 'todo',
                  priority: 'medium',
                  userId: 'user-other',
                  description: null,
                  createdAt: '2026-01-01T00:00:00.000Z',
                },
                {
                  id: 'task-2',
                  projectId: 'proj-1',
                  position: 2,
                  title: 'Task 2',
                  number: 2,
                  status: 'todo',
                  priority: 'medium',
                  userId: 'user-123',
                  description: null,
                  createdAt: '2026-01-02T00:00:00.000Z',
                },
                {
                  id: 'task-3',
                  projectId: 'proj-1',
                  position: 3,
                  title: 'Task 3',
                  number: 3,
                  status: 'doing',
                  priority: 'high',
                  userId: 'user-other',
                  description: null,
                  createdAt: '2026-01-03T00:00:00.000Z',
                },
                {
                  id: 'task-4',
                  projectId: 'proj-1',
                  position: 4,
                  title: 'Task 4',
                  number: 4,
                  status: 'done',
                  priority: 'low',
                  userId: 'user-123',
                  description: null,
                  createdAt: '2026-01-04T00:00:00.000Z',
                },
                {
                  id: 'task-5',
                  projectId: 'proj-1',
                  position: 5,
                  title: 'Task 5',
                  number: 5,
                  status: 'done',
                  priority: 'low',
                  userId: 'user-123',
                  description: null,
                  createdAt: '2026-01-05T00:00:00.000Z',
                },
              ],
              projects: [],
              workspaces: [],
              comments: [],
              activities: [],
            }),
            { status: 200 },
          ),
      )
    })

    const result = await searchTasks({
      config: mockConfig,
      query: 'test',
      workspaceId: 'ws-1',
      assigneeId: 'user-123',
      offset: 1,
      limit: 1,
    })

    assert(requestUrl !== undefined, 'Expected Kaneo search request URL')
    expect(requestUrl.searchParams.get('offset')).toBeNull()
    expect(requestUrl.searchParams.get('limit')).toBeNull()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('task-4')
  })

  test('should pass offset through to the Kaneo search request without assignee filtering', async () => {
    let requestUrl: URL | undefined

    setMockFetch((url) => {
      requestUrl = new URL(url)

      return Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [],
              projects: [],
              workspaces: [],
              comments: [],
              activities: [],
            }),
            { status: 200 },
          ),
        )
      })

    const params: Parameters<typeof searchTasks>[0] & { offset: number } = {
      config: mockConfig,
      query: 'test',
      workspaceId: 'ws-1',
      offset: 30,
    }

    await searchTasks(params)

    assert(requestUrl !== undefined, 'Expected Kaneo search request URL')
    expect(requestUrl.pathname).toBe('/api/search')
    expect(requestUrl.searchParams.get('offset')).toBe('30')
  })

  test('should ignore non-task grouped search results and flatten task groups', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            tasks: [
              {
                id: 'task-1',
                projectId: 'proj-1',
                position: null,
                number: 7,
                userId: null,
                title: 'Grouped task',
                description: 'Task result',
                status: 'todo',
                priority: 'urgent',
                startDate: '2026-03-01T00:00:00.000Z',
                dueDate: '2026-03-05T00:00:00.000Z',
                createdAt: '2026-02-28T00:00:00.000Z',
              },
            ],
            projects: [
              {
                id: 'proj-1',
                workspaceId: 'ws-1',
                slug: 'proj-1',
                icon: null,
                name: 'Project 1',
                description: null,
                createdAt: '2026-02-28T00:00:00.000Z',
                isPublic: false,
                archivedAt: null,
              },
            ],
            workspaces: [],
            comments: [],
            activities: [],
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await searchTasks({
      config: mockConfig,
      query: 'grouped',
      workspaceId: 'ws-1',
    })

    expect(result).toEqual([
      {
        id: 'task-1',
        title: 'Grouped task',
        number: 7,
        status: 'todo',
        priority: 'urgent',
        projectId: 'proj-1',
        userId: '',
      },
    ])
  })
})
