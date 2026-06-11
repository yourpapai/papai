// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { appendHistory } from './history.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-history' })

/**
 * Persist the assistant's response to history and, if the resulting history crosses a
 * trim threshold (message-count or the model's token budget), kick off a background trim.
 */
export const appendAssistantHistory = (
  contextId: string,
  configId: string,
  mainModel: string,
  history: readonly ModelMessage[],
  assistantMessages: ModelMessage[],
): void => {
  if (assistantMessages.length > 0) {
    appendHistory(contextId, assistantMessages)
    log.debug({ contextId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
  }
  const combined = [...history, ...assistantMessages]
  if (shouldTriggerTrim(combined, mainModel)) {
    void runTrimInBackground(contextId, combined, undefined, configId)
  }
}
