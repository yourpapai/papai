import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddCommentReactionTool } from '../../src/tools/add-comment-reaction.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isReaction(value: unknown): value is { id: string; reaction: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'reaction' in value &&
    typeof value.reaction === 'string'
  )
}

describe('Add Comment Reaction Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeAddCommentReactionTool(createMockProvider())
    expect(tool.description).toContain('Add a reaction')
  })

  test('adds a reaction to a comment', async () => {
    const addCommentReaction = mock((taskId: string, commentId: string, reaction: string) =>
      Promise.resolve({ id: 'reaction-1', reaction, taskId, commentId }),
    )
    const tool = makeAddCommentReactionTool(createMockProvider({ addCommentReaction }))

    const result: unknown = await getToolExecutor(tool)(
      { taskId: 'task-1', commentId: 'comment-1', reaction: 'thumbs_up' },
      { toolCallId: '1', messages: [] },
    )

    assert(isReaction(result))
    expect(result.reaction).toBe('thumbs_up')
    expect(addCommentReaction).toHaveBeenCalledWith('task-1', 'comment-1', 'thumbs_up')
  })

  test('propagates provider errors', async () => {
    const tool = makeAddCommentReactionTool(
      createMockProvider({
        addCommentReaction: mock(() => Promise.reject(new Error('Reaction failed'))),
      }),
    )

    await expect(
      getToolExecutor(tool)(
        { taskId: 'task-1', commentId: 'comment-1', reaction: 'thumbs_up' },
        { toolCallId: '1', messages: [] },
      ),
    ).rejects.toThrow('Reaction failed')
  })

  test('validates required inputs', () => {
    const tool = makeAddCommentReactionTool(createMockProvider())
    expect(schemaValidates(tool, { commentId: 'comment-1', reaction: 'smile' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', reaction: 'smile' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', commentId: 'comment-1' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', commentId: 'comment-1', reaction: 'smile' })).toBe(true)
  })
})
