// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminMcpRedactionRoutes } from '../../../../src/debug/settings/admin/mcp-redaction-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const ConfigSchema = z.object({
  model_url: z.string(),
  model_name: z.string(),
  timeout_ms: z.number().optional(),
  api_key_set: z.boolean(),
})
const ResponseSchema = z.object({ config: ConfigSchema.nullable() })

describe('settings admin mcp-redaction routes', () => {
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

  test('GET returns config: null when unset', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const res = await handleAdminMcpRedactionRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(200)
    const body = ResponseSchema.parse(await res.json())
    expect(body.config).toBeNull()
  })

  test('non-admin cannot read', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const res = await handleAdminMcpRedactionRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(403)
  })

  test('PUT persists config with api_key masked; GET reflects it without the raw secret', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const req = new Request(url, {
      method: 'PUT',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_url: 'https://redactor.example.com/v1',
        api_key: 'super-secret-key',
        model_name: 'redactor-model',
        timeout_ms: 5000,
      }),
    })
    const res = await handleAdminMcpRedactionRoutes(req, url, url.pathname)
    expect(res.status).toBe(200)
    const putBodyText = await res.text()
    expect(putBodyText).not.toContain('super-secret-key')
    const putBody = ResponseSchema.parse(JSON.parse(putBodyText))
    expect(putBody.config).toEqual({
      model_url: 'https://redactor.example.com/v1',
      model_name: 'redactor-model',
      timeout_ms: 5000,
      api_key_set: true,
    })

    const getRes = await handleAdminMcpRedactionRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    const getBodyText = await getRes.text()
    expect(getBodyText).not.toContain('super-secret-key')
    const getBody = ResponseSchema.parse(JSON.parse(getBodyText))
    expect(getBody.config).toEqual({
      model_url: 'https://redactor.example.com/v1',
      model_name: 'redactor-model',
      timeout_ms: 5000,
      api_key_set: true,
    })
  })

  test('PUT rejects a non-https model_url with 422', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const req = new Request(url, {
      method: 'PUT',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_url: 'http://redactor.example.com/v1',
        api_key: 'super-secret-key',
        model_name: 'redactor-model',
      }),
    })
    const res = await handleAdminMcpRedactionRoutes(req, url, url.pathname)
    expect(res.status).toBe(422)
  })

  test('PUT rejects a missing model_name with 422', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const req = new Request(url, {
      method: 'PUT',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_url: 'https://redactor.example.com/v1',
        api_key: 'super-secret-key',
      }),
    })
    const res = await handleAdminMcpRedactionRoutes(req, url, url.pathname)
    expect(res.status).toBe(422)
  })

  test('PUT without CSRF returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const req = new Request(url, {
      method: 'PUT',
      headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_url: 'https://redactor.example.com/v1',
        api_key: 'super-secret-key',
        model_name: 'redactor-model',
      }),
    })
    const res = await handleAdminMcpRedactionRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('non-admin PUT is rejected with 403', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const req = new Request(url, {
      method: 'PUT',
      headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_url: 'https://redactor.example.com/v1',
        api_key: 'super-secret-key',
        model_name: 'redactor-model',
      }),
    })
    const res = await handleAdminMcpRedactionRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const res = await handleAdminMcpRedactionRoutes(
      new Request(url, { method: 'DELETE', headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(405)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-redaction')
    const res = await handleAdminMcpRedactionRoutes(new Request(url), url, url.pathname)
    expect(res.status).toBe(401)
  })
})
