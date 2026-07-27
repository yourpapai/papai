// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsAggregateDeliveries, analyticsDeliveries } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { GrantSendMutex } from '../governance/grant-serialization.js'
import { isKillSwitchActive } from '../governance/policy-store.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { nextUtcDayStartMs, utcDayStartMs } from '../retention/expiry-guard.js'
import { classifyAggregateDelivery, recoverOrphanedAggregateSends } from './aggregate-delivery-classify.js'
import { leaseAggregateDeliveries, markAggregateSendStarted } from './aggregate-delivery-store.js'
import type { LeasedAggregateDelivery } from './aggregate-delivery-store.js'
import { markSendStarted } from './delivery-lifecycle.js'
import type { LookupAll } from './http-policy.js'
import { createEgressLimiter } from './pinned-transport.js'
import type { PinnedTransport } from './pinned-transport.js'
import { classifyDelivery, leaseDeliveries, recoverOrphanedSends } from './store.js'
import type { DeliveryStoreDeps, LeasedDelivery } from './store.js'
import { resolveSinkForSend, sendWithPolicy } from './worker-send.js'
import type { SinkConfigLoader } from './worker-send.js'

const log = logger.child({ scope: 'analytics:delivery:worker' })

export const WORKER_LEASE_MS = 30_000
export const WORKER_MAX_ATTEMPTS = 8
export const WORKER_BATCH_LIMIT = 25
export const WORKER_DEFAULT_CONCURRENCY = 2
export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAX_MS = 3_600_000
export const DEFAULT_DAILY_EGRESS_CAP = 10_000

export const computeRetryDelayMs = (attempts: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS)

export type WorkerSinkConfig = Readonly<{
  endpoint: string
  secret: string
  egressMode: string
  state: string
}>

export type DeliveryWorkerDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  fence?: RekeyCutoverFence
  grantMutex?: GrantSendMutex
  lookupAll?: LookupAll
  transport?: PinnedTransport
  loadSinkConfig?: SinkConfigLoader
  killSwitchActive?: () => boolean
  dailyEgressCap?: number
  concurrency?: number
  leaseMs?: number
  maxAttempts?: number
  batchLimit?: number
}>

export type WorkerTickResult = Readonly<{
  status: 'ok' | 'kill_switch' | 'cap_exhausted'
  leased: number
  delivered: number
  retryable: number
  ambiguous: number
  dead: number
}>

const EMPTY_RESULT: WorkerTickResult = {
  status: 'ok',
  leased: 0,
  delivered: 0,
  retryable: 0,
  ambiguous: 0,
  dead: 0,
}

const deliveredTodayCount = (deps: DeliveryWorkerDeps, dayStartMs: number): number => {
  const db = deps.getDrizzleDb()
  const events = db
    .select({ count: sql<number>`count(*)` })
    .from(analyticsDeliveries)
    .where(sql`${analyticsDeliveries.state} = 'delivered' AND ${analyticsDeliveries.deliveredAtMs} >= ${dayStartMs}`)
    .get()
  const releases = db
    .select({ count: sql<number>`count(*)` })
    .from(analyticsAggregateDeliveries)
    .where(
      sql`${analyticsAggregateDeliveries.state} = 'delivered' AND ${analyticsAggregateDeliveries.deliveredAtMs} >= ${dayStartMs}`,
    )
    .get()
  return (events?.count ?? 0) + (releases?.count ?? 0)
}

const deferDuePendingRows = (deps: DeliveryWorkerDeps, nowMs: number): void => {
  const db = deps.getDrizzleDb()
  const nextAttemptAtMs = nextUtcDayStartMs(nowMs)
  db.update(analyticsDeliveries)
    .set({ nextAttemptAtMs })
    .where(sql`${analyticsDeliveries.state} = 'pending' AND ${analyticsDeliveries.nextAttemptAtMs} <= ${nowMs}`)
    .run()
  db.update(analyticsAggregateDeliveries)
    .set({ nextAttemptAtMs })
    .where(
      sql`${analyticsAggregateDeliveries.state} = 'pending' AND ${analyticsAggregateDeliveries.nextAttemptAtMs} <= ${nowMs}`,
    )
    .run()
  log.info({ nextAttemptAtMs }, 'daily egress cap exhausted: due rows deferred to the next UTC day')
}

type SendCounters = { delivered: number; retryable: number; ambiguous: number; dead: number }

const sendEventRow = async (
  row: LeasedDelivery,
  deps: DeliveryWorkerDeps,
  storeDeps: DeliveryStoreDeps,
  nowMs: number,
  counters: SendCounters,
): Promise<void> => {
  const started = markSendStarted(
    { eventId: row.eventId, sinkVersionId: row.sinkVersionId, grant: row.grant, nowMs },
    storeDeps,
  )
  if (started !== 'started') {
    log.debug({ sinkVersionId: row.sinkVersionId, reason: started }, 'send-start refused; row left for settlement')
    return
  }
  const config = resolveSinkForSend(deps, row.sinkVersionId)
  const classification =
    config === null
      ? ({ outcome: 'retryable', errorClass: 'policy' } as const)
      : await sendWithPolicy(config, JSON.stringify([row.payload]), deps)
  const fenceAdmission = deps.fence?.admit('delivery')
  try {
    classifyDelivery(
      {
        eventId: row.eventId,
        sinkVersionId: row.sinkVersionId,
        grantKey: row.grant.grantKey,
        nowMs,
        outcome: classification.outcome,
        remoteReceiptHash: classification.remoteReceiptHash,
        errorClass: classification.errorClass,
        retryAtMs: nowMs + computeRetryDelayMs(row.attempts),
      },
      storeDeps,
    )
    counters[classification.outcome] += 1
  } finally {
    fenceAdmission?.release()
  }
}

const sendAggregateRow = async (
  row: LeasedAggregateDelivery,
  deps: DeliveryWorkerDeps,
  nowMs: number,
  counters: SendCounters,
): Promise<void> => {
  const storeDeps = { getDrizzleDb: deps.getDrizzleDb, fence: deps.fence }
  const started = markAggregateSendStarted(
    { releaseId: row.releaseId, sinkVersionId: row.sinkVersionId, nowMs },
    storeDeps,
  )
  if (started !== 'started') {
    log.debug({ sinkVersionId: row.sinkVersionId, reason: started }, 'aggregate send-start refused')
    return
  }
  const config = resolveSinkForSend(deps, row.sinkVersionId)
  const classification =
    config === null
      ? ({ outcome: 'retryable', errorClass: 'policy' } as const)
      : await sendWithPolicy(config, row.payloadJson, deps)
  const classified = classifyAggregateDelivery(
    {
      releaseId: row.releaseId,
      sinkVersionId: row.sinkVersionId,
      nowMs,
      outcome: classification.outcome,
      remoteReceiptHash: classification.remoteReceiptHash,
      errorClass: classification.errorClass,
      retryAtMs: nowMs + computeRetryDelayMs(row.attempts),
    },
    storeDeps,
  )
  if (classified === 'classified') counters[classification.outcome] += 1
}

const sendLeasedRows = async (
  eventRows: readonly LeasedDelivery[],
  aggregateRows: readonly LeasedAggregateDelivery[],
  deps: DeliveryWorkerDeps,
  storeDeps: DeliveryStoreDeps,
  nowMs: number,
): Promise<SendCounters> => {
  const counters: SendCounters = { delivered: 0, retryable: 0, ambiguous: 0, dead: 0 }
  const limit = createEgressLimiter(deps.concurrency ?? WORKER_DEFAULT_CONCURRENCY)
  const tasks: Promise<void>[] = []
  for (const row of eventRows) {
    tasks.push(limit(() => sendEventRow(row, deps, storeDeps, nowMs, counters)))
  }
  for (const row of aggregateRows) {
    tasks.push(limit(() => sendAggregateRow(row, deps, nowMs, counters)))
  }
  await Promise.all(tasks)
  return counters
}

export const runDeliveryWorkerTick = async (
  input: Readonly<{ nowMs: number }>,
  deps: DeliveryWorkerDeps,
): Promise<WorkerTickResult> => {
  const killSwitch = deps.killSwitchActive ?? ((): boolean => isKillSwitchActive())
  if (killSwitch()) {
    log.warn('delivery worker skipped: environment kill switch is active')
    return { ...EMPTY_RESULT, status: 'kill_switch' }
  }
  const storeDeps: DeliveryStoreDeps = {
    getDrizzleDb: deps.getDrizzleDb,
    grantMutex: deps.grantMutex,
    fence: deps.fence,
  }
  const aggregateStoreDeps = { getDrizzleDb: deps.getDrizzleDb, fence: deps.fence }
  recoverOrphanedSends({ nowMs: input.nowMs }, storeDeps)
  recoverOrphanedAggregateSends({ nowMs: input.nowMs }, aggregateStoreDeps)

  const cap = deps.dailyEgressCap ?? DEFAULT_DAILY_EGRESS_CAP
  const dayStartMs = utcDayStartMs(new Date(input.nowMs).toISOString().slice(0, 10))
  const remaining = cap - deliveredTodayCount(deps, dayStartMs)
  if (remaining <= 0) {
    deferDuePendingRows(deps, input.nowMs)
    return { ...EMPTY_RESULT, status: 'cap_exhausted' }
  }

  const leaseMs = deps.leaseMs ?? WORKER_LEASE_MS
  const maxAttempts = deps.maxAttempts ?? WORKER_MAX_ATTEMPTS
  const batchLimit = Math.min(deps.batchLimit ?? WORKER_BATCH_LIMIT, remaining)
  const eventRows = leaseDeliveries({ nowMs: input.nowMs, leaseMs, limit: batchLimit, maxAttempts }, storeDeps)
  const aggregateRows = leaseAggregateDeliveries(
    { nowMs: input.nowMs, leaseMs, limit: batchLimit - eventRows.length, maxAttempts },
    aggregateStoreDeps,
  )

  const counters = await sendLeasedRows(eventRows, aggregateRows, deps, storeDeps, input.nowMs)
  return {
    status: 'ok',
    leased: eventRows.length + aggregateRows.length,
    ...counters,
  }
}
