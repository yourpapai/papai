// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'

import { userCachesForTesting, setCachedConfig } from '../src/cache.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import * as schema from '../src/db/schema.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../src/instances/admin-store.js'
import {
  addUser,
  addPendingUser,
  blockUser,
  isBlocked,
  isDemoUser,
  isAuthorized,
  removeUser,
  resolveUserByUsername,
  listUsers,
  unblockUser,
} from '../src/users.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'telegram-default'

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

beforeEach(() => {
  mockLogger()
})

describe('addUser', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('adds a user by ID', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    const definedUser = requireDefined(user)
    expect(definedUser.addedBy).toBe('999')
    expect(definedUser.username).toBeNull()
    expect(definedUser.platformInstanceId).toBe(TEST_PLATFORM_ID)
  })

  test('adds a user with username', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'testuser',
    })
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    const definedUser = requireDefined(user)
    expect(definedUser.username).toBe('testuser')
    expect(definedUser.addedBy).toBe('999')
  })

  test('does not overwrite existing user when adding by ID', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '888',
    })
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    const definedUser = requireDefined(user)
    expect(definedUser.addedBy).toBe('999')
  })

  test('addUser with existing ID and new username overwrites username', () => {
    addUser({
      userId: '123',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
    })
    addUser({
      userId: '123',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
      username: 'newname',
    })
    const users = listUsers()
    const user = users.find((u) => u.platform_user_id === '123')
    expect(user).toBeDefined()
    expect(user!.username).toBe('newname')
  })

  test('addUser with existing ID replaces username with null when no username provided', () => {
    addUser({
      userId: '456',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
      username: 'oldname',
    })
    addUser({
      userId: '456',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
    })
    const users = listUsers()
    const user = users.find((u) => u.platform_user_id === '456')
    expect(user).toBeDefined()
    expect(user!.username).toBeNull()
  })

  test('allows the same platform user ID on different platform instances', () => {
    addUser({
      userId: 'shared-user',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin-1',
    })
    addUser({
      userId: 'shared-user',
      platformInstanceId: 'discord-default',
      addedBy: 'admin-2',
    })

    expect(listUsers('telegram-default').map((u) => `${u.platform_instance_id}:${u.platform_user_id}`)).toEqual([
      'telegram-default:shared-user',
    ])
    expect(listUsers('discord-default').map((u) => `${u.platform_instance_id}:${u.platform_user_id}`)).toEqual([
      'discord-default:shared-user',
    ])
  })

  test('allows the same username placeholder on different platform instances', () => {
    addUser({
      userId: 'placeholder-tg-alice',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin-1',
      username: 'alice',
    })
    addUser({
      userId: 'placeholder-ds-alice',
      platformInstanceId: 'discord-default',
      addedBy: 'admin-2',
      username: 'alice',
    })

    expect(resolveUserByUsername('tg-real-alice', 'alice', 'telegram-default')).toBe(true)
    expect(resolveUserByUsername('ds-real-alice', 'alice', 'discord-default')).toBe(true)
    expect(isAuthorized('tg-real-alice', 'telegram-default')).toBe(true)
    expect(isAuthorized('ds-real-alice', 'discord-default')).toBe(true)
  })

  test('reuses username row on repeated add for same platform', () => {
    addUser({
      userId: 'placeholder-one',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
      username: 'alice',
    })
    addUser({
      userId: 'placeholder-two',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
      username: 'alice',
    })

    expect(listUsers(TEST_PLATFORM_ID).filter((user) => user.username === 'alice')).toHaveLength(1)
  })

  test('keeps same username rows independent across platform instances', () => {
    addUser({
      userId: 'placeholder-tg',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin',
      username: 'alice',
    })
    addUser({
      userId: 'placeholder-ds',
      platformInstanceId: 'discord-default',
      addedBy: 'admin',
      username: 'alice',
    })

    expect(
      listUsers()
        .filter((user) => user.username === 'alice')
        .map((user) => `${user.platform_instance_id}:${user.platform_user_id}`),
    ).toEqual(['telegram-default:placeholder-tg', 'discord-default:placeholder-ds'])
  })
})

describe('removeUser', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('removes a user by ID', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    removeUser('111', TEST_PLATFORM_ID)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('removes a user by username', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'testuser',
    })
    removeUser('testuser', TEST_PLATFORM_ID)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('returns true when user is removed', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    const result = removeUser('111', TEST_PLATFORM_ID)
    expect(result).toBe(true)
  })

  test('returns false when user does not exist', () => {
    const result = removeUser('nonexistent-user', TEST_PLATFORM_ID)
    expect(result).toBe(false)
  })

  test('returns false when removing same user twice', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    const firstResult = removeUser('111', TEST_PLATFORM_ID)
    expect(firstResult).toBe(true)
    const secondResult = removeUser('111', TEST_PLATFORM_ID)
    expect(secondResult).toBe(false)
  })

  test('evicts cache entry when a user is removed', () => {
    addUser({
      userId: 'cache-test',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    setCachedConfig('cache-test', 'some_key', 'some_value')

    expect(userCachesForTesting.has('cache-test')).toBe(true)

    const removed = removeUser('cache-test', TEST_PLATFORM_ID)

    expect(removed).toBe(true)
    expect(userCachesForTesting.has('cache-test')).toBe(false)
  })

  test('removes recurring tasks only for scoped platform owner', () => {
    const telegramOwner = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'same-id',
    })
    const discordOwner = toScopedContextId({
      platformInstanceId: 'discord-default',
      nativeContextId: 'same-id',
    })
    addUser({
      userId: 'same-id',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin',
    })
    addUser({
      userId: 'same-id',
      platformInstanceId: 'discord-default',
      addedBy: 'admin',
    })
    testDb
      .insert(schema.recurringTasks)
      .values({
        id: 'tg-recurring',
        userId: telegramOwner,
        projectId: 'p1',
        title: 'tg task',
        triggerType: 'cron',
      })
      .run()
    testDb
      .insert(schema.recurringTasks)
      .values({
        id: 'ds-recurring',
        userId: discordOwner,
        projectId: 'p1',
        title: 'ds task',
        triggerType: 'cron',
      })
      .run()

    expect(removeUser('same-id', 'telegram-default')).toBe(true)

    expect(testDb.select({ id: schema.recurringTasks.id }).from(schema.recurringTasks).all()).toEqual([
      { id: 'ds-recurring' },
    ])
  })
})

describe('isAuthorized', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns true for authorized user', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    expect(isAuthorized('111', TEST_PLATFORM_ID)).toBe(true)
  })

  test('returns false for unknown user', () => {
    expect(isAuthorized('222', TEST_PLATFORM_ID)).toBe(false)
  })
})

describe('isDemoUser', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('classifies demo users within the platform instance only', () => {
    addUser({
      userId: 'shared-user',
      platformInstanceId: 'telegram-default',
      addedBy: 'demo-auto',
    })
    addUser({
      userId: 'shared-user',
      platformInstanceId: 'discord-default',
      addedBy: 'admin',
    })

    expect(isDemoUser('shared-user', 'telegram-default')).toBe(true)
    expect(isDemoUser('shared-user', 'discord-default')).toBe(false)
  })
})

describe('resolveUserByUsername', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('resolves placeholder ID to real platform user ID', () => {
    addUser({
      userId: 'placeholder-abc',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'alice',
    })
    expect(resolveUserByUsername('555', 'alice', TEST_PLATFORM_ID)).toBe(true)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '555')).get()
    expect(user).toBeDefined()
    const oldUser = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, 'placeholder-abc')).get()
    expect(oldUser).toBeUndefined()
  })

  test('returns true when ID already matches', () => {
    addUser({
      userId: '555',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'alice',
    })
    expect(resolveUserByUsername('555', 'alice', TEST_PLATFORM_ID)).toBe(true)
  })

  test('does not update opaque user ID containing placeholder text', () => {
    addUser({
      userId: 'real-placeholder-user',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'alice',
    })

    expect(resolveUserByUsername('555', 'alice', TEST_PLATFORM_ID)).toBe(false)
    expect(isAuthorized('real-placeholder-user', TEST_PLATFORM_ID)).toBe(true)
    expect(isAuthorized('555', TEST_PLATFORM_ID)).toBe(false)
  })

  test('returns false for unknown username', () => {
    expect(resolveUserByUsername('555', 'unknown', TEST_PLATFORM_ID)).toBe(false)
  })

  test('updates one placeholder only', () => {
    addUser({
      userId: 'placeholder-one',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin',
      username: 'alice',
    })

    expect(resolveUserByUsername('real-alice', 'alice', TEST_PLATFORM_ID)).toBe(true)
    const aliceUsers = listUsers(TEST_PLATFORM_ID).filter((user) => user.username === 'alice')
    expect(aliceUsers).toHaveLength(1)
    expect(requireDefined(aliceUsers[0]).platform_user_id).toBe('real-alice')
  })

  test('binds case-insensitively', () => {
    addUser({
      userId: 'placeholder-ci',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'F4Dev',
    })
    expect(resolveUserByUsername('777', 'f4dev', TEST_PLATFORM_ID)).toBe(true)
    expect(isAuthorized('777', TEST_PLATFORM_ID)).toBe(true)
  })
})

describe('listUsers', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns all users', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    addUser({
      userId: '222',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
    })
    const users = listUsers()
    expect(users).toHaveLength(2)
  })

  test('returns empty array when no users', () => {
    expect(listUsers()).toHaveLength(0)
  })

  test('includes username when set', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: '999',
      username: 'testuser',
    })
    const users = listUsers()
    const user = requireDefined(users[0])
    expect(user.username).toBe('testuser')
  })
})

describe('platform-scoped authorization', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('authorizes only on the platform instance where the user was added', () => {
    addUser({
      userId: '111',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin-1',
    })

    expect(isAuthorized('111', 'telegram-default')).toBe(true)
    expect(isAuthorized('111', 'discord-default')).toBe(false)
  })

  test('super-admin is authorized on every platform instance without a users row', () => {
    addAdmin('root', SUPER_ADMIN_PLATFORM_ID)

    expect(isAuthorized('root', 'telegram-default')).toBe(true)
    expect(isAuthorized('root', 'discord-default')).toBe(true)
  })

  test('username placeholder resolution is scoped by platform instance', () => {
    addUser({
      userId: 'placeholder-alice',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin-1',
      username: 'alice',
    })

    expect(resolveUserByUsername('telegram-real', 'alice', 'discord-default')).toBe(false)
    expect(resolveUserByUsername('telegram-real', 'alice', 'telegram-default')).toBe(true)
    expect(isAuthorized('telegram-real', 'telegram-default')).toBe(true)
  })

  test('listUsers can return only one platform instance', () => {
    addUser({
      userId: 'tg-user',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin-1',
    })
    addUser({
      userId: 'ds-user',
      platformInstanceId: 'discord-default',
      addedBy: 'admin-1',
    })

    expect(listUsers('telegram-default').map((u) => u.platform_user_id)).toEqual(['tg-user'])
  })
})

describe('addPendingUser', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('creates a placeholder row with the cleaned username', () => {
    const added = addPendingUser({
      username: '@f4dev',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin-1',
    })
    expect(added).toBe('created')
    const rows = listUsers(TEST_PLATFORM_ID).filter((u) => u.username === 'f4dev')
    expect(rows).toHaveLength(1)
    const row = requireDefined(rows[0])
    expect(row.platform_user_id.startsWith('placeholder-')).toBe(true)
    expect(row.added_by).toBe('admin-1')
  })

  test('rejects an empty username', () => {
    expect(
      addPendingUser({
        username: '@',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe('invalid')
    expect(
      addPendingUser({
        username: '   ',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe('invalid')
    expect(listUsers(TEST_PLATFORM_ID)).toHaveLength(0)
  })

  test('is idempotent case-insensitively', () => {
    expect(
      addPendingUser({
        username: '@F4Dev',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe('created')
    expect(
      addPendingUser({
        username: 'f4dev',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe('pending_exists')
    expect(listUsers(TEST_PLATFORM_ID)).toHaveLength(1)
  })

  test('does not duplicate when a real user already holds the username', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin-1',
      username: 'jane',
    })
    expect(
      addPendingUser({
        username: '@Jane',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe('already_resolved')
    expect(listUsers(TEST_PLATFORM_ID)).toHaveLength(1)
    expect(requireDefined(listUsers(TEST_PLATFORM_ID)[0]).platform_user_id).toBe('111')
  })

  test('pending entry binds and authorizes on first contact', () => {
    expect(
      addPendingUser({
        username: '@f4dev',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe('created')
    expect(resolveUserByUsername('424242', 'f4dev', TEST_PLATFORM_ID)).toBe(true)
    expect(isAuthorized('424242', TEST_PLATFORM_ID)).toBe(true)
  })
})

describe('user blocking', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('isBlocked is false for unknown and unblocked users', () => {
    expect(isBlocked('nobody', 'telegram-default')).toBe(false)
    addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'manual' })
    expect(isBlocked('u1', 'telegram-default')).toBe(false)
  })

  test('blockUser blocks an existing user and unblockUser reverses it', () => {
    addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'manual' })
    expect(blockUser('u1', 'telegram-default')).toBe(true)
    expect(isBlocked('u1', 'telegram-default')).toBe(true)
    expect(unblockUser('u1', 'telegram-default')).toBe(true)
    expect(isBlocked('u1', 'telegram-default')).toBe(false)
  })

  test('blockUser returns false when no row exists', () => {
    expect(blockUser('ghost', 'telegram-default')).toBe(false)
  })

  test('listUsers includes added_by and blocked_at', () => {
    addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'open-access' })
    blockUser('u1', 'telegram-default')
    const row = listUsers('telegram-default').find((u) => u.platform_user_id === 'u1')
    expect(row?.added_by).toBe('open-access')
    expect(row?.blocked_at).not.toBeNull()
  })
})
