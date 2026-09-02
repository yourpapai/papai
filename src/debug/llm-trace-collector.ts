// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Scope } from './event-bus.js'
import { str, num, bool, optStr, tokenUsage, parseStepsDetail } from './state-collector-utils.js'

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
  userId: string | undefined
  chatUserId: string | undefined
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
  turnId: string | undefined
}

type TraceEvent = {
  type: string
  timestamp: number
  scope: Scope
  data: Record<string, unknown>
  turnId?: string
}
type TraceCallbacks = {
  pushTrace: (trace: LlmTrace) => void
  broadcastTrace: (trace: LlmTrace, ts: number) => void
}

export const LLM_TRACE_CAPACITY = 65535

/**
 * Per-user cap on stored pendings. Keys are user+turn scoped, and a turn aborted
 * between llm:start and its terminal event never consumes its entry, so without
 * a cap entries would accumulate per unique turn id over process uptime.
 */
const MAX_PENDING_PER_USER = 4

export const recentLlm: LlmTrace[] = []
export const pendingTraces = new Map<string, PendingLlmTrace>()

// Pending keys are scoped by user id AND turn id: a proactive generation
// overlapping an interactive turn in the same storage context shares the user
// key, and last-write-wins would let either side's start/end steal the other's
// pending (wrong model, misattributed tool calls).
const pendingKey = (userId: string, turnId: string | undefined): string => `${userId}\u0000${turnId ?? ''}`

const pendingEntriesForUser = (userId: string): Array<[string, PendingLlmTrace]> => {
  const prefix = `${userId}\u0000`
  return [...pendingTraces.entries()].filter(([key]) => key.startsWith(prefix))
}

/** Consume the pending for a terminal (llm:end/llm:error) event. */
const takePending = (userId: string, turnId: string | undefined): PendingLlmTrace | undefined => {
  const key = pendingKey(userId, turnId)
  const exact = pendingTraces.get(key)
  if (exact !== undefined) {
    pendingTraces.delete(key)
    return exact
  }
  // A terminal event whose turn id matches no pending must not consume another
  // turn's pending. Only turn-less emitters may fall back, and only when a
  // single pending remains, so the match is unambiguous.
  if (turnId !== undefined) return undefined
  const entries = pendingEntriesForUser(userId)
  if (entries.length !== 1) return undefined
  const entry = entries[0]!
  pendingTraces.delete(entry[0])
  return entry[1]
}

/** Resolve the pending an llm:tool_result attaches to. */
const pendingForToolResult = (userId: string, turnId: string | undefined): PendingLlmTrace | undefined => {
  const exact = pendingTraces.get(pendingKey(userId, turnId))
  if (exact !== undefined) return exact
  if (turnId !== undefined) return undefined
  // Tool results without a turn id (legacy emitters): attach to the most
  // recently started pending for the user.
  const entries = pendingEntriesForUser(userId)
  return entries.length === 0 ? undefined : entries[entries.length - 1]![1]
}

const prunePendingsForUser = (userId: string): void => {
  let excess = pendingEntriesForUser(userId).length - MAX_PENDING_PER_USER
  if (excess <= 0) return
  const prefix = `${userId}\u0000`
  for (const key of pendingTraces.keys()) {
    if (excess === 0) break
    if (key.startsWith(prefix)) {
      pendingTraces.delete(key)
      excess--
    }
  }
}

export function pushTrace(trace: LlmTrace): void {
  if (recentLlm.length >= LLM_TRACE_CAPACITY) recentLlm.shift()
  recentLlm.push(trace)
}

/** @public -- test seam: drain the captured trace buffer and pending traces. */
export function resetLlmBuffers(): void {
  recentLlm.length = 0
  pendingTraces.clear()
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
  }
}

function buildErrorTrace(event: TraceEvent, userId: string, pending: PendingLlmTrace | undefined): LlmTrace {
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

function traceKey(event: TraceEvent): string {
  return event.scope.kind === 'user' ? event.scope.userId : str(event.data['userId'])
}

function traceUserId(event: TraceEvent, correlationKey: string): string {
  const chatUserId = str(event.data['chatUserId'])
  return chatUserId === '' ? correlationKey : chatUserId
}

/**
 * @public -- anonymity-safe egress shape for an LLM trace: a trace attributed to the viewing
 * admin (via `chatUserId`) passes verbatim (same reference); any other trace — including
 * unattributed ones — loses the identity fields (`userId`, `chatUserId`), `generatedText`,
 * `stepsDetail`, and per-tool-call `args`/`result`, keeping metadata (tool names, durations,
 * success flags, model ids, token/step counters).
 * Pure and idempotent: never mutates the input; shaping an already-shaped trace is a no-op.
 */
export function shapeLlmTrace(trace: LlmTrace, viewingChatUserId: string | undefined): LlmTrace {
  if (viewingChatUserId !== undefined && trace.chatUserId === viewingChatUserId) return trace
  return {
    ...trace,
    userId: undefined,
    chatUserId: undefined,
    generatedText: undefined,
    stepsDetail: undefined,
    toolCalls: trace.toolCalls.map((call) => ({ ...call, args: undefined, result: undefined })),
  }
}

export function handleLlmTraceEvent(
  event: TraceEvent,
  callbacks: TraceCallbacks,
  stats: { totalLlmCalls: number; totalToolCalls: number },
  scheduleStatsBroadcast: () => void,
): void {
  const userId = traceKey(event)

  if (event.type === 'llm:start') {
    pendingTraces.set(pendingKey(userId, event.turnId), {
      startTimestamp: event.timestamp,
      userId,
      model: str(event.data['model']),
      toolCalls: [],
      turnId: event.turnId,
    })
    prunePendingsForUser(userId)
  } else if (event.type === 'llm:tool_result') {
    const pending = pendingForToolResult(userId, event.turnId)
    if (pending !== undefined) pending.toolCalls.push(buildTraceToolCall(event.data))
    stats.totalToolCalls++
    scheduleStatsBroadcast()
  } else if (event.type === 'llm:end') {
    const pending = takePending(userId, event.turnId)
    const trace = buildEndTrace(event, traceUserId(event, userId), pending)
    callbacks.pushTrace(trace)
    stats.totalLlmCalls++
    scheduleStatsBroadcast()
    callbacks.broadcastTrace(trace, event.timestamp)
  } else if (event.type === 'llm:error') {
    const pending = takePending(userId, event.turnId)
    const trace = buildErrorTrace(event, traceUserId(event, userId), pending)
    callbacks.pushTrace(trace)
    callbacks.broadcastTrace(trace, event.timestamp)
  }
}
