// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, lt, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeliveries, analyticsEvents } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { DeliveryGrantRef } from '../governance/eligibility.js'
import { resolveActive } from '../governance/generation-store.js'
import { createGrantSendMutex } from '../governance/grant-serialization.js'
import type { GrantSendMutex } from '../governance/grant-serialization.js'
import { checkGrantCurrentIn } from '../governance/grant-store.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { unexpiredEventFilter } from '../retention/expiry-guard.js'
import type { StrictDeliveryPayloadV1 } from './sink.js'
import { DELIVERY_PAYLOAD_SCHEMA_VERSION } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:store' })

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type GrantRecheck = (db: Db | Tx, ref: DeliveryGrantRef) => boolean

export type DeliveryStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  recheckGrant?: GrantRecheck
  grantMutex?: GrantSendMutex
  fence?: RekeyCutoverFence
}>

const defaultGrantSendMutex = createGrantSendMutex()

export const resolveGrantSendMutex = (deps: DeliveryStoreDeps): GrantSendMutex =>
  deps.grantMutex ?? defaultGrantSendMutex

export const recheck = (deps: DeliveryStoreDeps, db: Db | Tx, ref: DeliveryGrantRef): boolean =>
  (deps.recheckGrant ?? checkGrantCurrentIn)(db, ref)

export const admitFence = (deps: DeliveryStoreDeps): (() => void) | null => {
  if (deps.fence === undefined) return (): void => undefined
  const admission = deps.fence.admit('delivery')
  if (admission === null) return null
  return admission.release
}

export const activeGenerationOf = (deps: DeliveryStoreDeps): string =>
  resolveActive({ getDrizzleDb: deps.getDrizzleDb }).generation

export const eventGenerationIn = (db: Db | Tx, eventId: string): string | null => {
  const row = db
    .select({ storageGeneration: analyticsEvents.storageGeneration })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.eventId, eventId))
    .get()
  return row?.storageGeneration ?? null
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

const cancelExpiredPendingRows = (tx: Tx, nowMs: number): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'cancelled', leaseUntilMs: null })
    .where(
      and(
        eq(analyticsDeliveries.state, 'pending'),
        sql`EXISTS (
          SELECT 1 FROM ${analyticsEvents}
          WHERE ${analyticsEvents.eventId} = ${analyticsDeliveries.eventId}
            AND ${analyticsEvents.expiresAtMs} <= ${nowMs}
        )`,
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
    .set({ state: 'leased', attempts: row.attempts + 1, leaseUntilMs, sendStartedAtMs: null })
    .where(
      and(
        eq(analyticsDeliveries.eventId, row.eventId),
        eq(analyticsDeliveries.sinkVersionId, row.sinkVersionId),
        eq(analyticsDeliveries.state, 'pending'),
      ),
    )
    .run()
}

type LeaseCandidate = Readonly<{
  eventId: string
  sinkVersionId: string
  grantKey: string
  grantKeyVersion: string
  grantGeneration: number
  attempts: number
  eventName: string
  occurredAtMs: number
  propsJson: string
}>

const listLeaseCandidates = (tx: Tx, input: LeaseDeliveriesInput, generation: string): readonly LeaseCandidate[] =>
  tx
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
        eq(analyticsEvents.storageGeneration, generation),
        sql`${analyticsDeliveries.nextAttemptAtMs} <= ${input.nowMs}`,
        sql`${analyticsDeliveries.attempts} < ${input.maxAttempts}`,
        unexpiredEventFilter(input.nowMs),
      ),
    )
    .orderBy(analyticsDeliveries.nextAttemptAtMs)
    .limit(input.limit)
    .all()

const toLeasedDelivery = (row: LeaseCandidate, leaseUntilMs: number): LeasedDelivery => ({
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
})

export const leaseDeliveries = (
  input: LeaseDeliveriesInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): LeasedDelivery[] => {
  const db = deps.getDrizzleDb()
  const releaseFence = admitFence(deps)
  if (releaseFence === null) {
    log.warn('delivery lease refused: cutover fence held')
    return []
  }
  try {
    const leaseUntilMs = input.nowMs + input.leaseMs
    return db.transaction((tx) => {
      releaseExpiredLeases(tx, input.nowMs)
      cancelExpiredPendingRows(tx, input.nowMs)
      exhaustDeadRows(tx, input.maxAttempts)
      const eligible = listLeaseCandidates(tx, input, activeGenerationOf(deps)).filter((row) =>
        recheck(deps, tx, { grantKey: row.grantKey, keyVersion: row.grantKeyVersion, generation: row.grantGeneration }),
      )
      for (const row of eligible) leaseOne(tx, row, leaseUntilMs)
      return eligible.map((row) => toLeasedDelivery(row, leaseUntilMs))
    })
  } finally {
    releaseFence()
  }
}

export {
  classifyDelivery,
  classifySendError,
  recoverOrphanedSends,
  reconcileAmbiguous,
  type ClassifyDeliveryInput,
  type ClassifyDeliveryResult,
  type ReconcileAmbiguousInput,
} from './store-outcomes.js'
