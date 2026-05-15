// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emit } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import {
  getPendingWritesCount,
  getIsFlushScheduled,
  restoreMessagesFromDb,
  scheduleMessagePersistence,
} from './persistence.js'
import { ONE_WEEK_MS, type CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache' })

// In-memory cache: "contextId:messageId" -> CachedMessage
const messageCache = new Map<string, CachedMessage>()

/** Restore message cache from database on startup. */
export function initializeMessageCache(): void {
  const count = restoreMessagesFromDb(messageCache)
  if (count > 0) {
    log.info({ restoredCount: count, cacheSize: messageCache.size }, 'Message cache restored from database')
  }
}

/** Sweep expired entries from the in-memory message cache. */
export function sweepExpiredMessages(): void {
  const now = Date.now()
  let swept = 0
  for (const [key, msg] of messageCache) {
    if (now - msg.timestamp > ONE_WEEK_MS) {
      messageCache.delete(key)
      swept++
    }
  }
  if (swept > 0) {
    emit('msgcache:sweep', { swept, remaining: messageCache.size })
    log.info({ swept, remaining: messageCache.size }, 'Swept expired message cache entries')
  }
}

function cacheKey(contextId: string, messageId: string): string {
  return `${contextId}:${messageId}`
}

export function cacheMessage(message: CachedMessage): void {
  messageCache.set(cacheKey(message.contextId, message.messageId), message)
  scheduleMessagePersistence(message)
}

export function getCachedMessage(contextId: string, messageId: string): CachedMessage | undefined {
  const cached = messageCache.get(cacheKey(contextId, messageId))
  if (cached === undefined) return undefined

  // Check TTL (1 week)
  const now = Date.now()
  if (now - cached.timestamp > ONE_WEEK_MS) {
    messageCache.delete(cacheKey(contextId, messageId))
    return undefined
  }

  return cached
}

export type MessageCacheSnapshot = {
  size: number
  ttlMs: number
  pendingWrites: number
  isFlushScheduled: boolean
}

export function getMessageCacheSnapshot(): MessageCacheSnapshot {
  return {
    size: messageCache.size,
    ttlMs: ONE_WEEK_MS,
    pendingWrites: getPendingWritesCount(),
    isFlushScheduled: getIsFlushScheduled(),
  }
}
