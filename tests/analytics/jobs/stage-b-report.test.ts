// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { llmCompletedFixture } from '../../../src/analytics/contracts.js'
import {
  collectStageBDay,
  formatDaySummary,
  formatWindowLogRow,
  parseStageBArgs,
} from '../../../src/analytics/jobs/stage-b-report.js'
import { insertCanonicalEventRow } from '../../../src/analytics/storage/event-store.js'
import {
  analyticsDeliveries,
  analyticsEpochSourceCounters,
  analyticsNormalizationRejections,
  analyticsProcessEpochs,
  analyticsSinks,
  analyticsSnapshotPublications,
} from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = '2026-08-05'
const DAY_START_MS = Date.parse(`${DAY}T00:00:00.000Z`)
const DAY_MS = 86_400_000
// one hour after day close
const NOW_MS = DAY_START_MS + DAY_MS + 3_600_000

let db: Db

beforeEach(async () => {
  mockLogger()
  db = await setupTestDb()
})

const deps = (): { getDrizzleDb: () => Db } => ({ getDrizzleDb: (): Db => db })

const ensureEpoch = (epochId: string): void => {
  db.insert(analyticsProcessEpochs)
    .values({ epochId, state: 'open', startedAtMs: DAY_START_MS })
    .onConflictDoNothing({ target: analyticsProcessEpochs.epochId })
    .run()
}

const insertStaleEpochTouchingDay = (): void => {
  db.insert(analyticsProcessEpochs)
    .values({
      epochId: 'epoch-stale-1',
      state: 'stale_open',
      startedAtMs: DAY_START_MS + 1_000,
      closedAtMs: null,
      staleMarkedAtMs: DAY_START_MS + 2_000,
    })
    .run()
}

const insertRejection = (reason: string, count: number): void => {
  db.insert(analyticsNormalizationRejections).values({ utcDay: DAY, sourceEventType: 'llm', reason, count }).run()
}

const insertOverflowCounter = (value: number): void => {
  ensureEpoch('epoch-1')
  db.insert(analyticsEpochSourceCounters)
    .values({ epochId: 'epoch-1', utcDay: DAY, sourceFamily: 'chat', disposition: 'controlled_overflow', value })
    .run()
}

const insertEventAt = (expiresAtMs: number): string => {
  ensureEpoch('epoch-1')
  const event = {
    ...llmCompletedFixture,
    event: { ...llmCompletedFixture.event, occurred_at_ms: DAY_START_MS + 500 },
  }
  return insertCanonicalEventRow(db, {
    storageGeneration: 'gen-1',
    processEpochId: 'epoch-1',
    sourceRefKey: event.event.id,
    sourceKind: 'live',
    expiresAtMs,
    event,
  }).eventId
}

const insertPublication = (publishedAtMs: number): void => {
  db.insert(analyticsSnapshotPublications)
    .values({
      snapshotId: 'snap-1',
      storageGeneration: 'gen-1',
      transitionRunId: null,
      pathHash: 'ph',
      sourceHighWater: 'hw',
      state: 'published',
      publishedAt: publishedAtMs,
      invalidatedAt: null,
    })
    .run()
}

const insertSink = (sinkVersionId: string): void => {
  db.insert(analyticsSinks)
    .values({
      sinkVersionId,
      logicalSinkId: `logical-${sinkVersionId}`,
      version: 1,
      kind: 'webhook',
      state: 'disabled',
      payloadSchemaVersion: 1,
      egressMode: 'pseudonymous',
      endpointCiphertext: 'ct-endpoint',
      secretCiphertext: 'ct-secret',
      configFingerprint: `fp-${sinkVersionId}`,
      createdAtMs: NOW_MS,
    })
    .run()
}

describe('collectStageBDay', () => {
  test('a clean complete day is eligible with zeroed counters', () => {
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.eligible).toBe(true)
    expect(report.reason).toBe('ok')
    expect(report.reconciliation).toBe('reconciled')
    expect(report.restartGap).toBe(false)
    expect(report.rejects.total).toBe(0)
    expect(report.overflow).toBe(0)
    expect(report.expiry.ok).toBe(true)
    expect(report.delivery).toEqual({ sending: 0, ambiguous: 0 })
  })

  test('a stale-open epoch intersecting the day marks it a restart gap', () => {
    insertStaleEpochTouchingDay()
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.eligible).toBe(false)
    expect(report.reason).toBe('restart_gap')
    expect(report.restartGap).toBe(true)
  })

  test('an incomplete (still running) day is ineligible', () => {
    const report = collectStageBDay({ day: DAY, nowMs: DAY_START_MS + 1_000 }, deps())
    expect(report.eligible).toBe(false)
    expect(report.reason).toBe('incomplete_day')
  })

  test('rejections and overflow counters are totaled by reason', () => {
    insertRejection('unknown_enum', 2)
    insertRejection('props_out_of_domain', 1)
    insertOverflowCounter(3)
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.rejects.total).toBe(3)
    expect(report.rejects.byReason).toEqual({ unknown_enum: 2, props_out_of_domain: 1 })
    expect(report.overflow).toBe(3)
  })

  test('an expired-but-retained event row fails the expiry check', () => {
    insertEventAt(NOW_MS - 1)
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.expiry.ok).toBe(false)
    expect(report.expiry.expiredRows).toBe(1)
    expect(report.expiry.earliestDeadlineMs).toBe(NOW_MS - 1)
  })

  test('snapshot freshness honors the two-hour SLO', () => {
    insertPublication(NOW_MS - 30 * 60_000)
    expect(collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps()).snapshot.fresh).toBe(true)
  })

  test('a stale publication is not fresh', () => {
    insertPublication(NOW_MS - 5 * 3_600_000)
    expect(collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps()).snapshot.fresh).toBe(false)
  })

  test('sending and ambiguous delivery rows are counted across both ledgers', () => {
    insertSink('sv-1')
    const eventId = insertEventAt(NOW_MS + DAY_MS)
    db.insert(analyticsDeliveries)
      .values({
        eventId,
        sinkVersionId: 'sv-1',
        state: 'sending',
        attempts: 1,
        nextAttemptAtMs: NOW_MS,
        payloadSchemaVersion: 1,
        grantKey: 'g1',
        grantKeyVersion: 'v1',
        grantGeneration: 1,
        leaseUntilMs: NOW_MS + 60_000,
      })
      .run()
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.delivery.sending).toBe(1)
    expect(report.delivery.ambiguous).toBe(0)
  })

  test('collection performs zero writes', () => {
    // seed before the write-blocking triggers exist
    insertRejection('unknown_enum', 1)
    for (const table of [
      'analytics_events',
      'analytics_process_epochs',
      'analytics_normalization_rejections',
      'analytics_epoch_source_counters',
      'analytics_snapshot_publications',
      'analytics_deliveries',
      'analytics_aggregate_deliveries',
    ]) {
      db.$client.run(
        `CREATE TEMP TRIGGER no_write_insert_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'write'); END`,
      )
      db.$client.run(
        `CREATE TEMP TRIGGER no_write_update_${table} BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'write'); END`,
      )
      db.$client.run(
        `CREATE TEMP TRIGGER no_write_delete_${table} BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'write'); END`,
      )
    }
    expect(() => collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())).not.toThrow()
  })
})

describe('formatters', () => {
  test('window log row matches the evidence doc column contract', () => {
    insertRejection('unknown_enum', 2)
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(formatWindowLogRow(report)).toBe(`| ${DAY} | true | — | none | 0 | 2 (unknown_enum=2) | 0 | ok | — |`)
    expect(formatDaySummary(report)).toContain(`day=${DAY} eligible=true reconciliation=reconciled`)
  })
})

describe('parseStageBArgs', () => {
  test('parses all flags', () => {
    expect(parseStageBArgs(['--day', DAY, '--db', '/tmp/x.db', '--log', '/tmp/x.jsonl'])).toEqual({
      day: DAY,
      dbPath: '/tmp/x.db',
      logPath: '/tmp/x.jsonl',
      assess: false,
    })
    expect(parseStageBArgs(['--assess', '--log', '/tmp/x.jsonl'])).toEqual({
      day: null,
      dbPath: null,
      logPath: '/tmp/x.jsonl',
      assess: true,
    })
    expect(parseStageBArgs([])).toEqual({ day: null, dbPath: null, logPath: null, assess: false })
    expect(() => parseStageBArgs(['--nope'])).toThrow('unknown argument')
  })
})
