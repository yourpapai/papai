// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatStoryCoverageTotals, storyCoverageTotals } from '../../scripts/story/coverage-totals.js'

describe('storyCoverageTotals', () => {
  test('tallies the catalog ledger', () => {
    expect(storyCoverageTotals()).toEqual({
      total: 128,
      executable: 101,
      pending: 27,
      readiness: { 'executable-as-is': 0, 'needs-seam': 5, blocked: 22 },
    })
  })

  test('formats a single summary line', () => {
    expect(formatStoryCoverageTotals()).toBe(
      'story catalog: 101/128 executable; pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked)',
    )
  })
})
