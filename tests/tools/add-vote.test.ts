import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddVoteTool } from '../../src/tools/add-vote.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskResult(value: unknown): value is { taskId: string } {
  return value !== null && typeof value === 'object' && 'taskId' in value && typeof value.taskId === 'string'
}

describe('Add Vote Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeAddVoteTool(createMockProvider())
    expect(tool.description).toContain('Add your vote')
  })

  test('adds vote to task', async () => {
    const addVote = mock((taskId: string) => Promise.resolve({ taskId }))
    const tool = makeAddVoteTool(createMockProvider({ addVote }))

    const result: unknown = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    assert(isTaskResult(result), 'Invalid result')
    expect(result.taskId).toBe('task-1')
    expect(addVote).toHaveBeenCalledWith('task-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeAddVoteTool(
      createMockProvider({
        addVote: mock(() => Promise.reject(new Error('Vote failed'))),
      }),
    )

    await expect(getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'Vote failed',
    )
  })

  test('validates required taskId', () => {
    const tool = makeAddVoteTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(true)
  })
})
