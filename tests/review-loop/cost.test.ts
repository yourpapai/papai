// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { estimateCostUsd, matchPrice, PricingTableSchema } from '../../review-loop/src/cost.js'

describe('matchPrice', () => {
  const pricing = { 'claude-sonnet-*': { input: 3, output: 15 }, 'gpt-4o': { input: 2.5, output: 10 } }

  test('exact match wins over glob', () => {
    const table = { ...pricing, 'claude-sonnet-4': { input: 1, output: 1 } }
    expect(matchPrice(table, 'claude-sonnet-4')).toEqual({ input: 1, output: 1 })
  })

  test('glob match', () => {
    expect(matchPrice(pricing, 'claude-sonnet-4-20250514')).toEqual({ input: 3, output: 15 })
  })

  test('provider-prefixed model still globs when pattern covers it', () => {
    expect(matchPrice({ 'anthropic/claude-*': { input: 3, output: 15 } }, 'anthropic/claude-sonnet-4')).toEqual({
      input: 3,
      output: 15,
    })
  })

  test('no match returns undefined', () => {
    expect(matchPrice(pricing, 'llama-3')).toBeUndefined()
  })
})

describe('estimateCostUsd', () => {
  test('computes per-1M-token pricing', () => {
    expect(estimateCostUsd({ input: 3, output: 15 }, 100_000, 10_000)).toBeCloseTo(0.45, 10)
  })
})

describe('PricingTableSchema', () => {
  test('rejects negative prices', () => {
    expect(PricingTableSchema.safeParse({ m: { input: -1, output: 1 } }).success).toBe(false)
  })
})
