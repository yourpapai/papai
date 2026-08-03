// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RoundMetric, Severity, SeverityCounts } from './trace-log.js'

const SEV_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const HEADERS = [
  '  round',
  'new',
  'open',
  'fixed',
  'rejected',
  'needs_human',
  'plan_drift',
  'insp_rej',
  'avgRev',
  'avgFix',
] as const

/** Cell widths matching HEADERS; 0 marks the last, unpadded column. */
const WIDTHS = [8, 4, 5, 6, 9, 12, 11, 9, 7, 0] as const

function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum =
    counts.critical * SEV_WEIGHT.critical +
    counts.high * SEV_WEIGHT.high +
    counts.medium * SEV_WEIGHT.medium +
    counts.low * SEV_WEIGHT.low
  return (sum / total).toFixed(1)
}

function decidedCount(m: RoundMetric): number {
  return (
    m.decisions.fixed +
    m.decisions.invalid +
    m.decisions.already_fixed +
    m.decisions.needs_human +
    m.decisions.plan_drift +
    m.decisions.no_commit +
    m.decisions.inspector_rejected
  )
}

function rowIsZero(m: RoundMetric): boolean {
  return m.newIssues === 0 && decidedCount(m) === 0
}

function renderRow(values: readonly string[]): string {
  return values
    .map((value, i) => {
      const width = WIDTHS[i] ?? 0
      return width === 0 ? value : value.padEnd(width)
    })
    .join('')
}

function dataRow(m: RoundMetric): string {
  return renderRow([
    `  ${m.round}`,
    String(m.newIssues),
    String(m.cumulativeOpen),
    String(m.decisions.fixed),
    String(m.decisions.invalid),
    String(m.decisions.needs_human),
    String(m.decisions.plan_drift),
    String(m.decisions.inspector_rejected),
    avgSeverity(m.reviewerSeverity, m.newIssues),
    avgSeverity(m.fixerSeverity, decidedCount(m)),
  ])
}

export function burndownBlock(metrics: readonly RoundMetric[]): string {
  const rows = metrics.filter((m) => !rowIsZero(m)).map(dataRow)
  if (rows.length === 0) return ''
  return ['Burndown:', renderRow(HEADERS), ...rows].join('\n')
}
