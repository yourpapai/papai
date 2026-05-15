// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Test-only cache utilities for testing.
 * These were moved from src/cache.ts since they're only used in tests.
 */

import { _userCaches } from '../../src/cache.js'
import { logger } from '../../src/logger.js'

const log = logger.child({ scope: 'test-cache' })

/**
 * Clear the user cache for a specific user.
 * This is only used in tests to ensure clean state between test runs.
 */
export function clearUserCache(userId: string): void {
  _userCaches.delete(userId)
  log.info({ userId }, 'User cache cleared for testing')
}
