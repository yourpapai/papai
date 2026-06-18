// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import {
  checkAuthorizationExtended as checkAuthorizationExtendedScoped,
  getThreadScopedStorageContextId,
} from '../src/auth.js'
import { addAuthorizedGroup } from '../src/authorized-groups.js'
import type { AuthorizationResult } from '../src/chat/types.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../src/group-settings/registry.js'
import { addGroupMember } from '../src/groups.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../src/instances/admin-store.js'
import { isOpenDmAccessEnabled, setOpenDmAccess } from '../src/instances/platform-store.js'
import { blockUser, isAuthorized, addUser as addScopedUser } from '../src/users.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'legacy-single'
const SCOPED_GROUP1 = 'pi:bGVnYWN5LXNpbmdsZQ:ctx:Z3JvdXAx'
const SCOPED_GROUP1_THREAD123 = 'pi:bGVnYWN5LXNpbmdsZQ:ctx:Z3JvdXAx:thread:dGhyZWFkMTIz'
const SCOPED_GROUP1_THREAD456 = 'pi:bGVnYWN5LXNpbmdsZQ:ctx:Z3JvdXAx:thread:dGhyZWFkNDU2'
const SCOPED_STRANGER1 = 'pi:bGVnYWN5LXNpbmdsZQ:ctx:c3RyYW5nZXIx'
const SCOPED_USER1 = 'pi:bGVnYWN5LXNpbmdsZQ:ctx:dXNlcjE'
const SCOPED_ADMIN1 = 'pi:bGVnYWN5LXNpbmdsZQ:ctx:YWRtaW4x'

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

describe('auth', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
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

    test('returns scoped user id for DM context when platform is provided', () => {
      const result = getThreadScopedStorageContextId('user123', 'dm', undefined, 'telegram-default')

      expect(result).toBe('pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dXNlcjEyMw')
    })

    test('returns scoped group thread id when platform is provided', () => {
      const result = getThreadScopedStorageContextId('group456', 'group', 'thread789', 'discord-default')

      expect(result).toBe('pi:ZGlzY29yZC1kZWZhdWx0:ctx:Z3JvdXA0NTY:thread:dGhyZWFkNzg5')
    })
  })

  describe('checkAuthorizationExtended', () => {
    describe('bot admin in group', () => {
      test('configContextId equals storageContextId in main chat', () => {
        addUser('admin1', 'admin1')
        addAdmin('admin1', TEST_PLATFORM_ID)
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')

        const groupAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)

        expect(groupAuth.allowed).toBe(true)
        expect(groupAuth.isBotAdmin).toBe(true)
        expect(groupAuth.configContextId).toBe(SCOPED_GROUP1)
        expect(groupAuth.configContextId).toBe(groupAuth.storageContextId)
      })

      test('thread-scoped storageContextId with group-scoped configContextId', () => {
        addUser('admin1', 'admin1')
        addAdmin('admin1', TEST_PLATFORM_ID)
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')

        const threadAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', 'thread123', false)

        expect(threadAuth.allowed).toBe(true)
        expect(threadAuth.isBotAdmin).toBe(true)
        expect(threadAuth.storageContextId).toBe(SCOPED_GROUP1_THREAD123)
        expect(threadAuth.configContextId).toBe(SCOPED_GROUP1)
      })

      test('isGroupAdmin reflects platform admin status', () => {
        addUser('admin1', 'admin1')
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')

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
        expect(unauthorizedAuth.storageContextId).toBe(SCOPED_GROUP1)
        expect(unauthorizedAuth.configContextId).toBe(SCOPED_GROUP1)
        expect(unauthorizedAuth.reason).toBe('group_not_allowed')
      })
    })

    describe('bot admin in DM', () => {
      test('keys config/storage off the user id, not the DM channel id', () => {
        addUser('admin1', 'admin1')
        addAdmin('admin1', TEST_PLATFORM_ID)

        // The chat layer passes the DM *channel* id as contextId; on
        // Mattermost/Discord/Kontur that is not the user id. The admin's context
        // must still key off the user id so it matches the user-keyed personal
        // context the settings UI binds (and that non-admin DM users get).
        const dmAuth = checkAuthorizationExtended('admin1', null, 'dm-channel-xyz', 'dm', undefined, false)

        expect(dmAuth.allowed).toBe(true)
        expect(dmAuth.isBotAdmin).toBe(true)
        expect(dmAuth.storageContextId).toBe(SCOPED_ADMIN1)
        expect(dmAuth.configContextId).toBe(SCOPED_ADMIN1)
      })
    })

    describe('group member (non-admin)', () => {
      test('authorizes scoped group member from raw message context and platform instance', () => {
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')
        addGroupMember(SCOPED_GROUP1, 'user1', 'admin1')

        const memberAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

        expect(memberAuth.allowed).toBe(true)
        expect(memberAuth.storageContextId).toBe(SCOPED_GROUP1)
        expect(memberAuth.configContextId).toBe(SCOPED_GROUP1)
      })

      test('has correct auth flags', () => {
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')
        // Add to group WITHOUT adding as authorized user (group member only)
        addGroupMember(SCOPED_GROUP1, 'user1', 'user1')

        const memberAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

        expect(memberAuth.allowed).toBe(true)
        expect(memberAuth.isBotAdmin).toBe(false)
        expect(memberAuth.isGroupAdmin).toBe(false)
        expect(memberAuth.configContextId).toBe(SCOPED_GROUP1)
      })

      test('in thread has isolated storage but shared config', () => {
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')
        // Add to group WITHOUT adding as authorized user (group member only)
        addGroupMember(SCOPED_GROUP1, 'user1', 'user1')

        const threadAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', 'thread456', false)

        expect(threadAuth.allowed).toBe(true)
        expect(threadAuth.isBotAdmin).toBe(false)
        expect(threadAuth.storageContextId).toBe(SCOPED_GROUP1_THREAD456)
        expect(threadAuth.configContextId).toBe(SCOPED_GROUP1)
      })

      test('authorized non-admin user stays non-admin in both DM and allowlisted group contexts', () => {
        process.env['ADMIN_USER_ID'] = 'real-admin'
        addUser('user1', 'real-admin')
        addAuthorizedGroup(SCOPED_GROUP1, 'real-admin')

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
        expect(unauthorizedAuth.storageContextId).toBe(SCOPED_GROUP1)
        expect(unauthorizedAuth.configContextId).toBe(SCOPED_GROUP1)
        expect(unauthorizedAuth.reason).toBe('group_not_allowed')
      })

      test('returns group_member_not_allowed when group is allowlisted but user is not permitted', () => {
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')

        const unauthorizedAuth = checkAuthorizationExtended('stranger1', null, 'group1', 'group', undefined, false)

        expect(unauthorizedAuth.allowed).toBe(false)
        expect(unauthorizedAuth.reason).toBe('group_member_not_allowed')
      })

      test('allows platform admin in allowlisted group without group_members entry', () => {
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')

        const unauthorizedAuth = checkAuthorizationExtended('platform-admin', null, 'group1', 'group', undefined, true)

        expect(unauthorizedAuth.allowed).toBe(true)
        expect(unauthorizedAuth.isBotAdmin).toBe(false)
        expect(unauthorizedAuth.isGroupAdmin).toBe(true)
      })
    })

    describe('DM user', () => {
      test('super-admin row authorizes DM without ADMIN_USER_ID match', async () => {
        await setupTestDb()
        seedCommonTestPlatformInstances()
        addAdmin('root-user', SUPER_ADMIN_PLATFORM_ID)

        const auth = checkAuthorizationExtendedScoped(
          'root-user',
          null,
          'root-user',
          'dm',
          undefined,
          false,
          'discord-default',
        )

        expect(auth.allowed).toBe(true)
        expect(auth.isBotAdmin).toBe(true)
      })

      test('regular users must be authorized on the source platform instance', async () => {
        await setupTestDb()
        seedCommonTestPlatformInstances()
        addScopedUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'root-user' })

        const auth = checkAuthorizationExtendedScoped('u1', null, 'u1', 'dm', undefined, false, 'discord-default')

        expect(auth.allowed).toBe(false)
        expect(auth.reason).toBe('dm_not_allowed')
      })

      test('group admin of an authorized group may launch /config in DM without general access', () => {
        // Observed as a group admin of an authorized group => has a manageable group.
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')
        upsertKnownGroupContext({
          contextId: SCOPED_GROUP1,
          provider: 'telegram',
          displayName: 'Group One',
          parentName: null,
        })
        upsertGroupAdminObservation({
          provider: 'telegram',
          contextId: SCOPED_GROUP1,
          userId: 'user1',
          username: null,
          isAdmin: true,
        })

        const auth = checkAuthorizationExtended('user1', null, 'user1', 'dm', undefined, false)

        expect(auth.allowed).toBe(false)
        expect(auth.reason).toBe('dm_not_allowed')
        expect(auth.configCommandAllowed).toBe(true)
      })

      test('plain group member without admin rights gets no config-command allowance', () => {
        addAuthorizedGroup(SCOPED_GROUP1, 'admin1')
        addGroupMember(SCOPED_GROUP1, 'user1', 'admin1')

        const auth = checkAuthorizationExtended('user1', null, 'user1', 'dm', undefined, false)

        expect(auth.allowed).toBe(false)
        expect(auth.configCommandAllowed).toBeUndefined()
      })

      test('unknown DM user gets no config-command allowance', () => {
        const auth = checkAuthorizationExtended('stranger1', null, 'stranger1', 'dm', undefined, false)

        expect(auth.allowed).toBe(false)
        expect(auth.reason).toBe('dm_not_allowed')
        expect(auth.configCommandAllowed).toBeUndefined()
      })

      test('authorized DM gets scoped storage context', () => {
        addScopedUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'root-user' })

        const auth = checkAuthorizationExtendedScoped('u1', null, 'u1', 'dm', undefined, false, 'telegram-default')

        expect(auth.allowed).toBe(true)
        expect(auth.storageContextId).toBe('pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dTE')
        expect(auth.configContextId).toBe('pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dTE')
      })

      test('authorized user has DM access but is not bot admin', () => {
        addUser('user1', 'user1')

        const dmAuth = checkAuthorizationExtended('user1', null, 'user1', 'dm', undefined, false)

        expect(dmAuth.allowed).toBe(true)
        expect(dmAuth.isBotAdmin).toBe(false)
        expect(dmAuth.isGroupAdmin).toBe(false)
        expect(dmAuth.storageContextId).toBe(SCOPED_USER1)
        expect(dmAuth.configContextId).toBe(SCOPED_USER1)
      })

      test('unauthorized user has no access but gets context IDs', () => {
        const unauthorizedDmAuth = checkAuthorizationExtended('stranger1', null, 'stranger1', 'dm', undefined, false)

        expect(unauthorizedDmAuth.allowed).toBe(false)
        expect(unauthorizedDmAuth.isBotAdmin).toBe(false)
        expect(unauthorizedDmAuth.isGroupAdmin).toBe(false)
        expect(unauthorizedDmAuth.storageContextId).toBe(SCOPED_STRANGER1)
        expect(unauthorizedDmAuth.configContextId).toBe(SCOPED_STRANGER1)
        expect(unauthorizedDmAuth.reason).toBe('dm_not_allowed')
      })

      test('user resolved by username gets access without bot admin privileges', () => {
        addUser('placeholder-realuser1', 'admin1', 'realuser1')

        const resolvedAuth = checkAuthorizationExtended('stranger1', 'realuser1', 'stranger1', 'dm', undefined, false)

        expect(resolvedAuth.allowed).toBe(true)
        expect(resolvedAuth.isBotAdmin).toBe(false)
        expect(resolvedAuth.configContextId).toBe(SCOPED_STRANGER1)
      })
    })
  })
})

const PI = 'telegram-default'

describe('checkAuthorizationExtended — open DM access', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('open access off: unknown DM user is denied with dm_not_allowed', () => {
    const auth = checkAuthorizationExtendedScoped('u-new', null, 'u-new', 'dm', undefined, false, PI)
    expect(auth.allowed).toBe(false)
    expect(auth.reason).toBe('dm_not_allowed')
    expect(isAuthorized('u-new', PI)).toBe(false)
  })

  test('open access on: unknown DM user is auto-added and allowed', () => {
    setOpenDmAccess(PI, true)
    const auth = checkAuthorizationExtendedScoped('u-open', 'opener', 'u-open', 'dm', undefined, false, PI)
    expect(auth.allowed).toBe(true)
    expect(auth.isBotAdmin).toBe(false)
    expect(isAuthorized('u-open', PI)).toBe(true)
  })

  test('open access on: blocked user is denied and not re-added', () => {
    setOpenDmAccess(PI, true)
    // first DM adds the user
    checkAuthorizationExtendedScoped('u-blk', null, 'u-blk', 'dm', undefined, false, PI)
    expect(blockUser('u-blk', PI)).toBe(true)
    const auth = checkAuthorizationExtendedScoped('u-blk', null, 'u-blk', 'dm', undefined, false, PI)
    expect(auth.allowed).toBe(false)
    expect(auth.reason).toBe('user_blocked')
  })

  test('open access on does not affect group contexts', () => {
    setOpenDmAccess(PI, true)
    const auth = checkAuthorizationExtendedScoped('u-grp', null, 'group-xyz', 'group', undefined, false, PI)
    expect(auth.allowed).toBe(false)
    expect(auth.reason).toBe('group_not_allowed')
  })

  test('isOpenDmAccessEnabled reflects the toggle', () => {
    expect(isOpenDmAccessEnabled(PI)).toBe(false)
    setOpenDmAccess(PI, true)
    expect(isOpenDmAccessEnabled(PI)).toBe(true)
  })
})
