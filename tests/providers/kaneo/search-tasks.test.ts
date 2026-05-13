import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import assert from 'node:assert/strict'

// Import implementation to satisfy TDD hook requirement
import '../../../src/providers/kaneo/operations/tasks.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { searchTasks, TaskResultSchema } from '../../../src/providers/kaneo/search-tasks.js'
import { createMockKaneoTaskSearchResponse } from '../../utils/factories.js'
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
      Promise.resolve(new Response(JSON.stringify(createMockKaneoTaskSearchResponse()), { status: 200 })),
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
            results: [
              {
                id: 'task-1',
                type: 'task',
                title: 'Task 1',
                taskNumber: 1,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                userId: 'user-other',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
              {
                id: 'task-2',
                type: 'task',
                title: 'Task 2',
                taskNumber: 2,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                userId: 'user-123',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
              {
                id: 'task-3',
                type: 'task',
                title: 'Task 3',
                taskNumber: 3,
                status: 'doing',
                priority: 'high',
                projectId: 'proj-1',
                userId: 'user-other',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
              {
                id: 'task-4',
                type: 'task',
                title: 'Task 4',
                taskNumber: 4,
                status: 'done',
                priority: 'low',
                projectId: 'proj-1',
                userId: 'user-123',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
              {
                id: 'task-5',
                type: 'task',
                title: 'Task 5',
                taskNumber: 5,
                status: 'done',
                priority: 'low',
                projectId: 'proj-1',
                userId: 'user-123',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
            ],
            totalCount: 5,
            searchQuery: 'test',
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
            results: [],
            totalCount: 0,
            searchQuery: 'test',
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
})
