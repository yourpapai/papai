import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { addTaskRelation } from '../../../src/providers/kaneo/task-relations.js'
import { removeTaskRelation } from '../../../src/providers/kaneo/task-relations.js'
import { updateTaskRelation } from '../../../src/providers/kaneo/task-relations.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

function parseBody(options: RequestInit): unknown {
  return typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
}

function getRequestMethod(options: RequestInit): string {
  return options.method ?? 'GET'
}

function createRelationLookupFetchHandler(
  requests: Array<{ url: string; method: string; body?: unknown }>,
  relationType: 'related' | 'blocks',
  finalResponseMethod: 'DELETE' | 'POST',
): (url: string, options: RequestInit) => Promise<Response> {
  return (url, options) => {
    requests.push({
      url,
      method: getRequestMethod(options),
      body: parseBody(options),
    })

    const responseByKind: Record<'lookup' | 'final', Response> = {
      lookup: new Response(
        JSON.stringify([
          {
            id: 'rel-1',
            sourceTaskId: 'task-1',
            targetTaskId: 'task-2',
            relationType,
            createdAt: '2026-05-14T09:00:00.000Z',
          },
        ]),
        { status: 200 },
      ),
      final: new Response(
        JSON.stringify({
          id: 'rel-1',
          sourceTaskId: 'task-1',
          targetTaskId: 'task-2',
          relationType: finalResponseMethod === 'POST' ? 'blocks' : relationType,
          createdAt: '2026-05-14T09:00:00.000Z',
        }),
        { status: 200 },
      ),
    }

    return Promise.resolve(responseByKind[url.endsWith('/api/task-relation/task-1') ? 'lookup' : 'final'])
  }
}

describe('task-relations', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('adds relation through POST /task-relation with documented relationType', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []

    setMockFetch((url, options) => {
      requests.push({
        url,
        method: getRequestMethod(options),
        body: parseBody(options),
      })

      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'rel-1',
            sourceTaskId: 'task-1',
            targetTaskId: 'task-2',
            relationType: 'blocks',
            createdAt: '2026-05-14T09:00:00.000Z',
          }),
          { status: 200 },
        ),
      )
    })

    const result = await addTaskRelation(mockConfig, 'task-1', 'task-2', 'blocks')

    expect(requests[0]).toMatchObject({
      url: 'https://api.test.com/api/task-relation',
      method: 'POST',
      body: { sourceTaskId: 'task-1', targetTaskId: 'task-2', relationType: 'blocks' },
    })
    expect(result).toEqual({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' })
  })

  test('updates relation by resolving relation id, deleting it, then recreating it', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []

    setMockFetch(createRelationLookupFetchHandler(requests, 'related', 'POST'))

    const result = await updateTaskRelation(mockConfig, 'task-1', 'task-2', 'blocks')

    expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE', 'POST'])
    expect(result).toEqual({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' })
  })

  test('removes relation by looking up relation id then DELETE /task-relation/{id}', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []

    setMockFetch(createRelationLookupFetchHandler(requests, 'blocks', 'DELETE'))

    const result = await removeTaskRelation(mockConfig, 'task-1', 'task-2')

    expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE'])
    expect(requests[1]).toMatchObject({
      url: 'https://api.test.com/api/task-relation/rel-1',
      method: 'DELETE',
    })
    expect(result).toEqual({ taskId: 'task-1', relatedTaskId: 'task-2', success: true })
  })
})
