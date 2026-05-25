// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { cleanupExpiredCaches, evictUser } from '../src/cache-eviction.js'
import { getCachedConfig, setCachedConfig, userCachesForTesting } from '../src/cache.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  userCachesForTesting.clear()
})

describe('cleanupExpiredCaches', () => {
  test('removes expired cache entries older than TTL', () => {
    const userId = 'user-cleanup-test'
    setCachedConfig(userId, 'foo', 'bar')
    expect(userCachesForTesting.has(userId)).toBe(true)

    const cache = userCachesForTesting.get(userId)!
    cache.lastAccessed = Date.now() - 31 * 60 * 1000

    cleanupExpiredCaches()
    expect(userCachesForTesting.has(userId)).toBe(false)
  })

  test('retains recently accessed cache entries', () => {
    const userId = 'user-retain-test'
    setCachedConfig(userId, 'key', 'value')
    expect(userCachesForTesting.has(userId)).toBe(true)

    cleanupExpiredCaches()
    expect(userCachesForTesting.has(userId)).toBe(true)
  })
})

describe('evictUser', () => {
  test('removes an existing cache entry', () => {
    const userId = 'user-evict-test'
    getCachedConfig(userId, 'key')
    expect(userCachesForTesting.has(userId)).toBe(true)

    evictUser(userId)
    expect(userCachesForTesting.has(userId)).toBe(false)
  })

  test('does not throw when evicting a user with no cache entry', () => {
    expect(() => evictUser('non-existent-user')).not.toThrow()
  })
})
