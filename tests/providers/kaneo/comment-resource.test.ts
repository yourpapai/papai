import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { createMockActivity, mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { CommentResource } from './test-resources.js'

type ActivityOverrides = Exclude<Parameters<typeof createMockActivity>[0], undefined>

function parseRequestBody(options: RequestInit): unknown {
  return typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
}

function makeAddCommentFetchHandler(
  onPost: (body: unknown) => void,
  activityOverrides: ActivityOverrides,
): (_url: string, options: RequestInit) => Promise<Response> {
  return (_url: string, options: RequestInit): Promise<Response> => {
    if (options.method === 'POST') {
      onPost(parseRequestBody(options))
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify([createMockActivity(activityOverrides)]), { status: 200 }))
  }
}

function makeUpdateCommentFetchHandler(
  onPut: (body: unknown) => void,
  activityOverrides: ActivityOverrides,
): (_url: string, options: RequestInit) => Promise<Response> {
  return (_url: string, options: RequestInit): Promise<Response> => {
    if (options.method === 'PUT') {
      onPut(parseRequestBody(options))
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify([createMockActivity(activityOverrides)]), { status: 200 }))
  }
}

describe('CommentResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('add', () => {
    test('adds comment to task', async () => {
      // POST /activity/comment returns {} due to Kaneo bug (missing .returning() on Drizzle insert).
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/create-comment.ts
      // Code does POST then GET /activity/:taskId to retrieve the actual created comment.
      let capturedBody: unknown
      setMockFetch(
        makeAddCommentFetchHandler(
          (body) => {
            capturedBody = body
          },
          { id: 'comment-1', taskId: 'task-1', type: 'comment', userId: 'user-1', content: 'New comment' },
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', 'New comment')

      expect(capturedBody).toMatchObject({
        taskId: 'task-1',
        comment: 'New comment',
      })
      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('New comment')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('handles empty comment', async () => {
      setMockFetch(
        makeAddCommentFetchHandler(() => {}, {
          id: 'comment-2',
          taskId: 'task-1',
          type: 'comment',
          userId: 'user-1',
          content: '',
        }),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', '')

      expect(result.comment).toBe('')
      expect(result.id).toBe('comment-2')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('handles long comment', async () => {
      const longComment = 'a'.repeat(1000)
      setMockFetch(
        makeAddCommentFetchHandler(() => {}, {
          id: 'comment-3',
          taskId: 'task-1',
          type: 'comment',
          userId: 'user-1',
          content: longComment,
        }),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', longComment)

      expect(result.comment).toBe(longComment)
      expect(result.id).toBe('comment-3')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('throws taskNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.add('invalid', 'Test')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
    })
  })

  describe('list', () => {
    test('filters only comment activities', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivity({
                id: 'act-1',
                type: 'comment',
                content: 'Comment 1',
                createdAt: '2026-03-01T00:00:00Z',
              }),
              createMockActivity({
                id: 'act-2',
                type: 'status_changed',
                content: 'Status changed',
                createdAt: '2026-03-01T00:00:00Z',
              }),
              createMockActivity({
                id: 'act-3',
                type: 'comment',
                content: 'Comment 2',
                createdAt: '2026-03-02T00:00:00Z',
              }),
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(2)
      expect(result[0]?.comment).toBe('Comment 1')
      expect(result[1]?.comment).toBe('Comment 2')
    })

    test('excludes activities with null content', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivity({
                id: 'act-1',
                type: 'comment',
                content: 'Valid comment',
                createdAt: '2026-03-01T00:00:00Z',
              }),
              createMockActivity({
                id: 'act-2',
                type: 'comment',
                content: null,
                createdAt: '2026-03-01T00:00:00Z',
              }),
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(1)
      expect(result[0]?.comment).toBe('Valid comment')
    })

    test('returns empty array when no comments', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivity({
                id: 'act-1',
                type: 'status_changed',
                content: 'Changed',
                createdAt: '2026-03-01T00:00:00Z',
              }),
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(0)
    })

    test('maps to simplified structure', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivity({
                id: 'act-1',
                type: 'comment',
                content: 'Test',
                createdAt: '2026-03-01T12:00:00Z',
              }),
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result[0]).toMatchObject({
        id: 'act-1',
        comment: 'Test',
        createdAt: '2026-03-01T12:00:00Z',
      })
    })

    test('throws taskNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.list('invalid')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
    })
  })

  describe('update', () => {
    test('updates existing comment', async () => {
      // PUT /activity/comment returns {} due to Kaneo bug (missing .returning() on Drizzle update).
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/update-comment.ts
      // Code does PUT then GET /activity/:taskId to retrieve the actual updated comment.
      let capturedBody: unknown
      setMockFetch(
        makeUpdateCommentFetchHandler(
          (body) => {
            capturedBody = body
          },
          { id: 'comment-1', taskId: 'task-1', type: 'comment', content: 'Updated' },
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.update('task-1', 'comment-1', 'Updated')

      expect(capturedBody).toMatchObject({
        activityId: 'comment-1',
        comment: 'Updated',
      })
      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('Updated')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('throws commentNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.update('task-1', 'invalid', 'Updated')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
    })
  })

  describe('remove', () => {
    test('removes comment successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      const resource = new CommentResource(mockConfig)
      const result = await resource.remove('comment-1')

      expect(result.id).toBe('comment-1')
      expect(result.success).toBe(true)
    })

    test('throws commentNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.remove('invalid')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
    })
  })
})
