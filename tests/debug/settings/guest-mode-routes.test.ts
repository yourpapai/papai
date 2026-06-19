// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup, isGuestModeEnabled } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PATH = '/settings/api/group/guest-mode'

const GuestModeGetSchema = z.object({ contextId: z.string(), enabled: z.boolean() })
const GuestModePatchSchema = z.object({ ok: z.boolean(), contextId: z.string(), enabled: z.boolean() })

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

describe('settings group guest-mode routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns { contextId, enabled: false } for a freshly authorized group', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(new Request(url, { headers: authHeaders(session) }), url, PATH)
    expect(res.status).toBe(200)
    const body = GuestModeGetSchema.parse(await res.json())
    expect(body.contextId).toBe(contextId)
    expect(body.enabled).toBe(false)
  })

  test('PATCH { enabled: true } with CSRF → 200 and isGuestModeEnabled returns true', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(200)
    const body = GuestModePatchSchema.parse(await res.json())
    expect(body.ok).toBe(true)
    expect(body.enabled).toBe(true)
    expect(isGuestModeEnabled(contextId)).toBe(true)
  })

  test('PATCH without CSRF header → 403', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, contextId }),
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
        body: JSON.stringify({ enabled: true, contextId: 'unmanaged-context' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(403)
  })
})
