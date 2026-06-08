// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { getByokCredentialState, getByokLlmConfig, updateByokLlmConfig } from '../../../../src/byok-llm/store.js'
import { handleAdminByokRoutes } from '../../../../src/debug/settings/admin/byok-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
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

const PatchResponseSchema = z.object({ ok: z.literal(true), contextId: z.string(), enabled: z.boolean() })

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

  test('admin can enable BYOK for a context', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    const body = PatchResponseSchema.parse(await res.json())
    expect(body).toEqual({ ok: true, contextId: 'ctx-1', enabled: true })
    expect(getByokCredentialState('ctx-1').enabled).toBe(true)
  })

  test('admin can disable BYOK for a context', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
      }),
      url,
    )

    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: false }),
      }),
      url,
    )

    expect(res.status).toBe(200)
    const body = PatchResponseSchema.parse(await res.json())
    expect(body.enabled).toBe(false)
    expect(getByokCredentialState('ctx-1').enabled).toBe(false)
  })

  test('non-admin cannot read BYOK summaries', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(new Request(url, { headers: authHeaders(userSession) }), url)
    expect(res.status).toBe(403)
  })

  test('non-admin cannot enable BYOK', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
      }),
      url,
    )
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

  test('PATCH rejects invalid JSON with 400', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: '{',
      }),
      url,
    )
    expect(res.status).toBe(400)
  })

  test('PATCH rejects invalid body with 422', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: '', enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(adminSession) }),
      url,
    )
    expect(res.status).toBe(405)
  })
})
