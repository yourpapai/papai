// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_SHARD_CAP,
  DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS,
  DEFAULT_TARGET_WALL_SECONDS,
  ORCHESTRATION_OVERHEAD_SECONDS,
  resolveShardBudgetSeconds,
  resolveShardCount,
} from '../../../scripts/mutation/shard-sizing.js'
import type { ShardSizingInput } from '../../../scripts/mutation/shard-sizing.js'

const sized = (weights: readonly number[], overrides: Partial<ShardSizingInput> = {}): number =>
  resolveShardCount({
    weights,
    budgetSeconds: 230,
    cap: DEFAULT_SHARD_CAP,
    singleShardThresholdSeconds: DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS,
    ...overrides,
  })

describe('resolveShardCount', () => {
  test('divides a large measurement set into roughly work over budget', () => {
    // 24 targets x 110s = 2640s of work against a 230s budget.
    expect(sized(Array.from({ length: 24 }, () => 110))).toBe(Math.ceil(2640 / 230))
  })

  // LPT makespan is bounded below by the largest single item, so shards past
  // (total work / slowest item) buy nothing at all.
  test('the slowest target caps the useful shard count', () => {
    // 900s of work, but one 300s target: 230s budget would ask for 4, and 4 cannot beat 300s.
    const weights = [300, 300, 200, 100]
    expect(sized(weights)).toBe(Math.ceil(900 / 300))
  })

  test('never returns more shards than there are targets', () => {
    expect(sized([5000, 5000])).toBeLessThanOrEqual(2)
    expect(sized(Array.from({ length: 3 }, () => 100_000))).toBeLessThanOrEqual(3)
  })

  test('never exceeds the configured cap', () => {
    expect(
      sized(
        Array.from({ length: 400 }, () => 500),
        { cap: 12 },
      ),
    ).toBe(12)
    expect(
      sized(
        Array.from({ length: 400 }, () => 500),
        { cap: 8 },
      ),
    ).toBe(8)
  })

  describe('single-shard floor', () => {
    test('work below the threshold is not divided', () => {
      // 120s total, well under the threshold
      const weights = Array.from({ length: 3 }, () => 40)
      expect(sized(weights)).toBe(1)
    })

    test('work just above the threshold is divided', () => {
      const total = DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS + 60
      expect(sized([total / 2, total / 2])).toBeGreaterThan(1)
    })

    test('an empty measurement set asks for a single shard, not zero', () => {
      expect(sized([])).toBe(1)
    })

    test('one target is never divided, however expensive', () => {
      expect(sized([100_000])).toBe(1)
    })
  })

  test('the result is always a positive integer', () => {
    for (const weights of [[], [1], [1, 1], Array.from({ length: 37 }, (_v, i) => i * 13 + 1)]) {
      const count = sized(weights)
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('a nonsense budget still yields a usable shard count', () => {
    for (const budgetSeconds of [0, -100, Number.NaN]) {
      const count = sized(
        Array.from({ length: 10 }, () => 200),
        { budgetSeconds },
      )
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(10)
    }
  })
})

describe('resolveShardBudgetSeconds', () => {
  // The plan job has already built the coverage map when it sizes the matrix, so the budget
  // is a measured input rather than an assumption. See design.md D2.
  test('subtracts orchestration and the measured preparation cost from the wall target', () => {
    expect(resolveShardBudgetSeconds({ targetWallSeconds: 360, preparationSeconds: 1.2 })).toBeCloseTo(
      360 - ORCHESTRATION_OVERHEAD_SECONDS - 1.2,
      6,
    )
    expect(resolveShardBudgetSeconds({ targetWallSeconds: 360, preparationSeconds: 101.5 })).toBeCloseTo(
      360 - ORCHESTRATION_OVERHEAD_SECONDS - 101.5,
      6,
    )
  })

  test('a cold preparation leaves a smaller budget than a warm one', () => {
    const warm = resolveShardBudgetSeconds({ targetWallSeconds: 360, preparationSeconds: 1.2 })
    const cold = resolveShardBudgetSeconds({ targetWallSeconds: 360, preparationSeconds: 101.5 })
    expect(cold).toBeLessThan(warm)
  })

  test('preparation that swallows the whole wall target still leaves a positive budget', () => {
    const budget = resolveShardBudgetSeconds({ targetWallSeconds: 360, preparationSeconds: 10_000 })
    expect(budget).toBeGreaterThan(0)
    expect(Number.isFinite(budget)).toBe(true)
  })

  test('the default wall target is the documented one', () => {
    expect(resolveShardBudgetSeconds({ preparationSeconds: 0 })).toBeCloseTo(
      DEFAULT_TARGET_WALL_SECONDS - ORCHESTRATION_OVERHEAD_SECONDS,
      6,
    )
  })
})
