// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { catalogCoverage, STORY_TIERS, type StoryTier } from '../../tests/stories/catalog/coverage.js'

type TierTally = Readonly<Record<StoryTier, number>>

export type StoryCoverageTotals = Readonly<{
  total: number
  executable: number
  pending: number
  readiness: Readonly<{ 'executable-as-is': number; 'needs-seam': number; blocked: number }>
  executableByTier: TierTally
  pendingByUnblockingTier: TierTally
}>

function emptyTierTally(): Record<StoryTier, number> {
  return { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 }
}

export function storyCoverageTotals(): StoryCoverageTotals {
  const readiness = { 'executable-as-is': 0, 'needs-seam': 0, blocked: 0 }
  const executableByTier = emptyTierTally()
  const pendingByUnblockingTier = emptyTierTally()
  let executable = 0
  for (const coverage of catalogCoverage) {
    if (coverage.kind === 'executable') {
      executable += 1
      executableByTier[coverage.provingTier] += 1
      continue
    }
    const { readiness: state } = coverage.audit
    readiness[state.state] += 1
    if (state.state === 'needs-seam') pendingByUnblockingTier[state.unblockedByTier] += 1
  }
  return {
    total: catalogCoverage.length,
    executable,
    pending: catalogCoverage.length - executable,
    readiness,
    executableByTier,
    pendingByUnblockingTier,
  }
}

function formatTierTally(tally: TierTally): string {
  return STORY_TIERS.map((tier) => `T${tier} ${tally[tier]}`).join(', ')
}

export function formatStoryCoverageTotals(totals: StoryCoverageTotals = storyCoverageTotals()): string {
  return [
    `story catalog: ${totals.executable}/${totals.total} executable (${formatTierTally(totals.executableByTier)})`,
    `pending ${totals.pending} (${totals.readiness['executable-as-is']} executable-as-is, ${totals.readiness['needs-seam']} needs-seam, ${totals.readiness.blocked} blocked)`,
    `pending unblocked by tier (${formatTierTally(totals.pendingByUnblockingTier)})`,
  ].join('; ')
}
