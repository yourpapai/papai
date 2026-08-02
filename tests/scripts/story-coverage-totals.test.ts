// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatStoryCoverageTotals, storyCoverageTotals } from '../../scripts/story/coverage-totals.js'

describe('storyCoverageTotals', () => {
  test('tallies the catalog ledger', () => {
    expect(storyCoverageTotals()).toEqual({
      total: 218,
      executable: 193,
      pending: 25,
      readiness: { 'executable-as-is': 0, 'needs-seam': 3, blocked: 22 },
      executableByTier: { '0': 147, '1': 29, '2': 8, '3': 8, '4': 1 },
      pendingByUnblockingTier: { '0': 0, '1': 0, '2': 0, '3': 3, '4': 0 },
    })
  })

  test('formats a single summary line with per-tier tallies', () => {
    expect(formatStoryCoverageTotals()).toBe(
      'story catalog: 193/218 executable (T0 147, T1 29, T2 8, T3 8, T4 1); ' +
        'pending 25 (0 executable-as-is, 3 needs-seam, 22 blocked); ' +
        'pending unblocked by tier (T0 0, T1 0, T2 0, T3 3, T4 0)',
    )
  })
})
