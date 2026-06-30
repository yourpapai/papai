// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleCodingCredentialsModelsRoute } from '../../../src/debug/settings/coding-credentials-models-route.js'
import { addUser } from '../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-models'
const USER_ID = 'u-models-1'

function get(path: string, session: SettingsSession): Request {
  return new Request(`https://x${path}`, { headers: authHeaders(session) })
}

describe('coding-credentials models route', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({
      userId: USER_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: 'admin',
      username: undefined,
    })
    session = await establishSession({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      platformUserId: USER_ID,
    })
  })

  afterEach(() => {
    restoreFetch()
  })

  test('GET /models returns {ok:false, models:[]} when no key is stored', async () => {
    const url = new URL('https://x/settings/api/coding-credentials/models?agent=claude')
    const res = await handleCodingCredentialsModelsRoute(
      get('/settings/api/coding-credentials/models?agent=claude', session),
      url,
    )
    expect(res.status).toBe(200)
    const body = z.object({ ok: z.literal(false), models: z.array(z.unknown()) }).parse(await res.json())
    expect(body.ok).toBe(false)
    expect(body.models).toEqual([])
  })

  test('GET /models returns ok:true with models when key is stored', async () => {
    const { handleCodingCredentialsRoutes } = await import('../../../src/debug/settings/coding-credentials-routes.js')
    // Seed credentials via the PATCH route
    const patchUrl = new URL('https://x/settings/api/coding-credentials')
    await handleCodingCredentialsRoutes(
      new Request('https://x/settings/api/coding-credentials', {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'agent-provider',
          values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'sk-ant-test' },
        }),
      }),
      patchUrl,
    )
    // Mock the upstream /v1/models call
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-opus-4' }] }), {
          status: 200,
        }),
      ),
    )
    const url = new URL('https://x/settings/api/coding-credentials/models?agent=claude')
    const res = await handleCodingCredentialsModelsRoute(
      get('/settings/api/coding-credentials/models?agent=claude', session),
      url,
    )
    expect(res.status).toBe(200)
    const body = z
      .object({ ok: z.literal(true), models: z.array(z.object({ value: z.string(), label: z.string() })) })
      .parse(await res.json())
    expect(body.ok).toBe(true)
    expect(body.models).toContainEqual({ value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' })
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/coding-credentials/models')
    const res = await handleCodingCredentialsModelsRoute(new Request(url), url)
    expect(res.status).toBe(401)
  })

  test('POST returns 405', async () => {
    const url = new URL('https://x/settings/api/coding-credentials/models')
    const res = await handleCodingCredentialsModelsRoute(
      new Request(url, { method: 'POST', headers: authHeaders(session) }),
      url,
    )
    expect(res.status).toBe(405)
  })
})
