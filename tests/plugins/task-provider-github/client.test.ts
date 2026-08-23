// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import type { ProviderRequestObservation } from '../../../src/analytics/provider-observer.js'
import type { AnalyticsRequestContext } from '../../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  ProviderScopeMissingError,
  runWithoutProviderRequestScope,
  runWithProviderRequestScope,
} from '../../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../../src/analytics/source-facts.js'
import { createTrackedLoggerMock } from '../../utils/logger-mock.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const tracked = createTrackedLoggerMock()
void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

const { githubFetch, githubPaginate, GitHubApiError, isRateLimitedError, readErrorBody } =
  await import('../../../plugins/task-provider-github/client.js')

const CANARY_URL = 'canary-host.example'
const CANARY_PATH = '/repos/octocat/Hello-World/issues/1347'
const CANARY_QUERY = 'canary-query-value'
const CANARY_TOKEN = 'canary-bearer-token'
const CANARY_BODY = 'canary-body-content'
const CANARY_ERROR = 'canary-error-body'

const config = { baseUrl: `https://${CANARY_URL}`, repo: 'octocat/Hello-World', token: CANARY_TOKEN }

const makeSource = (): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: 'ti-1',
  // GitHub maps onto the analytics enum's catch-all bucket: taskProvider is a
  // closed, versioned analytics dimension (kaneo|youtrack|none|other).
  taskProvider: 'other',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
})

type Recorder = Readonly<{
  observations: ProviderRequestObservation[]
  contexts: AnalyticsRequestContext[]
  observe: (ctx: AnalyticsRequestContext, observation: ProviderRequestObservation) => void
}>

const createRecorder = (): Recorder => {
  const observations: ProviderRequestObservation[] = []
  const contexts: AnalyticsRequestContext[] = []
  return {
    observations,
    contexts,
    observe: (ctx, observation) => {
      contexts.push(ctx)
      observations.push(observation)
    },
  }
}

const actorScopeOf = (recorder: Recorder): ReturnType<typeof createActorProviderRequestScope> =>
  createActorProviderRequestScope({
    requestContext: { source: makeSource(), sourceEventId: 'turn-1:test' },
    observeProviderRequest: recorder.observe,
  })

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const serializedLogs = (): string => JSON.stringify(tracked.getCalls())
const serializedObservations = (recorder: Recorder): string => JSON.stringify(recorder.observations)

type CapturedRequest = Readonly<{
  url: string
  method: string
  headers: Record<string, string>
  body: BodyInit | null | undefined
}>

const captureRequests =
  (sink: CapturedRequest[], respond: () => Response) =>
  (url: string, init: RequestInit): Promise<Response> => {
    sink.push({
      url,
      method: init.method ?? '',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body,
    })
    return Promise.resolve(respond())
  }

afterEach(() => {
  restoreFetch()
  tracked.clearCalls()
})

describe('githubFetch request shape', () => {
  test('sends bearer auth, GitHub accept, and api-version headers on GET without Content-Type', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => jsonResponse({ id: 1 })))
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH, { query: { q: CANARY_QUERY } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
    // Headers-iteration normalizes names to lowercase; casing is not semantic.
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${CANARY_TOKEN}`)
    expect(calls[0]?.headers['accept']).toBe('application/vnd.github+json')
    expect(calls[0]?.headers['x-github-api-version']).toBe('2022-11-28')
    expect(calls[0]?.headers['content-type']).toBeUndefined()
    expect(calls[0]?.url).toBe(`https://${CANARY_URL}${CANARY_PATH}?q=${CANARY_QUERY}`)
  })

  test('adds Content-Type only when a body is sent', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => jsonResponse({ number: 1 }, 201)))
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'POST', '/repos/octocat/Hello-World/issues', { body: { title: CANARY_BODY } }),
    )
    expect(calls[0]?.headers['content-type']).toBe('application/json')
    expect(calls[0]?.body).toBe(JSON.stringify({ title: CANARY_BODY }))
  })

  test('defaults to https://api.github.com when baseUrl is empty', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(jsonResponse([]))
    })
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch({ baseUrl: '', repo: 'o/r', token: CANARY_TOKEN }, 'GET', CANARY_PATH),
    )
    expect(urls[0]).toBe(`https://api.github.com${CANARY_PATH}`)
  })

  test('strips trailing slashes from the baseUrl', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(jsonResponse([]))
    })
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch({ baseUrl: 'https://api.github.com///', repo: 'o/r', token: CANARY_TOKEN }, 'GET', '/repos/o/r'),
    )
    expect(urls[0]).toBe('https://api.github.com/repos/o/r')
  })

  test('joins the path onto a GHES subpath baseUrl without dropping it', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(jsonResponse([]))
    })
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(
        { baseUrl: 'https://ghes.example.com/api/v3/', repo: 'o/r', token: CANARY_TOKEN },
        'GET',
        '/repos/o/r',
      ),
    )
    expect(urls[0]).toBe('https://ghes.example.com/api/v3/repos/o/r')
  })
})

describe('GitHubApiError', () => {
  test('carries statusCode, headers, and parsed body', async () => {
    setMockFetch(() =>
      Promise.resolve(
        jsonResponse({ message: CANARY_ERROR, documentation_url: 'https://docs.example' }, 404, {
          'x-ratelimit-remaining': '56',
        }),
      ),
    )
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(caught.statusCode).toBe(404)
    expect(caught.headers.get('x-ratelimit-remaining')).toBe('56')
    expect(caught.body).toEqual({ message: CANARY_ERROR, documentation_url: 'https://docs.example' })
    expect(caught.message).not.toContain(CANARY_ERROR)
    expect(caught.message).not.toContain(CANARY_PATH)
  })

  test('token never appears in logged or stringified output', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 500)))
    const caught = await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      githubFetch(config, 'POST', CANARY_PATH, { body: { title: CANARY_BODY } }).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(serializedLogs()).not.toContain(CANARY_TOKEN)
    expect(serializedLogs()).not.toContain(CANARY_BODY)
    expect(serializedLogs()).not.toContain(CANARY_PATH)
    expect(serializedObservations(recorder)).not.toContain(CANARY_TOKEN)
    expect(JSON.stringify(caught)).not.toContain(CANARY_TOKEN)
    expect(`${caught}`).not.toContain(CANARY_TOKEN)
  })
})

describe('readErrorBody', () => {
  test('parses a JSON error body', async () => {
    const body = await readErrorBody(jsonResponse({ message: 'nope' }, 422))
    expect(body).toEqual({ message: 'nope' })
  })

  test('falls back to text when the body is not JSON', async () => {
    const body = await readErrorBody(new Response(CANARY_ERROR, { status: 502 }))
    expect(body).toBe(CANARY_ERROR)
  })

  test('returns null when the body cannot be read at all', async () => {
    const response = new Response('{"a":1}', { status: 500 })
    response.text = (): Promise<string> => Promise.reject(new Error('unusable'))
    const body = await readErrorBody(response)
    expect(body).toBeNull()
  })
})

describe('githubPaginate', () => {
  const numberPage = (data: unknown): number[] => z.array(z.number()).parse(data)
  const searchItemsPage = (data: unknown): Array<{ number: number }> => {
    if (typeof data !== 'object' || data === null || !('items' in data)) return []
    const items: unknown = data.items
    if (!Array.isArray(items)) return []
    return items.filter(
      (item): item is { number: number } => typeof item === 'object' && item !== null && 'number' in item,
    )
  }
  const statusPageResponder =
    (pages: ReadonlyArray<Readonly<{ body: unknown; status: number }>>) =>
    (call: number): { body: unknown; status: number } =>
      pages[call] ?? { body: [], status: 200 }
  const endsAtUnprocessableEntity = (error: unknown): boolean =>
    error instanceof GitHubApiError && error.statusCode === 422

  test('aggregates full pages until a short page, sending page and per_page each time', async () => {
    const urls: string[] = []
    let call = 0
    // two full pages of perPage 2, then a short page that stops pagination
    const pages: number[][] = [[1, 2], [3, 4], [5]]
    setMockFetch((url) => {
      call += 1
      urls.push(url)
      return Promise.resolve(jsonResponse(pages[call - 1]))
    })
    const items = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/repos/octocat/Hello-World/issues', { perPage: 2, extractPage: numberPage }),
    )
    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(urls).toHaveLength(3)
    expect(urls[0]?.endsWith('/repos/octocat/Hello-World/issues?page=1&per_page=2')).toBe(true)
    expect(urls[1]?.endsWith('page=2&per_page=2')).toBe(true)
    expect(urls[2]?.endsWith('page=3&per_page=2')).toBe(true)
  })

  test('stops on an empty page', async () => {
    let call = 0
    const pages: number[][] = [[1, 2], []]
    setMockFetch(() => {
      call += 1
      return Promise.resolve(jsonResponse(pages[call - 1]))
    })
    const items = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/repos/o/r/issues', { perPage: 2, extractPage: numberPage }),
    )
    expect(items).toEqual([1, 2])
    expect(call).toBe(2)
  })

  test('merges extra query params with the pagination keys', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(jsonResponse([]))
    })
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/repos/o/r/issues', { perPage: 100, query: { state: 'open' }, extractPage: numberPage }),
    )
    expect(urls[0]?.endsWith('/repos/o/r/issues?state=open&page=1&per_page=100')).toBe(true)
  })

  test('extracts items through the supplied extractor (search items shape)', async () => {
    let call = 0
    const pages = [{ items: [{ number: 1 }] }, { items: [] }]
    setMockFetch(() => {
      call += 1
      return Promise.resolve(jsonResponse(pages[call - 1]))
    })
    const items = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/search/issues', { perPage: 1, extractPage: searchItemsPage }),
    )
    expect(items).toEqual([{ number: 1 }])
  })

  test('stops and trims once maxItems is collected', async () => {
    let call = 0
    const pages: number[][] = [[1, 2], [3, 4], [5]]
    setMockFetch(() => {
      call += 1
      return Promise.resolve(jsonResponse(pages[call - 1]))
    })
    const items = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/repos/o/r/issues', { perPage: 2, maxItems: 3, extractPage: numberPage }),
    )
    expect(items).toEqual([1, 2, 3])
    expect(call).toBe(2)
  })

  test('isEndOfResults keeps accumulated items instead of failing pagination', async () => {
    let call = 0
    const respond = statusPageResponder([
      { body: [1, 2], status: 200 },
      { body: { message: 'Only the first 1000 search results are available' }, status: 422 },
    ])
    setMockFetch(() => {
      const current = call
      call += 1
      const page = respond(current)
      return Promise.resolve(jsonResponse(page.body, page.status))
    })
    const items = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/search/issues', {
        perPage: 2,
        extractPage: numberPage,
        isEndOfResults: endsAtUnprocessableEntity,
      }),
    )
    expect(items).toEqual([1, 2])
    expect(call).toBe(2)
  })

  test('a non-matching error still fails pagination despite isEndOfResults', async () => {
    let call = 0
    const respond = statusPageResponder([
      { body: [1, 2], status: 200 },
      { body: { message: 'boom' }, status: 500 },
    ])
    setMockFetch(() => {
      const current = call
      call += 1
      const page = respond(current)
      return Promise.resolve(jsonResponse(page.body, page.status))
    })
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubPaginate(config, '/repos/o/r/issues', {
        perPage: 2,
        extractPage: numberPage,
        isEndOfResults: endsAtUnprocessableEntity,
      }).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(caught.statusCode).toBe(500)
  })
})

describe('rate-limit detection', () => {
  const rateLimitedFetch = (status: number, headers: Record<string, string>) => (): Promise<Response> =>
    Promise.resolve(jsonResponse({ message: CANARY_ERROR }, status, headers))

  test('a 429 is classifiable as rate-limited', async () => {
    setMockFetch(rateLimitedFetch(429, {}))
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    assert.ok(caught instanceof GitHubApiError)
    expect(isRateLimitedError(caught)).toBe(true)
  })

  test('a 403 with x-ratelimit-remaining: 0 is classifiable as rate-limited', async () => {
    setMockFetch(rateLimitedFetch(403, { 'x-ratelimit-remaining': '0' }))
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    assert.ok(caught instanceof GitHubApiError)
    expect(isRateLimitedError(caught)).toBe(true)
  })

  test('a Retry-After header marks the error rate-limited regardless of status', async () => {
    setMockFetch(rateLimitedFetch(403, { 'Retry-After': '60' }))
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(isRateLimitedError(caught)).toBe(true)
  })

  test('an x-ratelimit-reset header alone does not mark the error rate-limited', async () => {
    // GitHub returns the x-ratelimit-* trio on every response; the reset
    // header's presence must not collapse other classifications.
    setMockFetch(rateLimitedFetch(403, { 'x-ratelimit-reset': '1697066540', 'x-ratelimit-remaining': '56' }))
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(isRateLimitedError(caught)).toBe(false)
  })

  test('a plain 403 without rate-limit headers is not rate-limited (auth failure shape)', async () => {
    setMockFetch(rateLimitedFetch(403, {}))
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(isRateLimitedError(caught)).toBe(false)
  })

  test('a 403 with a nonzero x-ratelimit-remaining is not rate-limited', async () => {
    setMockFetch(rateLimitedFetch(403, { 'x-ratelimit-remaining': '56' }))
    const caught = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof GitHubApiError)
    expect(isRateLimitedError(caught)).toBe(false)
  })

  test('non-GitHubApiError values are not rate-limited', () => {
    expect(isRateLimitedError(new Error('nope'))).toBe(false)
    expect(isRateLimitedError(null)).toBe(false)
  })
})

describe('githubFetch boundary observation', () => {
  test('observes a successful request with provider github', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 1 })))
    await runWithProviderRequestScope(actorScopeOf(recorder), async () => {
      await githubFetch(config, 'GET', CANARY_PATH)
    })
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      // The analytics provider dimension is a closed enum (kaneo|youtrack|magi|
      // mcp|llm|other); github rides the catch-all bucket until the versioned
      // catalog gains a github value through review.
      provider: 'other',
      operation: 'read',
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    })
    expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    expect(serializedObservations(recorder)).not.toContain(CANARY_PATH)
    expect(serializedLogs()).not.toContain(CANARY_PATH)
    expect(serializedLogs()).not.toContain(CANARY_TOKEN)
    expect(serializedLogs()).not.toContain(CANARY_URL)
  })

  test('observes a 404 failure without leaking path or error body into logs', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 404)))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      githubFetch(config, 'GET', CANARY_PATH).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: '4xx', retryable: false })
    expect(serializedLogs()).not.toContain(CANARY_PATH)
    expect(serializedLogs()).not.toContain(CANARY_ERROR)
  })

  test('observes a 500 failure as retryable 5xx', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(new Response(CANARY_ERROR, { status: 500 })))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      githubFetch(config, 'POST', CANARY_PATH, { body: { title: CANARY_BODY } }).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({
      operation: 'create',
      outcome: 'failure',
      statusClass: '5xx',
      retryable: true,
    })
    expect(serializedLogs()).not.toContain(CANARY_ERROR)
    expect(serializedLogs()).not.toContain(CANARY_BODY)
  })

  test('observes a network failure with the network class', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.reject(new TypeError('fetch failed')))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      githubFetch(config, 'GET', CANARY_PATH).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'network', retryable: true })
    expect(serializedLogs()).not.toContain(CANARY_PATH)
  })

  test('observes an auth failure with the auth class', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 401)))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      githubFetch(config, 'GET', CANARY_PATH).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'auth', retryable: false })
  })

  test('a throwing observation callback never changes provider behavior', async () => {
    const scope = createActorProviderRequestScope({
      requestContext: { source: makeSource(), sourceEventId: 'turn-1:test' },
      observeProviderRequest: () => {
        throw new Error('observer exploded')
      },
    })
    setMockFetch(() => Promise.resolve(jsonResponse({ ok: true })))
    const result = await runWithProviderRequestScope(scope, () => githubFetch(config, 'GET', CANARY_PATH))
    expect(result).toEqual({ ok: true })
  })

  test('NO_ANALYTICS_SCOPE permits the request without observation', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ ok: true })))
    setMockFetch(fetchMock)
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => githubFetch(config, 'GET', CANARY_PATH))
    expect(fetchMock).toHaveBeenCalled()
  })

  test('an omitted scope fails before any fetch I/O', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ ok: true })))
    setMockFetch(fetchMock)
    await runWithoutProviderRequestScope(async () => {
      await expect(githubFetch(config, 'GET', CANARY_PATH)).rejects.toThrow(ProviderScopeMissingError)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
