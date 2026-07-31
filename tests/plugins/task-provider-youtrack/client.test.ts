// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

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

const { youtrackFetch, youtrackUpload, YouTrackApiError } =
  await import('../../../plugins/task-provider-youtrack/client.js')

const CANARY_URL = 'canary-host.example'
const CANARY_PATH = '/api/issues/CANARY-1'
const CANARY_QUERY = 'canary-query-value'
const CANARY_TOKEN = 'canary-bearer-token'
const CANARY_BODY = 'canary-body-content'
const CANARY_ERROR = 'canary-error-body'
const CANARY_FILENAME = 'canary-file-name.txt'

const config = { baseUrl: `https://${CANARY_URL}`, token: CANARY_TOKEN }

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
  taskProvider: 'youtrack',
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

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const serializedLogs = (): string => JSON.stringify(tracked.getCalls())
const serializedObservations = (recorder: Recorder): string => JSON.stringify(recorder.observations)

afterEach(() => {
  restoreFetch()
  tracked.clearCalls()
})

describe('youtrackFetch boundary observation', () => {
  test('observes a successful request with controlled fields only', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'x' })))
    await runWithProviderRequestScope(actorScopeOf(recorder), async () => {
      await youtrackFetch(config, 'GET', `${CANARY_PATH}?q=${CANARY_QUERY}`)
    })
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      provider: 'youtrack',
      operation: 'read',
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    })
    expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    expect(serializedObservations(recorder)).not.toContain(CANARY_PATH)
    expect(serializedLogs()).not.toContain(CANARY_PATH)
    expect(serializedLogs()).not.toContain(CANARY_QUERY)
    expect(serializedLogs()).not.toContain(CANARY_TOKEN)
    expect(serializedLogs()).not.toContain(CANARY_URL)
  })

  test('observes a 404 failure without leaking path or error body into logs or errors', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 404)))
    const caught = await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      youtrackFetch(config, 'GET', CANARY_PATH).catch((error: unknown) => error),
    )
    assert.ok(caught instanceof YouTrackApiError)
    expect(caught.message).not.toContain(CANARY_PATH)
    expect(caught.message).not.toContain(CANARY_ERROR)
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: '4xx', retryable: false })
    expect(serializedLogs()).not.toContain(CANARY_PATH)
    expect(serializedLogs()).not.toContain(CANARY_ERROR)
  })

  test('observes a 500 failure as retryable 5xx, non-JSON error body never logged', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(new Response(CANARY_ERROR, { status: 500 })))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      youtrackFetch(config, 'POST', CANARY_PATH, { body: { title: CANARY_BODY } }).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({
      provider: 'youtrack',
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
      youtrackFetch(config, 'GET', CANARY_PATH).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'network', retryable: true })
    expect(serializedLogs()).not.toContain(CANARY_PATH)
  })

  test('observes an auth failure with the auth class', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 401)))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      youtrackFetch(config, 'GET', CANARY_PATH).catch(() => undefined),
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
    const result = await runWithProviderRequestScope(scope, () => youtrackFetch(config, 'GET', CANARY_PATH))
    expect(result).toEqual({ ok: true })
  })

  test('NO_ANALYTICS_SCOPE permits the request without observation', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ ok: true })))
    setMockFetch(fetchMock)
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => youtrackFetch(config, 'GET', CANARY_PATH))
    expect(fetchMock).toHaveBeenCalled()
  })

  test('an omitted scope fails before any fetch I/O', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ ok: true })))
    setMockFetch(fetchMock)
    await runWithoutProviderRequestScope(async () => {
      await expect(youtrackFetch(config, 'GET', CANARY_PATH)).rejects.toThrow(ProviderScopeMissingError)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('youtrackUpload boundary observation', () => {
  test('observes an upload without leaking filename or bytes', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ id: 'att-1' })))
    await runWithProviderRequestScope(actorScopeOf(recorder), async () => {
      await youtrackUpload(config, CANARY_PATH, {
        name: CANARY_FILENAME,
        content: new TextEncoder().encode(CANARY_BODY),
        mimeType: 'text/plain',
      })
    })
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({ provider: 'youtrack', outcome: 'success', statusClass: '2xx' })
    expect(serializedLogs()).not.toContain(CANARY_FILENAME)
    expect(serializedLogs()).not.toContain(CANARY_BODY)
    expect(serializedObservations(recorder)).not.toContain(CANARY_FILENAME)
  })

  test('observes an upload failure without leaking the error body', async () => {
    const recorder = createRecorder()
    setMockFetch(() => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 403)))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      youtrackUpload(config, CANARY_PATH, { name: CANARY_FILENAME, content: new Uint8Array([1]) }).catch(
        () => undefined,
      ),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'auth' })
    expect(serializedLogs()).not.toContain(CANARY_FILENAME)
    expect(serializedLogs()).not.toContain(CANARY_ERROR)
  })
})
