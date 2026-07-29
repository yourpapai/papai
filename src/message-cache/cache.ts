// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { count } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import { getPendingWritesCount, getIsFlushScheduled, scheduleMessagePersistence } from './persistence.js'
import { getMessageByContext } from './store.js'
import type { CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache' })

/** Write: in-memory Map retired; DB is the source of truth. */
export function cacheMessage(message: CachedMessage): void {
  scheduleMessagePersistence(message)
}

/** Read: DB-backed (thread-scoped context_id + message_id). Mock replaces this in tests. */
export function getCachedMessage(contextId: string, messageId: string): CachedMessage | undefined {
  return getMessageByContext(contextId, messageId)
}

export type MessageCacheSnapshot = {
  size: number
  pendingWrites: number
  isFlushScheduled: boolean
}

export function getMessageCacheSnapshot(): MessageCacheSnapshot {
  const row = getDrizzleDb().select({ n: count() }).from(messageMetadata).get()
  log.debug({ size: row?.n ?? 0 }, 'Message cache snapshot')
  return {
    size: row?.n ?? 0,
    pendingWrites: getPendingWritesCount(),
    isFlushScheduled: getIsFlushScheduled(),
  }
}
