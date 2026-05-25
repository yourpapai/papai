// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { userCacheStore } from './cache-store.js'
import { emitUser } from './debug/event-bus.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'cache' })

const SESSION_TTL_MS = 30 * 60 * 1000

export function cleanupExpiredCaches(): void {
  const now = Date.now()
  const expired: string[] = []
  for (const [userId, cache] of userCacheStore) {
    if (now - cache.lastAccessed > SESSION_TTL_MS) {
      expired.push(userId)
    }
  }
  for (const userId of expired) {
    userCacheStore.delete(userId)
    emitUser('cache:expire', userId, {})
    log.debug({ userId }, 'Expired user cache removed')
  }
  if (expired.length > 0) {
    log.info({ expiredCount: expired.length }, 'Cleaned up expired user caches')
  }
}

export function evictUser(userId: string): void {
  userCacheStore.delete(userId)
  emitUser('cache:expire', userId, {})
  log.debug({ userId }, 'User cache evicted')
}
