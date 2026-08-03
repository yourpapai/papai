// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { burndownBlock } from '../../review-loop/src/summary-burndown.js'
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

function busyMetric(round: number): RoundMetric {
  const metric = zeroMetric(round)
  metric.newIssues = 4
  metric.cumulativeOpen = 2
  metric.decisions.fixed = 2
  metric.decisions.invalid = 1
  metric.reviewerSeverity = { critical: 0, high: 1, medium: 2, low: 1 }
  metric.fixerSeverity = { critical: 0, high: 1, medium: 1, low: 1 }
  metric.phaseMs = { review: 178_300, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 }
  metric.usage = { inputTokens: 120_000, outputTokens: 8_000, reasoningTokens: 3_000, costUsd: 1.234 }
  return metric
}

describe('burndownBlock', () => {
  test('returns empty string when every round has zero activity', () => {
    expect(burndownBlock([zeroMetric(1), zeroMetric(2)])).toBe('')
  })

  test('renders header aligned with row columns', () => {
    const block = burndownBlock([busyMetric(1)])
    const lines = block.split('\n')
    expect(lines[0]).toBe('Burndown:')
    expect(lines[1]).toBe('  round new open fixed rejected needs_human plan_drift insp_rej avgRev avgFix')
    expect(lines[2]).toBe('  1     4   2    2     1        0           0          0        2.0    2.0')
  })

  test('drops zero-activity rows but keeps active ones', () => {
    const block = burndownBlock([busyMetric(1), zeroMetric(2)])
    const lines = block.split('\n')
    expect(lines).toHaveLength(3)
    expect(block).not.toContain('  2     0')
  })
})
