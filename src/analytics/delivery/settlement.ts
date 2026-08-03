// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeliveries, analyticsEvents } from '../../db/schema.js'
import type { AnalyticsDeliveryRow } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:delivery:settlement' })

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export const cancelNeverStartedIn = (tx: Tx, eventIds: readonly string[]): number => {
  if (eventIds.length === 0) return 0
  const filter = and(
    inArray(analyticsDeliveries.eventId, [...eventIds]),
    or(eq(analyticsDeliveries.state, 'pending'), eq(analyticsDeliveries.state, 'leased')),
    isNull(analyticsDeliveries.sendStartedAtMs),
  )
  const count = tx.select({ eventId: analyticsDeliveries.eventId }).from(analyticsDeliveries).where(filter).all().length
  if (count === 0) return 0
  tx.update(analyticsDeliveries).set({ state: 'cancelled', leaseUntilMs: null }).where(filter).run()
  log.info({ count }, 'never-started deliveries cancelled')
  return count
}

export const markSendingAmbiguousIn = (tx: Tx, eventIds: readonly string[]): number => {
  if (eventIds.length === 0) return 0
  const filter = and(inArray(analyticsDeliveries.eventId, [...eventIds]), eq(analyticsDeliveries.state, 'sending'))
  const count = tx.select({ eventId: analyticsDeliveries.eventId }).from(analyticsDeliveries).where(filter).all().length
  if (count === 0) return 0
  tx.update(analyticsDeliveries).set({ state: 'ambiguous', leaseUntilMs: null }).where(filter).run()
  log.info({ count }, 'in-flight sends marked ambiguous for settlement')
  return count
}

export const deleteDeliveryRowsForEventsIn = (tx: Tx, eventIds: readonly string[]): number => {
  if (eventIds.length === 0) return 0
  const filter = inArray(analyticsDeliveries.eventId, [...eventIds])
  const count = tx.select({ eventId: analyticsDeliveries.eventId }).from(analyticsDeliveries).where(filter).all().length
  if (count === 0) return 0
  tx.delete(analyticsDeliveries).where(filter).run()
  log.info({ count }, 'delivery rows removed after settlement')
  return count
}

export const listDeliveryRowsForEvents = (
  db: Db | Tx,
  eventIds: readonly string[],
): readonly AnalyticsDeliveryRow[] => {
  if (eventIds.length === 0) return []
  return db
    .select()
    .from(analyticsDeliveries)
    .where(inArray(analyticsDeliveries.eventId, [...eventIds]))
    .all()
}

const deliveryKeyFilter = (eventId: string, sinkVersionId: string): SQL | undefined =>
  and(eq(analyticsDeliveries.eventId, eventId), eq(analyticsDeliveries.sinkVersionId, sinkVersionId))

export const releaseDeliveryToPendingIn = (tx: Tx, eventId: string, sinkVersionId: string): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'pending', leaseUntilMs: null })
    .where(deliveryKeyFilter(eventId, sinkVersionId))
    .run()
}

export const eventExpiryForSendIn = (tx: Tx, eventId: string): number | null => {
  const eventRow = tx
    .select({ expiresAtMs: analyticsEvents.expiresAtMs })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.eventId, eventId))
    .get()
  return eventRow?.expiresAtMs ?? null
}

export const markDeliverySendingIn = (tx: Tx, eventId: string, sinkVersionId: string, nowMs: number): void => {
  tx.update(analyticsDeliveries)
    .set({ state: 'sending', sendStartedAtMs: nowMs })
    .where(and(deliveryKeyFilter(eventId, sinkVersionId), eq(analyticsDeliveries.state, 'leased')))
    .run()
}
