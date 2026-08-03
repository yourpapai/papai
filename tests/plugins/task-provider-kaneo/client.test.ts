// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { kaneoFetch } from '../../../plugins/task-provider-kaneo/client.js'
import { KaneoApiError, KaneoValidationError } from '../../../plugins/task-provider-kaneo/errors.js'
import { TaskSchema as KaneoTaskResponseSchema } from '../../../plugins/task-provider-kaneo/schemas/create-task.js'
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

  test('uses the injected runtime fetch instead of the global transport', async () => {
    let requests = 0
    const runtimeFetch = (): Promise<Response> => {
      requests += 1
      return Promise.resolve(
        new Response(JSON.stringify(createMockTask({ id: 'runtime-task', number: 1 })), { status: 200 }),
      )
    }

    await kaneoFetch(
      { ...mockConfig, fetch: runtimeFetch },
      'GET',
      '/tasks/runtime-task',
      undefined,
      undefined,
      KaneoTaskResponseSchema,
    )

    expect(requests).toBe(1)
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

describe('kaneoFetch boundary observation', () => {
  const CANARY_PATH = '/tasks/canary-task-1'
  const CANARY_BODY = 'canary-kaneo-body'
  const CANARY_ERROR = 'canary-kaneo-error-body'
  const CANARY_KEY = 'canary-api-key'
  const config = { apiKey: CANARY_KEY, baseUrl: 'https://kaneo.canary.example' }

  const makeSource = (): import('../../../src/analytics/source-facts.js').AnalyticsSourceContext => ({
    platform: 'telegram',
    platformInstanceId: 'pi-1',
    chatUserId: 'user-1',
    nativeContextId: 'chat-1',
    storageContextId: 'pi-1:chat-1',
    configContextId: 'pi-1:chat-1',
    contextType: 'dm',
    actorRole: 'member',
    taskInstanceId: 'ti-1',
    taskProvider: 'kaneo',
    invocationMode: 'normal',
    rawTurnId: 'turn-1',
  })

  type ProviderObservation = import('../../../src/analytics/provider-observer.js').ProviderRequestObservation
  type ProviderContext = import('../../../src/analytics/provider-observer.js').AnalyticsRequestContext
  const createRecorder = (): {
    observations: ProviderObservation[]
    observe: (ctx: ProviderContext, observation: ProviderObservation) => void
  } => {
    const observations: import('../../../src/analytics/provider-observer.js').ProviderRequestObservation[] = []
    return {
      observations,
      observe: (
        _ctx: import('../../../src/analytics/provider-observer.js').AnalyticsRequestContext,
        observation: import('../../../src/analytics/provider-observer.js').ProviderRequestObservation,
      ): void => {
        observations.push(observation)
      },
    }
  }

  const actorScopeOf = async (
    recorder: ReturnType<typeof createRecorder>,
  ): Promise<ReturnType<typeof createActorProviderRequestScope>> => {
    const { createActorProviderRequestScope } = await import('../../../src/analytics/provider-request-scope.js')
    return createActorProviderRequestScope({
      requestContext: { source: makeSource(), sourceEventId: 'turn-1:test' },
      observeProviderRequest: recorder.observe,
    })
  }

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  afterEach(() => {
    restoreFetch()
  })

  test('observes success and failure with controlled fields; no canary in observation or error text', async () => {
    const { runWithProviderRequestScope } = await import('../../../src/analytics/provider-request-scope.js')
    const recorder = createRecorder()
    const scope = await actorScopeOf(recorder)

    setMockFetch(() => Promise.resolve(jsonResponse(createMockTask({ id: '1', number: 1 }))))
    await runWithProviderRequestScope(scope, () =>
      kaneoFetch(config, 'GET', CANARY_PATH, undefined, {}, KaneoTaskResponseSchema),
    )
    expect(recorder.observations[0]).toMatchObject({
      provider: 'kaneo',
      operation: 'read',
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    })

    setMockFetch(() => Promise.resolve(new Response(CANARY_ERROR, { status: 500 })))
    const caught = await runWithProviderRequestScope(scope, () =>
      kaneoFetch(config, 'POST', CANARY_PATH, { title: CANARY_BODY }, {}, EmptyResponseSchema).catch(
        (error: unknown) => error,
      ),
    )
    assert(caught instanceof KaneoApiError)
    expect(caught.message).not.toContain(CANARY_PATH)
    expect(caught.message).not.toContain(CANARY_ERROR)
    expect(recorder.observations[1]).toMatchObject({
      provider: 'kaneo',
      operation: 'create',
      outcome: 'failure',
      statusClass: '5xx',
      retryable: true,
    })
    expect(JSON.stringify(recorder.observations)).not.toContain(CANARY_PATH)
    expect(JSON.stringify(recorder.observations)).not.toContain(CANARY_KEY)
    expect(JSON.stringify(recorder.observations)).not.toContain('kaneo.canary.example')
  })

  test('observes validation failures without leaking validation details or body', async () => {
    const { runWithProviderRequestScope } = await import('../../../src/analytics/provider-request-scope.js')
    const recorder = createRecorder()
    const scope = await actorScopeOf(recorder)
    setMockFetch(() => Promise.resolve(jsonResponse({ unexpected: CANARY_BODY })))
    const caught = await runWithProviderRequestScope(scope, () =>
      kaneoFetch(config, 'GET', CANARY_PATH, undefined, {}, KaneoTaskResponseSchema).catch((error: unknown) => error),
    )
    assert(caught instanceof KaneoValidationError)
    expect(caught.message).not.toContain(CANARY_PATH)
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'other' })
  })

  test('omitted scope fails before fetch; NO_ANALYTICS_SCOPE fetches without observation', async () => {
    const {
      NO_ANALYTICS_SCOPE,
      ProviderScopeMissingError,
      runWithoutProviderRequestScope,
      runWithProviderRequestScope,
    } = await import('../../../src/analytics/provider-request-scope.js')
    const fetchMock = mock(() => Promise.resolve(jsonResponse(createMockTask({ id: '1', number: 1 }))))
    setMockFetch(fetchMock)
    await runWithoutProviderRequestScope(async () => {
      await expect(kaneoFetch(config, 'GET', CANARY_PATH, undefined, {}, KaneoTaskResponseSchema)).rejects.toThrow(
        ProviderScopeMissingError,
      )
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      kaneoFetch(config, 'GET', CANARY_PATH, undefined, {}, KaneoTaskResponseSchema),
    )
    expect(fetchMock).toHaveBeenCalled()
  })
})
