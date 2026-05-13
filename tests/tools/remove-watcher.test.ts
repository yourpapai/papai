import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { clearIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeRemoveWatcherTool } from '../../src/tools/remove-watcher.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskUserResult(value: unknown): value is { taskId: string; userId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'taskId' in value &&
    typeof value.taskId === 'string' &&
    'userId' in value &&
    typeof value.userId === 'string'
  )
}

describe('Remove Watcher Tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeRemoveWatcherTool(createMockProvider())
    expect(tool.description).toContain('Remove a watcher')
  })

  test('removes watcher from task', async () => {
    const removeWatcher = mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId }))
    const tool = makeRemoveWatcherTool(createMockProvider({ removeWatcher }))

    const result: unknown = await getToolExecutor(tool)(
      { taskId: 'task-1', userId: 'user-2' },
      { toolCallId: '1', messages: [] },
    )

    assert(isTaskUserResult(result), 'Invalid result')
    expect(result).toEqual({ taskId: 'task-1', userId: 'user-2' })
    expect(removeWatcher).toHaveBeenCalledWith('task-1', 'user-2')
  })

  test('propagates provider errors', async () => {
    const tool = makeRemoveWatcherTool(
      createMockProvider({
        removeWatcher: mock(() => Promise.reject(new Error('Watcher remove failed'))),
      }),
    )

    await expect(
      getToolExecutor(tool)({ taskId: 'task-1', userId: 'user-2' }, { toolCallId: '1', messages: [] }),
    ).rejects.toThrow('Watcher remove failed')
  })

  test('validates required inputs', () => {
    const tool = makeRemoveWatcherTool(createMockProvider())
    expect(schemaValidates(tool, { userId: 'user-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', userId: 'user-1' })).toBe(true)
  })

  describe('identity resolution', () => {
    const testUserId = 'test-unwatcher-identity'

    beforeEach(() => {
      setIdentityMapping({
        contextId: testUserId,
        providerName: 'mock',
        providerUserId: 'resolved-user-789',
        providerUserLogin: 'jsmith',
        displayName: 'John Smith',
        matchMethod: 'manual_nl',
        confidence: 100,
      })
    })

    test('resolves "me" userId to identity', async () => {
      const removeWatcher = mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId }))
      const tool = makeRemoveWatcherTool(createMockProvider({ removeWatcher }), testUserId)

      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-123', userId: 'me' },
        { toolCallId: '1', messages: [] },
      )

      assert(isTaskUserResult(result), 'Invalid result')
      expect(result).toEqual({ taskId: 'task-123', userId: 'resolved-user-789' })
      expect(removeWatcher).toHaveBeenCalledWith('task-123', 'resolved-user-789')
    })

    test('returns identity_required when identity not found', async () => {
      clearIdentityMapping(testUserId, 'mock')

      const tool = makeRemoveWatcherTool(createMockProvider(), testUserId)

      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-123', userId: 'me' },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toEqual({
        status: 'identity_required',
        message: "I couldn't automatically match you. What's your login?",
      })
    })

    test('uses original userId when not "me"', async () => {
      const removeWatcher = mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId }))
      const tool = makeRemoveWatcherTool(createMockProvider({ removeWatcher }), testUserId)

      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-123', userId: 'other-user' },
        { toolCallId: '1', messages: [] },
      )

      assert(isTaskUserResult(result), 'Invalid result')
      expect(result).toEqual({ taskId: 'task-123', userId: 'other-user' })
      expect(removeWatcher).toHaveBeenCalledWith('task-123', 'other-user')
    })

    test('uses login when provider prefers login identifier', async () => {
      const removeWatcher = mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId }))
      const tool = makeRemoveWatcherTool(
        createMockProvider({ removeWatcher, preferredUserIdentifier: 'login' }),
        testUserId,
      )

      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-123', userId: 'me' },
        { toolCallId: '1', messages: [] },
      )

      assert(isTaskUserResult(result), 'Invalid result')
      expect(result).toEqual({ taskId: 'task-123', userId: 'jsmith' })
      expect(removeWatcher).toHaveBeenCalledWith('task-123', 'jsmith')
    })

    test('returns error when removeWatcher is not supported', async () => {
      const baseProvider = createMockProvider()
      const providerWithoutWatcher: TaskProvider = {
        ...baseProvider,
        removeWatcher: undefined,
      }

      const tool = makeRemoveWatcherTool(providerWithoutWatcher)

      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-123', userId: 'user-1' },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toEqual({
        status: 'error',
        message: 'Provider does not support removing watchers',
      })
    })
  })
})
