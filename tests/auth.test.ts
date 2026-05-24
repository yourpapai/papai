// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { checkAuthorizationExtended as checkAuthorizationExtendedScoped, getThreadScopedStorageContextId } from '../src/auth.js'
import { addAuthorizedGroup } from '../src/authorized-groups.js'
import type { AuthorizationResult } from '../src/chat/types.js'
import { addGroupMember } from '../src/groups.js'
import { addUser as addScopedUser } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'legacy-single'

const addUser = (userId: string, addedBy: string, username?: string): void => {
  addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy, username })
}

const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: 'dm' | 'group',
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult =>
  checkAuthorizationExtendedScoped(userId, username, contextId, contextType, threadId, isPlatformAdmin, TEST_PLATFORM_ID)

describe('auth', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('getThreadScopedStorageContextId', () => {
    test('returns userId for DM context', () => {
      const result = getThreadScopedStorageContextId('user123', 'dm')
      expect(result).toBe('user123')
    })

    test('returns groupId for main chat (no thread)', () => {
      const result = getThreadScopedStorageContextId('group456', 'group')
      expect(result).toBe('group456')
    })

    test('returns groupId:threadId for thread', () => {
      const result = getThreadScopedStorageContextId('group456', 'group', 'thread789')
      expect(result).toBe('group456:thread789')
    })
  })

  describe('checkAuthorizationExtended', () => {
    describe('bot admin in group', () => {
      test('configContextId equals storageContextId in main chat', () => {
        process.env['ADMIN_USER_ID'] = 'admin1'
        addUser('admin1', 'admin1')
        addAuthorizedGroup('group1', 'admin1')

        const groupAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)

        expect(groupAuth.allowed).toBe(true)
        expect(groupAuth.isBotAdmin).toBe(true)
        expect(groupAuth.configContextId).toBe('group1')
        expect(groupAuth.configContextId).toBe(groupAuth.storageContextId)
      })

      test('thread-scoped storageContextId with group-scoped configContextId', () => {
        process.env['ADMIN_USER_ID'] = 'admin1'
        addUser('admin1', 'admin1')
        addAuthorizedGroup('group1', 'admin1')

        const threadAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', 'thread123', false)

        expect(threadAuth.allowed).toBe(true)
        expect(threadAuth.isBotAdmin).toBe(true)
        expect(threadAuth.storageContextId).toBe('group1:thread123')
        expect(threadAuth.configContextId).toBe('group1')
      })

      test('isGroupAdmin reflects platform admin status', () => {
        addUser('admin1', 'admin1')
        addAuthorizedGroup('group1', 'admin1')

        const nonAdminAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)
        expect(nonAdminAuth.isGroupAdmin).toBe(false)

        const adminAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, true)
        expect(adminAuth.isGroupAdmin).toBe(true)
      })

      test('denies bot admin in non-allowlisted group with group_not_allowed reason', () => {
        addUser('admin1', 'admin1')

        const unauthorizedAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)

        expect(unauthorizedAuth.allowed).toBe(false)
        expect(unauthorizedAuth.isBotAdmin).toBe(false)
        expect(unauthorizedAuth.isGroupAdmin).toBe(false)
        expect(unauthorizedAuth.storageContextId).toBe('group1')
        expect(unauthorizedAuth.configContextId).toBe('group1')
        expect(unauthorizedAuth.reason).toBe('group_not_allowed')
      })
    })

    describe('group member (non-admin)', () => {
      test('has correct auth flags', () => {
        addAuthorizedGroup('group1', 'admin1')
        // Add to group WITHOUT adding as authorized user (group member only)
        addGroupMember('group1', 'user1', 'user1')

        const memberAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

        expect(memberAuth.allowed).toBe(true)
        expect(memberAuth.isBotAdmin).toBe(false)
        expect(memberAuth.isGroupAdmin).toBe(false)
        expect(memberAuth.configContextId).toBe('group1')
      })

      test('in thread has isolated storage but shared config', () => {
        addAuthorizedGroup('group1', 'admin1')
        // Add to group WITHOUT adding as authorized user (group member only)
        addGroupMember('group1', 'user1', 'user1')

        const threadAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', 'thread456', false)

        expect(threadAuth.allowed).toBe(true)
        expect(threadAuth.isBotAdmin).toBe(false)
        expect(threadAuth.storageContextId).toBe('group1:thread456')
        expect(threadAuth.configContextId).toBe('group1')
      })

      test('authorized non-admin user stays non-admin in both DM and allowlisted group contexts', () => {
        process.env['ADMIN_USER_ID'] = 'real-admin'
        addUser('user1', 'real-admin')
        addAuthorizedGroup('group1', 'real-admin')

        const dmAuth = checkAuthorizationExtended('user1', null, 'user1', 'dm', undefined, false)
        const groupAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

        expect(dmAuth.allowed).toBe(true)
        expect(dmAuth.isBotAdmin).toBe(false)
        expect(groupAuth.allowed).toBe(true)
        expect(groupAuth.isBotAdmin).toBe(false)
      })
    })

    describe('unauthorized user in group', () => {
      test('returns group_not_allowed when group is not allowlisted', () => {
        const unauthorizedAuth = checkAuthorizationExtended('stranger1', null, 'group1', 'group', undefined, false)

        expect(unauthorizedAuth.allowed).toBe(false)
        expect(unauthorizedAuth.isBotAdmin).toBe(false)
        expect(unauthorizedAuth.isGroupAdmin).toBe(false)
        expect(unauthorizedAuth.storageContextId).toBe('group1')
        expect(unauthorizedAuth.configContextId).toBe('group1')
        expect(unauthorizedAuth.reason).toBe('group_not_allowed')
      })

      test('returns group_member_not_allowed when group is allowlisted but user is not permitted', () => {
        addAuthorizedGroup('group1', 'admin1')

        const unauthorizedAuth = checkAuthorizationExtended('stranger1', null, 'group1', 'group', undefined, false)

        expect(unauthorizedAuth.allowed).toBe(false)
        expect(unauthorizedAuth.reason).toBe('group_member_not_allowed')
      })

      test('allows platform admin in allowlisted group without group_members entry', () => {
        addAuthorizedGroup('group1', 'admin1')

        const unauthorizedAuth = checkAuthorizationExtended('platform-admin', null, 'group1', 'group', undefined, true)

        expect(unauthorizedAuth.allowed).toBe(true)
        expect(unauthorizedAuth.isBotAdmin).toBe(false)
        expect(unauthorizedAuth.isGroupAdmin).toBe(true)
      })
    })

    describe('DM user', () => {
      test('authorized user has DM access but is not bot admin', () => {
        addUser('user1', 'user1')

        const dmAuth = checkAuthorizationExtended('user1', null, 'user1', 'dm', undefined, false)

        expect(dmAuth.allowed).toBe(true)
        expect(dmAuth.isBotAdmin).toBe(false)
        expect(dmAuth.isGroupAdmin).toBe(false)
        expect(dmAuth.storageContextId).toBe('user1')
        expect(dmAuth.configContextId).toBe('user1')
      })

      test('unauthorized user has no access but gets context IDs', () => {
        const unauthorizedDmAuth = checkAuthorizationExtended('stranger1', null, 'stranger1', 'dm', undefined, false)

        expect(unauthorizedDmAuth.allowed).toBe(false)
        expect(unauthorizedDmAuth.isBotAdmin).toBe(false)
        expect(unauthorizedDmAuth.isGroupAdmin).toBe(false)
        expect(unauthorizedDmAuth.storageContextId).toBe('stranger1')
        expect(unauthorizedDmAuth.configContextId).toBe('stranger1')
        expect(unauthorizedDmAuth.reason).toBe('dm_not_allowed')
      })

      test('user resolved by username gets access without bot admin privileges', () => {
        // First add a user with a username
        addUser('realuser1', 'admin1', 'realuser1')
        // Then check that the username resolves to the user
        const resolvedAuth = checkAuthorizationExtended('stranger1', 'realuser1', 'stranger1', 'dm', undefined, false)

        expect(resolvedAuth.allowed).toBe(true)
        expect(resolvedAuth.isBotAdmin).toBe(false)
        expect(resolvedAuth.configContextId).toBe('stranger1')
      })
    })
  })
})
