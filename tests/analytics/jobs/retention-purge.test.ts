// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { purgeExpired } from '../../../src/analytics/jobs/retention-purge.js'
import type { RetentionJobDeps } from '../../../src/analytics/jobs/retention-purge.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = 86_400_000
const T = 1_800_000_000_000
const EPOCH_ID = 'epoch-retention-purge'
const GRANT = { grantKey: 'v1.d-grant-purge', keyVersion: 'v1', generation: 1 }

const insertEventRow = (db: Db, eventId: string, expiresAtMs: number): void => {
  db.insert(schema.analyticsProcessEpochs)
    .values({ epochId: EPOCH_ID, state: 'open', startedAtMs: T - 400 * DAY })
    .onConflictDoNothing()
    .run()
  db.insert(schema.analyticsEvents)
    .values({
      eventId,
      storageGeneration: 'gen-1',
      processEpochId: EPOCH_ID,
      sourceRefKey: `ref-${eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: 'turn_started',
      eventVersion: 1,
      occurredAtMs: expiresAtMs - 90 * DAY,
      ingestedAtMs: expiresAtMs - 90 * DAY + 1,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: 'v1',
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      actorKey: 'v1.a-actor',
      contextKey: 'v1.c-context',
      threadKey: null,
      conversationKey: 'v1.c-context',
      taskInstanceKey: null,
      contextType: 'dm',
      actorRole: 'member',
      taskProvider: 'none',
      invocationMode: 'normal',
      turnKey: null,
      sessionKey: null,
      policyVersion: 1,
      eligibility: 'allowed',
      maxClass: 'C0',
      propsJson: '{}',
      expiresAtMs,
    })
    .run()
}

const insertSinkRow = (db: Db, sinkVersionId: string): void => {
  db.insert(schema.analyticsSinks)
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
      createdAtMs: T - 400 * DAY,
    })
    .run()
}

const insertDeliveryRow = (
  db: Db,
  input: Readonly<{
    eventId: string
    sinkVersionId: string
    state: string
    deliveredAtMs?: number | null
    sendStartedAtMs?: number | null
    leaseUntilMs?: number | null
  }>,
): void => {
  db.insert(schema.analyticsDeliveries)
    .values({
      eventId: input.eventId,
      sinkVersionId: input.sinkVersionId,
      grantKey: GRANT.grantKey,
      grantKeyVersion: GRANT.keyVersion,
      grantGeneration: GRANT.generation,
      state: input.state,
      attempts: 0,
      nextAttemptAtMs: T - 400 * DAY,
      leaseUntilMs: input.leaseUntilMs ?? null,
      sendStartedAtMs: input.sendStartedAtMs ?? null,
      deliveredAtMs: input.deliveredAtMs ?? null,
      payloadSchemaVersion: 1,
    })
    .run()
}

const deliveryRows = (db: Db): readonly (typeof schema.analyticsDeliveries.$inferSelect)[] =>
  db.select().from(schema.analyticsDeliveries).all()

const receiptRows = (db: Db): readonly (typeof schema.analyticsDeliveryDeletionReceipts.$inferSelect)[] =>
  db.select().from(schema.analyticsDeliveryDeletionReceipts).all()

describe('expiry settlement mirrors the deletion settlement ordering', () => {
  let db: Db
  let deps: RetentionJobDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('delivered, sending, and ambiguous targets get remote deletion plus an independent minimal receipt', () => {
    insertSinkRow(db, 'sv-delivered')
    insertSinkRow(db, 'sv-sending')
    insertSinkRow(db, 'sv-ambiguous')
    insertSinkRow(db, 'sv-pending')
    insertEventRow(db, 'ev-exp-delivered', T)
    insertEventRow(db, 'ev-exp-pending', T)
    insertDeliveryRow(db, {
      eventId: 'ev-exp-delivered',
      sinkVersionId: 'sv-delivered',
      state: 'delivered',
      deliveredAtMs: T - DAY,
    })
    insertDeliveryRow(db, {
      eventId: 'ev-exp-delivered',
      sinkVersionId: 'sv-sending',
      state: 'sending',
      sendStartedAtMs: T - 100,
      leaseUntilMs: T + 1000,
    })
    insertDeliveryRow(db, { eventId: 'ev-exp-delivered', sinkVersionId: 'sv-ambiguous', state: 'ambiguous' })
    insertDeliveryRow(db, { eventId: 'ev-exp-pending', sinkVersionId: 'sv-pending', state: 'pending' })
    const remoteCalls: string[] = []
    const remoteDeps: RetentionJobDeps = {
      getDrizzleDb: (): Db => db,
      requestRemoteDeletion: (sinkVersionId) => {
        remoteCalls.push(sinkVersionId)
        return { remoteReceiptHash: `remote-${sinkVersionId}` }
      },
    }

    const result = purgeExpired({ nowMs: T }, remoteDeps)

    expect(remoteCalls).toEqual(['sv-ambiguous', 'sv-delivered', 'sv-sending'])
    expect(result.eventsRemoved).toBe(2)
    expect(result.remoteDeletionsConfirmed).toBe(3)
    expect(result.remoteSettlementDeferred).toBe(0)
    expect(deliveryRows(db)).toHaveLength(0)
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    const receipts = receiptRows(db)
    expect(receipts).toHaveLength(3)
    for (const receipt of receipts) {
      expect(receipt.state).toBe('reconciled')
      expect(receipt.remoteReceiptHash).toBe(`remote-${receipt.sinkVersionId}`)
      expect(receipt.requestedAtMs).toBe(T)
      expect(receipt.reconciledAtMs).toBe(T)
    }
    const serialized = JSON.stringify(receipts)
    expect(serialized).not.toContain('ev-exp-delivered')
    expect(serialized).not.toContain(GRANT.grantKey)
    expect(serialized).not.toContain('v1.a-actor')
  })

  test('without a remote-deletion requester the delivered graph is retained, not silently deleted', () => {
    insertSinkRow(db, 'sv-delivered')
    insertEventRow(db, 'ev-exp-retained', T)
    insertDeliveryRow(db, {
      eventId: 'ev-exp-retained',
      sinkVersionId: 'sv-delivered',
      state: 'delivered',
      deliveredAtMs: T - DAY,
    })

    const result = purgeExpired({ nowMs: T }, deps)

    expect(result.eventsRemoved).toBe(0)
    expect(result.remoteSettlementDeferred).toBe(1)
    expect(deliveryRows(db).map((row) => row.state)).toEqual(['delivered'])
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(1)
    expect(receiptRows(db)).toHaveLength(0)
  })

  test('a refused remote deletion defers only the remote-settled events; a later confirmed run settles them', () => {
    insertSinkRow(db, 'sv-refused')
    insertSinkRow(db, 'sv-local')
    insertEventRow(db, 'ev-exp-remote', T)
    insertEventRow(db, 'ev-exp-local', T)
    insertDeliveryRow(db, { eventId: 'ev-exp-remote', sinkVersionId: 'sv-refused', state: 'ambiguous' })
    insertDeliveryRow(db, { eventId: 'ev-exp-local', sinkVersionId: 'sv-local', state: 'pending' })
    const refuse = (): null => null
    const allow = (): { remoteReceiptHash: string } => ({ remoteReceiptHash: 'remote-late' })
    let remoteBehavior: typeof refuse | typeof allow = refuse
    const toggledDeps: RetentionJobDeps = {
      getDrizzleDb: (): Db => db,
      requestRemoteDeletion: (): { remoteReceiptHash: string } | null => remoteBehavior(),
    }

    const first = purgeExpired({ nowMs: T }, toggledDeps)

    expect(first.remoteSettlementDeferred).toBe(1)
    expect(first.eventsRemoved).toBe(1)
    expect(deliveryRows(db).map((row) => row.eventId)).toEqual(['ev-exp-remote'])
    expect(receiptRows(db)).toHaveLength(0)

    remoteBehavior = allow
    const second = purgeExpired({ nowMs: T + 1 }, toggledDeps)

    expect(second.eventsRemoved).toBe(1)
    expect(second.remoteDeletionsConfirmed).toBe(1)
    expect(deliveryRows(db)).toHaveLength(0)
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    const receipts = receiptRows(db)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.remoteReceiptHash).toBe('remote-late')
    expect(receipts[0]?.deletionRequestId).toBe('system:retention-expiry')
  })

  test('the expiry deletion-request parent row is minimal and marked completed', () => {
    insertSinkRow(db, 'sv-parent')
    insertEventRow(db, 'ev-exp-parent', T)
    insertDeliveryRow(db, {
      eventId: 'ev-exp-parent',
      sinkVersionId: 'sv-parent',
      state: 'delivered',
      deliveredAtMs: T - DAY,
    })
    const remoteDeps: RetentionJobDeps = {
      getDrizzleDb: (): Db => db,
      requestRemoteDeletion: () => ({ remoteReceiptHash: 'remote-parent' }),
    }

    purgeExpired({ nowMs: T }, remoteDeps)

    const requests = db
      .select()
      .from(schema.analyticsDeletionRequests)
      .where(eq(schema.analyticsDeletionRequests.requestId, 'system:retention-expiry'))
      .all()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.state).toBe('completed')
    expect(requests[0]?.governanceActorKey).toBe('system:retention-expiry')
  })
})
