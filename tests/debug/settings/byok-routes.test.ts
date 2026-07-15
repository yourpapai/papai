// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import {
  enableByokForContext,
  getByokBundle,
  getByokCredentialState,
  getByokLlmConfig,
  updateByokLlmConfig,
  upsertByokProvider,
} from '../../../src/byok-llm/store.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { maskSensitiveValue } from '../../../src/config.js'
import { byokLlmCredentials } from '../../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { handleByokRoutes } from '../../../src/debug/settings/byok-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import type { LlmProviderAccount, Verification } from '../../../src/llm-providers/types.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
  waitFor,
} from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const ByokResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  unreadable: z.literal(true).optional(),
  error: z.string().optional(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
      sensitive: z.boolean(),
      hasValue: z.boolean(),
      value: z.string(),
    }),
  ),
})

const PatchResponseSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
})
const OkOnlySchema = z.object({ ok: z.literal(true) })

const okFetchResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const unverified = (): Verification => ({
  status: 'unverified',
  error: null,
  at: null,
  models: [],
  modelsFetchedAt: null,
})

const makeProvider = (overrides: Partial<LlmProviderAccount> = {}): LlmProviderAccount => ({
  id: 'prov-1',
  label: 'Test Provider',
  providerType: 'custom',
  baseUrl: 'https://byok.invalid/v1',
  apiKey: 'sk-test-1234',
  verification: unverified(),
  ...overrides,
})

const insertCorruptedByokRow = (contextId: string): void => {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({
      contextId,
      enabled: true,
      encryptedConfig: 'not-base64',
      updatedAt: Date.now(),
      updatedBy: 'seed-user',
    })
    .run()
}

describe('settings BYOK routes', () => {
  let session: SettingsSession
  let personalConfigContextId: string

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({
      userId: 'u-1',
      platformInstanceId: 'pi-1',
      addedBy: 'admin',
      username: undefined,
    })
    session = await establishSession({
      platformInstanceId: 'pi-1',
      platformUserId: 'u-1',
    })
    personalConfigContextId = resolveSettingsPrincipal('pi-1', 'u-1').personalConfigContextId
    setMockFetch(() => Promise.resolve(okFetchResponse({ data: [{ id: 'm1' }] })))
  })

  afterEach(() => {
    restoreFetch()
  })

  test('GET returns disabled state when BYOK is not enabled for the context', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(new Request(url, { headers: authHeaders(session) }), url)

    expect(res.status).toBe(200)
    const body = ByokResponseSchema.parse(await res.json())
    expect(body).toEqual({
      enabled: false,
      complete: false,
      missing: [],
      fields: [],
    })
  })

  test('PATCH rejects credential update before admin enablement', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: {
            llm_apikey: 'sk-context-0000',
            llm_baseurl: 'https://api.example/v1',
            main_model: 'gpt-test',
          },
        }),
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('PATCH stores enabled context credentials and GET masks api key', async () => {
    const secret = 'sk-secret-1234'
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')

    const patch = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: {
            llm_apikey: secret,
            llm_baseurl: 'https://api.example/v1',
            main_model: 'gpt-test',
          },
        }),
      }),
      url,
    )
    expect(patch.status).toBe(200)
    const patchBody = PatchResponseSchema.parse(await patch.json())
    expect(patchBody.contextId).toBe(personalConfigContextId)

    const get = await handleByokRoutes(new Request(url, { headers: authHeaders(session) }), url)

    expect(get.status).toBe(200)
    const text = await get.text()
    expect(text).not.toContain(secret)
    const body = ByokResponseSchema.parse(JSON.parse(text))
    const apiKeyField = body.fields.find((field) => field.key === 'llm_apikey')
    assert(apiKeyField !== undefined, 'llm_apikey field should be present when BYOK is enabled')
    expect(apiKeyField.sensitive).toBe(true)
    expect(apiKeyField.hasValue).toBe(true)
    expect(apiKeyField.value).toBe(maskSensitiveValue(secret))
    expect(getByokLlmConfig(personalConfigContextId)?.llm_apikey).toBe(secret)
  })

  test('PATCH preserves existing api key when client submits masked value', async () => {
    const secret = 'sk-existing-5555'
    enableByokForContext(personalConfigContextId, 'admin')
    updateByokLlmConfig(
      personalConfigContextId,
      {
        llm_apikey: secret,
        llm_baseurl: 'https://old.example/v1',
        main_model: 'old-model',
      },
      'admin',
    )
    const url = new URL('https://x/settings/api/byok')

    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: {
            llm_apikey: maskSensitiveValue(secret),
            llm_baseurl: 'https://new.example/v1',
            main_model: 'new-model',
          },
        }),
      }),
      url,
    )

    expect(res.status).toBe(200)
    const stored = getByokLlmConfig(personalConfigContextId)
    expect(stored?.llm_apikey).toBe(secret)
    expect(stored?.llm_baseurl).toBe('https://new.example/v1')
    expect(stored?.main_model).toBe('new-model')
  })

  test('PATCH preserves existing api key when client submits blank value', async () => {
    const secret = 'sk-existing-7777'
    enableByokForContext(personalConfigContextId, 'admin')
    updateByokLlmConfig(
      personalConfigContextId,
      {
        llm_apikey: secret,
        llm_baseurl: 'https://old.example/v1',
        main_model: 'old-model',
      },
      'admin',
    )
    const url = new URL('https://x/settings/api/byok')

    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: { llm_apikey: '', small_model: 'small-test' },
        }),
      }),
      url,
    )

    expect(res.status).toBe(200)
    const stored = getByokLlmConfig(personalConfigContextId)
    expect(stored?.llm_apikey).toBe(secret)
    expect(stored?.small_model).toBe('small-test')
  })

  test('PATCH clears optional model when client submits blank value', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    updateByokLlmConfig(
      personalConfigContextId,
      {
        llm_apikey: 'sk-existing-8888',
        llm_baseurl: 'https://old.example/v1',
        main_model: 'old-model',
        small_model: 'small-old',
      },
      'admin',
    )
    const url = new URL('https://x/settings/api/byok')

    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: { small_model: '' } }),
      }),
      url,
    )

    expect(res.status).toBe(200)
    expect(getByokLlmConfig(personalConfigContextId)?.small_model).toBeUndefined()
  })

  test('GET returns unreadable metadata for corrupted enabled context credentials', async () => {
    insertCorruptedByokRow(personalConfigContextId)
    const url = new URL('https://x/settings/api/byok')

    const res = await handleByokRoutes(new Request(url, { headers: authHeaders(session) }), url)

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('not-base64')
    const body = ByokResponseSchema.parse(JSON.parse(text))
    expect(body).toMatchObject({
      enabled: true,
      complete: false,
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
      unreadable: true,
      error: 'stored BYOK LLM credentials are unreadable',
    })
  })

  test('GET and PATCH resolve authorized managed group context', async () => {
    const groupContextId = toScopedContextId({
      platformInstanceId: 'pi-1',
      nativeContextId: 'group-1',
    })
    upsertKnownGroupContext({
      contextId: groupContextId,
      provider: 'telegram',
      displayName: 'Test Group',
      parentName: null,
    })
    upsertGroupAdminObservation({
      contextId: groupContextId,
      provider: 'telegram',
      userId: 'u-1',
      username: 'u-1',
      isAdmin: true,
    })
    addAuthorizedGroup(groupContextId, 'admin')
    const groupConfigContextId = resolveSettingsPrincipal('pi-1', 'u-1').manageableGroups[0]?.contextId
    assert(groupConfigContextId !== undefined, 'authorized group should be manageable')
    enableByokForContext(groupConfigContextId, 'admin')
    const url = new URL(`https://x/settings/api/byok?contextId=${encodeURIComponent(groupContextId)}`)

    const get = await handleByokRoutes(new Request(url, { headers: authHeaders(session) }), url)
    expect(get.status).toBe(200)
    expect(ByokResponseSchema.parse(await get.json()).enabled).toBe(true)

    const patch = await handleByokRoutes(
      new Request('https://x/settings/api/byok', {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contextId: groupContextId,
          values: { main_model: 'group-model' },
        }),
      }),
      new URL('https://x/settings/api/byok'),
    )
    expect(patch.status).toBe(200)
    expect(PatchResponseSchema.parse(await patch.json()).contextId).toBe(groupConfigContextId)
    expect(getByokLlmConfig(groupConfigContextId)?.main_model).toBe('group-model')
  })

  test('PATCH rejects invalid body with 422', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [] }),
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(new Request(url, { method: 'POST', headers: authHeaders(session) }), url)
    expect(res.status).toBe(405)
  })

  test('PATCH action:enable turns BYOK on for the owner personal context', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'enable' }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      contextId: personalConfigContextId,
      enabled: true,
    })
    expect(getByokCredentialState(personalConfigContextId).enabled).toBe(true)
  })

  test('PATCH action:disable turns BYOK off for the owner personal context', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'disable' }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      contextId: personalConfigContextId,
      enabled: false,
    })
    expect(getByokCredentialState(personalConfigContextId).enabled).toBe(false)
  })

  test('PATCH action:enable for a group the principal manages turns BYOK on', async () => {
    const scopedGroupId = toScopedContextId({
      platformInstanceId: 'pi-1',
      nativeContextId: 'grp-1',
    })
    upsertKnownGroupContext({
      contextId: scopedGroupId,
      provider: 'telegram',
      displayName: 'Test Group',
      parentName: null,
    })
    upsertGroupAdminObservation({
      contextId: scopedGroupId,
      provider: 'telegram',
      userId: 'u-1',
      username: 'u-1',
      isAdmin: true,
    })
    addAuthorizedGroup(scopedGroupId, 'u-1')

    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'enable', contextId: scopedGroupId }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    expect(getByokCredentialState(scopedGroupId).enabled).toBe(true)
  })

  test('PATCH body with both action and values returns 422', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'enable', values: { main_model: 'x' } }),
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('PATCH action:enable for a group the principal cannot manage → 403', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'enable',
          contextId: 'unmanaged-context',
        }),
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('PATCH action:upsert-provider stores the provider when BYOK is enabled', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'upsert-provider',
          provider: makeProvider(),
        }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    const body = PatchResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(personalConfigContextId)
    const bundle = getByokBundle(personalConfigContextId)
    expect(bundle.blob?.providers.map((p) => p.id)).toContain('prov-1')
  })

  test('PATCH action:upsert-provider returns 403 when BYOK is not enabled', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'upsert-provider',
          provider: makeProvider(),
        }),
      }),
      url,
    )
    expect(res.status).toBe(403)
    expect(getByokBundle(personalConfigContextId).blob).toBeNull()
  })

  test('PATCH action:upsert-provider triggers background verification that flips status', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'upsert-provider',
          provider: makeProvider(),
        }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    await waitFor(() => getByokBundle(personalConfigContextId).blob?.providers[0]?.verification.status === 'verified')
    expect(getByokBundle(personalConfigContextId).blob?.providers[0]?.verification.models).toEqual(['m1'])
  })

  test('PATCH action:set-roles stores role bindings for an enabled context', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    upsertByokProvider(personalConfigContextId, makeProvider(), 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'set-roles',
          roles: {
            main: { providerId: 'prov-1', model: 'gpt-test' },
            small: null,
            embedding: null,
          },
        }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    PatchResponseSchema.parse(await res.json())
    expect(getByokBundle(personalConfigContextId).blob?.roles.main).toEqual({
      providerId: 'prov-1',
      model: 'gpt-test',
    })
  })

  test('PATCH action:delete-provider removes the provider', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    upsertByokProvider(personalConfigContextId, makeProvider(), 'admin')
    assert(getByokBundle(personalConfigContextId).blob?.providers.length === 1)
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete-provider', id: 'prov-1' }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    PatchResponseSchema.parse(await res.json())
    expect(getByokBundle(personalConfigContextId).blob?.providers.map((p) => p.id)).not.toContain('prov-1')
  })

  test('PATCH action:refresh-models returns 200 and runs background verification', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    upsertByokProvider(personalConfigContextId, makeProvider(), 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'refresh-models', id: 'prov-1' }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    OkOnlySchema.parse(await res.json())
    await waitFor(() => getByokBundle(personalConfigContextId).blob?.providers[0]?.verification.status === 'verified')
    expect(getByokBundle(personalConfigContextId).blob?.providers[0]?.verification.models).toEqual(['m1'])
  })

  test('PATCH action:refresh-models returns 404 for an unknown provider', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'refresh-models', id: 'missing' }),
      }),
      url,
    )
    expect(res.status).toBe(404)
  })

  test('PATCH action:upsert-provider with invalid provider body returns 422', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'upsert-provider',
          provider: { id: '' },
        }),
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('PATCH action:set-roles with invalid roles body returns 422', async () => {
    enableByokForContext(personalConfigContextId, 'admin')
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'set-roles',
          roles: { main: { providerId: '' } },
        }),
      }),
      url,
    )
    expect(res.status).toBe(422)
  })
})
