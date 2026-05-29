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
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const MembersResponseSchema = z.object({ contextId: z.string(), members: z.array(z.unknown()) })

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
})
