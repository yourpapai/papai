// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { createProcessEpochCoordinator } from '../../src/analytics/process-epoch.js'
import type { ProcessEpochCoordinatorDeps } from '../../src/analytics/process-epoch.js'
import { getEpochState, openEpoch } from '../../src/analytics/storage/epoch-store.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY1 = '2023-11-14'
const DAY2 = '2023-11-15'
const DAY1_LATE = Date.UTC(2023, 10, 14, 23, 0, 0, 0)
const DAY2_EARLY = Date.UTC(2023, 10, 15, 1, 0, 0, 0)
const STALE_THRESHOLD = 5 * 60 * 1000

const seedCounterRow = (db: Db, utcDay: string, contributorCount: number | null): void => {
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
      contributorCount,
      threshold: null,
    })
    .run()
}

const counterRowFor = (
  db: Db,
  utcDay: string,
): { reconciliationStatus: string; restartGapDetected: boolean; contributorCount: number | null } => {
  const row = db
    .select({
      reconciliationStatus: schema.analyticsDailyCounters.reconciliationStatus,
      restartGapDetected: schema.analyticsDailyCounters.restartGapDetected,
      contributorCount: schema.analyticsDailyCounters.contributorCount,
    })
    .from(schema.analyticsDailyCounters)
    .where(eq(schema.analyticsDailyCounters.utcDay, utcDay))
    .get()
  if (row === undefined) throw new Error(`no counter row for ${utcDay}`)
  return row
}

const makeCoordinator = (
  db: Db,
  overrides: Partial<ProcessEpochCoordinatorDeps> = {},
): ReturnType<typeof createProcessEpochCoordinator> =>
  createProcessEpochCoordinator({
    getDrizzleDb: () => db,
    nowMs: () => DAY2_EARLY,
    newEpochId: () => 'epoch-new-1',
    staleThresholdMs: STALE_THRESHOLD,
    ...overrides,
  })

const makeStateProbeDrain = (db: Db, epochId: string, probe: string[]): (() => Promise<void>) => {
  return () => {
    const state = getEpochState({ epochId }, { getDrizzleDb: () => db })
    probe.push(state?.state ?? 'missing')
    return Promise.resolve()
  }
}

describe('process epoch coordinator', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('open creates the durable open epoch before any producer binds to it', () => {
    const coordinator = makeCoordinator(db)
    coordinator.open()
    expect(coordinator.epochId).toBe('epoch-new-1')
    expect(getEpochState({ epochId: 'epoch-new-1' }, { getDrizzleDb: () => db })).toEqual({ state: 'open' })
  })

  test('clean shutdown drains while the epoch is still open, then closes it', async () => {
    const probe: string[] = []
    const coordinator = makeCoordinator(db, { drain: makeStateProbeDrain(db, 'epoch-new-1', probe) })
    coordinator.open()
    const result = await coordinator.close()
    expect(result.closed).toBe(true)
    expect(probe).toEqual(['open'])
    expect(getEpochState({ epochId: 'epoch-new-1' }, { getDrizzleDb: () => db })).toEqual({ state: 'closed' })
  })

  test('a crash after a finalized bucket overturns it to unreconciled and nulls contributor count', () => {
    seedCounterRow(db, DAY2, 5)
    openEpoch({ epochId: 'epoch-crashed', startedAtMs: DAY2_EARLY - 60 * 60 * 1000 }, { getDrizzleDb: () => db })
    const coordinator = makeCoordinator(db)
    coordinator.recoverStaleEpochs()
    expect(getEpochState({ epochId: 'epoch-crashed' }, { getDrizzleDb: () => db })).toEqual({ state: 'stale_open' })
    expect(counterRowFor(db, DAY2)).toEqual({
      reconciliationStatus: 'unreconciled_restart_gap',
      restartGapDetected: true,
      contributorCount: null,
    })
  })

  test('a crash spanning UTC midnight marks both intersecting days', () => {
    seedCounterRow(db, DAY1, 2)
    seedCounterRow(db, DAY2, 4)
    openEpoch({ epochId: 'epoch-crashed', startedAtMs: DAY1_LATE }, { getDrizzleDb: () => db })
    const coordinator = makeCoordinator(db)
    coordinator.recoverStaleEpochs()
    expect(counterRowFor(db, DAY1).reconciliationStatus).toBe('unreconciled_restart_gap')
    expect(counterRowFor(db, DAY2).reconciliationStatus).toBe('unreconciled_restart_gap')
  })

  test('recovery leaves buckets outside the crash interval untouched', () => {
    seedCounterRow(db, DAY1, 2)
    openEpoch({ epochId: 'epoch-crashed', startedAtMs: DAY2_EARLY - 30 * 60 * 1000 }, { getDrizzleDb: () => db })
    const coordinator = makeCoordinator(db)
    coordinator.recoverStaleEpochs()
    expect(counterRowFor(db, DAY1)).toEqual({
      reconciliationStatus: 'complete_epoch',
      restartGapDetected: false,
      contributorCount: 2,
    })
  })

  test('a forced drain timeout leaves the epoch open for startup recovery', async () => {
    const coordinator = makeCoordinator(db, {
      drain: () => new Promise<void>(() => {}),
      drainTimeoutMs: 10,
    })
    coordinator.open()
    const result = await coordinator.close()
    expect(result.closed).toBe(false)
    expect(getEpochState({ epochId: 'epoch-new-1' }, { getDrizzleDb: () => db })).toEqual({ state: 'open' })
  })

  test('recovery is a no-op when no stale epochs exist', () => {
    seedCounterRow(db, DAY2, 3)
    openEpoch({ epochId: 'epoch-fresh', startedAtMs: DAY2_EARLY }, { getDrizzleDb: () => db })
    const coordinator = makeCoordinator(db)
    coordinator.recoverStaleEpochs()
    expect(getEpochState({ epochId: 'epoch-fresh' }, { getDrizzleDb: () => db })).toEqual({ state: 'open' })
    expect(counterRowFor(db, DAY2).reconciliationStatus).toBe('complete_epoch')
  })
})
