// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { analyticsAggregateDeliveries } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { keyFilter } from './aggregate-delivery-store.js'
import type { AggregateDeliveryStoreDeps } from './aggregate-delivery-store.js'
import type { DeliveryErrorClass } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:aggregate-delivery-classify' })

export type ClassifyAggregateDeliveryInput = Readonly<{
  releaseId: string
  sinkVersionId: string
  nowMs: number
  outcome: 'delivered' | 'retryable' | 'ambiguous' | 'dead'
  remoteReceiptHash?: string
  errorClass?: DeliveryErrorClass
  retryAtMs?: number
}>

export type ClassifyAggregateDeliveryResult = 'classified' | 'not_sending' | 'lease_expired'

const classificationPatch = (
  input: ClassifyAggregateDeliveryInput,
): Partial<typeof analyticsAggregateDeliveries.$inferInsert> => {
  if (input.outcome === 'delivered') {
    return {
      state: 'delivered',
      deliveredAtMs: input.nowMs,
      remoteReceiptHash: input.remoteReceiptHash ?? null,
      lastErrorClass: null,
      leaseUntilMs: null,
    }
  }
  if (input.outcome === 'retryable') {
    return {
      state: 'pending',
      nextAttemptAtMs: input.retryAtMs ?? input.nowMs,
      lastErrorClass: input.errorClass ?? null,
      leaseUntilMs: null,
      sendStartedAtMs: null,
    }
  }
  if (input.outcome === 'ambiguous') {
    return { state: 'ambiguous', lastErrorClass: input.errorClass ?? null, leaseUntilMs: null }
  }
  return { state: 'dead', lastErrorClass: input.errorClass ?? null, leaseUntilMs: null }
}

export const classifyAggregateDelivery = (
  input: ClassifyAggregateDeliveryInput,
  deps: AggregateDeliveryStoreDeps,
): ClassifyAggregateDeliveryResult => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(analyticsAggregateDeliveries)
      .where(keyFilter(input.releaseId, input.sinkVersionId))
      .get()
    if (row === undefined || row.state !== 'sending') return 'not_sending'
    if (row.leaseUntilMs === null || row.leaseUntilMs < input.nowMs) return 'lease_expired'
    tx.update(analyticsAggregateDeliveries)
      .set(classificationPatch(input))
      .where(keyFilter(input.releaseId, input.sinkVersionId))
      .run()
    return 'classified'
  })
}

export type ReconcileAggregateAmbiguousInput = Readonly<{
  releaseId: string
  sinkVersionId: string
  outcome: 'delivered' | 'dead'
  remoteReceiptHash?: string
  errorClass?: DeliveryErrorClass
  nowMs: number
}>

export const reconcileAggregateAmbiguous = (
  input: ReconcileAggregateAmbiguousInput,
  deps: AggregateDeliveryStoreDeps,
): 'resolved' | 'not_ambiguous' => {
  const sqlite = deps.getDrizzleDb().$client
  const result =
    input.outcome === 'delivered'
      ? sqlite
          .query<{ changes: number }, [number, string | null, string, string]>(
            `UPDATE analytics_aggregate_deliveries
             SET state = 'delivered', delivered_at_ms = ?, remote_receipt_hash = ?
             WHERE release_id = ? AND sink_version_id = ? AND state = 'ambiguous'`,
          )
          .run(input.nowMs, input.remoteReceiptHash ?? null, input.releaseId, input.sinkVersionId)
      : sqlite
          .query<{ changes: number }, [string | null, string, string]>(
            `UPDATE analytics_aggregate_deliveries
             SET state = 'dead', last_error_class = ?
             WHERE release_id = ? AND sink_version_id = ? AND state = 'ambiguous'`,
          )
          .run(input.errorClass ?? null, input.releaseId, input.sinkVersionId)
  if (result.changes > 0) log.info({ sinkVersionId: input.sinkVersionId }, 'ambiguous aggregate delivery reconciled')
  return result.changes > 0 ? 'resolved' : 'not_ambiguous'
}

export const recoverOrphanedAggregateSends = (
  input: Readonly<{ nowMs: number }>,
  deps: AggregateDeliveryStoreDeps,
): Readonly<{ moved: number }> => {
  const result = deps
    .getDrizzleDb()
    .$client.query<{ changes: number }, [number]>(
      `UPDATE analytics_aggregate_deliveries SET state = 'ambiguous', lease_until_ms = NULL
       WHERE state = 'sending' AND (lease_until_ms IS NULL OR lease_until_ms < ?)`,
    )
    .run(input.nowMs)
  if (result.changes > 0) log.info({ moved: result.changes }, 'orphaned aggregate sends marked ambiguous')
  return { moved: result.changes }
}
