// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ActorRole } from './chat/types.js'
import { runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { appendHistory } from './history.js'
import { collectTurnMessages, type TurnMessagesResult } from './llm-orchestrator-messages.js'
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
 * Drop steering messages whose text the run excluded from history.
 *
 * Matching is by text with one-removal semantics: two identical steers can arrive in one
 * run and only one may be excluded, and the SDK exposes no id or tag to tell them apart.
 * Non-steering messages are never dropped, and no text is logged.
 */
const withoutExcludedSteers = (messages: readonly ModelMessage[], excluded: readonly string[]): ModelMessage[] => {
  if (excluded.length === 0) return [...messages]
  const remaining = [...excluded]
  const kept: ModelMessage[] = []
  for (const message of messages) {
    if (message.role === 'user' && typeof message.content === 'string') {
      const match = remaining.indexOf(message.content)
      if (match !== -1) {
        remaining.splice(match, 1)
        continue
      }
    }
    kept.push(message)
  }
  return kept
}

/**
 * Persist a completed LLM turn. A `finishReason` of `'tool-calls'` means the turn stopped mid-task
 * at the tool-step cap and will be resumed by "continue"; it is forwarded as `truncated` so the trim
 * that would otherwise collapse the in-progress tool trace is deferred until the task completes.
 *
 * Delivered steering messages are persisted in place, except text the run excluded because the
 * stored user turn already carries that correction.
 */
export const recordAssistantTurn = (
  meta: AssistantTurnMeta,
  turn: { baseHistory: readonly ModelMessage[]; historyMessage: ModelMessage },
  result: TurnMessagesResult & { finishReason?: string },
  excludedSteerTexts: readonly string[] = [],
): void => {
  appendAssistantTurnHistory(
    meta.contextId,
    meta.configId,
    meta.mainModel,
    turn.baseHistory,
    turn.historyMessage,
    withoutExcludedSteers(collectTurnMessages(result), excludedSteerTexts),
    meta.contextType,
    meta.actorRole,
    result.finishReason === 'tool-calls',
  )
}
