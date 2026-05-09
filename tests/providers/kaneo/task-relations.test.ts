import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { createMockTask, mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { TaskResource } from './test-resources.js'

interface UpdateDescriptionBody {
  description: string
}

function isUpdateDescriptionBody(value: unknown): value is UpdateDescriptionBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'description' in value &&
    typeof (value as Record<string, unknown>)['description'] === 'string'
  )
}

function parseBody(options: RequestInit): unknown {
  if (typeof options.body === 'string') {
    return JSON.parse(options.body)
  }
  return undefined
}

function makeOkResponse(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
}

function makeNotFoundResponse(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 }))
}

function make500Response(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 }))
}

// ---------------------------------------------------------------------------
// Shared fetch routers (defined outside test/describe blocks per lint policy)
// ---------------------------------------------------------------------------

type OnPut = (body: unknown) => void

function makeAddRelationRouter(
  taskBase: ReturnType<typeof createMockTask>,
  relatedTaskBase: ReturnType<typeof createMockTask>,
  sourceDescription: string,
  onPut: OnPut,
) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-2') && method === 'GET') {
      return makeOkResponse(relatedTaskBase)
    }
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: sourceDescription })
    }
    if (url.includes('/task/description/task-1') && method === 'PUT') {
      onPut(parseBody(options))
      return makeOkResponse(taskBase)
    }
    return makeOkResponse({})
  }
}

function makeAddRelationCountingRouter(
  taskBase: ReturnType<typeof createMockTask>,
  relatedTaskBase: ReturnType<typeof createMockTask>,
  onPut: OnPut,
  counter: { count: number },
) {
  return (url: string, options: RequestInit): Promise<Response> => {
    counter.count++
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-2') && method === 'GET') {
      return makeOkResponse(relatedTaskBase)
    }
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: '' })
    }
    if (url.includes('/task/description/task-1') && method === 'PUT') {
      onPut(parseBody(options))
      return makeOkResponse(taskBase)
    }
    return makeOkResponse({})
  }
}

function makeAddRelationDuplicateRouter(
  taskBase: ReturnType<typeof createMockTask>,
  relatedTaskBase: ReturnType<typeof createMockTask>,
) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-2') && method === 'GET') {
      return makeOkResponse(relatedTaskBase)
    }
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: '' })
    }
    if (url.includes('/task/description/task-1')) {
      return makeOkResponse(taskBase)
    }
    return makeOkResponse({})
  }
}

function makeSourceNotFoundRouter(relatedTaskBase: ReturnType<typeof createMockTask>) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-2') && method === 'GET') {
      return makeOkResponse(relatedTaskBase)
    }
    return makeNotFoundResponse()
  }
}

function makeSelfRelationRouter(taskBase: ReturnType<typeof createMockTask>) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: '' })
    }
    if (url.includes('/task/description/task-1') && method === 'PUT') {
      return makeOkResponse(taskBase)
    }
    return makeOkResponse({})
  }
}

function makeDescriptionUpdate500Router(
  taskBase: ReturnType<typeof createMockTask>,
  relatedTaskBase: ReturnType<typeof createMockTask>,
) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-2') && method === 'GET') {
      return makeOkResponse(relatedTaskBase)
    }
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: '' })
    }
    if (url.includes('/task/description/task-1') && method === 'PUT') {
      return make500Response()
    }
    return makeOkResponse({})
  }
}

function makeRemoveRelationRouter(
  taskBase: ReturnType<typeof createMockTask>,
  sourceDescription: string,
  onPut: OnPut,
) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: sourceDescription })
    }
    if (url.includes('/task/description/task-1') && method === 'PUT') {
      onPut(parseBody(options))
      return makeOkResponse(taskBase)
    }
    return makeOkResponse({})
  }
}

function makeRemoveRelationNotFoundRouter(taskBase: ReturnType<typeof createMockTask>, sourceDescription: string) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: sourceDescription })
    }
    return makeOkResponse({})
  }
}

function makeTaskGetEmptyDescriptionRouter(taskBase: ReturnType<typeof createMockTask>) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: '' })
    }
    return makeOkResponse({})
  }
}

function makeUpdateRelationRouter(
  taskBase: ReturnType<typeof createMockTask>,
  sourceDescription: string,
  onPut: OnPut,
) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: sourceDescription })
    }
    if (url.includes('/task/description/task-1') && method === 'PUT') {
      onPut(parseBody(options))
      return makeOkResponse(taskBase)
    }
    return makeOkResponse({})
  }
}

function makeUpdateRelationNotFoundRouter(taskBase: ReturnType<typeof createMockTask>, sourceDescription: string) {
  return (url: string, options: RequestInit): Promise<Response> => {
    const method = options.method ?? 'GET'
    if (url.includes('/task/task-1') && method === 'GET') {
      return makeOkResponse({ ...taskBase, description: sourceDescription })
    }
    return makeOkResponse({})
  }
}

// ---------------------------------------------------------------------------

describe('Task Relations', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  const taskBase = createMockTask({
    id: 'task-1',
    title: 'Source Task',
    number: 1,
    description: '',
  })

  const relatedTaskBase = createMockTask({
    id: 'task-2',
    title: 'Related Task',
    number: 2,
    description: '',
  })

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('addRelation', () => {
    test('validates related task, fetches source task, then updates description', async () => {
      const counter = { count: 0 }
      let putBody: unknown

      setMockFetch(
        makeAddRelationCountingRouter(
          taskBase,
          relatedTaskBase,
          (b) => {
            putBody = b
          },
          counter,
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'blocks')

      expect(counter.count).toBe(3)
      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
      expect(putBody).toMatchObject({ description: expect.stringContaining('task-2') as unknown })
    })

    test('adds relation with type "related"', async () => {
      let putBody: unknown

      setMockFetch(
        makeAddRelationRouter(taskBase, relatedTaskBase, '', (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'related')
      expect(result.type).toBe('related')
      expect(putBody).toMatchObject({ description: expect.stringContaining('related') as unknown })
    })

    test('adds relation with type "duplicate"', async () => {
      setMockFetch(makeAddRelationDuplicateRouter(taskBase, relatedTaskBase))

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'duplicate')
      expect(result.type).toBe('duplicate')
    })

    test('throws when related task does not exist', async () => {
      setMockFetch(() => makeNotFoundResponse())

      const resource = new TaskResource(mockConfig)
      const promise = resource.addRelation('task-1', 'missing-task', 'blocks')
      await expect(promise).rejects.toThrow()
    })

    test('throws when source task does not exist', async () => {
      setMockFetch(makeSourceNotFoundRouter(relatedTaskBase))

      const resource = new TaskResource(mockConfig)
      const promise = resource.addRelation('missing-source', 'task-2', 'blocks')
      await expect(promise).rejects.toThrow()
    })

    test('appends relation to existing frontmatter', async () => {
      const descriptionWithExisting = '---\nrelated: task-3\n---\nExisting task'
      let putBody: unknown

      setMockFetch(
        makeAddRelationRouter(taskBase, relatedTaskBase, descriptionWithExisting, (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      await resource.addRelation('task-1', 'task-2', 'blocks')

      assert(isUpdateDescriptionBody(putBody))
      expect(putBody.description).toContain('task-3')
      expect(putBody.description).toContain('task-2')
    })

    test('adds relation with type "blocked_by"', async () => {
      let putBody: unknown

      setMockFetch(
        makeAddRelationRouter(taskBase, relatedTaskBase, '', (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'blocked_by')
      expect(result.type).toBe('blocked_by')
      expect(putBody).toMatchObject({ description: expect.stringContaining('blocked_by') as unknown })
    })

    test('adds relation with type "duplicate_of"', async () => {
      let putBody: unknown

      setMockFetch(
        makeAddRelationRouter(taskBase, relatedTaskBase, '', (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'duplicate_of')
      expect(result.type).toBe('duplicate_of')
      expect(putBody).toMatchObject({ description: expect.stringContaining('duplicate_of') as unknown })
    })

    test('adds relation with type "parent"', async () => {
      let putBody: unknown

      setMockFetch(
        makeAddRelationRouter(taskBase, relatedTaskBase, '', (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'parent')
      expect(result.type).toBe('parent')
      expect(putBody).toMatchObject({ description: expect.stringContaining('parent') as unknown })
    })

    test('adding self-relation (taskId === relatedTaskId) succeeds — no guard', async () => {
      setMockFetch(makeSelfRelationRouter(taskBase))

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-1', 'blocks')
      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-1')
      expect(result.type).toBe('blocks')
    })

    test('throws classified error when description update returns 500', async () => {
      setMockFetch(makeDescriptionUpdate500Router(taskBase, relatedTaskBase))

      const resource = new TaskResource(mockConfig)
      const promise = resource.addRelation('task-1', 'task-2', 'blocks')
      await expect(promise).rejects.toThrow()
    })
  })

  describe('removeRelation', () => {
    test('fetches task, finds relation, removes it', async () => {
      const descriptionWithRelation = '---\nblocks: task-2\n---\nTask body'
      let putBody: unknown

      setMockFetch(
        makeRemoveRelationRouter(taskBase, descriptionWithRelation, (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.removeRelation('task-1', 'task-2')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.success).toBe(true)
      expect(putBody).not.toMatchObject({ description: expect.stringContaining('task-2') as unknown })
    })

    test('throws relationNotFound when relation does not exist on task', async () => {
      setMockFetch(makeRemoveRelationNotFoundRouter(taskBase, '---\nrelated: task-3\n---'))

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('task-1', 'task-2')
      await expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
    })

    test('throws when task does not exist', async () => {
      setMockFetch(() => makeNotFoundResponse())

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('missing', 'task-2')
      await expect(promise).rejects.toThrow()
    })

    test('throws when task has no relations (empty description)', async () => {
      setMockFetch(makeTaskGetEmptyDescriptionRouter(taskBase))

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('task-1', 'task-2')
      await expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
    })
  })

  describe('updateRelation', () => {
    test('fetches task, finds relation, updates its type', async () => {
      const descriptionWithRelation = '---\nblocks: task-2\n---\nTask body'
      let putBody: unknown

      setMockFetch(
        makeUpdateRelationRouter(taskBase, descriptionWithRelation, (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.updateRelation('task-1', 'task-2', 'related')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('related')
      expect(putBody).toMatchObject({ description: expect.stringContaining('task-2') as unknown })
      expect(putBody).not.toMatchObject({ description: expect.stringContaining('blocks:') as unknown })
    })

    test('throws relationNotFound when relation does not exist', async () => {
      setMockFetch(makeUpdateRelationNotFoundRouter(taskBase, '---\nrelated: task-3\n---'))

      const resource = new TaskResource(mockConfig)
      const promise = resource.updateRelation('task-1', 'task-2', 'blocks')
      await expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
    })

    test('throws when task does not exist', async () => {
      setMockFetch(() => makeNotFoundResponse())

      const resource = new TaskResource(mockConfig)
      const promise = resource.updateRelation('missing', 'task-2', 'related')
      await expect(promise).rejects.toThrow()
    })

    test('updates only the matching relation when multiple relations exist', async () => {
      const descriptionWithMultiple = '---\nblocks: task-2\nrelated: task-3\n---\nBody'
      let putBody: unknown

      setMockFetch(
        makeUpdateRelationRouter(taskBase, descriptionWithMultiple, (b) => {
          putBody = b
        }),
      )

      const resource = new TaskResource(mockConfig)
      await resource.updateRelation('task-1', 'task-2', 'duplicate')

      assert(isUpdateDescriptionBody(putBody))
      expect(putBody.description).toContain('task-3')
      expect(putBody.description).toContain('task-2')
    })

    test('throws relationNotFound when task description has no frontmatter', async () => {
      setMockFetch(makeUpdateRelationNotFoundRouter(taskBase, 'Just plain text, no frontmatter'))

      const resource = new TaskResource(mockConfig)
      const promise = resource.updateRelation('task-1', 'task-2', 'related')
      await expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
    })
  })
})
