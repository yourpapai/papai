// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IssueLedgerSnapshot, LedgerIssueStatus } from '../../review-loop/src/issue-ledger.js'
import { formatSummary } from '../../review-loop/src/summary.js'

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
    expect(summary).toContain('Closed issues: 2')
    expect(summary).toContain('Rejected issues: 1')
    expect(summary).toContain('Needs human: 1')
  })
})
