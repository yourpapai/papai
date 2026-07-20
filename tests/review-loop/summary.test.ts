// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildMetricsJson, buildSummary } from '../../review-loop/src/summary.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'

const metricsFixture: RoundMetric[] = [
  {
    round: 1,
    newIssues: 3,
    cumulativeOpen: 3,
    noProgressRounds: 0,
    decisions: {
      fixed: 3,
      invalid: 0,
      already_fixed: 0,
      needs_human: 0,
      plan_drift: 0,
      no_commit: 0,
      inspector_rejected: 0,
    },
    reviewerSeverity: { critical: 0, high: 0, medium: 0, low: 3 },
    fixerSeverity: { critical: 0, high: 0, medium: 0, low: 3 },
    inspector: { runs: 3, rejected: 0 },
    phaseMs: { review: 1000, match: 100, verify: 500, build: 300, inspect: 200, fix: 50 },
    usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 100, costUsd: 0.05 },
  },
]

describe('buildSummary', () => {
  test('emits done reason, rounds, and closed count', () => {
    const summary = buildSummary('clean', 3, 2, [], { poolSize: 1, inspect: false })
    expect(summary).toContain('Done reason: clean')
    expect(summary).toContain('Rounds executed: 3')
    expect(summary).toContain('Closed issues: 2')
  })

  test('omits pool size when poolSize is 1', () => {
    const summary = buildSummary('clean', 1, 0, [], { poolSize: 1, inspect: false })
    expect(summary).not.toContain('Pool size')
  })

  test('emits a burndown block when metrics are present', () => {
    const summary = buildSummary(
      'max_rounds',
      2,
      1,
      [
        {
          round: 1,
          newIssues: 3,
          cumulativeOpen: 3,
          noProgressRounds: 0,
          decisions: {
            fixed: 1,
            invalid: 0,
            already_fixed: 0,
            needs_human: 0,
            plan_drift: 0,
            no_commit: 0,
            inspector_rejected: 0,
          },
          reviewerSeverity: { critical: 0, high: 2, medium: 1, low: 0 },
          fixerSeverity: { critical: 0, high: 1, medium: 0, low: 0 },
          inspector: { runs: 0, rejected: 0 },
          phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
        },
        {
          round: 2,
          newIssues: 1,
          cumulativeOpen: 1,
          noProgressRounds: 1,
          decisions: {
            fixed: 0,
            invalid: 1,
            already_fixed: 0,
            needs_human: 0,
            plan_drift: 0,
            no_commit: 0,
            inspector_rejected: 0,
          },
          reviewerSeverity: { critical: 0, high: 0, medium: 1, low: 0 },
          fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
          inspector: { runs: 0, rejected: 0 },
          phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
        },
      ],
      { poolSize: 1, inspect: false },
    )
    expect(summary).toContain('Burndown')
    expect(summary).toContain('round')
  })

  test('summary includes pool size, inspector stats, total cost, and phase wall-clock', () => {
    const summary = buildSummary('clean', 1, 3, metricsFixture, { poolSize: 3, inspect: true })
    expect(summary).toContain('Pool size: 3')
    expect(summary).toContain('Inspector: 3 runs, 0 rejected')
    expect(summary).toContain('Total cost: $0.05')
    expect(summary).toContain('Wall clock:')
    expect(summary).toContain('review:')
    expect(summary).toContain('insp_rej')
  })

  test('summary hides inspector line when inspect option is false', () => {
    const summary = buildSummary('clean', 1, 3, metricsFixture, { poolSize: 3, inspect: false })
    expect(summary).not.toContain('Inspector:')
  })
})

describe('buildMetricsJson', () => {
  test('returns burndown series and totals', () => {
    const parsed = buildMetricsJson(
      'max_rounds',
      1,
      1,
      [
        {
          round: 1,
          newIssues: 2,
          cumulativeOpen: 2,
          noProgressRounds: 0,
          decisions: {
            fixed: 1,
            invalid: 1,
            already_fixed: 0,
            needs_human: 0,
            plan_drift: 0,
            no_commit: 0,
            inspector_rejected: 0,
          },
          reviewerSeverity: { critical: 0, high: 1, medium: 1, low: 0 },
          fixerSeverity: { critical: 0, high: 1, medium: 0, low: 0 },
          inspector: { runs: 0, rejected: 0 },
          phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
        },
      ],
      { poolSize: 1, inspect: false },
    )
    expect(parsed.doneReason).toBe('max_rounds')
    expect(parsed.rounds).toBe(1)
    expect(parsed.burndown).toHaveLength(1)
    expect(parsed.totals).toBeDefined()
  })

  test('metrics.json includes poolSize, usage, phaseMs, inspectorRejected totals', () => {
    const m = buildMetricsJson('clean', 1, 3, metricsFixture, { poolSize: 3, inspect: true })
    expect(m.poolSize).toBe(3)
    expect(m.usage.costUsd).toBeGreaterThan(0)
    expect(m.phaseMs.review).toBeGreaterThan(0)
    expect(m.totals.inspectorRejected).toBe(0)
  })
})
