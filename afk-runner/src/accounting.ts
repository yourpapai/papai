// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import pLimit from 'p-limit'

import type { SddEvent } from './events.js'
import { readEvents } from './events.js'
import { readAllRunStates } from './run-index.js'
import type { PersistedLite } from './run-lite.js'
import { usageTotalsOf } from './work/gate-signals.js'
import { gateDwellsMs } from './work/report.js'

/**
 * Cross-run accounting (U9 report half): a passive, read-only roster +
 * totals view over the afk work dir. Roster rows come from the run-index
 * memos; numbers fold each run's event log — the memo schema stays frozen
 * (the parity oracle is the retirement gate). Enforcement stays parked
 * with U5; this surface only reports.
 */

/** A roster row plus its folded log (null when the log is missing or unreadable — degraded). */
export interface RunAccountingInput extends PersistedLite {
  readonly events: readonly SddEvent[] | null
}

/** Bounded concurrency for the per-run log scan (the unbounded-Promise.all convention). */
const LOG_SCAN_CONCURRENCY = 4

/**
 * The fs tolerance shell (D5): roster from the run-index memos, numbers from
 * one pass over each run's event log. Unreadable memos drop the row (index
 * behavior); a missing or corrupt log degrades the row instead of failing
 * the listing — a listing never dies on one run's data.
 */
export async function summarizeWorkDir(workDir: string): Promise<AccountingSummary> {
  const roster = await readAllRunStates(workDir)
  const limit = pLimit(LOG_SCAN_CONCURRENCY)
  const inputs = await Promise.all(
    roster.map((entry) =>
      limit((): RunAccountingInput => {
        try {
          const events = readEvents(path.join(workDir, 'runs', entry.runId, 'events.ndjson'))
          return { ...entry, events }
        } catch {
          return { ...entry, events: null }
        }
      }),
    ),
  )
  return aggregate(inputs)
}

export interface AccountedRow {
  readonly runId: string
  /** The session id, or the change name when the id is a legacy datetime form. */
  readonly identity: string
  /** Terminal/live status, or `gate:<mode> v<version>` when parked at an unanswered gate. */
  readonly status: string
  readonly tokens: number | null
  readonly wallMs: number | null
  readonly updatedAt: string
}

export interface AccountingTotals {
  readonly runs: number
  readonly byStatus: Readonly<Record<string, number>>
  readonly gatePending: number
  readonly tokens: number
  readonly wallMs: number
  readonly dwellMs: number
  readonly costUsd: number
  /** Runs whose spend is unknown: unmetered tokens or a degraded row (lower-bound pricing). */
  readonly unpricedCount: number
}

export interface AccountingSummary {
  readonly rows: readonly AccountedRow[]
  readonly totals: AccountingTotals
}

/** Legacy `makeRunId` shape: `<iso-datetime with [:.] as ->-<uuid8>` (pre session-id allocation). */
const LEGACY_DATETIME_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]+$/u

function identityOf(runId: string, changeName: string): string {
  return LEGACY_DATETIME_ID.test(runId) ? changeName : runId
}

function statusOf(row: PersistedLite): string {
  return row.gate === null ? row.status : `gate:${row.gate.mode} v${row.gate.version}`
}

/** Wall from log timestamps (D3): last event ts − first event ts — fresh for live runs. */
function wallMsOf(events: readonly SddEvent[]): number | null {
  if (events.length === 0) return null
  const first = events[0]
  const last = events[events.length - 1]
  if (first === undefined || last === undefined) return null
  return Math.max(0, Date.parse(last.ts) - Date.parse(first.ts))
}

/** The rendered row shape shared by every accountRun outcome (tokens/wall null on a degraded row). */
function rowOf(input: RunAccountingInput, tokens: number | null, wallMs: number | null): AccountedRow {
  return {
    runId: input.runId,
    identity: identityOf(input.runId, input.changeName),
    status: statusOf(input),
    tokens,
    wallMs,
    updatedAt: input.updatedAt,
  }
}

/** One run's accounting: the rendered row plus its contributions to the totals (D5 degraded rows never fabricate zeros). */
function accountRun(input: RunAccountingInput): {
  readonly row: AccountedRow
  readonly dwellMs: number
  readonly costUsd: number
  readonly unpriced: 0 | 1
} {
  if (input.events === null) {
    return { row: rowOf(input, null, null), dwellMs: 0, costUsd: 0, unpriced: 1 }
  }
  let dwellMs = 0
  for (const dwell of gateDwellsMs(input.events)) dwellMs += dwell
  const usage = usageTotalsOf(input.events)
  return {
    row: rowOf(input, usage.tokens, wallMsOf(input.events)),
    dwellMs,
    costUsd: usage.costUsd,
    unpriced: usage.costKnown ? 0 : 1,
  }
}

/** The pure aggregation core: roster rows + per-run logs → rendered rows and honest totals. */
export function aggregate(inputs: readonly RunAccountingInput[]): AccountingSummary {
  const ordered = [...inputs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const rows: AccountedRow[] = []
  const byStatus: Record<string, number> = {}
  let gatePending = 0
  let dwellTotal = 0
  let costTotal = 0
  let unpriced = 0
  for (const input of ordered) {
    byStatus[input.status] = (byStatus[input.status] ?? 0) + 1
    if (input.gate !== null) gatePending += 1
    const accounted = accountRun(input)
    rows.push(accounted.row)
    dwellTotal += accounted.dwellMs
    costTotal += accounted.costUsd
    unpriced += accounted.unpriced
  }
  const tokensTotal = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
  const wallTotal = rows.reduce((sum, row) => sum + (row.wallMs ?? 0), 0)
  return {
    rows,
    totals: {
      runs: rows.length,
      byStatus,
      gatePending,
      tokens: tokensTotal,
      wallMs: wallTotal,
      dwellMs: dwellTotal,
      costUsd: costTotal,
      unpricedCount: unpriced,
    },
  }
}

export const UNKNOWN = '—'

function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** Tokens-first spend rendering: compact with one decimal above a thousand. */
export function formatTokens(tokens: number | null): string {
  if (tokens === null) return UNKNOWN
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${oneDecimal(tokens / 1_000)}K`
  if (tokens < 1_000_000_000) return `${oneDecimal(tokens / 1_000_000)}M`
  return `${oneDecimal(tokens / 1_000_000_000)}B`
}

/** Duration rendering: seconds under a minute, minutes under a day (the gains-line convention), days above. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return UNKNOWN
  const seconds = ms / 1_000
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = seconds / 60
  if (minutes < 24 * 60) return `${Math.round(minutes)}m`
  return `${oneDecimal(minutes / (24 * 60))}d`
}

function formatCost(totals: AccountingTotals): string {
  const amount = `$${totals.costUsd.toFixed(2)}`
  return totals.unpricedCount === 0 ? amount : `≥ ${amount} (${totals.unpricedCount} unpriced)`
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width)
}

/** The roster + footer the `runs` verb prints. */
export function renderRunsReport(summary: AccountingSummary): string {
  const identityWidth = Math.max('run'.length, ...summary.rows.map((row) => row.identity.length))
  const statusWidth = Math.max('status'.length, ...summary.rows.map((row) => row.status.length))
  const lines: string[] = [
    `${pad('run', identityWidth)}  ${pad('status', statusWidth)}  tokens  wall`,
    ...summary.rows.map(
      (row) =>
        `${pad(row.identity, identityWidth)}  ${pad(row.status, statusWidth)}  ${pad(formatTokens(row.tokens), 6)}  ${formatDuration(row.wallMs)}`,
    ),
  ]
  if (summary.rows.length > 0) {
    const counts = Object.keys(summary.totals.byStatus)
      .sort()
      .map((status) => `${status}: ${summary.totals.byStatus[status] ?? 0}`)
    if (summary.totals.gatePending > 0) counts.push(`gate-pending: ${summary.totals.gatePending}`)
    const { totals } = summary
    lines.push(
      `totals: ${totals.runs} runs · ${counts.join(' · ')} · tokens: ${formatTokens(totals.tokens)} · wall: ${formatDuration(totals.wallMs)} · dwell: ${formatDuration(totals.dwellMs)} · cost: ${formatCost(totals)}`,
    )
  } else {
    lines.push('totals: 0 runs · tokens: 0 · wall: 0s · dwell: 0s · cost: $0.00')
  }
  return lines.join('\n')
}
