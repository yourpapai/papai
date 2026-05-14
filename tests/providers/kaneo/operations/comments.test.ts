import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../../src/providers/kaneo/client.js'
import { kaneoUpdateComment } from '../../../../src/providers/kaneo/operations/comments.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

function getRequestMethod(options: RequestInit): string {
  return options.method ?? 'GET'
}

describe('kaneo comment operations', () => {
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

  test('kaneoUpdateComment sends the comment id to the update endpoint', async () => {
    const requests: Array<{ url: string; method: string }> = []

    setMockFetch((url, options) => {
      requests.push({
        url,
        method: getRequestMethod(options),
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

    const result = await kaneoUpdateComment(mockConfig, {
      taskId: 'task-1',
      commentId: 'comment-1',
      body: 'Updated text',
    })

    expect(requests).toEqual([
      {
        url: 'https://api.test.com/api/comment/comment-1',
        method: 'PUT',
      },
    ])
    expect(result).toEqual({
      id: 'comment-1',
      body: 'Updated text',
      createdAt: '2026-05-14T09:00:00.000Z',
    })
  })
})
