// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { burndownBlock, burndownIsEmpty } from '../../review-loop/src/summary-burndown.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'

function zeroMetric(round: number): RoundMetric {
  return {
    round,
    newIssues: 0,
    cumulativeOpen: 0,
    noProgressRounds: 0,
    decisions: {
      fixed: 0,
      invalid: 0,
      already_fixed: 0,
      needs_human: 0,
      plan_drift: 0,
      no_commit: 0,
      inspector_rejected: 0,
    },
    reviewerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    inspector: { runs: 0, rejected: 0 },
    phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  }
}

describe('burndownIsEmpty', () => {
  test('true when every round is entirely zero', () => {
    expect(burndownIsEmpty([zeroMetric(1), zeroMetric(2)])).toBe(true)
  })

  test('false as soon as any field is non-zero', () => {
    const metric = zeroMetric(1)
    metric.decisions.fixed = 1
    expect(burndownIsEmpty([metric])).toBe(false)
  })
})

describe('burndownBlock', () => {
  test('renders header and one row per round', () => {
    const block = burndownBlock([zeroMetric(1)])
    expect(block).toContain('Burndown:')
    expect(block).toContain('round')
    expect(block.split('\n')).toHaveLength(3)
  })
})
