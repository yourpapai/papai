// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { FIXED_HISTOGRAM_BUCKETS_MS } from '../../../src/analytics/aggregate-contract.js'
import { mergeHistogram } from '../../../src/analytics/storage/aggregate-histogram-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  commonQuality,
  createTestEpoch,
  getEpochContributionRow,
  getHistogramRow,
  TEST_EPOCH_ID,
  type Db,
} from '../storage-fixtures.js'

const assertDefined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a defined value')
  return value
}

describe('analytics histogram storage', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('histogram merge accepts matching fixed buckets and merges counts', () => {
    createTestEpoch(db)
    const key = {
      utcDay: '2026-01-01',
      definitionVersion: 1,
      platform: 'telegram' as const,
      contextType: 'dm' as const,
      actorRole: 'admin' as const,
      taskProvider: 'none' as const,
      appVersion: '6.10.0',
      metric: 'time_to_first_token_ms',
      epochId: TEST_EPOCH_ID,
    }
    const buckets = FIXED_HISTOGRAM_BUCKETS_MS
    const counts1 = new Array(buckets.length).fill(0)
    counts1[3] = 1
    const counts2 = new Array(buckets.length).fill(0)
    counts2[5] = 1

    mergeHistogram(
      { ...key, fixedBuckets: buckets, counts: counts1, sum: 500, sampleCount: 1, ...commonQuality },
      { getDrizzleDb: () => db },
    )
    mergeHistogram(
      { ...key, fixedBuckets: buckets, counts: counts2, sum: 2500, sampleCount: 1, ...commonQuality },
      { getDrizzleDb: () => db },
    )

    const row = getHistogramRow(db, key.utcDay, key.metric)
    const definedRow = assertDefined(row)
    expect(JSON.parse(definedRow.countsJson)).toEqual([0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0])
    expect(definedRow.sum).toBe(3000)
    expect(definedRow.sampleCount).toBe(2)
  })

  test('histogram merge rejects a mismatched bucket layout', () => {
    createTestEpoch(db)
    const key = {
      utcDay: '2026-01-01',
      definitionVersion: 1,
      platform: 'telegram' as const,
      contextType: 'dm' as const,
      actorRole: 'admin' as const,
      taskProvider: 'none' as const,
      appVersion: '6.10.0',
      metric: 'time_to_first_token_ms',
      epochId: TEST_EPOCH_ID,
    }

    mergeHistogram(
      {
        ...key,
        fixedBuckets: FIXED_HISTOGRAM_BUCKETS_MS,
        counts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        sum: 0,
        sampleCount: 1,
        ...commonQuality,
      },
      { getDrizzleDb: () => db },
    )

    expect(() =>
      mergeHistogram(
        { ...key, fixedBuckets: [0, 100, 200], counts: [1, 0, 0], sum: 0, sampleCount: 1, ...commonQuality },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('histogram rows differing only by definitionVersion stay independent', () => {
    createTestEpoch(db)
    const base = {
      utcDay: '2026-01-01',
      platform: 'telegram' as const,
      contextType: 'dm' as const,
      actorRole: 'admin' as const,
      taskProvider: 'none' as const,
      appVersion: '6.10.0',
      metric: 'time_to_first_token_ms',
    }
    const buckets = FIXED_HISTOGRAM_BUCKETS_MS
    const counts1 = new Array(buckets.length).fill(0)
    counts1[3] = 1
    const counts2 = new Array(buckets.length).fill(0)
    counts2[5] = 1

    mergeHistogram(
      {
        ...base,
        definitionVersion: 1,
        fixedBuckets: buckets,
        counts: counts1,
        sum: 500,
        sampleCount: 1,
        ...commonQuality,
      },
      { getDrizzleDb: () => db },
    )
    mergeHistogram(
      {
        ...base,
        definitionVersion: 2,
        fixedBuckets: buckets,
        counts: counts2,
        sum: 700,
        sampleCount: 1,
        ...commonQuality,
      },
      { getDrizzleDb: () => db },
    )

    const rows = db
      .select()
      .from(schema.analyticsDailyHistograms)
      .where(
        and(
          eq(schema.analyticsDailyHistograms.utcDay, base.utcDay),
          eq(schema.analyticsDailyHistograms.metric, base.metric),
        ),
      )
      .all()
    expect(rows).toHaveLength(2)

    const row1 = rows.find((r) => r.definitionVersion === 1)
    const row2 = rows.find((r) => r.definitionVersion === 2)
    expect(row1).toBeDefined()
    expect(row2).toBeDefined()
    expect(JSON.parse(row1!.countsJson)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
    expect(row1!.sum).toBe(500)
    expect(JSON.parse(row2!.countsJson)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])
    expect(row2!.sum).toBe(700)
  })

  test('histogram epoch contributions to the same cell accumulate bucket counts', () => {
    createTestEpoch(db)
    const key = {
      utcDay: '2026-01-01',
      definitionVersion: 1,
      platform: 'telegram' as const,
      contextType: 'dm' as const,
      actorRole: 'admin' as const,
      taskProvider: 'none' as const,
      appVersion: '6.10.0',
      metric: 'time_to_first_token_ms',
      epochId: TEST_EPOCH_ID,
      aggregateCellKey: 'cell-histogram-001',
    }
    const buckets = FIXED_HISTOGRAM_BUCKETS_MS
    const counts1 = new Array(buckets.length).fill(0)
    counts1[3] = 1
    const counts2 = new Array(buckets.length).fill(0)
    counts2[5] = 1

    mergeHistogram(
      { ...key, fixedBuckets: buckets, counts: counts1, sum: 500, sampleCount: 1, ...commonQuality },
      { getDrizzleDb: () => db },
    )
    mergeHistogram(
      { ...key, fixedBuckets: buckets, counts: counts2, sum: 2500, sampleCount: 1, ...commonQuality },
      { getDrizzleDb: () => db },
    )

    const row = getEpochContributionRow(db, key.aggregateCellKey)
    expect(row).toBeDefined()
    expect(row?.sampleCountDelta).toBe(2)
    expect(row?.sumDelta).toBe(3000)
    expect(JSON.parse(row!.fixedBucketCountsDeltaJson)).toEqual([0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0])
  })
})
