// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { provisionKaneoUser } from '../../../plugins/task-provider-kaneo/provision-requests.js'
import type { AnalyticsRequestContext, ProviderRequestObservation } from '../../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  runWithProviderRequestScope,
} from '../../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../../src/analytics/source-facts.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../../utils/test-helpers.js'

const BASE_URL = 'http://kaneo.internal:1337'
const PUBLIC_URL = 'https://kaneo.example'

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
  taskProvider: 'kaneo',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
})

type Recorder = Readonly<{
  observations: ProviderRequestObservation[]
  runInScope: <T>(fn: () => Promise<T>) => Promise<T>
}>

const createRecorder = (): Recorder => {
  const observations: ProviderRequestObservation[] = []
  const contexts: AnalyticsRequestContext[] = []
  const scope = createActorProviderRequestScope({
    requestContext: { source: makeSource(), sourceEventId: 'turn-1:provision-requests' },
    observeProviderRequest: (ctx, observation) => {
      contexts.push(ctx)
      observations.push(observation)
    },
  })
  return {
    observations,
    runInScope: (fn) => runWithProviderRequestScope(scope, fn),
  }
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const installProvisionFetch = (overrides: Record<string, Response> = {}): void => {
  setMockFetch((url) => {
    const override = Object.entries(overrides).find(([marker]) => url.includes(marker))
    if (override !== undefined) return Promise.resolve(override[1])
    if (url.includes('/api/auth/sign-up/email')) {
      return Promise.resolve(
        jsonResponse({ user: { id: 'u-1' }, token: 'tok' }, 200, {
          'Set-Cookie': 'better-auth.session_token=sess-tok; Path=/; HttpOnly',
        }),
      )
    }
    if (url.includes('/api/auth/organization/create')) {
      return Promise.resolve(jsonResponse({ id: 'ws-1', slug: 'slug-1' }))
    }
    if (url.includes('/api/auth/api-key/create')) {
      return Promise.resolve(jsonResponse({ key: 'kaneo-key-1' }))
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  })
}

describe('provisionKaneoUser request observation', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('emits a success observation for every provisioned auth request', async () => {
    installProvisionFetch()
    const recorder = createRecorder()

    const result = await recorder.runInScope(() => provisionKaneoUser(BASE_URL, PUBLIC_URL, 'tg-1', 'alice'))

    expect(result.kaneoKey).toBe('kaneo-key-1')
    expect(result.workspaceId).toBe('ws-1')
    expect(recorder.observations).toHaveLength(3)
    for (const observation of recorder.observations) {
      expect(observation).toMatchObject({
        provider: 'kaneo',
        operation: 'create',
        outcome: 'success',
        statusClass: '2xx',
      })
      expect(observation.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  test('emits a failure observation when sign-up responds 500', async () => {
    installProvisionFetch({ '/api/auth/sign-up/email': new Response('database unavailable', { status: 500 }) })
    const recorder = createRecorder()

    const attempt = recorder.runInScope(() => provisionKaneoUser(BASE_URL, PUBLIC_URL, 'tg-1', 'alice'))
    await expect(attempt).rejects.toThrow('Sign-up failed (500): database unavailable')

    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      provider: 'kaneo',
      operation: 'create',
      outcome: 'failure',
      statusClass: '5xx',
    })
  })

  test('emits a failure observation when the request throws', async () => {
    setMockFetch(() => Promise.reject(new Error('connection refused')))
    const recorder = createRecorder()

    const attempt = recorder.runInScope(() => provisionKaneoUser(BASE_URL, PUBLIC_URL, 'tg-1', 'alice'))
    await expect(attempt).rejects.toThrow('connection refused')

    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      provider: 'kaneo',
      operation: 'create',
      outcome: 'failure',
    })
  })

  test('observes the api-key fallback attempt and still returns the session key', async () => {
    installProvisionFetch({ '/api/auth/api-key/create': new Response('disabled', { status: 404 }) })
    const recorder = createRecorder()

    const result = await recorder.runInScope(() => provisionKaneoUser(BASE_URL, PUBLIC_URL, 'tg-1', 'alice'))

    expect(result.kaneoKey).toBe('better-auth.session_token=sess-tok')
    expect(recorder.observations).toHaveLength(3)
    expect(recorder.observations[2]).toMatchObject({ outcome: 'failure', statusClass: '4xx' })
  })
})
