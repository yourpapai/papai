// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LedgerIssueRecord, LedgerIssueStatus } from './issue-ledger.js'
import type { ReviewLoopResult } from './loop-controller.js'
import type { RoundMetric, Severity, SeverityCounts } from './trace-log.js'

const RESOLVED_STATUSES: ReadonlySet<LedgerIssueStatus> = new Set([
  'closed',
  'rejected',
  'already_fixed',
  'needs_human',
])

const SEV_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

interface StatusCounts {
  open: number
  closed: number
  rejected: number
  alreadyFixed: number
  needsHuman: number
  reopened: number
}

export interface MetricsJson {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  burndown: RoundMetric[]
  totals: StatusCounts
}

function countStatuses(records: LedgerIssueRecord[]): StatusCounts {
  return {
    open: records.filter((r) => !RESOLVED_STATUSES.has(r.status)).length,
    closed: records.filter((r) => r.status === 'closed').length,
    rejected: records.filter((r) => r.status === 'rejected').length,
    alreadyFixed: records.filter((r) => r.status === 'already_fixed').length,
    needsHuman: records.filter((r) => r.status === 'needs_human').length,
    reopened: records.filter((r) => r.status === 'reopened').length,
  }
}

function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum =
    counts.critical * SEV_WEIGHT.critical +
    counts.high * SEV_WEIGHT.high +
    counts.medium * SEV_WEIGHT.medium +
    counts.low * SEV_WEIGHT.low
  return (sum / total).toFixed(1)
}

function burndownBlock(metrics: RoundMetric[]): string {
  const header = 'round  new  open  fixed  rejected  needs_human  plan_drift  avgRev  avgFix'
  const rows = metrics.map((m) => {
    const decided =
      m.decisions.fixed +
      m.decisions.invalid +
      m.decisions.already_fixed +
      m.decisions.needs_human +
      m.decisions.plan_drift +
      m.decisions.no_commit
    return [
      String(m.round).padEnd(6),
      String(m.newIssues).padEnd(4),
      String(m.cumulativeOpen).padEnd(5),
      String(m.decisions.fixed).padEnd(6),
      String(m.decisions.invalid).padEnd(9),
      String(m.decisions.needs_human).padEnd(12),
      String(m.decisions.plan_drift).padEnd(11),
      avgSeverity(m.reviewerSeverity, m.newIssues).padEnd(7),
      avgSeverity(m.fixerSeverity, decided),
    ].join('')
  })
  return ['Burndown:', header, ...rows].join('\n')
}

export function formatSummary(result: ReviewLoopResult): string {
  const records = Object.values(result.ledger.issues)
  const counts = countStatuses(records)

  const lines = [
    `Done reason: ${result.doneReason}`,
    `Rounds executed: ${result.rounds}`,
    `Open issues: ${counts.open}`,
    `Closed issues: ${counts.closed}`,
    `Rejected issues: ${counts.rejected}`,
    `Already fixed: ${counts.alreadyFixed}`,
    `Needs human: ${counts.needsHuman}`,
    `Reopened issues: ${counts.reopened}`,
  ]

  if (result.metrics !== undefined && result.metrics.length > 0) {
    lines.push('')
    lines.push(burndownBlock(result.metrics))
  }

  return lines.join('\n')
}

export function buildMetricsJson(result: ReviewLoopResult): MetricsJson {
  const records = Object.values(result.ledger.issues)
  return {
    doneReason: result.doneReason,
    rounds: result.rounds,
    burndown: result.metrics ?? [],
    totals: countStatuses(records),
  }
}
