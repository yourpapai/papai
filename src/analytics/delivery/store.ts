// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, lt, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeliveries, analyticsEvents } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { DeliveryGrantRef } from '../governance/eligibility.js'
import { checkGrantCurrentIn } from '../governance/grant-store.js'
import type { StrictDeliveryPayloadV1 } from './sink.js'
import { DELIVERY_PAYLOAD_SCHEMA_VERSION } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:store' })

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type GrantRecheck = (db: Db | Tx, ref: DeliveryGrantRef) => boolean

export type DeliveryStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  recheckGrant?: GrantRecheck
}>

const recheck = (deps: DeliveryStoreDeps, db: Db | Tx, ref: DeliveryGrantRef): boolean =>
  (deps.recheckGrant ?? checkGrantCurrentIn)(db, ref)

export type EnqueueDeliveryInput = Readonly<{
  eventId: string
  sinkVersionId: string
  grant: DeliveryGrantRef
  nowMs: number
}>

export type EnqueueDeliveryResult = Readonly<{
  status: 'enqueued' | 'already_present' | 'grant_not_current'
}>

export const enqueueDelivery = (
  input: EnqueueDeliveryInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): EnqueueDeliveryResult => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    if (!recheck(deps, tx, input.grant)) {
      log.debug({ sinkVersionId: input.sinkVersionId }, 'delivery enqueue rejected: grant not current')
      return { status: 'grant_not_current' }
    }
    const existing = tx
      .select({ eventId: analyticsDeliveries.eventId })
      .from(analyticsDeliveries)
      .where(
        and(eq(analyticsDeliveries.eventId, input.eventId), eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId)),
      )
      .get()
    if (existing !== undefined) return { status: 'already_present' }
    tx.insert(analyticsDeliveries)
      .values({
        eventId: input.eventId,
        sinkVersionId: input.sinkVersionId,
        grantKey: input.grant.grantKey,
        grantKeyVersion: input.grant.keyVersion,
        grantGeneration: input.grant.generation,
        state: 'pending',
        attempts: 0,
        nextAttemptAtMs: input.nowMs,
        payloadSchemaVersion: DELIVERY_PAYLOAD_SCHEMA_VERSION,
      })
      .run()
    log.debug({ sinkVersionId: input.sinkVersionId }, 'delivery enqueued')
    return { status: 'enqueued' }
  })
}

export type LeasedDelivery = Readonly<{
  eventId: string
  sinkVersionId: string
  grant: DeliveryGrantRef
  attempts: number
  leaseUntilMs: number
  payload: StrictDeliveryPayloadV1
}>

export type LeaseDeliveriesInput = Readonly<{
  nowMs: number
  leaseMs: number
  limit: number
  maxAttempts: number
}>

const releaseExpiredLeases = (tx: Tx, nowMs: number): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'pending', leaseUntilMs: null })
    .where(
      and(
        eq(analyticsDeliveries.state, 'leased'),
        isNull(analyticsDeliveries.sendStartedAtMs),
        lt(analyticsDeliveries.leaseUntilMs, nowMs),
      ),
    )
    .run()
}

const exhaustDeadRows = (tx: Tx, maxAttempts: number): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'dead' })
    .where(and(eq(analyticsDeliveries.state, 'pending'), sql`${analyticsDeliveries.attempts} >= ${maxAttempts}`))
    .run()
}

const leaseOne = (
  tx: Tx,
  row: { eventId: string; sinkVersionId: string; attempts: number },
  leaseUntilMs: number,
): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'leased', attempts: row.attempts + 1, leaseUntilMs })
    .where(
      and(
        eq(analyticsDeliveries.eventId, row.eventId),
        eq(analyticsDeliveries.sinkVersionId, row.sinkVersionId),
        eq(analyticsDeliveries.state, 'pending'),
      ),
    )
    .run()
}

export const leaseDeliveries = (
  input: LeaseDeliveriesInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): LeasedDelivery[] => {
  const db = deps.getDrizzleDb()
  const leaseUntilMs = input.nowMs + input.leaseMs
  return db.transaction((tx) => {
    releaseExpiredLeases(tx, input.nowMs)
    exhaustDeadRows(tx, input.maxAttempts)
    const candidates = tx
      .select({
        eventId: analyticsDeliveries.eventId,
        sinkVersionId: analyticsDeliveries.sinkVersionId,
        grantKey: analyticsDeliveries.grantKey,
        grantKeyVersion: analyticsDeliveries.grantKeyVersion,
        grantGeneration: analyticsDeliveries.grantGeneration,
        attempts: analyticsDeliveries.attempts,
        eventName: analyticsEvents.eventName,
        occurredAtMs: analyticsEvents.occurredAtMs,
        propsJson: analyticsEvents.propsJson,
      })
      .from(analyticsDeliveries)
      .innerJoin(analyticsEvents, eq(analyticsEvents.eventId, analyticsDeliveries.eventId))
      .where(
        and(
          eq(analyticsDeliveries.state, 'pending'),
          sql`${analyticsDeliveries.nextAttemptAtMs} <= ${input.nowMs}`,
          sql`${analyticsDeliveries.attempts} < ${input.maxAttempts}`,
        ),
      )
      .orderBy(analyticsDeliveries.nextAttemptAtMs)
      .limit(input.limit)
      .all()
    for (const row of candidates) leaseOne(tx, row, leaseUntilMs)
    return candidates.map((row) => ({
      eventId: row.eventId,
      sinkVersionId: row.sinkVersionId,
      grant: { grantKey: row.grantKey, keyVersion: row.grantKeyVersion, generation: row.grantGeneration },
      attempts: row.attempts + 1,
      leaseUntilMs,
      payload: {
        schemaVersion: DELIVERY_PAYLOAD_SCHEMA_VERSION,
        eventName: row.eventName,
        occurredAtMs: row.occurredAtMs,
        propsJson: row.propsJson,
      },
    }))
  })
}

export type RenewLeaseInput = Readonly<{
  eventId: string
  sinkVersionId: string
  expectedLeaseUntilMs: number
  nowMs: number
  leaseMs: number
}>

export const renewLease = (
  input: RenewLeaseInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): boolean => {
  const result = deps
    .getDrizzleDb()
    .$client.query<{ changes: number }, [number, string, string, number, number]>(
      `UPDATE analytics_deliveries SET lease_until_ms = ?
       WHERE event_id = ? AND sink_version_id = ? AND state = 'leased'
         AND lease_until_ms = ? AND lease_until_ms > ?`,
    )
    .run(input.nowMs + input.leaseMs, input.eventId, input.sinkVersionId, input.expectedLeaseUntilMs, input.nowMs)
  return result.changes > 0
}

export type MarkSendStartedInput = Readonly<{
  eventId: string
  sinkVersionId: string
  grant: DeliveryGrantRef
  nowMs: number
}>

export type MarkSendStartedResult = 'started' | 'not_leased' | 'lease_expired' | 'grant_not_current'

export const markSendStarted = (
  input: MarkSendStartedInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): MarkSendStartedResult => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(analyticsDeliveries)
      .where(
        and(eq(analyticsDeliveries.eventId, input.eventId), eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId)),
      )
      .get()
    if (row === undefined || row.state !== 'leased') return 'not_leased'
    if (row.leaseUntilMs === null || row.leaseUntilMs < input.nowMs) {
      tx.update(analyticsDeliveries)
        .set({ state: 'pending', leaseUntilMs: null })
        .where(
          and(
            eq(analyticsDeliveries.eventId, input.eventId),
            eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId),
          ),
        )
        .run()
      return 'lease_expired'
    }
    if (!recheck(deps, tx, input.grant)) {
      log.warn({ sinkVersionId: input.sinkVersionId }, 'send-start blocked: grant not current')
      return 'grant_not_current'
    }
    tx.update(analyticsDeliveries)
      .set({ state: 'sending', sendStartedAtMs: input.nowMs })
      .where(
        and(
          eq(analyticsDeliveries.eventId, input.eventId),
          eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId),
          eq(analyticsDeliveries.state, 'leased'),
        ),
      )
      .run()
    return 'started'
  })
}

export { classifyDelivery, classifySendError, recoverOrphanedSends, reconcileAmbiguous } from './store-outcomes.js'
export type { ClassifyDeliveryInput, ClassifyDeliveryResult, ReconcileAmbiguousInput } from './store-outcomes.js'
