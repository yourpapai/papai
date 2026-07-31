// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeliveries } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { DeliveryErrorClass } from './sink.js'
import { resolveGrantSendMutex } from './store.js'
import type { DeliveryStoreDeps } from './store.js'

const log = logger.child({ scope: 'analytics:delivery:store-outcomes' })

export type ClassifyDeliveryInput = Readonly<{
  eventId: string
  sinkVersionId: string
  nowMs: number
  outcome: 'delivered' | 'retryable' | 'ambiguous' | 'dead'
  grantKey: string
  remoteReceiptHash?: string
  errorClass?: DeliveryErrorClass
  retryAtMs?: number
}>

export type ClassifyDeliveryResult = 'classified' | 'not_sending' | 'lease_expired'

const classificationPatch = (input: ClassifyDeliveryInput): Partial<typeof analyticsDeliveries.$inferInsert> => {
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

export const classifyDelivery = (
  input: ClassifyDeliveryInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): ClassifyDeliveryResult => {
  const db = deps.getDrizzleDb()
  const mutex = resolveGrantSendMutex(deps)
  let heldGrantKey: string | null = null
  try {
    return db.transaction((tx) => {
      const row = tx
        .select()
        .from(analyticsDeliveries)
        .where(
          and(
            eq(analyticsDeliveries.eventId, input.eventId),
            eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId),
          ),
        )
        .get()
      if (row === undefined || row.state !== 'sending') {
        if (row === undefined && mutex.isHeld(input.grantKey)) {
          heldGrantKey = input.grantKey
        }
        return 'not_sending'
      }
      heldGrantKey = row.grantKey
      if (row.leaseUntilMs === null || row.leaseUntilMs < input.nowMs) return 'lease_expired'
      tx.update(analyticsDeliveries)
        .set(classificationPatch(input))
        .where(
          and(
            eq(analyticsDeliveries.eventId, input.eventId),
            eq(analyticsDeliveries.sinkVersionId, input.sinkVersionId),
          ),
        )
        .run()
      return 'classified'
    })
  } finally {
    if (heldGrantKey !== null) mutex.release(heldGrantKey)
  }
}

export const recoverOrphanedSends = (
  input: Readonly<{ nowMs: number }>,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): Readonly<{ moved: number }> => {
  const db = deps.getDrizzleDb()
  const orphans = db
    .select({ grantKey: analyticsDeliveries.grantKey })
    .from(analyticsDeliveries)
    .where(
      and(
        eq(analyticsDeliveries.state, 'sending'),
        sql`${analyticsDeliveries.leaseUntilMs} IS NULL OR ${analyticsDeliveries.leaseUntilMs} < ${input.nowMs}`,
      ),
    )
    .all()
  const result = db.$client
    .query<{ changes: number }, [number]>(
      `UPDATE analytics_deliveries SET state = 'ambiguous', lease_until_ms = NULL
     WHERE state = 'sending' AND (lease_until_ms IS NULL OR lease_until_ms < ?)`,
    )
    .run(input.nowMs)
  if (result.changes > 0) {
    const mutex = resolveGrantSendMutex(deps)
    for (const orphan of orphans) mutex.release(orphan.grantKey)
    log.info({ moved: result.changes }, 'orphaned sends marked ambiguous')
  }
  return { moved: result.changes }
}

export type ReconcileAmbiguousInput = Readonly<{
  eventId: string
  sinkVersionId: string
  outcome: 'delivered' | 'dead'
  remoteReceiptHash?: string
  errorClass?: DeliveryErrorClass
  nowMs: number
}>

export const reconcileAmbiguous = (
  input: ReconcileAmbiguousInput,
  deps: DeliveryStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): 'resolved' | 'not_ambiguous' => {
  const sqlite = deps.getDrizzleDb().$client
  const result =
    input.outcome === 'delivered'
      ? sqlite
          .query<{ changes: number }, [number, string | null, string, string]>(
            `UPDATE analytics_deliveries
             SET state = 'delivered', delivered_at_ms = ?, remote_receipt_hash = ?
             WHERE event_id = ? AND sink_version_id = ? AND state = 'ambiguous'`,
          )
          .run(input.nowMs, input.remoteReceiptHash ?? null, input.eventId, input.sinkVersionId)
      : sqlite
          .query<{ changes: number }, [string | null, string, string]>(
            `UPDATE analytics_deliveries
             SET state = 'dead', last_error_class = ?
             WHERE event_id = ? AND sink_version_id = ? AND state = 'ambiguous'`,
          )
          .run(input.errorClass ?? null, input.eventId, input.sinkVersionId)
  if (result.changes > 0) log.info({ sinkVersionId: input.sinkVersionId }, 'ambiguous delivery reconciled')
  return result.changes > 0 ? 'resolved' : 'not_ambiguous'
}

const HTTP_STATUS_PATTERN = /^status=(\d{3})/u

const statusClass = (status: number): DeliveryErrorClass | null => {
  if (status === 401 || status === 403) return 'auth'
  if (status >= 400 && status < 500) return 'http_4xx'
  if (status >= 500 && status < 600) return 'http_5xx'
  return null
}

export const classifySendError = (error: unknown): DeliveryErrorClass => {
  if (typeof error !== 'object' || error === null) return 'unknown'
  if ('status' in error && typeof error.status === 'number') {
    const fromStatus = statusClass(error.status)
    if (fromStatus !== null) return fromStatus
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
  if (code.includes('TIMEDOUT') || name === 'TimeoutError') return 'timeout'
  if (code.startsWith('E')) return 'network'
  const message = error instanceof Error ? error.message : ''
  const statusMatch = HTTP_STATUS_PATTERN.exec(message)
  if (statusMatch) {
    const fromMessage = statusClass(Number(statusMatch[1]))
    if (fromMessage !== null) return fromMessage
  }
  return 'unknown'
}
