// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import type { CachedMessage } from './index.js'

const log = logger.child({ scope: 'message-cache:persistence' })

// Queue for pending writes
const pendingWrites = new Map<string, CachedMessage>()
let isFlushScheduled = false

export function scheduleMessagePersistence(message: CachedMessage): void {
  pendingWrites.set(`${message.contextId}:${message.messageId}`, message)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (isFlushScheduled) return
  isFlushScheduled = true
  queueMicrotask(() => {
    isFlushScheduled = false
    try {
      flushPendingWrites()
    } catch (err) {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to flush message cache to database',
      )
    }
  })
}

function flushPendingWrites(): void {
  if (pendingWrites.size === 0) return

  const writes = Array.from(pendingWrites.values())
  pendingWrites.clear()

  try {
    const db = getDrizzleDb()
    db.insert(messageMetadata)
      .values(
        writes.map((msg) => ({
          messageId: msg.messageId,
          contextId: msg.contextId,
          authorId: msg.authorId ?? null,
          authorUsername: msg.authorUsername ?? null,
          text: msg.text ?? null,
          replyToMessageId: msg.replyToMessageId ?? null,
          groupContextId: msg.groupContextId ?? null,
          timestamp: msg.timestamp,
        })),
      )
      .onConflictDoUpdate({
        target: [messageMetadata.contextId, messageMetadata.messageId],
        set: {
          authorId: sql`excluded.author_id`,
          authorUsername: sql`excluded.author_username`,
          text: sql`excluded.text`,
          replyToMessageId: sql`excluded.reply_to_message_id`,
          groupContextId: sql`excluded.group_context_id`,
          timestamp: sql`excluded.timestamp`,
        },
      })
      .run()

    log.debug({ count: writes.length }, 'Persisted messages to database')
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err), count: writes.length },
      'Failed to persist messages',
    )
    // Re-queue failed writes and schedule retry
    for (const msg of writes) {
      pendingWrites.set(`${msg.contextId}:${msg.messageId}`, msg)
    }
    setTimeout(scheduleFlush, 5000)
  }
}

export function getPendingWritesCount(): number {
  return pendingWrites.size
}

export function getIsFlushScheduled(): boolean {
  return isFlushScheduled
}
