// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminMcpCatalogRoutes } from '../../../../src/debug/settings/admin/mcp-catalog-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const CatalogResponseSchema = z.object({
  entries: z.array(
    z.object({
      name: z.string(),
      upstream_url: z.string(),
      host: z.string(),
      header: z.string().optional(),
      default_tool_policy: z.enum(['allow', 'ask', 'deny']).optional(),
      tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
    }),
  ),
})

describe('settings admin mcp-catalog routes', () => {
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

  test('non-admin cannot read the catalog', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const res = await handleAdminMcpCatalogRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(403)
  })

  test('GET returns an empty catalog by default', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const res = await handleAdminMcpCatalogRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(200)
    const body = CatalogResponseSchema.parse(await res.json())
    expect(body.entries).toEqual([])
  })

  test('POST kind:catalog persists entries and GET reflects them', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'catalog',
        entries: [
          {
            name: 'Jira',
            upstream_url: 'https://mcp.atlassian.com/v1',
            host: 'mcp.atlassian.com',
            default_tool_policy: 'allow',
          },
        ],
      }),
    })
    const res = await handleAdminMcpCatalogRoutes(req, url, url.pathname)
    expect(res.status).toBe(200)
    const body = CatalogResponseSchema.parse(await res.json())
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({
      name: 'Jira',
      upstream_url: 'https://mcp.atlassian.com/v1',
      host: 'mcp.atlassian.com',
      default_tool_policy: 'allow',
    })

    const getRes = await handleAdminMcpCatalogRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    const getBody = CatalogResponseSchema.parse(await getRes.json())
    expect(getBody.entries).toHaveLength(1)
    expect(getBody.entries[0]?.name).toBe('Jira')
  })

  test('POST without CSRF returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'catalog', entries: [] }),
    })
    const res = await handleAdminMcpCatalogRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('non-admin POST is rejected with 403', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'catalog', entries: [] }),
    })
    const res = await handleAdminMcpCatalogRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('POST with an invalid body returns 422', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'catalog', entries: [{ name: '', upstream_url: 'not-a-url', host: '' }] }),
    })
    const res = await handleAdminMcpCatalogRoutes(req, url, url.pathname)
    expect(res.status).toBe(422)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const res = await handleAdminMcpCatalogRoutes(
      new Request(url, { method: 'DELETE', headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(405)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-catalog')
    const res = await handleAdminMcpCatalogRoutes(new Request(url), url, url.pathname)
    expect(res.status).toBe(401)
  })
})
