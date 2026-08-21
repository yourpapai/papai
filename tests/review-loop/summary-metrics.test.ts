// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { aggregateUsage } from '../../review-loop/src/summary-metrics.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'

function metricWithUsage(usage: RoundMetric['usage']): RoundMetric {
  return {
    round: 1,
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
    usage,
  }
}

describe('aggregateUsage', () => {
  test('sums cached token counters across rounds', () => {
    const first = metricWithUsage({
      inputTokens: 120_000,
      outputTokens: 8_000,
      reasoningTokens: 3_000,
      cachedReadTokens: 18_175_552,
      cachedWriteTokens: 5_005_056,
      costUsd: 1.234,
    })
    const second = metricWithUsage({
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 1_000,
      cachedReadTokens: 1_000_000,
      cachedWriteTokens: 500_000,
      costUsd: 0.5,
    })
    expect(aggregateUsage([first, second])).toEqual({
      inputTokens: 130_000,
      outputTokens: 10_000,
      reasoningTokens: 4_000,
      cachedReadTokens: 19_175_552,
      cachedWriteTokens: 5_505_056,
      costUsd: 1.734,
    })
  })
})
