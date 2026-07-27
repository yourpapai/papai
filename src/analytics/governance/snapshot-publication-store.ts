// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsRekeyRuns, analyticsSnapshotPublications } from '../../db/schema.js'
import type { AnalyticsSnapshotPublicationRow } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({
  scope: 'analytics:governance:snapshot-publication-store',
})

export type SnapshotPublicationStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
}>

const DEFAULT_DEPS: SnapshotPublicationStoreDeps = {
  getDrizzleDb: defaultGetDrizzleDb,
}

const REKEY_CUTOVER_PHASES: ReadonlySet<string> = new Set(['cutover', 'swap', 'snapshot_republish'])

/**
 * Normal (null-owned) snapshot scheduling must neither deadlock nor bypass a
 * rekey-owned cutover: while a nonterminal run holds the cutover token,
 * ordinary staging is refused; the rekey path stages via
 * `stageRekeySnapshotPublication` with the run id.
 */
const assertNoRekeyCutoverIn = (
  tx: Parameters<ReturnType<typeof defaultGetDrizzleDb>['transaction']>[0] extends (tx: infer T) => unknown ? T : never,
): void => {
  const runs = tx.select().from(analyticsRekeyRuns).all()
  const blocking = runs.find(
    (run) => run.status !== 'completed' && run.status !== 'aborted' && REKEY_CUTOVER_PHASES.has(run.phase),
  )
  if (blocking !== undefined) {
    log.warn('ordinary snapshot staging refused: rekey cutover token held')
    throw new Error('snapshot staging is rekey-owned while a transition run holds the cutover')
  }
}

type StagedPublication = Readonly<{ snapshotId: string; state: 'staged' }>

export const getPublication = (
  snapshotId: string,
  deps: SnapshotPublicationStoreDeps = DEFAULT_DEPS,
): AnalyticsSnapshotPublicationRow | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsSnapshotPublications)
    .where(eq(analyticsSnapshotPublications.snapshotId, snapshotId))
    .get()
  return row ?? null
}

const findStagedRow = (
  tx: Parameters<ReturnType<typeof defaultGetDrizzleDb>['transaction']>[0] extends (tx: infer T) => unknown ? T : never,
  transitionRunId: string | null,
): AnalyticsSnapshotPublicationRow | undefined => {
  const rows = tx.select().from(analyticsSnapshotPublications).all()
  return rows.find((row) => row.state === 'staged' && row.transitionRunId === transitionRunId)
}

const stageRow = (
  deps: SnapshotPublicationStoreDeps,
  input: Readonly<{
    snapshotId: string
    storageGeneration: string
    transitionRunId: string | null
    pathHash: string
    sourceHighWater: string
    nowMs: number
  }>,
): StagedPublication =>
  deps.getDrizzleDb().transaction((tx) => {
    if (input.transitionRunId === null) assertNoRekeyCutoverIn(tx)
    const existing = findStagedRow(tx, input.transitionRunId)
    if (existing !== undefined) {
      tx.update(analyticsSnapshotPublications)
        .set({
          storageGeneration: input.storageGeneration,
          pathHash: input.pathHash,
          sourceHighWater: input.sourceHighWater,
        })
        .where(eq(analyticsSnapshotPublications.snapshotId, existing.snapshotId))
        .run()
      log.info({ state: 'staged' }, 'snapshot publication staging reused')
      return { snapshotId: existing.snapshotId, state: 'staged' }
    }
    tx.insert(analyticsSnapshotPublications)
      .values({
        snapshotId: input.snapshotId,
        storageGeneration: input.storageGeneration,
        transitionRunId: input.transitionRunId,
        pathHash: input.pathHash,
        sourceHighWater: input.sourceHighWater,
        state: 'staged',
      })
      .run()
    log.info({ state: 'staged' }, 'snapshot publication staged')
    return { snapshotId: input.snapshotId, state: 'staged' }
  })

export const stageSnapshotPublication = (
  input: Readonly<{
    snapshotId: string
    storageGeneration: string
    pathHash: string
    sourceHighWater: string
    nowMs: number
  }>,
  deps: SnapshotPublicationStoreDeps = DEFAULT_DEPS,
): StagedPublication => stageRow(deps, { ...input, transitionRunId: null })

export const stageRekeySnapshotPublication = (
  input: Readonly<{
    snapshotId: string
    storageGeneration: string
    transitionRunId: string
    pathHash: string
    sourceHighWater: string
    nowMs: number
  }>,
  deps: SnapshotPublicationStoreDeps = DEFAULT_DEPS,
): StagedPublication => {
  const run = deps
    .getDrizzleDb()
    .select()
    .from(analyticsRekeyRuns)
    .where(eq(analyticsRekeyRuns.runId, input.transitionRunId))
    .get()
  if (run === undefined) throw new Error('transition run not found')
  if (run.status === 'completed' || run.status === 'aborted') throw new Error('transition run is terminal')
  if (run.targetGeneration !== input.storageGeneration) {
    throw new Error('staged snapshot generation must equal the transition run target generation')
  }
  return stageRow(deps, input)
}

export const promoteStagedSnapshot = (
  input: Readonly<{ snapshotId: string; nowMs: number }>,
  deps: SnapshotPublicationStoreDeps = DEFAULT_DEPS,
): void => {
  deps.getDrizzleDb().transaction((tx) => {
    const staged = tx
      .select()
      .from(analyticsSnapshotPublications)
      .where(
        and(
          eq(analyticsSnapshotPublications.snapshotId, input.snapshotId),
          eq(analyticsSnapshotPublications.state, 'staged'),
        ),
      )
      .get()
    if (staged === undefined) throw new Error('staged snapshot publication not found')
    tx.update(analyticsSnapshotPublications)
      .set({ state: 'invalidated', invalidatedAt: input.nowMs })
      .where(eq(analyticsSnapshotPublications.state, 'published'))
      .run()
    tx.update(analyticsSnapshotPublications)
      .set({ state: 'published', publishedAt: input.nowMs })
      .where(eq(analyticsSnapshotPublications.snapshotId, input.snapshotId))
      .run()
  })
  log.info({ state: 'published' }, 'snapshot publication promoted')
}
