// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import { buildReplyChain } from './chain.js'
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

export type MessageScope = { kind: 'group'; groupContextId: string } | { kind: 'dm'; contextId: string }

const scopeWhere = (scope: MessageScope): SQL =>
  scope.kind === 'group'
    ? eq(messageMetadata.groupContextId, scope.groupContextId)
    : and(isNull(messageMetadata.groupContextId), eq(messageMetadata.contextId, scope.contextId))!

// Sanitize an FTS5 MATCH query: phrase-quote, escape internal double-quotes.
// Mirrors src/memos.ts sanitizeFtsQuery.
const sanitizeFtsQuery = (query: string): string => `"${query.replace(/"/gu, '""')}"`

export type SearchFilters = Readonly<{
  author?: string
  contextId?: string
  since?: number
  until?: number
}>

/** Scope-checked single fetch (used by get_message tool). */
export function getMessage(scope: MessageScope, messageId: string): CachedMessage | undefined {
  log.debug({ scopeKind: scope.kind, messageId }, 'getMessage called')
  const row = getDrizzleDb()
    .select()
    .from(messageMetadata)
    .where(and(eq(messageMetadata.messageId, messageId), scopeWhere(scope)))
    .get()
  return row === undefined ? undefined : rowToCachedMessage(row)
}

/**
 * FTS5 keyword search, bm25-ranked (ascending: lower bm25 = better match).
 * Joins the content table to its FTS5 index (same shape as src/memos.ts
 * keywordSearchMemos, but as a direct join so bm25 can rank the outer query);
 * scope + filters apply to content-table columns, so no out-of-scope row can
 * ever be returned.
 */
export function searchMessages(
  scope: MessageScope,
  query: string,
  filters: SearchFilters,
  limit: number,
): CachedMessage[] {
  log.debug({ scopeKind: scope.kind, query, limit }, 'searchMessages called')
  const safeQuery = sanitizeFtsQuery(query)
  const conditions: (SQL | undefined)[] = [
    scopeWhere(scope),
    sql`message_metadata_fts.message_metadata_fts MATCH ${safeQuery}`,
  ]
  if (filters.author !== undefined) {
    conditions.push(
      or(eq(messageMetadata.authorId, filters.author), eq(messageMetadata.authorUsername, filters.author)),
    )
  }
  if (filters.contextId !== undefined) conditions.push(eq(messageMetadata.contextId, filters.contextId))
  if (filters.since !== undefined) conditions.push(gt(messageMetadata.timestamp, filters.since))
  if (filters.until !== undefined) conditions.push(lt(messageMetadata.timestamp, filters.until))

  const rows = getDrizzleDb()
    .select({ row: messageMetadata })
    .from(messageMetadata)
    .innerJoin(sql`message_metadata_fts`, sql`message_metadata_fts.rowid = message_metadata.rowid`)
    .where(and(...conditions))
    .orderBy(sql`bm25(message_metadata_fts)`)
    .limit(limit)
    .all()
  log.info({ scopeKind: scope.kind, resultCount: rows.length }, 'Message search completed')
  return rows.map((r) => rowToCachedMessage(r.row))
}

export type MessageContextMode = 'temporal' | 'thread' | 'reply_chain'

export type MessageContextResult = {
  target?: CachedMessage
  before: CachedMessage[]
  after: CachedMessage[]
  replyChain?: string[]
}

/** Window around a message. temporal = by timestamp within scope; thread = same context_id; reply_chain = buildReplyChain. */
export function getMessageContext(
  scope: MessageScope,
  messageId: string,
  before: number,
  after: number,
  mode: MessageContextMode,
): MessageContextResult {
  log.debug({ scopeKind: scope.kind, messageId, before, after, mode }, 'getMessageContext called')
  const target = getMessage(scope, messageId)
  if (target === undefined) return { target: undefined, before: [], after: [] }

  if (mode === 'reply_chain') {
    const chain = buildReplyChain(target.contextId, target.messageId).chain
    return { target, before: [], after: [], replyChain: chain }
  }

  const threadFilter = mode === 'thread' ? eq(messageMetadata.contextId, target.contextId) : scopeWhere(scope)
  const db = getDrizzleDb()
  const beforeRows = db
    .select()
    .from(messageMetadata)
    .where(and(threadFilter, lt(messageMetadata.timestamp, target.timestamp)))
    .orderBy(desc(messageMetadata.timestamp))
    .limit(before)
    .all()
  const afterRows = db
    .select()
    .from(messageMetadata)
    .where(and(threadFilter, gt(messageMetadata.timestamp, target.timestamp)))
    .orderBy(asc(messageMetadata.timestamp))
    .limit(after)
    .all()
  return {
    target,
    before: beforeRows.map(rowToCachedMessage).reverse(),
    after: afterRows.map(rowToCachedMessage),
  }
}
