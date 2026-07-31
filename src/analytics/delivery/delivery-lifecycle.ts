// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeliveries } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { DeliveryGrantRef } from '../governance/eligibility.js'
import type { GrantSendMutex } from '../governance/grant-serialization.js'
import { isUnexpired } from '../retention/expiry-guard.js'
import { eventExpiryForSendIn, markDeliverySendingIn, releaseDeliveryToPendingIn } from './settlement.js'
import { DELIVERY_PAYLOAD_SCHEMA_VERSION } from './sink.js'
import { activeGenerationOf, admitFence, eventGenerationIn, recheck, resolveGrantSendMutex } from './store.js'
import type { DeliveryStoreDeps } from './store.js'

const log = logger.child({ scope: 'analytics:delivery:lifecycle' })

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type EnqueueDeliveryInput = Readonly<{
  eventId: string
  sinkVersionId: string
  grant: DeliveryGrantRef
  nowMs: number
}>

export type EnqueueDeliveryResult = Readonly<{
  status: 'enqueued' | 'already_present' | 'grant_not_current' | 'generation_mismatch' | 'fence_held'
}>

const enqueueDeliveryIn = (tx: Tx, input: EnqueueDeliveryInput, deps: DeliveryStoreDeps): EnqueueDeliveryResult => {
  if (!recheck(deps, tx, input.grant)) {
    log.debug({ sinkVersionId: input.sinkVersionId }, 'delivery enqueue rejected: grant not current')
    return { status: 'grant_not_current' }
  }
  const generation = eventGenerationIn(tx, input.eventId)
  if (generation !== null && generation !== activeGenerationOf(deps)) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'delivery enqueue rejected: event is not in the active generation')
    return { status: 'generation_mismatch' }
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
}

export const enqueueDelivery = (
  input: EnqueueDeliveryInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): EnqueueDeliveryResult => {
  const db = deps.getDrizzleDb()
  const releaseFence = admitFence(deps)
  if (releaseFence === null) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'delivery enqueue refused: cutover fence held')
    return { status: 'fence_held' }
  }
  try {
    return db.transaction((tx) => enqueueDeliveryIn(tx, input, deps))
  } finally {
    releaseFence()
  }
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

export type MarkSendStartedResult =
  | 'started'
  | 'not_leased'
  | 'lease_expired'
  | 'grant_not_current'
  | 'event_expired'
  | 'generation_mismatch'
  | 'fence_held'
  | 'send_in_progress'

const cancelRowIn = (tx: Tx, eventId: string, sinkVersionId: string): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'cancelled', leaseUntilMs: null })
    .where(
      and(
        eq(analyticsDeliveries.eventId, eventId),
        eq(analyticsDeliveries.sinkVersionId, sinkVersionId),
        sql`${analyticsDeliveries.state} IN ('pending', 'leased')`,
      ),
    )
    .run()
}

const markSendStartedIn = (
  tx: Tx,
  input: MarkSendStartedInput,
  deps: DeliveryStoreDeps,
  mutex: GrantSendMutex,
): MarkSendStartedResult => {
  const row = tx
    .select()
    .from(analyticsDeliveries)
    .where(
      and(eq(analyticsDeliveries.eventId, input.eventId), eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId)),
    )
    .get()
  if (row === undefined) return 'not_leased'
  const expiresAtMs = eventExpiryForSendIn(tx, input.eventId)
  if (expiresAtMs === null || !isUnexpired(input.nowMs, expiresAtMs)) {
    cancelRowIn(tx, input.eventId, input.sinkVersionId)
    log.warn({ sinkVersionId: input.sinkVersionId }, 'send-start blocked: event expired')
    return 'event_expired'
  }
  if (row.state !== 'leased') return 'not_leased'
  if (row.leaseUntilMs === null || row.leaseUntilMs < input.nowMs) {
    releaseDeliveryToPendingIn(tx, input.eventId, input.sinkVersionId)
    return 'lease_expired'
  }
  if (!recheck(deps, tx, input.grant)) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'send-start blocked: grant not current')
    return 'grant_not_current'
  }
  if (eventGenerationIn(tx, input.eventId) !== activeGenerationOf(deps)) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'send-start blocked: event is not in the active generation')
    return 'generation_mismatch'
  }
  if (mutex.tryAcquire(input.grant.grantKey) === null) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'send-start blocked: another send holds the grant mutex')
    return 'send_in_progress'
  }
  try {
    markDeliverySendingIn(tx, input.eventId, input.sinkVersionId, input.nowMs)
  } catch (error) {
    mutex.release(input.grant.grantKey)
    throw error
  }
  return 'started'
}

export const markSendStarted = (
  input: MarkSendStartedInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): MarkSendStartedResult => {
  const db = deps.getDrizzleDb()
  const mutex = resolveGrantSendMutex(deps)
  const releaseFence = admitFence(deps)
  if (releaseFence === null) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'send-start refused: cutover fence held')
    return 'fence_held'
  }
  try {
    return db.transaction((tx) => markSendStartedIn(tx, input, deps, mutex))
  } finally {
    releaseFence()
  }
}
