// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminCodingGuardrailsRoutes } from '../../../../src/debug/settings/admin/coding-guardrails-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const GuardrailsResponseSchema = z.object({
  guardrails: z.object({
    allowedAgents: z.array(z.string()),
    whoMayUse: z.union([z.literal('members'), z.array(z.string())]),
    forceSharedKey: z.boolean(),
  }),
  sharedKeySet: z.boolean(),
})

describe('settings admin coding-guardrails routes', () => {
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

  test('non-admin cannot read guardrails', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const res = await handleAdminCodingGuardrailsRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(403)
  })

  test('GET returns default guardrails with sharedKeySet:false', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const res = await handleAdminCodingGuardrailsRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(200)
    const body = GuardrailsResponseSchema.parse(await res.json())
    expect(body.sharedKeySet).toBe(false)
    expect(body.guardrails.allowedAgents).toEqual(['claude', 'codex', 'opencode'])
    expect(body.guardrails.whoMayUse).toBe('members')
    expect(body.guardrails.forceSharedKey).toBe(false)
  })

  test('POST kind:policy round-trips guardrails', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'policy',
        guardrails: { allowedAgents: ['claude'], whoMayUse: ['u1'], forceSharedKey: true },
      }),
    })
    const res = await handleAdminCodingGuardrailsRoutes(req, url, url.pathname)
    expect(res.status).toBe(200)
    const body = GuardrailsResponseSchema.parse(await res.json())
    expect(body.guardrails.allowedAgents).toEqual(['claude'])
    expect(body.guardrails.whoMayUse).toEqual(['u1'])
    expect(body.guardrails.forceSharedKey).toBe(true)
  })

  test('POST kind:shared-key sets sharedKeySet:true without leaking the key', async () => {
    const secret = 'sk-secret-operator-key'
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'shared-key', provider: 'anthropic', api_key: secret }),
    })
    const res = await handleAdminCodingGuardrailsRoutes(req, url, url.pathname)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(secret)
    const body = GuardrailsResponseSchema.parse(JSON.parse(text))
    expect(body.sharedKeySet).toBe(true)
  })

  test('POST kind:shared-key-clear resets sharedKeySet to false', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const setReq = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'shared-key', provider: 'openai', api_key: 'sk-test-key' }),
    })
    await handleAdminCodingGuardrailsRoutes(setReq, url, url.pathname)
    const clearReq = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'shared-key-clear' }),
    })
    const res = await handleAdminCodingGuardrailsRoutes(clearReq, url, url.pathname)
    expect(res.status).toBe(200)
    const body = GuardrailsResponseSchema.parse(await res.json())
    expect(body.sharedKeySet).toBe(false)
  })

  test('POST without CSRF returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'shared-key-clear' }),
    })
    const res = await handleAdminCodingGuardrailsRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const res = await handleAdminCodingGuardrailsRoutes(
      new Request(url, { method: 'DELETE', headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(405)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const res = await handleAdminCodingGuardrailsRoutes(new Request(url), url, url.pathname)
    expect(res.status).toBe(401)
  })

  test('non-admin POST is rejected with 403', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'shared-key-clear' }),
    })
    const res = await handleAdminCodingGuardrailsRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('POST with an invalid body returns 422', async () => {
    const url = new URL('https://x/settings/api/admin/coding-guardrails')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'policy',
        guardrails: { allowedAgents: 'not-an-array', whoMayUse: 'members', forceSharedKey: false },
      }),
    })
    const res = await handleAdminCodingGuardrailsRoutes(req, url, url.pathname)
    expect(res.status).toBe(422)
  })
})
