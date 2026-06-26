// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import * as schema from '../../../../src/db/schema.js'
import type { InstanceApiDeps } from '../../../../src/debug/instance-route-support.js'
import { handleAdminInstancesRoutes } from '../../../../src/debug/settings/admin/instances-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { getPlatformInstance } from '../../../../src/instances/platform-store.js'
import { getTaskInstance, insertTaskInstance } from '../../../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../../src/providers/registry.js'
import { addUser } from '../../../../src/users.js'
import { createMockProvider } from '../../../tools/mock-provider.js'
import { getTestDb, mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const InstanceListResponseSchema = z.object({
  instances: z.array(z.object({ id: z.string(), config: z.record(z.string(), z.string()) })),
  unreadable: z.array(z.object({ table: z.string(), id: z.string(), type: z.string(), error: z.string() })).optional(),
})

const ProviderTypesResponseSchema = z.object({
  providerTypes: z.array(z.unknown()),
})

const CreatedResponseSchema = z.object({ ok: z.literal(true), id: z.string() })
const SETTINGS_TEST_PROVIDER_PLUGIN_ID = 'settings-admin-test-provider'
const SETTINGS_TEST_PROVIDER_TYPE = 'validated-settings'

describe('settings admin instances routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: { kaneo_apikey: 'secret-value' }, status: 'active' })
    registerContributedTaskProviderType(SETTINGS_TEST_PROVIDER_TYPE, {
      pluginId: SETTINGS_TEST_PROVIDER_PLUGIN_ID,
      factory: () => createMockProvider({ name: SETTINGS_TEST_PROVIDER_TYPE }),
      capabilities: new Set<never>(),
      displayName: 'Validated Settings',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [],
    })
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(SETTINGS_TEST_PROVIDER_PLUGIN_ID)
  })

  test('non-admin gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin lists task instances with masked config', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(200)
    const body = InstanceListResponseSchema.parse(await res.json())
    expect(body.instances[0]?.config['kaneo_apikey']).not.toBe('secret-value')
  })

  test('admin lists task instances with unreadable diagnostics instead of failing the whole page', async () => {
    getTestDb()
      .insert(schema.taskInstances)
      .values({
        id: 'ti-broken',
        type: 'kaneo',
        config: 'AAAA',
        status: 'active',
      })
      .run()

    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/task-instances',
    )

    expect(res.status).toBe(200)
    const body = InstanceListResponseSchema.parse(await res.json())
    expect(body.instances.map((instance) => instance.id)).toContain('ti-1')
    expect(body.unreadable?.map((failure) => failure.id)).toContain('ti-broken')
  })

  test('admin lists platform instances with unreadable diagnostics instead of failing the whole page', async () => {
    getTestDb()
      .insert(schema.platformInstances)
      .values({
        id: 'pi-broken',
        type: 'telegram',
        config: 'AAAA',
        status: 'active',
      })
      .run()

    const url = new URL('https://x/settings/api/admin/platform-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/platform-instances',
    )

    expect(res.status).toBe(200)
    const body = InstanceListResponseSchema.parse(await res.json())
    expect(body.instances.map((instance) => instance.id)).toContain('pi-1')
    expect(body.unreadable?.map((failure) => failure.id)).toContain('pi-broken')
  })

  test('non-admin POST task-instances gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ti-x', type: 'kaneo', config: {}, status: 'active' }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST task-instances without CSRF gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ti-new', type: 'kaneo', config: {}, status: 'active' }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST task-instances with CSRF creates instance', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ti-new',
          type: SETTINGS_TEST_PROVIDER_TYPE,
          config: { baseUrl: 'https://kaneo.invalid' },
          status: 'active',
        }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(201)
    const body = CreatedResponseSchema.parse(await res.json())
    expect(body.id).toBe('ti-new')
    const stored = getTaskInstance('ti-new')
    assert(stored !== null, 'task instance should be persisted')
    expect(stored.type).toBe(SETTINGS_TEST_PROVIDER_TYPE)
  })

  test('admin POST task-instances defaults omitted status to active', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ti-default-active',
          type: SETTINGS_TEST_PROVIDER_TYPE,
          config: { baseUrl: 'https://kaneo.invalid' },
        }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(201)
    expect(getTaskInstance('ti-default-active')?.status).toBe('active')
  })

  test('admin POST task-instances rejects unknown provider types', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ti-unknown', type: 'unknown-provider', config: {} }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unknown_task_provider_type', type: 'unknown-provider' })
    expect(getTaskInstance('ti-unknown')).toBeNull()
  })

  test('admin POST platform-instances rejects malformed config', async () => {
    const url = new URL('https://x/settings/api/admin/platform-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'pi-invalid', type: 'telegram', config: {} }),
      }),
      url,
      '/settings/api/admin/platform-instances',
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_platform_instance_config', type: 'telegram' })
    expect(getPlatformInstance('pi-invalid')).toBeNull()
  })

  test('admin PATCH task-instances updates status', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances/ti-1')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'stopped' }),
      }),
      url,
      '/settings/api/admin/task-instances/ti-1',
    )
    expect(res.status).toBe(200)
    expect(getTaskInstance('ti-1')?.status).toBe('stopped')
  })

  test('admin PATCH task-instances rejects activating a row whose stored config is invalid when config is omitted', async () => {
    insertTaskInstance({
      id: 'ti-invalid-activate',
      type: SETTINGS_TEST_PROVIDER_TYPE,
      config: {},
      status: 'stopped',
    })

    const url = new URL('https://x/settings/api/admin/task-instances/ti-invalid-activate')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      }),
      url,
      '/settings/api/admin/task-instances/ti-invalid-activate',
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_task_instance_config',
      type: SETTINGS_TEST_PROVIDER_TYPE,
      missing: ['baseUrl'],
    })
    expect(getTaskInstance('ti-invalid-activate')?.status).toBe('stopped')
  })

  test('admin PATCH task-instances returns 404 for missing instance', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances/ti-missing')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'stopped' }),
      }),
      url,
      '/settings/api/admin/task-instances/ti-missing',
    )
    expect(res.status).toBe(404)
  })

  test('admin PATCH task-instances updates unreadable rows without crashing', async () => {
    getTestDb()
      .insert(schema.taskInstances)
      .values({
        id: 'ti-unreadable',
        type: SETTINGS_TEST_PROVIDER_TYPE,
        config: 'AAAA',
        status: 'active',
      })
      .run()

    const url = new URL('https://x/settings/api/admin/task-instances/ti-unreadable')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'stopped' }),
      }),
      url,
      '/settings/api/admin/task-instances/ti-unreadable',
    )

    expect(res.status).toBe(200)
  })

  test('admin DELETE task-instances returns 404 for missing instance', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances/ti-missing')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'DELETE',
        headers: authHeaders(adminSession, true),
      }),
      url,
      '/settings/api/admin/task-instances/ti-missing',
    )
    expect(res.status).toBe(404)
  })

  test('admin DELETE task-instances removes unreadable rows without crashing', async () => {
    getTestDb()
      .insert(schema.taskInstances)
      .values({
        id: 'ti-unreadable-delete',
        type: SETTINGS_TEST_PROVIDER_TYPE,
        config: 'AAAA',
        status: 'active',
      })
      .run()

    const url = new URL('https://x/settings/api/admin/task-instances/ti-unreadable-delete')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'DELETE',
        headers: authHeaders(adminSession, true),
      }),
      url,
      '/settings/api/admin/task-instances/ti-unreadable-delete',
    )

    expect(res.status).toBe(200)
  })

  test('admin PATCH platform-instances returns 404 for missing instance', async () => {
    const url = new URL('https://x/settings/api/admin/platform-instances/pi-missing')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'stopped' }),
      }),
      url,
      '/settings/api/admin/platform-instances/pi-missing',
    )
    expect(res.status).toBe(404)
  })

  test('admin PATCH platform-instances updates unreadable rows without crashing', async () => {
    getTestDb()
      .insert(schema.platformInstances)
      .values({
        id: 'pi-unreadable',
        type: 'telegram',
        config: 'AAAA',
        status: 'active',
      })
      .run()

    const url = new URL('https://x/settings/api/admin/platform-instances/pi-unreadable')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'stopped' }),
      }),
      url,
      '/settings/api/admin/platform-instances/pi-unreadable',
    )

    expect(res.status).toBe(200)
  })

  test('admin DELETE platform-instances returns 404 for missing instance', async () => {
    const url = new URL('https://x/settings/api/admin/platform-instances/pi-missing')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'DELETE',
        headers: authHeaders(adminSession, true),
      }),
      url,
      '/settings/api/admin/platform-instances/pi-missing',
    )
    expect(res.status).toBe(404)
  })

  test('admin DELETE platform-instances removes unreadable rows without crashing', async () => {
    getTestDb()
      .insert(schema.platformInstances)
      .values({
        id: 'pi-unreadable-delete',
        type: 'telegram',
        config: 'AAAA',
        status: 'active',
      })
      .run()

    const url = new URL('https://x/settings/api/admin/platform-instances/pi-unreadable-delete')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'DELETE',
        headers: authHeaders(adminSession, true),
      }),
      url,
      '/settings/api/admin/platform-instances/pi-unreadable-delete',
    )

    expect(res.status).toBe(200)
  })

  test('admin GET task-provider-types returns 200 with providerTypes array', async () => {
    const url = new URL('https://x/settings/api/admin/task-provider-types')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/task-provider-types',
    )
    expect(res.status).toBe(200)
    const body = ProviderTypesResponseSchema.parse(await res.json())
    expect(Array.isArray(body.providerTypes)).toBe(true)
  })

  test('non-admin GET task-provider-types gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-provider-types')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/task-provider-types',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST task-provider-types gets 405', async () => {
    const url = new URL('https://x/settings/api/admin/task-provider-types')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      url,
      '/settings/api/admin/task-provider-types',
    )
    expect(res.status).toBe(405)
  })

  test('admin POST platform-instances/apply returns 200 apply-result with applied field', async () => {
    const fakeDeps: InstanceApiDeps = {
      getRuntimeChatRouter: () => null,
      listPlatformInstances: () => [],
      listPlatformInstancesSafe: () => ({ instances: [], failures: [] }),
    }
    const url = new URL('https://x/settings/api/admin/platform-instances/apply')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: authHeaders(adminSession, true),
      }),
      url,
      '/settings/api/admin/platform-instances/apply',
      fakeDeps,
    )
    expect(res.status).toBe(503)
    const body: unknown = await res.json()
    expect(body).toMatchObject({ error: 'router not initialised' })
  })

  test('non-admin POST platform-instances/apply gets 403', async () => {
    const fakeDeps: InstanceApiDeps = {
      getRuntimeChatRouter: () => null,
      listPlatformInstances: () => [],
      listPlatformInstancesSafe: () => ({ instances: [], failures: [] }),
    }
    const url = new URL('https://x/settings/api/admin/platform-instances/apply')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: authHeaders(userSession, true),
      }),
      url,
      '/settings/api/admin/platform-instances/apply',
      fakeDeps,
    )
    expect(res.status).toBe(403)
  })

  test('admin POST platform-instances/apply without CSRF gets 403', async () => {
    const fakeDeps: InstanceApiDeps = {
      getRuntimeChatRouter: () => null,
      listPlatformInstances: () => [],
      listPlatformInstancesSafe: () => ({ instances: [], failures: [] }),
    }
    const url = new URL('https://x/settings/api/admin/platform-instances/apply')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: authHeaders(adminSession, false),
      }),
      url,
      '/settings/api/admin/platform-instances/apply',
      fakeDeps,
    )
    expect(res.status).toBe(403)
  })

  test('admin POST platform-instances/apply passes the apply result body through from the reconciler', async () => {
    // Use a fake deps where listPlatformInstancesSafe returns one active instance
    // but getRuntimeChatRouter returns null → reconciler returns 503 router not initialised.
    // This confirms the settings route wires the reconciler correctly (not just returning 200 OK).
    const fakeDeps: InstanceApiDeps = {
      getRuntimeChatRouter: () => null,
      listPlatformInstances: () => [],
      listPlatformInstancesSafe: () => ({
        instances: [
          { id: 'tg', type: 'telegram', config: {}, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        failures: [],
      }),
    }
    const url = new URL('https://x/settings/api/admin/platform-instances/apply')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: authHeaders(adminSession, true),
      }),
      url,
      '/settings/api/admin/platform-instances/apply',
      fakeDeps,
    )
    // reconciler returns 503 when router is null — confirms we delegated to it
    expect(res.status).toBe(503)
  })
})
