// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, eq, gt, gte, lt, or, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { LlmUsageEventRow } from '../../db/llm-usage-events-schema.js'
import { llmUsageEvents, toolCallEvents } from '../../db/schema.js'
import type { ToolCallEventRow } from '../../db/tool-call-events-schema.js'
import type { BackfillSourceTable } from './backfill-decisions.js'
import { LLM_SOURCE_TABLE } from './backfill-decisions.js'

type Db = ReturnType<typeof defaultGetDrizzleDb>

export type RowKey = Readonly<{ occurredAt: number; eventId: string }>

export const formatRowKey = (key: RowKey): string => `${key.occurredAt}:${key.eventId}`

export const hashHighWaterKey = (key: string): string => createHash('sha256').update(key).digest('hex').slice(0, 16)

export type BatchQuery = Readonly<{ cutoffMs: number; bound: RowKey; cursor: RowKey | null; limit: number }>

const keysetCondition = (
  table: typeof llmUsageEvents | typeof toolCallEvents,
  cursor: RowKey | null,
  bound: RowKey,
): ReturnType<typeof and> => {
  const afterCursor =
    cursor === null
      ? undefined
      : or(
          gt(table.occurredAt, cursor.occurredAt),
          and(eq(table.occurredAt, cursor.occurredAt), gt(table.eventId, cursor.eventId)),
        )
  const withinBound = or(
    lt(table.occurredAt, bound.occurredAt),
    and(eq(table.occurredAt, bound.occurredAt), sql`${table.eventId} <= ${bound.eventId}`),
  )
  return and(afterCursor, withinBound)
}

export const readLlmBatch = (db: Db, input: BatchQuery): LlmUsageEventRow[] =>
  db
    .select()
    .from(llmUsageEvents)
    .where(
      and(gte(llmUsageEvents.occurredAt, input.cutoffMs), keysetCondition(llmUsageEvents, input.cursor, input.bound)),
    )
    .orderBy(llmUsageEvents.occurredAt, llmUsageEvents.eventId)
    .limit(input.limit)
    .all()

export const readToolBatch = (db: Db, input: BatchQuery): ToolCallEventRow[] =>
  db
    .select()
    .from(toolCallEvents)
    .where(
      and(gte(toolCallEvents.occurredAt, input.cutoffMs), keysetCondition(toolCallEvents, input.cursor, input.bound)),
    )
    .orderBy(toolCallEvents.occurredAt, toolCallEvents.eventId)
    .limit(input.limit)
    .all()

export const computeBound = (db: Db, table: BackfillSourceTable, cutoffMs: number): RowKey | null => {
  const source = table === LLM_SOURCE_TABLE ? llmUsageEvents : toolCallEvents
  const row = db
    .select({ occurredAt: source.occurredAt, eventId: source.eventId })
    .from(source)
    .where(gte(source.occurredAt, cutoffMs))
    .orderBy(sql`${source.occurredAt} DESC`, sql`${source.eventId} DESC`)
    .limit(1)
    .get()
  return row === undefined ? null : { occurredAt: row.occurredAt, eventId: row.eventId }
}
