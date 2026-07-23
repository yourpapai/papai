// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { computePercentiles } from '../../../scripts/behavior-audit/report-index-helpers.js'

describe('computePercentiles', () => {
  test('single-element domain returns [100]', () => {
    expect(computePercentiles([3.0])).toEqual([100])
  })

  test('two-element domain: higher score gets higher percentile', () => {
    const result = computePercentiles([2.0, 4.0])
    expect(result.length).toBe(2)
    expect(result[0]!).toBeLessThan(result[1]!)
  })

  test('all-equal scores return all 100', () => {
    expect(computePercentiles([3.0, 3.0, 3.0])).toEqual([100, 100, 100])
  })

  test('10-element domain with one low outlier flags bottom decile', () => {
    const scores = [4.5, 4.4, 4.3, 4.2, 4.1, 4.0, 3.9, 3.8, 3.7, 1.0]
    const percentiles = computePercentiles(scores)
    expect(percentiles[9]).toBeLessThan(10)
  })

  test('ties at boundary both flagged', () => {
    const scores = [5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1]
    const percentiles = computePercentiles(scores)
    const bottomDecile = percentiles.filter((p) => p < 10)
    expect(bottomDecile.length).toBe(2)
  })

  test('empty input returns empty', () => {
    expect(computePercentiles([])).toEqual([])
  })
})
