// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminLlmProvidersRoutes } from '../../../../src/debug/settings/admin/llm-providers-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import {
  clearLlmAdminCacheForTesting,
  createLlmProvider,
  getLlmProvider,
  setAdminRoleBindings,
} from '../../../../src/llm-providers/store.js'
import { addUser } from '../../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const okResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const nextTick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const waitFor = async (predicate: () => boolean, attempts = 50): Promise<void> => {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return
    await nextTick()
  }
  expect(predicate()).toBe(true)
}

const VerificationSchema = z.object({
  status: z.string(),
  error: z.string().nullable(),
  at: z.number().nullable(),
  models: z.array(z.string()),
  modelsFetchedAt: z.number().nullable(),
})

const ProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerType: z.string(),
  baseUrl: z.string(),
  apiKeyMasked: z.string(),
  verification: VerificationSchema,
})

const BASE_URL = 'https://x'
const PROVIDERS_PATH = '/settings/api/admin/providers'
const ROLES_PATH = '/settings/api/admin/llm-roles'

const providerBody = {
  label: 'OpenAI',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test1234',
}

describe('settings admin llm-providers routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    clearLlmAdminCacheForTesting()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
    // Background discovery is fire-and-forget; keep it off the real network.
    setMockFetch(() => Promise.resolve(okResponse({ data: [{ id: 'm1' }] })))
  })

  afterEach(() => {
    restoreFetch()
  })

  const call = (
    method: string,
    path: string,
    session: SettingsSession | null,
    body?: unknown,
    withCsrf = true,
  ): Promise<Response> => {
    const url = new URL(`${BASE_URL}${path}`)
    const headers: Record<string, string> = { ...authHeaders(session ?? adminSession, withCsrf) }
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    return handleAdminLlmProvidersRoutes(new Request(url, init), url, path)
  }

  const createViaRoute = async (): Promise<{ id: string }> => {
    const res = await call('POST', PROVIDERS_PATH, adminSession, providerBody)
    expect(res.status).toBe(200)
    const parsed = z.object({ provider: ProviderSchema }).parse(await res.json())
    return { id: parsed.provider.id }
  }

  test('GET providers returns an empty list initially', async () => {
    const res = await call('GET', PROVIDERS_PATH, adminSession)
    expect(res.status).toBe(200)
    const body = z.object({ providers: z.array(z.unknown()) }).parse(await res.json())
    expect(body.providers).toEqual([])
  })

  test('POST create returns the provider with a masked apiKey and unverified status', async () => {
    const res = await call('POST', PROVIDERS_PATH, adminSession, providerBody)
    expect(res.status).toBe(200)
    const body = z.object({ provider: ProviderSchema }).parse(await res.json())
    expect(body.provider.id.startsWith('prov_')).toBe(true)
    expect(body.provider.apiKeyMasked).toBe('****1234')
    expect(body.provider.verification.status).toBe('unverified')
  })

  test('GET providers reflects a created provider', async () => {
    const { id } = await createViaRoute()
    const res = await call('GET', PROVIDERS_PATH, adminSession)
    expect(res.status).toBe(200)
    const body = z.object({ providers: z.array(ProviderSchema) }).parse(await res.json())
    expect(body.providers.map((p) => p.id)).toContain(id)
  })

  test('POST create triggers background verification that flips status to verified', async () => {
    const { id } = await createViaRoute()
    await waitFor(() => getLlmProvider(id)?.verification.status === 'verified')
    const account = getLlmProvider(id)
    expect(account?.verification.status).toBe('verified')
    expect(account?.verification.models).toEqual(['m1'])
  })

  test('POST create with an invalid body returns 422', async () => {
    const res = await call('POST', PROVIDERS_PATH, adminSession, { label: '', providerType: 'nope' })
    expect(res.status).toBe(422)
  })

  test('PATCH update changes the label and returns the provider', async () => {
    const { id } = await createViaRoute()
    const res = await call('PATCH', `${PROVIDERS_PATH}/${id}`, adminSession, { label: 'renamed' })
    expect(res.status).toBe(200)
    const body = z.object({ provider: ProviderSchema }).parse(await res.json())
    expect(body.provider.label).toBe('renamed')
    expect(body.provider.id).toBe(id)
  })

  test('PATCH updating apiKey triggers a background re-verify', async () => {
    let fetchCount = 0
    setMockFetch(() => {
      fetchCount++
      return Promise.resolve(okResponse({ data: [{ id: 'm1' }] }))
    })
    const { id } = await createViaRoute()
    await waitFor(() => fetchCount >= 1)
    const afterCreate = fetchCount
    const res = await call('PATCH', `${PROVIDERS_PATH}/${id}`, adminSession, { apiKey: 'sk-rotated' })
    expect(res.status).toBe(200)
    await waitFor(() => fetchCount > afterCreate)
    expect(getLlmProvider(id)?.apiKey).toBe('sk-rotated')
  })

  test('PATCH update on a missing provider returns 404', async () => {
    const res = await call('PATCH', `${PROVIDERS_PATH}/prov_missing`, adminSession, { label: 'x' })
    expect(res.status).toBe(404)
  })

  test('PATCH with models writes models_cache directly without triggering a fetch', async () => {
    let fetchCount = 0
    setMockFetch(() => {
      fetchCount++
      return Promise.resolve(okResponse({ data: [{ id: 'm1' }] }))
    })
    const { id } = await createViaRoute()
    await waitFor(() => fetchCount >= 1)
    const afterCreate = fetchCount
    const res = await call('PATCH', `${PROVIDERS_PATH}/${id}`, adminSession, { models: ['manual-a', 'manual-b'] })
    expect(res.status).toBe(200)
    const body = z.object({ provider: ProviderSchema }).parse(await res.json())
    expect(body.provider.verification.models).toEqual(['manual-a', 'manual-b'])
    expect(getLlmProvider(id)?.verification.models).toEqual(['manual-a', 'manual-b'])
    expect(fetchCount).toBe(afterCreate)
  })

  test('PATCH can update label and models in the same request', async () => {
    const { id } = await createViaRoute()
    const res = await call('PATCH', `${PROVIDERS_PATH}/${id}`, adminSession, {
      label: 'combined',
      models: ['x', 'y'],
    })
    expect(res.status).toBe(200)
    const body = z.object({ provider: ProviderSchema }).parse(await res.json())
    expect(body.provider.label).toBe('combined')
    expect(body.provider.verification.models).toEqual(['x', 'y'])
  })

  test('POST refresh-models discovers models synchronously and returns them', async () => {
    const { id } = await createViaRoute()
    await waitFor(() => getLlmProvider(id)?.verification.status === 'verified')
    setMockFetch(() => Promise.resolve(okResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })))
    const res = await call('POST', `${PROVIDERS_PATH}/${id}/refresh-models`, adminSession)
    expect(res.status).toBe(200)
    const body = z.object({ provider: ProviderSchema }).parse(await res.json())
    expect(body.provider.verification.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
    expect(body.provider.verification.status).toBe('verified')
    expect(getLlmProvider(id)?.verification.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  test('POST refresh-models on a missing provider returns 404', async () => {
    const res = await call('POST', `${PROVIDERS_PATH}/prov_missing/refresh-models`, adminSession)
    expect(res.status).toBe(404)
  })

  test('POST refresh-models without CSRF returns 403', async () => {
    const { id } = await createViaRoute()
    const res = await call('POST', `${PROVIDERS_PATH}/${id}/refresh-models`, adminSession, undefined, false)
    expect(res.status).toBe(403)
  })

  test('non-admin POST refresh-models returns 403', async () => {
    const { id } = await createViaRoute()
    const res = await call('POST', `${PROVIDERS_PATH}/${id}/refresh-models`, userSession)
    expect(res.status).toBe(403)
  })

  test('GET refresh-models returns 405', async () => {
    const { id } = await createViaRoute()
    const res = await call('GET', `${PROVIDERS_PATH}/${id}/refresh-models`, adminSession)
    expect(res.status).toBe(405)
  })

  test('DELETE removes the provider', async () => {
    const { id } = await createViaRoute()
    const res = await call('DELETE', `${PROVIDERS_PATH}/${id}`, adminSession)
    expect(res.status).toBe(200)
    z.object({ ok: z.literal(true) }).parse(await res.json())
    const after = await call('GET', PROVIDERS_PATH, adminSession)
    const body = z.object({ providers: z.array(ProviderSchema) }).parse(await after.json())
    expect(body.providers.map((p) => p.id)).not.toContain(id)
  })

  test('DELETE on the main-bound provider returns 409', async () => {
    const provider = createLlmProvider(
      { label: 'main', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-main' },
      'admin-1',
    )
    setAdminRoleBindings(
      { main: { providerId: provider.id, model: 'gpt-4o' }, small: null, embedding: null },
      'admin-1',
    )
    const res = await call('DELETE', `${PROVIDERS_PATH}/${provider.id}`, adminSession)
    expect(res.status).toBe(409)
  })

  test('GET roles returns null when unset', async () => {
    const res = await call('GET', ROLES_PATH, adminSession)
    expect(res.status).toBe(200)
    const body = z.object({ roles: z.unknown() }).parse(await res.json())
    expect(body.roles).toBeNull()
  })

  test('PUT roles stores bindings and GET reflects them', async () => {
    const { id } = await createViaRoute()
    const rolesBody = {
      main: { providerId: id, model: 'gpt-4o' },
      small: null,
      embedding: null,
    }
    const putRes = await call('PUT', ROLES_PATH, adminSession, rolesBody)
    expect(putRes.status).toBe(200)
    z.object({ ok: z.literal(true) }).parse(await putRes.json())
    const getRes = await call('GET', ROLES_PATH, adminSession)
    expect(getRes.status).toBe(200)
    const body = z
      .object({
        roles: z.object({
          main: z.object({ providerId: z.string(), model: z.string() }),
          small: z.nullable(z.unknown()),
          embedding: z.nullable(z.unknown()),
        }),
      })
      .parse(await getRes.json())
    expect(body.roles.main.providerId).toBe(id)
  })

  test('PUT roles with an invalid body returns 422', async () => {
    const res = await call('PUT', ROLES_PATH, adminSession, { main: { providerId: '' } })
    expect(res.status).toBe(422)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL(`${BASE_URL}${PROVIDERS_PATH}`)
    const res = await handleAdminLlmProvidersRoutes(new Request(url, { method: 'GET' }), url, PROVIDERS_PATH)
    expect(res.status).toBe(401)
  })

  test('non-admin GET providers returns 403', async () => {
    const res = await call('GET', PROVIDERS_PATH, userSession)
    expect(res.status).toBe(403)
  })

  test('non-admin POST create returns 403', async () => {
    const res = await call('POST', PROVIDERS_PATH, userSession, providerBody)
    expect(res.status).toBe(403)
  })

  test('POST create without CSRF returns 403', async () => {
    const res = await call('POST', PROVIDERS_PATH, adminSession, providerBody, false)
    expect(res.status).toBe(403)
  })

  test('PATCH without CSRF returns 403', async () => {
    const { id } = await createViaRoute()
    const res = await call('PATCH', `${PROVIDERS_PATH}/${id}`, adminSession, { label: 'x' }, false)
    expect(res.status).toBe(403)
  })

  test('DELETE without CSRF returns 403', async () => {
    const { id } = await createViaRoute()
    const res = await call('DELETE', `${PROVIDERS_PATH}/${id}`, adminSession, undefined, false)
    expect(res.status).toBe(403)
  })

  test('PUT roles without CSRF returns 403', async () => {
    const res = await call(
      'PUT',
      ROLES_PATH,
      adminSession,
      {
        main: { providerId: 'p', model: 'm' },
        small: null,
        embedding: null,
      },
      false,
    )
    expect(res.status).toBe(403)
  })

  test('unknown method on providers collection returns 405', async () => {
    const res = await call('PUT', PROVIDERS_PATH, adminSession, {})
    expect(res.status).toBe(405)
  })
})
