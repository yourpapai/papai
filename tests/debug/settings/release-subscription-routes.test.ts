// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { handleReleaseSubscriptionRoutes } from '../../../src/debug/settings/release-subscription-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { addAdmin } from '../../../src/instances/admin-store.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PERSONAL = '/settings/api/release-subscription'
const GROUP = '/settings/api/group/release-subscription'

const PersonalGetSchema = z.object({ enabled: z.boolean() })
const PersonalPatchSchema = z.object({ ok: z.boolean(), enabled: z.boolean() })
const GroupGetSchema = z.object({ contextId: z.string(), enabled: z.boolean() })
const GroupPatchSchema = z.object({ ok: z.boolean(), contextId: z.string(), enabled: z.boolean() })

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

describe('release-subscription routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('personal GET defaults to enabled=false; PATCH round-trips', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const get0 = await handleReleaseSubscriptionRoutes(new Request(url, { headers: authHeaders(session) }), url)
    expect(get0.status).toBe(200)
    expect(PersonalGetSchema.parse(await get0.json()).enabled).toBe(false)

    const patch = await handleReleaseSubscriptionRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      url,
    )
    expect(patch.status).toBe(200)
    expect(PersonalPatchSchema.parse(await patch.json()).enabled).toBe(true)

    const get1 = await handleReleaseSubscriptionRoutes(new Request(url, { headers: authHeaders(session) }), url)
    expect(PersonalGetSchema.parse(await get1.json()).enabled).toBe(true)
  })

  test('personal PATCH persists for an admin with no users row', async () => {
    // Admins are authorized via the admin store and may have no `users` row;
    // the subscription must still persist instead of silently no-opping.
    addAdmin('admin-no-row', 'pi-1')
    const adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-no-row' })
    const url = new URL(`https://x${PERSONAL}`)

    const patch = await handleReleaseSubscriptionRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      url,
    )
    expect(patch.status).toBe(200)
    expect(PersonalPatchSchema.parse(await patch.json()).enabled).toBe(true)

    const get1 = await handleReleaseSubscriptionRoutes(new Request(url, { headers: authHeaders(adminSession) }), url)
    expect(PersonalGetSchema.parse(await get1.json()).enabled).toBe(true)
  })

  test('personal PATCH without CSRF → 403', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const res = await handleReleaseSubscriptionRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('personal POST → 405', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const res = await handleReleaseSubscriptionRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(session, true) }),
      url,
    )
    expect(res.status).toBe(405)
  })

  test('group admin can toggle their group subscription', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${GROUP}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, contextId }),
      }),
      url,
      GROUP,
    )
    expect(res.status).toBe(200)
    expect(GroupPatchSchema.parse(await res.json()).enabled).toBe(true)
  })

  test('group PATCH for an unmanaged context → 403', async () => {
    const url = new URL(`https://x${GROUP}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, contextId: 'unmanaged-context' }),
      }),
      url,
      GROUP,
    )
    expect(res.status).toBe(403)
  })

  test('personal PATCH with invalid body → 422', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const res = await handleReleaseSubscriptionRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('personal GET with unauthorized principal → 403', async () => {
    const ghostSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ghost' })
    const url = new URL(`https://x${PERSONAL}`)
    const res = await handleReleaseSubscriptionRoutes(new Request(url, { headers: authHeaders(ghostSession) }), url)
    expect(res.status).toBe(403)
  })

  test('group GET returns { contextId, enabled: false } for a freshly authorized group', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${GROUP}?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(new Request(url, { headers: authHeaders(session) }), url, GROUP)
    expect(res.status).toBe(200)
    const body = GroupGetSchema.parse(await res.json())
    expect(body.contextId).toBe(contextId)
    expect(body.enabled).toBe(false)
  })
})
