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
      let callCount = 0
      setMockFetch(() => {
        callCount += 1

        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'label-1', name: 'bug', color: '#ff0000', taskId: 'task-1' }), {
              status: 200,
            }),
          )
        }

        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
      })

      const resource = new LabelResource(mockConfig)
      const result = await resource.remove('label-1')

      expect(result.id).toBe('label-1')
      expect(result.success).toBe(true)
    })

    test('rejects deleting unattached workspace labels', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'bug', color: '#ff0000', taskId: null }), { status: 200 }),
        ),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.remove('label-1')
      await expect(promise).rejects.toHaveProperty('appError.code', 'unsupported-operation')
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
    test('attaches an existing label to a task', async () => {
      const requests: Array<{ url: string; method: string; body: unknown }> = []
      setMockFetch((url, options) => {
        requests.push({
          url,
          method: options.method ?? 'GET',
          body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
        })

        return Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'bug', color: '#ff0000', taskId: 'task-1' }), {
            status: 200,
          }),
        )
      })

      const resource = new LabelResource(mockConfig)
      const result = await resource.addToTask('task-1', 'label-1', 'ws-1')

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        url: 'https://api.test.com/api/label/label-1/task',
        method: 'PUT',
        body: { taskId: 'task-1' },
      })
      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('throws labelNotFound when label does not exist', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.addToTask('task-1', 'invalid-label', 'ws-1')
      await expect(promise).rejects.toHaveProperty('appError.code', 'label-not-found')
    })

    test('sends only taskId when attaching a label', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = parseBodyIfPut(options)

        return Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'urgent', color: '#ff0000', taskId: 'task-1' }), {
            status: 200,
          }),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.addToTask('task-1', 'label-1', 'ws-1')

      expect(capturedBody).toEqual({ taskId: 'task-1' })
    })
  })

  describe('removeFromTask', () => {
    test('detaches a label from a task by label id', async () => {
      const requests: Array<{ url: string; method: string; body: unknown }> = []
      setMockFetch((url, options) => {
        requests.push({
          url,
          method: options.method ?? 'GET',
          body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
        })

        return Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'bug', color: '#ff0000', taskId: null }), { status: 200 }),
        )
      })

      const resource = new LabelResource(mockConfig)
      const result = await resource.removeFromTask('task-1', 'label-1')

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        url: 'https://api.test.com/api/label/label-1/task',
        method: 'DELETE',
        body: { taskId: 'task-1' },
      })
      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
      expect(result.success).toBe(true)
    })

    test('throws when label is not found', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })))

      const resource = new LabelResource(mockConfig)
      const promise = resource.removeFromTask('task-1', 'invalid-label')
      await expect(promise).rejects.toHaveProperty('appError.code', 'label-not-found')
    })
  })
})
