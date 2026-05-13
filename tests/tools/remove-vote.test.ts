import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeRemoveVoteTool } from '../../src/tools/remove-vote.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskResult(value: unknown): value is { taskId: string } {
  return value !== null && typeof value === 'object' && 'taskId' in value && typeof value.taskId === 'string'
}

describe('Remove Vote Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeRemoveVoteTool(createMockProvider())
    expect(tool.description).toContain('Remove your vote')
  })

  test('removes vote from task', async () => {
    const removeVote = mock((taskId: string) => Promise.resolve({ taskId }))
    const tool = makeRemoveVoteTool(createMockProvider({ removeVote }))

    const result: unknown = await getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    assert(isTaskResult(result), 'Invalid result')
    expect(result.taskId).toBe('task-1')
    expect(removeVote).toHaveBeenCalledWith('task-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeRemoveVoteTool(
      createMockProvider({
        removeVote: mock(() => Promise.reject(new Error('Remove vote failed'))),
      }),
    )

    await expect(getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'Remove vote failed',
    )
  })

  test('validates required taskId', () => {
    const tool = makeRemoveVoteTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(true)
  })
})
