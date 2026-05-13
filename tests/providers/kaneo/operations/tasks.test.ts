import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import type { KaneoConfig } from '../../../../src/providers/kaneo/client.js'
import { kaneoSearchTasks } from '../../../../src/providers/kaneo/operations/tasks.js'
import { createMockKaneoTaskSearchResponse } from '../../../utils/factories.js'
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
      Promise.resolve(new Response(JSON.stringify(createMockKaneoTaskSearchResponse()), { status: 200 })),
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
            results: [
              {
                id: 'task-1',
                type: 'task',
                title: 'Task 1',
                taskNumber: 1,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                userId: 'user-123',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
            ],
            totalCount: 1,
            searchQuery: 'test',
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
