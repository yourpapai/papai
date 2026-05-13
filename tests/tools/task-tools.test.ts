import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { setCachedConfig, _userCaches } from '../../src/cache.js'
import { makeCreateTaskTool } from '../../src/tools/create-task.js'
import { makeDeleteTaskTool } from '../../src/tools/delete-task.js'
import { makeGetTaskTool } from '../../src/tools/get-task.js'
import { makeListTasksTool } from '../../src/tools/list-tasks.js'
import { makeSearchTasksTool } from '../../src/tools/search-tasks.js'
import { makeUpdateTaskTool } from '../../src/tools/update-task.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider, createMockYouTrackProvider } from './mock-provider.js'

function isTask(val: unknown): val is { id: string; title: string; status: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'title' in val &&
    typeof val.title === 'string' &&
    'status' in val &&
    typeof val.status === 'string'
  )
}

function isTaskWithRelations(
  val: unknown,
): val is { id: string; title: string; relations: Array<{ type: string; taskId: string }> } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'title' in val &&
    typeof val.title === 'string' &&
    'relations' in val &&
    Array.isArray(val.relations)
  )
}

function isTaskArray(val: unknown): val is Array<{ title: string }> {
  return Array.isArray(val) && val.every((item) => item !== null && typeof item === 'object' && 'title' in item)
}

function resolveStatus(status: string | undefined): string {
  return status ?? 'todo'
}

function resolveTitle(title: string | undefined): string {
  return title ?? 'Test'
}

function getInputFieldDescription(schema: unknown, fieldName: string): string | undefined {
  if (!(schema instanceof z.ZodType)) return undefined
  const jsonSchema = z.toJSONSchema(schema)
  if (!('properties' in jsonSchema) || jsonSchema.properties === undefined) return undefined
  const property = jsonSchema.properties[fieldName]
  if (property === undefined || typeof property !== 'object' || property === null) return undefined
  return 'description' in property && typeof property.description === 'string' ? property.description : undefined
}

describe('Task Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
    // Pre-populate timezone in cache so getConfig() doesn't hit DB
    setCachedConfig('user-1', 'timezone', 'Asia/Karachi')
  })

  afterAll(() => {
    _userCaches.delete('user-1')
  })

  describe('makeCreateTaskTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeCreateTaskTool(provider)
      expect(tool.description).toContain('Create a new task')
    })

    test('creates task with required title', async () => {
      const provider = createMockProvider({
        createTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            status: 'todo',
            url: 'https://test.com/task/1',
          }),
        ),
      })

      const tool = makeCreateTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { title: 'Test Task', projectId: 'proj-1' },
        { toolCallId: '1', messages: [] },
      )
      assert(isTask(result))

      expect(result.id).toBe('task-1')
      expect(result.title).toBe('Test Task')
      expect(result.status).toBe('todo')
    })

    test('includes optional fields in request', async () => {
      const createTask = mock(
        (params: {
          projectId: string
          title: string
          description?: string
          priority?: string
          status?: string
          dueDate?: string
        }) =>
          Promise.resolve({
            id: 'task-1',
            title: params.title,
            status: resolveStatus(params.status),
            url: 'https://test.com/task/1',
          }),
      )
      const provider = createMockProvider({ createTask })

      const tool = makeCreateTaskTool(provider, 'user-1')
      assert(tool.execute)
      await tool.execute(
        {
          title: 'Test Task',
          description: 'Task description',
          priority: 'high',
          dueDate: { date: '2026-03-15' },
          status: 'in-progress',
        },
        { toolCallId: '1', messages: [] },
      )

      expect(createTask).toHaveBeenCalledTimes(1)
      const call = createTask.mock.calls[0]
      assert(call)
      const params = call[0] as Record<string, unknown>
      expect(params['title']).toBe('Test Task')
      expect(params['description']).toBe('Task description')
      expect(params['priority']).toBe('high')
      // dueDate { date: '2026-03-15' } in Asia/Karachi → midnight local = 19:00 UTC previous day
      expect(params['dueDate']).toBe('2026-03-14T19:00:00.000Z')
      expect(params['status']).toBe('in-progress')
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        createTask: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeCreateTaskTool(provider)
      const promise = getToolExecutor(tool)({ title: 'Test', projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates required title parameter', () => {
      const provider = createMockProvider()
      const tool = makeCreateTaskTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })

    test('converts structured dueDate from local time to UTC before calling provider', async () => {
      let capturedDueDate: string | undefined
      const provider = createMockProvider({
        createTask: mock((input: { dueDate?: string; title: string }) => {
          capturedDueDate = input.dueDate
          return Promise.resolve({ id: 'task-1', title: input.title, status: 'todo', url: '' })
        }),
      })

      const tool = makeCreateTaskTool(provider, 'user-1')
      assert(tool.execute)
      await tool.execute(
        { title: 'Test', projectId: 'p1', dueDate: { date: '2026-03-25', time: '17:00' } },
        { toolCallId: '1', messages: [] },
      )

      // 17:00 Karachi (UTC+5) = 12:00 UTC
      expect(capturedDueDate).toBe('2026-03-25T12:00:00.000Z')
    })

    test('omits dueDate when not provided', async () => {
      let capturedDueDate: string | undefined = 'sentinel'
      const provider = createMockProvider({
        createTask: mock((input: { dueDate?: string; title: string }) => {
          capturedDueDate = input.dueDate
          return Promise.resolve({ id: 'task-1', title: input.title, status: 'todo', url: '' })
        }),
      })

      const tool = makeCreateTaskTool(provider, 'user-1')
      assert(tool.execute)
      await tool.execute({ title: 'No date', projectId: 'p1' }, { toolCallId: '1', messages: [] })

      expect(capturedDueDate).toBeUndefined()
    })

    test('preserves date-only dueDate for YouTrack provider', async () => {
      let capturedDueDate: string | undefined
      const provider = createMockYouTrackProvider({
        createTask: mock((input: Readonly<{ dueDate?: string; title: string }>) => {
          capturedDueDate = input.dueDate
          return Promise.resolve({ id: 'task-1', title: input.title, status: 'todo', url: '', dueDate: '2026-03-25' })
        }),
      })

      const tool = makeCreateTaskTool(provider, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { title: 'Test', projectId: 'p1', dueDate: { date: '2026-03-25' } },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedDueDate).toBe('2026-03-25')
      expect(result).toHaveProperty('dueDate', '2026-03-25')
    })

    test('describes YouTrack due dates as date-only', () => {
      const provider = createMockYouTrackProvider()
      const tool = makeCreateTaskTool(provider, 'user-1')
      const dueDateDescription = getInputFieldDescription(tool.inputSchema, 'dueDate')
      const customFieldsDescription = getInputFieldDescription(tool.inputSchema, 'customFields')

      expect(tool.description).toContain('Create a new task')
      expect(dueDateDescription).toContain('For YouTrack, due dates are date-only and time-of-day is ignored')
      expect(customFieldsDescription).toContain('simple string/text project fields required by YouTrack workflows')
      expect(customFieldsDescription).toContain('not arbitrary field types')
    })

    test('ignores time-of-day for YouTrack dueDate inputs', async () => {
      let capturedDueDate: string | undefined
      const provider = createMockYouTrackProvider({
        createTask: mock((input: Readonly<{ dueDate?: string; title: string }>) => {
          capturedDueDate = input.dueDate
          return Promise.resolve({ id: 'task-1', title: input.title, status: 'todo', url: '', dueDate: '2026-03-25' })
        }),
      })

      const tool = makeCreateTaskTool(provider, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { title: 'Test', projectId: 'p1', dueDate: { date: '2026-03-25', time: '23:45' } },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedDueDate).toBe('2026-03-25')
      expect(result).toHaveProperty('dueDate', '2026-03-25')
    })

    test('returns dueDate converted back to user local time (UTC→local)', async () => {
      const provider = createMockProvider({
        createTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test',
            status: 'todo',
            url: '',
            dueDate: '2026-03-25T12:00:00.000Z',
          }),
        ),
      })

      const tool = makeCreateTaskTool(provider, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { title: 'Test', projectId: 'p1', dueDate: { date: '2026-03-25', time: '17:00' } },
        { toolCallId: '1', messages: [] },
      )

      // Provider echoed back UTC; tool should convert to Asia/Karachi local time (UTC+5)
      expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
    })
  })

  describe('makeUpdateTaskTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateTaskTool(provider)
      expect(tool.description).toContain("Update an existing task's status")
    })

    test('updates task with single field', async () => {
      const provider = createMockProvider({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Updated Task',
            status: 'done',
            url: 'https://test.com/task/1',
          }),
        ),
      })

      const tool = makeUpdateTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', status: 'done' },
        { toolCallId: '1', messages: [] },
      )
      assert(isTask(result))

      expect(result.id).toBe('task-1')
      expect(result.status).toBe('done')
    })

    test('updates task with multiple fields', async () => {
      const updateTask = mock(
        (
          _taskId: string,
          params: {
            title?: string
            priority?: string
            dueDate?: string
            status?: string
          },
        ) =>
          Promise.resolve({
            id: 'task-1',
            title: resolveTitle(params.title),
            status: resolveStatus(params.status),
            url: 'https://test.com/task/1',
          }),
      )
      const provider = createMockProvider({ updateTask })

      const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
      assert(tool.execute)
      await tool.execute(
        { taskId: 'task-1', title: 'New Title', priority: 'high', dueDate: { date: '2026-12-31' } },
        { toolCallId: '1', messages: [] },
      )

      expect(updateTask).toHaveBeenCalledTimes(1)
      const call = updateTask.mock.calls[0]
      assert(call)
      expect(call[0]).toBe('task-1')
      const params = call[1] as Record<string, unknown>
      expect(params['title']).toBe('New Title')
      expect(params['priority']).toBe('high')
      // dueDate { date: '2026-12-31' } in Asia/Karachi → midnight local = 19:00 UTC previous day
      expect(params['dueDate']).toBe('2026-12-30T19:00:00.000Z')
    })

    test('preserves date-only dueDate for YouTrack update', async () => {
      let capturedDueDate: string | undefined
      const provider = createMockYouTrackProvider({
        updateTask: mock((_id: string, updates: Readonly<{ dueDate?: string }>) => {
          capturedDueDate = updates.dueDate
          return Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: '', dueDate: '2026-03-25' })
        }),
      })

      const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', dueDate: { date: '2026-03-25' } },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedDueDate).toBe('2026-03-25')
      expect(result).toHaveProperty('dueDate', '2026-03-25')
    })

    test('describes YouTrack update due dates as date-only', () => {
      const provider = createMockYouTrackProvider()
      const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
      const dueDateDescription = getInputFieldDescription(tool.inputSchema, 'dueDate')

      expect(tool.description).toContain('Update an existing task')
      expect(dueDateDescription).toContain('For YouTrack, due dates are date-only and time-of-day is ignored')
    })

    test('ignores time-of-day for YouTrack update dueDate inputs', async () => {
      let capturedDueDate: string | undefined
      const provider = createMockYouTrackProvider({
        updateTask: mock((_id: string, updates: Readonly<{ dueDate?: string }>) => {
          capturedDueDate = updates.dueDate
          return Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: '', dueDate: '2026-03-25' })
        }),
      })

      const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', dueDate: { date: '2026-03-25', time: '23:45' } },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedDueDate).toBe('2026-03-25')
      expect(result).toHaveProperty('dueDate', '2026-03-25')
    })

    test('propagates API errors including 404', async () => {
      const provider = createMockProvider({
        updateTask: mock(() => {
          const error = Object.assign(new Error('Task not found'), { code: 'task-not-found' })
          return Promise.reject(error)
        }),
      })

      const tool = makeUpdateTaskTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'invalid', status: 'done' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateTaskTool(provider)
      expect(schemaValidates(tool, { status: 'done' })).toBe(false)
    })

    test('completionHook is called with correct args on status change', async () => {
      const provider = createMockProvider({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test',
            status: 'done',
            url: 'https://test.com/task/1',
          }),
        ),
      })
      const hookSpy = mock(() => Promise.resolve())

      const tool = makeUpdateTaskTool(provider, hookSpy)
      assert(tool.execute)
      await tool.execute({ taskId: 'task-1', status: 'done' }, { toolCallId: '1', messages: [] })

      expect(hookSpy).toHaveBeenCalledTimes(1)
      expect(hookSpy).toHaveBeenCalledWith('task-1', 'done', provider)
    })

    test('completionHook error propagates to caller', async () => {
      const provider = createMockProvider({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test',
            status: 'done',
            url: 'https://test.com/task/1',
          }),
        ),
      })
      const hookSpy = mock(() => Promise.reject(new Error('hook error')))

      const tool = makeUpdateTaskTool(provider, hookSpy)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', status: 'done' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('hook error')
    })

    test('completionHook fires even when only title is changed (status always on response)', async () => {
      const provider = createMockProvider({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'New Title',
            status: 'todo',
            url: 'https://test.com/task/1',
          }),
        ),
      })
      const hookSpy = mock(() => Promise.resolve())

      const tool = makeUpdateTaskTool(provider, hookSpy)
      assert(tool.execute)
      // Only changing title, not status — but task.status is always defined on the response
      await tool.execute({ taskId: 'task-1', title: 'New Title' }, { toolCallId: '1', messages: [] })

      expect(hookSpy).toHaveBeenCalledTimes(1)
      expect(hookSpy).toHaveBeenCalledWith('task-1', 'todo', provider)
    })

    test('no error when completionHook is not provided', async () => {
      const provider = createMockProvider({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test',
            status: 'done',
            url: 'https://test.com/task/1',
          }),
        ),
      })

      const tool = makeUpdateTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', status: 'done' },
        { toolCallId: '1', messages: [] },
      )
      assert(isTask(result))
      expect(result.status).toBe('done')
    })

    test('converts structured dueDate to UTC when updating task', async () => {
      let capturedDueDate: string | undefined
      const provider = createMockProvider({
        updateTask: mock((_id: string, updates: { dueDate?: string }) => {
          capturedDueDate = updates.dueDate
          return Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: '' })
        }),
      })

      const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
      assert(tool.execute)
      await tool.execute(
        { taskId: 'task-1', dueDate: { date: '2026-03-25', time: '17:00' } },
        { toolCallId: '1', messages: [] },
      )

      // 17:00 Karachi (UTC+5) = 12:00 UTC
      expect(capturedDueDate).toBe('2026-03-25T12:00:00.000Z')
    })

    test('returns dueDate converted back to user local time (UTC→local) on update', async () => {
      const provider = createMockProvider({
        updateTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test',
            status: 'todo',
            url: '',
            dueDate: '2026-03-25T12:00:00.000Z',
          }),
        ),
      })

      const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', dueDate: { date: '2026-03-25', time: '17:00' } },
        { toolCallId: '1', messages: [] },
      )

      // Provider echoed back UTC; tool should convert to Asia/Karachi local time (UTC+5)
      expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
    })
  })

  describe('makeGetTaskTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeGetTaskTool(provider)
      expect(tool.description).toContain('Fetch complete details')
    })

    test('fetches task with details', async () => {
      const provider = createMockProvider({
        getTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            status: 'todo',
            priority: 'high',
            description: 'Task details',
            relations: [{ type: 'blocks' as const, taskId: 'task-2' }],
            url: 'https://test.com/task/1',
          }),
        ),
      })

      const tool = makeGetTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskWithRelations(result))

      expect(result.id).toBe('task-1')
      expect(result.title).toBe('Test Task')
      expect(result.relations).toHaveLength(1)
      expect(result.relations[0]?.type).toBe('blocks')
    })

    test('handles task with no relations', async () => {
      const provider = createMockProvider({
        getTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            status: 'todo',
            relations: [],
            url: 'https://test.com/task/1',
          }),
        ),
      })

      const tool = makeGetTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskWithRelations(result))

      expect(result.relations).toEqual([])
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        getTask: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeGetTaskTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeGetTaskTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })

    test('returns dueDate converted to user local time', async () => {
      const provider = createMockProvider({
        getTask: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test',
            status: 'todo',
            url: '',
            dueDate: '2026-03-25T12:00:00.000Z',
          }),
        ),
      })

      const tool = makeGetTaskTool(provider, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      // Asia/Karachi is UTC+5: 12:00 UTC → 17:00 local
      expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
    })
  })

  describe('makeListTasksTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeListTasksTool(provider)
      expect(tool.description).toContain('List tasks')
    })

    test('lists tasks for project', async () => {
      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            {
              id: 'task-1',
              title: 'Task 1',
              number: 1,
              status: 'todo',
              priority: 'medium',
              url: 'https://test.com/task/1',
            },
            {
              id: 'task-2',
              title: 'Task 2',
              number: 2,
              status: 'done',
              priority: 'high',
              url: 'https://test.com/task/2',
            },
          ]),
        ),
        buildTaskUrl: mock(() => 'https://test.com/task/1'),
      })

      const tool = makeListTasksTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskArray(result))

      expect(result).toHaveLength(2)
      expect(result[0]?.title).toBe('Task 1')
      expect(result[1]?.title).toBe('Task 2')
    })

    test('returns empty array when no tasks', async () => {
      const provider = createMockProvider({
        listTasks: mock(() => Promise.resolve([])),
      })

      const tool = makeListTasksTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ projectId: 'empty-proj' }, { toolCallId: '1', messages: [] })
      assert(Array.isArray(result))

      expect(result).toHaveLength(0)
    })

    test('propagates project not found error', async () => {
      const provider = createMockProvider({
        listTasks: mock(() => Promise.reject(new Error('Project not found'))),
      })

      const tool = makeListTasksTool(provider)
      const promise = getToolExecutor(tool)({ projectId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeListTasksTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })

    test('returns dueDate fields converted to user local time', async () => {
      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'A', status: 'todo', url: '', dueDate: '2026-03-25T12:00:00.000Z' },
            { id: 'task-2', title: 'B', status: 'todo', url: '', dueDate: undefined },
          ]),
        ),
      })

      const tool = makeListTasksTool(provider, 'user-1')
      assert(tool.execute)
      const result: unknown = await tool.execute({ projectId: 'p1' }, { toolCallId: '1', messages: [] })

      assert(Array.isArray(result))
      expect(result[0]).toHaveProperty('dueDate', '2026-03-25T17:00:00')
      expect(result[1]).toHaveProperty('dueDate', undefined)
    })
  })

  describe('makeSearchTasksTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeSearchTasksTool(provider)
      expect(tool.description).toContain('Search for tasks')
    })

    test('searches tasks by keyword', async () => {
      const provider = createMockProvider({
        searchTasks: mock(() =>
          Promise.resolve([
            {
              id: 'task-1',
              title: 'Fix bug',
              number: 1,
              status: 'todo',
              priority: 'high',
              url: 'https://test.com/task/1',
            },
            {
              id: 'task-2',
              title: 'Bug report',
              number: 2,
              status: 'done',
              priority: 'medium',
              url: 'https://test.com/task/2',
            },
          ]),
        ),
      })

      const tool = makeSearchTasksTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ query: 'bug' }, { toolCallId: '1', messages: [] })
      assert(Array.isArray(result))

      expect(result).toHaveLength(2)
    })

    test('passes query to provider searchTasks', async () => {
      const searchTasks = mock((_params: { query: string; projectId?: string }) => Promise.resolve([]))
      const provider = createMockProvider({ searchTasks })

      const tool = makeSearchTasksTool(provider)
      assert(tool.execute)
      await tool.execute({ query: 'test' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      const call = searchTasks.mock.calls[0]
      assert(call)
      const params = call[0] as Record<string, unknown>
      expect(params['query']).toBe('test')
    })

    test('filters by projectId when provided', async () => {
      const searchTasks = mock((_params: { query: string; projectId?: string }) => Promise.resolve([]))
      const provider = createMockProvider({ searchTasks })

      const tool = makeSearchTasksTool(provider)
      assert(tool.execute)
      await tool.execute({ query: 'test', projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      const call = searchTasks.mock.calls[0]
      assert(call)
      const params = call[0] as Record<string, unknown>
      expect(params['query']).toBe('test')
      expect(params['projectId']).toBe('proj-1')
    })

    test('returns empty array when no matches', async () => {
      const provider = createMockProvider({
        searchTasks: mock(() => Promise.resolve([])),
      })

      const tool = makeSearchTasksTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ query: 'nonexistent' }, { toolCallId: '1', messages: [] })
      assert(Array.isArray(result))

      expect(result).toEqual([])
    })
  })

  describe('makeDeleteTaskTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeDeleteTaskTool(provider)
      expect(tool.description).toContain('Delete')
    })

    test('deletes task when confidence is high', async () => {
      const deleteTask = mock(() => Promise.resolve({ id: 'task-1' }))
      const provider = createMockProvider({ deleteTask })

      const tool = makeDeleteTaskTool(provider)
      assert(tool.execute)
      await tool.execute({ taskId: 'task-1', confidence: 0.9 }, { toolCallId: '1', messages: [] })

      expect(deleteTask).toHaveBeenCalledTimes(1)
      expect(deleteTask).toHaveBeenCalledWith('task-1')
    })

    test('returns confirmation_required when confidence is low', async () => {
      const provider = createMockProvider()
      const tool = makeDeleteTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', confidence: 0.5 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ status: 'confirmation_required' })
    })

    test('returns confirmation_required without sufficient confidence (confidence: 0)', async () => {
      const provider = createMockProvider()
      const tool = makeDeleteTaskTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1', confidence: 0 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ status: 'confirmation_required' })
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        deleteTask: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeDeleteTaskTool(provider)
      const result = getToolExecutor(tool)({ taskId: 'invalid', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      await expect(result).rejects.toThrow('Task not found')
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeDeleteTaskTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
      expect(schemaValidates(tool, { taskId: 'x', confidence: 0.9 })).toBe(true)
    })
  })
})
