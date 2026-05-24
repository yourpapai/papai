// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import * as schema from '../src/db/schema.js'
import type { AddUserInput } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// Save original environment before any tests
const ORIGINAL_ENV = { ...process.env }

// Import the addUser function after mocking
type AddUserFn = (input: AddUserInput) => void
let addUser: AddUserFn
const TEST_PLATFORM_ID = 'legacy-single'

function requireUser(user: typeof schema.users.$inferSelect | undefined): typeof schema.users.$inferSelect {
  if (user === undefined) throw new Error('expected user row')
  return user
}

describe('index.ts startup - admin auto-authorization', () => {
  const ADMIN_USER_ID = '12345'

  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    // Reset environment
    process.env = { ...ORIGINAL_ENV }

    mockLogger()

    // Reset test database
    testDb = await setupTestDb()

    // Import addUser fresh for each test
    const usersModule = await import('../src/users.js')
    addUser = usersModule.addUser
  })

  test('addUser call from index.ts startup adds admin as self-referential', () => {
    // This simulates what index.ts does on line 56:
    // addUser({ userId: adminUserId, platformInstanceId: 'legacy-single', addedBy: adminUserId })
    addUser({ userId: ADMIN_USER_ID, platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_USER_ID })

    // Verify admin user was added to database
    const user = requireUser(
      testDb.select().from(schema.users).where(eq(schema.users.platformUserId, ADMIN_USER_ID)).get(),
    )

    expect(user.platformUserId).toBe(ADMIN_USER_ID)
    expect(user.addedBy).toBe(ADMIN_USER_ID)
    expect(user.username).toBeNull()
  })

  test('admin can add other users', () => {
    // First, add admin (simulating startup)
    addUser({ userId: ADMIN_USER_ID, platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_USER_ID })

    // Then admin adds a regular user
    const NEW_USER_ID = '67890'
    addUser({ userId: NEW_USER_ID, platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_USER_ID })

    const user = requireUser(
      testDb.select().from(schema.users).where(eq(schema.users.platformUserId, NEW_USER_ID)).get(),
    )

    expect(user.platformUserId).toBe(NEW_USER_ID)
    expect(user.addedBy).toBe(ADMIN_USER_ID)
  })

  test('admin can add user with username placeholder', () => {
    // First, add admin (simulating startup)
    addUser({ userId: ADMIN_USER_ID, platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_USER_ID })

    // Then admin adds a user by username (creates placeholder)
    const USERNAME = 'alice'
    const PLACEHOLDER_ID = `placeholder-${crypto.randomUUID()}`
    addUser({
      userId: PLACEHOLDER_ID,
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: ADMIN_USER_ID,
      username: USERNAME,
    })

    const user = requireUser(testDb.select().from(schema.users).where(eq(schema.users.username, USERNAME)).get())

    expect(user.username).toBe(USERNAME)
    expect(user.addedBy).toBe(ADMIN_USER_ID)
  })
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})
