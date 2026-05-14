import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { CommentResource } from './test-resources.js'

function parseRequestBody(options: RequestInit): unknown {
  return typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
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
    test('adds comment through POST /comment/{taskId} and returns created comment object', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []

      setMockFetch((url, options) => {
        requests.push({
          url,
          method: options.method ?? 'GET',
          body: parseRequestBody(options),
        })

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              taskId: 'task-1',
              userId: 'user-1',
              content: 'New comment',
              createdAt: '2026-05-14T09:00:00.000Z',
              updatedAt: '2026-05-14T09:00:00.000Z',
              user: { name: 'Test User', image: null },
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', 'New comment')

      expect(requests).toEqual([
        {
          url: 'https://api.test.com/api/comment/task-1',
          method: 'POST',
          body: { content: 'New comment' },
        },
      ])
      expect(result).toEqual({
        id: 'comment-1',
        comment: 'New comment',
        createdAt: '2026-05-14T09:00:00.000Z',
      })
    })

    test('handles empty comment', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-2',
              taskId: 'task-1',
              userId: 'user-1',
              content: '',
              createdAt: '2026-05-14T09:00:00.000Z',
              updatedAt: '2026-05-14T09:00:00.000Z',
              user: { name: 'Test User', image: null },
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', '')

      expect(result.comment).toBe('')
      expect(result.id).toBe('comment-2')
      expect(result.createdAt).toBe('2026-05-14T09:00:00.000Z')
    })

    test('handles long comment', async () => {
      const longComment = 'a'.repeat(1000)
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-3',
              taskId: 'task-1',
              userId: 'user-1',
              content: longComment,
              createdAt: '2026-05-14T09:00:00.000Z',
              updatedAt: '2026-05-14T09:00:00.000Z',
              user: { name: 'Test User', image: null },
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', longComment)

      expect(result.comment).toBe(longComment)
      expect(result.id).toBe('comment-3')
      expect(result.createdAt).toBe('2026-05-14T09:00:00.000Z')
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
    test('lists comments through GET /comment/{taskId}', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'comment-1',
                taskId: 'task-1',
                userId: 'user-1',
                content: 'First',
                createdAt: '2026-05-14T09:00:00.000Z',
                updatedAt: '2026-05-14T09:00:00.000Z',
                user: { name: 'Test User', image: null },
              },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toEqual([{ id: 'comment-1', comment: 'First', createdAt: '2026-05-14T09:00:00.000Z' }])
    })

    test('maps listed comments to simplified structure', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'comment-2',
                taskId: 'task-1',
                userId: 'user-1',
                content: 'Test',
                createdAt: '2026-03-01T12:00:00.000Z',
                updatedAt: '2026-03-01T12:00:00.000Z',
                user: { name: 'Test User', image: null },
              },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result[0]).toMatchObject({
        id: 'comment-2',
        comment: 'Test',
        createdAt: '2026-03-01T12:00:00.000Z',
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
    test('updates comment through PUT /comment/{id}', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []

      setMockFetch((url, options) => {
        requests.push({
          url,
          method: options.method ?? 'GET',
          body: parseRequestBody(options),
        })

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              taskId: 'task-1',
              userId: 'user-1',
              content: 'Updated text',
              createdAt: '2026-05-14T09:00:00.000Z',
              updatedAt: '2026-05-14T10:00:00.000Z',
              user: { name: 'Test User', image: null },
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.update('task-1', 'comment-1', 'Updated text')

      expect(requests[0]).toMatchObject({
        url: 'https://api.test.com/api/comment/comment-1',
        method: 'PUT',
        body: { content: 'Updated text' },
      })
      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('Updated text')
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
    test('removes comment through DELETE /comment/{id}', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []

      setMockFetch((url, options) => {
        requests.push({
          url,
          method: options.method ?? 'GET',
          body: parseRequestBody(options),
        })

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              taskId: 'task-1',
              userId: 'user-1',
              content: 'To be deleted',
              createdAt: '2026-05-14T09:00:00.000Z',
              updatedAt: '2026-05-14T09:00:00.000Z',
              user: { name: 'Test User', image: null },
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.remove('comment-1')

      expect(requests).toEqual([
        {
          url: 'https://api.test.com/api/comment/comment-1',
          method: 'DELETE',
          body: undefined,
        },
      ])
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
