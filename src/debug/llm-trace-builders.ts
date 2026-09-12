// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Scope } from './event-bus.js'
import type { LlmTrace, LlmTraceToolCall } from './llm-trace-collector.js'
import { str, num, bool, optStr, tokenUsage, parseStepsDetail } from './state-collector-utils.js'

export type PendingLlmTrace = {
  startTimestamp: number
  userId: string
  model: string
  toolCalls: Array<LlmTraceToolCall>
  turnId: string | undefined
}

export type TraceEvent = {
  type: string
  timestamp: number
  scope: Scope
  data: Record<string, unknown>
  turnId?: string
}

export function buildTraceToolCall(data: Record<string, unknown>): LlmTraceToolCall {
  return {
    toolName: str(data['toolName']),
    durationMs: num(data['durationMs']),
    success: bool(data['success']),
    toolCallId: str(data['toolCallId']),
    args: data['args'],
    result: data['result'],
    error: str(data['error']),
  }
}

export function resolveModel(pending: PendingLlmTrace | undefined, data: Record<string, unknown>): string {
  if (pending === undefined) return str(data['model'])
  return pending.model
}

export function resolveToolCalls(pending: PendingLlmTrace | undefined): Array<LlmTraceToolCall> {
  if (pending === undefined) return []
  return pending.toolCalls
}

export function buildEndTrace(event: TraceEvent, userId: string, pending: PendingLlmTrace | undefined): LlmTrace {
  return {
    timestamp: event.timestamp,
    userId,
    chatUserId: optStr(event.data['chatUserId']),
    model: resolveModel(pending, event.data),
    steps: num(event.data['steps']),
    totalTokens: tokenUsage(event.data['tokenUsage']),
    duration: num(event.data['totalDuration']),
    toolCalls: resolveToolCalls(pending),
    error: undefined,
    responseId: str(event.data['responseId']),
    actualModel: str(event.data['actualModel']),
    finishReason: str(event.data['finishReason']),
    messageCount: num(event.data['messageCount']),
    toolCount: num(event.data['toolCount']),
    exposedToolCount: num(event.data['exposedToolCount']),
    fullToolCount: num(event.data['fullToolCount']),
    toolSchemaBytes: num(event.data['toolSchemaBytes']),
    routingIntent: str(event.data['routingIntent']),
    routingConfidence: num(event.data['routingConfidence']),
    routingReason: str(event.data['routingReason']),
    generatedText: str(event.data['generatedText']),
    stepsDetail: parseStepsDetail(event.data['stepsDetail']),
    currentTimeTag: optStr(event.data['currentTimeTag']),
  }
}

export function buildErrorTrace(event: TraceEvent, userId: string, pending: PendingLlmTrace | undefined): LlmTrace {
  const duration = pending === undefined ? 0 : event.timestamp - pending.startTimestamp
  return {
    timestamp: event.timestamp,
    userId,
    chatUserId: optStr(event.data['chatUserId']),
    model: resolveModel(pending, event.data),
    steps: 0,
    totalTokens: { inputTokens: 0, outputTokens: 0 },
    duration,
    toolCalls: resolveToolCalls(pending),
    error: str(event.data['error']),
    responseId: undefined,
    actualModel: undefined,
    finishReason: undefined,
    messageCount: undefined,
    toolCount: undefined,
    exposedToolCount: undefined,
    fullToolCount: undefined,
    toolSchemaBytes: undefined,
    routingIntent: undefined,
    routingConfidence: undefined,
    routingReason: undefined,
    generatedText: undefined,
    stepsDetail: undefined,
  }
}
