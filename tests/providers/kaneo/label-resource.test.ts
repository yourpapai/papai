import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { LabelResource } from './test-resources.js'

// ---------------------------------------------------------------------------
// Helpers (defined outside all test/describe blocks)
// ---------------------------------------------------------------------------

function parseBody(options: RequestInit): unknown {
  assert(typeof options.body === 'string')
  return JSON.parse(options.body)
}

function parseBodyIfPut(options: RequestInit): unknown {
  if (options.method !== 'PUT') return undefined
  assert(typeof options.body === 'string')
  return JSON.parse(options.body)
}

function parseBodyIfPost(options: RequestInit): unknown {
  if (options.method !== 'POST') return undefined
  assert(typeof options.body === 'string')
  return JSON.parse(options.body)
}

// Route a fetch call for addToTask tests that require GET label + POST task-label
function makeAddToTaskRouter(
  labelId: string,
  labelPayload: object,
  taskLabelPayload: object,
): (url: string, options: RequestInit) => Promise<Response> {
  return (url) => {
    if (url.includes(`/label/${labelId}`) && !url.includes('/task')) {
      return Promise.resolve(new Response(JSON.stringify(labelPayload), { status: 200 }))
    }
    if (url.includes('/label') && !url.includes(`/${labelId}`)) {
      return Promise.resolve(new Response(JSON.stringify(taskLabelPayload), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  }
}

// Route for removeFromTask "no matching name" negative test
function makeNoMatchRouter(
  wsLabelId: string,
  wsLabelPayload: object,
  taskCopies: object[],
): (url: string) => Promise<Response> {
  return (url) => {
    if (url.includes(`/label/${wsLabelId}`) && !url.includes('/task')) {
      return Promise.resolve(new Response(JSON.stringify(wsLabelPayload), { status: 200 }))
    }
    if (url.includes('/label/task/')) {
      return Promise.resolve(new Response(JSON.stringify(taskCopies), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
  }
}

// Route for addToTask "includes label details" test — captures POST body via ref
function makeAddToTaskBodyCaptureRouter(
  labelId: string,
  labelPayload: object,
  taskLabelPayload: object,
  ref: { capturedBody: unknown },
): (url: string, options: RequestInit) => Promise<Response> {
  return (url, options) => {
    if (url.includes(`/label/${labelId}`) && !url.includes('/task')) {
      return Promise.resolve(new Response(JSON.stringify(labelPayload), { status: 200 }))
    }
    ref.capturedBody = parseBodyIfPost(options)
    return Promise.resolve(new Response(JSON.stringify(taskLabelPayload), { status: 200 }))
  }
}

// Route for removeFromTask tests that also need to capture the DELETE url via ref
function makeLabelAndTaskCopyRouterWithCapture(
  wsLabelId: string,
  taskId: string,
  wsLabelPayload: object,
  taskCopies: object[],
  ref: { callCount: number; deleteUrl: string | undefined },
): (url: string, options: RequestInit) => Promise<Response> {
  return (url, options) => {
    ref.callCount++
    if (url.includes(`/label/${wsLabelId}`) && !url.includes('/task')) {
      return Promise.resolve(new Response(JSON.stringify(wsLabelPayload), { status: 200 }))
    }
    if (url.includes(`/label/task/${taskId}`)) {
      return Promise.resolve(new Response(JSON.stringify(taskCopies), { status: 200 }))
    }
    assert(options.method === 'DELETE')
    ref.deleteUrl = url
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
  }
}

describe('LabelResource', () => {
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

  describe('create', () => {
    test('creates label with required fields', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'new-label',
              color: '#6b7280',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.create({
        workspaceId: 'ws-1',
        name: 'new-label',
      })

      expect(result.id).toBe('label-1')
      expect(result.name).toBe('new-label')
    })

    test('uses default color when not provided', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = parseBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'new-label',
              color: '#6b7280',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'new-label',
      })

      expect(capturedBody).toMatchObject({ color: '#6b7280' })
    })

    test('accepts custom color', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = parseBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'urgent',
              color: '#ff0000',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'urgent',
        color: '#ff0000',
      })

      expect(capturedBody).toMatchObject({ color: '#ff0000' })
    })

    test('includes workspaceId in request', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = parseBody(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'test',
              color: '#6b7280',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'test',
      })

      expect(capturedBody).toMatchObject({ workspaceId: 'ws-1' })
    })

    test('throws on API error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.create({
        workspaceId: 'ws-1',
        name: 'test',
      })
      await expect(promise).rejects.toThrow()
    })
  })

  describe('list', () => {
    test('returns all labels for workspace', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'label-1', name: 'bug', color: '#ff0000' },
              { id: 'label-2', name: 'feature', color: '#00ff00' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('bug')
      expect(result[1]?.name).toBe('feature')
    })

    test('returns empty array when no labels', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const resource = new LabelResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(0)
    })

    test('throws on API error', async () => {
      setMockFetch(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 })),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.list('invalid-ws')
      await expect(promise).rejects.toThrow()
    })
  })

  describe('update', () => {
    test('updates only name', async () => {
      let capturedBody: unknown
      let callCount = 0
      setMockFetch((_url, options) => {
        callCount++
        capturedBody = parseBodyIfPut(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'Updated Name',
              color: '#ff0000',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      const result = await resource.update('label-1', { name: 'Updated Name' })

      expect(callCount).toBe(2)
      expect(capturedBody).toEqual({ name: 'Updated Name', color: '#ff0000' })
      expect(result.name).toBe('Updated Name')
    })

    test('updates only color', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = parseBodyIfPut(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'bug',
              color: '#00ff00',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.update('label-1', { color: '#00ff00' })

      expect(capturedBody).toEqual({ name: 'bug', color: '#00ff00' })
    })

    test('updates both name and color', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = parseBodyIfPut(options)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'New Name',
              color: '#0000ff',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.update('label-1', { name: 'New Name', color: '#0000ff' })

      expect(capturedBody).toMatchObject({
        name: 'New Name',
        color: '#0000ff',
      })
    })

    test('throws labelNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.update('invalid', { name: 'Test' })
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'label-not-found' },
      })
    })
  })

  describe('remove', () => {
    test('removes label successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      const resource = new LabelResource(mockConfig)
      const result = await resource.remove('label-1')

      expect(result.id).toBe('label-1')
      expect(result.success).toBe(true)
    })

    test('throws labelNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.remove('invalid')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'label-not-found' },
      })
    })
  })

  describe('addToTask', () => {
    test('fetches label and creates task-label', async () => {
      let callCount = 0
      const handler = makeAddToTaskRouter(
        'label-1',
        { id: 'label-1', name: 'bug', color: '#ff0000' },
        { id: 'tl-1', name: 'bug', color: '#ff0000', taskId: 'task-1' },
      )
      setMockFetch((url, options) => {
        callCount++
        return handler(url, options)
      })

      const resource = new LabelResource(mockConfig)
      const result = await resource.addToTask('task-1', 'label-1', 'ws-1')

      expect(callCount).toBe(2)
      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('throws labelNotFound when label does not exist', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.addToTask('task-1', 'invalid-label', 'ws-1')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'label-not-found' },
      })
    })

    test('includes label details in task-label creation', async () => {
      const ref = { capturedBody: undefined as unknown }
      setMockFetch(
        makeAddToTaskBodyCaptureRouter(
          'label-1',
          { id: 'label-1', name: 'urgent', color: '#ff0000' },
          { id: 'tl-1', name: 'urgent', color: '#ff0000', taskId: 'task-1' },
          ref,
        ),
      )

      const resource = new LabelResource(mockConfig)
      await resource.addToTask('task-1', 'label-1', 'ws-1')

      expect(ref.capturedBody).toMatchObject({
        name: 'urgent',
        color: '#ff0000',
        workspaceId: 'ws-1',
        taskId: 'task-1',
      })
    })
  })

  describe('removeFromTask', () => {
    test('finds task-label copy by name and deletes it', async () => {
      // Task-scoped label copies have a DIFFERENT id from the workspace label.
      // removeFromTask receives the workspace label id, fetches its name, then
      // finds the task copy by matching name.
      const ref = { callCount: 0, deleteUrl: undefined as string | undefined }

      setMockFetch(
        makeLabelAndTaskCopyRouterWithCapture(
          'ws-label-1',
          'task-1',
          { id: 'ws-label-1', name: 'bug', color: '#ff0000' },
          [
            { id: 'copy-bug-1', name: 'bug', color: '#ff0000' },
            { id: 'copy-urgent-1', name: 'urgent', color: '#ff0000' },
          ],
          ref,
        ),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.removeFromTask('task-1', 'ws-label-1')

      // 3 calls: GET workspace label, GET task labels, DELETE copy
      expect(ref.callCount).toBe(3)
      // Deletes the COPY id, not the workspace label id
      expect(ref.deleteUrl).toContain('/label/copy-bug-1')
      expect(result.taskId).toBe('task-1')
      // Returns the workspace label id passed in
      expect(result.labelId).toBe('ws-label-1')
      expect(result.success).toBe(true)
    })

    test('throws when workspace label is not found', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.removeFromTask('task-1', 'invalid-label')
      await expect(promise).rejects.toMatchObject({ appError: { code: 'label-not-found' } })
    })

    test('throws when task has no labels with matching name', async () => {
      const handler = makeNoMatchRouter('ws-label-1', { id: 'ws-label-1', name: 'bug', color: '#ff0000' }, [
        { id: 'copy-other', name: 'other', color: '#aaa' },
      ])
      setMockFetch(handler)

      const resource = new LabelResource(mockConfig)
      const promise = resource.removeFromTask('task-1', 'ws-label-1')
      await expect(promise).rejects.toThrow()
    })
  })
})
