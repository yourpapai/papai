// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ActorRole } from './chat/types.js'
import { runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { appendHistory } from './history.js'
import { logger } from './logger.js'
import { armMemoryCapture } from './long-term-memory/capture-debounce.js'
import { runMemoryExtractionInBackground } from './long-term-memory/runner.js'

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
  contextType: 'dm' | 'group' = 'dm',
  actorRole: ActorRole = 'member',
): void => {
  if (assistantMessages.length > 0) {
    appendHistory(contextId, assistantMessages)
    log.debug({ contextId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
  }
  const combined = [...history, ...assistantMessages]
  if (shouldTriggerTrim(combined, mainModel)) {
    void runTrimInBackground(contextId, combined, undefined, configId)
    if (actorRole !== 'guest') {
      void runMemoryExtractionInBackground({
        storageContextId: contextId,
        contextType,
        configContextId: configId,
        history: combined,
      })
    }
  }
  armMemoryCapture({
    storageContextId: contextId,
    configContextId: configId,
    contextType,
    history: combined,
    actorRole,
  })
}

export const appendAssistantTurnHistory = (
  contextId: string,
  configId: string,
  mainModel: string,
  baseHistory: readonly ModelMessage[],
  historyMessage: ModelMessage,
  assistantMessages: ModelMessage[],
  contextType: 'dm' | 'group',
  actorRole: ActorRole = 'member',
): void => {
  appendAssistantHistory(
    contextId,
    configId,
    mainModel,
    [...baseHistory, historyMessage],
    assistantMessages,
    contextType,
    actorRole,
  )
}
