// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { subscribe, unsubscribe, type DebugEvent } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { recordUsage, type UsageEvent } from './recorder.js'
import {
  recordToolCall,
  type ToolCallClassification,
  type ToolCallEvent,
  updateToolCallClassification,
} from './tool-call-recorder.js'
import type { ContextType, ModelRole } from './types.js'

const log = logger.child({ scope: 'usage:subscriber' })

let initialised = false

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const asContextType = (value: unknown): ContextType | null => {
  if (value === 'dm' || value === 'group') return value
  return null
}

const asModelRole = (value: unknown): ModelRole | null => {
  if (value === 'main' || value === 'small' || value === 'embedding') return value
  return null
}

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value
  return null
}

const buildUsageFromLlmEnd = (event: DebugEvent): UsageEvent | null => {
  if (event.scope.kind !== 'user') return null
  const data = event.data
  const chatUserId = asString(data['chatUserId'])
  const contextType = asContextType(data['contextType'])
  const model = asString(data['model'])
  if (chatUserId === null || contextType === null || model === null) return null

  const tokenUsage = data['tokenUsage']
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  if (isRecord(tokenUsage)) {
    inputTokens = asNumber(tokenUsage['inputTokens'])
    outputTokens = asNumber(tokenUsage['outputTokens'])
  }

  const turnId = event.turnId ?? null
  return {
    occurredAt: event.timestamp,
    turnId,
    storageContextId: event.scope.userId,
    contextType,
    chatUserId,
    model,
    modelRole: 'main',
    inputTokens,
    outputTokens,
    stepCount: asNumber(data['steps']) ?? 0,
    toolCallCount: asNumber(data['toolCount']) ?? 0,
    messageCount: asNumber(data['messageCount']) ?? 0,
    finishReason: asString(data['finishReason']),
    durationMs: asNumber(data['totalDuration']) ?? 0,
    responseId: asString(data['responseId']),
    error: null,
  }
}

const buildUsageFromLlmError = (event: DebugEvent): UsageEvent | null => {
  if (event.scope.kind !== 'user') return null
  const data = event.data
  const chatUserId = asString(data['chatUserId'])
  const contextType = asContextType(data['contextType'])
  const model = asString(data['model'])
  const errorMessage = asString(data['error'])
  if (chatUserId === null || contextType === null || model === null || errorMessage === null) return null

  return {
    occurredAt: event.timestamp,
    turnId: event.turnId ?? null,
    storageContextId: event.scope.userId,
    contextType,
    chatUserId,
    model,
    modelRole: 'main',
    inputTokens: null,
    outputTokens: null,
    stepCount: 0,
    toolCallCount: 0,
    messageCount: asNumber(data['messageCount']) ?? 0,
    finishReason: null,
    durationMs: asNumber(data['durationMs']) ?? 0,
    responseId: null,
    error: errorMessage,
  }
}

const buildToolCallFromExecuteEnd = (event: DebugEvent): ToolCallEvent | null => {
  if (event.scope.kind !== 'user') return null
  if (event.turnId === undefined) return null
  const data = event.data
  const chatUserId = asString(data['chatUserId'])
  const contextType = asContextType(data['contextType'])
  const model = asString(data['model'])
  const modelRole = asModelRole(data['modelRole'])
  const toolName = asString(data['toolName'])
  const toolCallId = asString(data['toolCallId'])
  if (
    chatUserId === null ||
    contextType === null ||
    model === null ||
    modelRole === null ||
    toolName === null ||
    toolCallId === null
  ) {
    return null
  }
  if (modelRole === 'embedding') return null

  const success = data['success'] === true
  return {
    turnId: event.turnId,
    occurredAt: event.timestamp,
    storageContextId: event.scope.userId,
    contextType,
    chatUserId,
    model,
    modelRole,
    toolName,
    toolCallId,
    success,
    durationMs: asNumber(data['durationMs']),
    argsBytes: asNumber(data['argsBytes']),
    resultBytes: asNumber(data['resultBytes']),
    responseId: asString(data['responseId']),
  }
}

const buildClassificationFromEvent = (
  event: DebugEvent,
): { turnId: string; toolCallId: string; classification: ToolCallClassification } | null => {
  if (event.turnId === undefined) return null
  const data = event.data
  const toolCallId = asString(data['toolCallId'])
  if (toolCallId === null) return null
  return {
    turnId: event.turnId,
    toolCallId,
    classification: {
      errorType: asString(data['errorType']),
      errorCode: asString(data['errorCode']),
      retryable: asBoolean(data['retryable']),
      recovered: asBoolean(data['recovered']),
    },
  }
}

const handleEvent = (event: DebugEvent): void => {
  try {
    if (event.type === 'llm:end' || event.type === 'llm:error') {
      const usage: UsageEvent | null =
        event.type === 'llm:end' ? buildUsageFromLlmEnd(event) : buildUsageFromLlmError(event)
      if (usage !== null) recordUsage(usage)
      return
    }
    if (event.type === 'tool:execute_end') {
      const toolCall = buildToolCallFromExecuteEnd(event)
      if (toolCall !== null) recordToolCall(toolCall)
      return
    }
    if (event.type === 'tool:failure_classified') {
      const update = buildClassificationFromEvent(event)
      if (update !== null) updateToolCallClassification(update.turnId, update.toolCallId, update.classification)
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), eventType: event.type },
      'usage subscriber handler failure',
    )
  }
}

export const initUsageRecorder = (): void => {
  if (initialised) return
  subscribe(handleEvent)
  initialised = true
  log.info('usage recorder initialised')
}

export const resetUsageRecorderForTesting = (): void => {
  if (!initialised) return
  unsubscribe(handleEvent)
  initialised = false
}
