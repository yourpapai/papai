// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { requireAdmin } from '../../../../src/debug/settings/admin/admin-guard.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { SESSION_COOKIE_NAME } from '../../../../src/settings/cookies.js'
import {
  authenticateSettingsRequest,
  type AuthenticatedSettingsRequest,
} from '../../../../src/settings/request-auth.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { establishSession, type SettingsSession } from '../helpers.js'

const ForbiddenSchema = z.object({ error: z.literal('forbidden') })

function makeAuthed(session: SettingsSession): AuthenticatedSettingsRequest {
  const req = new Request('https://x/settings/api/admin/system', {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${session.cookie}` },
  })
  const authed = authenticateSettingsRequest(req)
  assert(authed !== null, 'expected authenticated request')
  return authed
}

describe('requireAdmin', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('returns null (allowed) for an admin read', () => {
    const result = requireAdmin(makeAuthed(adminSession), 'read')
    expect(result).toBeNull()
  })

  test('returns null (allowed) for an admin write', () => {
    const result = requireAdmin(makeAuthed(adminSession), 'write')
    expect(result).toBeNull()
  })

  test('returns 403 response for a non-admin read', async () => {
    const result = requireAdmin(makeAuthed(userSession), 'read')
    assert(result !== null, 'expected a 403 Response')
    expect(result.status).toBe(403)
    ForbiddenSchema.parse(await result.json())
  })

  test('returns 403 response for a non-admin write', () => {
    const result = requireAdmin(makeAuthed(userSession), 'write')
    assert(result !== null, 'expected a 403 Response')
    expect(result.status).toBe(403)
  })
})
