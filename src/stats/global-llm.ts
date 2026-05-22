// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'
import type { LlmUsageGlobal, StatsWindow } from './types.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function cutoffFor(window: StatsWindow, now: number): number | null {
  if (window === 'all') return null
  if (window === '1d') return now - ONE_DAY_MS
  if (window === '7d') return now - 7 * ONE_DAY_MS
  return now - 30 * ONE_DAY_MS
}

export function llmUsageGlobal(window: StatsWindow, now: number = Date.now()): LlmUsageGlobal {
  const cutoff = cutoffFor(window, now)
  const baseQuery = getDrizzleDb()
    .select({
      role: llmUsageEvents.modelRole,
      calls: sql<number>`count(*)`.as('calls'),
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)`.as('input_tokens'),
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)`.as('output_tokens'),
    })
    .from(llmUsageEvents)

  const rows =
    cutoff === null
      ? baseQuery.groupBy(llmUsageEvents.modelRole).all()
      : baseQuery
          .where(sql`${llmUsageEvents.occurredAt} >= ${cutoff}`)
          .groupBy(llmUsageEvents.modelRole)
          .all()

  let mainCalls = 0
  let smallCalls = 0
  let embeddingCalls = 0
  let inputTokensTotal = 0
  let outputTokensTotal = 0
  for (const r of rows) {
    if (r.role === 'main') mainCalls = r.calls
    else if (r.role === 'small') smallCalls = r.calls
    else if (r.role === 'embedding') embeddingCalls = r.calls
    inputTokensTotal += r.inputTokens
    outputTokensTotal += r.outputTokens
  }

  return {
    totalCalls: mainCalls + smallCalls + embeddingCalls,
    mainCalls,
    smallCalls,
    embeddingCalls,
    inputTokensTotal,
    outputTokensTotal,
  }
}
