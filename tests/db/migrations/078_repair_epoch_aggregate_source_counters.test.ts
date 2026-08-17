// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runReconciliation } from '../../../src/analytics/jobs/reconcile.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import migration078 from '../../../src/db/migrations/078_repair_epoch_aggregate_source_counters.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type SourceCounterRow = typeof schema.analyticsEpochSourceCounters.$inferSelect

describe('migration 078: repair epoch aggregate source counters', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  const seedClosedEpoch = (epochId: string): void => {
    getDrizzleDb()
      .insert(schema.analyticsProcessEpochs)
      .values({ epochId, state: 'closed', startedAtMs: 1000, closedAtMs: 2000 })
      .run()
  }

  const seedContribution = (epochId: string, cellKey: string, kind: 'counter' | 'histogram', units: number): void => {
    getDrizzleDb()
      .insert(schema.analyticsAggregateEpochContributions)
      .values({
        epochId,
        aggregateCellKey: cellKey,
        measureKind: kind,
        counterDelta: kind === 'counter' ? units : 0,
        sampleCountDelta: kind === 'histogram' ? units : 0,
        sumDelta: 0,
        fixedBucketCountsDeltaJson: '[]',
      })
      .run()
  }

  const countersByKey = (): Record<string, number> =>
    Object.fromEntries(
      getDrizzleDb()
        .select()
        .from(schema.analyticsEpochSourceCounters)
        .all()
        .map((row: SourceCounterRow) => [`${row.utcDay}|${row.disposition}`, row.value]),
    )

  test('rebuilds missing opportunity and aggregate_only counters from contribution cell keys per day', () => {
    seedClosedEpoch('epoch-poisoned')
    seedContribution('epoch-poisoned', '2026-01-01|dims|llm_completed', 'counter', 2)
    seedContribution('epoch-poisoned', '2026-01-01|dims|tool_duration_ms', 'histogram', 1)
    seedContribution('epoch-poisoned', '2026-01-02|dims|llm_completed', 'counter', 1)

    migration078.up(getDrizzleDb().$client)

    expect(countersByKey()).toEqual({
      '2026-01-01|opportunity': 3,
      '2026-01-01|aggregate_only': 3,
      '2026-01-02|opportunity': 1,
      '2026-01-02|aggregate_only': 1,
    })
  })

  test('a repaired closed epoch reconciles to zero', () => {
    seedClosedEpoch('epoch-poisoned')
    seedContribution('epoch-poisoned', '2026-01-01|dims|llm_completed', 'counter', 1)
    const deps = { getDrizzleDb }

    const before = runReconciliation({ nowMs: 86_400_000_000, apply: false }, deps)
    expect(before.liveEpochs.find((row) => row.epochId === 'epoch-poisoned')?.status).toBe('delta')

    migration078.up(getDrizzleDb().$client)

    const after = runReconciliation({ nowMs: 86_400_000_000, apply: false }, deps)
    const epoch = after.liveEpochs.find((row) => row.epochId === 'epoch-poisoned')
    expect(epoch?.status).toBe('publishable')
    expect(epoch?.unexplainedDelta).toBe(0)
  })

  test('idempotent: a second run does not double-add', () => {
    seedClosedEpoch('epoch-poisoned')
    seedContribution('epoch-poisoned', '2026-01-01|dims|llm_completed', 'counter', 2)

    migration078.up(getDrizzleDb().$client)
    const first = countersByKey()
    migration078.up(getDrizzleDb().$client)
    expect(countersByKey()).toEqual(first)
  })

  test('leaves epochs with intact counters untouched', () => {
    seedClosedEpoch('epoch-healthy')
    seedContribution('epoch-healthy', '2026-01-01|dims|llm_completed', 'counter', 1)
    getDrizzleDb()
      .insert(schema.analyticsEpochSourceCounters)
      .values({
        epochId: 'epoch-healthy',
        utcDay: '2026-01-01',
        sourceFamily: 'chat',
        disposition: 'opportunity',
        value: 1,
      })
      .run()
    getDrizzleDb()
      .insert(schema.analyticsEpochSourceCounters)
      .values({
        epochId: 'epoch-healthy',
        utcDay: '2026-01-01',
        sourceFamily: 'chat',
        disposition: 'aggregate_only',
        value: 1,
      })
      .run()

    migration078.up(getDrizzleDb().$client)

    expect(countersByKey()).toEqual({ '2026-01-01|opportunity': 1, '2026-01-01|aggregate_only': 1 })
  })
})
