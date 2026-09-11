// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import {
  enableByokForContext,
  getByokBundle,
  getByokLlmConfig,
  updateByokLlmConfig,
} from '../../../../src/byok-llm/store.js'
import { handleAdminByokRoutes } from '../../../../src/debug/settings/admin/byok-routes.js'
import { handleByokRoutes } from '../../../../src/debug/settings/byok-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { resolveSettingsPrincipal } from '../../../../src/settings/principal.js'
import { addUser } from '../../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const AdminByokResponseSchema = z.object({
  contexts: z.array(
    z.object({
      contextId: z.string(),
      enabled: z.boolean(),
      complete: z.boolean(),
      missing: z.array(z.string()),
      updatedAt: z.number(),
      updatedBy: z.string(),
    }),
  ),
})

describe('settings admin BYOK routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('non-admin cannot read BYOK summaries', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(new Request(url, { headers: authHeaders(userSession) }), url)
    expect(res.status).toBe(403)
  })

  test('GET returns summary array without secrets', async () => {
    const secret = 'sk-admin-secret-1234'
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: secret, llm_baseurl: 'https://llm.example/v1', main_model: 'model-main' },
      'admin-1',
    )
    const url = new URL('https://x/settings/api/admin/byok')

    const res = await handleAdminByokRoutes(new Request(url, { headers: authHeaders(adminSession) }), url)

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(secret)
    const body = AdminByokResponseSchema.parse(JSON.parse(text))
    expect(body.contexts).toHaveLength(1)
    expect(body.contexts[0]!.contextId).toBe('ctx-1')
    expect(getByokLlmConfig('ctx-1')?.llm_apikey).toBe(secret)
  })

  test('PATCH is not allowed on the admin route', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(405)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(adminSession) }),
      url,
    )
    expect(res.status).toBe(405)
  })

  test('upsert-provider accepts optional modelHints and round-trips it into the blob readback', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'm1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const contextId = resolveSettingsPrincipal('pi-1', 'admin-1').personalConfigContextId
    enableByokForContext(contextId, 'admin-1')
    const hints = { 'byok-model': { baseProvider: 'google', baseModel: 'gemini-pro' } }

    const patchUrl = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(patchUrl, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert-provider',
          provider: {
            id: 'prov-hints',
            label: 'Hinted',
            providerType: 'custom',
            baseUrl: 'https://byok.invalid/v1',
            apiKey: 'sk-hints-1234',
            baseProvider: null,
            baseModel: null,
            modelHints: hints,
            verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
          },
        }),
      }),
      patchUrl,
    )
    expect(res.status).toBe(200)

    const blob = getByokBundle(contextId).blob
    expect(blob?.providers[0]?.modelHints).toStrictEqual(hints)

    const getUrl = new URL(`https://x/settings/api/byok?contextId=${encodeURIComponent(contextId)}`)
    const getRes = await handleByokRoutes(new Request(getUrl, { headers: authHeaders(adminSession) }), getUrl)
    expect(getRes.status).toBe(200)
    const body = z
      .object({
        providers: z.array(
          z.object({
            id: z.string(),
            modelHints: z.record(z.string(), z.object({ baseProvider: z.string(), baseModel: z.string() })),
          }),
        ),
      })
      .parse(await getRes.json())
    const echoed = body.providers.find((p) => p.id === 'prov-hints')
    expect(echoed?.modelHints).toStrictEqual(hints)
    restoreFetch()
  })
})
