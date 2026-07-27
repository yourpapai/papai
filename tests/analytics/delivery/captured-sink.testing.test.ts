// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  createCapturedSink,
  findCanaries,
  SYNTHETIC_SINK_TOKEN,
} from '../../../src/analytics/delivery/captured-sink.testing.js'
import type { CapturedEgressRequest } from '../../../src/analytics/delivery/captured-sink.testing.js'
import {
  assessSink,
  findProductionSink,
  listProductionSinks,
  OPENPANEL_ASSESSED_CAPABILITIES,
} from '../../../src/analytics/delivery/sink.js'
import { createTrackedLoggerMock, setupTestDb } from '../../utils/test-helpers.js'
import type { TrackedLoggerMock } from '../../utils/test-helpers.js'

// This suite scans analytics logs for canary leakage, so it mocks src/logger.js
// before any module under test is imported (delayed-import pattern: the
// analytics modules call logger.child at module evaluation).
const tracked: TrackedLoggerMock = createTrackedLoggerMock()

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1_800_000_000_000
const UTC_DAY = new Date(NOW - 86_400_000).toISOString().slice(0, 10)

const CANARIES = [
  'raw-user-778899',
  'raw-chat-445566',
  'raw-task-11223',
  'raw-turn-99887',
  'PROMPT-CANARY-7f3a9d',
  'USERNAME-CANARY-zx21',
  'TOKEN-CANARY-qw99',
  'RRULE-CANARY-rr5',
  'ERROR-CANARY-ee4',
] as const

const REAL_ENDPOINT = 'https://captured-sink.example.net/ingest'

// Narrowing helpers at module scope — no-conditional-in-test forbids branch
// logic (if, ??) inside test bodies.
const requireFirstRequest = (requests: readonly CapturedEgressRequest[]): CapturedEgressRequest => {
  const first = requests[0]
  if (first === undefined) throw new Error('expected a captured request')
  return first
}

type CellsPayload = Readonly<{ cells: unknown[] }>

const parseCellsPayload = (body: string): CellsPayload => {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== 'object' || parsed === null || !('cells' in parsed)) {
    throw new Error('unexpected egress payload shape')
  }
  const { cells } = parsed
  if (!Array.isArray(cells)) throw new Error('egress payload cells must be an array')
  return { cells }
}

describe('captured sink egress proof', () => {
  let db: Db

  beforeEach(async () => {
    process.env['INSTANCE_CONFIG_KEY'] = '9'.repeat(64)
    void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))
    tracked.clearCalls()
    db = await setupTestDb()
  })

  const importModules = async (): Promise<{
    release: typeof import('../../../src/analytics/delivery/aggregate-release.js')
    worker: typeof import('../../../src/analytics/delivery/worker.js')
    schema: typeof import('../../../src/db/schema.js')
    sinkService: typeof import('../../../src/analytics/delivery/sink-service.js')
  }> => {
    const release = await import('../../../src/analytics/delivery/aggregate-release.js')
    const worker = await import('../../../src/analytics/delivery/worker.js')
    const schema = await import('../../../src/db/schema.js')
    const sinkService = await import('../../../src/analytics/delivery/sink-service.js')
    return { release, worker, schema, sinkService }
  }

  test('C3/raw-ID canaries across source facts never reach URL, headers, body, logs, receipt, or dead-letter state', async () => {
    const { release, worker, schema, sinkService } = await importModules()
    const sink = createCapturedSink({ kind: 'delivered', status: 200, receiptHash: 'f'.repeat(64) })

    // Operator-owned sink record: endpoint + synthetic token encrypted with the
    // repository secret-payload crypto, exactly like production.
    const view = sinkService.createSinkVersion(
      {
        logicalSinkId: 'captured-agg',
        kind: 'webhook',
        egressMode: 'aggregate',
        endpoint: REAL_ENDPOINT,
        secret: SYNTHETIC_SINK_TOKEN,
        nowMs: NOW,
      },
      { getDrizzleDb: (): Db => db, probe: () => Promise.resolve({ ok: true }) },
    )
    db.update(schema.analyticsSinks)
      .set({ state: 'enabled', verifiedAtMs: NOW })
      .where(eq(schema.analyticsSinks.sinkVersionId, view.sinkVersionId))
      .run()

    // Poisoned canonical facts: every raw ID and C3 canary sits in storage as
    // if the source boundary had been breached; the aggregate egress path must
    // still never carry any of them.
    db.insert(schema.analyticsProcessEpochs).values({ epochId: 'epoch-1', state: 'open', startedAtMs: NOW }).run()
    db.insert(schema.analyticsEvents)
      .values({
        eventId: 'event-poisoned',
        storageGeneration: 'gen-1',
        processEpochId: 'epoch-1',
        sourceRefKey: 'raw-turn-99887',
        sourceKind: 'live',
        schemaVersion: 1,
        eventName: 'turn_started',
        eventVersion: 1,
        occurredAtMs: NOW - 1000,
        ingestedAtMs: NOW,
        source: 'live',
        attributionQuality: 'native',
        appVersion: '6.10.0',
        deploymentKey: 'raw-deploy-1',
        keyVersion: 'v1',
        platform: 'telegram',
        platformInstanceKey: 'raw-instance-1',
        actorKey: 'raw-user-778899',
        contextKey: 'raw-chat-445566',
        conversationKey: 'raw-chat-445566',
        taskInstanceKey: 'raw-task-11223',
        contextType: 'dm',
        actorRole: 'member',
        taskProvider: 'none',
        invocationMode: 'normal',
        turnKey: 'raw-turn-99887',
        policyVersion: 1,
        eligibility: 'allowed',
        maxClass: 'C0',
        propsJson: JSON.stringify({
          prompt: 'PROMPT-CANARY-7f3a9d',
          username: 'USERNAME-CANARY-zx21',
          token: 'TOKEN-CANARY-qw99',
          rrule: 'RRULE-CANARY-rr5',
          error: 'ERROR-CANARY-ee4',
        }),
        expiresAtMs: NOW + 86_400_000,
      })
      .run()

    // Assessed rollup rows: only counts and catalog enums may leave.
    const insertCounter = (metric: string, value: number, contributors: number): void => {
      db.insert(schema.analyticsDailyCounters)
        .values({
          utcDay: UTC_DAY,
          definitionVersion: 1,
          platform: 'all',
          contextType: 'all',
          actorRole: 'all',
          taskProvider: 'all',
          appVersion: 'all',
          metric,
          value,
          finalized: true,
          partialDay: false,
          restartGapDetected: false,
          lateEventCount: 0,
          reconciliationStatus: 'complete_epoch',
          disclosureScope: 'local_only',
          contributorBasis: 'eligible_actor',
          contributorCount: contributors,
          threshold: null,
        })
        .run()
    }
    insertCounter('turn_started', 250, 40)
    insertCounter('turn_completed', 240, 38)

    const built = release.buildDailyAggregateRelease(
      { utcDay: UTC_DAY, sinkVersionId: view.sinkVersionId, nowMs: NOW },
      { getDrizzleDb: (): Db => db },
    )
    expect(built.status).toBe('released')

    const tick = await worker.runDeliveryWorkerTick(
      { nowMs: NOW },
      {
        getDrizzleDb: (): Db => db,
        transport: sink.transport,
        lookupAll: () => Promise.resolve([{ address: '203.0.113.10', family: 4 as const }]),
      },
    )
    expect(tick).toMatchObject({ status: 'ok', leased: 1, delivered: 1 })
    expect(sink.requests).toHaveLength(1)

    // A dead-letter row in the ledger, so dead state is scanned as well.
    db.insert(schema.analyticsAggregateReleases)
      .values({
        releaseId: 'agg-release:dead-letter-fixture',
        releaseHash: 'e'.repeat(64),
        payloadJson: `{"utc_day":"${UTC_DAY}","cells":[]}`,
        payloadSchemaVersion: 1,
        createdAtMs: NOW,
      })
      .run()
    db.insert(schema.analyticsAggregateDeliveries)
      .values({
        releaseId: 'agg-release:dead-letter-fixture',
        sinkVersionId: view.sinkVersionId,
        state: 'dead',
        attempts: 8,
        nextAttemptAtMs: NOW,
        lastErrorClass: 'http_4xx',
        payloadSchemaVersion: 1,
      })
      .run()

    const request = requireFirstRequest(sink.requests)
    expect(request.url).toBe(REAL_ENDPOINT)
    expect(request.hostname).toBe('captured-sink.example.net')
    expect(request.pinnedAddress).toBe('203.0.113.10')

    const nonAuthHeaders = Object.entries(request.headers)
      .filter(([name]) => name.toLowerCase() !== 'authorization')
      .map(([name, value]) => `${name}: ${value}`)
    expect(request.headers['authorization']).toBe(`Bearer ${SYNTHETIC_SINK_TOKEN}`)

    const deliveries = db.select().from(schema.analyticsAggregateDeliveries).all()
    const releases = db.select().from(schema.analyticsAggregateReleases).all()
    const logs = tracked.getCalls().map((call) => JSON.stringify(call.args))
    const haystacks = [
      request.url,
      request.hostname,
      ...nonAuthHeaders,
      request.body,
      ...logs,
      ...deliveries.map((row) => JSON.stringify(row)),
      ...releases.map((row) => JSON.stringify(row)),
    ]
    expect(findCanaries(haystacks, [...CANARIES])).toEqual([])

    // The receipt is a one-way hash; the raw response body never persists.
    const delivered = deliveries.find((row) => row.state === 'delivered')
    expect(delivered?.remoteReceiptHash).toMatch(/^[0-9a-f]{64}$/u)

    // The released payload carries only counts, catalog enums, and quality flags.
    expect(request.body).not.toContain('raw-')
    expect(request.body).not.toContain('CANARY')
    const payload = parseCellsPayload(request.body)
    expect(payload.cells).toHaveLength(2)
  })
})

describe('production sink registry', () => {
  test('no production external_pseudonymous sink is registered', () => {
    expect(listProductionSinks('pseudonymous')).toEqual([])
    expect(findProductionSink('openpanel', 'pseudonymous')).toBeNull()
    expect(findProductionSink('webhook', 'aggregate')).not.toBeNull()
  })

  test('the OpenPanel fixture stays rejected until the strict AND passes', () => {
    const review = {
      subprocessorReviewed: true,
      residencyReviewed: true,
      deletionPathReviewed: true,
      incidentReviewed: true,
      transferReviewed: true,
      noSecondaryUse: true,
    }
    const result = assessSink({
      mode: 'pseudonymous',
      state: 'enabled',
      payloadSchemaVersion: 1,
      capabilities: OPENPANEL_ASSESSED_CAPABILITIES,
      processorReview: review,
      httpsPolicyApproved: true,
    })
    expect(result.approved).toBe(false)
    // Each missing capability alone keeps the gate closed; no substitute passes.
    expect(
      assessSink({
        mode: 'pseudonymous',
        state: 'enabled',
        payloadSchemaVersion: 1,
        capabilities: { ...OPENPANEL_ASSESSED_CAPABILITIES, callerControlledIdempotency: true },
        processorReview: review,
        httpsPolicyApproved: true,
      }).approved,
    ).toBe(false)
    expect(
      assessSink({
        mode: 'pseudonymous',
        state: 'enabled',
        payloadSchemaVersion: 1,
        capabilities: { ...OPENPANEL_ASSESSED_CAPABILITIES, deleteActor: true },
        processorReview: review,
        httpsPolicyApproved: true,
      }).approved,
    ).toBe(false)
    expect(
      assessSink({
        mode: 'pseudonymous',
        state: 'enabled',
        payloadSchemaVersion: 1,
        capabilities: { callerControlledIdempotency: true, deterministicReconciliation: true, deleteActor: true },
        processorReview: review,
        httpsPolicyApproved: true,
      }).approved,
    ).toBe(true)
  })
})
