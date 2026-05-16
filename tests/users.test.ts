// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'

import { _userCaches } from '../src/cache.js'
import * as schema from '../src/db/schema.js'
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

beforeEach(() => {
  mockLogger()
})

describe('addUser', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('adds a user by ID', () => {
    addUser('111', '999')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeDefined()
    expect(user?.addedBy).toBe('999')
    expect(user?.username).toBeNull()
  })

  test('adds a user with username', () => {
    addUser('111', '999', 'testuser')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeDefined()
    expect(user?.username).toBe('testuser')
    expect(user?.addedBy).toBe('999')
  })

  test('does not overwrite existing user when adding by ID', () => {
    addUser('111', '999')
    addUser('111', '888')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user?.addedBy).toBe('999')
  })

  test('addUser with existing ID and new username overwrites username', () => {
    addUser('123', 'admin')
    addUser('123', 'admin', 'newname')
    const users = listUsers()
    const user = users.find((u) => u.platform_user_id === '123')
    expect(user).toBeDefined()
    expect(user!.username).toBe('newname')
  })

  test('addUser with existing ID replaces username with null when no username provided', () => {
    addUser('456', 'admin', 'oldname')
    addUser('456', 'admin')
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
    addUser('111', '999')
    removeUser('111')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('removes a user by username', () => {
    addUser('111', '999', 'testuser')
    removeUser('testuser')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('returns true when user is removed', () => {
    addUser('111', '999')
    const result = removeUser('111')
    expect(result).toBe(true)
  })

  test('returns false when user does not exist', () => {
    const result = removeUser('nonexistent-user')
    expect(result).toBe(false)
  })

  test('returns false when removing same user twice', () => {
    addUser('111', '999')
    const firstResult = removeUser('111')
    expect(firstResult).toBe(true)
    const secondResult = removeUser('111')
    expect(secondResult).toBe(false)
  })

  test('evicts cached workspace entry when a user is removed', () => {
    addUser('cache-test', '999')
    setKaneoWorkspace('cache-test', 'workspace-1')

    expect(_userCaches.has('cache-test')).toBe(true)

    const removed = removeUser('cache-test')

    expect(removed).toBe(true)
    expect(_userCaches.has('cache-test')).toBe(false)
  })
})

describe('isAuthorized', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns true for authorized user', () => {
    addUser('111', '999')
    expect(isAuthorized('111')).toBe(true)
  })

  test('returns false for unknown user', () => {
    expect(isAuthorized('222')).toBe(false)
  })
})

describe('resolveUserByUsername', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('resolves placeholder ID to real platform user ID', () => {
    addUser('placeholder-abc', '999', 'alice')
    expect(resolveUserByUsername('555', 'alice')).toBe(true)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '555')).get()
    expect(user).toBeDefined()
    const oldUser = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, 'placeholder-abc')).get()
    expect(oldUser).toBeUndefined()
  })

  test('returns true when ID already matches', () => {
    addUser('555', '999', 'alice')
    expect(resolveUserByUsername('555', 'alice')).toBe(true)
  })

  test('returns false for unknown username', () => {
    expect(resolveUserByUsername('555', 'unknown')).toBe(false)
  })
})

describe('listUsers', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns all users', () => {
    addUser('111', '999')
    addUser('222', '999')
    const users = listUsers()
    expect(users).toHaveLength(2)
  })

  test('returns empty array when no users', () => {
    expect(listUsers()).toHaveLength(0)
  })

  test('includes username when set', () => {
    addUser('111', '999', 'testuser')
    const users = listUsers()
    expect(users[0]?.username).toBe('testuser')
  })
})

describe('getKaneoWorkspace / setKaneoWorkspace', () => {
  beforeEach(async () => {
    await setupTestDb()
    _userCaches.clear()
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
