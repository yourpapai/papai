// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Import implementation to satisfy TDD hook requirement
import '../../../src/providers/kaneo/task-resource.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import type { TaskStatusDeps } from '../../../src/providers/kaneo/task-status.js'
import { createMockColumn, createMockTask, mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { TaskResource } from './test-resources.js'

function parseRequestBody(options: RequestInit): unknown {
  return typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
}

function getRequestMethod(options: RequestInit): string {
  return options.method ?? 'GET'
}

function makeTaskRelationFetchHandler(
  requests: Array<{ url: string; method: string; body?: unknown }>,
  relationsResponse: unknown,
): (_url: string, options: RequestInit) => Promise<Response> {
  return (url: string, options: RequestInit): Promise<Response> => {
    requests.push({ url, method: getRequestMethod(options), body: parseRequestBody(options) })

    if (url.includes('/api/task-relation/task-1')) {
      return Promise.resolve(new Response(JSON.stringify(relationsResponse), { status: 200 }))
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'rel-1',
          sourceTaskId: 'task-1',
          targetTaskId: 'task-2',
          relationType: 'blocks',
          createdAt: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    )
  }
}

function createTaskDetailsFetchHandler(
  taskPayload: unknown,
  relationsResponse: unknown,
): (url: string) => Promise<Response> {
  return (url) =>
    Promise.resolve(
      new Response(JSON.stringify(url.includes('/api/task-relation/task-1') ? relationsResponse : taskPayload), {
        status: 200,
      }),
    )
}

describe('TaskResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  let statusDeps: TaskStatusDeps

  beforeEach(() => {
    mockLogger()

    statusDeps = {
      listColumns: (): Promise<Array<{ id: string; name: string }>> =>
        Promise.resolve([
          createMockColumn({ id: 'col-1', name: 'To Do' }),
          createMockColumn({ id: 'col-2', name: 'In Progress' }),
          createMockColumn({ id: 'col-3', name: 'Done', isFinal: true }),
        ]),
    }
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('create', () => {
    test('creates task with required fields', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test Task',
                number: 42,
                priority: 'no-priority',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test Task',
      })

      expect(result.id).toBe('task-1')
      expect(result.number).toBe(42)
    })

    test('includes optional fields in request', async () => {
      let requestBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = parseRequestBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'high',
                description: 'Description',
                dueDate: '2026-03-15T00:00:00.000Z',
                userId: 'user-1',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15T00:00:00.000Z',
        status: 'in-progress',
      })

      expect(requestBody).toMatchObject({
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15T00:00:00.000Z',
        status: 'in-progress',
      })
    })

    test('includes startDate in create requests', async () => {
      let requestBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = parseRequestBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'high',
                description: 'Description',
              }),
              startDate: '2026-03-01T00:00:00.000Z',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        description: 'Description',
        priority: 'high',
        startDate: '2026-03-01T00:00:00.000Z',
      })

      expect(requestBody).toMatchObject({
        startDate: '2026-03-01T00:00:00.000Z',
      })
    })

    test('applies default priority when not provided', async () => {
      let requestBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = parseRequestBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'no-priority',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ priority: 'no-priority' })
    })

    test('applies default status when not provided', async () => {
      let requestBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = parseRequestBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'no-priority',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ status: 'to-do' })
    })

    test('accepts priority low', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'low',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'low',
      })

      expect(result.priority).toBe('low')
    })

    test('accepts priority high', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'high',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'high',
      })

      expect(result.priority).toBe('high')
    })

    test('accepts priority urgent', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'urgent',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'urgent',
      })

      expect(result.priority).toBe('urgent')
    })
  })

  describe('get', () => {
    test('fetches task with details', async () => {
      setMockFetch(
        createTaskDetailsFetchHandler(
          {
            ...createMockTask({
              id: 'task-1',
              title: 'Test',
              number: 1,
              description: 'Details',
            }),
            startDate: '2026-03-01T00:00:00.000Z',
          },
          [],
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.get('task-1')
      expect(result.id).toBe('task-1')
      expect(result.description).toBe('Details')
      expect(result.startDate).toBe('2026-03-01T00:00:00.000Z')
    })

    test('rejects non-date-time timestamps in task responses', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ...createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: 'Details',
              }),
              startDate: '2026-03-01',
              dueDate: '2026-03-15',
              createdAt: '2026-03-01',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      await expect(resource.get('task-1')).rejects.toThrow()
    })

    test('reads first-class task relations from /task-relation/{taskId}', async () => {
      setMockFetch(
        createTaskDetailsFetchHandler(
          createMockTask({ id: 'task-1', title: 'Test', number: 1, description: 'Task details' }),
          [
            {
              id: 'rel-1',
              sourceTaskId: 'task-1',
              targetTaskId: 'task-2',
              relationType: 'blocks',
              createdAt: '2026-05-14T09:00:00.000Z',
            },
            {
              id: 'rel-2',
              sourceTaskId: 'task-3',
              targetTaskId: 'task-1',
              relationType: 'subtask',
              createdAt: '2026-05-14T09:00:00.000Z',
            },
          ],
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.get('task-1')
      expect(result.relations).toHaveLength(2)
      expect(result.relations[0]!.type).toBe('blocks')
      expect(result.relations[0]!.taskId).toBe('task-2')
      expect(result.relations[1]!.type).toBe('child')
      expect(result.relations[1]!.taskId).toBe('task-3')
    })

    test('handles task with empty description', async () => {
      setMockFetch(
        createTaskDetailsFetchHandler(createMockTask({ id: 'task-1', title: 'Test', number: 1, description: '' }), []),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.get('task-1')
      expect(result.relations).toEqual([])
    })
  })

  describe('update', () => {
    function mockGetThenPut(responseOverrides: Parameters<typeof createMockTask>[0] = {}): Array<{
      url: string
      method: string
      body?: unknown
    }> {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch((url: string, options: RequestInit) => {
        const parsedBody: unknown = typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
        requests.push({ url, method: options.method ?? 'GET', body: parsedBody })
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                projectId: 'proj-1',
                position: 3,
                number: 1,
                title: 'Test',
                description: '',
                status: 'col-1',
                priority: 'no-priority',
                ...responseOverrides,
              }),
            ),
            { status: 200 },
          ),
        )
      })
      return requests
    }

    test('PUTs full merged body to /task/:id (single field)', async () => {
      const requests = mockGetThenPut({ status: 'done' })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.update('task-1', { status: 'done' })

      expect(requests).toHaveLength(2)
      expect(requests[0]?.method).toBe('GET')
      expect(requests[0]?.url).toContain('/task/task-1')
      expect(requests[1]?.method).toBe('PUT')
      expect(requests[1]?.url).toContain('/task/task-1')
      expect(requests[1]?.body).toMatchObject({
        title: 'Test',
        description: '',
        status: 'done',
        priority: 'no-priority',
        projectId: 'proj-1',
        position: 3,
      })
    })

    test('PUTs full merged body to /task/:id (multiple fields)', async () => {
      const requests = mockGetThenPut({
        title: 'New Title',
        priority: 'high',
        description: 'New desc',
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.update('task-1', {
        title: 'New Title',
        priority: 'high',
        description: 'New desc',
      })

      expect(requests).toHaveLength(2)
      expect(requests[0]?.method).toBe('GET')
      expect(requests[1]?.method).toBe('PUT')
      expect(requests[1]?.body).toMatchObject({
        title: 'New Title',
        description: 'New desc',
        priority: 'high',
        projectId: 'proj-1',
        position: 3,
      })
    })

    test('preserves unchanged fields from the existing task', async () => {
      const requests = mockGetThenPut({
        title: 'Existing',
        description: 'Existing desc',
        priority: 'medium',
        status: 'col-2',
        startDate: '2026-02-01T00:00:00.000Z',
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.update('task-1', { title: 'Only title changed' })

      expect(requests[1]?.body).toMatchObject({
        title: 'Only title changed',
        description: 'Existing desc',
        priority: 'medium',
        status: 'col-2',
        projectId: 'proj-1',
        position: 3,
        startDate: '2026-02-01T00:00:00.000Z',
      })
    })

    test('allows overriding startDate in the full PUT body', async () => {
      const requests = mockGetThenPut({
        startDate: '2026-02-01T00:00:00.000Z',
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.update('task-1', { startDate: '2026-04-01T00:00:00.000Z' })

      expect(requests[1]?.body).toMatchObject({
        title: 'Test',
        description: '',
        status: 'col-1',
        priority: 'no-priority',
        projectId: 'proj-1',
        position: 3,
        startDate: '2026-04-01T00:00:00.000Z',
      })
    })
  })

  describe('delete', () => {
    test('deletes task successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.delete('task-1')
      expect(result.id).toBe('task-1')
      expect(result.success).toBe(true)
    })
  })

  describe('list', () => {
    test('lists tasks for project', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: 'proj-1',
                name: 'Project 1',
                slug: 'project-1',
                icon: '',
                description: null,
                isPublic: false,
                workspaceId: 'ws-1',
                columns: [
                  {
                    id: 'col-1',
                    slug: 'to-do',
                    name: 'Todo',
                    icon: null,
                    color: null,
                    isFinal: false,
                    tasks: [
                      {
                        id: 'task-1',
                        title: 'Task 1',
                        number: 1,
                        status: 'col-1',
                        priority: 'medium',
                        dueDate: null,
                        position: 1,
                        createdAt: '2026-03-01T00:00:00.000Z',
                        userId: null,
                        projectId: 'proj-1',
                        labels: [],
                        externalLinks: [],
                      },
                      {
                        id: 'task-2',
                        title: 'Task 2',
                        number: 2,
                        status: 'col-1',
                        priority: 'high',
                        dueDate: '2026-12-31T00:00:00.000Z',
                        position: 2,
                        createdAt: '2026-03-01T00:00:00.000Z',
                        userId: null,
                        projectId: 'proj-1',
                        labels: [],
                        externalLinks: [],
                      },
                    ],
                  },
                ],
                archivedTasks: [],
                plannedTasks: [],
              },
              pagination: {
                total: 2,
                page: 1,
                pageSize: 50,
                totalPages: 1,
              },
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.list('proj-1')
      expect(result).toHaveLength(2)
      expect(result[0]!.title).toBe('Task 1')
    })

    test('reads runtime-compatible task list envelopes', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: 'proj-1',
                name: 'Project 1',
                slug: 'project-1',
                icon: '',
                description: null,
                isPublic: false,
                workspaceId: 'ws-1',
                columns: [
                  {
                    id: 'to-do',
                    slug: 'to-do',
                    name: 'To Do',
                    isFinal: false,
                    tasks: [
                      {
                        id: 'task-1',
                        title: 'Task 1',
                        number: 1,
                        status: 'to-do',
                        priority: 'medium',
                        dueDate: null,
                        position: 1,
                        createdAt: '2026-03-01T00:00:00Z',
                        userId: null,
                        assigneeId: null,
                        assigneeName: null,
                        assigneeImage: null,
                        projectId: 'proj-1',
                        labels: [],
                        externalLinks: [],
                      },
                    ],
                  },
                ],
                archivedTasks: [],
                plannedTasks: [],
              },
              pagination: {
                total: 1,
                page: 1,
                pageSize: 1,
                totalPages: 1,
              },
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.list('proj-1')

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'task-1',
        title: 'Task 1',
        status: 'to-do',
      })
    })

    test('rejects invalid list task priority values', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: 'proj-1',
                name: 'Project 1',
                columns: [
                  {
                    id: 'to-do',
                    name: 'To Do',
                    isFinal: false,
                    tasks: [
                      {
                        id: 'task-1',
                        title: 'Task 1',
                        number: 1,
                        status: 'to-do',
                        priority: 'critical',
                        dueDate: null,
                        createdAt: '2026-03-01T00:00:00Z',
                      },
                    ],
                  },
                ],
                archivedTasks: [],
                plannedTasks: [],
              },
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      await expect(resource.list('proj-1')).rejects.toThrow()
    })

    test('rejects top-level grouped task lists', async () => {
      // Deliberate drift-log choice: papai follows the real runtime envelope here.
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Project 1',
              columns: [],
              archivedTasks: [],
              plannedTasks: [],
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      await expect(resource.list('proj-1')).rejects.toThrow()
    })

    test('returns empty array when no tasks', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: 'empty-proj',
                name: 'Empty Project',
                columns: [],
                archivedTasks: [],
                plannedTasks: [],
              },
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.list('empty-proj')
      expect(result).toHaveLength(0)
    })
  })

  describe('search', () => {
    test('searches tasks by keyword', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: 'task-1',
                  projectId: 'proj-1',
                  position: 1,
                  userId: null,
                  title: 'Fix bug',
                  number: 1,
                  description: null,
                  status: 'todo',
                  priority: 'high',
                  createdAt: '2026-01-01T00:00:00Z',
                },
                {
                  id: 'task-2',
                  projectId: 'proj-1',
                  position: 2,
                  userId: null,
                  title: 'Bug report',
                  number: 2,
                  description: null,
                  status: 'done',
                  priority: 'medium',
                  createdAt: '2026-01-02T00:00:00Z',
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

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({
        query: 'bug',
        workspaceId: 'ws-1',
      })
      expect(result.tasks).toHaveLength(2)
    })

    test('filters by projectId when provided', async () => {
      let requestUrl = ''
      setMockFetch((url: string) => {
        requestUrl = url
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [],
              projects: [],
              workspaces: [],
              comments: [],
              activities: [],
            }),
            {
              status: 200,
            },
          ),
        )
      })

      const resource = new TaskResource(mockConfig, statusDeps)
      await resource.search({
        query: 'test',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
      })

      expect(requestUrl).toContain('projectId=proj-1')
    })

    test('returns empty array when no matches', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [],
              projects: [],
              workspaces: [],
              comments: [],
              activities: [],
            }),
            {
              status: 200,
            },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({
        query: 'nonexistent',
        workspaceId: 'ws-1',
      })
      expect(result.tasks).toEqual([])
    })

    test('returns grouped task results and ignores non-task groups at this layer', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: 'task-9',
                  projectId: 'proj-1',
                  position: null,
                  number: 9,
                  userId: null,
                  title: 'Grouped result',
                  description: null,
                  status: 'done',
                  priority: 'low',
                  createdAt: '2026-01-09T00:00:00Z',
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
                  createdAt: '2026-01-01T00:00:00Z',
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

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({ query: 'grouped', workspaceId: 'ws-1' })

      expect(result.tasks).toEqual([
        {
          id: 'task-9',
          projectId: 'proj-1',
          position: null,
          number: 9,
          userId: null,
          title: 'Grouped result',
          description: null,
          status: 'done',
          priority: 'low',
          createdAt: '2026-01-09T00:00:00Z',
        },
      ])
      expect(result.projects).toHaveLength(1)
    })

    test('accepts live Kaneo runtime search envelope with results array', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  id: 'task-live-1',
                  type: 'task',
                  title: 'Live result',
                  projectId: 'proj-1',
                  projectName: 'Project 1',
                  projectSlug: 'project-1',
                  workspaceId: 'ws-1',
                  workspaceName: 'Workspace 1',
                  createdAt: '2026-01-09T00:00:00.000Z',
                  relevanceScore: 3,
                  taskNumber: 9,
                  priority: 'low',
                  status: 'done',
                },
              ],
              totalCount: 1,
              searchQuery: 'live',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({ query: 'live', workspaceId: 'ws-1' })

      expect(result.tasks).toEqual([
        {
          id: 'task-live-1',
          projectId: 'proj-1',
          position: null,
          number: 9,
          userId: null,
          title: 'Live result',
          description: null,
          status: 'done',
          priority: 'low',
          createdAt: '2026-01-09T00:00:00.000Z',
        },
      ])
      expect(result.projects).toEqual([])
      expect(result.workspaces).toEqual([])
      expect(result.comments).toEqual([])
      expect(result.activities).toEqual([])
    })
  })

  describe('get - error paths', () => {
    test('throws for 404 (task not found)', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })))

      const resource = new TaskResource(mockConfig, statusDeps)
      const promise = resource.get('nonexistent-id')
      await expect(promise).rejects.toThrow()
    })

    test('throws when projectId does not exist on create', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

      const resource = new TaskResource(mockConfig, statusDeps)
      const promise = resource.create({ projectId: 'invalid', title: 'Test' })
      await expect(promise).rejects.toThrow()
    })

    test('search returns empty results for empty query string', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [],
              projects: [],
              workspaces: [],
              comments: [],
              activities: [],
            }),
            {
              status: 200,
            },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({ query: '', workspaceId: 'ws-1' })
      expect(result.tasks).toEqual([])
    })
  })

  describe('addRelation', () => {
    test('adds relation between tasks', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch(makeTaskRelationFetchHandler(requests, []))

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.addRelation('task-1', 'task-2', 'blocks')

      expect(requests[0]).toMatchObject({
        url: 'https://api.test.com/api/task-relation',
        method: 'POST',
        body: { sourceTaskId: 'task-1', targetTaskId: 'task-2', relationType: 'blocks' },
      })
      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
    })
  })

  describe('removeRelation', () => {
    test('removes relation between tasks', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch(
        makeTaskRelationFetchHandler(requests, [
          {
            id: 'rel-1',
            sourceTaskId: 'task-1',
            targetTaskId: 'task-2',
            relationType: 'blocks',
            createdAt: '2026-05-14T09:00:00.000Z',
          },
        ]),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.removeRelation('task-1', 'task-2')

      expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE'])
      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.success).toBe(true)
    })

    test('throws error when relation not found', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch(makeTaskRelationFetchHandler(requests, []))

      const resource = new TaskResource(mockConfig, statusDeps)
      const promise = resource.removeRelation('task-1', 'task-2')
      await expect(promise).rejects.toThrow('not found')
    })
  })

  describe('updateRelation', () => {
    test('updates relation type', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch(
        makeTaskRelationFetchHandler(requests, [
          {
            id: 'rel-1',
            sourceTaskId: 'task-1',
            targetTaskId: 'task-2',
            relationType: 'related',
            createdAt: '2026-05-14T09:00:00.000Z',
          },
        ]),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.updateRelation('task-1', 'task-2', 'blocks')

      expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE', 'POST'])
      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
    })

    test('throws error when relation not found', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch(makeTaskRelationFetchHandler(requests, []))

      const resource = new TaskResource(mockConfig, statusDeps)
      const promise = resource.updateRelation('task-1', 'task-2', 'related')
      await expect(promise).rejects.toThrow('not found')
    })
  })
})
