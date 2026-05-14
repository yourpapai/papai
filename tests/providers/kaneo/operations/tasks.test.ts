import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import type { KaneoConfig } from '../../../../src/providers/kaneo/client.js'
import { kaneoSearchTasks } from '../../../../src/providers/kaneo/operations/tasks.js'
import { mockLogger, setMockFetch, restoreFetch } from '../../../utils/test-helpers.js'

describe('kaneoSearchTasks', () => {
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

  test('should pass assigneeId parameter to search', async () => {
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

    const result = await kaneoSearchTasks(mockConfig, 'ws-1', {
      query: 'test',
      assigneeId: 'user-123',
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('task-1')
  })

  test('should work without assigneeId parameter', async () => {
    setMockFetch(() =>
      Promise.resolve(
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
                userId: 'user-123',
                description: null,
                createdAt: '2026-01-01T00:00:00.000Z',
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

    const result = await kaneoSearchTasks(mockConfig, 'ws-1', {
      query: 'test',
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('task-1')
  })
})
