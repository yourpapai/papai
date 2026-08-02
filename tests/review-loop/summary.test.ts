// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { IssueLedgerSnapshot, LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { buildMetricsJson, buildSummary, type SummaryInput } from '../../review-loop/src/summary.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'

const issueFixture: ReviewerIssue = {
  title: 'Token refresh race on 401',
  severity: 'high',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'e',
  file: 'src/auth/login.ts',
  lineStart: 42,
  lineEnd: 50,
  suggestedFix: 'f',
  confidence: 0.9,
}

let idCounter = 0
beforeEach(() => {
  idCounter = 0
})

function makeRecord(status: LedgerIssueRecord['status'], overrides?: Partial<ReviewerIssue>): LedgerIssueRecord {
  idCounter += 1
  return {
    id: `${String(idCounter).padStart(8, '0')}-0000-0000-0000-000000000000`,
    issue: { ...issueFixture, ...overrides },
    status,
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

function ledgerOf(...records: LedgerIssueRecord[]): IssueLedgerSnapshot {
  const issues: Record<string, LedgerIssueRecord> = {}
  for (const record of records) {
    issues[record.id] = record
  }
  return { issues }
}

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

function inputOf(overrides?: Partial<SummaryInput>): SummaryInput {
  return {
    doneReason: 'clean',
    rounds: 1,
    metrics: [],
    ledger: { issues: {} },
    runDir: '/repo/.review-loop/runs/run-1',
    wallMs: 200_000,
    options: { poolSize: 1, inspect: false },
    ...overrides,
  }
}

describe('buildSummary verdict', () => {
  test('clean run with no issues and one round', () => {
    const summary = buildSummary(inputOf({ metrics: [zeroMetric(1)] }))
    expect(summary).toContain('Review loop finished: clean — reviewer found no issues in 1 round.')
    expect(summary).not.toContain('Issues:')
  })

  test('done run lists the non-zero breakdown', () => {
    const ledger = ledgerOf(
      makeRecord('closed'),
      makeRecord('closed'),
      makeRecord('closed'),
      makeRecord('needs_human'),
      makeRecord('rejected'),
    )
    const summary = buildSummary(inputOf({ doneReason: 'max_rounds', rounds: 2, ledger }))
    expect(summary).toContain('Review loop finished: done — 5 issues: 3 fixed, 1 needs human, 1 rejected.')
  })

  test('issues remaining leads with the open count', () => {
    const ledger = ledgerOf(makeRecord('closed'), makeRecord('verified'), makeRecord('discovered'))
    const summary = buildSummary(inputOf({ doneReason: 'no_progress', rounds: 3, ledger }))
    expect(summary).toContain('Review loop finished: issues remaining — 2 open (1 fixed).')
  })
})

describe('buildSummary zero suppression', () => {
  test('drops zero wall-clock phases from the duration breakdown', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain('(review 178.3s)')
    expect(summary).not.toContain('match 0.0s')
    expect(summary).not.toContain('fix 0.0s')
  })

  test('omits the burndown table for a single all-zero round', () => {
    const summary = buildSummary(inputOf({ metrics: [zeroMetric(1)] }))
    expect(summary).not.toContain('Burndown:')
  })

  test('keeps the burndown table when a round has activity', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain('Burndown:')
    expect(summary).toContain('round')
  })

  test('drops zero-activity rounds from a multi-round burndown', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1), zeroMetric(2)] }))
    expect(summary).toContain('Burndown:')
    expect(summary).not.toContain('  2     0')
  })
})

describe('buildSummary timing and cost', () => {
  test('renders wall time, phase sum, nonzero phases, and cost on one line', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain(
      'Duration: 3m20s wall · phases 2m58s (review 178.3s) · Cost: $1.234 (in 120,000 / out 8,000 / reasoning 3,000)',
    )
  })

  test('hides cost and shows Tokens when the reported cost is zero', () => {
    const metric = busyMetric(1)
    metric.usage = { inputTokens: 228_819, outputTokens: 9_824, reasoningTokens: 49_844, costUsd: 0 }
    const summary = buildSummary(inputOf({ metrics: [metric] }))
    expect(summary).toContain('· Tokens: in 228,819 / out 9,824 / reasoning 49,844')
    expect(summary).not.toContain('Cost:')
  })
})

describe('buildSummary rounds and pool line', () => {
  test('omitted for a single round with pool size 1', () => {
    const summary = buildSummary(inputOf())
    expect(summary).not.toContain('Rounds:')
  })
  test('included when rounds > 1 or pool > 1', () => {
    expect(buildSummary(inputOf({ rounds: 2 }))).toContain('Rounds: 2')
    expect(buildSummary(inputOf({ options: { poolSize: 4, inspect: false } }))).toContain('Rounds: 1 · Pool: 4')
  })
})

describe('buildSummary issue groups', () => {
  test('groups in order with marks and issue refs', () => {
    const ledger = ledgerOf(
      makeRecord('closed', { title: 'Fixed one' }),
      makeRecord('needs_human', { title: 'Scary one', severity: 'critical' }),
      makeRecord('rejected', { title: 'Bogus one', severity: 'low' }),
    )
    const summary = buildSummary(inputOf({ rounds: 2, ledger }))
    const needsIdx = summary.indexOf('  needs human (1):')
    const fixedIdx = summary.indexOf('  fixed (1):')
    const rejectedIdx = summary.indexOf('  rejected (1):')
    expect(needsIdx).toBeGreaterThan(-1)
    expect(needsIdx).toBeLessThan(fixedIdx)
    expect(fixedIdx).toBeLessThan(rejectedIdx)
    expect(summary).toContain('! #00000002 [critical] src/auth/login.ts:42 — Scary one')
    expect(summary).toContain('✓ #00000001 [high]     src/auth/login.ts:42 — Fixed one')
    expect(summary).toContain('✗ #00000003 [low]      src/auth/login.ts:42 — Bogus one')
  })

  test('caps a group at 20 lines with a see-ledger note', () => {
    const records = Array.from({ length: 21 }, () => makeRecord('needs_human'))
    const summary = buildSummary(inputOf({ rounds: 2, ledger: ledgerOf(...records) }))
    expect(summary).toContain('  needs human (21):')
    expect(summary).toContain('    …and 1 more (see ledger.json)')
    const bangLines = summary.split('\n').filter((l) => l.startsWith('    ! #'))
    expect(bangLines).toHaveLength(20)
  })

  test('open bucket appears only when issues are left open', () => {
    const summary = buildSummary(
      inputOf({ doneReason: 'max_rounds', rounds: 2, ledger: ledgerOf(makeRecord('verified')) }),
    )
    expect(summary).toContain('  open (1):')
    expect(summary).toContain('· #00000001')
  })
})

describe('buildSummary artifacts', () => {
  test('always lists the run dir and known artifact files', () => {
    const summary = buildSummary(inputOf())
    expect(summary).toContain('Artifacts (/repo/.review-loop/runs/run-1):')
    expect(summary).toContain('summary.txt · metrics.json · ledger.json · trace.jsonl · agent-output.log · state.json')
  })
})

describe('buildMetricsJson', () => {
  test('keeps the existing shape', () => {
    const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1)], { poolSize: 1, inspect: false })
    expect(json.doneReason).toBe('max_rounds')
    expect(json.rounds).toBe(2)
    expect(json.totals.closed).toBe(1)
    expect(json.usage.inputTokens).toBe(120_000)
  })
})
