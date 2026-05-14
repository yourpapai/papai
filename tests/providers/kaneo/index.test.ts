import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { KaneoProvider } from '../../../src/providers/kaneo/index.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('KaneoProvider', () => {
  const provider = new KaneoProvider(
    {
      apiKey: 'test-key',
      baseUrl: 'https://api.test.com',
    },
    'workspace-1',
  )

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('identity', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('kaneo')
    })
  })

  describe('listStatuses', () => {
    test('returns columns from project', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'col-1', name: 'Todo', icon: null, color: null, isFinal: false }]), {
            status: 200,
          }),
        ),
      )

      const result = await provider.listStatuses('proj-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Todo')
    })
  })

  describe('createStatus', () => {
    test('creates column and returns it', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'col-2', name: 'Done', icon: null, color: null, isFinal: true }), {
            status: 200,
          }),
        ),
      )

      const result = await provider.createStatus('proj-1', { name: 'Done', isFinal: true })

      assert(!('status' in result), 'Should not require confirmation')
      expect(result.name).toBe('Done')
    })
  })

  describe('updateStatus', () => {
    test('updates column and returns it', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'col-1', name: 'Updated', icon: null, color: null, isFinal: false }), {
            status: 200,
          }),
        ),
      )

      const result = await provider.updateStatus('proj-1', 'col-1', { name: 'Updated' })

      assert(!('status' in result), 'Should not require confirmation')
      expect(result.name).toBe('Updated')
    })
  })

  describe('deleteStatus', () => {
    test('deletes column and returns id', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))

      const result = await provider.deleteStatus('proj-1', 'col-1')

      assert(!('status' in result), 'Should not require confirmation')
      expect(result.id).toBe('col-1')
    })
  })

  describe('reorderStatuses', () => {
    test('reorders columns', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))

      await provider.reorderStatuses('proj-1', [{ id: 'col-1', position: 0 }])
    })
  })

  describe('normalizeDueDateInput', () => {
    test('converts date+time to UTC', () => {
      const result = provider.normalizeDueDateInput({ date: '2024-03-15', time: '14:30' }, 'America/New_York')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(result).toContain('Z')
    })

    test('converts date-only to UTC with midnight', () => {
      const result = provider.normalizeDueDateInput({ date: '2024-03-15' }, 'UTC')
      expect(result).toMatch(/^2024-03-15/)
    })

    test('returns undefined when no dueDate', () => {
      const result = provider.normalizeDueDateInput(undefined, 'UTC')
      expect(result).toBeUndefined()
    })
  })

  describe('searchTasks', () => {
    test('passes offset through the provider search contract', async () => {
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

      const params: Parameters<KaneoProvider['searchTasks']>[0] & { offset: number } = {
        query: 'bug',
        offset: 40,
      }

      await provider.searchTasks(params)

      assert(requestUrl !== undefined, 'Expected Kaneo provider search request URL')
      expect(requestUrl.pathname).toBe('/api/search')
      expect(requestUrl.searchParams.get('offset')).toBe('40')
    })

    test('returns flattened task results from the grouped search response', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: 'task-2',
                  projectId: 'proj-1',
                  position: null,
                  number: 2,
                  userId: null,
                  title: 'Search task',
                  description: null,
                  status: 'todo',
                  priority: 'medium',
                  createdAt: '2026-03-01T00:00:00.000Z',
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

      const result = await provider.searchTasks({ query: 'search' })

      expect(result).toEqual([
        {
          id: 'task-2',
          title: 'Search task',
          number: 2,
          status: 'todo',
          priority: 'medium',
          projectId: 'proj-1',
          url: 'https://api.test.com/dashboard/workspace/workspace-1/project/proj-1/task/task-2',
        },
      ])
    })
  })

  describe('createTask', () => {
    test('passes startDate through the provider create path', async () => {
      let requestBody: Record<string, unknown> | undefined
      let createdTask: Awaited<ReturnType<KaneoProvider['createTask']>> | undefined

      setMockFetch((url, options) => {
        if (url.includes('/column/')) {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'to-do', name: 'To Do', icon: null, color: null, isFinal: false }]), {
              status: 200,
            }),
          )
        }

        requestBody =
          typeof options.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : undefined

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              projectId: 'proj-1',
              position: 0,
              number: 1,
              userId: null,
              title: 'Test Task',
              description: '',
              status: 'to-do',
              priority: 'medium',
              startDate: '2026-03-01T00:00:00.000Z',
              dueDate: null,
              createdAt: '2026-03-01T00:00:00.000Z',
            }),
            { status: 200 },
          ),
        )
      })

      createdTask = await provider.createTask({
        projectId: 'proj-1',
        title: 'Test Task',
        startDate: '2026-03-01T00:00:00.000Z',
      })

      expect(requestBody?.['startDate']).toBe('2026-03-01T00:00:00.000Z')
      expect(createdTask.startDate).toBe('2026-03-01T00:00:00.000Z')
    })
  })

  describe('formatDueDateOutput', () => {
    test('converts UTC to local timezone', () => {
      const result = provider.formatDueDateOutput('2024-03-15T18:30:00.000Z', 'America/New_York')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    test('returns null when null', () => {
      const result = provider.formatDueDateOutput(null, 'UTC')
      expect(result).toBeNull()
    })

    test('returns undefined when undefined', () => {
      const result = provider.formatDueDateOutput(undefined, 'UTC')
      expect(result).toBeUndefined()
    })
  })

  describe('normalizeListTaskParams', () => {
    test('returns params unchanged', () => {
      const params = { assigneeId: 'user-1', limit: 10 }
      const result = provider.normalizeListTaskParams(params)
      expect(result).toEqual(params)
    })
  })
})
