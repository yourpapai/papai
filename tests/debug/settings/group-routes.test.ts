// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { ChatRouter } from '../../../src/chat/router.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { taskInstances } from '../../../src/db/instance-schema.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../../src/debug/chat-router-runtime.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { getContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { addUser } from '../../../src/users.js'
import { getTestDb, mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const MembersResponseSchema = z.object({ contextId: z.string(), members: z.array(z.unknown()) })
const MembersDetailSchema = z.object({
  contextId: z.string(),
  members: z.array(z.object({ user_id: z.string(), added_by: z.string(), added_at: z.string() })),
})
const MembersLabelSchema = z.object({
  contextId: z.string(),
  members: z.array(
    z.object({
      user_id: z.string(),
      added_by: z.string(),
      added_at: z.string(),
      user_label: z.string().nullable(),
      added_by_label: z.string().nullable(),
    }),
  ),
})
const TaskInstanceGetSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string() })),
  canProvision: z.boolean(),
})

const mockResolveUserId = mock((username: string, _context?: unknown) => {
  if (username.includes('ghost')) return Promise.resolve<string | null>(null)
  return Promise.resolve<string | null>(/^\d+$/u.test(username) ? username : `resolved-${username}`)
})

const mockResolveUserLabel = mock((userId: string, _context?: unknown) =>
  Promise.resolve<string | null>(userId === 'member-1' ? 'Member One (@m1)' : null),
)

/** Live-label resolver used by the "enriches user_label" test — kept out of the test body so the
 *  linter's no-conditional-in-test rule doesn't flag the branch. */
const resolveLuckyLabel = (userId: string, _context?: unknown): Promise<string | null> =>
  Promise.resolve(userId === '777' ? 'Lucky (@lucky)' : null)

class MockChatRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override resolveUserId(username: string, context?: unknown): Promise<string | null> {
    return mockResolveUserId(username, context)
  }

  override resolveUserLabel(userId: string, context?: unknown): Promise<string | null> {
    return mockResolveUserLabel(userId, context)
  }
}

/** Seed a manageable group for the test principal (u-1, pi-1) and return its contextId. */
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

describe('settings group routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    mockResolveUserId.mockClear()
    mockResolveUserLabel.mockClear()
    setRuntimeChatRouter(new MockChatRouter())
  })

  afterEach(() => {
    clearRuntimeChatRouter()
  })

  test('members GET on a personal context is 403 (group scope required)', async () => {
    // A personal user with no manageable groups cannot reach a group route.
    const url = new URL('https://x/settings/api/group/members?contextId=personal-only')
    const res = await handleGroupRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/group/members',
    )
    expect(res.status).toBe(403)
  })

  test('members GET returns member list for a manageable group', async () => {
    // Seed a manageable group for u-1 on pi-1
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

    const url = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(scopedGroupId)}`)
    const res = await handleGroupRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/group/members',
    )
    expect(res.status).toBe(200)
    const body = MembersResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(scopedGroupId)
    expect(body.members).toEqual([])
  })

  test('unknown subpath returns 404', async () => {
    const url = new URL('https://x/settings/api/group/unknown')
    const res = await handleGroupRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/group/unknown',
    )
    expect(res.status).toBe(404)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/group/members?contextId=grp-1')
    const res = await handleGroupRoutes(new Request(url), url, '/settings/api/group/members')
    expect(res.status).toBe(401)
  })

  test('members POST then GET — added member appears in list', async () => {
    const contextId = seedManageableGroup()

    const postUrl = new URL('https://x/settings/api/group/members')
    const postRes = await handleGroupRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'member-1', contextId }),
      }),
      postUrl,
      '/settings/api/group/members',
    )
    expect(postRes.status).toBe(200)

    const getUrl = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(contextId)}`)
    const getRes = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/members',
    )
    expect(getRes.status).toBe(200)
    const body = MembersDetailSchema.parse(await getRes.json())
    expect(body.members.some((m) => m.user_id === 'resolved-member-1')).toBe(true)
  })

  test('members POST with @username passes platformInstanceId to resolver', async () => {
    const contextId = seedManageableGroup()

    const postUrl = new URL('https://x/settings/api/group/members')
    const postRes = await handleGroupRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '@someuser', contextId }),
      }),
      postUrl,
      '/settings/api/group/members',
    )
    expect(postRes.status).toBe(200)
    expect(mockResolveUserId).toHaveBeenCalledWith('@someuser', expect.objectContaining({ platformInstanceId: 'pi-1' }))
  })

  test('members POST with unresolvable username returns 422 with guidance', async () => {
    const contextId = seedManageableGroup()

    const postUrl = new URL('https://x/settings/api/group/members')
    const postRes = await handleGroupRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '@ghost-member', contextId }),
      }),
      postUrl,
      '/settings/api/group/members',
    )
    expect(postRes.status).toBe(422)
    await expect(postRes.json()).resolves.toEqual({
      error: 'could not resolve "@ghost-member" to a user ID — use the numeric user ID',
    })
  })

  test('members DELETE then GET — removed member no longer present', async () => {
    const contextId = seedManageableGroup()

    const addUrl = new URL('https://x/settings/api/group/members')
    await handleGroupRoutes(
      new Request(addUrl, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'member-1', contextId }),
      }),
      addUrl,
      '/settings/api/group/members',
    )

    const delUrl = new URL('https://x/settings/api/group/members')
    const delRes = await handleGroupRoutes(
      new Request(delUrl, {
        method: 'DELETE',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'resolved-member-1', contextId }),
      }),
      delUrl,
      '/settings/api/group/members',
    )
    expect(delRes.status).toBe(200)

    const getUrl = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(contextId)}`)
    const getRes = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/members',
    )
    expect(getRes.status).toBe(200)
    const body = MembersDetailSchema.parse(await getRes.json())
    expect(body.members.some((m) => m.user_id === 'resolved-member-1')).toBe(false)
  })

  test('members POST without CSRF returns 403', async () => {
    const contextId = seedManageableGroup()

    const postUrl = new URL('https://x/settings/api/group/members')
    const res = await handleGroupRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'member-1', contextId }),
      }),
      postUrl,
      '/settings/api/group/members',
    )
    expect(res.status).toBe(403)
  })

  test('task-instance PATCH valid instance then GET — taskInstanceId reflected', async () => {
    const contextId = seedManageableGroup()
    insertTaskInstance({ id: 'ti-grp', type: 'kaneo', config: {}, status: 'active' })

    const patchUrl = new URL('https://x/settings/api/group/task-instance')
    const patchRes = await handleGroupRoutes(
      new Request(patchUrl, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskInstanceId: 'ti-grp', contextId }),
      }),
      patchUrl,
      '/settings/api/group/task-instance',
    )
    expect(patchRes.status).toBe(200)

    const getUrl = new URL(`https://x/settings/api/group/task-instance?contextId=${encodeURIComponent(contextId)}`)
    const getRes = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/task-instance',
    )
    expect(getRes.status).toBe(200)
    const body = TaskInstanceGetSchema.parse(await getRes.json())
    expect(body.taskInstanceId).toBe('ti-grp')
    // 'kaneo' is not registered as a provider type in unit tests, so no provision hook.
    expect(body.canProvision).toBe(false)
  })

  test('task-instance GET only lists active task instances', async () => {
    const contextId = seedManageableGroup()
    insertTaskInstance({ id: 'ti-active', type: 'kaneo', config: {}, status: 'active' })
    insertTaskInstance({ id: 'ti-pending', type: 'kaneo', config: {}, status: 'pending' })

    const getUrl = new URL(`https://x/settings/api/group/task-instance?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/task-instance',
    )

    expect(res.status).toBe(200)
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.available).toEqual([{ id: 'ti-active', type: 'kaneo', status: 'active' }])
  })

  test('task-instance GET skips unreadable rows and still returns readable active instances', async () => {
    const contextId = seedManageableGroup()
    insertTaskInstance({ id: 'ti-active', type: 'kaneo', config: {}, status: 'active' })
    getTestDb().insert(taskInstances).values({ id: 'ti-broken', type: 'kaneo', config: 'AAAA', status: 'active' }).run()

    const getUrl = new URL(`https://x/settings/api/group/task-instance?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/task-instance',
    )

    expect(res.status).toBe(200)
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.available).toEqual([{ id: 'ti-active', type: 'kaneo', status: 'active' }])
  })

  test('task-instance PATCH unknown instance returns 422', async () => {
    const contextId = seedManageableGroup()

    const patchUrl = new URL('https://x/settings/api/group/task-instance')
    const res = await handleGroupRoutes(
      new Request(patchUrl, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskInstanceId: 'does-not-exist', contextId }),
      }),
      patchUrl,
      '/settings/api/group/task-instance',
    )
    expect(res.status).toBe(422)
  })

  test('task-instance PATCH inactive instance returns 422', async () => {
    const contextId = seedManageableGroup()
    insertTaskInstance({ id: 'ti-pending', type: 'kaneo', config: {}, status: 'pending' })

    const patchUrl = new URL('https://x/settings/api/group/task-instance')
    const res = await handleGroupRoutes(
      new Request(patchUrl, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskInstanceId: 'ti-pending', contextId }),
      }),
      patchUrl,
      '/settings/api/group/task-instance',
    )

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'inactive task instance' })
  })

  test('task-instance PATCH rejects unreadable active rows', async () => {
    const contextId = seedManageableGroup()
    getTestDb().insert(taskInstances).values({ id: 'ti-broken', type: 'kaneo', config: 'AAAA', status: 'active' }).run()

    const patchUrl = new URL('https://x/settings/api/group/task-instance')
    const res = await handleGroupRoutes(
      new Request(patchUrl, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskInstanceId: 'ti-broken', contextId }),
      }),
      patchUrl,
      '/settings/api/group/task-instance',
    )

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'unreadable task instance' })
    expect(getContextSettings(contextId)).toBeNull()
  })

  test('members GET enriches user_label via the live resolver', async () => {
    const contextId = seedManageableGroup()
    mockResolveUserLabel.mockImplementation(resolveLuckyLabel)
    const postUrl = new URL('https://x/settings/api/group/members')
    await handleGroupRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '777', contextId }),
      }),
      postUrl,
      '/settings/api/group/members',
    )
    const getUrl = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/members',
    )
    expect(res.status).toBe(200)
    const body = MembersLabelSchema.parse(await res.json())
    const row = body.members.find((m) => m.user_id === '777')!
    expect(row.user_label).toBe('Lucky (@lucky)')
  })

  test('members GET returns 200 with null labels when the chat router is absent', async () => {
    const contextId = seedManageableGroup()
    const postUrl = new URL('https://x/settings/api/group/members')
    await handleGroupRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '777', contextId }),
      }),
      postUrl,
      '/settings/api/group/members',
    )
    clearRuntimeChatRouter()
    const getUrl = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/members',
    )
    expect(res.status).toBe(200)
    const body = MembersLabelSchema.parse(await res.json())
    expect(body.members.every((m) => m.user_label === null)).toBe(true)
  })
})
