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

function makeAddRelationFetchHandler(): (_url: string, options: RequestInit) => Promise<Response> {
  let callCount = 0
  return (_url: string, _options: RequestInit): Promise<Response> => {
    callCount += 1
    if (callCount === 1) {
      // First call: get related task
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'task-2',
            title: 'Related Task',
            description: '',
            number: 2,
            status: 'todo',
            priority: 'medium',
            projectId: 'proj-1',
            position: 0,
            userId: null,
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      )
    }
    if (callCount === 2) {
      // Second call: get source task
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'task-1',
            title: 'Task 1',
            description: '',
            number: 1,
            status: 'todo',
            priority: 'medium',
            projectId: 'proj-1',
            position: 0,
            userId: null,
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      )
    }
    // Third call: update description with relation
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'task-1',
          title: 'Task 1',
          description: '---\nblocks: task-2\n---',
          number: 1,
          status: 'todo',
          priority: 'medium',
          projectId: 'proj-1',
          position: 0,
          userId: null,
          createdAt: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    )
  }
}

function makeRemoveRelationFetchHandler(): (_url: string, options: RequestInit) => Promise<Response> {
  let callCount = 0
  return (_url: string, _options: RequestInit): Promise<Response> => {
    callCount += 1
    if (callCount === 1) {
      // First call: get task with relation
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'task-1',
            title: 'Task 1',
            description: '---\nblocks: task-2\n---',
            number: 1,
            status: 'todo',
            priority: 'medium',
            projectId: 'proj-1',
            position: 0,
            userId: null,
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      )
    }
    // Second call: update description without relation
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'task-1',
          title: 'Task 1',
          description: '',
          number: 1,
          status: 'todo',
          priority: 'medium',
          projectId: 'proj-1',
          position: 0,
          userId: null,
          createdAt: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    )
  }
}

function makeUpdateRelationFetchHandler(): (_url: string, options: RequestInit) => Promise<Response> {
  let callCount = 0
  return (_url: string, _options: RequestInit): Promise<Response> => {
    callCount += 1
    if (callCount === 1) {
      // First call: get task with existing relation
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'task-1',
            title: 'Task 1',
            description: '---\nblocks: task-2\n---',
            number: 1,
            status: 'todo',
            priority: 'medium',
            projectId: 'proj-1',
            position: 0,
            userId: null,
            createdAt: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      )
    }
    // Second call: update description with new relation type
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'task-1',
          title: 'Task 1',
          description: '---\nduplicate: task-2\n---',
          number: 1,
          status: 'todo',
          priority: 'medium',
          projectId: 'proj-1',
          position: 0,
          userId: null,
          createdAt: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    )
  }
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
                dueDate: '2026-03-15',
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
        dueDate: '2026-03-15',
        status: 'in-progress',
      })

      expect(requestBody).toMatchObject({
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15',
        status: 'in-progress',
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
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: 'Details',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.get('task-1')
      expect(result.id).toBe('task-1')
      expect(result.description).toBe('Details')
    })

    test('parses relations from description frontmatter', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: '---\nblocks: task-2\nrelated: task-3\n---\nTask details',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.get('task-1')
      expect(result.relations).toHaveLength(2)
      expect(result.relations[0]!.type).toBe('blocks')
      expect(result.relations[0]!.taskId).toBe('task-2')
    })

    test('handles task with empty description', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
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
      const requests = mockGetThenPut({ title: 'New Title', priority: 'high', description: 'New desc' })

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
              id: 'proj-1',
              name: 'Project 1',
              columns: [
                {
                  id: 'col-1',
                  name: 'Todo',
                  icon: null,
                  color: null,
                  isFinal: false,
                  tasks: [
                    { id: 'task-1', title: 'Task 1', number: 1, status: 'todo', priority: 'medium', dueDate: null },
                    {
                      id: 'task-2',
                      title: 'Task 2',
                      number: 2,
                      status: 'done',
                      priority: 'high',
                      dueDate: '2026-12-31',
                    },
                  ],
                },
              ],
              archivedTasks: [],
              plannedTasks: [],
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

    test('returns empty array when no tasks', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'empty-proj',
              name: 'Empty Project',
              columns: [],
              archivedTasks: [],
              plannedTasks: [],
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
      // API returns flat { results, totalCount, searchQuery } — not per-type arrays.
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/search/controllers/global-search.ts
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  id: 'task-1',
                  type: 'task',
                  title: 'Fix bug',
                  description: null,
                  projectId: 'proj-1',
                  taskNumber: 1,
                  status: 'todo',
                  priority: 'high',
                  relevanceScore: 3,
                  createdAt: '2026-01-01T00:00:00Z',
                },
                {
                  id: 'task-2',
                  type: 'task',
                  title: 'Bug report',
                  description: null,
                  projectId: 'proj-1',
                  taskNumber: 2,
                  status: 'done',
                  priority: 'medium',
                  relevanceScore: 2,
                  createdAt: '2026-01-02T00:00:00Z',
                },
              ],
              totalCount: 2,
              searchQuery: 'bug',
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
      expect(result).toHaveLength(2)
    })

    test('filters by projectId when provided', async () => {
      let requestUrl = ''
      setMockFetch((url: string) => {
        requestUrl = url
        return Promise.resolve(
          new Response(JSON.stringify({ results: [], totalCount: 0, searchQuery: 'test' }), { status: 200 }),
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
          new Response(JSON.stringify({ results: [], totalCount: 0, searchQuery: 'nonexistent' }), { status: 200 }),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({
        query: 'nonexistent',
        workspaceId: 'ws-1',
      })
      expect(result).toEqual([])
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
        Promise.resolve(new Response(JSON.stringify({ results: [], totalCount: 0, searchQuery: '' }), { status: 200 })),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.search({ query: '', workspaceId: 'ws-1' })
      expect(result).toEqual([])
    })
  })

  describe('addRelation', () => {
    test('adds relation between tasks', async () => {
      setMockFetch(makeAddRelationFetchHandler())

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.addRelation('task-1', 'task-2', 'blocks')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
    })
  })

  describe('removeRelation', () => {
    test('removes relation between tasks', async () => {
      setMockFetch(makeRemoveRelationFetchHandler())

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.removeRelation('task-1', 'task-2')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.success).toBe(true)
    })

    test('throws error when relation not found', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const promise = resource.removeRelation('task-1', 'task-2')
      await expect(promise).rejects.toThrow('not found')
    })
  })

  describe('updateRelation', () => {
    test('updates relation type', async () => {
      setMockFetch(makeUpdateRelationFetchHandler())

      const resource = new TaskResource(mockConfig, statusDeps)
      const result = await resource.updateRelation('task-1', 'task-2', 'duplicate')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('duplicate')
    })

    test('throws error when relation not found', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig, statusDeps)
      const promise = resource.updateRelation('task-1', 'task-2', 'related')
      await expect(promise).rejects.toThrow('not found')
    })
  })
})
