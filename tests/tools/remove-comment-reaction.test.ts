import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeRemoveCommentReactionTool } from '../../src/tools/remove-comment-reaction.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isReactionResult(value: unknown): value is { id: string; taskId: string; commentId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'taskId' in value &&
    typeof value.taskId === 'string' &&
    'commentId' in value &&
    typeof value.commentId === 'string'
  )
}

describe('Remove Comment Reaction Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeRemoveCommentReactionTool(createMockProvider())
    expect(tool.description).toContain('Remove a reaction')
  })

  test('removes a reaction from a comment', async () => {
    const removeCommentReaction = mock((taskId: string, commentId: string, reactionId: string) =>
      Promise.resolve({ id: reactionId, taskId, commentId }),
    )
    const tool = makeRemoveCommentReactionTool(createMockProvider({ removeCommentReaction }))

    const result: unknown = await getToolExecutor(tool)(
      { taskId: 'task-1', commentId: 'comment-1', reactionId: 'reaction-1' },
      { toolCallId: '1', messages: [] },
    )

    assert(isReactionResult(result), 'Invalid result')
    expect(result.id).toBe('reaction-1')
    expect(removeCommentReaction).toHaveBeenCalledWith('task-1', 'comment-1', 'reaction-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeRemoveCommentReactionTool(
      createMockProvider({
        removeCommentReaction: mock(() => Promise.reject(new Error('Remove reaction failed'))),
      }),
    )

    await expect(
      getToolExecutor(tool)(
        { taskId: 'task-1', commentId: 'comment-1', reactionId: 'reaction-1' },
        { toolCallId: '1', messages: [] },
      ),
    ).rejects.toThrow('Remove reaction failed')
  })

  test('validates required inputs', () => {
    const tool = makeRemoveCommentReactionTool(createMockProvider())
    expect(schemaValidates(tool, { commentId: 'comment-1', reactionId: 'reaction-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', reactionId: 'reaction-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', commentId: 'comment-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', commentId: 'comment-1', reactionId: 'reaction-1' })).toBe(true)
  })
})
