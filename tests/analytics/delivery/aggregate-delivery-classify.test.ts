// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import {
  classifyAggregateDelivery,
  reconcileAggregateAmbiguous,
  recoverOrphanedAggregateSends,
} from '../../../src/analytics/delivery/aggregate-delivery-classify.js'
import {
  leaseAggregateDeliveries,
  markAggregateSendStarted,
} from '../../../src/analytics/delivery/aggregate-delivery-store.js'
import type { AggregateDeliveryStoreDeps } from '../../../src/analytics/delivery/aggregate-delivery-store.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import {
  analyticsAggregateDeliveries,
  analyticsAggregateReleases,
  analyticsRekeyRuns,
  analyticsSinks,
} from '../../../src/db/schema.js'
import type { AnalyticsAggregateDeliveryRow } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1_800_000_000_000
const UTC_DAY = new Date(NOW).toISOString().slice(0, 10)
const SINK = 'sv-agg'
const RELEASE = 'agg-release:t1'

const insertSinkAndRelease = (db: Db, utcDay = UTC_DAY): void => {
  db.insert(analyticsSinks)
    .values({
      sinkVersionId: SINK,
      logicalSinkId: 'logical-agg',
      version: 1,
      kind: 'webhook',
      state: 'enabled',
      payloadSchemaVersion: 1,
      egressMode: 'aggregate',
      endpointCiphertext: 'ct-endpoint',
      secretCiphertext: 'ct-secret',
      configFingerprint: 'fp-agg',
      createdAtMs: NOW,
    })
    .onConflictDoNothing()
    .run()
  db.insert(analyticsAggregateReleases)
    .values({
      releaseId: RELEASE,
      releaseHash: 'h'.repeat(64),
      payloadJson: `{"utc_day":"${utcDay}","cells":[]}`,
      payloadSchemaVersion: 1,
      createdAtMs: NOW,
    })
    .run()
}

const insertDelivery = (db: Db, state = 'pending', attempts = 0): void => {
  db.insert(analyticsAggregateDeliveries)
    .values({
      releaseId: RELEASE,
      sinkVersionId: SINK,
      state,
      attempts,
      nextAttemptAtMs: NOW,
      payloadSchemaVersion: 1,
    })
    .run()
}

const row = (db: Db): AnalyticsAggregateDeliveryRow | undefined =>
  db
    .select()
    .from(analyticsAggregateDeliveries)
    .where(
      and(eq(analyticsAggregateDeliveries.releaseId, RELEASE), eq(analyticsAggregateDeliveries.sinkVersionId, SINK)),
    )
    .get()

describe('aggregate delivery classification', () => {
  let db: Db
  let deps: AggregateDeliveryStoreDeps

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('a leased send classifies delivered with only a receipt hash persisted', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 10_000, limit: 10, maxAttempts: 8 }, deps)
    expect(markAggregateSendStarted({ releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW }, deps)).toBe('started')
    expect(
      classifyAggregateDelivery(
        {
          releaseId: RELEASE,
          sinkVersionId: SINK,
          nowMs: NOW + 1,
          outcome: 'delivered',
          remoteReceiptHash: 'r'.repeat(64),
        },
        deps,
      ),
    ).toBe('classified')
    expect(row(db)).toMatchObject({ state: 'delivered', deliveredAtMs: NOW + 1, remoteReceiptHash: 'r'.repeat(64) })
  })

  test('an admitted in-flight send classifies across the held cutover fence', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    const fence = createRekeyCutoverFence({ getDrizzleDb: (): Db => db })
    const fencedDeps: AggregateDeliveryStoreDeps = { getDrizzleDb: (): Db => db, fence }
    leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 10_000, limit: 10, maxAttempts: 8 }, fencedDeps)
    expect(markAggregateSendStarted({ releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW }, fencedDeps)).toBe(
      'started',
    )

    db.insert(analyticsRekeyRuns)
      .values({
        runId: 'run-1',
        sourceGeneration: 'gen-1',
        targetGeneration: 'gen-2',
        fromVersions: JSON.stringify(['v1']),
        toVersions: JSON.stringify(['v2']),
        sourceHighWater: 'hw-1',
        phase: 'cutover',
        subphase: null,
        planHash: 'plan-1',
        status: 'running',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run()
    expect(fence.isFenceHeld()).toBe(true)

    expect(
      classifyAggregateDelivery(
        {
          releaseId: RELEASE,
          sinkVersionId: SINK,
          nowMs: NOW + 1,
          outcome: 'delivered',
          remoteReceiptHash: 'r'.repeat(64),
        },
        fencedDeps,
      ),
    ).toBe('classified')
    expect(row(db)).toMatchObject({ state: 'delivered', deliveredAtMs: NOW + 1, remoteReceiptHash: 'r'.repeat(64) })
  })

  test('classification without a live sending row is refused', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    expect(
      classifyAggregateDelivery(
        { releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW, outcome: 'dead', errorClass: 'http_4xx' },
        deps,
      ),
    ).toBe('not_sending')
    expect(row(db)).toMatchObject({ state: 'pending' })
  })

  test('an orphaned sending row becomes non-retried ambiguous and reconciles only explicitly', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 8 }, deps)
    markAggregateSendStarted({ releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW }, deps)
    expect(recoverOrphanedAggregateSends({ nowMs: NOW + 1_000 }, deps)).toEqual({ moved: 1 })
    expect(row(db)).toMatchObject({ state: 'ambiguous' })
    expect(
      leaseAggregateDeliveries({ nowMs: NOW + 100_000, leaseMs: 100, limit: 10, maxAttempts: 8 }, deps),
    ).toHaveLength(0)
    expect(
      reconcileAggregateAmbiguous(
        { releaseId: RELEASE, sinkVersionId: SINK, outcome: 'dead', errorClass: 'unknown', nowMs: NOW + 2_000 },
        deps,
      ),
    ).toBe('resolved')
    expect(row(db)).toMatchObject({ state: 'dead', lastErrorClass: 'unknown' })
  })

  test('reconciling a delivered outcome keeps only the receipt hash', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 8 }, deps)
    markAggregateSendStarted({ releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW }, deps)
    recoverOrphanedAggregateSends({ nowMs: NOW + 1_000 }, deps)
    expect(
      reconcileAggregateAmbiguous(
        {
          releaseId: RELEASE,
          sinkVersionId: SINK,
          outcome: 'delivered',
          remoteReceiptHash: 'q'.repeat(64),
          nowMs: NOW + 2_000,
        },
        deps,
      ),
    ).toBe('resolved')
    expect(row(db)).toMatchObject({
      state: 'delivered',
      deliveredAtMs: NOW + 2_000,
      remoteReceiptHash: 'q'.repeat(64),
    })
  })

  test('reconciling a non-ambiguous row changes nothing', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    expect(
      reconcileAggregateAmbiguous(
        { releaseId: RELEASE, sinkVersionId: SINK, outcome: 'dead', errorClass: 'unknown', nowMs: NOW },
        deps,
      ),
    ).toBe('not_ambiguous')
    expect(row(db)).toMatchObject({ state: 'pending' })
  })
})
