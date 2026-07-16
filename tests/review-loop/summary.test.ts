// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IssueLedgerSnapshot, LedgerIssueStatus } from '../../review-loop/src/issue-ledger.js'
import { buildMetricsJson, formatSummary } from '../../review-loop/src/summary.js'

function makeSnapshot(statuses: LedgerIssueStatus[]): IssueLedgerSnapshot {
  return {
    issues: Object.fromEntries(
      statuses.map((status, index) => [
        `id-${index}`,
        {
          id: `id-${index}`,
          issue: {
            title: `Issue ${index}`,
            severity: 'high',
            summary: 'Summary',
            whyItMatters: 'Matters',
            evidence: 'Evidence',
            file: 'src/x.ts',
            lineStart: 1,
            lineEnd: 2,
            suggestedFix: 'Fix',
            confidence: 0.9,
          },
          status,
          firstSeenRound: 1,
          latestSeenRound: 1,
          fixAttempts: 0,
          verifierDecision: null,
        },
      ]),
    ),
  }
}

describe('formatSummary', () => {
  test('counts issues by terminal status', () => {
    const summary = formatSummary({
      doneReason: 'clean',
      rounds: 3,
      ledger: makeSnapshot(['closed', 'closed', 'rejected', 'needs_human']),
    })
    expect(summary).toContain('Done reason: clean')
    expect(summary).toContain('Rounds executed: 3')
    expect(summary).toContain('Open issues: 0')
    expect(summary).toContain('Closed issues: 2')
    expect(summary).toContain('Rejected issues: 1')
    expect(summary).toContain('Needs human: 1')
  })

  test('counts non-terminal issues as open on max_rounds termination', () => {
    const summary = formatSummary({
      doneReason: 'max_rounds',
      rounds: 5,
      ledger: makeSnapshot(['verified', 'fixed_pending_review', 'discovered', 'closed']),
    })
    expect(summary).toContain('Done reason: max_rounds')
    expect(summary).toContain('Open issues: 3')
    expect(summary).toContain('Closed issues: 1')
  })

  test('emits a burndown block when metrics are present', () => {
    const summary = formatSummary({
      doneReason: 'max_rounds',
      rounds: 2,
      ledger: makeSnapshot(['closed']),
      metrics: [
        {
          round: 1,
          newIssues: 3,
          cumulativeOpen: 3,
          noProgressRounds: 0,
          decisions: { fixed: 1, invalid: 0, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 },
          reviewerSeverity: { critical: 0, high: 2, medium: 1, low: 0 },
          fixerSeverity: { critical: 0, high: 1, medium: 0, low: 0 },
        },
        {
          round: 2,
          newIssues: 1,
          cumulativeOpen: 1,
          noProgressRounds: 1,
          decisions: { fixed: 0, invalid: 1, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 },
          reviewerSeverity: { critical: 0, high: 0, medium: 1, low: 0 },
          fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        },
      ],
    })
    expect(summary).toContain('Burndown')
    expect(summary).toContain('round')
  })

  test('buildMetricsJson returns burndown series and totals', () => {
    const parsed = buildMetricsJson({
      doneReason: 'max_rounds',
      rounds: 1,
      ledger: makeSnapshot(['closed']),
      metrics: [
        {
          round: 1,
          newIssues: 2,
          cumulativeOpen: 2,
          noProgressRounds: 0,
          decisions: { fixed: 1, invalid: 1, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 },
          reviewerSeverity: { critical: 0, high: 1, medium: 1, low: 0 },
          fixerSeverity: { critical: 0, high: 1, medium: 0, low: 0 },
        },
      ],
    })
    expect(parsed.doneReason).toBe('max_rounds')
    expect(parsed.rounds).toBe(1)
    expect(parsed.burndown).toHaveLength(1)
    expect(parsed.totals).toBeDefined()
  })
})
