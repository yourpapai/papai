// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { emitUser } from './debug/event-bus.js'
import { buildStepsDetail } from './llm-orchestrator-steps.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator-events' })

/**
 * Controlled analytics fields generated at the outbound request boundary (`invokeModel`).
 * Optional so legacy/debug emitters keep the existing event shape; the analytics
 * subscriber applies bounded defaults when they are absent.
 */
export type LlmAttemptAnalytics = Readonly<{
  attemptOrdinal: number
  modelRole: 'main' | 'small'
  providerBinding?: 'global' | 'byok' | 'mixed'
}>

const attemptAnalyticsData = (analytics: LlmAttemptAnalytics | undefined): Record<string, unknown> => {
  if (analytics === undefined) return {}
  return {
    attemptOrdinal: analytics.attemptOrdinal,
    modelRole: analytics.modelRole,
    ...(analytics.providerBinding === undefined ? {} : { providerBinding: analytics.providerBinding }),
  }
}

type TokenUsage = {
  inputTokens: number | undefined
  outputTokens: number | undefined
}

type ResultToolCall = {
  toolName: string
  toolCallId: string
  input: unknown
}

type ResultToolResult = {
  toolCallId: string
  output: unknown
}

type ResultStep = {
  toolCalls: Array<ResultToolCall>
  toolResults: Array<ResultToolResult>
} & Partial<{
  text: string
  finishReason: string
  content: ReadonlyArray<unknown>
  usage: TokenUsage
}>

type ResultResponse = {
  messages: ModelMessage[]
} & Partial<{
  id: string
  modelId: string
}>

// Result type after awaiting all streamText promises
export type ResolvedStreamTextResult = {
  text: string
  toolCalls: Array<ResultToolCall>
  toolResults: Array<ResultToolResult>
  steps: Array<ResultStep>
  finalStep: { response: ResultResponse }
  usage: TokenUsage
  finishReason: string
} & Partial<{
  reasoningText: string
  reasoning: unknown
  warnings: unknown[]
  request: unknown
  providerMetadata: unknown
}>

function stringifySingleToolSchema(toolName: string, value: unknown): string {
  log.debug({ toolName }, 'stringifySingleToolSchema')
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (key, nestedValue: unknown) => {
      if (key === '') return nestedValue
      if (typeof nestedValue === 'function') return '[function]'
      if (nestedValue !== null && typeof nestedValue === 'object') {
        if (seen.has(nestedValue)) return '[circular]'
        seen.add(nestedValue)
      }
      return nestedValue
    })
  } catch (error) {
    log.debug(
      { toolName, error: error instanceof Error ? error.message : String(error) },
      'Tool schema stringify failed',
    )
    return ''
  }
}

function estimateToolSchemaBytes(tools: ToolSet): number {
  log.debug({ toolCount: Object.keys(tools).length }, 'estimateToolSchemaBytes')
  let total = 0
  for (const [name, tool] of Object.entries(tools)) {
    total += name.length
    total += typeof tool.description === 'string' ? tool.description.length : 0
    total += stringifySingleToolSchema(name, tool.inputSchema).length
  }
  return total
}

function buildToolTelemetry(tools: ToolSet): Record<string, unknown> {
  const toolCount = Object.keys(tools).length
  log.debug({ toolCount }, 'buildToolTelemetry')
  return {
    toolCount,
    toolSchemaBytes: estimateToolSchemaBytes(tools),
  }
}

export function emitLlmStart(
  contextId: string,
  mainModel: string,
  messages: ModelMessage[],
  tools: ToolSet,
  turnId?: string,
  analytics?: LlmAttemptAnalytics,
): void {
  emitUser(
    'llm:start',
    contextId,
    {
      model: mainModel,
      messageCount: messages.length,
      ...buildToolTelemetry(tools),
      ...attemptAnalyticsData(analytics),
    },
    turnId,
  )
}

export function emitLlmEnd(
  contextId: string,
  chatUserId: string,
  contextType: 'dm' | 'group',
  mainModel: string,
  result: ResolvedStreamTextResult,
  startTime: number,
  messages: ModelMessage[],
  tools: ToolSet,
  turnId: string,
  analytics?: LlmAttemptAnalytics & { timeToFirstTokenMs: number | null },
): void {
  emitUser(
    'llm:end',
    contextId,
    {
      model: mainModel,
      steps: result.steps.length,
      totalDuration: Date.now() - startTime,
      tokenUsage: result.usage,
      responseId: result.finalStep.response.id,
      actualModel: result.finalStep.response.modelId,
      finishReason: result.finishReason,
      messageCount: messages.length,
      chatUserId,
      contextType,
      ...buildToolTelemetry(tools),
      generatedText: result.text,
      stepsDetail: buildStepsDetail(result.steps),
      ...attemptAnalyticsData(analytics),
      ...(analytics === undefined ? {} : { timeToFirstTokenMs: analytics.timeToFirstTokenMs }),
    },
    turnId,
  )
}
