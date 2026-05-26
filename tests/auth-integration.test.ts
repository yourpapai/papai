// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { checkAuthorizationExtended as checkAuthorizationExtendedScoped } from '../src/auth.js'
import { addAuthorizedGroup } from '../src/authorized-groups.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { AuthorizationResult } from '../src/chat/types.js'
import { addGroupMember } from '../src/groups.js'
import { addUser as addScopedUser } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'legacy-single'

const scopedContextId = (nativeContextId: string): string =>
  toScopedContextId({ platformInstanceId: TEST_PLATFORM_ID, nativeContextId })

const addAuthorizedTestGroup = (nativeContextId: string, addedBy: string): void => {
  addAuthorizedGroup(scopedContextId(nativeContextId), addedBy)
}

const addTestGroupMember = (nativeContextId: string, userId: string, addedBy: string): void => {
  addGroupMember(scopedContextId(nativeContextId), userId, addedBy)
}

const addUser = (userId: string, addedBy: string, ...args: [] | [username: string]): void => {
  const username = args[0]
  if (username === undefined) {
    addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy })
  } else {
    addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy, username })
  }
}

const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: 'dm' | 'group',
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult =>
  checkAuthorizationExtendedScoped(
    userId,
    username,
    contextId,
    contextType,
    threadId,
    isPlatformAdmin,
    TEST_PLATFORM_ID,
  )

describe('group context isolation', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('two groups have independent storage contexts', () => {
    // Add members to two different groups
    addUser('user1', 'admin1')
    addAuthorizedTestGroup('group1', 'admin1')
    addAuthorizedTestGroup('group2', 'admin1')
    addTestGroupMember('group1', 'user1', 'admin1')
    addTestGroupMember('group2', 'user1', 'admin1')

    // Verify storageContextId is different for each
    const group1Auth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)
    const group2Auth = checkAuthorizationExtended('user1', null, 'group2', 'group', undefined, false)

    expect(group1Auth.storageContextId).toBe(scopedContextId('group1'))
    expect(group2Auth.storageContextId).toBe(scopedContextId('group2'))
    expect(group1Auth.storageContextId).not.toBe(group2Auth.storageContextId)
  })

  test('dm uses userId as storage context', () => {
    addUser('admin1', 'admin1')
    const dmAuth = checkAuthorizationExtended('admin1', null, 'admin1', 'dm', undefined, false)
    expect(dmAuth.storageContextId).toBe(scopedContextId('admin1'))
  })

  test('unauthorized user in group still gets correct storage context', () => {
    // Don't add user1 to authorized users or group members
    const groupAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

    // Should not be allowed but storageContextId should still be group1
    expect(groupAuth.allowed).toBe(false)
    expect(groupAuth.storageContextId).toBe(scopedContextId('group1'))
    expect(groupAuth.reason).toBe('group_not_allowed')
  })

  test('authorized non-admin in group uses groupId as storage context', () => {
    // Add authorized user who is not the configured bot admin
    addUser('admin1', 'admin1')
    addAuthorizedTestGroup('group1', 'admin1')

    const groupAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)

    expect(groupAuth.allowed).toBe(true)
    expect(groupAuth.isBotAdmin).toBe(false)
    expect(groupAuth.storageContextId).toBe(scopedContextId('group1'))
  })

  test('allowlisted group still denies non-member non-admin users distinctly', () => {
    addAuthorizedTestGroup('group1', 'admin1')

    const groupAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

    expect(groupAuth.allowed).toBe(false)
    expect(groupAuth.reason).toBe('group_member_not_allowed')
  })
})
