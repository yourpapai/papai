// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { getContextLanguage } from '../utils/config-language.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { utcToLocal } from '../utils/datetime.js'
import type { CreateDeliveryContext } from './delivery-input.js'
import type { ProofCheckDeps, ProofCheckId, ProofCheckRequest } from './proof-checks.js'
import type { ProofCheckRecord, ProofVerdict } from './proof-store.js'
import type { CreateInput } from './tool-handlers.js'
import type { AlertCondition, CreateResult } from './types.js'

const log = logger.child({ scope: 'deferred:proof-checks' })

const MINUTE_MS = 60_000
const MARKER_PREFIX = '[[proof-check:'
export const SCHEDULED_POLL_MS = 60_000
const ALERT_POLL_MS = 5 * MINUTE_MS
const WINDOW_CAP_MS = 15 * MINUTE_MS
const MIN_WINDOW_MS = 1_000
const FIRE_AT_LEAD_MS = 90_000
const BUG3_FIRE_AT_LEAD_MS = 10 * MINUTE_MS
const PROOF_PROMPT_BODY =
  'Proof-check probe: reply in one short turn and echo the marker sentence from the delivery brief verbatim; do not call any tools.'
const PROBE_URL = 'http://127.0.0.1:9/proof-check-probe'
const PROOF_CONDITION_NEVER_VALUE = '__proof_check_never__'

export const proofMarker = (runId: string): string => `${MARKER_PREFIX}${runId}]]`

export const parseProofMarker = (text: string): string | null => {
  if (!text.startsWith(MARKER_PREFIX)) return null
  const end = text.indexOf(']]', MARKER_PREFIX.length)
  if (end < 0) return null
  const runId = text.slice(MARKER_PREFIX.length, end)
  return runId === '' ? null : runId
}

export const proofMarkerSentence = (runId: string): string =>
  `PROOF CHECK ${runId}: finish your single reply by echoing this marker sentence verbatim: ${proofMarker(runId)}`

export const minuteFloorMs = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS

export const fireAtMsFor = (startMs: number, leadMs: number): number =>
  Math.max(minuteFloorMs(startMs + leadMs), minuteFloorMs(startMs) + MINUTE_MS)

export const fireAtLeadFor = (checkId: ProofCheckId, windowMs?: number): number => {
  if (checkId === 'bug3_fires_on_creation') return BUG3_FIRE_AT_LEAD_MS
  if (windowMs === undefined) return FIRE_AT_LEAD_MS
  return Math.min(FIRE_AT_LEAD_MS, Math.max(2 * MIN_WINDOW_MS, windowMs / 2))
}

export const resolveWindowMs = (request: ProofCheckRequest, isAlertVariant: boolean): number => {
  const waitSeconds = request.wait_seconds
  if (waitSeconds !== undefined) return Math.max(MIN_WINDOW_MS, Math.min(waitSeconds * 1000, WINDOW_CAP_MS))
  return isAlertVariant ? 2 * ALERT_POLL_MS : 2 * SCHEDULED_POLL_MS
}

export const resolveTimezone = (storageContextId: string): string => {
  const timezone = getUserTimezoneOrError(getConfigContextIdFromStorageContextId(storageContextId))
  return typeof timezone === 'string' ? timezone : 'UTC'
}

export const resolveLocale = (storageContextId: string): Locale => {
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

export const createProofPrompt = (
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

export const sweepProofPrompts = (deps: ProofCheckDeps, ownerId: string): string[] => {
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

export const makeRecord = (
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

export const appendRecord = async (deps: ProofCheckDeps, record: ProofCheckRecord): Promise<void> => {
  try {
    await deps.store.append(record)
  } catch (error) {
    log.warn(
      { runId: record.run_id, error: error instanceof Error ? error.message : String(error) },
      'Failed to append proof check record',
    )
  }
}
