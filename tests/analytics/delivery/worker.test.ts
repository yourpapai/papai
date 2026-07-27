// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import {
  classifyAggregateDelivery,
  reconcileAggregateAmbiguous,
} from '../../../src/analytics/delivery/aggregate-delivery-classify.js'
import { enqueueDelivery, markSendStarted } from '../../../src/analytics/delivery/delivery-lifecycle.js'
import type { LookupAll } from '../../../src/analytics/delivery/http-policy.js'
import type { PinnedSendOutcome } from '../../../src/analytics/delivery/pinned-transport.js'
import { leaseDeliveries, reconcileAmbiguous, recoverOrphanedSends } from '../../../src/analytics/delivery/store.js'
import type { DeliveryStoreDeps } from '../../../src/analytics/delivery/store.js'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  computeRetryDelayMs,
  runDeliveryWorkerTick,
} from '../../../src/analytics/delivery/worker.js'
import type { DeliveryWorkerDeps, WorkerSinkConfig } from '../../../src/analytics/delivery/worker.js'
import { setActiveGeneration } from '../../../src/analytics/governance/generation-store.js'
import { createGrantSendMutex, withGrantSendLockAsync } from '../../../src/analytics/governance/grant-serialization.js'
import type { GrantSendMutex } from '../../../src/analytics/governance/grant-serialization.js'
import { setGrantState } from '../../../src/analytics/governance/grant-store.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import type { RekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import {
  analyticsAggregateDeliveries,
  analyticsAggregateReleases,
  analyticsDeliveries,
  analyticsEvents,
  analyticsProcessEpochs,
  analyticsRekeyRuns,
  analyticsSinks,
} from '../../../src/db/schema.js'
import type { AnalyticsDeliveryRow } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

// Deferred helper at module scope — no-conditional-in-test forbids the
// null-check + call pattern inside test bodies.
type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>

const createDeferred = (): Deferred => {
  const resolvers: Array<() => void> = []
  const promise = new Promise<void>((resolve) => {
    resolvers.push(resolve)
  })
  const resolve = (): void => {
    for (const resolver of resolvers) resolver()
  }
  return { promise, resolve }
}

const NOW = 1_800_000_000_000
const DAY_START = 1_799_971_200_000
const GRANT = { grantKey: 'v1.d-grant-1', keyVersion: 'v1', generation: 1 }
const ENDPOINT = 'https://sink.example.com/ingest'

const insertEvent = (db: Db, eventId: string, generation = 'gen-1', expiresAtMs = NOW + 90 * 86_400_000): void => {
  db.insert(analyticsProcessEpochs)
    .values({ epochId: 'epoch-1', state: 'open', startedAtMs: NOW })
    .onConflictDoNothing()
    .run()
  db.insert(analyticsEvents)
    .values({
      eventId,
      storageGeneration: generation,
      processEpochId: 'epoch-1',
      sourceRefKey: `ref-${eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: 'turn_started',
      eventVersion: 1,
      occurredAtMs: NOW,
      ingestedAtMs: NOW + 1,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: 'v1',
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      actorKey: 'v1.a-actor',
      conversationKey: 'v1.c-conv',
      contextType: 'dm',
      actorRole: 'admin',
      taskProvider: 'none',
      invocationMode: 'normal',
      turnKey: 'v1.t-turn',
      policyVersion: 1,
      eligibility: 'allowed',
      maxClass: 'C0',
      propsJson: '{"x":1}',
      expiresAtMs,
    })
    .run()
}

const insertSink = (db: Db, sinkVersionId: string, egressMode = 'pseudonymous'): void => {
  db.insert(analyticsSinks)
    .values({
      sinkVersionId,
      logicalSinkId: `logical-${sinkVersionId}`,
      version: 1,
      kind: 'webhook',
      state: 'enabled',
      payloadSchemaVersion: 1,
      egressMode,
      endpointCiphertext: 'ct-endpoint',
      secretCiphertext: 'ct-secret',
      configFingerprint: `fp-${sinkVersionId}`,
      createdAtMs: NOW,
    })
    .run()
}

const allowGrant = (db: Db, grantKey = GRANT.grantKey): void => {
  setGrantState(
    { grantKey, keyVersion: 'v1', state: 'allow', policyVersion: 1, nowMs: NOW },
    { getDrizzleDb: () => db },
  )
}

const denyGrant = (db: Db, grantKey = GRANT.grantKey): void => {
  setGrantState(
    { grantKey, keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 1 },
    { getDrizzleDb: () => db },
  )
}

const deliveryRow = (db: Db, eventId: string, sinkVersionId: string): AnalyticsDeliveryRow | undefined =>
  db
    .select()
    .from(analyticsDeliveries)
    .where(and(eq(analyticsDeliveries.eventId, eventId), eq(analyticsDeliveries.sinkVersionId, sinkVersionId)))
    .get()

type TransportCall = Readonly<{ url: string; headers: Readonly<Record<string, string>>; body: string }>

type ScriptedTransport = Readonly<{
  calls: TransportCall[]
  outcome: () => PinnedSendOutcome
  setOutcome: (outcome: PinnedSendOutcome | (() => PinnedSendOutcome)) => void
}>

const createScriptedTransport = (initial: PinnedSendOutcome): ScriptedTransport => {
  const calls: TransportCall[] = []
  let outcome: PinnedSendOutcome | (() => PinnedSendOutcome) = initial
  return {
    calls,
    outcome: () => (typeof outcome === 'function' ? outcome() : outcome),
    setOutcome: (next) => {
      outcome = next
    },
  }
}

describe('delivery worker', () => {
  let db: Db
  let grantMutex: GrantSendMutex
  let scripted: ScriptedTransport
  let deps: DeliveryWorkerDeps
  let storeDeps: DeliveryStoreDeps

  const seedEventDelivery = (eventId = 'event-1', sinkVersionId = 'sv-1'): void => {
    insertEvent(db, eventId)
    insertSink(db, sinkVersionId)
    allowGrant(db)
    enqueueDelivery({ eventId, sinkVersionId, grant: GRANT, nowMs: NOW }, storeDeps)
  }

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    grantMutex = createGrantSendMutex()
    scripted = createScriptedTransport({ kind: 'delivered', status: 200, receiptHash: 'a'.repeat(64) })
    storeDeps = { getDrizzleDb: (): Db => db, grantMutex }
    deps = {
      getDrizzleDb: (): Db => db,
      grantMutex,
      lookupAll: (): ReturnType<LookupAll> => Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
      transport: (endpoint, input): Promise<PinnedSendOutcome> => {
        scripted.calls.push({ url: endpoint.url, headers: input.headers, body: input.body })
        return Promise.resolve(scripted.outcome())
      },
      loadSinkConfig: (): WorkerSinkConfig => ({
        endpoint: ENDPOINT,
        secret: 'sink-token',
        egressMode: 'pseudonymous',
        state: 'enabled',
      }),
    }
  })

  test('normal acknowledgement: lease, durable send-start, send, delivered classification', async () => {
    seedEventDelivery()
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', leased: 1, delivered: 1 })
    expect(scripted.calls).toHaveLength(1)
    expect(scripted.calls[0]?.url).toBe(ENDPOINT)
    expect(scripted.calls[0]?.headers['authorization']).toBe('Bearer sink-token')
    const row = deliveryRow(db, 'event-1', 'sv-1')
    expect(row).toMatchObject({
      state: 'delivered',
      attempts: 1,
      deliveredAtMs: NOW,
      remoteReceiptHash: 'a'.repeat(64),
      lastErrorClass: null,
    })
  })

  test('explicit retryable failure returns the row to pending with bounded backoff', async () => {
    seedEventDelivery()
    scripted.setOutcome({ kind: 'responded', status: 503, errorClass: 'http_5xx' })
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', retryable: 1 })
    const row = deliveryRow(db, 'event-1', 'sv-1')
    expect(row).toMatchObject({
      state: 'pending',
      attempts: 1,
      lastErrorClass: 'http_5xx',
      nextAttemptAtMs: NOW + BACKOFF_BASE_MS,
      sendStartedAtMs: null,
    })
  })

  test('permanent failure marks the row dead without further sends', async () => {
    seedEventDelivery()
    scripted.setOutcome({ kind: 'responded', status: 400, errorClass: 'http_4xx' })
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', dead: 1 })
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'dead', lastErrorClass: 'http_4xx' })
    const second = await runDeliveryWorkerTick({ nowMs: NOW + BACKOFF_BASE_MS * 100 }, deps)
    expect(second).toMatchObject({ status: 'ok', leased: 0 })
    expect(scripted.calls).toHaveLength(1)
  })

  test('timeout persists a distinct non-retried ambiguous state requiring reconciliation', async () => {
    seedEventDelivery()
    scripted.setOutcome({ kind: 'timeout' })
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', ambiguous: 1 })
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'ambiguous', lastErrorClass: 'timeout' })

    const second = await runDeliveryWorkerTick({ nowMs: NOW + BACKOFF_MAX_MS * 100 }, deps)
    expect(second).toMatchObject({ status: 'ok', leased: 0 })
    expect(scripted.calls).toHaveLength(1)

    expect(
      reconcileAmbiguous(
        {
          eventId: 'event-1',
          sinkVersionId: 'sv-1',
          outcome: 'delivered',
          remoteReceiptHash: 'b'.repeat(64),
          nowMs: NOW + 10,
        },
        storeDeps,
      ),
    ).toBe('resolved')
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'delivered', remoteReceiptHash: 'b'.repeat(64) })
  })

  test('an ambiguous acknowledgement (post-send network failure) is never auto-retried', async () => {
    seedEventDelivery()
    scripted.setOutcome({ kind: 'network', acknowledgement: 'uncertain' })
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', ambiguous: 1 })
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'ambiguous', lastErrorClass: 'network' })
    const second = await runDeliveryWorkerTick({ nowMs: NOW + BACKOFF_MAX_MS * 100 }, deps)
    expect(second.leased).toBe(0)
    expect(scripted.calls).toHaveLength(1)
  })

  test('a network failure before send is retryable', async () => {
    seedEventDelivery()
    scripted.setOutcome({ kind: 'network', acknowledgement: 'none' })
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', retryable: 1 })
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'pending', lastErrorClass: 'network' })
  })

  test('a never-started expired lease returns to pending and is sent by a later tick', async () => {
    seedEventDelivery()
    const leased = leaseDeliveries({ nowMs: NOW, leaseMs: 1_000, limit: 10, maxAttempts: 8 }, storeDeps)
    expect(leased).toHaveLength(1)
    expect(scripted.calls).toHaveLength(0)

    const result = await runDeliveryWorkerTick({ nowMs: NOW + 2_000 }, deps)
    expect(result).toMatchObject({ status: 'ok', leased: 1, delivered: 1 })
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'delivered', attempts: 2 })
  })

  test('crash immediately before durable send-start leaves no send and the row recovers', async () => {
    seedEventDelivery()
    leaseDeliveries({ nowMs: NOW, leaseMs: 500, limit: 10, maxAttempts: 8 }, storeDeps)
    // Crash: no markSendStarted, no transport call.
    expect(scripted.calls).toHaveLength(0)
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'leased' })

    const result = await runDeliveryWorkerTick({ nowMs: NOW + 1_000 }, deps)
    expect(result.delivered).toBe(1)
    expect(scripted.calls).toHaveLength(1)
  })

  test('crash immediately after send-start becomes non-retried ambiguous on recovery', async () => {
    seedEventDelivery()
    leaseDeliveries({ nowMs: NOW, leaseMs: 500, limit: 10, maxAttempts: 8 }, storeDeps)
    expect(markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)).toBe(
      'started',
    )
    // Crash: process dies before any classification.
    expect(recoverOrphanedSends({ nowMs: NOW + 1_000 }, storeDeps)).toEqual({ moved: 1 })
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'ambiguous' })

    const result = await runDeliveryWorkerTick({ nowMs: NOW + BACKOFF_MAX_MS * 100 }, deps)
    expect(result.leased).toBe(0)
    expect(scripted.calls).toHaveLength(0)
  })

  test('process crash after remote acceptance is ambiguous, never silently redelivered', async () => {
    seedEventDelivery()
    leaseDeliveries({ nowMs: NOW, leaseMs: 500, limit: 10, maxAttempts: 8 }, storeDeps)
    markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)
    // The remote accepted, but the process crashed before classification.
    const result = await runDeliveryWorkerTick({ nowMs: NOW + 1_000 }, deps)
    expect(result.leased).toBe(0)
    expect(scripted.calls).toHaveLength(0)
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'ambiguous' })
  })

  test('backoff is bounded exponential', () => {
    expect(computeRetryDelayMs(1)).toBe(BACKOFF_BASE_MS)
    expect(computeRetryDelayMs(2)).toBe(BACKOFF_BASE_MS * 2)
    expect(computeRetryDelayMs(3)).toBe(BACKOFF_BASE_MS * 4)
    expect(computeRetryDelayMs(100)).toBe(BACKOFF_MAX_MS)
  })

  test('the environment kill switch stops all work immediately', async () => {
    seedEventDelivery()
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, { ...deps, killSwitchActive: () => true })
    expect(result.status).toBe('kill_switch')
    expect(scripted.calls).toHaveLength(0)
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'pending' })
  })

  test('daily cap exhaustion leaves rows pending with a controlled next-attempt time', async () => {
    seedEventDelivery('event-1', 'sv-1')
    insertEvent(db, 'event-2')
    enqueueDelivery({ eventId: 'event-2', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)

    const capped = { ...deps, dailyEgressCap: 1 }
    const first = await runDeliveryWorkerTick({ nowMs: NOW }, capped)
    expect(first).toMatchObject({ status: 'ok', delivered: 1 })

    const second = await runDeliveryWorkerTick({ nowMs: NOW + 1_000 }, capped)
    expect(second.status).toBe('cap_exhausted')
    expect(scripted.calls).toHaveLength(1)
    const remaining = db.select().from(analyticsDeliveries).where(eq(analyticsDeliveries.state, 'pending')).all()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.nextAttemptAtMs).toBe(DAY_START + 86_400_000)
  })

  test('expired-at-lease cancels the row without a network call', async () => {
    insertEvent(db, 'event-1', 'gen-1', NOW - 1)
    insertSink(db, 'sv-1')
    allowGrant(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW - 10 }, storeDeps)
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result.leased).toBe(0)
    expect(scripted.calls).toHaveLength(0)
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'cancelled' })
  })

  test('expired-immediately-before-send cancels without a network call', async () => {
    insertEvent(db, 'event-1', 'gen-1', NOW + 500)
    insertSink(db, 'sv-1')
    allowGrant(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100_000, limit: 10, maxAttempts: 8 }, storeDeps)
    expect(
      markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 1_000 }, storeDeps),
    ).toBe('event_expired')
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'cancelled' })
    const result = await runDeliveryWorkerTick({ nowMs: NOW + 2_000 }, deps)
    expect(scripted.calls).toHaveLength(0)
    expect(result.leased).toBe(0)
  })

  test('a pseudonymous test sink holds the per-grant mutex through classification', async () => {
    seedEventDelivery()
    const heldDuringSend: boolean[] = []
    deps = {
      ...deps,
      transport: (): Promise<PinnedSendOutcome> => {
        heldDuringSend.push(grantMutex.isHeld(GRANT.grantKey))
        return Promise.resolve({ kind: 'delivered', status: 200, receiptHash: 'c'.repeat(64) })
      },
    }
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result.delivered).toBe(1)
    expect(heldDuringSend).toEqual([true])
    expect(grantMutex.isHeld(GRANT.grantKey)).toBe(false)
  })

  test('an externally held grant mutex blocks the send without losing the row', async () => {
    seedEventDelivery()
    await withGrantSendLockAsync(grantMutex, GRANT.grantKey, (): Promise<void> => {
      leaseDeliveries({ nowMs: NOW, leaseMs: 100_000, limit: 10, maxAttempts: 8 }, storeDeps)
      expect(markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)).toBe(
        'send_in_progress',
      )
      return Promise.resolve()
    })
  })

  test('withdrawal after lease cancels: no send occurs after the deny commits', async () => {
    seedEventDelivery()
    leaseDeliveries({ nowMs: NOW, leaseMs: 100_000, limit: 10, maxAttempts: 8 }, storeDeps)
    denyGrant(db)
    const result = await runDeliveryWorkerTick({ nowMs: NOW + 2 }, deps)
    expect(scripted.calls).toHaveLength(0)
    expect(result.delivered).toBe(0)
    expect(
      markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 3 }, storeDeps),
    ).toBe('grant_not_current')
  })

  test('aggregate releases deliver through the same gated worker', async () => {
    insertSink(db, 'sv-agg', 'aggregate')
    db.insert(analyticsAggregateReleases)
      .values({
        releaseId: 'agg-release:test',
        releaseHash: 'd'.repeat(64),
        payloadJson: `{"utc_day":"${new Date(NOW).toISOString().slice(0, 10)}","cells":[]}`,
        payloadSchemaVersion: 1,
        createdAtMs: NOW,
      })
      .run()
    db.insert(analyticsAggregateDeliveries)
      .values({
        releaseId: 'agg-release:test',
        sinkVersionId: 'sv-agg',
        state: 'pending',
        attempts: 0,
        nextAttemptAtMs: NOW,
        payloadSchemaVersion: 1,
      })
      .run()
    const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(result).toMatchObject({ status: 'ok', leased: 1, delivered: 1 })
    expect(scripted.calls[0]?.body).toBe(`{"utc_day":"${new Date(NOW).toISOString().slice(0, 10)}","cells":[]}`)
    const rows = db.select().from(analyticsAggregateDeliveries).all()
    expect(rows[0]).toMatchObject({ state: 'delivered', deliveredAtMs: NOW, remoteReceiptHash: 'a'.repeat(64) })
  })

  test('an ambiguous aggregate delivery is reconciled only explicitly', async () => {
    insertSink(db, 'sv-agg', 'aggregate')
    db.insert(analyticsAggregateReleases)
      .values({
        releaseId: 'agg-release:test',
        releaseHash: 'd'.repeat(64),
        payloadJson: `{"utc_day":"${new Date(NOW).toISOString().slice(0, 10)}","cells":[]}`,
        payloadSchemaVersion: 1,
        createdAtMs: NOW,
      })
      .run()
    db.insert(analyticsAggregateDeliveries)
      .values({
        releaseId: 'agg-release:test',
        sinkVersionId: 'sv-agg',
        state: 'pending',
        attempts: 0,
        nextAttemptAtMs: NOW,
        payloadSchemaVersion: 1,
      })
      .run()
    scripted.setOutcome({ kind: 'timeout' })
    await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    const rows = db.select().from(analyticsAggregateDeliveries).all()
    expect(rows[0]).toMatchObject({ state: 'ambiguous', lastErrorClass: 'timeout' })
    const second = await runDeliveryWorkerTick({ nowMs: NOW + BACKOFF_MAX_MS * 100 }, deps)
    expect(second.leased).toBe(0)
    expect(scripted.calls).toHaveLength(1)
    expect(
      classifyAggregateDelivery(
        {
          releaseId: 'agg-release:test',
          sinkVersionId: 'sv-agg',
          nowMs: NOW + 5,
          outcome: 'delivered',
          remoteReceiptHash: 'e'.repeat(64),
        },
        { getDrizzleDb: (): Db => db },
      ),
    ).toBe('not_sending')
    expect(
      reconcileAggregateAmbiguous(
        {
          releaseId: 'agg-release:test',
          sinkVersionId: 'sv-agg',
          outcome: 'delivered',
          remoteReceiptHash: 'e'.repeat(64),
          nowMs: NOW + 6,
        },
        { getDrizzleDb: (): Db => db },
      ),
    ).toBe('resolved')
    const reconciled = db.select().from(analyticsAggregateDeliveries).all()
    expect(reconciled[0]).toMatchObject({ state: 'delivered', remoteReceiptHash: 'e'.repeat(64) })
  })
})

describe('worker generation and cutover fencing', () => {
  let db: Db
  let grantMutex: GrantSendMutex
  let fence: RekeyCutoverFence
  let storeDeps: DeliveryStoreDeps
  let scripted: ScriptedTransport
  let deps: DeliveryWorkerDeps

  const startCutover = (runId: string): void => {
    db.insert(analyticsRekeyRuns)
      .values({
        runId,
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
  }

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    grantMutex = createGrantSendMutex()
    fence = createRekeyCutoverFence({ getDrizzleDb: (): Db => db, grantMutex })
    storeDeps = { getDrizzleDb: (): Db => db, grantMutex, fence }
    scripted = createScriptedTransport({ kind: 'delivered', status: 200, receiptHash: 'a'.repeat(64) })
    deps = {
      getDrizzleDb: (): Db => db,
      grantMutex,
      fence,
      lookupAll: (): ReturnType<LookupAll> => Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
      transport: (endpoint, input): Promise<PinnedSendOutcome> => {
        scripted.calls.push({ url: endpoint.url, headers: input.headers, body: input.body })
        return Promise.resolve(scripted.outcome())
      },
      loadSinkConfig: (): WorkerSinkConfig => ({
        endpoint: ENDPOINT,
        secret: 'sink-token',
        egressMode: 'pseudonymous',
        state: 'enabled',
      }),
    }
  })

  test('a target-shadow event is never enqueued even with an eligible grant', () => {
    insertEvent(db, 'shadow-1', 'gen-2')
    insertSink(db, 'sv-1')
    allowGrant(db)
    expect(
      enqueueDelivery({ eventId: 'shadow-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps),
    ).toEqual({ status: 'generation_mismatch' })
    expect(db.select().from(analyticsDeliveries).all()).toHaveLength(0)
  })

  test('an already queued retired parent cannot be leased or sent after the swap', async () => {
    insertEvent(db, 'event-1', 'gen-1')
    insertSink(db, 'sv-1')
    allowGrant(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100_000, limit: 10, maxAttempts: 8 }, storeDeps)

    setActiveGeneration({ generation: 'gen-2', nowMs: NOW + 1 }, { getDrizzleDb: (): Db => db })

    expect(
      markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 3 }, storeDeps),
    ).toBe('generation_mismatch')
    const result = await runDeliveryWorkerTick({ nowMs: NOW + 4 }, deps)
    expect(result.leased).toBe(0)
    expect(scripted.calls).toHaveLength(0)
  })

  test('cutover pauses enqueue, lease, and send-start until egress explicitly resumes', async () => {
    insertEvent(db, 'event-1', 'gen-1')
    insertSink(db, 'sv-1')
    allowGrant(db)
    startCutover('run-1')

    expect(enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)).toEqual(
      { status: 'fence_held' },
    )
    const paused = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
    expect(paused.leased).toBe(0)
    expect(scripted.calls).toHaveLength(0)

    fence.releaseFence('run-1', NOW + 1)
    expect(
      enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 2 }, storeDeps),
    ).toEqual({ status: 'enqueued' })
    const resumed = await runDeliveryWorkerTick({ nowMs: NOW + 3 }, deps)
    expect(resumed.delivered).toBe(1)
  })

  test('cutover drains an admitted send before the fence reports drained', async () => {
    insertEvent(db, 'event-1', 'gen-1')
    insertSink(db, 'sv-1')
    allowGrant(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, storeDeps)

    const gate = createDeferred()
    const entered = createDeferred()
    deps = {
      ...deps,
      transport: (): Promise<PinnedSendOutcome> => {
        entered.resolve()
        return gate.promise.then(
          (): PinnedSendOutcome => ({ kind: 'delivered', status: 200, receiptHash: 'f'.repeat(64) }),
        )
      },
    }
    const tick = runDeliveryWorkerTick({ nowMs: NOW }, deps)
    await entered.promise
    expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'sending' })

    startCutover('run-1')
    expect(fence.isFenceHeld()).toBe(true)
    expect(fence.isDrained()).toBe(false)

    gate.resolve()
    const result = await tick
    expect(result.delivered).toBe(1)
    expect(fence.isDrained()).toBe(true)
  })

  test('only still-eligible new-generation rows enqueue after the rekey resumes egress', () => {
    insertEvent(db, 'old-1', 'gen-1')
    insertEvent(db, 'new-1', 'gen-2')
    insertSink(db, 'sv-1')
    allowGrant(db)
    startCutover('run-1')
    fence.releaseFence('run-1', NOW + 1)
    setActiveGeneration({ generation: 'gen-2', nowMs: NOW + 2 }, { getDrizzleDb: (): Db => db })

    expect(
      enqueueDelivery({ eventId: 'old-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 3 }, storeDeps),
    ).toEqual({ status: 'generation_mismatch' })
    expect(
      enqueueDelivery({ eventId: 'new-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 3 }, storeDeps),
    ).toEqual({ status: 'enqueued' })
  })
})
