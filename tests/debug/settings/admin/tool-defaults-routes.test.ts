// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminToolDefaultsRoutes } from '../../../../src/debug/settings/admin/tool-defaults-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { adminToolDefaultsContextId, getAdminToolDefaults } from '../../../../src/tools/admin-tool-defaults.js'
import { detectActivePreset, getToolPrefs } from '../../../../src/tools/tool-preferences.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const ToolsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(z.unknown()),
  activePreset: z.string().nullable(),
})

describe('settings admin tool-defaults routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('GET returns 200 with contextId, domains, and activePreset null by default', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(adminToolDefaultsContextId('pi-1'))
    expect(Array.isArray(body.domains)).toBe(true)
    expect(body.activePreset).toBeNull()
  })

  test('POST preset read-only → 200, getAdminToolDefaults non-null, detectActivePreset === read-only', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    expect(body.activePreset).toBe('read-only')
    const defaults = getAdminToolDefaults('pi-1')
    expect(defaults).not.toBeNull()
    const prefs = getToolPrefs(adminToolDefaultsContextId('pi-1'))
    expect(detectActivePreset(prefs)).toBe('read-only')
  })

  test('POST domain deny → 200, admin prefs reflect it', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'web', permission: 'deny' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    const DomainSchema = z.object({ domain: z.string(), summary: z.string() })
    const domains = z.array(DomainSchema).parse(body.domains)
    const webDomain = domains.find((d) => d.domain === 'web')
    expect(webDomain?.summary).toBe('deny')
  })

  test('POST tool ask → 200, web_fetch permission is ask', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: 'web_fetch', permission: 'ask' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    const DomainToolSchema = z.object({
      domain: z.string(),
      tools: z.array(z.object({ name: z.string(), permission: z.string() })),
    })
    const domains = z.array(DomainToolSchema).parse(body.domains)
    const webDomain = domains.find((d) => d.domain === 'web')
    const webFetch = webDomain?.tools.find((t) => t.name === 'web_fetch')
    expect(webFetch?.permission).toBe('ask')
  })

  test('POST unknown domain → 422', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'nonexistent-domain-xyz', permission: 'deny' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('unknown tool domain')
  })

  test('POST unknown tool → 422', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: 'does_not_exist_tool_xyz', permission: 'ask' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('unknown tool')
  })

  test('non-admin GET → 403', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(403)
  })

  test('non-admin POST → 403', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST without CSRF → 403', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(403)
  })
})
