// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, rmSync } from 'node:fs'

import { and, eq, isNotNull } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsSnapshotPublications } from '../../db/schema.js'
import type { AnalyticsSnapshotPublicationRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { verifySnapshotFile } from '../jobs/snapshot.js'
import { getNonterminalRekeyRun } from '../rekey/run-store.js'
import { resolveActive } from './generation-store.js'
import type { GenerationTransitionCoordinator } from './snapshot-invalidator.js'
import { promoteStagedSnapshot } from './snapshot-publication-store.js'

const log = logger.child({ scope: 'analytics:governance:snapshot-consumer' })

const REKEY_QUIESCE_PHASES: ReadonlySet<string> = new Set(['cutover', 'swap', 'snapshot_republish'])

/**
 * The BI consumer boundary (Metabase). A pointer switch is never proof: the
 * coordinator only trusts a reopened connection reporting the new embedded
 * snapshot_id. Implementations must be fail-closed.
 */
export type SnapshotConsumerClient = Readonly<{
  quiesce: () => void
  closeAll: () => void
  configure: (path: string) => void
  reopen: () => void
  currentSnapshotId: () => string | null
  contributionOf: (marker: string) => number
  hasOpenHandle: (path: string) => boolean
  resume: () => void
}>

export type SnapshotConsumerCoordinatorDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  consumer: SnapshotConsumerClient
  pathForSnapshot: (snapshotId: string) => string
  buildSnapshot?: (
    input: Readonly<{ transitionRunId: string }>,
  ) => Readonly<{ snapshotId: string; pathHash: string; sourceHighWater: string }>
  nowMs: () => number
}>

export type StartupServeResult = Readonly<{ serving: boolean; snapshotId?: string }>

export type SnapshotDeletionAck = Readonly<{ acknowledged: true }>

type Db = ReturnType<typeof defaultGetDrizzleDb>

const publicationsIn = (db: Db, state: string): readonly AnalyticsSnapshotPublicationRow[] =>
  db.select().from(analyticsSnapshotPublications).where(eq(analyticsSnapshotPublications.state, state)).all()

const invalidateRow = (db: Db, snapshotId: string, nowMs: number): void => {
  db.update(analyticsSnapshotPublications)
    .set({ state: 'invalidated', invalidatedAt: nowMs })
    .where(
      and(
        eq(analyticsSnapshotPublications.snapshotId, snapshotId),
        eq(analyticsSnapshotPublications.state, 'published'),
      ),
    )
    .run()
}

const createSubjectDeletion = (deps: SnapshotConsumerCoordinatorDeps) => {
  return (
    input: Readonly<{ newSnapshotId: string; oldSnapshotId: string; contributionMarker: string }>,
  ): SnapshotDeletionAck => {
    const db = deps.getDrizzleDb()
    const consumer = deps.consumer
    consumer.quiesce()
    consumer.closeAll()
    invalidateRow(db, input.oldSnapshotId, deps.nowMs())
    const newPath = deps.pathForSnapshot(input.newSnapshotId)
    verifySnapshotFile(newPath, { snapshotId: input.newSnapshotId })
    consumer.configure(newPath)
    consumer.reopen()
    if (consumer.currentSnapshotId() !== input.newSnapshotId) {
      log.warn('reopened consumer did not prove the new snapshot_id; deletion stays incomplete')
      throw new Error('consumer reopen did not prove the new snapshot_id')
    }
    if (consumer.contributionOf(input.contributionMarker) !== 0) {
      log.warn('old contribution still visible after remount; deletion stays incomplete')
      throw new Error('consumer still reports a nonzero old contribution')
    }
    const oldPath = deps.pathForSnapshot(input.oldSnapshotId)
    if (consumer.hasOpenHandle(oldPath)) {
      log.warn('an open old inode blocks acknowledgement and removal')
      throw new Error('consumer still has an open handle on the old snapshot file')
    }
    promoteStagedSnapshot({ snapshotId: input.newSnapshotId, nowMs: deps.nowMs() }, { getDrizzleDb: deps.getDrizzleDb })
    consumer.resume()
    if (existsSync(oldPath)) rmSync(oldPath, { force: true })
    log.info('subject deletion acknowledged after verified snapshot replacement')
    return { acknowledged: true }
  }
}

const createPublishStagedOrdinary = (deps: SnapshotConsumerCoordinatorDeps) => {
  return (): void => {
    const db = deps.getDrizzleDb()
    const run = getNonterminalRekeyRun({ getDrizzleDb: deps.getDrizzleDb })
    if (run !== null && REKEY_QUIESCE_PHASES.has(run.phase)) {
      throw new Error('ordinary publication refused while a rekey run holds the cutover')
    }
    const staged = publicationsIn(db, 'staged').find((row) => row.transitionRunId === null)
    if (staged === undefined) return
    const consumer = deps.consumer
    consumer.quiesce()
    const path = deps.pathForSnapshot(staged.snapshotId)
    const meta = verifySnapshotFile(path, {
      snapshotId: staged.snapshotId,
      storageGeneration: staged.storageGeneration,
    })
    const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
    if (meta.storageGeneration !== active.generation) {
      log.warn('staged snapshot generation disagrees with the active pointer; not promoted')
      throw new Error('staged snapshot generation does not match the active pointer')
    }
    consumer.closeAll()
    consumer.configure(path)
    consumer.reopen()
    if (consumer.currentSnapshotId() !== staged.snapshotId) {
      throw new Error('consumer reopen did not prove the staged snapshot_id')
    }
    promoteStagedSnapshot({ snapshotId: staged.snapshotId, nowMs: deps.nowMs() }, { getDrizzleDb: deps.getDrizzleDb })
    consumer.resume()
    log.info('ordinary staged snapshot promoted after verified remount')
  }
}

const reconcileOrphanedStage = (deps: SnapshotConsumerCoordinatorDeps, row: AnalyticsSnapshotPublicationRow): void => {
  const db = deps.getDrizzleDb()
  const path = deps.pathForSnapshot(row.snapshotId)
  if (existsSync(path) && deps.consumer.hasOpenHandle(path)) deps.consumer.closeAll()
  db.update(analyticsSnapshotPublications)
    .set({ state: 'invalidated', invalidatedAt: deps.nowMs() })
    .where(eq(analyticsSnapshotPublications.snapshotId, row.snapshotId))
    .run()
  if (existsSync(path)) rmSync(path, { force: true })
  log.warn('ordinary staged orphan invalidated and unlinked; never guessed verified')
}

const isOrphanedStage = (deps: SnapshotConsumerCoordinatorDeps, row: AnalyticsSnapshotPublicationRow): boolean => {
  if (row.transitionRunId === null) return true
  const run = getNonterminalRekeyRun({ getDrizzleDb: deps.getDrizzleDb })
  return run === null || run.runId !== row.transitionRunId
}

const createStartupServe = (deps: SnapshotConsumerCoordinatorDeps) => {
  return (): StartupServeResult => {
    const db = deps.getDrizzleDb()
    const run = getNonterminalRekeyRun({ getDrizzleDb: deps.getDrizzleDb })
    if (run !== null && REKEY_QUIESCE_PHASES.has(run.phase)) {
      log.warn('startup serving stays quiesced while a rekey run holds the cutover')
      return { serving: false }
    }
    for (const row of publicationsIn(db, 'staged')) {
      if (isOrphanedStage(deps, row)) reconcileOrphanedStage(deps, row)
    }
    const published = publicationsIn(db, 'published')
    if (published.length !== 1) {
      log.warn({ published: published.length }, 'startup requires exactly one published snapshot row')
      return { serving: false }
    }
    const row = published[0]
    if (row === undefined) return { serving: false }
    const path = deps.pathForSnapshot(row.snapshotId)
    if (!existsSync(path)) {
      log.warn('published snapshot file is missing')
      return { serving: false }
    }
    try {
      verifySnapshotFile(path, { snapshotId: row.snapshotId, storageGeneration: row.storageGeneration })
    } catch {
      log.warn('published snapshot file failed embedded verification')
      return { serving: false }
    }
    const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
    if (row.storageGeneration !== active.generation) {
      log.warn('published snapshot generation disagrees with the active pointer')
      return { serving: false }
    }
    deps.consumer.configure(path)
    deps.consumer.reopen()
    if (deps.consumer.currentSnapshotId() !== row.snapshotId) {
      log.warn('consumer reopen did not prove the published snapshot_id')
      return { serving: false }
    }
    deps.consumer.resume()
    return { serving: true, snapshotId: row.snapshotId }
  }
}

const createRemountAndVerify = (deps: SnapshotConsumerCoordinatorDeps) => {
  return ({
    snapshotId,
    expectedGeneration,
  }: Readonly<{ snapshotId: string; expectedGeneration: string }>): boolean => {
    const db = deps.getDrizzleDb()
    const run = getNonterminalRekeyRun({ getDrizzleDb: deps.getDrizzleDb })
    if (run === null) return false
    const staged = db
      .select()
      .from(analyticsSnapshotPublications)
      .where(
        and(
          eq(analyticsSnapshotPublications.snapshotId, snapshotId),
          eq(analyticsSnapshotPublications.state, 'staged'),
          isNotNull(analyticsSnapshotPublications.transitionRunId),
        ),
      )
      .get()
    if (staged === undefined || staged.transitionRunId !== run.runId) return false
    if (staged.storageGeneration !== expectedGeneration) return false
    const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
    if (active.generation !== expectedGeneration) return false
    try {
      verifySnapshotFile(deps.pathForSnapshot(snapshotId), {
        snapshotId,
        storageGeneration: expectedGeneration,
      })
    } catch {
      return false
    }
    deps.consumer.configure(deps.pathForSnapshot(snapshotId))
    deps.consumer.reopen()
    return deps.consumer.currentSnapshotId() === snapshotId
  }
}

const createUnlinkSourceFile = (deps: SnapshotConsumerCoordinatorDeps) => {
  return ({ sourceGeneration }: Readonly<{ sourceGeneration: string }>): void => {
    const db = deps.getDrizzleDb()
    const retired = db
      .select()
      .from(analyticsSnapshotPublications)
      .where(
        and(
          eq(analyticsSnapshotPublications.storageGeneration, sourceGeneration),
          eq(analyticsSnapshotPublications.state, 'invalidated'),
        ),
      )
      .all()
    for (const row of retired) {
      const path = deps.pathForSnapshot(row.snapshotId)
      if (!existsSync(path)) continue
      if (deps.consumer.hasOpenHandle(path)) {
        throw new Error('source snapshot file still has an open consumer handle')
      }
      rmSync(path, { force: true })
      log.info('source-generation snapshot file unlinked after the consumer cleared')
    }
  }
}

const createTransitionCoordinator = (deps: SnapshotConsumerCoordinatorDeps): GenerationTransitionCoordinator => ({
  quiesceQueries: (): void => {
    deps.consumer.quiesce()
  },
  closeSourceConnections: (): void => {
    deps.consumer.closeAll()
  },
  buildTargetSnapshot: ({ runId }): Readonly<{ snapshotId: string; pathHash: string; sourceHighWater: string }> => {
    if (deps.buildSnapshot === undefined) throw new Error('no snapshot builder is configured')
    return deps.buildSnapshot({ transitionRunId: runId })
  },
  remountAndVerify: createRemountAndVerify(deps),
  resumeQueries: (): void => {
    deps.consumer.resume()
  },
  unlinkSourceFile: createUnlinkSourceFile(deps),
})

/**
 * Fail-closed Metabase coordinator: quiesce/close/configure/reopen/verify for
 * subject deletion, ordinary staged replacement, startup serving with orphan
 * reconciliation, and the rekey snapshot_republish port. Any verification
 * failure leaves BI quiesced and never silently resumes against an old file.
 */
export const createSnapshotConsumerCoordinator = (
  deps: SnapshotConsumerCoordinatorDeps,
): Readonly<{
  coordinateSubjectDeletion: ReturnType<typeof createSubjectDeletion>
  publishStagedOrdinary: ReturnType<typeof createPublishStagedOrdinary>
  startupServe: ReturnType<typeof createStartupServe>
  transitionCoordinator: GenerationTransitionCoordinator
}> => ({
  coordinateSubjectDeletion: createSubjectDeletion(deps),
  publishStagedOrdinary: createPublishStagedOrdinary(deps),
  startupServe: createStartupServe(deps),
  transitionCoordinator: createTransitionCoordinator(deps),
})
