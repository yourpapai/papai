// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'
import { logger } from '../logger.js'
import { usageEventId } from './event-id.js'
import type { ContextType, ModelRole } from './types.js'

const log = logger.child({ scope: 'usage:recorder' })

const isUniqueConstraintError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_PRIMARYKEY/iu.test(err.message)
}

export type UsageEvent = {
  occurredAt: number
  turnId: string | null
  storageContextId: string
  contextType: ContextType
  chatUserId: string
  model: string
  modelRole: ModelRole
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number
  toolCallCount: number
  messageCount: number
  finishReason: string | null
  durationMs: number
  responseId: string | null
  error: string | null
}

export const recordUsage = (event: UsageEvent): void => {
  if (event.turnId === null && event.responseId === null) {
    log.warn(
      { modelRole: event.modelRole, storageContextId: event.storageContextId },
      'recordUsage skipped: both turnId and responseId are null',
    )
    return
  }
  const eventId = usageEventId(event.turnId, event.responseId, event.modelRole)
  try {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId,
        occurredAt: event.occurredAt,
        turnId: event.turnId,
        storageContextId: event.storageContextId,
        contextType: event.contextType,
        chatUserId: event.chatUserId,
        model: event.model,
        modelRole: event.modelRole,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        stepCount: event.stepCount,
        toolCallCount: event.toolCallCount,
        messageCount: event.messageCount,
        finishReason: event.finishReason,
        durationMs: event.durationMs,
        responseId: event.responseId,
        error: event.error,
      })
      .run()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      log.warn({ eventId, modelRole: event.modelRole }, 'recordUsage: duplicate event_id (already recorded)')
      return
    }
    log.error(
      { err: err instanceof Error ? err.message : String(err), modelRole: event.modelRole },
      'recordUsage failed',
    )
  }
}
