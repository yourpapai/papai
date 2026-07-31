// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { callMagi, type HttpFetch, type MagiConfig } from '../../../plugins/acp/client.js'
import type { AnalyticsRequestContext, ProviderRequestObservation } from '../../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  ProviderScopeMissingError,
  runWithoutProviderRequestScope,
  runWithProviderRequestScope,
} from '../../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../../src/analytics/source-facts.js'

const CANARY_HOST = 'canary-magi.example'
const CANARY_PATH = '/sessions/canary-session-id'
const CANARY_TOKEN = 'canary-magi-token'
const CANARY_BODY = 'canary-request-body'
const CANARY_ERROR = 'canary-magi-error-body'

const config: MagiConfig = { baseUrl: `https://${CANARY_HOST}`, token: CANARY_TOKEN }

const makeSource = (): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
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

const serializedObservations = (recorder: Recorder): string => JSON.stringify(recorder.observations)

describe('callMagi boundary observation', () => {
  test('observes a successful request with controlled fields only', async () => {
    const recorder = createRecorder()
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ ok: true }))
    await runWithProviderRequestScope(actorScopeOf(recorder), async () => {
      await callMagi(httpFetch, config, 'GET', CANARY_PATH)
    })
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      provider: 'magi',
      operation: 'read',
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    })
    expect(recorder.contexts[0]?.source.chatUserId).toBe('user-1')
    expect(serializedObservations(recorder)).not.toContain(CANARY_PATH)
    expect(serializedObservations(recorder)).not.toContain(CANARY_TOKEN)
    expect(serializedObservations(recorder)).not.toContain(CANARY_HOST)
  })

  test('observes a non-ok response as failure while preserving the magi_error result contract', async () => {
    const recorder = createRecorder()
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 500))
    const result = await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      callMagi(httpFetch, config, 'POST', CANARY_PATH, { body: CANARY_BODY }),
    )
    expect(result).toMatchObject({ error: 'magi_error', status: 500 })
    expect(recorder.observations[0]).toMatchObject({
      provider: 'magi',
      operation: 'create',
      outcome: 'failure',
      statusClass: '5xx',
    })
    expect(serializedObservations(recorder)).not.toContain(CANARY_ERROR)
    expect(serializedObservations(recorder)).not.toContain(CANARY_BODY)
  })

  test('observes an auth failure with the auth class', async () => {
    const recorder = createRecorder()
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ error: CANARY_ERROR }, 401))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      callMagi(httpFetch, config, 'GET', CANARY_PATH).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'auth' })
  })

  test('observes a network failure with the network class', async () => {
    const recorder = createRecorder()
    const httpFetch: HttpFetch = () => Promise.reject(new TypeError('fetch failed'))
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      callMagi(httpFetch, config, 'GET', CANARY_PATH).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'network', retryable: true })
  })

  test('a throwing observation callback never changes magi behavior', async () => {
    const scope = createActorProviderRequestScope({
      requestContext: { source: makeSource(), sourceEventId: 'turn-1:test' },
      observeProviderRequest: () => {
        throw new Error('observer exploded')
      },
    })
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ ok: true }))
    const result = await runWithProviderRequestScope(scope, () => callMagi(httpFetch, config, 'GET', CANARY_PATH))
    expect(result).toEqual({ ok: true })
  })

  test('NO_ANALYTICS_SCOPE permits the request without observation', async () => {
    const fetchMock = mock<HttpFetch>(() => Promise.resolve(jsonResponse({ ok: true })))
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => callMagi(fetchMock, config, 'GET', CANARY_PATH))
    expect(fetchMock).toHaveBeenCalled()
  })

  test('an omitted scope fails before any fetch I/O', async () => {
    const fetchMock = mock<HttpFetch>(() => Promise.resolve(jsonResponse({ ok: true })))
    await runWithoutProviderRequestScope(async () => {
      await expect(callMagi(fetchMock, config, 'GET', CANARY_PATH)).rejects.toThrow(ProviderScopeMissingError)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
