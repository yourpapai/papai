// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { percentiles } from '../../src/stats/aggregate.js'

describe('percentiles', () => {
  test('empty input returns all zeros with count zero', () => {
    const result = percentiles([])

    expect(result).toEqual({
      count: 0,
      min: 0,
      p50: 0,
      p90: 0,
      p99: 0,
      max: 0,
      mean: 0,
    })
  })

  test('single value returns count one with all stats equal to that value', () => {
    const result = percentiles([5])

    expect(result.count).toBe(1)
    expect(result.min).toBe(5)
    expect(result.p50).toBe(5)
    expect(result.p90).toBe(5)
    expect(result.p99).toBe(5)
    expect(result.max).toBe(5)
    expect(result.mean).toBe(5)
  })

  test('1..10 sorted input yields expected percentiles and mean', () => {
    const result = percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    expect(result.count).toBe(10)
    expect(result.min).toBe(1)
    expect(result.max).toBe(10)
    expect(result.mean).toBe(5.5)
    expect(result.p50).toBeGreaterThanOrEqual(5)
    expect(result.p50).toBeLessThanOrEqual(6)
    expect(result.p90).toBeGreaterThanOrEqual(9)
    expect(result.p90).toBeLessThanOrEqual(10)
    expect(result.p99).toBeGreaterThanOrEqual(9)
    expect(result.p99).toBeLessThanOrEqual(10)
  })

  test('unsorted input is sorted internally and yields identical result', () => {
    const sorted = percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const unsorted = percentiles([10, 3, 7, 1, 9, 5, 2, 8, 4, 6])

    expect(unsorted).toEqual(sorted)
  })

  test('duplicate values are counted correctly', () => {
    const result = percentiles([2, 2, 2, 2, 2])

    expect(result.count).toBe(5)
    expect(result.min).toBe(2)
    expect(result.max).toBe(2)
    expect(result.mean).toBe(2)
    expect(result.p50).toBe(2)
    expect(result.p90).toBe(2)
    expect(result.p99).toBe(2)
  })

  test('does not mutate the input array', () => {
    const input = [10, 3, 7, 1, 9, 5, 2, 8, 4, 6]
    const snapshot = [...input]

    percentiles(input)

    expect(input).toEqual(snapshot)
  })
})
