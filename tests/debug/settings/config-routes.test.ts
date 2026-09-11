// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { getConfigValue, maskSensitiveValue, setConfigValue } from '../../../src/config.js'
import { handleConfigRoutes } from '../../../src/debug/settings/config-routes.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { createLlmProvider, setAdminRoleBindings } from '../../../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting } from '../../../src/llm-providers/store.testing.js'
import { prewarmModelsDevSnapshot } from '../../../src/models-dev/client.js'
import { resetModelsDevSnapshotForTest } from '../../../src/models-dev/client.testing.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../src/providers/registry.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY } from '../../../src/types/config.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const GetResponseSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      sensitive: z.boolean(),
      hasValue: z.boolean(),
      value: z.string(),
      control: z.string().optional(),
      options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    }),
  ),
})
const PatchResponseSchema = z.object({ contextId: z.string() })
const PatchUnchangedResponseSchema = z.object({ ok: z.literal(true), unchanged: z.literal(true) })
const PatchErrorSchema = z.object({ error: z.string().optional() })

const KANEO_PLUGIN_ID = 'task-provider-kaneo'

const prewarmCatalogue = async (models: Record<string, unknown>): Promise<void> => {
  await prewarmModelsDevSnapshot({
    fetchImpl: () => Promise.resolve(JSON.stringify({ openai: { models } })),
    cachePath: `/tmp/opencode/config-routes-${crypto.randomUUID()}/models.json`,
    now: () => 1_700_000_000_000,
  })
}

const seedMainModel = (model: string): void => {
  const provider = createLlmProvider(
    { label: 'admin-openai', providerType: 'openai', baseUrl: 'https://admin/v1', apiKey: 'sk-admin' },
    'admin',
  )
  setAdminRoleBindings({ main: { providerId: provider.id, model }, small: null, embedding: null }, 'admin')
}

const registerKaneoProviderType = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: () => {
      throw new Error('kaneo factory not needed in config-routes tests')
    },
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [],
    contextConfigSchema: [
      { key: 'credential', label: 'Kaneo API Key', required: true, sensitive: true, scope: 'context' },
    ],
  })
}

describe('settings config routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
    clearLlmAdminCacheForTesting()
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    resetModelsDevSnapshotForTest()
  })

  test('GET returns field descriptors with masked values', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.fields.some((f) => f.key === 'timezone')).toBe(true)
  })

  test('PATCH validates and persists a field', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'America/New_York' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(200)
    // Personal scope resolves to the principal's personalConfigContextId; assert via read-back.
    const body = PatchResponseSchema.parse(await res.json())
    expect(getConfigValue(body.contextId, 'timezone')).toBe('America/New_York')
  })

  test('PATCH rejects an invalid value with 422', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'Not/AZone' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(422)
  })

  test('PATCH persists an AI-output enum field', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_tool_visibility', value: 'on' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(200)
    const body = PatchResponseSchema.parse(await res.json())
    expect(getConfigValue(body.contextId, 'ai_tool_visibility')).toBe('on')
  })

  test('PATCH rejects an invalid AI-output enum value with 422', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_output_detail_level', value: 'verbose' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(422)
  })

  test('PATCH without CSRF is 403', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'UTC' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(403)
  })

  // ── New coverage gaps ─────────────────────────────────────────────────────

  test('GET masks sensitive field value in response (security contract)', async () => {
    // Arrange: register the kaneo provider type so the sensitive `credential` field
    // appears in getConfigFieldsForContext() when a kaneo task instance is assigned.
    registerKaneoProviderType()
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'kaneo-t1', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'kaneo-t1', platformInstanceId: 'pi-1' })

    // Store a known plaintext value under the namespaced plugin credential key.
    const plaintext = 'super-secret-1234'
    setConfigValue(personalConfigContextId, KANEO_PLUGIN_CREDENTIAL_KEY, plaintext)

    // Act: GET the config fields.
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())

    // Assert: the sensitive field is present and its value is masked (not the plaintext).
    const sensitiveField = body.fields.find((f) => f.key === 'credential')
    assert(sensitiveField !== undefined, 'kaneo credential field must be present when kaneo instance is assigned')
    expect(sensitiveField.sensitive).toBe(true)
    expect(sensitiveField.hasValue).toBe(true)
    expect(sensitiveField.value).not.toBe(plaintext)
    // The mask format is `****` followed by the last 4 chars of the value.
    expect(sensitiveField.value).toBe(`****${plaintext.slice(-4)}`)
  })

  test('PATCH sensitive field with empty value returns unchanged=true (no-change branch)', async () => {
    // Arrange: register kaneo provider type and link a kaneo instance so the
    // sensitive `credential` field is visible in getConfigFieldsForContext().
    registerKaneoProviderType()
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'kaneo-t2', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'kaneo-t2', platformInstanceId: 'pi-1' })

    // Act: PATCH the sensitive field with an empty string value (masked-secret no-change signal).
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'credential', value: '' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))

    expect(res.status).toBe(200)
    const body = PatchUnchangedResponseSchema.parse(await res.json())
    expect(body.unchanged).toBe(true)
  })

  test('PATCH with unknown field key returns 422', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'not_a_real_field', value: 'some-value' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(422)
  })

  test('PATCH action:unset clears a configured field', async () => {
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    setConfigValue(personalConfigContextId, 'timezone', 'UTC')
    expect(getConfigValue(personalConfigContextId, 'timezone')).toBe('UTC')

    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unset', key: 'timezone' }),
      }),
      new URL('https://x/settings/api/config'),
    )

    expect(res.status).toBe(200)
    expect(getConfigValue(personalConfigContextId, 'timezone')).toBeNull()
  })

  test('PATCH action:unset with unknown key returns 422', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unset', key: 'not_a_real_field' }),
      }),
      new URL('https://x/settings/api/config'),
    )

    expect(res.status).toBe(422)
  })

  test('PATCH action:unset refuses excluded operational secrets (boundary)', async () => {
    // These live in system_config / their own stores and are NOT ConfigFields; they
    // must never be unsettable through this route. Each should 422 as "unknown config field".
    for (const key of ['llm_apikey', 'llm_baseurl', 'main_model', 'notify_token', 'stats_anonymity_salt']) {
      const res = await handleConfigRoutes(
        new Request('https://x/settings/api/config', {
          method: 'PATCH',
          headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unset', key }),
        }),
        new URL('https://x/settings/api/config'),
      )
      expect(res.status).toBe(422)
    }
  })

  test('GET forwards control and options for AI-output fields', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const detail = body.fields.find((f) => f.key === 'ai_output_detail_level')
    assert(detail, 'expected ai_output_detail_level field in GET response')
    expect(detail.control).toBe('select')
    expect(detail.options).toEqual([
      { value: 'sanitized', label: 'Sanitized' },
      { value: 'raw', label: 'Raw' },
    ])
  })

  test('PATCH sensitive field with masked value echoed back returns unchanged=true without overwriting stored secret', async () => {
    // Arrange: register kaneo provider type and link a kaneo instance so the
    // sensitive `credential` field is visible in getConfigFieldsForContext().
    registerKaneoProviderType()
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'kaneo-t3', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'kaneo-t3', platformInstanceId: 'pi-1' })

    // Seed a known plaintext value under the namespaced plugin credential key.
    const plaintext = 'my-secret-api-key'
    setConfigValue(personalConfigContextId, KANEO_PLUGIN_CREDENTIAL_KEY, plaintext)

    // Compute what the GET response would return for this sensitive field.
    const masked = maskSensitiveValue(plaintext)

    // Act: PATCH the field back with the masked value (simulating SPA echo).
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'credential', value: masked }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))

    // Assert: 200 with unchanged flag — the real secret must NOT have been overwritten.
    expect(res.status).toBe(200)
    const body = PatchUnchangedResponseSchema.parse(await res.json())
    expect(body.unchanged).toBe(true)
    assert(
      getConfigValue(personalConfigContextId, KANEO_PLUGIN_CREDENTIAL_KEY) === plaintext,
      'stored secret must not be overwritten with the masked sentinel value',
    )
  })

  test('GET returns the derived reasoning effort options for the active model', async () => {
    await prewarmCatalogue({
      'o4-reasoning': {
        limit: { context: 200_000, output: 100_000 },
        reasoning: true,
        reasoning_options: [{ kind: 'effort', values: ['low', 'high'] }],
      },
    })
    seedMainModel('o4-reasoning')

    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const effort = body.fields.find((f) => f.key === 'ai_reasoning_effort')
    expect(effort?.control).toBe('select')
    expect(effort?.options).toEqual([
      { value: '', label: 'Provider default' },
      { value: 'low', label: 'low' },
      { value: 'high', label: 'high' },
    ])
  })

  test('PATCH stores a union value while the active model is catalogue-unknown', async () => {
    await prewarmCatalogue({ 'other-model': { limit: { context: 1000 } } })
    seedMainModel('mystery-model')

    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_reasoning_effort', value: 'xhigh' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(200)
    const body = PatchResponseSchema.parse(await res.json())
    expect(getConfigValue(body.contextId, 'ai_reasoning_effort')).toBe('xhigh')
  })

  test('PATCH rejects a clearly invalid reasoning effort value with 422 listing the allowed set', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_reasoning_effort', value: 'bogus-level' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(422)
    const body = PatchErrorSchema.parse(await res.json())
    expect(body.error).toContain('must be one of:')
    expect(body.error).toContain('xhigh')
  })

  test('PATCH accepts the default sentinel as provider default', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_reasoning_effort', value: 'default' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(200)
    const body = PatchResponseSchema.parse(await res.json())
    expect(getConfigValue(body.contextId, 'ai_reasoning_effort')).toBe('default')
  })

  test('PATCH accepts clearing the reasoning effort value', async () => {
    const setReq = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_reasoning_effort', value: 'xhigh' }),
    })
    const setRes = await handleConfigRoutes(setReq, new URL('https://x/settings/api/config'))
    expect(setRes.status).toBe(200)
    const stored = PatchResponseSchema.parse(await setRes.json())

    const clearReq = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_reasoning_effort', value: '' }),
    })
    const clearRes = await handleConfigRoutes(clearReq, new URL('https://x/settings/api/config'))
    expect(clearRes.status).toBe(200)
    expect(getConfigValue(stored.contextId, 'ai_reasoning_effort')).toBe('')
  })
})
