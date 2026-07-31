// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import {
  leaseAggregateDeliveries,
  markAggregateSendStarted,
} from '../../../src/analytics/delivery/aggregate-delivery-store.js'
import type { AggregateDeliveryStoreDeps } from '../../../src/analytics/delivery/aggregate-delivery-store.js'
import { analyticsAggregateDeliveries, analyticsAggregateReleases, analyticsSinks } from '../../../src/db/schema.js'
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

describe('aggregate delivery store', () => {
  let db: Db
  let deps: AggregateDeliveryStoreDeps

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('leases a due pending row and starts the send durably', () => {
    insertSinkAndRelease(db)
    insertDelivery(db)
    const leased = leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 10_000, limit: 10, maxAttempts: 8 }, deps)
    expect(leased).toHaveLength(1)
    expect(leased[0]).toMatchObject({
      releaseId: RELEASE,
      sinkVersionId: SINK,
      attempts: 1,
      payloadJson: `{"utc_day":"${UTC_DAY}","cells":[]}`,
    })

    expect(markAggregateSendStarted({ releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW }, deps)).toBe('started')
    expect(row(db)).toMatchObject({ state: 'sending', sendStartedAtMs: NOW })
  })

  test('a pending row past the release deadline is cancelled at lease without a send', () => {
    insertSinkAndRelease(db, '2020-01-01')
    insertDelivery(db)
    expect(leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 10_000, limit: 10, maxAttempts: 8 }, deps)).toHaveLength(0)
    expect(row(db)).toMatchObject({ state: 'cancelled' })
  })

  test('send-start on an expired release cancels without a network call', () => {
    insertSinkAndRelease(db, '2020-01-01')
    insertDelivery(db)
    db.update(analyticsAggregateDeliveries)
      .set({ state: 'leased', leaseUntilMs: NOW + 10_000, attempts: 1 })
      .run()
    expect(markAggregateSendStarted({ releaseId: RELEASE, sinkVersionId: SINK, nowMs: NOW }, deps)).toBe(
      'release_expired',
    )
    expect(row(db)).toMatchObject({ state: 'cancelled' })
  })

  test('exhausted attempts mark the row dead at the next lease scan', () => {
    insertSinkAndRelease(db)
    insertDelivery(db, 'pending', 8)
    leaseAggregateDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 8 }, deps)
    expect(row(db)).toMatchObject({ state: 'dead' })
  })
})
