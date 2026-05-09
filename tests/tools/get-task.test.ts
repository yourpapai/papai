import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { getConfig, setConfig } from '../../src/config.js'
import { makeGetTaskTool } from '../../src/tools/get-task.js'
import { mockLogger, setupTestDb, getToolExecutor } from '../utils/test-helpers.js'
import { createMockProvider, createMockYouTrackProvider } from './mock-provider.js'

describe('get_task', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterAll(() => {
    mock.restore()
  })

  test('should fetch task details', async () => {
    const getTask = mock((_taskId: string) => {
      return Promise.resolve({
        id: 'task-1',
        title: 'Test Task',
        status: 'todo',
        dueDate: '2024-06-15T12:00:00Z',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ getTask })
    const tool = makeGetTaskTool(provider, 'user-123')

    const result = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    expect(getTask).toHaveBeenCalledTimes(1)
    expect(getTask).toHaveBeenCalledWith('task-1')
    expect(result).toHaveProperty('id', 'task-1')
    expect(result).toHaveProperty('title', 'Test Task')
  })

  test('should return provider dueDate converted to local time', async () => {
    const getTask = mock((_taskId: string) => {
      return Promise.resolve({
        id: 'task-1',
        title: 'Test Task',
        status: 'todo',
        dueDate: '2026-03-25T17:00:00.000Z',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ getTask })
    const tool = makeGetTaskTool(provider, 'user-123')

    const result = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
  })

  test('should preserve date-only dueDate from provider', async () => {
    const getTask = mock((_taskId: string) => {
      return Promise.resolve({
        id: 'task-1',
        title: 'Test Task',
        status: 'todo',
        dueDate: '2026-03-25',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockYouTrackProvider({ getTask })
    const tool = makeGetTaskTool(provider, 'user-123')

    const result = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('dueDate', '2026-03-25')
  })

  test('get_task returns normalized customFields when the provider includes them', async () => {
    const getTask = mock(() =>
      Promise.resolve({
        id: 'TEST-1',
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
        customFields: [
          { name: 'Environment', value: 'staging' },
          { name: 'Steps', value: 'Click login' },
        ],
      }),
    )

    const tool = makeGetTaskTool(createMockProvider({ getTask }))
    const result = await getToolExecutor(tool)({ taskId: 'TEST-1' }, { toolCallId: '1', messages: [] })
    expect(result).toMatchObject({
      customFields: [
        { name: 'Environment', value: 'staging' },
        { name: 'Steps', value: 'Click login' },
      ],
    })
  })

  describe('timezone config lookup (NI2 fix)', () => {
    test('should use storageContextId for timezone in group chats', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      setConfig(storageContextId, 'timezone', 'Europe/London')

      expect(getConfig(chatUserId, 'timezone')).toBeNull()

      const getTask = mock((_taskId: string) => {
        return Promise.resolve({
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          dueDate: '2024-06-15T12:00:00Z',
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ getTask })
      const tool = makeGetTaskTool(provider, chatUserId, storageContextId)

      const result = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      expect(JSON.stringify(result)).toContain('13:00')
    })

    test('should fallback to UTC when no timezone configured', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'

      const getTask = mock((_taskId: string) => {
        return Promise.resolve({
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          dueDate: '2024-06-15T12:00:00Z',
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ getTask })
      const tool = makeGetTaskTool(provider, chatUserId, storageContextId)

      const result = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      expect(JSON.stringify(result)).toContain('12:00')
    })

    test('should work with same userId and storageContextId in DMs', async () => {
      const userId = 'user-123'
      setConfig(userId, 'timezone', 'America/Los_Angeles')

      const getTask = mock((_taskId: string) => {
        return Promise.resolve({
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          dueDate: '2024-06-15T21:00:00Z',
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ getTask })
      const tool = makeGetTaskTool(provider, userId, userId)

      const result = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      expect(JSON.stringify(result)).toContain('14:00')
    })
  })
})
