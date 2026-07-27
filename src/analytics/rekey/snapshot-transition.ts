// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsSnapshotPublications } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { resolveActive } from '../governance/generation-store.js'
import type { GenerationTransitionCoordinator } from '../governance/snapshot-invalidator.js'
import {
  getPublication,
  promoteStagedSnapshot,
  stageRekeySnapshotPublication,
} from '../governance/snapshot-publication-store.js'

const log = logger.child({ scope: 'analytics:rekey:snapshot-transition' })

export type SnapshotTransitionDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  nowMs: number
}>

const resolveStagedSnapshotId = (
  run: AnalyticsRekeyRunRow,
  coordinator: GenerationTransitionCoordinator,
  deps: SnapshotTransitionDeps,
): string => {
  const staged = deps
    .getDrizzleDb()
    .select()
    .from(analyticsSnapshotPublications)
    .where(
      and(
        eq(analyticsSnapshotPublications.state, 'staged'),
        eq(analyticsSnapshotPublications.transitionRunId, run.runId),
      ),
    )
    .get()
  if (staged === undefined) {
    const built = coordinator.buildTargetSnapshot({
      runId: run.runId,
      targetGeneration: run.targetGeneration,
      nowMs: deps.nowMs,
    })
    const stagedRow = stageRekeySnapshotPublication(
      {
        snapshotId: built.snapshotId,
        storageGeneration: run.targetGeneration,
        transitionRunId: run.runId,
        pathHash: built.pathHash,
        sourceHighWater: built.sourceHighWater,
        nowMs: deps.nowMs,
      },
      { getDrizzleDb: deps.getDrizzleDb },
    )
    return stagedRow.snapshotId
  }
  log.info('snapshot_republish resumed with the persisted staged publication')
  return staged.snapshotId
}

const assertStagedMatchesPointer = (
  run: AnalyticsRekeyRunRow,
  snapshotId: string,
  deps: SnapshotTransitionDeps,
): void => {
  const stagedRow = getPublication(snapshotId, { getDrizzleDb: deps.getDrizzleDb })
  const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
  if (
    stagedRow === null ||
    stagedRow.state !== 'staged' ||
    stagedRow.transitionRunId !== run.runId ||
    stagedRow.storageGeneration !== run.targetGeneration ||
    active.generation !== run.targetGeneration
  ) {
    log.warn('staged publication disagrees with the active pointer; BI remains quiesced')
    throw new Error('rekey staged publication does not match the active generation pointer')
  }
}

/**
 * snapshot_republish.quiesce_build_switch: with BI still down after the
 * pointer swap, build exactly one target-generation snapshot under the
 * rekey-owned cutover token (the run id), stage it owned by the run,
 * remount/verify against the staged row and the active pointer, promote
 * staged→published, resume queries, and unlink the old file. Any failure
 * leaves the staged row and the invalidated old publication for recovery and
 * never serves the source-generation file.
 */
export const runSnapshotRepublish = (
  run: AnalyticsRekeyRunRow,
  coordinator: GenerationTransitionCoordinator,
  deps: SnapshotTransitionDeps,
): void => {
  const snapshotId = resolveStagedSnapshotId(run, coordinator, deps)
  if (!coordinator.remountAndVerify({ snapshotId, expectedGeneration: run.targetGeneration })) {
    log.warn('snapshot remount verification failed; BI remains quiesced')
    throw new Error('rekey snapshot remount verification failed')
  }
  assertStagedMatchesPointer(run, snapshotId, deps)
  promoteStagedSnapshot({ snapshotId, nowMs: deps.nowMs }, { getDrizzleDb: deps.getDrizzleDb })
  coordinator.resumeQueries({ runId: run.runId, nowMs: deps.nowMs })
  coordinator.unlinkSourceFile({ sourceGeneration: run.sourceGeneration, nowMs: deps.nowMs })
  log.info('target-generation snapshot published; queries resumed')
}
