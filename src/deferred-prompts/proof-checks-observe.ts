// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { DebugEvent } from '../debug/event-bus.js'
import type { LlmTrace } from '../debug/llm-trace-collector.js'
import { logger } from '../logger.js'
import { localDatetimeToUtc } from '../utils/datetime.js'
import { finalizeDeliveryText } from './proactive-llm-helpers.js'
import { appendRecord, makeRecord, resolveLocale, resolveTimezone, SCHEDULED_POLL_MS } from './proof-checks-prompts.js'
import type { ProofCheckDeps, ProofCheckId, ProofCheckRequest } from './proof-checks.js'
import { appendProofJsonLine, type ProofVerdict } from './proof-store.js'

const log = logger.child({ scope: 'deferred:proof-checks' })

const BUG2_TOLERANCE_MS = 2 * SCHEDULED_POLL_MS

export interface ProofDeliveryRecord {
  runId: string
  responseText: string
  delivered: boolean
  at: string
}

const deliveryRecords = new Map<string, ProofDeliveryRecord>()

export const recordProofDelivery = (runId: string, responseText: string, at: string): void => {
  const record: ProofDeliveryRecord = { runId, responseText, delivered: true, at }
  deliveryRecords.set(runId, record)
  appendProofJsonLine(record).catch((error: unknown) => {
    log.warn(
      { runId, error: error instanceof Error ? error.message : String(error) },
      'Failed to persist proof delivery record',
    )
  })
}

export const resetProofDeliveryRecords = (): void => {
  deliveryRecords.clear()
}

export interface AsyncRunState {
  runId: string
  checkId: ProofCheckId
  variant: string | undefined
  startMs: number
  fireAtMs: number | null
  isAlertVariant: boolean
  executions: number[]
}

const findOwnTrace = (
  traces: readonly LlmTrace[],
  chatUserId: string,
  sinceMs: number,
  anchorMs: number,
): LlmTrace | null => {
  let own: LlmTrace | null = null
  let ownDelta = Number.POSITIVE_INFINITY
  for (const trace of traces) {
    if (trace.chatUserId !== chatUserId || trace.timestamp < sinceMs) continue
    const delta = Math.abs(trace.timestamp - anchorMs)
    if (delta > ownDelta) continue
    if (delta === ownDelta && own !== null && trace.timestamp > own.timestamp) continue
    own = trace
    ownDelta = delta
  }
  return own
}

const CURRENT_TIME_TAG_RE = /<current_time>([^<]*)<\/current_time>/gu

const lastCurrentTimeTag = (messages: readonly ModelMessage[]): string | null => {
  let last: string | null = null
  for (const message of messages) {
    if (typeof message.content !== 'string') continue
    for (const match of message.content.matchAll(CURRENT_TIME_TAG_RE)) {
      const captured = match[1]
      if (captured !== undefined && captured.trim() !== '') last = captured
    }
  }
  return last
}

const TIME_TAG_RE = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/u

const parseTimeTag = (tag: string, timezone: string): number | null => {
  const match = TIME_TAG_RE.exec(tag.trim())
  if (match === null) return null
  const date = match[1]
  const time = match[2]
  if (date === undefined || time === undefined) return null
  const ms = Date.parse(localDatetimeToUtc(date, time, timezone))
  return Number.isNaN(ms) ? null : ms
}

const collectRowReads = (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  state: AsyncRunState,
  proofPromptId: string,
): void => {
  if (state.isAlertVariant) {
    const row = deps.getAlertPrompt(proofPromptId, request.storageContextId)
    const triggeredAt = row?.lastTriggeredAt ?? null
    if (triggeredAt !== null) {
      const ts = Date.parse(triggeredAt)
      if (!Number.isNaN(ts)) state.executions.push(ts)
    }
    return
  }
  const row = deps.getScheduledPrompt(proofPromptId, request.storageContextId)
  const executedAt = row?.lastExecutedAt ?? null
  if (executedAt !== null) {
    const ts = Date.parse(executedAt)
    if (!Number.isNaN(ts)) state.executions.push(ts)
  }
}

const bug2Verdict = (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  executionTs: number,
  observations: string[],
): ProofVerdict => {
  const tag = lastCurrentTimeTag(deps.readCachedHistory(request.storageContextId))
  if (tag === null) {
    observations.push('no <current_time> tag found in the cached history')
    return 'inconclusive'
  }
  const anchorMs = parseTimeTag(tag, resolveTimezone(request.storageContextId))
  if (anchorMs === null) {
    observations.push(`unparseable_time_tag: ${tag}`)
    return 'inconclusive'
  }
  const deltaMs = Math.abs(anchorMs - executionTs)
  observations.push(`anchor_tag: ${tag}`)
  observations.push(`anchor_at: ${new Date(anchorMs).toISOString()}`)
  observations.push(`delta_ms: ${deltaMs}`)
  observations.push(`tolerance_ms: ${BUG2_TOLERANCE_MS}`)
  return deltaMs > BUG2_TOLERANCE_MS ? 'fail' : 'pass'
}

const bug1Verdict = (
  request: ProofCheckRequest,
  runId: string,
  trace: LlmTrace,
  observations: string[],
): ProofVerdict => {
  observations.push(`finish_reason: ${trace.finishReason ?? 'none'}`)
  observations.push(`generated_text: ${trace.generatedText ?? ''}`)
  const failedTools = trace.toolCalls.filter((call) => !call.success).map((call) => call.toolName)
  if (failedTools.length > 0) observations.push(`failed_tools: ${failedTools.join(',')}`)
  const expected = finalizeDeliveryText(
    { text: trace.generatedText, finishReason: trace.finishReason },
    resolveLocale(request.storageContextId),
  )
  const delivered = deliveryRecords.get(runId)
  if (delivered === undefined) {
    observations.push('no delivery record for the run')
    return 'inconclusive'
  }
  observations.push(`delivered_text: ${delivered.responseText}`)
  observations.push(`expected_text: ${expected}`)
  return delivered.responseText === expected ? 'pass' : 'fail'
}

const computeVerdict = (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  state: AsyncRunState,
  observations: string[],
): ProofVerdict => {
  if (state.checkId === 'bug3_fires_on_creation') {
    for (const ts of state.executions) observations.push(`execution_at: ${new Date(ts).toISOString()}`)
    if (state.isAlertVariant) {
      observations.push(`executions_inside_window: ${state.executions.length}`)
      return state.executions.length > 0 ? 'fail' : 'pass'
    }
    const fireAtMs = state.fireAtMs
    if (fireAtMs === null) return 'inconclusive'
    observations.push(`fire_at: ${new Date(fireAtMs).toISOString()}`)
    return state.executions.some((ts) => ts < fireAtMs) ? 'fail' : 'pass'
  }
  const executionTs = state.executions[0]
  if (executionTs === undefined) {
    observations.push('no execution observed within the window')
    return 'inconclusive'
  }
  observations.push(`executed_at: ${new Date(executionTs).toISOString()}`)
  const trace = findOwnTrace(deps.readRecentLlm(), request.chatUserId, state.startMs, executionTs)
  if (trace === null) {
    observations.push('no own llm trace correlated the run')
    return 'inconclusive'
  }
  if (state.checkId === 'bug2_context_time') return bug2Verdict(deps, request, executionTs, observations)
  return bug1Verdict(request, state.runId, trace, observations)
}

const finalizeProofRun = async (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  state: AsyncRunState,
  proofPromptId: string,
  trigger: 'event' | 'timeout',
  releaseLock: () => void,
): Promise<void> => {
  const observations: string[] = [`trigger: ${trigger}`]
  let verdict: ProofVerdict = 'inconclusive'
  try {
    if (trigger === 'timeout') collectRowReads(deps, request, state, proofPromptId)
    verdict = computeVerdict(deps, request, state, observations)
  } catch (error) {
    observations.push(`observation_error: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    deps.executeCancel(request.storageContextId, { id: proofPromptId })
  } catch (error) {
    observations.push(`cancel_error: ${error instanceof Error ? error.message : String(error)}`)
  }
  await appendRecord(
    deps,
    makeRecord(state.runId, state.checkId, state.variant, state.startMs, deps.now(), verdict, observations),
  )
  releaseLock()
}

export const observeAsyncRun = (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  state: AsyncRunState,
  proofPromptId: string,
  windowMs: number,
  releaseLock: () => void,
): void => {
  let finished = false
  const finish = (trigger: 'event' | 'timeout', executionMs?: number): void => {
    if (finished) return
    finished = true
    if (executionMs !== undefined) state.executions.push(executionMs)
    void finalizeProofRun(deps, request, state, proofPromptId, trigger, releaseLock)
  }
  const listener = (event: DebugEvent): void => {
    if (finished) return
    if (event.scope.kind !== 'user') return
    if (event.type !== 'deferred:fired' && event.type !== 'deferred:alerted') return
    const promptId: unknown = event.data['promptId']
    if (typeof promptId !== 'string' || promptId !== proofPromptId) return
    deps.clearTimeout(timer)
    deps.unsubscribe(listener)
    finish('event', deps.now())
  }
  const timer = deps.setTimeout((): void => {
    deps.unsubscribe(listener)
    finish('timeout')
  }, windowMs)
  deps.subscribe(listener)
}
