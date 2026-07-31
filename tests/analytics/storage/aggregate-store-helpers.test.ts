// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { arraysEqual, buildQualityColumns } from '../../../src/analytics/storage/aggregate-store-helpers.js'

describe('aggregate store helpers', () => {
  test('buildQualityColumns fills defaults', () => {
    const columns = buildQualityColumns({ disclosureScope: 'local_only', contributorBasis: 'not_required' })
    expect(columns).toEqual({
      finalized: false,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'not_required',
      contributorCount: null,
      threshold: null,
    })
  })

  test('arraysEqual compares numeric arrays', () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(arraysEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    expect(arraysEqual([1, 2], [1, 2, 3])).toBe(false)
  })
})
