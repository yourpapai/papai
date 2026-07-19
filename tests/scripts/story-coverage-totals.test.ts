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
      executable: 65,
      pending: 63,
      readiness: { 'executable-as-is': 2, 'needs-seam': 39, blocked: 22 },
    })
  })

  test('formats a single summary line', () => {
    expect(formatStoryCoverageTotals()).toBe(
      'story catalog: 65/128 executable; pending 63 (2 executable-as-is, 39 needs-seam, 22 blocked)',
    )
  })
})
