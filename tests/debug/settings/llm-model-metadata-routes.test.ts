// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleLlmModelMetadataRoutes } from '../../../src/debug/settings/llm-model-metadata-routes.js'
import { addAdmin } from '../../../src/instances/admin-store.js'
import { prewarmModelsDevSnapshot } from '../../../src/models-dev/client.js'
import { resetModelsDevSnapshotForTest } from '../../../src/models-dev/client.testing.js'
import { addUser } from '../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const SNAPSHOT_FETCHED_AT = 1_700_000_000_000

describe('GET /settings/api/llm-model-metadata', () => {
  let memberSession: SettingsSession
  let adminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'g'.repeat(64)
    await setupTestDb()
    resetModelsDevSnapshotForTest()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    memberSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
  })

  afterEach(() => {
    resetModelsDevSnapshotForTest()
    restoreFetch()
  })

  const call = (session: SettingsSession | null, query = ''): Promise<Response> => {
    const url = new URL(`https://x/settings/api/llm-model-metadata${query}`)
    const headers: Record<string, string> = session === null ? {} : authHeaders(session, false)
    return handleLlmModelMetadataRoutes(new Request(url, { method: 'GET', headers }), url)
  }

  test('rejects an unauthenticated caller', async () => {
    const res = await call(null)
    expect(res.status).toBe(401)
  })

  test('allows an authenticated non-admin member with no context scope', async () => {
    const res = await call(memberSession, '?providerType=openai&model=gpt-4o&contextId=not-a-real-scope')
    expect(res.status).toBe(200)
  })

  test('serves an admin session the same way', async () => {
    const res = await call(adminSession, '?model=gpt-4o')
    expect(res.status).toBe(200)
  })

  test('echoes the resolved precedence for a catalogue hit', async () => {
    await prewarmModelsDevSnapshot({
      fetchImpl: () =>
        Promise.resolve(
          JSON.stringify({ openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } } }),
        ),
      cachePath: `/tmp/opencode/llm-meta-${crypto.randomUUID()}/models.json`,
      now: () => SNAPSHOT_FETCHED_AT,
    })

    const res = await call(memberSession, '?providerType=openai&model=gpt-4o')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: 'models-dev',
      via: 'inferred',
      snapshotFetchedAt: SNAPSHOT_FETCHED_AT,
    })
  })

  test('echoes override precedence when base references are supplied', async () => {
    await prewarmModelsDevSnapshot({
      fetchImpl: () =>
        Promise.resolve(
          JSON.stringify({
            openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } },
            anthropic: { models: { 'claude-declared': { limit: { context: 200_000, output: 8_000 } } } },
          }),
        ),
      cachePath: `/tmp/opencode/llm-meta-${crypto.randomUUID()}/models.json`,
      now: () => SNAPSHOT_FETCHED_AT,
    })

    const res = await call(
      memberSession,
      '?providerType=openai&model=gpt-4o&baseProvider=anthropic&baseModel=claude-declared',
    )

    const body = z
      .object({ source: z.string(), via: z.string(), providerId: z.string().nullable() })
      .parse(await res.json())
    expect(body.source).toBe('models-dev')
    expect(body.via).toBe('override')
    expect(body.providerId).toBe('anthropic')
  })

  test('an empty snapshot reports none with a null snapshot fetch time', async () => {
    const res = await call(memberSession, '?model=mystery-model')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: null,
      maxOutputTokens: null,
      source: 'none',
      via: null,
      snapshotFetchedAt: null,
    })
  })

  test('serving a lookup triggers zero outbound fetches', async () => {
    let fetches = 0
    setMockFetch(() => {
      fetches += 1
      return Promise.resolve(new Response('{}'))
    })

    await call(memberSession, '?providerType=openai&model=gpt-4o')
    await call(memberSession, '?model=whatever')

    expect(fetches).toBe(0)
  })

  test('the response stays credential-free on hostile input', async () => {
    const res = await call(
      memberSession,
      '?model=<script>&apiKey=sk-secret&password=hunter2&baseProvider=%00&baseUrl=javascript:alert(1)',
    )

    expect(res.status).toBe(200)
    const body = z.record(z.string(), z.unknown()).parse(await res.json())
    expect(Object.keys(body).sort()).toEqual([
      'contextWindow',
      'maxOutputTokens',
      'modelId',
      'providerId',
      'snapshotFetchedAt',
      'source',
      'via',
    ])
    expect(JSON.stringify(body)).not.toContain('sk-secret')
  })

  test('rejects non-GET methods', async () => {
    const url = new URL('https://x/settings/api/llm-model-metadata')
    const res = await handleLlmModelMetadataRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(memberSession, false) }),
      url,
    )
    expect(res.status).toBe(405)
  })
})
