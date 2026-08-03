// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { runReconciliation } from '../../../src/analytics/jobs/reconcile.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import { openEpoch } from '../../../src/analytics/storage/epoch-store.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY1 = '2023-11-14'
const DAY1_LATE = Date.UTC(2023, 10, 14, 23, 0, 0, 0)
const DAY2_EARLY = Date.UTC(2023, 10, 15, 1, 0, 0, 0)

const ZERO_OUTSTANDING = { intent: 0, derive: 0, backfill: 0, retention: 0, delivery: 0, snapshot: 0 }

const seedCounterRow = (db: Db, utcDay: string): void => {
  db.insert(schema.analyticsDailyCounters)
    .values({
      utcDay,
      definitionVersion: 1,
      platform: 'telegram',
      contextType: 'dm',
      actorRole: 'member',
      taskProvider: 'none',
      appVersion: '6.10.0',
      metric: 'auth_granted',
      value: 3,
      finalized: true,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'eligible_actor',
      contributorCount: 5,
      threshold: null,
    })
    .run()
}

const seedCutoverRun = (db: Db): void => {
  db.insert(schema.analyticsRekeyRuns)
    .values({
      runId: 'run-reconcile-cutover',
      sourceGeneration: 'gen-1',
      targetGeneration: 'gen-2',
      fromVersions: JSON.stringify(['v1']),
      toVersions: JSON.stringify(['v2']),
      sourceHighWater: 'hw-1',
      phase: 'cutover',
      subphase: null,
      planHash: 'plan-hash-1',
      status: 'running',
      createdAt: DAY1_LATE,
      updatedAt: DAY1_LATE,
    })
    .run()
}

const bucketRow = (db: Db, utcDay: string): { reconciliationStatus: string; restartGapDetected: boolean } => {
  const row = db
    .select({
      reconciliationStatus: schema.analyticsDailyCounters.reconciliationStatus,
      restartGapDetected: schema.analyticsDailyCounters.restartGapDetected,
    })
    .from(schema.analyticsDailyCounters)
    .where(eq(schema.analyticsDailyCounters.utcDay, utcDay))
    .get()
  if (row === undefined) throw new Error(`no counter row for ${utcDay}`)
  return row
}

const createMidRunCutoverSpy = (
  db: Db,
  fence: ReturnType<typeof createRekeyCutoverFence>,
  admittedDuringRun: number[],
): (() => Db) => {
  let acquiredMidRun = false
  return () => {
    admittedDuringRun.push(fence.outstanding().backfill)
    if (!acquiredMidRun) {
      acquiredMidRun = true
      seedCutoverRun(db)
    }
    return db
  }
}

describe('reconcile job module', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('empty analytics state reconciles to zero', () => {
    const report = runReconciliation({ nowMs: 1_700_000_000_000, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('reconciled')
    expect(report.durableUsage.unexplainedDeltaTotal).toBe(0)
    expect(report.liveEpochs).toEqual([])
    expect(report.delivery.conserved).toBe(true)
  })

  test('a held cutover fence skips the reconcile apply phase with zero writes and no admission', () => {
    seedCounterRow(db, DAY1)
    openEpoch({ epochId: 'epoch-reconcile-held', startedAtMs: DAY1_LATE }, { getDrizzleDb: () => db })
    seedCutoverRun(db)
    const fence = createRekeyCutoverFence({ getDrizzleDb: () => db })

    const report = runReconciliation({ nowMs: DAY2_EARLY, apply: true }, { getDrizzleDb: () => db, fence })

    expect(report.liveEpochs[0]?.status).toBe('unreconciled_restart_gap')
    expect(report.liveEpochs[0]?.gapDays).toEqual([DAY1, '2023-11-15'])
    expect(bucketRow(db, DAY1)).toEqual({ reconciliationStatus: 'complete_epoch', restartGapDetected: false })
    expect(fence.outstanding()).toEqual(ZERO_OUTSTANDING)
  })

  test('a fence acquired mid-run leaves the apply phase inside an admission until it completes', () => {
    seedCounterRow(db, DAY1)
    openEpoch({ epochId: 'epoch-reconcile-midrun', startedAtMs: DAY1_LATE }, { getDrizzleDb: () => db })
    const fence = createRekeyCutoverFence({ getDrizzleDb: () => db })

    const admittedDuringRun: number[] = []
    const spiedGetDb = createMidRunCutoverSpy(db, fence, admittedDuringRun)

    const report = runReconciliation({ nowMs: DAY2_EARLY, apply: true }, { getDrizzleDb: spiedGetDb, fence })

    expect(report.status).toBe('gap')
    expect(bucketRow(db, DAY1)).toEqual({ reconciliationStatus: 'unreconciled_restart_gap', restartGapDetected: true })
    expect(admittedDuringRun.length).toBeGreaterThan(0)
    expect(Math.min(...admittedDuringRun)).toBe(1)
    expect(fence.isFenceHeld()).toBe(true)
    expect(fence.outstanding()).toEqual(ZERO_OUTSTANDING)
  })
})
