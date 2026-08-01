// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RoundMetric, Severity, SeverityCounts } from './trace-log.js'

const SEV_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum =
    counts.critical * SEV_WEIGHT.critical +
    counts.high * SEV_WEIGHT.high +
    counts.medium * SEV_WEIGHT.medium +
    counts.low * SEV_WEIGHT.low
  return (sum / total).toFixed(1)
}

export function burndownBlock(metrics: readonly RoundMetric[]): string {
  const header = '  round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej  avgRev  avgFix'
  const rows = metrics.map((m) => {
    const decided =
      m.decisions.fixed +
      m.decisions.invalid +
      m.decisions.already_fixed +
      m.decisions.needs_human +
      m.decisions.plan_drift +
      m.decisions.no_commit +
      m.decisions.inspector_rejected
    return [
      `  ${String(m.round).padEnd(6)}`,
      String(m.newIssues).padEnd(4),
      String(m.cumulativeOpen).padEnd(5),
      String(m.decisions.fixed).padEnd(6),
      String(m.decisions.invalid).padEnd(9),
      String(m.decisions.needs_human).padEnd(12),
      String(m.decisions.plan_drift).padEnd(11),
      String(m.decisions.inspector_rejected).padEnd(9),
      avgSeverity(m.reviewerSeverity, m.newIssues).padEnd(7),
      avgSeverity(m.fixerSeverity, decided),
    ].join('')
  })
  return ['Burndown:', header, ...rows].join('\n')
}

export function burndownIsEmpty(metrics: readonly RoundMetric[]): boolean {
  return metrics.every(
    (m) =>
      m.newIssues === 0 &&
      m.cumulativeOpen === 0 &&
      m.decisions.fixed === 0 &&
      m.decisions.invalid === 0 &&
      m.decisions.already_fixed === 0 &&
      m.decisions.needs_human === 0 &&
      m.decisions.plan_drift === 0 &&
      m.decisions.no_commit === 0 &&
      m.decisions.inspector_rejected === 0,
  )
}
