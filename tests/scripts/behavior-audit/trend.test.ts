// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { computeTrendDeltas, roundToOneDecimal } from '../../../scripts/behavior-audit/report-rebuild-helpers.js'

describe('roundToOneDecimal', () => {
  test('rounds 3.45 to 3.5', () => {
    expect(roundToOneDecimal(3.45)).toBe(3.5)
  })

  test('rounds 3.44 to 3.4', () => {
    expect(roundToOneDecimal(3.44)).toBe(3.4)
  })

  test('leaves 3.4 unchanged', () => {
    expect(roundToOneDecimal(3.4)).toBe(3.4)
  })
})

describe('computeTrendDeltas', () => {
  test('returns null for all entries when prior is null', () => {
    const current = [{ consolidatedId: 'a', composite: 3.5 }]
    const result = computeTrendDeltas(current, null)
    expect(result).toEqual([null])
  })

  test('returns null for ids missing in prior', () => {
    const current = [{ consolidatedId: 'a', composite: 3.5 }]
    const prior = [{ consolidatedId: 'b', composite: 3.0 }]
    const result = computeTrendDeltas(current, prior)
    expect(result).toEqual([null])
  })

  test('returns 0.0 when both round to same value', () => {
    const current = [{ consolidatedId: 'a', composite: 3.42 }]
    const prior = [{ consolidatedId: 'a', composite: 3.4 }]
    const result = computeTrendDeltas(current, prior)
    expect(result).toEqual([0])
  })

  test('returns +0.5 on increase from 3.4 to 3.9', () => {
    const current = [{ consolidatedId: 'a', composite: 3.9 }]
    const prior = [{ consolidatedId: 'a', composite: 3.4 }]
    const result = computeTrendDeltas(current, prior)
    expect(result).toEqual([0.5])
  })
})
