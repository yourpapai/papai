// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminModuleSectionsRoutes } from '../../../../src/debug/settings/admin/module-sections-routes.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { getPluginAdminConfig } from '../../../../src/plugins/store.js'
import { moduleSettingsRegistry } from '../../../../src/ports/settings-sections.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

describe('settings admin module-sections routes', () => {
  let botAdminSession: SettingsSession
  let plainSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    moduleSettingsRegistry.clear()
    moduleSettingsRegistry.register([
      {
        id: 'acp',
        label: 'Coding sessions (magi)',
        fields: [
          { key: 'magi_base_url', label: 'Magi Base URL', required: true },
          { key: 'magi_token', label: 'Magi Token', required: true, sensitive: true },
        ],
      },
    ])
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addUser({ userId: 'plain-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
    plainSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'plain-1' })
  })

  afterEach(() => {
    moduleSettingsRegistry.clear()
  })

  test('GET as admin returns registered sections', async () => {
    const url = new URL('https://x/settings/api/admin/module-sections')
    const res = await handleAdminModuleSectionsRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(botAdminSession) }),
      url,
      '/settings/api/admin/module-sections',
    )
    expect(res.status).toBe(200)
    const body = z
      .object({
        sections: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            fields: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                value: z.string().nullable(),
                sensitive: z.boolean(),
                required: z.boolean(),
              }),
            ),
          }),
        ),
      })
      .parse(await res.json())
    expect(body.sections).toHaveLength(1)
    expect(body.sections[0]!.id).toBe('acp')
    const keys = body.sections[0]!.fields.map((f) => f.key)
    expect(keys).toContain('magi_base_url')
    expect(keys).toContain('magi_token')
  })

  test('PATCH set as admin persists the value', async () => {
    const url = new URL('https://x/settings/api/admin/module-sections')
    const res = await handleAdminModuleSectionsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'acp', key: 'magi_base_url', value: 'https://magi.example' }),
      }),
      url,
      '/settings/api/admin/module-sections',
    )
    expect(res.status).toBe(200)
    const body = z
      .object({ ok: z.literal(true), id: z.string(), key: z.string(), updatedAt: z.number() })
      .parse(await res.json())
    expect(body.id).toBe('acp')
    expect(body.key).toBe('magi_base_url')
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://magi.example')
  })

  test('PATCH with unknown section id returns 422', async () => {
    const url = new URL('https://x/settings/api/admin/module-sections')
    const res = await handleAdminModuleSectionsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'no-such-section', key: 'magi_base_url', value: 'val' }),
      }),
      url,
      '/settings/api/admin/module-sections',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toContain('no-such-section')
  })

  test('GET as non-admin returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/module-sections')
    const res = await handleAdminModuleSectionsRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(plainSession) }),
      url,
      '/settings/api/admin/module-sections',
    )
    expect(res.status).toBe(403)
  })
})
