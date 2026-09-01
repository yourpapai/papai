// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { DebugEvent } from '../debug/event-bus.js'
import type { LlmTrace } from '../debug/llm-trace-collector.js'
import type { Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { getContextLanguage } from '../utils/config-language.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'
import type { CreateDeliveryContext } from './delivery-input.js'
import { finalizeDeliveryText } from './proactive-llm-helpers.js'
import { appendProofJsonLine, type ProofCheckRecord, type ProofVerdict } from './proof-store.js'
import type { CreateInput, UpdateInput } from './tool-handlers.js'
import type {
  AlertCondition,
  AlertPrompt,
  CancelResult,
  CreateResult,
  GetResult,
  ScheduledPrompt,
  UpdateResult,
} from './types.js'

const log = logger.child({ scope: 'deferred:proof-checks' })

const MINUTE_MS = 60_000
const MARKER_PREFIX = '[[proof-check:'
const SCHEDULED_POLL_MS = 60_000
const ALERT_POLL_MS = 5 * MINUTE_MS
const WINDOW_CAP_MS = 15 * MINUTE_MS
const MIN_WINDOW_MS = 1_000
const FIRE_AT_LEAD_MS = 90_000
const BUG3_FIRE_AT_LEAD_MS = 10 * MINUTE_MS
const BUG2_TOLERANCE_MS = 2 * SCHEDULED_POLL_MS
const PROOF_PROMPT_BODY =
  'Proof-check probe: reply in one short turn and echo the marker sentence from the delivery brief verbatim; do not call any tools.'
const PROBE_URL = 'http://127.0.0.1:9/proof-check-probe'
const PROOF_CONDITION_NEVER_VALUE = '__proof_check_never__'

export type ProofCheckId =
  | 'bug1_delivery_matches_execution'
  | 'bug2_context_time'
  | 'bug3_fires_on_creation'
  | 'bug4_create_response_mode'
  | 'bug5_update_preserves_prompt'

interface ProofCheckDef {
  kind: 'sync' | 'async'
  variants: readonly string[]
}

export const PROOF_CHECKS: Readonly<Record<ProofCheckId, ProofCheckDef>> = {
  bug1_delivery_matches_execution: { kind: 'async', variants: ['no_tools', 'with_tool_probe'] },
  bug2_context_time: { kind: 'async', variants: ['default'] },
  bug3_fires_on_creation: { kind: 'async', variants: ['scheduled', 'alert'] },
  bug4_create_response_mode: { kind: 'sync', variants: ['default'] },
  bug5_update_preserves_prompt: { kind: 'sync', variants: ['default'] },
}

export type ProofCheckDeps = {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  subscribe: (listener: (event: DebugEvent) => void) => void
  unsubscribe: (listener: (event: DebugEvent) => void) => void
  executeCreate: (userId: string, input: CreateInput, deliveryCtx?: CreateDeliveryContext) => CreateResult
  executeUpdate: (userId: string, input: UpdateInput) => UpdateResult
  executeGet: (userId: string, input: { id: string }) => GetResult
  executeCancel: (userId: string, input: { id: string }) => CancelResult
  listScheduledPrompts: (userId: string) => ScheduledPrompt[]
  listAlertPrompts: (userId: string) => AlertPrompt[]
  getScheduledPrompt: (id: string, userId: string) => ScheduledPrompt | null
  getAlertPrompt: (id: string, userId: string) => AlertPrompt | null
  store: {
    append: (record: ProofCheckRecord) => Promise<void>
    load: () => Promise<ProofCheckRecord[]>
  }
  readRecentLlm: () => readonly LlmTrace[]
  readCachedHistory: (storageContextId: string) => readonly ModelMessage[]
}

export type ProofCheckRequest = {
  check?: ProofCheckId
  variant?: string
  wait_seconds?: number
  cleanup?: boolean
  storageContextId: string
  chatUserId: string
}

export type ProofCheckOutcome =
  | { status: 'completed'; record: ProofCheckRecord }
  | { status: 'started'; run_id: string }
  | { status: 'busy' }
  | { status: 'cleaned'; cancelled: string[] }
  | { status: 'error'; error: string }

export const proofMarker = (runId: string): string => `${MARKER_PREFIX}${runId}]]`

const parseProofMarker = (text: string): string | null => {
  if (!text.startsWith(MARKER_PREFIX)) return null
  const end = text.indexOf(']]', MARKER_PREFIX.length)
  if (end < 0) return null
  const runId = text.slice(MARKER_PREFIX.length, end)
  return runId === '' ? null : runId
}

const proofMarkerSentence = (runId: string): string =>
  `PROOF CHECK ${runId}: finish your single reply by echoing this marker sentence verbatim: ${proofMarker(runId)}`

interface ProofDeliveryRecord {
  runId: string
  responseText: string
  delivered: boolean
  at: string
}

let lockHeld = false
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

export const resetProofChecksForTest = (): void => {
  lockHeld = false
  deliveryRecords.clear()
}

const minuteFloorMs = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS

const resolveTimezone = (storageContextId: string): string => {
  const timezone = getUserTimezoneOrError(getConfigContextIdFromStorageContextId(storageContextId))
  return typeof timezone === 'string' ? timezone : 'UTC'
}

const resolveLocale = (storageContextId: string): Locale => {
  return getContextLanguage(getConfigContextIdFromStorageContextId(storageContextId))
}

const fireAtInputFor = (fireAtMs: number, timezone: string): { date: string; time: string } => {
  const local = utcToLocal(new Date(fireAtMs).toISOString(), timezone)
  const text = local ?? new Date(fireAtMs).toISOString()
  return { date: text.slice(0, 10), time: text.slice(11, 16) }
}

const buildCreateInput = (
  runId: string,
  variant: string | undefined,
  fireAtMs: number | null,
  timezone: string,
): CreateInput => {
  const prompt = `${proofMarker(runId)} ${PROOF_PROMPT_BODY}`
  const deliveryBrief =
    variant === 'with_tool_probe'
      ? `${proofMarkerSentence(runId)} Then call web_fetch exactly once against ${PROBE_URL} and report that the call failed.`
      : proofMarkerSentence(runId)
  if (variant === 'alert') {
    const condition: AlertCondition = { field: 'task.status', op: 'neq', value: PROOF_CONDITION_NEVER_VALUE }
    return { prompt, condition, execution: { delivery_brief: deliveryBrief } }
  }
  if (fireAtMs === null) return { prompt, execution: { delivery_brief: deliveryBrief } }
  return {
    prompt,
    schedule: { fire_at: fireAtInputFor(fireAtMs, timezone) },
    execution: { delivery_brief: deliveryBrief },
  }
}

interface CreatedProofPrompt {
  input: CreateInput
  result: CreateResult
}

const createProofPrompt = (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  runId: string,
  fireAtMs: number | null,
  variant: string | undefined,
): CreatedProofPrompt => {
  const timezone = resolveTimezone(request.storageContextId)
  const input = buildCreateInput(runId, variant, fireAtMs, timezone)
  const deliveryCtx: CreateDeliveryContext = {
    userId: request.chatUserId,
    storageContextId: request.storageContextId,
    contextType: 'dm',
  }
  return { input, result: deps.executeCreate(request.storageContextId, input, deliveryCtx) }
}

const sweepProofPrompts = (deps: ProofCheckDeps, ownerId: string): string[] => {
  const cancelled: string[] = []
  const rows = [...deps.listScheduledPrompts(ownerId), ...deps.listAlertPrompts(ownerId)]
  for (const row of rows) {
    if (row.createdByUserId !== ownerId) continue
    if (row.status !== 'active') continue
    if (parseProofMarker(row.prompt) === null) continue
    const cancelResult = deps.executeCancel(ownerId, { id: row.id })
    if ('id' in cancelResult) cancelled.push(row.id)
  }
  return cancelled
}

const makeRecord = (
  runId: string,
  checkId: string,
  variant: string | undefined,
  startedMs: number,
  finishedMs: number,
  verdict: ProofVerdict,
  observations: string[],
): ProofCheckRecord => ({
  run_id: runId,
  check: checkId,
  ...(variant === undefined ? {} : { variant }),
  started_at: new Date(startedMs).toISOString(),
  finished_at: new Date(finishedMs).toISOString(),
  verdict,
  observations,
})

const appendRecord = async (deps: ProofCheckDeps, record: ProofCheckRecord): Promise<void> => {
  try {
    await deps.store.append(record)
  } catch (error) {
    log.warn(
      { runId: record.run_id, error: error instanceof Error ? error.message : String(error) },
      'Failed to append proof check record',
    )
  }
}

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readExecutionMode = (result: CreateResult): string | null => {
  const fields: Record<string, unknown> = result
  const execution: unknown = fields['execution']
  if (!isRecordObject(execution)) return null
  const mode = execution['mode']
  return typeof mode === 'string' && mode !== '' ? mode : null
}

const runSyncCheck = async (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  checkId: ProofCheckId,
): Promise<ProofCheckRecord> => {
  const runId = crypto.randomUUID()
  const startMs = deps.now()
  const variant = request.variant
  const observations: string[] = []
  sweepProofPrompts(deps, request.storageContextId)
  const created = createProofPrompt(deps, request, runId, minuteFloorMs(startMs + FIRE_AT_LEAD_MS), variant)
  if ('error' in created.result) {
    observations.push(`create_error: ${created.result.error}`)
    const record = makeRecord(runId, checkId, variant, startMs, deps.now(), 'inconclusive', observations)
    await appendRecord(deps, record)
    return record
  }
  let verdict: ProofVerdict
  if (checkId === 'bug4_create_response_mode') {
    const mode = readExecutionMode(created.result)
    verdict = mode === null ? 'fail' : 'pass'
    observations.push(`create_result_keys: ${Object.keys(created.result).join(',')}`)
    observations.push(`execution_mode: ${mode ?? 'absent'}`)
  } else {
    const updateBrief = `${proofMarkerSentence(runId)} (updated by the wipe probe)`
    const updateResult = deps.executeUpdate(request.storageContextId, {
      id: created.result.id,
      prompt: '',
      execution: { delivery_brief: updateBrief },
    })
    if ('error' in updateResult) observations.push(`update_error: ${updateResult.error}`)
    const getResult = deps.executeGet(request.storageContextId, { id: created.result.id })
    if ('error' in getResult) {
      observations.push(`get_error: ${getResult.error}`)
      verdict = 'inconclusive'
    } else {
      verdict = getResult.prompt === '' ? 'fail' : 'pass'
      observations.push(`prompt_text_before: ${created.input.prompt}`)
      observations.push(`prompt_text_after: ${getResult.prompt}`)
    }
  }
  const cancelResult = deps.executeCancel(request.storageContextId, { id: created.result.id })
  if ('error' in cancelResult) observations.push(`cancel_error: ${cancelResult.error}`)
  const record = makeRecord(runId, checkId, variant, startMs, deps.now(), verdict, observations)
  await appendRecord(deps, record)
  return record
}

interface AsyncRunState {
  runId: string
  checkId: ProofCheckId
  startMs: number
  fireAtMs: number | null
  isAlertVariant: boolean
  executions: number[]
}

const findOwnTrace = (traces: readonly LlmTrace[], chatUserId: string, sinceMs: number): LlmTrace | null => {
  for (let index = traces.length - 1; index >= 0; index--) {
    const trace = traces[index]
    if (trace === undefined) continue
    if (trace.chatUserId === chatUserId && trace.timestamp >= sinceMs) return trace
  }
  return null
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
  const trace = findOwnTrace(deps.readRecentLlm(), request.chatUserId, state.startMs)
  if (trace === null) {
    observations.push('no own llm trace correlated the run')
    return 'inconclusive'
  }
  if (state.checkId === 'bug2_context_time') return bug2Verdict(deps, request, executionTs, observations)
  return bug1Verdict(request, state.runId, trace, observations)
}

const resolveWindowMs = (request: ProofCheckRequest, isAlertVariant: boolean): number => {
  const waitSeconds = request.wait_seconds
  if (waitSeconds !== undefined) return Math.max(MIN_WINDOW_MS, Math.min(waitSeconds * 1000, WINDOW_CAP_MS))
  return isAlertVariant ? 2 * ALERT_POLL_MS : 2 * SCHEDULED_POLL_MS
}

const startAsyncCheck = async (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  checkId: ProofCheckId,
): Promise<ProofCheckOutcome> => {
  lockHeld = true
  const runId = crypto.randomUUID()
  const startMs = deps.now()
  const variant = request.variant
  const isAlertVariant = checkId === 'bug3_fires_on_creation' && variant === 'alert'
  try {
    sweepProofPrompts(deps, request.storageContextId)
    const windowMs = resolveWindowMs(request, isAlertVariant)
    const fireAtMs = isAlertVariant
      ? null
      : minuteFloorMs(startMs + (checkId === 'bug3_fires_on_creation' ? BUG3_FIRE_AT_LEAD_MS : FIRE_AT_LEAD_MS))
    const created = createProofPrompt(deps, request, runId, fireAtMs, isAlertVariant ? 'alert' : variant)
    if ('error' in created.result) {
      const record = makeRecord(runId, checkId, variant, startMs, deps.now(), 'inconclusive', [
        `create_error: ${created.result.error}`,
      ])
      await appendRecord(deps, record)
      lockHeld = false
      return { status: 'error', error: created.result.error }
    }
    const proofPromptId = created.result.id
    const state: AsyncRunState = { runId, checkId, startMs, fireAtMs, isAlertVariant, executions: [] }
    let finished = false
    const finalizeRun = (trigger: 'event' | 'timeout'): void => {
      void (async () => {
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
        try {
          await deps.store.append(makeRecord(runId, checkId, variant, startMs, deps.now(), verdict, observations))
        } catch (error) {
          log.warn(
            { runId, error: error instanceof Error ? error.message : String(error) },
            'Failed to append proof check record',
          )
        } finally {
          lockHeld = false
        }
      })()
    }
    const listener = (event: DebugEvent): void => {
      if (finished) return
      if (event.scope.kind !== 'user') return
      if (event.type !== 'deferred:fired' && event.type !== 'deferred:alerted') return
      const promptId: unknown = event.data['promptId']
      if (typeof promptId !== 'string' || promptId !== proofPromptId) return
      finished = true
      deps.clearTimeout(timer)
      deps.unsubscribe(listener)
      state.executions.push(deps.now())
      finalizeRun('event')
    }
    const timer = deps.setTimeout(() => {
      if (finished) return
      finished = true
      deps.clearTimeout(timer)
      deps.unsubscribe(listener)
      finalizeRun('timeout')
    }, windowMs)
    deps.subscribe(listener)
    return { status: 'started', run_id: runId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await appendRecord(
        deps,
        makeRecord(runId, checkId, variant, startMs, deps.now(), 'inconclusive', [`start_error: ${message}`]),
      )
    } finally {
      lockHeld = false
    }
    return { status: 'error', error: message }
  }
}

export const runProofCheck = async (deps: ProofCheckDeps, request: ProofCheckRequest): Promise<ProofCheckOutcome> => {
  if (request.storageContextId === '' || request.chatUserId === '') {
    return { status: 'error', error: 'run_proof_check requires the bound storage context and chat user ids.' }
  }
  if (request.cleanup === true) {
    return { status: 'cleaned', cancelled: sweepProofPrompts(deps, request.storageContextId) }
  }
  const checkId = request.check
  if (checkId === undefined) {
    return { status: 'error', error: 'Provide a check id to run, or cleanup: true to sweep leftover proof prompts.' }
  }
  const def = PROOF_CHECKS[checkId]
  if (def === undefined) return { status: 'error', error: `Unknown proof check: ${checkId}` }
  if (def.kind === 'sync') {
    return { status: 'completed', record: await runSyncCheck(deps, request, checkId) }
  }
  if (lockHeld) return { status: 'busy' }
  return startAsyncCheck(deps, request, checkId)
}
