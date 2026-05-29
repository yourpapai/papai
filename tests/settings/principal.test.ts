// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { addAdmin } from '../../src/instances/admin-store.js'
import { resolveSettingsPrincipal } from '../../src/settings/principal.js'
import { addUser } from '../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

describe('resolveSettingsPrincipal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
  })

  test('an unknown user is unauthorized with no manageable groups', () => {
    const principal = resolveSettingsPrincipal('pi-1', 'nobody')
    expect(principal.authorized).toBe(false)
    expect(principal.isBotAdmin).toBe(false)
    expect(principal.manageableGroups).toEqual([])
    expect(principal.personalConfigContextId).toBe(
      toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'nobody' }),
    )
  })

  test('an authorized user resolves authorized=true', () => {
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    const principal = resolveSettingsPrincipal('pi-1', 'u-1')
    expect(principal.authorized).toBe(true)
    expect(principal.isBotAdmin).toBe(false)
  })

  test('a super admin resolves isBotAdmin and isSuperAdmin', () => {
    addAdmin('boss', '__super__')
    const principal = resolveSettingsPrincipal('pi-1', 'boss')
    expect(principal.isBotAdmin).toBe(true)
    expect(principal.isSuperAdmin).toBe(true)
    expect(principal.authorized).toBe(true)
  })
})
