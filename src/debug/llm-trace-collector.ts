// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Scope } from './event-bus.js'
import { str, num, bool, tokenUsage, parseStepsDetail } from './state-collector-utils.js'

export type LlmTraceToolCall = {
  toolName: string
  durationMs: number
  success: boolean
  toolCallId: string | undefined
  args: unknown
  result: unknown
  error: string | undefined
}

export type LlmTrace = {
  timestamp: number
  userId: string
  model: string
  steps: number
  totalTokens: { inputTokens: number; outputTokens: number }
  duration: number
  toolCalls: Array<LlmTraceToolCall>
  error: string | undefined
  responseId: string | undefined
  actualModel: string | undefined
  finishReason: string | undefined
  messageCount: number | undefined
  toolCount: number | undefined
  exposedToolCount: number | undefined
  fullToolCount: number | undefined
  toolSchemaBytes: number | undefined
  routingIntent: string | undefined
  routingConfidence: number | undefined
  routingReason: string | undefined
  generatedText: string | undefined
  stepsDetail: ReturnType<typeof parseStepsDetail>
}

type PendingLlmTrace = {
  startTimestamp: number
  userId: string
  model: string
  toolCalls: Array<LlmTraceToolCall>
}

type TraceEvent = { type: string; timestamp: number; scope: Scope; data: Record<string, unknown> }
type TraceCallbacks = {
  pushTrace: (trace: LlmTrace) => void
  broadcastTrace: (trace: LlmTrace, ts: number) => void
}

const LLM_TRACE_CAPACITY = 65535

export const recentLlm: LlmTrace[] = []
export const pendingTraces = new Map<string, PendingLlmTrace>()

export function pushTrace(trace: LlmTrace): void {
  if (recentLlm.length >= LLM_TRACE_CAPACITY) recentLlm.shift()
  recentLlm.push(trace)
}

function buildTraceToolCall(data: Record<string, unknown>): LlmTraceToolCall {
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

function resolveModel(pending: PendingLlmTrace | undefined, data: Record<string, unknown>): string {
  if (pending === undefined) return str(data['model'])
  return pending.model
}

function resolveToolCalls(pending: PendingLlmTrace | undefined): Array<LlmTraceToolCall> {
  if (pending === undefined) return []
  return pending.toolCalls
}

function buildEndTrace(event: TraceEvent, userId: string, pending: PendingLlmTrace | undefined): LlmTrace {
  return {
    timestamp: event.timestamp,
    userId,
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
  }
}

function buildErrorTrace(event: TraceEvent, userId: string, pending: PendingLlmTrace | undefined): LlmTrace {
  const duration = pending === undefined ? 0 : event.timestamp - pending.startTimestamp
  return {
    timestamp: event.timestamp,
    userId,
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

function traceKey(event: TraceEvent): string {
  return event.scope.kind === 'user' ? event.scope.userId : str(event.data['userId'])
}

export function handleLlmTraceEvent(
  event: TraceEvent,
  callbacks: TraceCallbacks,
  stats: { totalLlmCalls: number; totalToolCalls: number },
  scheduleStatsBroadcast: () => void,
): void {
  const userId = traceKey(event)

  if (event.type === 'llm:start') {
    pendingTraces.set(userId, {
      startTimestamp: event.timestamp,
      userId,
      model: str(event.data['model']),
      toolCalls: [],
    })
  } else if (event.type === 'llm:tool_result') {
    const pending = pendingTraces.get(userId)
    if (pending !== undefined) pending.toolCalls.push(buildTraceToolCall(event.data))
    stats.totalToolCalls++
    scheduleStatsBroadcast()
  } else if (event.type === 'llm:end') {
    const pending = pendingTraces.get(userId)
    pendingTraces.delete(userId)
    const trace = buildEndTrace(event, userId, pending)
    callbacks.pushTrace(trace)
    stats.totalLlmCalls++
    scheduleStatsBroadcast()
    callbacks.broadcastTrace(trace, event.timestamp)
  } else if (event.type === 'llm:error') {
    const pending = pendingTraces.get(userId)
    pendingTraces.delete(userId)
    const trace = buildErrorTrace(event, userId, pending)
    callbacks.pushTrace(trace)
    callbacks.broadcastTrace(trace, event.timestamp)
  }
}
