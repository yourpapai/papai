import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'
import assert from 'node:assert/strict'

import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { makeSearchTasksTool } from '../../src/tools/search-tasks.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('search_tasks', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping('test-search-identity', 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('accepts offset and limit for paginated search results', () => {
    const tool = makeSearchTasksTool(createMockProvider(), 'test-search-identity')

    expect(schemaValidates(tool, { query: 'tasks', limit: 25, offset: 50 })).toBe(true)
    expect(schemaValidates(tool, { query: 'tasks', offset: -1 })).toBe(false)
  })

  test('passes offset and limit to provider.searchTasks', async () => {
    const searchTasks = mock(() => Promise.resolve([]))
    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    await getToolExecutor(tool)({ query: 'tasks', limit: 25, offset: 50 }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledWith({
      query: 'tasks',
      projectId: undefined,
      assigneeId: undefined,
      limit: 25,
      offset: 50,
    })
  })

  describe('identity resolution via assigneeId', () => {
    test('should resolve "me" to login when provider prefers login', async () => {
      setIdentityMapping({
        contextId: 'test-search-identity',
        providerName: 'mock',
        providerUserId: 'resolved-user-789',
        providerUserLogin: 'jsmith',
        displayName: 'John Smith',
        matchMethod: 'manual_nl',
        confidence: 100,
      })

      let capturedAssigneeId: string | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedAssigneeId = params.assigneeId
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks, preferredUserIdentifier: 'login' })
      const tool = makeSearchTasksTool(provider, 'test-search-identity')

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'tasks', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedAssigneeId).toBe('jsmith')
    })

    test('should resolve "me" to userId when provider prefers id', async () => {
      setIdentityMapping({
        contextId: 'test-search-identity',
        providerName: 'mock',
        providerUserId: 'resolved-user-789',
        providerUserLogin: 'jsmith',
        displayName: 'John Smith',
        matchMethod: 'manual_nl',
        confidence: 100,
      })

      let capturedAssigneeId: string | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedAssigneeId = params.assigneeId
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks, preferredUserIdentifier: 'id' })
      const tool = makeSearchTasksTool(provider, 'test-search-identity')

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'tasks', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedAssigneeId).toBe('resolved-user-789')
    })

    test('should pass through query unchanged', async () => {
      let capturedQuery: string | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedQuery = params.query
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks })
      const tool = makeSearchTasksTool(provider, 'test-search-identity')

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'my tasks', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedQuery).toBe('my tasks')
    })

    test('should pass through assigneeId unchanged when not "me"', async () => {
      let capturedAssigneeId: string | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedAssigneeId = params.assigneeId
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks })
      const tool = makeSearchTasksTool(provider, 'test-search-identity')

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'tasks', assigneeId: 'user-123' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedAssigneeId).toBe('user-123')
    })

    test('should not resolve when userId is undefined', async () => {
      let capturedAssigneeId: string | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedAssigneeId = params.assigneeId
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks })
      const tool = makeSearchTasksTool(provider, undefined)

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'tasks', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedAssigneeId).toBe('me')
    })

    test('should not resolve when no identity mapping exists', async () => {
      let capturedAssigneeId: string | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedAssigneeId = params.assigneeId
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks })
      const tool = makeSearchTasksTool(provider, 'no-mapping-user')

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'tasks', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedAssigneeId).toBe('me')
    })

    test('should work without assigneeId', async () => {
      let capturedParams: { query: string; assigneeId?: string } | undefined
      const searchTasks = mock((params: { query: string; projectId?: string; assigneeId?: string; limit?: number }) => {
        capturedParams = params
        return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
      })

      const provider = createMockProvider({ searchTasks })
      const tool = makeSearchTasksTool(provider, 'test-search-identity')

      assert(tool.execute, 'Tool execute is undefined')
      await tool.execute({ query: 'bug fix' }, { toolCallId: '1', messages: [] })

      expect(searchTasks).toHaveBeenCalledTimes(1)
      expect(capturedParams?.query).toBe('bug fix')
      expect(capturedParams?.assigneeId).toBeUndefined()
    })
  })
})
