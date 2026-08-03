// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsSnapshotPublications } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:governance:snapshot-invalidator' })

export type SnapshotInvalidationRequest = Readonly<{
  reason: 'subject_deletion' | 'generation_transition'
  nowMs: number
  storageGeneration?: string
  transitionRunId?: string
  contributionMarker?: string
}>

export type SnapshotInvalidationResult = Readonly<{
  unpublishedSnapshotIds: readonly string[]
  publishedSnapshotContainsContribution: boolean
}>

/**
 * Generation-transition port consumed by subject deletion (13A), the rekey
 * `snapshot_republish` phase (13B), and the production Metabase coordinator
 * (Task 14). Implementations unpublish affected snapshots, rebuild as needed,
 * and report whether any published snapshot can still contain the removed
 * contribution; callers must not claim completion while that flag is true.
 */
export type SnapshotInvalidator = (request: SnapshotInvalidationRequest) => SnapshotInvalidationResult

/**
 * Generation-transition coordinator port (06 §Task 13 snapshot cutover). The
 * rekey `snapshot_republish` phase drives this sequence; Task 14 supplies the
 * production Metabase coordinator. Implementations must be idempotent per
 * run: a restart in `snapshot_republish` re-enters with the same run and must
 * never serve or republish the source-generation file. The rekey-owned
 * cutover token is the transition run id.
 */
export type GenerationTransitionCoordinator = Readonly<{
  quiesceQueries: (input: Readonly<{ runId: string; nowMs: number }>) => void
  closeSourceConnections: (input: Readonly<{ runId: string; sourceGeneration: string; nowMs: number }>) => void
  buildTargetSnapshot: (
    input: Readonly<{ runId: string; targetGeneration: string; nowMs: number }>,
  ) => Readonly<{ snapshotId: string; pathHash: string; sourceHighWater: string }>
  remountAndVerify: (input: Readonly<{ snapshotId: string; expectedGeneration: string }>) => boolean
  resumeQueries: (input: Readonly<{ runId: string; nowMs: number }>) => void
  unlinkSourceFile: (input: Readonly<{ sourceGeneration: string; nowMs: number }>) => void
}>

export type SnapshotInvalidatorDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  coordinator?: Readonly<{
    coordinateSubjectDeletion: (
      input: Readonly<{ newSnapshotId: string; oldSnapshotId: string; contributionMarker: string }>,
    ) => Readonly<{ acknowledged: true }>
  }>
  rebuild?: () => Readonly<{ newSnapshotId: string }>
}>

/**
 * Coordinated subject-deletion path (Task 14): after the rows are unpublished
 * the consumer must remount a rebuilt snapshot and prove the new snapshot_id
 * plus a zero old contribution before containment is reported clear. Without
 * a contribution marker the result stays fail-closed.
 */
const coordinateUnpublished = (
  unpublishedSnapshotIds: readonly string[],
  request: SnapshotInvalidationRequest,
  deps: SnapshotInvalidatorDeps,
): boolean => {
  if (deps.coordinator === undefined || deps.rebuild === undefined || unpublishedSnapshotIds.length === 0) {
    return false
  }
  if (request.contributionMarker === undefined) {
    log.warn('no contribution marker supplied; snapshot containment stays fail-closed')
    return true
  }
  try {
    const { newSnapshotId } = deps.rebuild()
    for (const oldSnapshotId of unpublishedSnapshotIds) {
      deps.coordinator.coordinateSubjectDeletion({
        newSnapshotId,
        oldSnapshotId,
        contributionMarker: request.contributionMarker,
      })
    }
    return false
  } catch (error) {
    log.warn(
      { reason: error instanceof Error ? error.message : String(error) },
      'coordinated snapshot replacement failed; deletion stays incomplete',
    )
    return true
  }
}

export const createSnapshotInvalidator = (deps: SnapshotInvalidatorDeps): SnapshotInvalidator => {
  return (request) => {
    const unpublishedSnapshotIds = deps.getDrizzleDb().transaction((tx) => {
      const published = tx
        .select()
        .from(analyticsSnapshotPublications)
        .where(
          request.storageGeneration === undefined
            ? eq(analyticsSnapshotPublications.state, 'published')
            : and(
                eq(analyticsSnapshotPublications.state, 'published'),
                eq(analyticsSnapshotPublications.storageGeneration, request.storageGeneration),
              ),
        )
        .all()
      const ids = published.map((row) => row.snapshotId)
      for (const snapshotId of ids) {
        tx.update(analyticsSnapshotPublications)
          .set({ state: 'invalidated', invalidatedAt: request.nowMs })
          .where(eq(analyticsSnapshotPublications.snapshotId, snapshotId))
          .run()
      }
      log.info({ reason: request.reason, unpublished: ids.length }, 'snapshot publications invalidated')
      return ids
    })
    if (request.reason === 'subject_deletion') {
      return {
        unpublishedSnapshotIds,
        publishedSnapshotContainsContribution: coordinateUnpublished(unpublishedSnapshotIds, request, deps),
      }
    }
    const remaining = deps
      .getDrizzleDb()
      .select({ snapshotId: analyticsSnapshotPublications.snapshotId })
      .from(analyticsSnapshotPublications)
      .where(
        request.storageGeneration === undefined
          ? eq(analyticsSnapshotPublications.state, 'published')
          : and(
              eq(analyticsSnapshotPublications.state, 'published'),
              eq(analyticsSnapshotPublications.storageGeneration, request.storageGeneration),
            ),
      )
      .all()
    return {
      unpublishedSnapshotIds,
      publishedSnapshotContainsContribution: remaining.length > 0,
    }
  }
}
