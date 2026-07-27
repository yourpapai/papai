// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeliveries, analyticsRekeyRuns } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { GrantSendMutex } from '../governance/grant-serialization.js'
import { getNonterminalRekeyRun } from './run-store.js'

const log = logger.child({ scope: 'analytics:rekey:cutover-fence' })

export const MUTABLE_WRITER_CLASSES = ['intent', 'derive', 'backfill', 'retention', 'delivery', 'snapshot'] as const

export type MutableWriterClass = (typeof MUTABLE_WRITER_CLASSES)[number]

export type FenceAdmission = Readonly<{
  writerClass: MutableWriterClass
  release: () => void
}>

export type RekeyCutoverFenceDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  grantMutex?: GrantSendMutex
}>

export type RekeyCutoverFence = Readonly<{
  admit: (writerClass: MutableWriterClass) => FenceAdmission | null
  isFenceHeld: () => boolean
  acquireFence: (runId: string, nowMs: number) => void
  releaseFence: (runId: string, nowMs: number) => void
  outstanding: () => Readonly<Record<MutableWriterClass, number>>
  isDrained: () => boolean
}>

const zeroOutstanding = (): Record<MutableWriterClass, number> => ({
  intent: 0,
  derive: 0,
  backfill: 0,
  retention: 0,
  delivery: 0,
  snapshot: 0,
})

type GetDb = typeof defaultGetDrizzleDb

const createAdmit = (counts: Record<MutableWriterClass, number>, isFenceHeld: () => boolean) => {
  return (writerClass: MutableWriterClass): FenceAdmission | null => {
    if (isFenceHeld()) {
      log.warn({ writerClass }, 'cutover fence held: late admission rejected')
      return null
    }
    counts[writerClass] += 1
    let released = false
    return {
      writerClass,
      release: () => {
        if (released) return
        released = true
        counts[writerClass] -= 1
      },
    }
  }
}

const sendingInFlight = (getDrizzleDb: GetDb): boolean =>
  getDrizzleDb()
    .select({ eventId: analyticsDeliveries.eventId })
    .from(analyticsDeliveries)
    .where(eq(analyticsDeliveries.state, 'sending'))
    .get() !== undefined

const createIsDrained = (deps: RekeyCutoverFenceDeps, counts: Record<MutableWriterClass, number>) => {
  return (): boolean => {
    if (Object.values(counts).some((count) => count > 0)) return false
    if ((deps.grantMutex?.heldCount?.() ?? 0) > 0) return false
    return !sendingInFlight(deps.getDrizzleDb)
  }
}

const createAcquireFence = (getDrizzleDb: GetDb) => {
  return (runId: string, nowMs: number): void => {
    const current = getDrizzleDb()
      .select({ phase: analyticsRekeyRuns.phase })
      .from(analyticsRekeyRuns)
      .where(eq(analyticsRekeyRuns.runId, runId))
      .get()
    if (current === undefined) throw new Error('cutover fence acquire refused: run missing')
    if (current.phase === 'cutover') return
    if (current.phase !== 'verify') throw new Error('cutover fence can only be acquired from the verify phase')
    getDrizzleDb()
      .update(analyticsRekeyRuns)
      .set({ phase: 'cutover', subphase: null, status: 'running', updatedAt: nowMs })
      .where(and(eq(analyticsRekeyRuns.runId, runId), eq(analyticsRekeyRuns.phase, 'verify')))
      .run()
    log.info('cutover fence acquired durably')
  }
}

/**
 * The global admission/drain boundary for the rekey cutover. The fence state
 * is durable (the run row's `cutover` phase), so a restart resumes the fence
 * and persisted in-flight sends still block the drain; admitted-writer counts
 * are process-local because no admitted writer survives a process restart.
 */
export const createRekeyCutoverFence = (deps: RekeyCutoverFenceDeps): RekeyCutoverFence => {
  const counts = zeroOutstanding()
  const isFenceHeld = (): boolean => {
    const run = getNonterminalRekeyRun({ getDrizzleDb: deps.getDrizzleDb })
    return run !== null && run.phase === 'cutover'
  }
  return {
    admit: createAdmit(counts, isFenceHeld),
    isFenceHeld,
    acquireFence: createAcquireFence(deps.getDrizzleDb),
    releaseFence: (runId, nowMs) => {
      deps
        .getDrizzleDb()
        .update(analyticsRekeyRuns)
        .set({ phase: 'swap', updatedAt: nowMs })
        .where(and(eq(analyticsRekeyRuns.runId, runId), eq(analyticsRekeyRuns.phase, 'cutover')))
        .run()
      log.info('cutover fence released after pointer swap')
    },
    outstanding: () => ({ ...counts }),
    isDrained: createIsDrained(deps, counts),
  }
}
