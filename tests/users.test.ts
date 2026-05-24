// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'

import { userCachesForTesting } from '../src/cache.js'
import * as schema from '../src/db/schema.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../src/instances/admin-store.js'
import {
  addUser,
  removeUser,
  isAuthorized,
  resolveUserByUsername,
  listUsers,
  getKaneoWorkspace,
  setKaneoWorkspace,
} from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

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
  })

  test('adds a user by ID', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    const definedUser = requireDefined(user)
    expect(definedUser.addedBy).toBe('999')
    expect(definedUser.username).toBeNull()
    expect(definedUser.platformInstanceId).toBe(TEST_PLATFORM_ID)
  })

  test('adds a user with username', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999', username: 'testuser' })
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    const definedUser = requireDefined(user)
    expect(definedUser.username).toBe('testuser')
    expect(definedUser.addedBy).toBe('999')
  })

  test('does not overwrite existing user when adding by ID', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '888' })
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    const definedUser = requireDefined(user)
    expect(definedUser.addedBy).toBe('999')
  })

  test('addUser with existing ID and new username overwrites username', () => {
    addUser({ userId: '123', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin' })
    addUser({ userId: '123', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin', username: 'newname' })
    const users = listUsers()
    const user = users.find((u) => u.platform_user_id === '123')
    expect(user).toBeDefined()
    expect(user!.username).toBe('newname')
  })

  test('addUser with existing ID replaces username with null when no username provided', () => {
    addUser({ userId: '456', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin', username: 'oldname' })
    addUser({ userId: '456', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin' })
    const users = listUsers()
    const user = users.find((u) => u.platform_user_id === '456')
    expect(user).toBeDefined()
    expect(user!.username).toBeNull()
  })
})

describe('removeUser', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('removes a user by ID', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    removeUser('111', TEST_PLATFORM_ID)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('removes a user by username', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999', username: 'testuser' })
    removeUser('testuser', TEST_PLATFORM_ID)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('returns true when user is removed', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    const result = removeUser('111', TEST_PLATFORM_ID)
    expect(result).toBe(true)
  })

  test('returns false when user does not exist', () => {
    const result = removeUser('nonexistent-user', TEST_PLATFORM_ID)
    expect(result).toBe(false)
  })

  test('returns false when removing same user twice', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    const firstResult = removeUser('111', TEST_PLATFORM_ID)
    expect(firstResult).toBe(true)
    const secondResult = removeUser('111', TEST_PLATFORM_ID)
    expect(secondResult).toBe(false)
  })

  test('evicts cached workspace entry when a user is removed', () => {
    addUser({ userId: 'cache-test', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    setKaneoWorkspace('cache-test', 'workspace-1')

    expect(userCachesForTesting.has('cache-test')).toBe(true)

    const removed = removeUser('cache-test', TEST_PLATFORM_ID)

    expect(removed).toBe(true)
    expect(userCachesForTesting.has('cache-test')).toBe(false)
  })
})

describe('isAuthorized', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns true for authorized user', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    expect(isAuthorized('111', TEST_PLATFORM_ID)).toBe(true)
  })

  test('returns false for unknown user', () => {
    expect(isAuthorized('222', TEST_PLATFORM_ID)).toBe(false)
  })
})

describe('resolveUserByUsername', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('resolves placeholder ID to real platform user ID', () => {
    addUser({ userId: 'placeholder-abc', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999', username: 'alice' })
    expect(resolveUserByUsername('555', 'alice', TEST_PLATFORM_ID)).toBe(true)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '555')).get()
    expect(user).toBeDefined()
    const oldUser = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, 'placeholder-abc')).get()
    expect(oldUser).toBeUndefined()
  })

  test('returns true when ID already matches', () => {
    addUser({ userId: '555', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999', username: 'alice' })
    expect(resolveUserByUsername('555', 'alice', TEST_PLATFORM_ID)).toBe(true)
  })

  test('returns false for unknown username', () => {
    expect(resolveUserByUsername('555', 'unknown', TEST_PLATFORM_ID)).toBe(false)
  })
})

describe('listUsers', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns all users', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    addUser({ userId: '222', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999' })
    const users = listUsers()
    expect(users).toHaveLength(2)
  })

  test('returns empty array when no users', () => {
    expect(listUsers()).toHaveLength(0)
  })

  test('includes username when set', () => {
    addUser({ userId: '111', platformInstanceId: TEST_PLATFORM_ID, addedBy: '999', username: 'testuser' })
    const users = listUsers()
    const user = requireDefined(users[0])
    expect(user.username).toBe('testuser')
  })
})

describe('platform-scoped authorization', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('authorizes only on the platform instance where the user was added', () => {
    addUser({ userId: '111', platformInstanceId: 'telegram-default', addedBy: 'admin-1' })

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
    addUser({ userId: 'tg-user', platformInstanceId: 'telegram-default', addedBy: 'admin-1' })
    addUser({ userId: 'ds-user', platformInstanceId: 'discord-default', addedBy: 'admin-1' })

    expect(listUsers('telegram-default').map((u) => u.platform_user_id)).toEqual(['tg-user'])
  })
})

describe('getKaneoWorkspace / setKaneoWorkspace', () => {
  beforeEach(async () => {
    await setupTestDb()
    userCachesForTesting.clear()
  })

  test('returns null when no workspace is set', () => {
    expect(getKaneoWorkspace('ws-user-1')).toBeNull()
  })

  test('set then get returns workspace ID', () => {
    setKaneoWorkspace('ws-user-2', 'ws-abc')
    expect(getKaneoWorkspace('ws-user-2')).toBe('ws-abc')
  })

  test('overwrites previous workspace', () => {
    setKaneoWorkspace('ws-user-3', 'ws-1')
    setKaneoWorkspace('ws-user-3', 'ws-2')
    expect(getKaneoWorkspace('ws-user-3')).toBe('ws-2')
  })

  test('user isolation — different users have independent workspaces', () => {
    setKaneoWorkspace('ws-user-4', 'ws-A')
    setKaneoWorkspace('ws-user-5', 'ws-B')
    expect(getKaneoWorkspace('ws-user-4')).toBe('ws-A')
    expect(getKaneoWorkspace('ws-user-5')).toBe('ws-B')
  })
})
