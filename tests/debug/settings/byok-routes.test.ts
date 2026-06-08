// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { enableByokForContext, getByokLlmConfig, updateByokLlmConfig } from '../../../src/byok-llm/store.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { maskSensitiveValue } from '../../../src/config.js'
import { handleByokRoutes } from '../../../src/debug/settings/byok-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const ByokResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
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

const PatchResponseSchema = z.object({ ok: z.literal(true), contextId: z.string() })

describe('settings BYOK routes', () => {
  let session: SettingsSession
  let personalConfigContextId: string

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    personalConfigContextId = resolveSettingsPrincipal('pi-1', 'u-1').personalConfigContextId
  })

  test('GET returns disabled state when BYOK is not enabled for the context', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(new Request(url, { headers: authHeaders(session) }), url)

    expect(res.status).toBe(200)
    const body = ByokResponseSchema.parse(await res.json())
    expect(body).toEqual({ enabled: false, complete: false, missing: [], fields: [] })
  })

  test('PATCH rejects credential update before admin enablement', async () => {
    const url = new URL('https://x/settings/api/byok')
    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: { llm_apikey: 'sk-context-0000', llm_baseurl: 'https://api.example/v1', main_model: 'gpt-test' },
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
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: { llm_apikey: secret, llm_baseurl: 'https://api.example/v1', main_model: 'gpt-test' },
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
      { llm_apikey: secret, llm_baseurl: 'https://old.example/v1', main_model: 'old-model' },
      'admin',
    )
    const url = new URL('https://x/settings/api/byok')

    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
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
      { llm_apikey: secret, llm_baseurl: 'https://old.example/v1', main_model: 'old-model' },
      'admin',
    )
    const url = new URL('https://x/settings/api/byok')

    const res = await handleByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { llm_apikey: '', small_model: 'small-test' } }),
      }),
      url,
    )

    expect(res.status).toBe(200)
    const stored = getByokLlmConfig(personalConfigContextId)
    expect(stored?.llm_apikey).toBe(secret)
    expect(stored?.small_model).toBe('small-test')
  })

  test('GET and PATCH resolve authorized managed group context', async () => {
    const groupContextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'group-1' })
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
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: groupContextId, values: { main_model: 'group-model' } }),
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
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
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
})
