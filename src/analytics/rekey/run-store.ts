// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, ne } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEvents, analyticsRekeyMappings, analyticsRekeyRuns } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:rekey:run-store' })

/**
 * Frozen logical phase order (06 §Task 13). The persisted `phase` column uses
 * the schema CHECK tokens `cutover` and `remote`; the logical phases
 * `cutover_fence`, `remote_delete`, and `remote_resend` persist as
 * `cutover` and `remote` with the checkpoint subphase carrying the exact
 * logical name.
 */
export const REKEY_LOGICAL_PHASE_ORDER = [
  'plan',
  'dual_write',
  'copy_parents',
  'copy_children',
  'verify',
  'cutover_fence',
  'swap',
  'snapshot_republish',
  'remote_delete',
  'remote_resend',
  'retire',
] as const

export const REKEY_SUBPHASE_SEQUENCE = [
  'dual_write.identity',
  'dual_write.governance',
  'copy_parents.events_sources',
  'copy_children.materializations_backfill',
  'copy_children.preferences_collection_grants',
  'copy_children.delivery_deletion',
  'verify.local_graph',
  'cutover.fence_drain_delta',
  'cutover.snapshot_quiesced',
  'swap.active_generation',
  'snapshot_republish.quiesce_build_switch',
  'remote_delete',
  'remote_resend',
  'retire.waiting_horizon',
] as const

export type RekeySubphase = (typeof REKEY_SUBPHASE_SEQUENCE)[number]

export const SUBPHASE_PHASE: Readonly<Record<RekeySubphase, string>> = {
  'dual_write.identity': 'dual_write',
  'dual_write.governance': 'dual_write',
  'copy_parents.events_sources': 'copy_parents',
  'copy_children.materializations_backfill': 'copy_children',
  'copy_children.preferences_collection_grants': 'copy_children',
  'copy_children.delivery_deletion': 'copy_children',
  'verify.local_graph': 'verify',
  'cutover.fence_drain_delta': 'cutover',
  'cutover.snapshot_quiesced': 'cutover',
  'swap.active_generation': 'swap',
  'snapshot_republish.quiesce_build_switch': 'snapshot_republish',
  remote_delete: 'remote',
  remote_resend: 'remote',
  'retire.waiting_horizon': 'retire',
}

const DUAL_WRITE_PHASES: ReadonlySet<string> = new Set(['dual_write', 'copy_parents', 'copy_children', 'verify'])

export type RekeyRunStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>
export type RekeyTx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

/** Parses a persisted rekey version list (`from_versions`/`to_versions`). */
export const parseRekeyVersions = (json: string): readonly string[] => {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('rekey run version list is malformed')
  }
  return parsed as readonly string[]
}

export const getRekeyRun = (
  runId: string,
  deps: RekeyRunStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AnalyticsRekeyRunRow | null => {
  const row = deps.getDrizzleDb().select().from(analyticsRekeyRuns).where(eq(analyticsRekeyRuns.runId, runId)).get()
  return row ?? null
}

const NONTERMINAL_STATUSES: ReadonlySet<string> = new Set(['planned', 'running', 'paused'])

export const getNonterminalRekeyRunIn = (db: Db | RekeyTx): AnalyticsRekeyRunRow | null => {
  const rows = db.select().from(analyticsRekeyRuns).where(ne(analyticsRekeyRuns.status, 'completed')).all()
  const row = rows.find((candidate) => NONTERMINAL_STATUSES.has(candidate.status))
  return row ?? null
}

export const getNonterminalRekeyRun = (
  deps: RekeyRunStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AnalyticsRekeyRunRow | null => getNonterminalRekeyRunIn(deps.getDrizzleDb())

/** Dual-write is mandatory from the first identity mapping until the swap commits. */
export const isDualWriteActive = (run: AnalyticsRekeyRunRow): boolean =>
  NONTERMINAL_STATUSES.has(run.status) && (DUAL_WRITE_PHASES.has(run.phase) || run.phase === 'cutover')

export const checkpointRekeyRunIn = (
  tx: RekeyTx,
  input: Readonly<{
    runId: string
    phase: string
    subphase: string | null
    status?: string
    mappedCount?: number
    copiedCount?: number
    verifiedCount?: number
    nowMs: number
  }>,
): void => {
  tx.update(analyticsRekeyRuns)
    .set({
      phase: input.phase,
      subphase: input.subphase,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.mappedCount === undefined ? {} : { mappedCount: input.mappedCount }),
      ...(input.copiedCount === undefined ? {} : { copiedCount: input.copiedCount }),
      ...(input.verifiedCount === undefined ? {} : { verifiedCount: input.verifiedCount }),
      updatedAt: input.nowMs,
    })
    .where(eq(analyticsRekeyRuns.runId, input.runId))
    .run()
  log.debug({ phase: input.phase, subphase: input.subphase }, 'rekey checkpoint persisted')
}

export const pauseRekeyRun = (
  input: Readonly<{ runId: string; nowMs: number }>,
  deps: RekeyRunStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  deps
    .getDrizzleDb()
    .update(analyticsRekeyRuns)
    .set({ status: 'paused', updatedAt: input.nowMs })
    .where(and(eq(analyticsRekeyRuns.runId, input.runId), ne(analyticsRekeyRuns.status, 'completed')))
    .run()
  log.warn('rekey run paused')
}

export type AbortRekeyResult = 'aborted' | 'rejected'

/**
 * Terminal abort is legal only for a pristine plan: one transaction proves
 * there is no mapping, no target-generation row, and no installed dual-write
 * state. Every later attempt is rejected and the run stays resumable.
 */
export const abortRekeyRun = (
  input: Readonly<{ runId: string; nowMs: number }>,
  deps: RekeyRunStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AbortRekeyResult =>
  deps.getDrizzleDb().transaction((tx) => {
    const run = tx.select().from(analyticsRekeyRuns).where(eq(analyticsRekeyRuns.runId, input.runId)).get()
    if (run === undefined || run.status !== 'planned' || run.phase !== 'plan' || run.subphase !== null) {
      log.warn({ status: run?.status, phase: run?.phase }, 'rekey abort rejected: run not a pristine plan')
      return 'rejected'
    }
    const mapping = tx
      .select({ oldKeyHash: analyticsRekeyMappings.oldKeyHash })
      .from(analyticsRekeyMappings)
      .where(eq(analyticsRekeyMappings.runId, input.runId))
      .get()
    if (mapping !== undefined) {
      log.warn('rekey abort rejected: mappings installed')
      return 'rejected'
    }
    const targetRow = tx
      .select({ eventId: analyticsEvents.eventId })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.storageGeneration, run.targetGeneration))
      .get()
    if (targetRow !== undefined) {
      log.warn('rekey abort rejected: target-generation rows exist')
      return 'rejected'
    }
    tx.update(analyticsRekeyRuns)
      .set({ status: 'aborted', updatedAt: input.nowMs })
      .where(eq(analyticsRekeyRuns.runId, input.runId))
      .run()
    log.info('pristine rekey plan aborted; run slot released')
    return 'aborted'
  })
