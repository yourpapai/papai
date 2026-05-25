// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { alertPrompts, memos, recurringTasks, scheduledPrompts, userInstructions } from '../db/schema.js'
import { keyedHash } from './hashing.js'
import { parseIsoToMs, safeParseTags } from './internal/util.js'
import type {
  AlertPromptStats,
  InstructionStats,
  MemoStats,
  RecurringTaskStats,
  ScheduledPromptStats,
} from './types.js'

type MemoAccum = {
  byStatus: Record<string, number>
  distinctTags: Set<string>
  tagTotal: number
  contentBytesTotal: number
  embeddingBytesTotal: number
  withEmbedding: number
  oldestMs: number | null
  newestMs: number | null
}

const newAccum = (): MemoAccum => ({
  byStatus: {},
  distinctTags: new Set(),
  tagTotal: 0,
  contentBytesTotal: 0,
  embeddingBytesTotal: 0,
  withEmbedding: 0,
  oldestMs: null,
  newestMs: null,
})

const embeddingByteLength = (embedding: unknown): number => {
  if (embedding instanceof Uint8Array) return embedding.byteLength
  if (typeof embedding === 'string') return Buffer.byteLength(embedding, 'utf8')
  return 0
}

type MemoRow = {
  content: string
  tags: string
  embedding: unknown
  status: string
  createdAt: string
}

const accumulateMemoRow = (acc: MemoAccum, row: MemoRow): void => {
  acc.byStatus[row.status] = (acc.byStatus[row.status] ?? 0) + 1
  acc.contentBytesTotal += Buffer.byteLength(row.content, 'utf8')
  if (row.embedding !== null && row.embedding !== undefined) {
    acc.withEmbedding += 1
    acc.embeddingBytesTotal += embeddingByteLength(row.embedding)
  }
  const tags = safeParseTags(row.tags)
  acc.tagTotal += tags.length
  for (const t of tags) acc.distinctTags.add(t)
  const ms = parseIsoToMs(row.createdAt)
  if (ms === null) return
  if (acc.oldestMs === null || ms < acc.oldestMs) acc.oldestMs = ms
  if (acc.newestMs === null || ms > acc.newestMs) acc.newestMs = ms
}

export function memosForSubject(storageContextId: string): MemoStats {
  const rows = getDrizzleDb()
    .select({
      content: memos.content,
      tags: memos.tags,
      embedding: memos.embedding,
      status: memos.status,
      createdAt: memos.createdAt,
    })
    .from(memos)
    .where(eq(memos.userId, storageContextId))
    .all()

  if (rows.length === 0) {
    return {
      total: 0,
      byStatus: {},
      tagCardinality: { distinct: 0, meanPerMemo: 0 },
      contentBytesTotal: 0,
      embeddingBytesTotal: 0,
      withEmbedding: 0,
      oldestCreatedAt: null,
      newestCreatedAt: null,
    }
  }

  const acc = newAccum()
  for (const row of rows) accumulateMemoRow(acc, row)

  return {
    total: rows.length,
    byStatus: acc.byStatus,
    tagCardinality: { distinct: acc.distinctTags.size, meanPerMemo: acc.tagTotal / rows.length },
    contentBytesTotal: acc.contentBytesTotal,
    embeddingBytesTotal: acc.embeddingBytesTotal,
    withEmbedding: acc.withEmbedding,
    oldestCreatedAt: acc.oldestMs,
    newestCreatedAt: acc.newestMs,
  }
}

export function scheduledForSubject(storageContextId: string): ScheduledPromptStats {
  const rows = getDrizzleDb()
    .select({
      status: scheduledPrompts.status,
      deliveryContextId: scheduledPrompts.deliveryContextId,
    })
    .from(scheduledPrompts)
    .where(eq(scheduledPrompts.createdByUserId, storageContextId))
    .all()

  const byStatus: Record<string, number> = {}
  const targets = new Set<string>()
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    if (r.deliveryContextId !== null && r.deliveryContextId !== '') targets.add(r.deliveryContextId)
  }

  return { total: rows.length, byStatus, distinctDeliveryTargets: targets.size }
}

export function alertsForSubject(storageContextId: string): AlertPromptStats {
  const rows = getDrizzleDb()
    .select({ status: alertPrompts.status })
    .from(alertPrompts)
    .where(eq(alertPrompts.createdByUserId, storageContextId))
    .all()

  const byStatus: Record<string, number> = {}
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

  return { total: rows.length, byStatus }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function recurringForSubject(storageContextId: string): RecurringTaskStats {
  const rows = getDrizzleDb()
    .select({
      projectId: recurringTasks.projectId,
      rrule: recurringTasks.rrule,
      enabled: recurringTasks.enabled,
      nextRun: recurringTasks.nextRun,
    })
    .from(recurringTasks)
    .where(eq(recurringTasks.userId, storageContextId))
    .all()

  let enabled = 0
  let disabled = 0
  const projects = new Set<string>()
  const rruleHashes = new Set<string>()
  let nextRunWithin7d = 0
  const now = Date.now()
  const cutoff = now + SEVEN_DAYS_MS

  for (const r of rows) {
    if (r.enabled === '1' || r.enabled === 'true') enabled += 1
    else disabled += 1
    projects.add(r.projectId)
    if (r.rrule !== null && r.rrule !== '') rruleHashes.add(keyedHash(`rrule:${r.rrule}`))

    const nextMs = parseIsoToMs(r.nextRun)
    if (nextMs !== null && nextMs >= now && nextMs <= cutoff) nextRunWithin7d += 1
  }

  return {
    total: rows.length,
    enabled,
    disabled,
    distinctProjects: projects.size,
    nextRunWithin7d,
    distinctRrulePatterns: rruleHashes.size,
  }
}

export function instructionsForSubject(storageContextId: string): InstructionStats {
  const row = getDrizzleDb()
    .select({
      total: sql<number>`count(*)`.as('total'),
      textBytesTotal: sql<number>`coalesce(sum(length(${userInstructions.text})), 0)`.as('text_bytes_total'),
    })
    .from(userInstructions)
    .where(and(eq(userInstructions.contextId, storageContextId)))
    .all()

  const r = row[0]
  return { total: r?.total ?? 0, textBytesTotal: r?.textBytesTotal ?? 0 }
}
