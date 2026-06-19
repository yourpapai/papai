// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, desc, eq, gte } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'
import { logger } from '../logger.js'
import { tokenUsageByDayForSubject } from '../stats/token-usage-series.js'
import type { StatsWindow, TokenUsagePoint } from '../stats/types.js'
import { listSubjects } from '../usage/query.js'
import type { ModelRole, RequestRow, SubjectSummary } from '../usage/types.js'
import { resolveSubjectDisplayNames } from './subject-display-name.js'

const log = logger.child({ scope: 'debug:billing' })

export type BillingWindow = '24h' | '7d' | '30d' | 'all'

export type BillingSubject = SubjectSummary & {
  displayName: string | null
}

export type BillingDetail = {
  subject: BillingSubject
  requests: readonly RequestRow[]
  truncated: boolean
  tokenUsageByDay: readonly TokenUsagePoint[]
}

// Billing windows mostly mirror stats windows; '24h' maps to the stats '1d' bucket.
const toStatsWindow = (w: BillingWindow): StatsWindow => (w === '24h' ? '1d' : w)

export const BILLING_DETAIL_LIMIT = 500

const WINDOW_MS: Record<BillingWindow, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null,
}

const isBillingWindow = (value: string): value is BillingWindow =>
  value === '24h' || value === '7d' || value === '30d' || value === 'all'

export const parseWindow = (raw: string | null): BillingWindow | null => {
  if (raw === null) return '30d'
  return isBillingWindow(raw) ? raw : null
}

export const windowToMs = (w: BillingWindow): number | null => WINDOW_MS[w]

const isModelRole = (value: string): value is ModelRole =>
  value === 'main' || value === 'small' || value === 'embedding'

const decorate = (subjects: readonly SubjectSummary[]): BillingSubject[] => {
  const names = resolveSubjectDisplayNames(subjects)
  return subjects.map((s) => ({ ...s, displayName: names.get(s.storageContextId) ?? null }))
}

export const listBillingSubjects = (window: BillingWindow): BillingSubject[] => {
  log.debug({ window }, 'listBillingSubjects called')
  const summaries = listSubjects({ windowMs: windowToMs(window) })
  return decorate(summaries)
}

const computeSince = (window: BillingWindow): number => {
  const ms = windowToMs(window)
  return ms === null ? 0 : Date.now() - ms
}

const fetchRequests = (storageContextId: string, window: BillingWindow): { rows: RequestRow[]; truncated: boolean } => {
  const since = computeSince(window)
  const rows = getDrizzleDb()
    .select()
    .from(llmUsageEvents)
    .where(and(eq(llmUsageEvents.storageContextId, storageContextId), gte(llmUsageEvents.occurredAt, since)))
    .orderBy(desc(llmUsageEvents.occurredAt))
    .limit(BILLING_DETAIL_LIMIT + 1)
    .all()

  const truncated = rows.length > BILLING_DETAIL_LIMIT
  const capped = truncated ? rows.slice(0, BILLING_DETAIL_LIMIT) : rows

  const mapped: RequestRow[] = []
  for (const row of capped) {
    if (!isModelRole(row.modelRole)) continue
    mapped.push({
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      turnId: row.turnId,
      chatUserId: row.chatUserId,
      model: row.model,
      modelRole: row.modelRole,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      stepCount: row.stepCount,
      toolCallCount: row.toolCallCount,
      messageCount: row.messageCount,
      durationMs: row.durationMs,
      finishReason: row.finishReason,
      error: row.error,
    })
  }
  return { rows: mapped, truncated }
}

export const getBillingDetail = (storageContextId: string, window: BillingWindow): BillingDetail | null => {
  log.debug({ storageContextId, window }, 'getBillingDetail called')
  const { rows, truncated } = fetchRequests(storageContextId, window)
  if (rows.length === 0) return null

  const summaries = listSubjects({ windowMs: windowToMs(window) })
  const summary = summaries.find((s) => s.storageContextId === storageContextId)
  if (summary === undefined) {
    log.warn({ storageContextId }, 'detail rows present but no aggregate summary')
    return null
  }
  const [decorated] = decorate([summary])
  if (decorated === undefined) return null
  const tokenUsageByDay = tokenUsageByDayForSubject(storageContextId, toStatsWindow(window))
  return { subject: decorated, requests: rows, truncated, tokenUsageByDay }
}
