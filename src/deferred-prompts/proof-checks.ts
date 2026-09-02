// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { DebugEvent } from '../debug/event-bus.js'
import type { LlmTrace } from '../debug/llm-trace-collector.js'
import type { CreateDeliveryContext } from './delivery-input.js'
import { observeAsyncRun, resetProofDeliveryRecords, type AsyncRunState } from './proof-checks-observe.js'
import {
  appendRecord,
  createProofPrompt,
  fireAtLeadFor,
  fireAtMsFor,
  makeRecord,
  proofMarkerSentence,
  resolveWindowMs,
  sweepProofPrompts,
} from './proof-checks-prompts.js'
import type { ProofCheckRecord, ProofVerdict } from './proof-store.js'
import type { CreateInput, UpdateInput } from './tool-handlers.js'
import type { AlertPrompt, CancelResult, CreateResult, GetResult, ScheduledPrompt, UpdateResult } from './types.js'

export { proofMarker } from './proof-checks-prompts.js'
export { recordProofDelivery } from './proof-checks-observe.js'

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

let lockHeld = false

export const resetProofChecksForTest = (): void => {
  lockHeld = false
  resetProofDeliveryRecords()
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

const observeSyncCheck = (
  deps: ProofCheckDeps,
  request: ProofCheckRequest,
  checkId: ProofCheckId,
  runId: string,
  input: CreateInput,
  result: Exclude<CreateResult, { error: string }>,
  observations: string[],
): ProofVerdict => {
  if (checkId === 'bug4_create_response_mode') {
    const mode = readExecutionMode(result)
    observations.push(`create_result_keys: ${Object.keys(result).join(',')}`)
    observations.push(`execution_mode: ${mode ?? 'absent'}`)
    return mode === null ? 'fail' : 'pass'
  }
  const updateBrief = `${proofMarkerSentence(runId)} (updated by the wipe probe)`
  const updateResult = deps.executeUpdate(request.storageContextId, {
    id: result.id,
    prompt: '',
    execution: { delivery_brief: updateBrief },
  })
  if ('error' in updateResult) observations.push(`update_error: ${updateResult.error}`)
  const getResult = deps.executeGet(request.storageContextId, { id: result.id })
  if ('error' in getResult) {
    observations.push(`get_error: ${getResult.error}`)
    return 'inconclusive'
  }
  observations.push(`prompt_text_before: ${input.prompt}`)
  observations.push(`prompt_text_after: ${getResult.prompt}`)
  return getResult.prompt === '' ? 'fail' : 'pass'
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
  const created = createProofPrompt(deps, request, runId, fireAtMsFor(startMs, fireAtLeadFor(checkId)), variant)
  if ('error' in created.result) {
    observations.push(`create_error: ${created.result.error}`)
    const record = makeRecord(runId, checkId, variant, startMs, deps.now(), 'inconclusive', observations)
    await appendRecord(deps, record)
    return record
  }
  let verdict: ProofVerdict = 'inconclusive'
  try {
    verdict = observeSyncCheck(deps, request, checkId, runId, created.input, created.result, observations)
  } catch (error) {
    observations.push(`observation_error: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const cancelResult = deps.executeCancel(request.storageContextId, { id: created.result.id })
    if ('error' in cancelResult) observations.push(`cancel_error: ${cancelResult.error}`)
  } catch (error) {
    observations.push(`cancel_error: ${error instanceof Error ? error.message : String(error)}`)
  }
  const record = makeRecord(runId, checkId, variant, startMs, deps.now(), verdict, observations)
  await appendRecord(deps, record)
  return record
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
  const releaseLock = (): void => {
    lockHeld = false
  }
  try {
    sweepProofPrompts(deps, request.storageContextId)
    const windowMs = resolveWindowMs(request, isAlertVariant)
    const fireAtMs = isAlertVariant ? null : fireAtMsFor(startMs, fireAtLeadFor(checkId, windowMs))
    const created = createProofPrompt(deps, request, runId, fireAtMs, isAlertVariant ? 'alert' : variant)
    if ('error' in created.result) {
      await appendRecord(
        deps,
        makeRecord(runId, checkId, variant, startMs, deps.now(), 'inconclusive', [
          `create_error: ${created.result.error}`,
        ]),
      )
      releaseLock()
      return { status: 'error', error: created.result.error }
    }
    const state: AsyncRunState = { runId, checkId, variant, startMs, fireAtMs, isAlertVariant, executions: [] }
    observeAsyncRun(deps, request, state, created.result.id, windowMs, releaseLock)
    return { status: 'started', run_id: runId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await appendRecord(
        deps,
        makeRecord(runId, checkId, variant, startMs, deps.now(), 'inconclusive', [`start_error: ${message}`]),
      )
    } finally {
      releaseLock()
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
  if (request.variant !== undefined && !def.variants.includes(request.variant)) {
    return {
      status: 'error',
      error: `Variant '${request.variant}' is not valid for ${checkId} (expected one of: ${def.variants.join(', ')}).`,
    }
  }
  if (lockHeld) return { status: 'busy' }
  if (def.kind === 'sync') {
    return { status: 'completed', record: await runSyncCheck(deps, request, checkId) }
  }
  return startAsyncCheck(deps, request, checkId)
}
