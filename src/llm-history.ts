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
 *
 * When `truncated` is true the turn stopped at the tool-step cap (finishReason
 * `'tool-calls'`) and the user is expected to resume it by saying "continue". A turn like
 * that can add dozens of tool-call/result messages in one shot, which easily trips the
 * trim threshold — but trimming now would let a separate small model collapse the still
 * in-progress tool trace into a summary *before* the resume turn runs, destroying the
 * context the resume depends on (the model then re-reasons from scratch and re-issues
 * tool calls it already made). Defer trimming (and memory extraction) until a turn
 * completes normally; the accumulated trace is compressed then, at a safe boundary.
 */
export const appendAssistantHistory = (
  contextId: string,
  configId: string,
  mainModel: string,
  history: readonly ModelMessage[],
  assistantMessages: ModelMessage[],
  contextType: 'dm' | 'group' = 'dm',
  actorRole: ActorRole = 'member',
  truncated = false,
): void => {
  if (assistantMessages.length > 0) {
    appendHistory(contextId, assistantMessages)
    log.debug({ contextId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
  }
  const combined = [...history, ...assistantMessages]
  if (truncated) {
    log.debug(
      { contextId, historyLength: combined.length },
      'Turn truncated at step cap; deferring background trim until the task resumes and completes',
    )
  }
  if (!truncated && shouldTriggerTrim(combined, mainModel)) {
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
  truncated = false,
): void => {
  appendAssistantHistory(
    contextId,
    configId,
    mainModel,
    [...baseHistory, historyMessage],
    assistantMessages,
    contextType,
    actorRole,
    truncated,
  )
}

export type AssistantTurnMeta = {
  contextId: string
  configId: string
  mainModel: string
  contextType: 'dm' | 'group'
  actorRole?: ActorRole
}

/**
 * Persist a completed LLM turn. A `finishReason` of `'tool-calls'` means the turn stopped mid-task
 * at the tool-step cap and will be resumed by "continue"; it is forwarded as `truncated` so the trim
 * that would otherwise collapse the in-progress tool trace is deferred until the task completes.
 */
export const recordAssistantTurn = (
  meta: AssistantTurnMeta,
  turn: { baseHistory: readonly ModelMessage[]; historyMessage: ModelMessage },
  result: { finalStep: { response: { messages: ModelMessage[] } }; finishReason?: string },
): void => {
  appendAssistantTurnHistory(
    meta.contextId,
    meta.configId,
    meta.mainModel,
    turn.baseHistory,
    turn.historyMessage,
    result.finalStep.response.messages,
    meta.contextType,
    meta.actorRole,
    result.finishReason === 'tool-calls',
  )
}
