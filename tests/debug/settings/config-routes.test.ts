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

const KANEO_PLUGIN_ID = 'task-provider-kaneo'

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
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
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
})
