// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolResultPart } from 'ai'

import { logger } from './logger.js'
import { createInterruptedToolFailureResult } from './tool-failure.js'

const log = logger.child({ scope: 'llm-validation' })

interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-call' &&
    'toolCallId' in part &&
    typeof part.toolCallId === 'string'
  )
}

function isToolResultPart(part: unknown): part is ToolResultPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-result' &&
    'toolCallId' in part &&
    typeof part.toolCallId === 'string'
  )
}

function extractToolCalls(message: ModelMessage): ToolCallPart[] {
  if (message.role !== 'assistant') return []
  if (typeof message.content === 'string') return []
  if (!Array.isArray(message.content)) return []
  const calls: ToolCallPart[] = []
  for (const part of message.content) {
    if (isToolCallPart(part)) {
      calls.push(part)
    }
  }
  return calls
}

function extractToolResults(message: ModelMessage): ToolResultPart[] {
  if (message.role !== 'tool') return []
  if (typeof message.content === 'string') return []
  if (!Array.isArray(message.content)) return []
  return message.content.filter(isToolResultPart)
}

function createSyntheticResult(toolCall: ToolCallPart): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    output: {
      type: 'json',
      value: createInterruptedToolFailureResult(toolCall.toolName, toolCall.toolCallId),
    },
  }
}

export function validateToolResults(messages: ModelMessage[]): ModelMessage[] {
  const toolCalls = new Map<string, ToolCallPart>()
  const toolResults = new Set<string>()

  for (const message of messages) {
    for (const call of extractToolCalls(message)) {
      toolCalls.set(call.toolCallId, call)
    }
    for (const result of extractToolResults(message)) {
      toolResults.add(result.toolCallId)
    }
  }

  const missingResults: ToolCallPart[] = []
  for (const [id, call] of toolCalls) {
    if (!toolResults.has(id)) {
      missingResults.push(call)
    }
  }

  if (missingResults.length === 0) {
    return messages
  }

  log.warn(
    { missingCount: missingResults.length, toolCallIds: missingResults.map((c) => c.toolCallId) },
    'Detected missing tool results, injecting synthetic error results',
  )

  const syntheticMessages: ModelMessage[] = missingResults.map((call) => ({
    role: 'tool',
    content: [createSyntheticResult(call)],
  }))

  return [...messages, ...syntheticMessages]
}
