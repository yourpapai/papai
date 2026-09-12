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
    reviewerExposure: { caller: 0, none: 0, unknown: 0 },
    fixerExposure: { caller: 0, none: 0, unknown: 0 },
    exposureDivergent: 0,
    reviewerKind: { defect: 0, cleanup: 0 },
    deferred: 0,
    checkBehind: {
      defect: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
      cleanup: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
    },
    phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
    },
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
  metric.usage = {
    inputTokens: 120_000,
    outputTokens: 8_000,
    reasoningTokens: 3_000,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd: 1.234,
  }
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

  test('renders "-" avgFix when decidedCount is zero (zero-total guard)', () => {
    const metric = zeroMetric(3)
    metric.newIssues = 2
    metric.cumulativeOpen = 5
    metric.reviewerSeverity = { critical: 0, high: 0, medium: 2, low: 0 }
    expect(burndownBlock([metric])).toBe(`Burndown:
  round new open fixed rejected needs_human plan_drift insp_rej avgRev avgFix
  3     2   5    0     0        0           0          0        2.0    -`)
  })

  test('weighs reviewerSeverity.critical by SEV_WEIGHT.critical (avgRev=4.0)', () => {
    const metric = zeroMetric(5)
    metric.newIssues = 1
    metric.cumulativeOpen = 1
    metric.reviewerSeverity = { critical: 1, high: 0, medium: 0, low: 0 }
    expect(burndownBlock([metric])).toBe(`Burndown:
  round new open fixed rejected needs_human plan_drift insp_rej avgRev avgFix
  5     1   1    0     0        0           0          0        4.0    -`)
  })

  test('counts every decision addend in decidedCount (avgFix=2.0)', () => {
    const metric = zeroMetric(7)
    metric.newIssues = 3
    metric.cumulativeOpen = 9
    metric.decisions.fixed = 1
    metric.decisions.invalid = 1
    metric.decisions.already_fixed = 1
    metric.decisions.needs_human = 1
    metric.decisions.plan_drift = 1
    metric.decisions.no_commit = 1
    metric.decisions.inspector_rejected = 1
    metric.fixerSeverity = { critical: 0, high: 0, medium: 7, low: 0 }
    expect(burndownBlock([metric])).toBe(`Burndown:
  round new open fixed rejected needs_human plan_drift insp_rej avgRev avgFix
  7     3   9    1     1        1           1          1        0.0    2.0`)
  })

  test('keeps rows where exactly one of newIssues/decidedCount is zero', () => {
    const onlyNew = zeroMetric(11)
    onlyNew.newIssues = 1
    onlyNew.cumulativeOpen = 1
    onlyNew.reviewerSeverity = { critical: 0, high: 0, medium: 1, low: 0 }
    const onlyDecided = zeroMetric(12)
    onlyDecided.decisions.fixed = 2
    onlyDecided.fixerSeverity = { critical: 0, high: 1, medium: 0, low: 0 }
    expect(burndownBlock([onlyNew, onlyDecided])).toBe(`Burndown:
  round new open fixed rejected needs_human plan_drift insp_rej avgRev avgFix
  11    1   1    0     0        0           0          0        2.0    -
  12    0   0    2     0        0           0          0        -      1.5`)
  })
})
