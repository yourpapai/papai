// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents, toolCallEvents, webRateLimit } from '../db/schema.js'
import type { LlmUsageSubjectStats, ToolCallSubjectStats, WebFetchSubjectStats } from './types.js'

const TOP_TOOLS_LIMIT = 20

export function webFetchesForSubject(storageContextId: string): WebFetchSubjectStats {
  const row = getDrizzleDb()
    .select({ total: sql<number>`coalesce(sum(${webRateLimit.count}), 0)`.as('total') })
    .from(webRateLimit)
    .where(eq(webRateLimit.actorId, storageContextId))
    .all()
  return { totalRequests: row[0]?.total ?? 0 }
}

export function llmUsageForSubject(storageContextId: string): LlmUsageSubjectStats {
  const row = getDrizzleDb()
    .select({
      rowCount: sql<number>`count(*)`.as('row_count'),
      inputTokensTotal: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)`.as('input_tokens_total'),
      outputTokensTotal: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)`.as('output_tokens_total'),
    })
    .from(llmUsageEvents)
    .where(eq(llmUsageEvents.storageContextId, storageContextId))
    .all()
  const r = row[0]
  return {
    rowCount: r?.rowCount ?? 0,
    inputTokensTotal: r?.inputTokensTotal ?? 0,
    outputTokensTotal: r?.outputTokensTotal ?? 0,
  }
}

export function toolCallsForSubject(storageContextId: string): ToolCallSubjectStats {
  const rows = getDrizzleDb()
    .select({
      toolName: toolCallEvents.toolName,
      success: toolCallEvents.success,
      errorType: toolCallEvents.errorType,
    })
    .from(toolCallEvents)
    .where(eq(toolCallEvents.storageContextId, storageContextId))
    .all()

  let success = 0
  let failure = 0
  const toolCounts = new Map<string, number>()
  const errorTypeCounts: Record<string, number> = {}

  for (const r of rows) {
    if (r.success === 1) success += 1
    else failure += 1
    toolCounts.set(r.toolName, (toolCounts.get(r.toolName) ?? 0) + 1)
    if (r.errorType !== null && r.errorType !== '') {
      errorTypeCounts[r.errorType] = (errorTypeCounts[r.errorType] ?? 0) + 1
    }
  }

  const topTools = [...toolCounts.entries()]
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TOOLS_LIMIT)

  return { total: rows.length, success, failure, topTools, errorTypeCounts }
}
