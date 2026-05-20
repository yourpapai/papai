// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { toolCallEvents } from '../db/schema.js'
import { logger } from '../logger.js'
import { toolCallEventId } from './event-id.js'
import type { ContextType, ModelRole } from './types.js'

const log = logger.child({ scope: 'usage:tool-call-recorder' })

export type ToolCallEvent = {
  turnId: string
  occurredAt: number
  storageContextId: string
  contextType: ContextType
  chatUserId: string
  model: string
  modelRole: ModelRole
  toolName: string
  toolCallId: string
  success: boolean
  durationMs: number | null
  argsBytes: number | null
  resultBytes: number | null
  responseId: string | null
}

export type ToolCallClassification = {
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
}

const isUniqueConstraintError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_PRIMARYKEY/iu.test(err.message)
}

const boolToInt = (value: boolean | null): number | null => {
  if (value === null) return null
  return value ? 1 : 0
}

export const recordToolCall = (event: ToolCallEvent): void => {
  const eventId = toolCallEventId(event.turnId, event.toolCallId)
  try {
    getDrizzleDb()
      .insert(toolCallEvents)
      .values({
        eventId,
        turnId: event.turnId,
        occurredAt: event.occurredAt,
        storageContextId: event.storageContextId,
        contextType: event.contextType,
        chatUserId: event.chatUserId,
        model: event.model,
        modelRole: event.modelRole,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        success: event.success ? 1 : 0,
        durationMs: event.durationMs,
        argsBytes: event.argsBytes,
        resultBytes: event.resultBytes,
        responseId: event.responseId,
      })
      .run()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      log.warn({ eventId, toolName: event.toolName }, 'recordToolCall: duplicate event_id (already recorded)')
      return
    }
    log.error(
      { err: err instanceof Error ? err.message : String(err), toolName: event.toolName },
      'recordToolCall failed',
    )
  }
}

export const updateToolCallClassification = (
  turnId: string,
  toolCallId: string,
  classification: ToolCallClassification,
): void => {
  const eventId = toolCallEventId(turnId, toolCallId)
  try {
    getDrizzleDb()
      .update(toolCallEvents)
      .set({
        errorType: classification.errorType,
        errorCode: classification.errorCode,
        retryable: boolToInt(classification.retryable),
        recovered: boolToInt(classification.recovered),
      })
      .where(eq(toolCallEvents.eventId, eventId))
      .run()
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), turnId, toolCallId },
      'updateToolCallClassification failed',
    )
  }
}
