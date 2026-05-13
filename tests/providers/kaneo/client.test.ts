import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { kaneoFetch } from '../../../src/providers/kaneo/client.js'
import { KaneoApiError, KaneoValidationError } from '../../../src/providers/kaneo/errors.js'
import { TaskSchema as KaneoTaskResponseSchema } from '../../../src/providers/kaneo/schemas/create-task.js'
import { restoreFetch, setMockFetch, createMockTask } from '../../utils/test-helpers.js'
import { EmptyResponseSchema } from './test-resources.js'

// Helpers defined outside test blocks to satisfy no-conditional-in-test
function headersFromOptions(options: RequestInit): Record<string, string> {
  const headers = options.headers
  if (headers === undefined || headers === null) return {}
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return Object.fromEntries(Object.entries(headers))
}

function methodFromOptions(options: RequestInit): string {
  return options.method ?? ''
}

describe('kaneoFetch', () => {
  const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('makes GET request with correct headers', async () => {
    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedHeaders = headersFromOptions(options)
      return Promise.resolve(
        new Response(JSON.stringify(createMockTask({ id: '1', number: 1 })), {
          status: 200,
        }),
      )
    })

    await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskResponseSchema)

    expect(capturedHeaders['Authorization']).toBe('Bearer test-key')
    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })

  test('throws KaneoApiError on non-ok response', async () => {
    setMockFetch(() => Promise.resolve(new Response('Not found', { status: 404 })))

    const promise = kaneoFetch(mockConfig, 'GET', '/tasks/1', undefined, {}, KaneoTaskResponseSchema)
    await expect(promise).rejects.toBeInstanceOf(KaneoApiError)
  })

  test('throws KaneoValidationError on schema mismatch', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ invalid: 'data' }), { status: 200 })))

    const promise = kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskResponseSchema)
    await expect(promise).rejects.toBeInstanceOf(KaneoValidationError)
  })

  test('handles non-JSON error response gracefully', async () => {
    setMockFetch(() => Promise.resolve(new Response('Plain text error', { status: 500 })))

    try {
      await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskResponseSchema)
    } catch (error) {
      assert(error instanceof KaneoApiError)
      expect(error.statusCode).toBe(500)
      expect(error.message).toContain('500')
    }
  })

  test('correctly encodes query parameters', async () => {
    let capturedUrl = ''
    setMockFetch((url) => {
      capturedUrl = url
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    await kaneoFetch(
      mockConfig,
      'GET',
      '/tasks',
      undefined,
      { search: 'hello world', special: 'a&b=c' },
      z.array(KaneoTaskResponseSchema),
    )

    expect(capturedUrl).toContain('search=hello+world')
    expect(capturedUrl).toContain('special=a%26b%3Dc')
  })

  test('handles DELETE with empty JSON response', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))

    const result = await kaneoFetch(mockConfig, 'DELETE', '/tasks/1', undefined, {}, EmptyResponseSchema)
    expect(result).toBeDefined()
  })

  test('sends JSON body for POST requests', async () => {
    let capturedBody: unknown
    setMockFetch((_url, options) => {
      capturedBody = options.body
      return Promise.resolve(
        new Response(JSON.stringify(createMockTask({ id: '1', title: 'New Task', number: 1 })), {
          status: 200,
        }),
      )
    })

    await kaneoFetch(mockConfig, 'POST', '/tasks', { title: 'New Task' }, {}, KaneoTaskResponseSchema)

    expect(capturedBody).toBe(JSON.stringify({ title: 'New Task' }))
  })

  test('does not send body when undefined', async () => {
    let requestBody: unknown = 'initial'
    setMockFetch((_url, options) => {
      requestBody = options.body
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, EmptyResponseSchema)

    expect(requestBody).toBeUndefined()
  })

  test('uses session cookie when provided', async () => {
    const configWithCookie = {
      ...mockConfig,
      sessionCookie: 'better-auth.session_token=abc123',
    }

    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedHeaders = headersFromOptions(options)
      return Promise.resolve(
        new Response(JSON.stringify(createMockTask({ id: '1', number: 1 })), {
          status: 200,
        }),
      )
    })

    await kaneoFetch(configWithCookie, 'GET', '/tasks', undefined, {}, KaneoTaskResponseSchema)

    expect(capturedHeaders['Cookie']).toBe('better-auth.session_token=abc123')
    expect(capturedHeaders['Authorization']).toBeUndefined()
  })

  test('POST request sends Content-Type: application/json', async () => {
    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedHeaders = headersFromOptions(options)
      return Promise.resolve(new Response(JSON.stringify(createMockTask({ id: '1', number: 1 })), { status: 200 }))
    })

    await kaneoFetch(mockConfig, 'POST', '/tasks', { title: 'Test' }, {}, KaneoTaskResponseSchema)

    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })

  test('PUT request sends correct method and headers', async () => {
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedMethod = methodFromOptions(options)
      capturedHeaders = headersFromOptions(options)
      return Promise.resolve(new Response(JSON.stringify(createMockTask({ id: '1', number: 1 })), { status: 200 }))
    })

    await kaneoFetch(mockConfig, 'PUT', '/tasks/1', { title: 'Updated' }, {}, KaneoTaskResponseSchema)

    expect(capturedMethod).toBe('PUT')
    expect(capturedHeaders['Authorization']).toBe('Bearer test-key')
    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })

  test('PATCH request sends correct method and headers', async () => {
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedMethod = methodFromOptions(options)
      capturedHeaders = headersFromOptions(options)
      return Promise.resolve(new Response(JSON.stringify(createMockTask({ id: '1', number: 1 })), { status: 200 }))
    })

    await kaneoFetch(mockConfig, 'PATCH', '/tasks/1', { title: 'Patched' }, {}, KaneoTaskResponseSchema)

    expect(capturedMethod).toBe('PATCH')
    expect(capturedHeaders['Authorization']).toBe('Bearer test-key')
    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })

  test('includes status code in KaneoApiError', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })))

    try {
      await kaneoFetch(mockConfig, 'GET', '/tasks/1', undefined, {}, KaneoTaskResponseSchema)
    } catch (error) {
      assert(error instanceof KaneoApiError)
      expect(error.statusCode).toBe(404)
      expect(error.responseBody).toEqual({ error: 'Not found' })
    }
  })

  test('throws when fetch itself throws (network failure)', async () => {
    setMockFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const promise = kaneoFetch(mockConfig, 'GET', '/test', undefined, {}, KaneoTaskResponseSchema)
    await expect(promise).rejects.toBeInstanceOf(TypeError)
    await expect(promise).rejects.toThrow('Failed to fetch')
  })

  test('throws when successful response has invalid JSON body', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const promise = kaneoFetch(mockConfig, 'GET', '/test', undefined, {}, KaneoTaskResponseSchema)
    await expect(promise).rejects.toThrow()
  })
})
