// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { catalogCoverage } from '../../tests/stories/catalog/coverage.js'

export type StoryCoverageTotals = Readonly<{
  total: number
  executable: number
  pending: number
  readiness: Readonly<{ 'executable-as-is': number; 'needs-seam': number; blocked: number }>
}>

export function storyCoverageTotals(): StoryCoverageTotals {
  const readiness = { 'executable-as-is': 0, 'needs-seam': 0, blocked: 0 }
  let executable = 0
  for (const coverage of catalogCoverage) {
    if (coverage.kind === 'executable') executable += 1
    else readiness[coverage.audit.readiness.state] += 1
  }
  return {
    total: catalogCoverage.length,
    executable,
    pending: catalogCoverage.length - executable,
    readiness,
  }
}

export function formatStoryCoverageTotals(totals: StoryCoverageTotals = storyCoverageTotals()): string {
  return `story catalog: ${totals.executable}/${totals.total} executable; pending ${totals.pending} (${totals.readiness['executable-as-is']} executable-as-is, ${totals.readiness['needs-seam']} needs-seam, ${totals.readiness.blocked} blocked)`
}
