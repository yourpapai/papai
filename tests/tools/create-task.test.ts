import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'
import assert from 'node:assert/strict'

import { getConfig, setConfig } from '../../src/config.js'
import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { resolveMeReference } from '../../src/identity/resolver.js'
import { makeCreateTaskTool } from '../../src/tools/create-task.js'
import { mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider, createMockYouTrackProvider } from './mock-provider.js'

describe('create_task identity resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    // Clear any existing identity mapping
    clearIdentityMapping('test-user-456', 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should resolve "me" assignee to identity', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    const result = await resolveMeReference('test-user-456', createMockProvider())
    assert(result.type === 'found')
    expect(result.identity.userId).toBe('resolved-user-789')
  })

  test('should return not_found when no identity mapping exists', async () => {
    const result = await resolveMeReference('unknown-user', createMockProvider())
    assert(result.type === 'not_found')
    expect(result.message).toContain("don't know who you are")
  })

  test('should return unmatched when identity was previously unmatched', async () => {
    // Set an unmatched mapping using null for providerUserId
    setIdentityMapping({
      contextId: 'unmatched-user',
      providerName: 'mock',
      providerUserId: '',
      providerUserLogin: '',
      displayName: '',
      matchMethod: 'unmatched',
      confidence: 0,
    })

    // Clear it first to set providerUserId to null (the actual unmatched state)
    clearIdentityMapping('unmatched-user', 'mock')

    const result = await resolveMeReference('unmatched-user', createMockProvider())
    assert(result.type === 'unmatched')
    expect(result.message).toContain("couldn't automatically match")
  })

  test('create_task tool should resolve "me" assignee to provider user ID', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(createTask).toHaveBeenCalledTimes(1)
    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('create_task tool should resolve "ME" (uppercase) assignee to identity', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1', assignee: 'ME' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('create_task tool should return identity_required when no mapping exists', async () => {
    const provider = createMockProvider()
    const tool = makeCreateTaskTool(provider, 'no-mapping-user')

    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'Test Task', projectId: 'proj-1', assignee: 'me' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'identity_required')
    expect(result).toHaveProperty('message', expect.stringContaining("don't know who you are"))
  })

  test('create_task tool should pass through non-me assignee unchanged', async () => {
    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockYouTrackProvider({ createTask, supportsCustomFields: true })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      { title: 'Test Task', projectId: 'proj-1', assignee: 'other-user' },
      { toolCallId: '1', messages: [] },
    )

    expect(capturedAssignee).toBe('other-user')
  })

  test('create_task tool should work without assignee', async () => {
    let capturedAssignee: string | undefined = 'initial'
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBeUndefined()
  })

  test('create_task tool should use login when provider prefers login identifier', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask, preferredUserIdentifier: 'login' })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(createTask).toHaveBeenCalledTimes(1)
    expect(capturedAssignee).toBe('jsmith')
  })

  test('create_task tool should throw error when provider fails', async () => {
    const createTask = mock(() => {
      return Promise.reject(new Error('Database connection failed'))
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await expect(
      tool.execute({ title: 'Test Task', projectId: 'proj-1' }, { toolCallId: '1', messages: [] }),
    ).rejects.toThrow('Database connection failed')
  })

  test('create_task input schema accepts provider-defined priority values', () => {
    const tool = makeCreateTaskTool(createMockProvider(), 'test-user-456')

    expect(schemaValidates(tool, { title: 'Test Task', projectId: 'proj-1', priority: 'Show-stopper' })).toBe(true)
  })

  test('create_task input schema rejects blank priority values', () => {
    const tool = makeCreateTaskTool(createMockProvider(), 'test-user-456')

    expect(schemaValidates(tool, { title: 'Test Task', projectId: 'proj-1', priority: '' })).toBe(false)
    expect(schemaValidates(tool, { title: 'Test Task', projectId: 'proj-1', priority: '   ' })).toBe(false)
  })

  test('create_task tool should pass customFields to provider', async () => {
    let capturedCustomFields: Array<{ name: string; value: string }> | undefined
    const createTask = mock((params: { title: string; customFields?: Array<{ name: string; value: string }> }) => {
      capturedCustomFields = params.customFields
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask, name: 'youtrack', supportsCustomFields: true })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        title: 'Test Task',
        projectId: 'proj-1',
        customFields: [
          { name: 'URL адеса где будет размещаться приложени', value: 'stream://myapp' },
          { name: 'Environment', value: 'production' },
        ],
      },
      { toolCallId: '1', messages: [] },
    )

    expect(createTask).toHaveBeenCalledTimes(1)
    expect(capturedCustomFields).toHaveLength(2)
    expect(capturedCustomFields?.[0]).toEqual({
      name: 'URL адеса где будет размещаться приложени',
      value: 'stream://myapp',
    })
    expect(capturedCustomFields?.[1]).toEqual({ name: 'Environment', value: 'production' })
  })

  test('create_task rejects customFields for providers that do not support them', async () => {
    const createTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }),
    )
    const provider = createMockProvider({
      createTask,
      name: 'kaneo',
    })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')

    await expect(
      tool.execute(
        {
          title: 'Test Task',
          projectId: 'proj-1',
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

    expect(createTask).not.toHaveBeenCalled()
  })

  test('create_task accepts customFields when provider explicitly supports them', async () => {
    let capturedCustomFields: Array<{ name: string; value: string }> | undefined
    const createTask = mock((params: { title: string; customFields?: Array<{ name: string; value: string }> }) => {
      capturedCustomFields = params.customFields
      return Promise.resolve({ id: 'task-1', title: params.title, status: 'todo', url: 'https://test.com/task/1' })
    })
    const provider = createMockProvider({
      createTask,
      name: 'custom-provider',
      supportsCustomFields: true,
    })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')

    await tool.execute(
      {
        title: 'Test Task',
        projectId: 'proj-1',
        customFields: [{ name: 'Environment', value: 'staging' }],
      },
      { toolCallId: '1', messages: [] },
    )

    expect(createTask).toHaveBeenCalledTimes(1)
    expect(capturedCustomFields).toEqual([{ name: 'Environment', value: 'staging' }])
  })

  test('create_task tool should return provider dueDate converted back to local time', async () => {
    const createTask = mock((params: Readonly<{ title: string; dueDate?: string }>) => {
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        dueDate: '2026-03-25T17:00:00.000Z',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'Test Task', projectId: 'proj-1', dueDate: { date: '2026-03-25', time: '17:00' } },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
  })

  test('create_task tool should preserve date-only dueDate from provider', async () => {
    let capturedDueDate: string | undefined
    const createTask = mock((params: Readonly<{ title: string; dueDate?: string }>) => {
      capturedDueDate = params.dueDate
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        dueDate: '2026-03-25',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockYouTrackProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'Test Task', projectId: 'proj-1', dueDate: { date: '2026-03-25' } },
      { toolCallId: '1', messages: [] },
    )

    expect(capturedDueDate).toBe('2026-03-25')
    expect(result).toHaveProperty('dueDate', '2026-03-25')
  })

  describe('timezone config lookup (NI2 fix)', () => {
    test('should use storageContextId for timezone in group chats', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      // Config stored under group context
      setConfig(storageContextId, 'timezone', 'America/New_York')

      // Verify the bug: config NOT under chatUserId
      expect(getConfig(chatUserId, 'timezone')).toBeNull()

      const createTask = mock((params: { title: string; dueDate?: string }) => {
        return Promise.resolve({
          id: 'task-1',
          title: params.title,
          status: 'todo',
          url: 'https://test.com/task/1',
          dueDate: params.dueDate,
        })
      })

      const provider = createMockProvider({ createTask })
      // Pass storageContextId as third parameter
      const tool = makeCreateTaskTool(provider, chatUserId, storageContextId)

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute(
        { title: 'Test Task', projectId: 'proj-1', dueDate: { date: '2024-06-15', time: '14:00' } },
        { toolCallId: '1', messages: [] },
      )

      // 14:00 EDT (America/New_York in June) = 18:00 UTC
      const callArgs = createTask.mock.calls[0]?.[0] as { dueDate?: string } | undefined
      expect(callArgs).toBeDefined()
      expect(callArgs?.dueDate).toContain('18:00')
    })

    test('should fallback to UTC when storageContextId has no timezone', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      // No timezone set

      const createTask = mock((params: { title: string; dueDate?: string }) => {
        return Promise.resolve({
          id: 'task-1',
          title: params.title,
          status: 'todo',
          url: 'https://test.com/task/1',
          dueDate: params.dueDate,
        })
      })

      const provider = createMockProvider({ createTask })
      const tool = makeCreateTaskTool(provider, chatUserId, storageContextId)

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute(
        { title: 'Test Task', projectId: 'proj-1', dueDate: { date: '2024-06-15', time: '14:00' } },
        { toolCallId: '1', messages: [] },
      )

      // With UTC fallback, 14:00 stays 14:00
      const callArgs = createTask.mock.calls[0]?.[0] as { dueDate?: string } | undefined
      expect(callArgs).toBeDefined()
      expect(callArgs?.dueDate).toContain('14:00')
    })

    test('should work with same userId and storageContextId in DMs', async () => {
      const userId = 'user-123'
      setConfig(userId, 'timezone', 'America/Los_Angeles')

      const createTask = mock((params: { title: string; dueDate?: string }) => {
        return Promise.resolve({
          id: 'task-1',
          title: params.title,
          status: 'todo',
          url: 'https://test.com/task/1',
          dueDate: params.dueDate,
        })
      })

      const provider = createMockProvider({ createTask })
      // In DMs, both IDs are the same
      const tool = makeCreateTaskTool(provider, userId, userId)

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute(
        { title: 'Test Task', projectId: 'proj-1', dueDate: { date: '2024-06-15', time: '14:00' } },
        { toolCallId: '1', messages: [] },
      )

      // 14:00 PDT (America/Los_Angeles in June) = 21:00 UTC
      const callArgs = createTask.mock.calls[0]?.[0] as { dueDate?: string } | undefined
      expect(callArgs).toBeDefined()
      expect(callArgs?.dueDate).toContain('21:00')
    })
  })
})
