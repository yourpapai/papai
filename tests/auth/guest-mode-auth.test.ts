// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { checkAuthorizationExtended, getThreadScopedStorageContextId } from '../../src/auth.js'
import { addAuthorizedGroup, setGuestMode } from '../../src/authorized-groups.js'
import { setupTestDb } from '../utils/test-helpers.js'

const PI = 'pi-1'

const groupConfigId = (rawGroupId: string): string =>
  getThreadScopedStorageContextId(rawGroupId, 'group', undefined, PI)

describe('guest mode authorization', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('unknown user is allowed as guest when guest mode is on', () => {
    addAuthorizedGroup(groupConfigId('g1'), 'admin')
    setGuestMode(groupConfigId('g1'), true)
    const result = checkAuthorizationExtended('stranger', null, 'g1', 'group', undefined, false, PI)
    expect(result.allowed).toBe(true)
    expect(result.isGuest).toBe(true)
    expect(result.isBotAdmin).toBe(false)
    expect(result.isGroupAdmin).toBe(false)
  })

  test('unknown user is denied when guest mode is off (regression)', () => {
    addAuthorizedGroup(groupConfigId('g1'), 'admin')
    const result = checkAuthorizationExtended('stranger', null, 'g1', 'group', undefined, false, PI)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('group_member_not_allowed')
    expect(result.isGuest).toBeUndefined()
  })

  test('platform/group admin keeps full access (not a guest) even with guest mode on', () => {
    addAuthorizedGroup(groupConfigId('g1'), 'admin')
    setGuestMode(groupConfigId('g1'), true)
    const result = checkAuthorizationExtended('admin-user', null, 'g1', 'group', undefined, true, PI)
    expect(result.allowed).toBe(true)
    expect(result.isGroupAdmin).toBe(true)
    expect(result.isGuest).toBeUndefined()
  })
})
