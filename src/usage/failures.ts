// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents, toolCallEvents } from '../db/schema.js'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 25

export interface LlmFailureRow {
  kind: 'llm'
  ts: number
  turnId: string | null
  storageContextId: string
  contextType: string
  chatUserId: string
  model: string
  modelRole: string
  durationMs: number | null
  error: string
  finishReason: string | null
}

export interface ToolFailureRow {
  kind: 'tool'
  ts: number
  turnId: string
  storageContextId: string
  contextType: string
  chatUserId: string
  model: string
  modelRole: string
  durationMs: number | null
  toolName: string
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
}

export type FailureRow = LlmFailureRow | ToolFailureRow

export interface FailureQueryOptions {
  windowMs?: number | null
  limit?: number
}

const clampLimit = (limit: number | undefined): number =>
  Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)))

const computeSince = (windowMs: number | null | undefined): number =>
  windowMs === null || windowMs === undefined ? 0 : Date.now() - windowMs

const toBoolean = (value: number | null): boolean | null => (value === null ? null : value === 1)

const fetchLlmFailures = (since: number, limit: number): FailureRow[] =>
  getDrizzleDb()
    .select({
      occurredAt: llmUsageEvents.occurredAt,
      turnId: llmUsageEvents.turnId,
      storageContextId: llmUsageEvents.storageContextId,
      contextType: llmUsageEvents.contextType,
      chatUserId: llmUsageEvents.chatUserId,
      model: llmUsageEvents.model,
      modelRole: llmUsageEvents.modelRole,
      durationMs: llmUsageEvents.durationMs,
      error: llmUsageEvents.error,
      finishReason: llmUsageEvents.finishReason,
    })
    .from(llmUsageEvents)
    .where(and(isNotNull(llmUsageEvents.error), gte(llmUsageEvents.occurredAt, since)))
    .orderBy(desc(llmUsageEvents.occurredAt))
    .limit(limit)
    .all()
    .map((row) => ({
      kind: 'llm' as const,
      ts: row.occurredAt,
      turnId: row.turnId ?? null,
      storageContextId: row.storageContextId,
      contextType: row.contextType,
      chatUserId: row.chatUserId,
      model: row.model,
      modelRole: row.modelRole,
      durationMs: row.durationMs ?? null,
      error: row.error!,
      finishReason: row.finishReason ?? null,
    }))

const fetchToolFailures = (since: number, limit: number): FailureRow[] =>
  getDrizzleDb()
    .select({
      occurredAt: toolCallEvents.occurredAt,
      turnId: toolCallEvents.turnId,
      storageContextId: toolCallEvents.storageContextId,
      contextType: toolCallEvents.contextType,
      chatUserId: toolCallEvents.chatUserId,
      model: toolCallEvents.model,
      modelRole: toolCallEvents.modelRole,
      durationMs: toolCallEvents.durationMs,
      toolName: toolCallEvents.toolName,
      errorType: toolCallEvents.errorType,
      errorCode: toolCallEvents.errorCode,
      retryable: toolCallEvents.retryable,
      recovered: toolCallEvents.recovered,
    })
    .from(toolCallEvents)
    .where(and(eq(toolCallEvents.success, 0), gte(toolCallEvents.occurredAt, since)))
    .orderBy(desc(toolCallEvents.occurredAt))
    .limit(limit)
    .all()
    .map((row) => ({
      kind: 'tool' as const,
      ts: row.occurredAt,
      turnId: row.turnId,
      storageContextId: row.storageContextId,
      contextType: row.contextType,
      chatUserId: row.chatUserId,
      model: row.model,
      modelRole: row.modelRole,
      durationMs: row.durationMs ?? null,
      toolName: row.toolName,
      errorType: row.errorType ?? null,
      errorCode: row.errorCode ?? null,
      retryable: toBoolean(row.retryable),
      recovered: toBoolean(row.recovered),
    }))

export const listRecentFailures = (options: FailureQueryOptions = {}): FailureRow[] => {
  const safeLimit = clampLimit(options.limit)
  if (safeLimit === 0) return []
  const since = computeSince(options.windowMs)
  return [...fetchLlmFailures(since, safeLimit), ...fetchToolFailures(since, safeLimit)]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, safeLimit)
}
