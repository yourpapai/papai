// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEvents, analyticsRekeyRuns } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { resolveActive } from '../governance/generation-store.js'
import type { GenerationTransitionCoordinator } from '../governance/snapshot-invalidator.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import type { RekeyFullKeyMaterial } from '../rekey/dual-write.js'
import type { RekeyRemoteEgress } from '../rekey/remote.js'
import {
  abortRekeyRun,
  getNonterminalRekeyRunIn,
  getRekeyRun,
  pauseRekeyRun,
  REKEY_SUBPHASE_SEQUENCE,
} from '../rekey/run-store.js'
import type { AbortRekeyResult, RekeySubphase, RekeyTx } from '../rekey/run-store.js'
import { runRekeySubphase } from '../rekey/subphases.js'
import type { RekeyApplyResult } from '../rekey/subphases.js'
import { verifyMappingNormalizedContentIn } from '../rekey/verify-content.js'
import type { ContentVerifyReport } from '../rekey/verify-content.js'
import { verifyShadowEquationIn } from '../rekey/verify.js'
import type { ShadowEquationReport } from '../rekey/verify.js'

const log = logger.child({ scope: 'analytics:jobs:rekey' })

export type { RekeyApplyResult } from '../rekey/subphases.js'

export type RekeyWorkflowDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  keyMaterial: () => RekeyFullKeyMaterial | null
  coordinator: GenerationTransitionCoordinator
  egress: RekeyRemoteEgress
  fence: RekeyCutoverFence
  retainedEventHorizonDays: number
  nowMs: () => number
  snapshotConsumerOpen?: () => boolean
  onSubphaseComplete?: (subphase: RekeySubphase) => void
}>

export type RekeyPlanRequest = Readonly<{
  sourceGeneration: string
  targetGeneration: string
  fromVersions: readonly string[]
  toVersions: readonly string[]
}>

const IN_PLACE_SUBPHASES: ReadonlySet<string> = new Set([
  'cutover.snapshot_quiesced',
  'snapshot_republish.quiesce_build_switch',
  'remote_resend',
  'retire.waiting_horizon',
])

const sourceHighWaterIn = (tx: RekeyTx, sourceGeneration: string): string => {
  const rows = tx
    .select({ occurredAtMs: analyticsEvents.occurredAtMs })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, sourceGeneration))
    .all()
  const max = rows.reduce((bound, row) => Math.max(bound, row.occurredAtMs), 0)
  return `${rows.length}:${max}`
}

/** Plan artifact hash: binds the request to the exact database state at plan time. */
export const computeRekeyPlanHash = (
  request: RekeyPlanRequest,
  deps: Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>,
): string => {
  const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
  const highWater = deps.getDrizzleDb().transaction((tx) => sourceHighWaterIn(tx, request.sourceGeneration))
  const artifact = JSON.stringify({ ...request, activeGeneration: active.generation, sourceHighWater: highWater })
  return createHash('sha256').update(artifact).digest('hex')
}

/**
 * Plans a run. The database-backed one-nonterminal-run invariant and the run
 * insert commit in the same transaction; there is never an in-memory lock.
 */
export const planRekeyAction = (
  request: RekeyPlanRequest,
  deps: RekeyWorkflowDeps,
): Readonly<{ runId: string; planHash: string }> => {
  const nowMs = deps.nowMs()
  const planHash = computeRekeyPlanHash(request, deps)
  let runId = ''
  deps.getDrizzleDb().transaction((tx) => {
    if (getNonterminalRekeyRunIn(tx) !== null) {
      throw new Error('a nonterminal rekey run already holds the unique run slot')
    }
    if (request.sourceGeneration === request.targetGeneration) {
      throw new Error('rekey run requires distinct source and target generations')
    }
    const runCount = tx.select({ runId: analyticsRekeyRuns.runId }).from(analyticsRekeyRuns).all().length
    runId = `rekey-${nowMs.toString(36)}-${planHash.slice(0, 8)}-${runCount}`
    tx.insert(analyticsRekeyRuns)
      .values({
        runId,
        sourceGeneration: request.sourceGeneration,
        targetGeneration: request.targetGeneration,
        fromVersions: JSON.stringify(request.fromVersions),
        toVersions: JSON.stringify(request.toVersions),
        sourceHighWater: sourceHighWaterIn(tx, request.sourceGeneration),
        phase: 'plan',
        subphase: null,
        planHash,
        status: 'planned',
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .run()
  })
  log.info({ phase: 'plan' }, 'rekey run planned')
  return { runId, planHash }
}

export const abortRekeyAction = (input: Readonly<{ runId: string }>, deps: RekeyWorkflowDeps): AbortRekeyResult =>
  abortRekeyRun({ runId: input.runId, nowMs: deps.nowMs() }, deps)

const startIndexFor = (run: AnalyticsRekeyRunRow): number => {
  if (run.subphase === null) {
    if (run.phase === 'cutover') return REKEY_SUBPHASE_SEQUENCE.indexOf('cutover.fence_drain_delta')
    return 0
  }
  const index = REKEY_SUBPHASE_SEQUENCE.findIndex((entry) => entry === run.subphase)
  if (index === -1) throw new Error(`rekey run persisted an unknown subphase: ${run.subphase}`)
  return IN_PLACE_SUBPHASES.has(run.subphase) ? index : index + 1
}

const requireRunnableRun = (runId: string, planHash: string, deps: RekeyWorkflowDeps): AnalyticsRekeyRunRow => {
  const run = getRekeyRun(runId, deps)
  if (run === null) throw new Error('rekey run not found')
  if (run.status === 'completed' || run.status === 'aborted') throw new Error('rekey run is already terminal')
  if (run.planHash !== planHash) {
    throw new Error('rekey apply requires the plan artifact hash produced in the same database state')
  }
  return run
}

/** Applies (or resumes) a planned run, driving every remaining subphase in the frozen order. */
export const applyRekeyAction = (
  input: Readonly<{ runId: string; planHash: string }>,
  deps: RekeyWorkflowDeps,
): RekeyApplyResult => {
  const run = requireRunnableRun(input.runId, input.planHash, deps)
  const material = deps.keyMaterial()
  if (material === null) throw new Error('rekey key material unavailable')
  try {
    const start = startIndexFor(run)
    for (let index = start; index < REKEY_SUBPHASE_SEQUENCE.length; index += 1) {
      const subphase = REKEY_SUBPHASE_SEQUENCE[index]
      if (subphase === undefined) break
      const current = getRekeyRun(run.runId, deps)
      if (current === null) throw new Error('rekey run vanished mid-apply')
      const result = runRekeySubphase(subphase, current, material, deps)
      deps.onSubphaseComplete?.(subphase)
      if (result !== null) return result
    }
    throw new Error('rekey driver fell off the subphase sequence')
  } catch (error) {
    pauseRekeyRun({ runId: run.runId, nowMs: deps.nowMs() }, deps)
    throw error
  }
}

/** Runs the separate shadow equation plus the mapping-normalized content comparison. */
export const verifyRekeyAction = (
  input: Readonly<{ runId: string }>,
  deps: RekeyWorkflowDeps,
): Readonly<{ equation: ShadowEquationReport; content: ContentVerifyReport }> => {
  const run = getRekeyRun(input.runId, deps)
  if (run === null) throw new Error('rekey run not found')
  const material = deps.keyMaterial()
  if (material === null) throw new Error('rekey key material unavailable')
  return deps.getDrizzleDb().transaction((tx) => ({
    equation: verifyShadowEquationIn(tx, run, material.encryptionKeys),
    content: verifyMappingNormalizedContentIn(tx, run, material),
  }))
}
