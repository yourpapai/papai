// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { AnalyticsAggregateV1Schema } from '../../../src/analytics/aggregate-contract.js'
import type { AnalyticsAggregateV1 } from '../../../src/analytics/aggregate-contract.js'
import {
  AGGREGATE_RELEASE_SCHEMA_VERSION,
  buildDailyAggregateRelease,
} from '../../../src/analytics/delivery/aggregate-release.js'
import type { BuildReleaseResult } from '../../../src/analytics/delivery/aggregate-release.js'
import { EXTERNAL_ACTOR_THRESHOLD } from '../../../src/analytics/delivery/release-suppression.js'
import type { CellDimensions } from '../../../src/analytics/delivery/release-suppression.js'
import {
  analyticsAggregateDeliveries,
  analyticsAggregateReleases,
  analyticsDailyCounters,
  analyticsDailyHistograms,
  analyticsSinks,
} from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = '2026-07-20'
const NOW = Date.UTC(2026, 6, 21, 1, 0, 0)
const SINK = 'agg-sink:v1'

const dims = (
  platform = 'all',
  contextType = 'all',
  actorRole = 'all',
  taskProvider = 'all',
  appVersion = 'all',
): CellDimensions => ({ platform, contextType, actorRole, taskProvider, appVersion })

const insertSink = (db: Db): void => {
  db.insert(analyticsSinks)
    .values({
      sinkVersionId: SINK,
      logicalSinkId: 'agg-sink',
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
    .run()
}

type CounterOverrides = Readonly<{
  utcDay?: string
  metric?: string
  value?: number
  dimensions?: CellDimensions
  finalized?: boolean
  partialDay?: boolean
  reconciliationStatus?: string
  contributorBasis?: string
  contributorCount?: number | null
}>

const insertCounter = (db: Db, overrides: CounterOverrides = {}): void => {
  const d = overrides.dimensions ?? dims()
  db.insert(analyticsDailyCounters)
    .values({
      utcDay: overrides.utcDay ?? DAY,
      definitionVersion: 1,
      platform: d.platform,
      contextType: d.contextType,
      actorRole: d.actorRole,
      taskProvider: d.taskProvider,
      appVersion: d.appVersion,
      metric: overrides.metric ?? 'turn_started',
      value: overrides.value ?? 25,
      finalized: overrides.finalized ?? true,
      partialDay: overrides.partialDay ?? false,
      restartGapDetected: (overrides.reconciliationStatus ?? 'complete_epoch') === 'unreconciled_restart_gap',
      lateEventCount: 0,
      reconciliationStatus: overrides.reconciliationStatus ?? 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: overrides.contributorBasis ?? 'eligible_actor',
      contributorCount: overrides.contributorCount === undefined ? 12 : overrides.contributorCount,
      threshold: null,
    })
    .run()
}

const insertHistogram = (
  db: Db,
  overrides: Readonly<{ metric?: string; sampleCount?: number; contributorCount?: number | null }> = {},
): void => {
  db.insert(analyticsDailyHistograms)
    .values({
      utcDay: DAY,
      definitionVersion: 1,
      platform: 'all',
      contextType: 'all',
      actorRole: 'all',
      taskProvider: 'all',
      appVersion: 'all',
      metric: overrides.metric ?? 'turn_duration_ms',
      fixedBucketsJson: JSON.stringify([0, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 300000]),
      countsJson: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
      sum: 123456,
      sampleCount: overrides.sampleCount ?? 66,
      finalized: true,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'eligible_actor',
      contributorCount: overrides.contributorCount === undefined ? 15 : overrides.contributorCount,
      threshold: null,
    })
    .run()
}

// Parse/narrowing helpers at module scope — no-conditional-in-test forbids
// branch logic (if, ??, &&) inside test bodies.
const parsePayloadCells = (payloadJson: string): readonly unknown[] => {
  const parsed: unknown = JSON.parse(payloadJson)
  if (typeof parsed !== 'object' || parsed === null || !('cells' in parsed)) {
    throw new Error('unexpected release payload shape')
  }
  const { cells } = parsed
  if (!Array.isArray(cells)) throw new Error('release payload cells must be an array')
  return cells
}

const releasedCells = (payloadJson: string): readonly AnalyticsAggregateV1[] =>
  parsePayloadCells(payloadJson).map((c) => AnalyticsAggregateV1Schema.parse(c))

const readRelease = (db: Db): { releaseId: string; releaseHash: string; payloadJson: string } => {
  const rows = db.select().from(analyticsAggregateReleases).all()
  if (rows.length !== 1) throw new Error(`expected exactly one release row, got ${rows.length}`)
  const row = rows[0]
  if (row === undefined) throw new Error('release row missing')
  return row
}

const requireReleased = (result: BuildReleaseResult): Extract<BuildReleaseResult, { status: 'released' }> => {
  if (result.status !== 'released') throw new Error(`expected released, got ${result.status}`)
  return result
}

const requireAlreadyReleased = (
  result: BuildReleaseResult,
): Extract<BuildReleaseResult, { status: 'already_released' }> => {
  if (result.status !== 'already_released') throw new Error(`expected already_released, got ${result.status}`)
  return result
}

describe('buildDailyAggregateRelease', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    insertSink(db)
  })

  const build = (): ReturnType<typeof buildDailyAggregateRelease> =>
    buildDailyAggregateRelease({ utcDay: DAY, sinkVersionId: SINK, nowMs: NOW }, { getDrizzleDb: () => db })

  test('returns empty when no rollup rows exist for the day', () => {
    expect(build()).toEqual({ status: 'empty' })
  })

  test('an incomplete day is never released and rows stay unassessed', () => {
    insertCounter(db, { finalized: false })
    insertCounter(db, { metric: 'turn_completed', partialDay: true })
    expect(build()).toEqual({ status: 'day_not_complete' })
    const rows = db.select().from(analyticsDailyCounters).all()
    expect(rows.every((row) => row.disclosureScope === 'local_only')).toBe(true)
    expect(db.select().from(analyticsAggregateReleases).all()).toHaveLength(0)
  })

  test('releases a fully eligible total plus one-way children with pinned schema and threshold', () => {
    insertCounter(db, { value: 200, contributorCount: 80 })
    insertCounter(db, { dimensions: dims('telegram'), value: 100, contributorCount: 40 })
    insertCounter(db, { dimensions: dims('mattermost'), value: 100, contributorCount: 40 })
    const result = requireReleased(build())
    expect(result.cellCount).toBe(3)

    const release = readRelease(db)
    expect(release.releaseId).toBe(result.releaseId)
    expect(release.releaseHash).toBe(result.releaseHash)
    const cells = releasedCells(release.payloadJson)
    expect(cells).toHaveLength(3)
    for (const c of cells) {
      expect(c.schema).toEqual({ name: 'papai.analytics.aggregate', version: 1 })
      expect(c.bucket).toEqual({ utc_day: DAY, definition_version: 1, finalized: true })
      expect(c.dimensions.app_version).toBe('all')
      expect(c.disclosure.scope).toBe('external_eligible')
      expect(c.disclosure.threshold).toBe(EXTERNAL_ACTOR_THRESHOLD)
      expect(c.quality.reconciliation).toBe('complete_epoch')
    }

    const rows = db.select().from(analyticsDailyCounters).all()
    expect(rows.every((row) => row.disclosureScope === 'external_eligible')).toBe(true)
    expect(rows.every((row) => row.threshold === 10)).toBe(true)

    const deliveries = db.select().from(analyticsAggregateDeliveries).all()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      releaseId: result.releaseId,
      sinkVersionId: SINK,
      state: 'pending',
      attempts: 0,
      payloadSchemaVersion: AGGREGATE_RELEASE_SCHEMA_VERSION,
    })
  })

  test('actor-sensitive cells with 9 contributors are suppressed; 10 are released', () => {
    insertCounter(db, { value: 500, contributorCount: 200 })
    insertCounter(db, { dimensions: dims('all', 'dm'), value: 300, contributorCount: 9 })
    insertCounter(db, { dimensions: dims('all', 'none'), value: 100, contributorCount: 8 })
    insertCounter(db, { dimensions: dims('all', 'group'), value: 200, contributorCount: 10 })
    const result = build()
    expect(result.status).toBe('released')
    const cells = releasedCells(readRelease(db).payloadJson)
    const contextTypes = cells.map((c) => c.dimensions.context_type).sort()
    expect(contextTypes).toEqual(['all', 'group'])
  })

  test('guest cells below 10 turns or 10 contexts are suppressed; 10/10 is released', () => {
    insertCounter(db, { metric: 'guest_turn', value: 100, contributorBasis: 'context', contributorCount: 50 })
    insertCounter(db, {
      metric: 'guest_turn',
      dimensions: dims('all', 'dm'),
      value: 9,
      contributorBasis: 'context',
      contributorCount: 15,
    })
    insertCounter(db, {
      metric: 'guest_turn',
      dimensions: dims('all', 'group'),
      value: 12,
      contributorBasis: 'context',
      contributorCount: 9,
    })
    insertCounter(db, {
      metric: 'guest_turn',
      dimensions: dims('all', 'none'),
      value: 12,
      contributorBasis: 'context',
      contributorCount: 12,
    })
    const result = build()
    expect(result.status).toBe('released')
    const cells = releasedCells(readRelease(db).payloadJson).filter((c) => c.measure.metric === 'guest_turn')
    // 9-turns and 9-contexts children are primary suppressed (2 suppressed, none releasable
    // beyond the 10/10 child): the releasable 10/10 child survives alongside the total.
    const contextTypes = cells.map((c) => c.dimensions.context_type).sort()
    expect(contextTypes).toEqual(['all', 'none'])
  })

  test('unavailable contributor count and restart-gap cells are suppressed and marked', () => {
    insertCounter(db, { value: 100, contributorCount: 50 })
    insertCounter(db, { dimensions: dims('telegram'), value: 60, contributorCount: null })
    insertCounter(db, {
      dimensions: dims('mattermost'),
      value: 40,
      contributorCount: 30,
      reconciliationStatus: 'unreconciled_restart_gap',
    })
    const result = build()
    expect(result.status).toBe('released')
    const cells = releasedCells(readRelease(db).payloadJson)
    expect(cells).toHaveLength(1)
    expect(cells[0]?.dimensions.platform).toBe('all')
    const rows = db.select().from(analyticsDailyCounters).all()
    const byPlatform = new Map(rows.map((row) => [row.platform, row]))
    expect(byPlatform.get('telegram')?.disclosureScope).toBe('suppressed')
    expect(byPlatform.get('mattermost')?.disclosureScope).toBe('suppressed')
  })

  test('off-lattice and unassessed cells are never released', () => {
    insertCounter(db, { value: 500, contributorCount: 200 })
    insertCounter(db, { dimensions: dims('telegram', 'dm'), value: 400, contributorCount: 150 })
    insertCounter(db, { dimensions: dims('all', 'all', 'all', 'all', '6.10.0'), value: 300, contributorCount: 120 })
    const result = build()
    expect(result.status).toBe('released')
    const cells = releasedCells(readRelease(db).payloadJson)
    expect(cells).toHaveLength(1)
    expect(cells[0]?.dimensions).toEqual({
      platform: 'all',
      context_type: 'all',
      actor_role: 'all',
      task_provider: 'all',
      app_version: 'all',
    })
  })

  test('histogram cells release with fixed buckets and strict measure shape', () => {
    insertHistogram(db)
    const result = build()
    expect(result.status).toBe('released')
    const cells = releasedCells(readRelease(db).payloadJson)
    expect(cells).toHaveLength(1)
    expect(cells[0]?.measure).toEqual({
      kind: 'histogram',
      metric: 'turn_duration_ms',
      fixed_buckets: [0, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 300000],
      counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      sum: 123456,
      sample_count: 66,
    })
  })

  test('release build is deterministic: same input yields the same hash and a second run is idempotent', () => {
    insertCounter(db, { value: 200, contributorCount: 80 })
    insertCounter(db, { dimensions: dims('telegram'), value: 100, contributorCount: 40 })
    const first = requireReleased(build())
    const second = requireAlreadyReleased(build())
    expect(second.releaseId).toBe(first.releaseId)
    expect(second.releaseHash).toBe(first.releaseHash)
    expect(db.select().from(analyticsAggregateReleases).all()).toHaveLength(1)
    expect(db.select().from(analyticsAggregateDeliveries).all()).toHaveLength(1)
  })

  test('suppression is unrecoverable through totals, siblings, one-way filters, or cross-filters', () => {
    insertCounter(db, { value: 1000, contributorCount: 400 })
    insertCounter(db, { dimensions: dims('telegram'), value: 31337, contributorCount: 5 })
    insertCounter(db, { dimensions: dims('mattermost'), value: 250, contributorCount: 20 })
    insertCounter(db, { dimensions: dims('discord'), value: 400, contributorCount: 25 })
    insertCounter(db, { dimensions: dims('kontur-talk'), value: 500, contributorCount: 30 })
    insertCounter(db, { dimensions: dims('all', 'dm'), value: 600, contributorCount: 200 })
    insertCounter(db, { dimensions: dims('all', 'group'), value: 400, contributorCount: 200 })

    const result = build()
    expect(result.status).toBe('released')
    const release = readRelease(db)
    const cells = releasedCells(release.payloadJson)

    // The primary-suppressed telegram child and the complementary-suppressed
    // smallest sibling (mattermost) are both absent; the parent total survives
    // because two hidden children cannot be separated through it.
    const platforms = [...new Set(cells.map((c) => c.dimensions.platform))].sort()
    expect(platforms).toEqual(['all', 'discord', 'kontur-talk'])
    expect(release.payloadJson).not.toContain('31337')

    // Every released cell is on the frozen one-way lattice; no cross-filter exists.
    for (const c of cells) {
      const varying = [
        c.dimensions.platform,
        c.dimensions.context_type,
        c.dimensions.actor_role,
        c.dimensions.task_provider,
      ].filter((value) => value !== 'all')
      expect(varying.length).toBeLessThanOrEqual(1)
      expect(c.dimensions.app_version).toBe('all')
    }

    // Recovery through the total is impossible: at least two children are hidden.
    const hidden = ['telegram', 'mattermost']
    expect(hidden.every((platform) => !platforms.some((releasedPlatform) => releasedPlatform === platform))).toBe(true)
  })
})
