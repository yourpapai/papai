// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsAggregateDeliveries,
  analyticsDeliveries,
  analyticsEpochSourceCounters,
  analyticsEvents,
  analyticsNormalizationRejections,
  analyticsProcessEpochs,
  analyticsSnapshotPublications,
} from '../../db/schema.js'
import { runReconciliation } from './reconcile.js'

const DAY_MS = 86_400_000
const SNAPSHOT_FRESHNESS_SLO_MS = 2 * 3_600_000

export type StageBDayReason = 'ok' | 'restart_gap' | 'delta' | 'incomplete_day'

export type StageBDayReport = Readonly<{
  day: string
  completeUtcDay: boolean
  eligible: boolean
  reason: StageBDayReason
  reconciliation: 'reconciled' | 'gap' | 'delta'
  unexplainedDelta: number
  restartGap: boolean
  rejects: Readonly<{ total: number; byReason: Readonly<Record<string, number>> }>
  overflow: number
  expiry: Readonly<{ ok: boolean; earliestDeadlineMs: number | null; expiredRows: number }>
  snapshot: Readonly<{ snapshotId: string | null; publishedAtMs: number | null; fresh: boolean }>
  delivery: Readonly<{ sending: number; ambiguous: number }>
}>

export type StageBReportDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>

const dayBounds = (day: string): Readonly<{ startMs: number; endMs: number }> => {
  const startMs = Date.parse(`${day}T00:00:00.000Z`)
  return { startMs, endMs: startMs + DAY_MS }
}

const hasRestartGap = (db: Db, startMs: number, endMs: number): boolean =>
  db
    .select({ epochId: analyticsProcessEpochs.epochId })
    .from(analyticsProcessEpochs)
    .where(
      and(
        eq(analyticsProcessEpochs.state, 'stale_open'),
        sql`${analyticsProcessEpochs.startedAtMs} < ${endMs}`,
        sql`(${analyticsProcessEpochs.staleMarkedAtMs} IS NULL OR ${analyticsProcessEpochs.staleMarkedAtMs} >= ${startMs})`,
      ),
    )
    .all().length > 0

const collectRejects = (db: Db, day: string): StageBDayReport['rejects'] => {
  const rows = db
    .select({ reason: analyticsNormalizationRejections.reason, count: analyticsNormalizationRejections.count })
    .from(analyticsNormalizationRejections)
    .where(eq(analyticsNormalizationRejections.utcDay, day))
    .all()
  const byReason: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    byReason[row.reason] = (byReason[row.reason] ?? 0) + row.count
    total += row.count
  }
  return { total, byReason }
}

const collectOverflow = (db: Db, day: string): number =>
  db
    .select({ total: sql<number>`coalesce(sum(${analyticsEpochSourceCounters.value}), 0)` })
    .from(analyticsEpochSourceCounters)
    .where(
      and(
        eq(analyticsEpochSourceCounters.utcDay, day),
        eq(analyticsEpochSourceCounters.disposition, 'controlled_overflow'),
      ),
    )
    .get()?.total ?? 0

const collectExpiry = (db: Db, nowMs: number): StageBDayReport['expiry'] => {
  const row = db
    .select({
      earliest: sql<number | null>`min(${analyticsEvents.expiresAtMs})`,
      expired: sql<number>`coalesce(sum(case when ${analyticsEvents.expiresAtMs} <= ${nowMs} then 1 else 0 end), 0)`,
    })
    .from(analyticsEvents)
    .get()
  const expiredRows = row?.expired ?? 0
  return { ok: expiredRows === 0, earliestDeadlineMs: row?.earliest ?? null, expiredRows }
}

const collectSnapshot = (db: Db, nowMs: number): StageBDayReport['snapshot'] => {
  const row = db
    .select()
    .from(analyticsSnapshotPublications)
    .where(eq(analyticsSnapshotPublications.state, 'published'))
    .orderBy(sql`${analyticsSnapshotPublications.publishedAt} desc`)
    .limit(1)
    .get()
  const publishedAtMs = row?.publishedAt ?? null
  return {
    snapshotId: row?.snapshotId ?? null,
    publishedAtMs,
    fresh: publishedAtMs !== null && nowMs - publishedAtMs <= SNAPSHOT_FRESHNESS_SLO_MS,
  }
}

type DeliveryLedger = typeof analyticsDeliveries | typeof analyticsAggregateDeliveries

const countStates = (db: Db, table: DeliveryLedger): Readonly<{ sending: number; ambiguous: number }> => {
  const rows = db
    .select({ state: table.state, n: sql<number>`count(*)` })
    .from(table)
    .where(sql`${table.state} in ('sending', 'ambiguous')`)
    .groupBy(table.state)
    .all()
  let sending = 0
  let ambiguous = 0
  for (const row of rows) {
    if (row.state === 'sending') sending += row.n
    if (row.state === 'ambiguous') ambiguous += row.n
  }
  return { sending, ambiguous }
}

const sumCounts = (a: StageBDayReport['delivery'], b: StageBDayReport['delivery']): StageBDayReport['delivery'] => ({
  sending: a.sending + b.sending,
  ambiguous: a.ambiguous + b.ambiguous,
})

export const collectStageBDay = (
  input: Readonly<{ day: string; nowMs: number }>,
  deps: StageBReportDeps = { getDrizzleDb: defaultGetDrizzleDb },
): StageBDayReport => {
  const db = deps.getDrizzleDb()
  const { startMs, endMs } = dayBounds(input.day)
  const completeUtcDay = endMs <= input.nowMs
  const restartGap = hasRestartGap(db, startMs, endMs)
  const reconciliation = runReconciliation({ nowMs: input.nowMs, apply: false }, deps)
  const reason: StageBDayReason = completeUtcDay
    ? restartGap
      ? 'restart_gap'
      : reconciliation.status === 'delta'
        ? 'delta'
        : 'ok'
    : 'incomplete_day'
  return {
    day: input.day,
    completeUtcDay,
    eligible: reason === 'ok',
    reason,
    reconciliation: reconciliation.status,
    unexplainedDelta: reconciliation.durableUsage.unexplainedDeltaTotal,
    restartGap,
    rejects: collectRejects(db, input.day),
    overflow: collectOverflow(db, input.day),
    expiry: collectExpiry(db, input.nowMs),
    snapshot: collectSnapshot(db, input.nowMs),
    delivery: sumCounts(countStates(db, analyticsDeliveries), countStates(db, analyticsAggregateDeliveries)),
  }
}

const isoMinute = (ms: number): string => new Date(ms).toISOString().slice(0, 16)

const rejectsSummary = (rejects: StageBDayReport['rejects']): string =>
  rejects.total === 0
    ? '0'
    : `${rejects.total} (${Object.entries(rejects.byReason)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(', ')})`

export const formatDaySummary = (report: StageBDayReport): string =>
  [
    `day=${report.day} eligible=${report.eligible} reconciliation=${report.reconciliation} unexplained_delta=${report.unexplainedDelta}`,
    `  restart_gap=${report.restartGap} rejects=${rejectsSummary(report.rejects)} overflow_counters=${report.overflow}`,
    `  expiry_ok=${report.expiry.ok} expired_rows=${report.expiry.expiredRows} earliest_deadline=${report.expiry.earliestDeadlineMs === null ? 'none' : isoMinute(report.expiry.earliestDeadlineMs)}`,
    `  snapshot=${report.snapshot.snapshotId ?? 'none'} published=${report.snapshot.publishedAtMs === null ? 'none' : isoMinute(report.snapshot.publishedAtMs)} fresh=${report.snapshot.fresh}`,
    `  delivery sending=${report.delivery.sending} ambiguous=${report.delivery.ambiguous}`,
  ].join('\n')

export const formatWindowLogRow = (report: StageBDayReport): string =>
  `| ${report.day} | ${report.eligible} | ${report.reason === 'ok' ? '—' : report.reason} | ${report.snapshot.publishedAtMs === null ? 'none' : isoMinute(report.snapshot.publishedAtMs)} | ${report.unexplainedDelta} | ${rejectsSummary(report.rejects)} | ${report.overflow} | ${report.expiry.ok ? 'ok' : 'fail'} | — |`

export type StageBCliArgs = Readonly<{
  day: string | null
  dbPath: string | null
  logPath: string | null
  assess: boolean
}>

export const parseStageBArgs = (argv: readonly string[]): StageBCliArgs => {
  let day: string | null = null
  let dbPath: string | null = null
  let logPath: string | null = null
  let assess = false
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--assess') assess = true
    else if (flag === '--day' || flag === '--db' || flag === '--log') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${flag}`)
      index += 1
      if (flag === '--day') day = value
      else if (flag === '--db') dbPath = value
      else logPath = value
    } else throw new Error(`unknown argument: ${flag}`)
  }
  return { day, dbPath, logPath, assess }
}
