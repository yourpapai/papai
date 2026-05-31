// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import type { KaneoConfig } from '../../../../plugins/task-provider-kaneo/client.js'
import { mapGlobalSearchTaskResults } from '../../../../plugins/task-provider-kaneo/mappers.js'
import { kaneoSearchTasks } from '../../../../plugins/task-provider-kaneo/operations/tasks.js'
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

  test('mapGlobalSearchTaskResults flattens grouped Kaneo search tasks into shared task search results', () => {
    const result = mapGlobalSearchTaskResults(
      {
        tasks: [
          {
            id: 'task-1',
            projectId: 'proj-1',
            position: null,
            number: 12,
            userId: null,
            title: 'Grouped task',
            description: null,
            status: 'todo',
            priority: 'high',
            startDate: null,
            dueDate: null,
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
      },
      () => 'https://api.test.com/workspace/ws-1/project/proj-1/task/task-1',
    )

    expect(result).toEqual([
      {
        id: 'task-1',
        title: 'Grouped task',
        number: 12,
        status: 'todo',
        priority: 'high',
        projectId: 'proj-1',
        url: 'https://api.test.com/workspace/ws-1/project/proj-1/task/task-1',
      },
    ])
  })
})
