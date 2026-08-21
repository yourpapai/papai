// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { medianOf, shouldDeferBatch } from '../../review-loop/src/batch-defer.js'
import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'

const issue: ReviewerIssue = {
  title: 'English literal not localized',
  kind: 'defect',
  severity: 'low',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'src/a.ts 1-2',
  file: 'src/a.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'localize',
  confidence: 0.9,
}

function buildRecord(id: string, overrides?: Partial<ReviewerIssue>): LedgerIssueRecord {
  return {
    id,
    issue: { ...issue, ...overrides },
    status: 'discovered',
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

describe('medianOf', () => {
  test('returns the middle value of an odd-length list', () => {
    expect(medianOf([5, 1, 9])).toBe(5)
  })

  test('averages the middle pair of an even-length list', () => {
    expect(medianOf([1, 2, 3, 10])).toBe(2.5)
  })

  test('has no answer for an empty history', () => {
    expect(medianOf([])).toBeNull()
  })
})

describe('shouldDeferBatch', () => {
  const low = buildRecord('low-1', { severity: 'low' })
  const medium = buildRecord('med-1', { severity: 'medium' })
  const high = buildRecord('high-1', { severity: 'high' })
  const critical = buildRecord('crit-1', { severity: 'critical' })
  const cleanup = buildRecord('clean-1', { kind: 'cleanup', severity: 'low' })
  const callerDefect = buildRecord('caller-1', {
    severity: 'low',
    exposure: { kind: 'caller', file: 'src/x.ts', line: 3, quote: 'call()' },
  })

  test('defers low and cleanup when remaining time is short', () => {
    expect(shouldDeferBatch([low], 1_000, 60_000)).toBe(true)
    expect(shouldDeferBatch([cleanup], 1_000, 60_000)).toBe(true)
  })

  test('defers medium only under a tighter margin than low/cleanup', () => {
    // Low/cleanup go first: they defer as soon as the estimate no longer fits.
    // Medium is the next tier: it takes a remaining budget of half the
    // estimate — "even less time" — before it is held back too.
    expect(shouldDeferBatch([medium], 25_000, 60_000)).toBe(true)
    expect(shouldDeferBatch([medium], 35_000, 60_000)).toBe(false)
    expect(shouldDeferBatch([medium], 90_000, 60_000)).toBe(false)
    expect(shouldDeferBatch([low], 35_000, 60_000)).toBe(true)
  })

  test('never defers critical, high, or caller-exposed defects', () => {
    expect(shouldDeferBatch([critical], 1, 60_000)).toBe(false)
    expect(shouldDeferBatch([high], 1, 60_000)).toBe(false)
    expect(shouldDeferBatch([callerDefect], 1, 60_000)).toBe(false)
  })

  test('a cluster holding any non-deferrable member is never deferred', () => {
    expect(shouldDeferBatch([low, high], 1, 60_000)).toBe(false)
  })

  test('no budget or no estimate means no deferral', () => {
    expect(shouldDeferBatch([low], Infinity, 60_000)).toBe(false)
    expect(shouldDeferBatch([low], 1_000, null)).toBe(false)
  })

  test('plenty of remaining time means no deferral', () => {
    expect(shouldDeferBatch([low], 10 * 60_000, 60_000)).toBe(false)
  })
})
