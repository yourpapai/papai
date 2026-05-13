import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddCommentTool } from '../../src/tools/add-comment.js'
import { makeGetCommentsTool } from '../../src/tools/get-comments.js'
import { makeRemoveCommentTool } from '../../src/tools/remove-comment.js'
import { makeUpdateCommentTool } from '../../src/tools/update-comment.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isAddResult(val: unknown): val is { id: string; body: string; createdAt: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'body' in val &&
    typeof val.body === 'string' &&
    'createdAt' in val &&
    typeof val.createdAt === 'string'
  )
}

function isUpdateResult(val: unknown): val is { id: string; body: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'body' in val &&
    typeof val.body === 'string'
  )
}

function isSuccessResult(val: unknown): val is { id: string } {
  return val !== null && typeof val === 'object' && 'id' in val && typeof val.id === 'string'
}

describe('Comment Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeAddCommentTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeAddCommentTool(provider)
      expect(tool.description).toContain('Add a comment')
    })

    test('adds comment to task', async () => {
      const addCommentMock = mock(() =>
        Promise.resolve({
          id: 'comment-1',
          body: 'New comment',
          createdAt: '2026-01-01T00:00:00Z',
        }),
      )
      const provider = createMockProvider({ addComment: addCommentMock })

      const tool = makeAddCommentTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', comment: 'New comment' },
        { toolCallId: '1', messages: [] },
      )
      assert(isAddResult(result))

      expect(result.id).toBe('comment-1')
      expect(result.body).toBe('New comment')
      expect(addCommentMock).toHaveBeenCalledWith('task-1', 'New comment')
    })

    test('handles empty comment', async () => {
      const provider = createMockProvider({
        addComment: mock(() => Promise.resolve({ id: 'comment-1', body: '', createdAt: '2026-01-01T00:00:00Z' })),
      })

      const tool = makeAddCommentTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1', comment: '' }, { toolCallId: '1', messages: [] })
      assert(isAddResult(result))

      expect(result.body).toBe('')
    })

    test('handles very long comment', async () => {
      const longComment = 'a'.repeat(1000)
      const provider = createMockProvider({
        addComment: mock(() =>
          Promise.resolve({ id: 'comment-1', body: longComment, createdAt: '2026-01-01T00:00:00Z' }),
        ),
      })

      const tool = makeAddCommentTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', comment: longComment },
        { toolCallId: '1', messages: [] },
      )
      assert(isAddResult(result))

      expect(result.body).toBe(longComment)
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        addComment: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeAddCommentTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'invalid', comment: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeAddCommentTool(provider)
      expect(schemaValidates(tool, { comment: 'Test' })).toBe(false)
    })

    test('validates comment is required', () => {
      const provider = createMockProvider()
      const tool = makeAddCommentTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })
  })

  describe('makeGetCommentsTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeGetCommentsTool(provider)
      expect(tool.description).toContain('Get all comments')
    })

    test('accepts optional limit and offset for comment pagination', () => {
      const provider = createMockProvider()
      const tool = makeGetCommentsTool(provider)

      expect(schemaValidates(tool, { taskId: 'task-1', limit: 20, offset: 40 })).toBe(true)
      expect(schemaValidates(tool, { taskId: 'task-1', limit: 0 })).toBe(false)
      expect(schemaValidates(tool, { taskId: 'task-1', offset: -1 })).toBe(false)
    })

    test('gets all comments on task', async () => {
      const provider = createMockProvider({
        getComments: mock(() =>
          Promise.resolve([
            { id: 'comment-1', body: 'Comment 1', createdAt: '2026-03-01T00:00:00Z' },
            { id: 'comment-2', body: 'Comment 2', createdAt: '2026-03-02T00:00:00Z' },
          ]),
        ),
      })

      const tool = makeGetCommentsTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      assert(Array.isArray(result))

      expect(result).toHaveLength(2)
    })

    test('passes limit and offset to provider.getComments', async () => {
      const getComments = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ getComments })
      const tool = makeGetCommentsTool(provider)

      await getToolExecutor(tool)({ taskId: 'task-1', limit: 20, offset: 40 }, { toolCallId: '1', messages: [] })

      expect(getComments).toHaveBeenCalledWith('task-1', { limit: 20, offset: 40 })
    })

    test('passes offset-only and limit-only pagination params through unchanged', async () => {
      const getComments = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ getComments })
      const tool = makeGetCommentsTool(provider)

      await getToolExecutor(tool)({ taskId: 'task-1', offset: 40 }, { toolCallId: '1', messages: [] })
      await getToolExecutor(tool)({ taskId: 'task-1', limit: 20 }, { toolCallId: '2', messages: [] })

      expect(getComments).toHaveBeenNthCalledWith(1, 'task-1', { limit: undefined, offset: 40 })
      expect(getComments).toHaveBeenNthCalledWith(2, 'task-1', { limit: 20, offset: undefined })
    })

    test('filters non-comment activities', async () => {
      const provider = createMockProvider({
        getComments: mock(() =>
          Promise.resolve([{ id: 'act-1', body: 'Comment 1', createdAt: '2026-03-01T00:00:00Z' }]),
        ),
      })

      const tool = makeGetCommentsTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      assert(Array.isArray(result))

      expect(result).toHaveLength(1)
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        getComments: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeGetCommentsTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeGetCommentsTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })
  })

  describe('makeUpdateCommentTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateCommentTool(provider)
      expect(tool.description).toContain('Update an existing comment')
    })

    test('updates existing comment', async () => {
      const updateCommentMock = mock(() =>
        Promise.resolve({
          id: 'comment-1',
          body: 'Updated comment',
        }),
      )
      const provider = createMockProvider({ updateComment: updateCommentMock })

      const tool = makeUpdateCommentTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', activityId: 'comment-1', comment: 'Updated comment' },
        { toolCallId: '1', messages: [] },
      )
      assert(isUpdateResult(result))

      expect(result.id).toBe('comment-1')
      expect(result.body).toBe('Updated comment')
      expect(updateCommentMock).toHaveBeenCalledWith({
        taskId: 'task-1',
        commentId: 'comment-1',
        body: 'Updated comment',
      })
    })

    test('propagates comment not found error', async () => {
      const provider = createMockProvider({
        updateComment: mock(() => Promise.reject(new Error('Comment not found'))),
      })

      const tool = makeUpdateCommentTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', activityId: 'invalid', comment: 'Test' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Comment not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateCommentTool(provider)
      expect(schemaValidates(tool, { activityId: 'comment-1', comment: 'Test' })).toBe(false)
    })

    test('validates activityId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateCommentTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', comment: 'Test' })).toBe(false)
    })

    test('validates comment is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateCommentTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', activityId: 'comment-1' })).toBe(false)
    })

    test('accepts valid full input', () => {
      const provider = createMockProvider()
      const tool = makeUpdateCommentTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', activityId: 'comment-1', comment: 'Test' })).toBe(true)
    })
  })

  describe('makeRemoveCommentTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeRemoveCommentTool(provider)
      expect(tool.description).toContain('Remove a comment')
    })

    test('removes comment successfully', async () => {
      const removeCommentMock = mock(() => Promise.resolve({ id: 'comment-1' }))
      const provider = createMockProvider({ removeComment: removeCommentMock })

      const tool = makeRemoveCommentTool(provider)
      assert(tool.execute)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', commentId: 'comment-1' },
        { toolCallId: '1', messages: [] },
      )
      assert(isSuccessResult(result))

      expect(result.id).toBe('comment-1')
      expect(removeCommentMock).toHaveBeenCalledWith({
        taskId: 'task-1',
        commentId: 'comment-1',
      })
    })

    test('propagates comment not found error', async () => {
      const provider = createMockProvider({
        removeComment: mock(() => Promise.reject(new Error('Comment not found'))),
      })

      const tool = makeRemoveCommentTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', commentId: 'invalid' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Comment not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveCommentTool(provider)
      expect(schemaValidates(tool, { commentId: 'comment-1' })).toBe(false)
    })

    test('validates commentId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveCommentTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })

    test('accepts valid full input', () => {
      const provider = createMockProvider()
      const tool = makeRemoveCommentTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', commentId: 'comment-1' })).toBe(true)
    })
  })
})
