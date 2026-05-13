import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { ProjectResource } from './test-resources.js'

// ---------------------------------------------------------------------------
// Helpers defined outside test blocks
// ---------------------------------------------------------------------------

function parseBody(body: unknown): unknown {
  return typeof body === 'string' ? JSON.parse(body) : undefined
}

/** Captures request body only when the method matches; always returns a fixed project response. */
function makeCaptureOnMethodFetch(
  method: string,
  captured: { value: unknown },
  responseBody: object,
): (_url: string, options: RequestInit) => Promise<Response> {
  return (_url: string, options: RequestInit): Promise<Response> => {
    if (options.method === method) {
      captured.value = parseBody(options.body)
    }
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }))
  }
}

/** Captures body on every call; always returns a fixed project response. */
function makeCaptureAlwaysFetch(
  captured: { value: unknown },
  responseBody: object,
): (_url: string, options: RequestInit) => Promise<Response> {
  return (_url: string, options: RequestInit): Promise<Response> => {
    captured.value = parseBody(options.body)
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }))
  }
}

/**
 * Tracks call count; captures url/body on the non-POST (PUT/PATCH) call.
 * Returns the provided response body on every call.
 */
function makeCountingNonPostFetch(
  callCounter: { count: number },
  lastCapture: { url: string | undefined; body: unknown },
  responseBody: object,
): (url: string, options: RequestInit) => Promise<Response> {
  return (url: string, options: RequestInit): Promise<Response> => {
    callCounter.count++
    recordIfNotPost(url, options, lastCapture)
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }))
  }
}

function recordIfNotPost(
  url: string,
  options: RequestInit,
  lastCapture: { url: string | undefined; body: unknown },
): void {
  const isPost = options.method === 'POST'
  if (!isPost) {
    lastCapture.url = url
    lastCapture.body = parseBody(options.body)
  }
}

/**
 * Counts calls and captures body on PUT; returns a fixed response on every call.
 */
function makeCountingCapturePutFetch(
  callCounter: { count: number },
  captured: { value: unknown },
  responseBody: object,
): (_url: string, options: RequestInit) => Promise<Response> {
  return (_url: string, options: RequestInit): Promise<Response> => {
    callCounter.count++
    captureIfPut(options, captured)
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }))
  }
}

function captureIfPut(options: RequestInit, captured: { value: unknown }): void {
  if (options.method === 'PUT') {
    captured.value = parseBody(options.body)
  }
}

// ---------------------------------------------------------------------------

describe('ProjectResource', () => {
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
    test('creates project with required fields', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'My Project',
              slug: 'my-project',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new ProjectResource(mockConfig)
      const result = await resource.create({
        workspaceId: 'ws-1',
        name: 'My Project',
      })

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('My Project')
      expect(result.slug).toBe('my-project')
    })

    test('auto-generates slug from name', async () => {
      const captured = { value: undefined as unknown }
      setMockFetch(makeCaptureOnMethodFetch('POST', captured, { id: 'proj-1', name: 'My Project', slug: 'my-project' }))

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'My Project',
      })

      expect(captured.value).toMatchObject({ slug: 'my-project' })
    })

    test('generates slug with special characters', async () => {
      const captured = { value: undefined as unknown }
      setMockFetch(
        makeCaptureOnMethodFetch('POST', captured, {
          id: 'proj-1',
          name: 'My Project @ Test!',
          slug: 'my-project-test',
        }),
      )

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'My Project @ Test!',
      })

      expect(captured.value).toMatchObject({ slug: 'my-project-test' })
    })

    test('includes workspaceId and empty icon in request', async () => {
      const captured = { value: undefined as unknown }
      setMockFetch(makeCaptureAlwaysFetch(captured, { id: 'proj-1', name: 'Test', slug: 'test' }))

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'Test',
      })

      expect(captured.value).toMatchObject({
        name: 'Test',
        workspaceId: 'ws-1',
        icon: '',
      })
    })

    test('updates description in separate call', async () => {
      const callCounter = { count: 0 }
      const lastCapture = { url: undefined as string | undefined, body: undefined as unknown }

      setMockFetch(
        makeCountingNonPostFetch(callCounter, lastCapture, {
          id: 'proj-1',
          name: 'Test Project',
          slug: 'test-project',
        }),
      )

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'Test Project',
        description: 'Project description',
      })

      expect(callCounter.count).toBe(2)
      expect(lastCapture.url).toContain('/project/proj-1')
      expect(lastCapture.body).toMatchObject({
        name: 'Test Project',
        icon: '',
        slug: 'test-project',
        description: 'Project description',
        isPublic: false,
      })
    })

    test('creates project without description (no second call)', async () => {
      let callCount = 0

      setMockFetch(() => {
        callCount++
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              slug: 'test',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'Test',
      })

      expect(callCount).toBe(1)
    })

    test('throws on API error during creation', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.create({
        workspaceId: 'ws-1',
        name: 'Test',
      })
      await expect(promise).rejects.toThrow()
    })
  })

  describe('list', () => {
    test('returns all projects for workspace', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'proj-1', name: 'Project 1', slug: 'project-1' },
              { id: 'proj-2', name: 'Project 2', slug: 'project-2' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ProjectResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Project 1')
      expect(result[1]?.name).toBe('Project 2')
    })

    test('returns empty array when no projects', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const resource = new ProjectResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(0)
    })

    test('includes workspaceId in query params', async () => {
      let requestUrl: string | undefined
      setMockFetch((url) => {
        requestUrl = url
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      })

      const resource = new ProjectResource(mockConfig)
      await resource.list('ws-1')

      expect(requestUrl).toContain('workspaceId=ws-1')
    })

    test('throws on API error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.list('ws-1')
      await expect(promise).rejects.toThrow()
    })
  })

  describe('update', () => {
    test('updates only name', async () => {
      const captured = { value: undefined as unknown }
      const callCounter = { count: 0 }
      const responseBody = {
        id: 'proj-1',
        name: 'Updated Name',
        slug: 'old-slug',
        icon: 'Layout',
        description: 'Old description',
        isPublic: false,
      }

      setMockFetch(makeCountingCapturePutFetch(callCounter, captured, responseBody))

      const resource = new ProjectResource(mockConfig)
      const result = await resource.update('proj-1', 'ws-1', { name: 'Updated Name' })

      expect(callCounter.count).toBe(2)
      expect(captured.value).toMatchObject({
        name: 'Updated Name',
        slug: 'old-slug',
        icon: 'Layout',
        description: 'Old description',
        isPublic: false,
      })
      expect(result.name).toBe('Updated Name')
    })

    test('updates only description', async () => {
      const captured = { value: undefined as unknown }
      setMockFetch(
        makeCaptureOnMethodFetch('PUT', captured, {
          id: 'proj-1',
          name: 'Test',
          slug: 'test',
          icon: '',
          description: 'New description',
          isPublic: false,
        }),
      )

      const resource = new ProjectResource(mockConfig)
      await resource.update('proj-1', 'ws-1', { description: 'New description' })

      expect(captured.value).toMatchObject({
        name: 'Test',
        slug: 'test',
        icon: '',
        description: 'New description',
        isPublic: false,
      })
    })

    test('updates both name and description', async () => {
      const captured = { value: undefined as unknown }
      setMockFetch(
        makeCaptureOnMethodFetch('PUT', captured, {
          id: 'proj-1',
          name: 'New Name',
          slug: 'test',
          icon: '',
          description: 'New description',
          isPublic: false,
        }),
      )

      const resource = new ProjectResource(mockConfig)
      await resource.update('proj-1', 'ws-1', { name: 'New Name', description: 'New description' })

      expect(captured.value).toMatchObject({
        name: 'New Name',
        description: 'New description',
      })
    })

    test('throws projectNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.update('invalid', 'ws-1', { name: 'Test' })
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'project-not-found' },
      })
    })
  })

  describe('delete', () => {
    test('deletes project successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      const resource = new ProjectResource(mockConfig)
      const result = await resource.delete('proj-1')

      expect(result.id).toBe('proj-1')
      expect(result.success).toBe(true)
    })

    test('throws projectNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.delete('invalid')
      await expect(promise).rejects.toMatchObject({
        appError: { code: 'project-not-found' },
      })
    })

    test('throws on API error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.delete('proj-1')
      await expect(promise).rejects.toThrow()
    })
  })
})
