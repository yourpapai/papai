// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitUser } from './debug/event-bus.js'
import type { LlmAttemptAnalytics } from './llm-orchestrator-events.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator:support' })

/** Controlled failure classification carried alongside an llm:error debug event. */
export type LlmFailureAnalytics = LlmAttemptAnalytics &
  Readonly<{
    phase: 'resolution' | 'request' | 'stream'
    errorClass: string
    retryable: boolean | null
  }>

export const emitLlmError = (
  contextId: string,
  chatUserId: string,
  contextType: 'dm' | 'group',
  mainModel: string,
  startTime: number,
  messageCount: number,
  error: unknown,
  turnId?: string,
  analytics?: LlmFailureAnalytics,
): void => {
  emitUser(
    'llm:error',
    contextId,
    {
      error: error instanceof Error ? error.message : String(error),
      model: mainModel,
      chatUserId,
      contextType,
      durationMs: Date.now() - startTime,
      messageCount,
      ...(analytics === undefined
        ? {}
        : {
            attemptOrdinal: analytics.attemptOrdinal,
            modelRole: analytics.modelRole,
            ...(analytics.providerBinding === undefined ? {} : { providerBinding: analytics.providerBinding }),
            phase: analytics.phase,
            errorClass: analytics.errorClass,
            retryable: analytics.retryable,
          }),
    },
    turnId,
  )
}

export const logProcessMessage = (
  contextId: string,
  configContextId: string | undefined,
  chatUserId: string,
  userText: string,
  attachmentIds: readonly string[],
  turnId: string,
): void => {
  log.debug(
    { contextId, configContextId, chatUserId, userText, newAttachmentIds: attachmentIds, turnId },
    'processMessage called',
  )
  log.info({ contextId, chatUserId, messageLength: userText.length, turnId }, 'Message received from user')
}
