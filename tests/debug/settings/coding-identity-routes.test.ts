// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup, getGroupCodingIdentity } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { addGroupMember } from '../../../src/groups.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PATH = '/settings/api/group/coding-identity'

const CodingIdentityGetSchema = z.object({ contextId: z.string(), identity: z.string() })
const CodingIdentityPatchSchema = z.object({ ok: z.boolean(), contextId: z.string(), identity: z.string() })

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

describe('settings group coding-identity routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns { contextId, identity: "initiator" } for a freshly authorized group', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(new Request(url, { headers: authHeaders(session) }), url, PATH)
    expect(res.status).toBe(200)
    const body = CodingIdentityGetSchema.parse(await res.json())
    expect(body.contextId).toBe(contextId)
    expect(body.identity).toBe('initiator')
  })

  test('PATCH { identity: "shared" } with CSRF → 200 and getGroupCodingIdentity returns "shared"', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'shared', contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(200)
    const body = CodingIdentityPatchSchema.parse(await res.json())
    expect(body.ok).toBe(true)
    expect(body.identity).toBe('shared')
    expect(getGroupCodingIdentity(contextId)).toBe('shared')
  })

  test('PATCH { identity: "initiator" } round-trips back to initiator', async () => {
    const contextId = seedManageableGroup()
    // First set to shared
    const url1 = new URL(`https://x${PATH}`)
    await handleGroupRoutes(
      new Request(url1, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'shared', contextId }),
      }),
      url1,
      PATH,
    )
    // Then reset to initiator
    const url2 = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url2, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'initiator', contextId }),
      }),
      url2,
      PATH,
    )
    expect(res.status).toBe(200)
    expect(getGroupCodingIdentity(contextId)).toBe('initiator')
  })

  test('PATCH designated:<member> → 200', async () => {
    const contextId = seedManageableGroup()
    addUser({ userId: 'u-2', platformInstanceId: 'pi-1', addedBy: 'u-1', username: undefined })
    addGroupMember(contextId, 'u-2', 'u-1')
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'designated:u-2', contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(200)
    expect(getGroupCodingIdentity(contextId)).toBe('designated:u-2')
  })

  test('PATCH designated:<non-member> → 422', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'designated:not-a-member', contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(422)
  })

  test('PATCH with invalid identity string → 422', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'bogus-value', contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(422)
  })

  test('PATCH without CSRF header → 403', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'shared', contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(403)
  })

  test('PATCH for a group the principal cannot manage → 403', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'shared', contextId: 'unmanaged-context' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(403)
  })
})
