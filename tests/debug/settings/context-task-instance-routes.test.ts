// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleContextTaskInstanceRoutes } from '../../../src/debug/settings/context-task-instance-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { getContextSettings, setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../src/providers/registry.js'
import { addUser } from '../../../src/users.js'
import { createMockProvider } from '../../tools/mock-provider.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const ENDPOINT = 'https://x/settings/api/context/task-instance'

const TaskInstanceGetSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string().optional() })),
  canProvision: z.boolean(),
})

/** A provisionable provider type scoped to this suite, cleaned up in afterEach. */
const PROVISIONABLE_PLUGIN_ID = 'test-ctxti-provisionable'
const PROVISIONABLE_TYPE = 'ctxti-kaneo'
function registerProvisionableType(): void {
  registerContributedTaskProviderType(PROVISIONABLE_TYPE, {
    pluginId: PROVISIONABLE_PLUGIN_ID,
    factory: () => createMockProvider({ name: PROVISIONABLE_TYPE }),
    provision: () => Promise.resolve({ status: 'failed', error: 'test' }),
    capabilities: new Set(),
    displayName: 'Provisionable',
  })
}

/** The personal config context id for the test principal (u-1 on pi-1). */
const personalContextId = (): string => toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })

/** Seed a manageable group for the test principal and return its contextId. */
function seedManageableGroup(): string {
  const scopedGroupId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'grp-1' })
  upsertKnownGroupContext({
    contextId: scopedGroupId,
    provider: 'telegram',
    displayName: 'Test Group',
    parentName: null,
  })
  upsertGroupAdminObservation({
    contextId: scopedGroupId,
    provider: 'telegram',
    userId: 'u-1',
    username: 'u-1',
    isAdmin: true,
  })
  addAuthorizedGroup(scopedGroupId, 'u-1')
  return scopedGroupId
}

function getReq(session: SettingsSession, contextId?: string): Request {
  const url = new URL(ENDPOINT)
  if (contextId !== undefined) url.searchParams.set('contextId', contextId)
  return new Request(url, { headers: authHeaders(session) })
}

function patchReq(session: SettingsSession, body: Record<string, unknown>, opts: { csrf?: boolean } = {}): Request {
  return new Request(ENDPOINT, {
    method: 'PATCH',
    headers: { ...authHeaders(session, opts.csrf ?? true), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('settings context task-instance routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(PROVISIONABLE_PLUGIN_ID)
  })

  test('GET without a session is 401', async () => {
    const res = await handleContextTaskInstanceRoutes(new Request(ENDPOINT), new URL(ENDPOINT))
    expect(res.status).toBe(401)
  })

  test('GET for personal context returns empty available when no instances exist', async () => {
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    expect(res.status).toBe(200)
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.contextId).toBe(personalContextId())
    expect(body.taskInstanceId).toBeNull()
    expect(body.available).toEqual([])
  })

  test('GET lists only active instances', async () => {
    insertTaskInstance({ id: 'yt-default', type: 'youtrack', config: {}, status: 'active' })
    insertTaskInstance({ id: 'yt-pending', type: 'youtrack', config: {}, status: 'pending' })
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.available.map((a) => a.id)).toEqual(['yt-default'])
  })

  test('GET reflects an existing binding', async () => {
    insertTaskInstance({ id: 'yt-default', type: 'youtrack', config: {}, status: 'active' })
    setContextSettings({ contextId: personalContextId(), taskInstanceId: 'yt-default', platformInstanceId: 'pi-1' })
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.taskInstanceId).toBe('yt-default')
  })

  test('GET canProvision is false when no instance is bound', async () => {
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.canProvision).toBe(false)
  })

  test('GET canProvision is false when bound to a non-provisionable instance', async () => {
    insertTaskInstance({ id: 'yt-default', type: 'youtrack', config: {}, status: 'active' })
    setContextSettings({ contextId: personalContextId(), taskInstanceId: 'yt-default', platformInstanceId: 'pi-1' })
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.canProvision).toBe(false)
  })

  test('GET canProvision is true when bound to an active provisionable instance', async () => {
    registerProvisionableType()
    insertTaskInstance({ id: 'kaneo-1', type: PROVISIONABLE_TYPE, config: {}, status: 'active' })
    setContextSettings({ contextId: personalContextId(), taskInstanceId: 'kaneo-1', platformInstanceId: 'pi-1' })
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.canProvision).toBe(true)
  })

  test('PATCH binds an active instance to the personal context, then GET reflects it', async () => {
    insertTaskInstance({ id: 'yt-default', type: 'youtrack', config: {}, status: 'active' })
    const res = await handleContextTaskInstanceRoutes(
      patchReq(session, { taskInstanceId: 'yt-default' }),
      new URL(ENDPOINT),
    )
    expect(res.status).toBe(200)
    expect(getContextSettings(personalContextId())?.taskInstanceId).toBe('yt-default')

    const getUrl = getReq(session)
    const getRes = await handleContextTaskInstanceRoutes(getUrl, new URL(getUrl.url))
    const body = TaskInstanceGetSchema.parse(await getRes.json())
    expect(body.taskInstanceId).toBe('yt-default')
  })

  test('PATCH without CSRF is 403', async () => {
    insertTaskInstance({ id: 'yt-default', type: 'youtrack', config: {}, status: 'active' })
    const res = await handleContextTaskInstanceRoutes(
      patchReq(session, { taskInstanceId: 'yt-default' }, { csrf: false }),
      new URL(ENDPOINT),
    )
    expect(res.status).toBe(403)
  })

  test('PATCH with an unknown instance is 422', async () => {
    const res = await handleContextTaskInstanceRoutes(patchReq(session, { taskInstanceId: 'nope' }), new URL(ENDPOINT))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'unknown task instance' })
  })

  test('PATCH with an inactive instance is 422', async () => {
    insertTaskInstance({ id: 'yt-pending', type: 'youtrack', config: {}, status: 'pending' })
    const res = await handleContextTaskInstanceRoutes(
      patchReq(session, { taskInstanceId: 'yt-pending' }),
      new URL(ENDPOINT),
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'inactive task instance' })
  })

  test('PATCH with a missing taskInstanceId is 422', async () => {
    const res = await handleContextTaskInstanceRoutes(patchReq(session, {}), new URL(ENDPOINT))
    expect(res.status).toBe(422)
  })

  test('binds a group context via the same endpoint (context-agnostic)', async () => {
    const groupContextId = seedManageableGroup()
    insertTaskInstance({ id: 'yt-default', type: 'youtrack', config: {}, status: 'active' })
    const res = await handleContextTaskInstanceRoutes(
      patchReq(session, { taskInstanceId: 'yt-default', contextId: groupContextId }),
      new URL(ENDPOINT),
    )
    expect(res.status).toBe(200)
    expect(getContextSettings(groupContextId)?.taskInstanceId).toBe('yt-default')
  })

  test('GET surfaces config.baseUrl as the option name', async () => {
    insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { baseUrl: 'https://kaneo.example' }, status: 'active' })
    insertTaskInstance({ id: 'bare', type: 'youtrack', config: {}, status: 'active' })
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    const byId = Object.fromEntries(body.available.map((a) => [a.id, a]))
    expect(byId['kaneo-a']?.name).toBe('https://kaneo.example')
    expect(byId['bare']?.name).toBeUndefined()
  })

  test('unsupported method is 405', async () => {
    const res = await handleContextTaskInstanceRoutes(
      new Request(ENDPOINT, { method: 'DELETE', headers: authHeaders(session, true) }),
      new URL(ENDPOINT),
    )
    expect(res.status).toBe(405)
  })
})
