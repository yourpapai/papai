import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'
import assert from 'node:assert/strict'

import { getConfig, setConfig } from '../../src/config.js'
import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { makeUpdateTaskTool } from '../../src/tools/update-task.js'
import { mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider, createMockYouTrackProvider } from './mock-provider.js'

function hasMessage(val: unknown): val is { message: unknown } {
  return typeof val === 'object' && val !== null && 'message' in val
}

describe('update_task identity resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    // Clear any existing identity mapping
    clearIdentityMapping('test-update-identity', 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should resolve "me" assignee in update', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-update-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    assert(tool.execute)
    await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('should resolve "ME" (uppercase) assignee to identity', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-update-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    assert(tool.execute)
    await tool.execute({ taskId: 'task-1', assignee: 'ME' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('should return identity_required when no mapping exists', async () => {
    const provider = createMockProvider()
    const tool = makeUpdateTaskTool(provider, undefined, 'no-mapping-user')

    assert(tool.execute)
    const result: unknown = await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'identity_required')
    expect(result).toHaveProperty('message')
    assert(hasMessage(result))
    expect(result.message).toContain("don't know who you are")
  })

  test('should pass through non-me assignee unchanged', async () => {
    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    assert(tool.execute)
    await tool.execute({ taskId: 'task-1', assignee: 'other-user' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('other-user')
  })

  test('should work without assignee parameter', async () => {
    let capturedAssignee: string | undefined = 'initial'
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    assert(tool.execute)
    await tool.execute({ taskId: 'task-1', status: 'done' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBeUndefined()
  })

  test('should pass "me" through unchanged when userId is undefined', async () => {
    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    // Pass undefined for userId (3rd parameter)
    const tool = makeUpdateTaskTool(provider, undefined, undefined)

    assert(tool.execute)
    await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('me')
  })

  test('should use login when provider prefers login identifier', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-update-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask, preferredUserIdentifier: 'login' })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    assert(tool.execute)
    await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect(capturedAssignee).toBe('jsmith')
  })

  test('should return provider dueDate converted back to local time', async () => {
    const updateTask = mock((taskId: string, _params: Readonly<{ dueDate?: string }>) => {
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        dueDate: '2026-03-25T17:00:00.000Z',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider)

    assert(tool.execute)
    const result: unknown = await tool.execute(
      { taskId: 'task-1', dueDate: { date: '2026-03-25', time: '17:00' } },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
  })

  test('should preserve date-only dueDate from provider', async () => {
    let capturedDueDate: string | undefined
    const updateTask = mock((taskId: string, params: Readonly<{ dueDate?: string }>) => {
      capturedDueDate = params.dueDate
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        dueDate: '2026-03-25',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockYouTrackProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider)

    assert(tool.execute)
    const result: unknown = await tool.execute(
      { taskId: 'task-1', dueDate: { date: '2026-03-25' } },
      { toolCallId: '1', messages: [] },
    )

    expect(capturedDueDate).toBe('2026-03-25')
    expect(result).toHaveProperty('dueDate', '2026-03-25')
  })

  test('update_task input schema accepts provider-defined priority values', () => {
    const tool = makeUpdateTaskTool(createMockProvider())

    expect(schemaValidates(tool, { taskId: 'task-1', priority: 'Show-stopper' })).toBe(true)
  })

  test('update_task accepts customFields for provider-safe YouTrack updates', () => {
    const tool = makeUpdateTaskTool(createMockProvider())
    expect(
      schemaValidates(tool, {
        taskId: 'TEST-1',
        customFields: [
          { name: 'Environment', value: 'staging' },
          { name: 'Steps', value: 'Click login' },
        ],
      }),
    ).toBe(true)
  })

  test('update_task forwards customFields to the provider', async () => {
    let capturedCustomFields: Array<{ name: string; value: string }> | undefined
    const updateTask = mock((_taskId: string, params: { customFields?: Array<{ name: string; value: string }> }) => {
      capturedCustomFields = params.customFields
      return Promise.resolve({ id: 'TEST-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' })
    })

    const tool = makeUpdateTaskTool(createMockYouTrackProvider({ updateTask, supportsCustomFields: true }))
    assert(tool.execute)
    await tool.execute(
      {
        taskId: 'TEST-1',
        customFields: [
          { name: 'Environment', value: 'staging' },
          { name: 'Steps', value: 'Click login' },
        ],
      },
      { toolCallId: '1', messages: [] },
    )

    expect(capturedCustomFields).toEqual([
      { name: 'Environment', value: 'staging' },
      { name: 'Steps', value: 'Click login' },
    ])
  })

  test('update_task rejects customFields for providers that do not support them', async () => {
    const updateTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }),
    )
    const provider = createMockProvider({
      updateTask,
      name: 'kaneo',
    })
    const tool = makeUpdateTaskTool(provider)

    assert(tool.execute)

    await expect(
      tool.execute(
        {
          taskId: 'task-1',
          customFields: [{ name: 'Environment', value: 'staging' }],
        },
        { toolCallId: '1', messages: [] },
      ),
    ).rejects.toMatchObject({
      error: {
        code: 'validation-failed',
        field: 'customFields',
      },
    })

    expect(updateTask).not.toHaveBeenCalled()
  })

  test('update_task accepts customFields when provider explicitly supports them', async () => {
    let capturedCustomFields: Array<{ name: string; value: string }> | undefined
    const updateTask = mock((_taskId: string, params: { customFields?: Array<{ name: string; value: string }> }) => {
      capturedCustomFields = params.customFields
      return Promise.resolve({ id: 'TEST-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' })
    })
    const provider = createMockProvider({
      updateTask,
      name: 'custom-provider',
      supportsCustomFields: true,
    })
    const tool = makeUpdateTaskTool(provider)

    assert(tool.execute)

    await tool.execute(
      {
        taskId: 'TEST-1',
        customFields: [{ name: 'Environment', value: 'staging' }],
      },
      { toolCallId: '1', messages: [] },
    )

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect(capturedCustomFields).toEqual([{ name: 'Environment', value: 'staging' }])
  })

  test('update_task input schema rejects blank priority values', () => {
    const tool = makeUpdateTaskTool(createMockProvider())

    expect(schemaValidates(tool, { taskId: 'task-1', priority: '' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', priority: '   ' })).toBe(false)
  })

  describe('timezone config lookup (NI2 fix)', () => {
    test('should use storageContextId for timezone in group chats', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      setConfig(storageContextId, 'timezone', 'Asia/Tokyo')

      // Verify config NOT under chatUserId (the bug scenario)
      expect(getConfig(chatUserId, 'timezone')).toBeNull()

      const updateTask = mock((taskId: string, params: { dueDate?: string }) => {
        return Promise.resolve({
          id: taskId,
          title: 'Updated Task',
          status: 'todo',
          dueDate: params.dueDate,
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ updateTask })
      // Pass storageContextId as 4th parameter
      const tool = makeUpdateTaskTool(provider, undefined, chatUserId, storageContextId)

      assert(tool.execute)
      await tool.execute(
        { taskId: 'task-1', dueDate: { date: '2024-06-15', time: '09:00' } },
        { toolCallId: '1', messages: [] },
      )

      // 09:00 JST (Asia/Tokyo) = 00:00 UTC
      const callArgs = updateTask.mock.calls[0] as [string, { dueDate?: string }] | undefined
      expect(callArgs?.[1]?.dueDate).toContain('00:00')
    })

    test('should fallback to UTC when no timezone configured', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      // No timezone set

      const updateTask = mock((taskId: string, params: { dueDate?: string }) => {
        return Promise.resolve({
          id: taskId,
          title: 'Updated Task',
          status: 'todo',
          dueDate: params.dueDate,
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ updateTask })
      const tool = makeUpdateTaskTool(provider, undefined, chatUserId, storageContextId)

      assert(tool.execute)
      await tool.execute(
        { taskId: 'task-1', dueDate: { date: '2024-06-15', time: '14:00' } },
        { toolCallId: '1', messages: [] },
      )

      // With UTC fallback, 14:00 stays 14:00
      const callArgs = updateTask.mock.calls[0] as [string, { dueDate?: string }] | undefined
      expect(callArgs?.[1]?.dueDate).toContain('14:00')
    })
  })
})
