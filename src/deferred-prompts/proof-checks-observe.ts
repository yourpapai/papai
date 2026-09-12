// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DebugEvent } from '../debug/event-bus.js'
import type { LlmTrace } from '../debug/llm-trace-collector.js'
import { logger } from '../logger.js'
import { lastCurrentTimeTag } from '../utils/current-time-format.js'
import { localDatetimeToUtc } from '../utils/datetime.js'
import { finalizeDeliveryText } from './proactive-llm-helpers.js'
import { appendRecord, makeRecord, resolveLocale, resolveTimezone, SCHEDULED_POLL_MS } from './proof-checks-prompts.js'
import type { ProofCheckDeps, ProofCheckId, ProofCheckRequest } from './proof-checks.js'
import { appendProofJsonLine, type ProofVerdict } from './proof-store.js'

const log = logger.child({ scope: 'deferred:proof-checks' })

// bug2 compares the freshest <current_time> tag in the message stream the run
// consumed against the recorded fire_at. On master that anchor is the invoking
// turn's tag — fire_at is the next minute boundary (fire lead = 60s), so the
// delta is exactly 60s (or 120s when the tool call crossed a minute). A fixed
// trigger tag is minute-aligned with fire_at, delta 0. Half a poll tick sits
// strictly between the two.
const BUG2_TOLERANCE_MS = SCHEDULED_POLL_MS / 2

export interface ProofDeliveryRecord {
  runId: string
  responseText: string
  delivered: boolean
  at: string
}

const deliveryRecords = new Map<string, ProofDeliveryRecord>()
// Runs finalizeProofRun has closed. A delivery can land after its run's observation window
// (generation timeout far exceeds the window), and that late delivery must stay JSONL
// evidence only — re-inserting it would put a map entry back that no later run ever evicts.
// Entries leave when their late delivery arrives; the cap evicts the oldest otherwise, so
// the set itself stays bounded.
const finishedRunIds = new Set<string>()
const FINISHED_RUN_IDS_CAP = 16

export const recordProofDelivery = (runId: string, responseText: string, at: string): void => {
  const record: ProofDeliveryRecord = { runId, responseText, delivered: true, at }
  if (!finishedRunIds.delete(runId)) deliveryRecords.set(runId, record)
  appendProofJsonLine(record).catch((error: unknown) => {
    log.warn(
      { runId, error: error instanceof Error ? error.message : String(error) },
      'Failed to persist proof delivery record',
    )
  })
}

export const resetProofDeliveryRecords = (): void => {
  deliveryRecords.clear()
  finishedRunIds.clear()
}

export interface AsyncRunState {
  runId: string
  checkId: ProofCheckId
  variant: string | undefined
  startMs: number
  fireAtMs: number | null
  isAlertVariant: boolean
  executions: number[]
  // Set at window close from the alert row's matched-set bookkeeping, which
  // the alert lane only writes when it actually evaluated the alert.
  alertEvaluated?: boolean
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
    if ((row?.matchedTaskIds.length ?? 0) > 0) state.alertEvaluated = true
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
  state: AsyncRunState,
  trace: LlmTrace,
  observations: string[],
): ProofVerdict => {
  const fireAtMs = state.fireAtMs
  if (fireAtMs === null) {
    observations.push('no fire_at recorded for the run')
    return 'inconclusive'
  }
  // The anchor must come from the message stream the run actually consumed: on
  // master the freshest tag is the invoking turn's replayed history tag (the
  // proactive trigger carries none), and once a fresh tag lands in the trigger's
  // user message it never reaches the persisted history — only the captured
  // trace sees it. The history read stays as the fallback for runs whose trace
  // carried no tag (generation error, legacy emitter).
  const fromTrace = trace.currentTimeTag !== undefined
  const tag = fromTrace ? trace.currentTimeTag : lastCurrentTimeTag(deps.readCachedHistory(request.storageContextId))
  if (tag === undefined || tag === null) {
    observations.push('no <current_time> tag found in the message stream the run consumed')
    return 'inconclusive'
  }
  const anchorMs = parseTimeTag(tag, resolveTimezone(request.storageContextId))
  if (anchorMs === null) {
    observations.push(`unparseable_time_tag: ${tag}`)
    return 'inconclusive'
  }
  const deltaMs = Math.abs(anchorMs - fireAtMs)
  observations.push(`anchor_source: ${fromTrace ? 'trace' : 'history'}`)
  observations.push(`anchor_tag: ${tag}`)
  observations.push(`anchor_at: ${new Date(anchorMs).toISOString()}`)
  observations.push(`fire_at: ${new Date(fireAtMs).toISOString()}`)
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
      if (state.executions.length > 0) return 'fail'
      // Zero executions alone is not a pass: the alert lane evaluates filter
      // alerts only when the snapshot change gate opens, so a closed gate also
      // produces zero executions. Only matched-set bookkeeping proves the
      // alert was actually evaluated.
      if (state.alertEvaluated === true) return 'pass'
      observations.push(
        'alert never evaluated: the alert lane gates evaluation behind the snapshot change gate — verify a pre-existing matching task exists and the context holds no up-to-date snapshots',
      )
      return 'inconclusive'
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
  // D7 correlation window: the run's own trace completes after fire_at (generation
  // starts at/after the due tick), so a trace older than the fire time belongs to a
  // different turn — e.g. the admin turn that invoked run_proof_check — and must
  // not correlate the run.
  const trace = findOwnTrace(deps.readRecentLlm(), request.chatUserId, state.fireAtMs ?? state.startMs, executionTs)
  if (trace === null) {
    observations.push('no own llm trace correlated the run')
    return 'inconclusive'
  }
  if (state.checkId === 'bug2_context_time') return bug2Verdict(deps, request, state, trace, observations)
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
  deliveryRecords.delete(state.runId)
  if (finishedRunIds.size >= FINISHED_RUN_IDS_CAP) {
    const oldest: string | undefined = finishedRunIds.values().next().value
    if (oldest !== undefined) finishedRunIds.delete(oldest)
  }
  finishedRunIds.add(state.runId)
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
