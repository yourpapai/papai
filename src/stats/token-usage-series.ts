// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'
import type { StatsWindow, TokenUsagePoint } from './types.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function cutoffFor(window: StatsWindow, now: number): number | null {
  if (window === 'all') return null
  if (window === '1d') return now - ONE_DAY_MS
  if (window === '7d') return now - 7 * ONE_DAY_MS
  return now - 30 * ONE_DAY_MS
}

const dayExpr = sql<string>`date(${llmUsageEvents.occurredAt} / 1000, 'unixepoch')`

function queryTokenSeries(where: SQL | undefined): TokenUsagePoint[] {
  const rows = getDrizzleDb()
    .select({
      date: dayExpr.as('date'),
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)`.as('input_tokens'),
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)`.as('output_tokens'),
      calls: sql<number>`count(*)`.as('calls'),
    })
    .from(llmUsageEvents)
    .where(where)
    .groupBy(dayExpr)
    .orderBy(dayExpr)
    .all()

  return rows.map((r) => ({
    date: r.date,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    calls: r.calls,
  }))
}

/** Global daily token-usage series within the window, ascending by UTC day. Aggregate-only (anonymous). */
export function tokenUsageByDayGlobal(window: StatsWindow, now: number = Date.now()): TokenUsagePoint[] {
  const cutoff = cutoffFor(window, now)
  return queryTokenSeries(cutoff === null ? undefined : gte(llmUsageEvents.occurredAt, cutoff))
}

/** Per-subject daily token-usage series within the window, ascending by UTC day. */
export function tokenUsageByDayForSubject(
  storageContextId: string,
  window: StatsWindow,
  now: number = Date.now(),
): TokenUsagePoint[] {
  const cutoff = cutoffFor(window, now)
  const subject = eq(llmUsageEvents.storageContextId, storageContextId)
  return queryTokenSeries(cutoff === null ? subject : and(subject, gte(llmUsageEvents.occurredAt, cutoff)))
}
