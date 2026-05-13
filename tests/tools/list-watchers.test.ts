import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeListWatchersTool } from '../../src/tools/list-watchers.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isWatcherList(value: unknown): value is Array<{
  id: string
  login?: string
  name?: string
}> {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && 'id' in item)
}

describe('List Watchers Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeListWatchersTool(createMockProvider())
    expect(tool.description).toContain('List the watchers')
  })

  test('lists watchers for a task', async () => {
    const listWatchers = mock(() =>
      Promise.resolve([
        { id: 'user-1', login: 'alice', name: 'Alice Smith' },
        { id: 'user-2', login: 'bob', name: 'Bob Jones' },
      ]),
    )
    const tool = makeListWatchersTool(createMockProvider({ listWatchers }))

    const result: unknown = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    assert(isWatcherList(result))
    expect(result).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Smith' },
      { id: 'user-2', login: 'bob', name: 'Bob Jones' },
    ])
    expect(listWatchers).toHaveBeenCalledWith('task-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeListWatchersTool(
      createMockProvider({
        listWatchers: mock(() => Promise.reject(new Error('Watcher list failed'))),
      }),
    )

    await expect(getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'Watcher list failed',
    )
  })

  test('validates taskId is required', () => {
    const tool = makeListWatchersTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(true)
  })
})
