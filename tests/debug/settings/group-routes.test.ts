// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const MembersResponseSchema = z.object({ contextId: z.string(), members: z.array(z.unknown()) })
const MembersDetailSchema = z.object({
  contextId: z.string(),
  members: z.array(z.object({ user_id: z.string(), added_by: z.string(), added_at: z.string() })),
})
const TaskInstanceGetSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string() })),
})

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
    expect(body.members.some((m) => m.user_id === 'member-1')).toBe(true)
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
        body: JSON.stringify({ userId: 'member-1', contextId }),
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
    expect(body.members.some((m) => m.user_id === 'member-1')).toBe(false)
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
})
