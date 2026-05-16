// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewLoopResult } from '../../review-loop/src/loop-controller.js'
import { formatSummary } from '../../review-loop/src/summary.js'

function makeRecord(fingerprint: string, status: LedgerIssueRecord['status']): LedgerIssueRecord {
  return {
    fingerprint,
    issue: {
      title: 'Race condition',
      severity: 'high',
      summary: 'Concurrent writes bypass lock.',
      whyItMatters: 'Produces stale replies.',
      evidence: 'src/foo.ts:1-10',
      file: 'src/foo.ts',
      lineStart: 1,
      lineEnd: 10,
      suggestedFix: 'Take the lock earlier.',
      confidence: 0.9,
    },
    status,
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

function makeResult(
  doneReason: ReviewLoopResult['doneReason'],
  rounds: number,
  records: readonly LedgerIssueRecord[],
): ReviewLoopResult {
  const issues: Record<string, LedgerIssueRecord> = {}
  for (const record of records) {
    issues[record.fingerprint] = record
  }
  return { doneReason, rounds, ledger: { issues } }
}

describe('formatSummary', () => {
  test('renders done reason, round count, and zeroed status counts for an empty ledger', () => {
    const text = formatSummary(makeResult('clean', 0, []))

    expect(text).toContain('Done reason: clean')
    expect(text).toContain('Rounds executed: 0')
    expect(text).toContain('Closed issues: 0')
    expect(text).toContain('Rejected issues: 0')
    expect(text).toContain('Already fixed: 0')
    expect(text).toContain('Needs human: 0')
    expect(text).toContain('Reopened issues: 0')
  })

  test('counts records by ledger status', () => {
    const text = formatSummary(
      makeResult('max_rounds', 3, [
        makeRecord('a', 'closed'),
        makeRecord('b', 'closed'),
        makeRecord('c', 'rejected'),
        makeRecord('d', 'already_fixed'),
        makeRecord('e', 'needs_human'),
        makeRecord('f', 'reopened'),
        makeRecord('g', 'discovered'),
      ]),
    )

    expect(text).toContain('Done reason: max_rounds')
    expect(text).toContain('Rounds executed: 3')
    expect(text).toContain('Closed issues: 2')
    expect(text).toContain('Rejected issues: 1')
    expect(text).toContain('Already fixed: 1')
    expect(text).toContain('Needs human: 1')
    expect(text).toContain('Reopened issues: 1')
  })
})
