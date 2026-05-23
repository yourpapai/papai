// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { desc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'

const MAX_LIMIT = 200

export interface RecentRequestRow {
  ts: number
  modelLabel: string
  role: string
  inputTokens: number
  outputTokens: number
  finishStatus: string
}

export const listRecentRequests = (storageContextId: string, limit: number): RecentRequestRow[] => {
  const safeLimit = Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit)))
  if (safeLimit === 0) return []
  const rows = getDrizzleDb()
    .select({
      occurredAt: llmUsageEvents.occurredAt,
      model: llmUsageEvents.model,
      modelRole: llmUsageEvents.modelRole,
      inputTokens: llmUsageEvents.inputTokens,
      outputTokens: llmUsageEvents.outputTokens,
      finishReason: llmUsageEvents.finishReason,
    })
    .from(llmUsageEvents)
    .where(eq(llmUsageEvents.storageContextId, storageContextId))
    .orderBy(desc(llmUsageEvents.occurredAt))
    .limit(safeLimit)
    .all()
  return rows.map((row) => ({
    ts: row.occurredAt,
    modelLabel: row.model,
    role: row.modelRole,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    finishStatus: row.finishReason ?? 'unknown',
  }))
}
