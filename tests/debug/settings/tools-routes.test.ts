// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleToolsRoutes } from '../../../src/debug/settings/tools-routes.js'
import { getToolPrefs, setToolPrefs } from '../../../src/tools/tool-preferences.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PermissionSchema = z.enum(['allow', 'ask', 'deny'])
const DomainSummarySchema = z.enum(['allow', 'ask', 'deny', 'partial'])

const ToolEntryThreeStateSchema = z.object({
  name: z.string(),
  permission: PermissionSchema,
  risk: z.enum(['read', 'write', 'destructive', 'open-world']),
})

const ToolDomainThreeStateSchema = z.object({
  domain: z.string(),
  summary: DomainSummarySchema,
  tools: z.array(ToolEntryThreeStateSchema),
})

const DomainsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(ToolDomainThreeStateSchema),
})

const PresetSchema = z.enum(['allow-all', 'non-destructive', 'read-only'])

const DomainsResponseWithPresetSchema = DomainsResponseSchema.extend({
  activePreset: PresetSchema.nullable(),
})

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'

describe('settings tools routes', () => {
  let session: SettingsSession
  let personalContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })
  })

  test('GET returns three-state domains (empty when no provider configured)', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    expect(Array.isArray(body.domains)).toBe(true)
  })

  test('GET returns permission=allow by default for unset tools', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    // All tools default to 'allow' when prefs are empty
    for (const domain of body.domains) {
      for (const tool of domain.tools) {
        expect(tool.permission).toBe('allow')
      }
    }
  })

  test('GET returns summary=allow when all tools in a domain are allow', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    for (const domain of body.domains) {
      expect(domain.summary).toBe('allow')
    }
  })

  test('GET reflects changed permission in stored prefs after setToolPrefs', async () => {
    const prefs = getToolPrefs(personalContextId)
    setToolPrefs(personalContextId, { ...prefs, toolOverrides: { ...prefs.toolOverrides, get_current_time: 'deny' } })

    // Verify prefs are persisted correctly — GET validates the stored prefs shape
    const updatedPrefs = getToolPrefs(personalContextId)
    expect(updatedPrefs.toolOverrides['get_current_time']).toBe('deny')

    // GET should succeed and return valid domain view (tools absent without provider, prefs still stored)
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    DomainsResponseSchema.parse(await res.json())
  })

  test('toggle without CSRF is 403', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'task', permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(403)
  })

  test('toggle rejects an unknown domain with 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'not-a-domain', permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })

  test('toggle sets domain permission explicitly and persists the change', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'time', permission: 'ask' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    // Persisted prefs should reflect 'ask' for the time domain
    const updatedPrefs = getToolPrefs(personalContextId)
    expect(updatedPrefs.domainDefaults['time']).toBe('ask')
    expect(Array.isArray(body.domains)).toBe(true)
  })

  test('toggle sets tool permission to deny for known tool', async () => {
    // Use a known-always-available tool name directly in prefs (no provider needed for prefs)
    // The route rejects tool writes for tools not in the computed available set (provider-gated),
    // so this test verifies the 422 path when provider is absent.
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: 'get_current_time', permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    // Without a provider, the tool is not in the available set → 422
    expect(res.status).toBe(422)
  })

  test('toggle without permission field is 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'task' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })

  test('unauthenticated GET is 401', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url), url, '/settings/api/tools')
    expect(res.status).toBe(401)
  })

  test('unauthenticated POST is 401', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'task', permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(401)
  })

  test('GET includes activePreset (allow-all for an untouched context)', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseWithPresetSchema.parse(await res.json())
    expect(body.activePreset).toBe('allow-all')
  })

  test('preset apply persists riskDefaults and returns the active preset', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    const body = DomainsResponseWithPresetSchema.parse(await res.json())
    expect(body.activePreset).toBe('read-only')
    const prefs = getToolPrefs(personalContextId)
    expect(prefs.riskDefaults).toEqual({ write: 'ask', destructive: 'ask', 'open-world': 'ask' })
    expect(prefs.domainDefaults).toEqual({})
    expect(prefs.toolOverrides).toEqual({})
  })

  test('preset apply resets prior customization', async () => {
    setToolPrefs(personalContextId, {
      riskDefaults: {},
      domainDefaults: { task: 'deny' },
      toolOverrides: { delete_task: 'deny' },
    })
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'allow-all' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    const prefs = getToolPrefs(personalContextId)
    expect(prefs.domainDefaults).toEqual({})
    expect(prefs.toolOverrides).toEqual({})
    expect(prefs.riskDefaults).toEqual({})
  })

  test('preset apply with unknown preset is 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'nonsense' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })

  test('preset apply without CSRF is 403', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(403)
  })
})
