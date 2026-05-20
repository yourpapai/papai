// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments, conversationHistory, memorySummary, messageMetadata } from '../db/schema.js'
import type { AttachmentStats, ConversationStats, MessageMetadataStats } from './types.js'

const extractExtension = (filename: string): string => {
  const dot = filename.lastIndexOf('.')
  if (dot === -1 || dot === filename.length - 1) return '(none)'
  return filename.slice(dot + 1).toLowerCase()
}

type AttachmentRow = {
  status: string
  sourceProvider: string
  filename: string
  size: number | null
  isActive: number
}

const accumulateAttachmentRow = (row: AttachmentRow, acc: AttachmentStats): void => {
  acc.total += 1
  acc.byStatus[row.status] = (acc.byStatus[row.status] ?? 0) + 1
  acc.bySourceProvider[row.sourceProvider] = (acc.bySourceProvider[row.sourceProvider] ?? 0) + 1
  if (row.size !== null) acc.storedBytesTotal += row.size
  if (row.isActive === 1) acc.active += 1
  const ext = extractExtension(row.filename)
  acc.byExtension[ext] = (acc.byExtension[ext] ?? 0) + 1
}

export function attachmentsForSubject(storageContextId: string): AttachmentStats {
  const rows = getDrizzleDb()
    .select({
      status: attachments.status,
      sourceProvider: attachments.sourceProvider,
      filename: attachments.filename,
      size: attachments.size,
      isActive: attachments.isActive,
    })
    .from(attachments)
    .where(eq(attachments.contextId, storageContextId))
    .all()

  const acc: AttachmentStats = {
    total: 0,
    byStatus: {},
    bySourceProvider: {},
    storedBytesTotal: 0,
    active: 0,
    byExtension: {},
  }
  for (const row of rows) accumulateAttachmentRow(row, acc)
  return acc
}

export function messageMetadataForSubject(storageContextId: string): MessageMetadataStats {
  const row = getDrizzleDb()
    .select({
      total: sql<number>`count(*)`.as('total'),
      authoredBySubject:
        sql<number>`sum(case when ${messageMetadata.authorId} = ${storageContextId} then 1 else 0 end)`.as(
          'authored_by_subject',
        ),
      oldestTimestamp: sql<number | null>`min(${messageMetadata.timestamp})`.as('oldest'),
      newestTimestamp: sql<number | null>`max(${messageMetadata.timestamp})`.as('newest'),
      textBytesTotal: sql<number>`coalesce(sum(length(${messageMetadata.text})), 0)`.as('text_bytes_total'),
    })
    .from(messageMetadata)
    .where(eq(messageMetadata.contextId, storageContextId))
    .all()

  const r = row[0]
  if (r === undefined || r.total === 0) {
    return {
      total: 0,
      authoredBySubject: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      textBytesTotal: 0,
    }
  }

  return {
    total: r.total,
    authoredBySubject: r.authoredBySubject ?? 0,
    oldestTimestamp: r.oldestTimestamp,
    newestTimestamp: r.newestTimestamp,
    textBytesTotal: r.textBytesTotal,
  }
}

const countMessagesArray = (raw: string): number => {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

export function conversationForSubject(storageContextId: string): ConversationStats {
  const historyRows = getDrizzleDb()
    .select({ messages: conversationHistory.messages })
    .from(conversationHistory)
    .where(eq(conversationHistory.userId, storageContextId))
    .all()

  const summaryRows = getDrizzleDb()
    .select({ userId: memorySummary.userId })
    .from(memorySummary)
    .where(eq(memorySummary.userId, storageContextId))
    .all()

  const turnCount = historyRows.length === 0 ? 0 : countMessagesArray(historyRows[0]?.messages ?? '')
  return { turnCount, summaryPresent: summaryRows.length > 0 }
}
