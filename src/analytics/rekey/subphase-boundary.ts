// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { analyticsActiveGeneration, analyticsRekeyRuns, analyticsSnapshotPublications } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { computeRetireNotBeforeMs } from '../governance/generation-store.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import { remoteResendIn } from './remote.js'
import { executeRetirementIn, RetirementRefusedError } from './retire.js'
import { checkpointRekeyRunIn } from './run-store.js'
import { runSnapshotRepublish } from './snapshot-transition.js'
import { copyDeltaWithMappingsIn, requireVerifiedIn, runCheckpointedSubphase } from './subphase-shared.js'
import type { RekeyApplyResult, RekeySubphaseContext } from './subphase-shared.js'

const log = logger.child({ scope: 'analytics:rekey:subphase-boundary' })

/** Pauses egress, acquires the fence, drains admitted writers, then catches the target up. */
export const runCutoverFenceDrainDelta = (
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  ctx: RekeySubphaseContext,
): void => {
  ctx.egress.pauseEgress({ runId: run.runId, nowMs: ctx.nowMs() })
  ctx.fence.acquireFence(run.runId, ctx.nowMs())
  if (!ctx.fence.isDrained()) throw new Error('cutover drain incomplete: admitted writers or in-flight sends remain')
  runCheckpointedSubphase('cutover.fence_drain_delta', run, ctx, (tx) => {
    const copied = copyDeltaWithMappingsIn(tx, run, material, ctx.nowMs())
    requireVerifiedIn(tx, run, material)
    return { copiedCount: run.copiedCount + copied }
  })
}

/** Re-drains and re-verifies, then quiesces BI and closes source connections before the swap. */
export const runCutoverSnapshotQuiesced = (
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  ctx: RekeySubphaseContext,
): void => {
  if (!ctx.fence.isDrained()) throw new Error('cutover drain incomplete before snapshot quiesce')
  ctx.getDrizzleDb().transaction((tx) => {
    copyDeltaWithMappingsIn(tx, run, material, ctx.nowMs())
    requireVerifiedIn(tx, run, material)
  })
  ctx.coordinator.quiesceQueries({ runId: run.runId, nowMs: ctx.nowMs() })
  ctx.coordinator.closeSourceConnections({
    runId: run.runId,
    sourceGeneration: run.sourceGeneration,
    nowMs: ctx.nowMs(),
  })
  runCheckpointedSubphase('cutover.snapshot_quiesced', run, ctx, () => ({}))
}

/**
 * In the same transaction that passes the final fenced verification: updates the
 * one active-generation row, invalidates every published source-generation
 * snapshot, and persists swap_completed_at_ms plus the retirement boundary.
 */
export const runSwapActiveGeneration = (
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  ctx: RekeySubphaseContext,
): void => {
  ctx.getDrizzleDb().transaction((tx) => {
    requireVerifiedIn(tx, run, material)
    const nowMs = ctx.nowMs()
    tx.update(analyticsActiveGeneration)
      .set({ activeGeneration: run.targetGeneration, updatedAtMs: nowMs })
      .where(eq(analyticsActiveGeneration.singletonId, 1))
      .run()
    tx.update(analyticsSnapshotPublications)
      .set({ state: 'invalidated', invalidatedAt: nowMs })
      .where(
        and(
          eq(analyticsSnapshotPublications.state, 'published'),
          eq(analyticsSnapshotPublications.storageGeneration, run.sourceGeneration),
        ),
      )
      .run()
    tx.update(analyticsRekeyRuns)
      .set({
        swapCompletedAtMs: nowMs,
        retireNotBeforeMs: computeRetireNotBeforeMs({
          swapCompletedAtMs: nowMs,
          retainedEventHorizonDays: ctx.retainedEventHorizonDays,
        }),
        updatedAt: nowMs,
      })
      .where(eq(analyticsRekeyRuns.runId, run.runId))
      .run()
    checkpointRekeyRunIn(tx, { runId: run.runId, phase: 'swap', subphase: 'swap.active_generation', nowMs })
  })
  log.info('rekey pointer swapped; source publications invalidated')
}

/** Builds/remounts/promotes exactly one rekey-owned target snapshot; resume skips a promoted switch. */
export const runSnapshotRepublishSwitch = (run: AnalyticsRekeyRunRow, ctx: RekeySubphaseContext): void => {
  const db = ctx.getDrizzleDb()
  db.transaction((tx) => {
    checkpointRekeyRunIn(tx, {
      runId: run.runId,
      phase: 'snapshot_republish',
      subphase: 'snapshot_republish.quiesce_build_switch',
      nowMs: ctx.nowMs(),
    })
  })
  const published = db
    .select({ snapshotId: analyticsSnapshotPublications.snapshotId })
    .from(analyticsSnapshotPublications)
    .where(
      and(
        eq(analyticsSnapshotPublications.state, 'published'),
        eq(analyticsSnapshotPublications.transitionRunId, run.runId),
      ),
    )
    .get()
  if (published !== undefined) {
    log.info('snapshot_republish already promoted; resuming past the switch')
    return
  }
  runSnapshotRepublish(run, ctx.coordinator, { getDrizzleDb: ctx.getDrizzleDb, nowMs: ctx.nowMs() })
}

/** Enqueues still-eligible target rows only after old-version deletions settled, then resumes egress. */
export const runRemoteResend = (run: AnalyticsRekeyRunRow, ctx: RekeySubphaseContext): void => {
  runCheckpointedSubphase('remote_resend', run, ctx, (tx) => {
    remoteResendIn(tx, run, ctx.nowMs())
    return {}
  })
  ctx.egress.resumeEgress({ runId: run.runId, nowMs: ctx.nowMs() })
}

/** Refuses retirement before the boundary or while any gate is open; destroys mappings at the horizon. */
export const runRetireWaitingHorizon = (
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  ctx: RekeySubphaseContext,
): RekeyApplyResult => {
  const db = ctx.getDrizzleDb()
  db.transaction((tx) => {
    checkpointRekeyRunIn(tx, {
      runId: run.runId,
      phase: 'retire',
      subphase: 'retire.waiting_horizon',
      nowMs: ctx.nowMs(),
    })
  })
  try {
    db.transaction((tx) => {
      executeRetirementIn(tx, run, {
        nowMs: ctx.nowMs(),
        encryptionKeys: material.encryptionKeys,
        snapshotConsumerOpen: ctx.snapshotConsumerOpen,
      })
    })
  } catch (error) {
    if (error instanceof RetirementRefusedError) {
      log.info({ refusedReasons: error.refusedReasons }, 'rekey retirement deferred')
      return {
        status: 'running',
        phase: 'retire',
        subphase: 'retire.waiting_horizon',
        retired: false,
        refusedReasons: error.refusedReasons,
      }
    }
    throw error
  }
  log.info('rekey run completed')
  return { status: 'completed', phase: 'retire', subphase: 'retire.waiting_horizon', retired: true, refusedReasons: [] }
}
