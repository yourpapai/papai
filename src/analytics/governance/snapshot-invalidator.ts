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
}>

export const createSnapshotInvalidator = (deps: SnapshotInvalidatorDeps): SnapshotInvalidator => {
  return (request) => {
    return deps.getDrizzleDb().transaction((tx) => {
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
      const unpublishedSnapshotIds = published.map((row) => row.snapshotId)
      for (const snapshotId of unpublishedSnapshotIds) {
        tx.update(analyticsSnapshotPublications)
          .set({ state: 'invalidated', invalidatedAt: request.nowMs })
          .where(eq(analyticsSnapshotPublications.snapshotId, snapshotId))
          .run()
      }
      const remaining = tx
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
      log.info(
        { reason: request.reason, unpublished: unpublishedSnapshotIds.length },
        'snapshot publications invalidated',
      )
      return {
        unpublishedSnapshotIds,
        publishedSnapshotContainsContribution: remaining.length > 0,
      }
    })
  }
}
