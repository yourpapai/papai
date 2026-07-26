// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import type { CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache:store' })

export const rowToCachedMessage = (row: typeof messageMetadata.$inferSelect): CachedMessage => ({
  messageId: row.messageId,
  contextId: row.contextId,
  authorId: row.authorId ?? undefined,
  authorUsername: row.authorUsername ?? undefined,
  text: row.text ?? undefined,
  replyToMessageId: row.replyToMessageId ?? undefined,
  groupContextId: row.groupContextId ?? undefined,
  timestamp: row.timestamp,
})

/** Direct (context_id, message_id) lookup — thread-scoped, backs getCachedMessage + buildReplyChain. */
export function getMessageByContext(contextId: string, messageId: string): CachedMessage | undefined {
  const row = getDrizzleDb()
    .select()
    .from(messageMetadata)
    .where(and(eq(messageMetadata.contextId, contextId), eq(messageMetadata.messageId, messageId)))
    .get()
  if (row === undefined) {
    log.debug({ contextId, messageId }, 'message not found by context')
    return undefined
  }
  return rowToCachedMessage(row)
}
