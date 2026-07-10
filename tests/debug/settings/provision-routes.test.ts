// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleProvisionKaneo } from '../../../src/debug/settings/provision-routes.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  type TaskProviderProvision,
  type TaskProviderProvisionContext,
} from '../../../src/providers/registry.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { createMockProvider } from '../../tools/mock-provider.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const UnsupportedProvisionResponseSchema = z.object({ status: z.string() })
const SuccessfulProvisionResponseSchema = z.object({ status: z.string(), email: z.string() })

describe('settings kaneo provision route', () => {
  let session: SettingsSession
  let provisionCalls: TaskProviderProvisionContext[]
  const provision: TaskProviderProvision = (ctx) => {
    provisionCalls.push(ctx)
    return Promise.resolve({ status: 'failed', error: 'Kaneo task instance public URL is missing' })
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'ti-kaneo', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'ti-kaneo', platformInstanceId: 'pi-1' })
    provisionCalls = []
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'task-provider-kaneo',
      factory: () => createMockProvider({ name: 'kaneo' }),
      provision,
      capabilities: new Set(),
      displayName: 'Kaneo',
    })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
  })

  test('non-POST returns 405', async () => {
    const res = await handleProvisionKaneo(new Request('https://x/settings/api/provision/kaneo', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  test('POST without CSRF is 403', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('dispatches to the registry provision hook for the assigned task instance type', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
    expect(provisionCalls).toHaveLength(1)
    expect(provisionCalls[0]!.contextId).toBe(resolveSettingsPrincipal('pi-1', 'u-1').personalConfigContextId)
    expect(provisionCalls[0]!.publicUrl).toBeUndefined()
    expect(provisionCalls[0]!.internalUrl).toBeUndefined()
  })

  test('sources publicUrl/internalUrl from the bound task instance config, not global env', async () => {
    delete process.env['KANEO_CLIENT_URL']
    delete process.env['KANEO_INTERNAL_URL']
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({
      id: 'ti-kaneo-configured',
      type: 'kaneo',
      config: { baseUrl: 'https://pub.example', internalUrl: 'https://int.example' },
      status: 'active',
    })
    setContextSettings({
      contextId: personalConfigContextId,
      taskInstanceId: 'ti-kaneo-configured',
      platformInstanceId: 'pi-1',
    })

    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
    expect(provisionCalls).toHaveLength(1)
    expect(provisionCalls[0]!.publicUrl).toBe('https://pub.example')
    expect(provisionCalls[0]!.internalUrl).toBe('https://int.example')
  })

  test('returns 422 with unsupported when the task instance type has no provision hook', async () => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'ti-yt', type: 'youtrack', config: {}, status: 'active' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'ti-yt', platformInstanceId: 'pi-1' })

    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
    const body = UnsupportedProvisionResponseSchema.parse(await res.json())
    expect(body.status).toBe('unsupported')
  })

  test('returns 200 with credentials when the provision hook reports provisioned', async () => {
    const successHook: TaskProviderProvision = () =>
      Promise.resolve({
        status: 'provisioned',
        email: 'u@example.com',
        password: 'pw',
        instanceUrl: 'https://k.example.com',
        apiKey: 'k',
        workspaceId: 'ws',
      })
    unregisterContributedTaskProviderType('task-provider-kaneo')
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'task-provider-kaneo',
      factory: () => createMockProvider({ name: 'kaneo' }),
      provision: successHook,
      capabilities: new Set(),
      displayName: 'Kaneo',
    })

    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(200)
    const body = SuccessfulProvisionResponseSchema.parse(await res.json())
    expect(body.status).toBe('provisioned')
    expect(body.email).toBe('u@example.com')
  })
})
