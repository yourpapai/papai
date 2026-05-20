// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents, toolCallEvents } from '../db/schema.js'
import type {
  ContextType,
  ModelRole,
  RequestRow,
  SubjectRoleTotals,
  SubjectSummary,
  ToolCallRow,
  ToolCallSubjectSummary,
  UsageWindow,
} from './types.js'

const computeSince = (window: UsageWindow): number => (window.windowMs === null ? 0 : Date.now() - window.windowMs)

const emptyRoleTotals = (): SubjectRoleTotals => ({ inputTokens: 0, outputTokens: 0, calls: 0 })

type RoleAggregateRow = {
  storageContextId: string
  contextType: string
  modelRole: string
  calls: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  lastActiveAt: number
}

const isModelRole = (value: string): value is ModelRole =>
  value === 'main' || value === 'small' || value === 'embedding'

const isContextType = (value: string): value is ContextType => value === 'dm' || value === 'group'

const blankSummary = (storageContextId: string, contextType: ContextType): SubjectSummary => ({
  storageContextId,
  contextType,
  totals: { main: emptyRoleTotals(), small: emptyRoleTotals(), embedding: emptyRoleTotals() },
  toolCalls: 0,
  lastActiveAt: 0,
})

const pivotByRole = (rows: readonly RoleAggregateRow[]): SubjectSummary[] => {
  const map = new Map<string, SubjectSummary>()
  for (const row of rows) {
    if (!isContextType(row.contextType)) continue
    if (!isModelRole(row.modelRole)) continue
    const existing = map.get(row.storageContextId) ?? blankSummary(row.storageContextId, row.contextType)
    existing.totals[row.modelRole] = {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      calls: row.calls,
    }
    existing.toolCalls += row.toolCalls
    if (row.lastActiveAt > existing.lastActiveAt) existing.lastActiveAt = row.lastActiveAt
    map.set(row.storageContextId, existing)
  }
  return Array.from(map.values())
}

export const listSubjects = (window: UsageWindow): SubjectSummary[] => {
  const since = computeSince(window)
  const rows = getDrizzleDb()
    .select({
      storageContextId: llmUsageEvents.storageContextId,
      contextType: llmUsageEvents.contextType,
      modelRole: llmUsageEvents.modelRole,
      calls: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)`,
      toolCalls: sql<number>`coalesce(sum(${llmUsageEvents.toolCallCount}), 0)`,
      lastActiveAt: sql<number>`max(${llmUsageEvents.occurredAt})`,
    })
    .from(llmUsageEvents)
    .where(gte(llmUsageEvents.occurredAt, since))
    .groupBy(llmUsageEvents.storageContextId, llmUsageEvents.contextType, llmUsageEvents.modelRole)
    .all()
  return pivotByRole(rows)
}

const intToBool = (value: number | null): boolean | null => {
  if (value === null) return null
  return value !== 0
}

const isToolCallContextType = (value: string): value is ContextType => value === 'dm' || value === 'group'
const isToolCallModelRole = (value: string): value is 'main' | 'small' => value === 'main' || value === 'small'

export const listToolCallsForTurn = (turnId: string): ToolCallRow[] => {
  const rows = getDrizzleDb()
    .select()
    .from(toolCallEvents)
    .where(eq(toolCallEvents.turnId, turnId))
    .orderBy(asc(toolCallEvents.occurredAt))
    .all()
  return rows.flatMap((row): ToolCallRow[] => {
    if (!isToolCallContextType(row.contextType)) return []
    if (!isToolCallModelRole(row.modelRole)) return []
    return [
      {
        eventId: row.eventId,
        turnId: row.turnId,
        occurredAt: row.occurredAt,
        storageContextId: row.storageContextId,
        contextType: row.contextType,
        chatUserId: row.chatUserId,
        model: row.model,
        modelRole: row.modelRole,
        toolName: row.toolName,
        toolCallId: row.toolCallId,
        success: row.success !== 0,
        durationMs: row.durationMs,
        errorType: row.errorType,
        errorCode: row.errorCode,
        retryable: intToBool(row.retryable),
        recovered: intToBool(row.recovered),
        argsBytes: row.argsBytes,
        resultBytes: row.resultBytes,
        responseId: row.responseId,
      },
    ]
  })
}

type ToolCallAggregateRow = {
  storageContextId: string
  contextType: string
  totalCalls: number
  successCalls: number
  failureCalls: number
  argsBytesTotal: number
  resultBytesTotal: number
  durationMsTotal: number
}

export const summarizeToolCallsBySubject = (windowMs: number | null): ToolCallSubjectSummary[] => {
  const since = windowMs === null ? 0 : Date.now() - windowMs
  const rows: ToolCallAggregateRow[] = getDrizzleDb()
    .select({
      storageContextId: toolCallEvents.storageContextId,
      contextType: toolCallEvents.contextType,
      totalCalls: sql<number>`count(*)`,
      successCalls: sql<number>`coalesce(sum(${toolCallEvents.success}), 0)`,
      failureCalls: sql<number>`coalesce(sum(case when ${toolCallEvents.success} = 0 then 1 else 0 end), 0)`,
      argsBytesTotal: sql<number>`coalesce(sum(${toolCallEvents.argsBytes}), 0)`,
      resultBytesTotal: sql<number>`coalesce(sum(${toolCallEvents.resultBytes}), 0)`,
      durationMsTotal: sql<number>`coalesce(sum(${toolCallEvents.durationMs}), 0)`,
    })
    .from(toolCallEvents)
    .where(gte(toolCallEvents.occurredAt, since))
    .groupBy(toolCallEvents.storageContextId, toolCallEvents.contextType)
    .all()
  return rows.flatMap((row): ToolCallSubjectSummary[] => {
    if (!isToolCallContextType(row.contextType)) return []
    return [
      {
        storageContextId: row.storageContextId,
        contextType: row.contextType,
        totalCalls: row.totalCalls,
        successCalls: row.successCalls,
        failureCalls: row.failureCalls,
        argsBytesTotal: row.argsBytesTotal,
        resultBytesTotal: row.resultBytesTotal,
        durationMsTotal: row.durationMsTotal,
      },
    ]
  })
}

export const getSubjectDetail = (storageContextId: string, window: UsageWindow): RequestRow[] => {
  const since = computeSince(window)
  const rows = getDrizzleDb()
    .select()
    .from(llmUsageEvents)
    .where(and(eq(llmUsageEvents.storageContextId, storageContextId), gte(llmUsageEvents.occurredAt, since)))
    .orderBy(desc(llmUsageEvents.occurredAt))
    .all()
  return rows.flatMap((row): RequestRow[] => {
    if (!isModelRole(row.modelRole)) return []
    return [
      {
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
      },
    ]
  })
}
