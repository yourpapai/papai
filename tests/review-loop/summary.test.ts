// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { IssueLedgerSnapshot, LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'
import { buildMetricsJson, buildSummary, type SummaryInput } from '../../review-loop/src/summary.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

const issueFixture: ReviewerIssue = {
  title: 'Token refresh race on 401',
  kind: 'defect',
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

function cachedMetric(round: number): RoundMetric {
  const metric = busyMetric(round)
  metric.usage = {
    inputTokens: 120_000,
    outputTokens: 8_000,
    reasoningTokens: 3_000,
    cachedReadTokens: 18_175_552,
    cachedWriteTokens: 5_005_056,
    costUsd: 1.234,
  }
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

/**
 * One row per former case: the former test body verbatim in `body`. The runner resets the
 * shared idCounter before each row, replicating the file's per-test `beforeEach` so every
 * row's ledger mints the same record ids its original case asserted.
 */
type BodyRow = Row<{ readonly body: () => void }>

const runBodyRow = (row: BodyRow): void => {
  idCounter = 0
  row.body()
}

describe('buildSummary verdict', () => {
  test('verdict matrix', () =>
    assertEach(
      [
        {
          label: 'clean run with no issues and one round',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [zeroMetric(1)] }))
            expect(summary).toContain('Review loop finished: clean — reviewer found no issues in 1 round.')
            expect(summary).not.toContain('Issues:')
          },
        },
        {
          label: 'done run lists the non-zero breakdown',
          body: (): void => {
            const ledger = ledgerOf(
              makeRecord('closed'),
              makeRecord('closed'),
              makeRecord('closed'),
              makeRecord('needs_human'),
              makeRecord('rejected'),
            )
            const summary = buildSummary(inputOf({ doneReason: 'max_rounds', rounds: 2, ledger }))
            expect(summary).toContain('Review loop finished: done — 5 issues: 3 fixed, 1 needs human, 1 rejected.')
          },
        },
        {
          label: 'a stopped run says so before anything else, and keeps the counts',
          body: (): void => {
            const ledger = ledgerOf(makeRecord('closed'), makeRecord('discovered'))
            const summary = buildSummary(inputOf({ doneReason: 'stopped', rounds: 1, ledger }))
            // The whole sentence, because every part of it is load-bearing: a reader who
            // takes these counts for a final verdict draws the opposite conclusion from
            // the one the run supports.
            expect(summary.split('\n')[0]).toBe(
              'Review loop stopped early: out of time after 1 round — 1 open (1 fixed).',
            )
          },
        },
        {
          label: 'a stopped run that found nothing leaves the breakdown off rather than empty',
          body: (): void => {
            const summary = buildSummary(inputOf({ doneReason: 'stopped', rounds: 2, ledger: { issues: {} } }))
            expect(summary.split('\n')[0]).toBe('Review loop stopped early: out of time after 2 rounds — 0 open.')
          },
        },
        {
          label: 'issues remaining leads with the open count',
          body: (): void => {
            const ledger = ledgerOf(makeRecord('closed'), makeRecord('verified'), makeRecord('discovered'))
            const summary = buildSummary(inputOf({ doneReason: 'no_progress', rounds: 3, ledger }))
            expect(summary).toContain('Review loop finished: issues remaining — 2 open (1 fixed).')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary zero suppression', () => {
  test('zero suppression matrix', () =>
    assertEach(
      [
        {
          label: 'drops zero wall-clock phases from the duration breakdown',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
            expect(summary).toContain('(review 178.3s)')
            expect(summary).not.toContain('match 0.0s')
            expect(summary).not.toContain('fix 0.0s')
          },
        },
        {
          label: 'omits the burndown table for a single all-zero round',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [zeroMetric(1)] }))
            expect(summary).not.toContain('Burndown:')
          },
        },
        {
          label: 'keeps the burndown table when a round has activity',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
            expect(summary).toContain('Burndown:')
            expect(summary).toContain('round')
          },
        },
        {
          label: 'drops zero-activity rounds from a multi-round burndown',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [busyMetric(1), zeroMetric(2)] }))
            expect(summary).toContain('Burndown:')
            expect(summary).not.toContain('  2     0')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary timing and cost', () => {
  test('timing and cost matrix', () =>
    assertEach(
      [
        {
          label: 'renders wall time, phase sum, nonzero phases, and cost on one line',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
            expect(summary).toContain(
              'Duration: 3m20s wall · phases 2m58s (review 178.3s) · Cost: $1.234 (in 120,000 / out 8,000 / reasoning 3,000)',
            )
          },
        },
        {
          label: 'hides cost and shows Tokens when the reported cost is zero',
          body: (): void => {
            const metric = busyMetric(1)
            metric.usage = {
              inputTokens: 228_819,
              outputTokens: 9_824,
              reasoningTokens: 49_844,
              cachedReadTokens: 0,
              cachedWriteTokens: 0,
              costUsd: 0,
            }
            const summary = buildSummary(inputOf({ metrics: [metric] }))
            expect(summary).toContain('· Tokens: in 228,819 / out 9,824 / reasoning 49,844')
            expect(summary).not.toContain('Cost:')
          },
        },
        {
          label: 'token line includes the cached segment when cached reads are non-zero',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [cachedMetric(1)] }))
            expect(summary).toContain('in 120,000 / cached 18,175,552 / out 8,000 / reasoning 3,000')
          },
        },
        {
          label: 'token line omits the cached segment when cached counters are zero',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
            expect(summary).toContain('in 120,000 / out 8,000 / reasoning 3,000')
            expect(summary).not.toContain('cached')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary rounds and pool line', () => {
  test('rounds and pool matrix', () =>
    assertEach(
      [
        {
          label: 'omitted for a single round with pool size 1',
          body: (): void => {
            const summary = buildSummary(inputOf())
            expect(summary).not.toContain('Rounds:')
          },
        },
        {
          label: 'included when rounds > 1 or pool > 1',
          body: (): void => {
            expect(buildSummary(inputOf({ rounds: 2 }))).toContain('Rounds: 2')
            expect(buildSummary(inputOf({ options: { poolSize: 4, inspect: false } }))).toContain('Rounds: 1 · Pool: 4')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary issue groups', () => {
  test('issue group matrix', () =>
    assertEach(
      [
        {
          label: 'groups in order with marks and issue refs',
          body: (): void => {
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
          },
        },
        {
          label: 'caps a group at 20 lines with a see-ledger note',
          body: (): void => {
            const records = Array.from({ length: 21 }, () => makeRecord('needs_human'))
            const summary = buildSummary(inputOf({ rounds: 2, ledger: ledgerOf(...records) }))
            expect(summary).toContain('  needs human (21):')
            expect(summary).toContain('    …and 1 more (see ledger.json)')
            const bangLines = summary.split('\n').filter((l) => l.startsWith('    ! #'))
            expect(bangLines).toHaveLength(20)
          },
        },
        {
          label: 'open bucket appears only when issues are left open',
          body: (): void => {
            const summary = buildSummary(
              inputOf({ doneReason: 'max_rounds', rounds: 2, ledger: ledgerOf(makeRecord('verified')) }),
            )
            expect(summary).toContain('  open (1):')
            expect(summary).toContain('· #00000001')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary artifacts', () => {
  test('artifacts matrix', () =>
    assertEach(
      [
        {
          label: 'always lists the run dir and known artifact files',
          body: (): void => {
            const summary = buildSummary(inputOf())
            expect(summary).toContain('Artifacts (/repo/.review-loop/runs/run-1):')
            expect(summary).toContain(
              'summary.txt · metrics.json · ledger.json · trace.jsonl · agent-output.log · state.json',
            )
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary stats line', () => {
  test('stats line matrix', () =>
    assertEach(
      [
        {
          label: 'buildSummary appends a Stats line when stats are present',
          body: (): void => {
            const summary = buildSummary(
              inputOf({
                stats: {
                  totals: {
                    input: 228_800,
                    output: 41_200,
                    reasoning: 0,
                    cachedRead: 0,
                    cachedWrite: 0,
                    toolCalls: 37,
                    added: 412,
                    removed: 87,
                    estimatedCostUsd: 1.02,
                    elapsedMs: 252_000,
                  },
                  perLabel: {},
                },
              }),
            )
            expect(summary).toContain('Stats: tools 37 · +412/-87 · ~$1.02 est')
          },
        },
        {
          label: 'buildSummary omits the Stats line when stats are absent',
          body: (): void => {
            expect(buildSummary(inputOf())).not.toContain('Stats:')
          },
        },
        {
          label: 'buildSummary omits the Stats line when all totals are zero',
          body: (): void => {
            const summary = buildSummary(
              inputOf({
                stats: {
                  totals: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cachedRead: 0,
                    cachedWrite: 0,
                    toolCalls: 0,
                    added: 0,
                    removed: 0,
                    elapsedMs: 1000,
                  },
                  perLabel: {},
                },
              }),
            )
            expect(summary).not.toContain('Stats:')
          },
        },
        {
          label: 'buildSummary Stats line shows only non-zero segments',
          body: (): void => {
            const summary = buildSummary(
              inputOf({
                stats: {
                  totals: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cachedRead: 0,
                    cachedWrite: 0,
                    toolCalls: 0,
                    added: 5,
                    removed: 0,
                    elapsedMs: 1000,
                  },
                  perLabel: {},
                },
              }),
            )
            expect(summary).toContain('Stats: +5/-0')
            expect(summary).not.toContain('tools 0')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildMetricsJson', () => {
  test('buildMetricsJson matrix', () =>
    assertEach(
      [
        {
          label: 'keeps the existing shape',
          body: (): void => {
            const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1)], { poolSize: 1, inspect: false })
            expect(json.doneReason).toBe('max_rounds')
            expect(json.rounds).toBe(2)
            expect(json.totals.closed).toBe(1)
            expect(json.usage.inputTokens).toBe(120_000)
          },
        },
        {
          label: 'buildMetricsJson includes runStats when provided',
          body: (): void => {
            const runStats = {
              totals: {
                input: 1,
                output: 2,
                reasoning: 0,
                cachedRead: 0,
                cachedWrite: 0,
                toolCalls: 3,
                added: 4,
                removed: 5,
                estimatedCostUsd: 0.01,
              },
              perLabel: {},
            }
            const metrics = buildMetricsJson('clean', 1, 0, [], { poolSize: 1, inspect: false }, runStats)
            expect(metrics.runStats).toEqual(runStats)
          },
        },
        {
          label: 'buildMetricsJson omits the runStats key when not provided',
          body: (): void => {
            const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1)], { poolSize: 1, inspect: false })
            expect('runStats' in json).toBe(false)
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary verdict edges', () => {
  test('verdict edge matrix', () =>
    assertEach(
      [
        {
          label: 'alreadyFixed issues appear in the done verdict breakdown',
          body: (): void => {
            const ledger = ledgerOf(makeRecord('already_fixed'))
            const summary = buildSummary(inputOf({ ledger }))
            expect(summary.split('\n')[0]).toBe('Review loop finished: done — 1 issue: 1 already fixed.')
          },
        },
        {
          label: 'zero fixed count is omitted from the done breakdown',
          body: (): void => {
            const ledger = ledgerOf(makeRecord('rejected'))
            const summary = buildSummary(inputOf({ ledger }))
            expect(summary.split('\n')[0]).toBe('Review loop finished: done — 1 issue: 1 rejected.')
          },
        },
        {
          label: 'open issues with no decided issues produce no breakdown suffix',
          body: (): void => {
            const ledger = ledgerOf(makeRecord('verified'))
            const summary = buildSummary(inputOf({ ledger }))
            expect(summary.split('\n')[0]).toBe('Review loop finished: issues remaining — 1 open.')
          },
        },
      ],
      runBodyRow,
    ))
})

const MINIMAL_SUMMARY = [
  'Review loop finished: clean — reviewer found no issues in 1 round.',
  'Duration: 3m20s wall · phases 0s (no phase timing recorded) · Tokens: in 0 / out 0 / reasoning 0',
  '',
  'Artifacts (/repo/.review-loop/runs/run-1):',
  '  summary.txt · metrics.json · ledger.json · trace.jsonl · agent-output.log · state.json',
].join('\n')

describe('buildSummary exact structure', () => {
  test('exact structure matrix', () =>
    assertEach(
      [
        {
          label: 'minimal summary with no optional sections has exact five-line structure',
          body: (): void => {
            expect(buildSummary(inputOf())).toBe(MINIMAL_SUMMARY)
          },
        },
        {
          label: 'inspector line is omitted when inspect is disabled even with runs',
          body: (): void => {
            const metric = zeroMetric(1)
            metric.inspector = { runs: 4, rejected: 2 }
            const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: false } }))
            expect(summary).toBe(MINIMAL_SUMMARY)
          },
        },
        {
          label: 'deferred line appears only when findings were deferred',
          body: (): void => {
            const metric = zeroMetric(1)
            metric.deferred = 3
            const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: false } }))
            expect(summary).toContain('Deferred: 3')

            const none = buildSummary(inputOf({ metrics: [zeroMetric(1)], options: { poolSize: 1, inspect: false } }))
            expect(none).not.toContain('Deferred:')
          },
        },
        {
          label: 'multiple nonzero phases join with comma separator',
          body: (): void => {
            const metric = busyMetric(1)
            metric.phaseMs = { review: 1000, match: 0, verify: 0, build: 0, inspect: 0, fix: 2000 }
            const summary = buildSummary(inputOf({ metrics: [metric] }))
            expect(summary.split('\n')[1]).toBe(
              'Duration: 3m20s wall · phases 3s (review 1.0s, fix 2.0s) · Cost: $1.234 (in 120,000 / out 8,000 / reasoning 3,000)',
            )
          },
        },
        {
          label: 'rounds line omits pool when poolSize is 1',
          body: (): void => {
            const summary = buildSummary(inputOf({ rounds: 3 }))
            expect(summary.split('\n')[2]).toBe('Rounds: 3')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary inspector line', () => {
  test('inspector line matrix', () =>
    assertEach(
      [
        {
          label: 'inspector line shows runs, rejected, and reject rate when inspect is enabled',
          body: (): void => {
            const metric = busyMetric(1)
            metric.inspector = { runs: 4, rejected: 2 }
            const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: true } }))
            expect(summary.split('\n')[2]).toBe('Inspector: 4 runs, 2 rejected (50.0% reject rate)')
          },
        },
        {
          label: 'inspector line is omitted when inspect is enabled but runs is zero',
          body: (): void => {
            const metric = zeroMetric(1)
            metric.inspector = { runs: 0, rejected: 0 }
            const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: true } }))
            expect(summary).toBe(MINIMAL_SUMMARY)
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildSummary stats and issues edges', () => {
  test('stats and issues edge matrix', () =>
    assertEach(
      [
        {
          label: 'stats line shows diff with zero added and nonzero removed',
          body: (): void => {
            const summary = buildSummary(
              inputOf({
                stats: {
                  totals: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cachedRead: 0,
                    cachedWrite: 0,
                    toolCalls: 0,
                    added: 0,
                    removed: 7,
                    elapsedMs: 1000,
                  },
                  perLabel: {},
                },
              }),
            )
            expect(summary.split('\n')[2]).toBe('Stats: +0/-7')
          },
        },
        {
          label: 'issues block has blank separator then Issues header',
          body: (): void => {
            const ledger = ledgerOf(makeRecord('closed'))
            const summary = buildSummary(inputOf({ ledger }))
            const lines = summary.split('\n')
            expect(lines[2]).toBe('')
            expect(lines[3]).toBe('Issues:')
          },
        },
        {
          label: 'exactly 20 issues in a group produce no overflow note',
          body: (): void => {
            const records = Array.from({ length: 20 }, () => makeRecord('needs_human'))
            const summary = buildSummary(inputOf({ ledger: ledgerOf(...records) }))
            const lines = summary.split('\n')
            const bangLines = lines.filter((l) => l.startsWith('    ! #'))
            const overflowLines = lines.filter((l) => l.startsWith('    …and'))
            expect(bangLines.length).toBe(20)
            expect(overflowLines.length).toBe(0)
          },
        },
        {
          label: 'burndown block is preceded by exactly one blank separator',
          body: (): void => {
            const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
            const lines = summary.split('\n')
            const burndownIdx = lines.findIndex((l) => l === 'Burndown:')
            expect(lines[burndownIdx - 1]).toBe('')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('buildMetricsJson aggregation', () => {
  test('aggregation matrix', () =>
    assertEach(
      [
        {
          label: 'sums decision keys across rounds',
          body: (): void => {
            const m1 = busyMetric(1)
            const m2 = zeroMetric(2)
            m2.decisions.invalid = 2
            m2.decisions.already_fixed = 3
            m2.decisions.needs_human = 1
            const json = buildMetricsJson('max_rounds', 2, 5, [m1, m2], { poolSize: 1, inspect: false })
            expect(json.totals.rejected).toBe(3)
            expect(json.totals.alreadyFixed).toBe(3)
            expect(json.totals.needsHuman).toBe(1)
          },
        },
        {
          label: 'sums deferred across rounds',
          body: (): void => {
            const m1 = zeroMetric(1)
            m1.deferred = 2
            const m2 = zeroMetric(2)
            m2.deferred = 1
            const json = buildMetricsJson('stopped', 2, 0, [m1, m2], { poolSize: 1, inspect: false })
            expect(json.totals.deferred).toBe(3)
          },
        },
        {
          label: 'reads open from the last metric cumulativeOpen',
          body: (): void => {
            const m1 = busyMetric(1)
            const m2 = zeroMetric(2)
            m2.cumulativeOpen = 5
            const json = buildMetricsJson('max_rounds', 2, 3, [m1, m2], { poolSize: 1, inspect: false })
            expect(json.totals.open).toBe(5)
          },
        },
        {
          label: 'burndown copies every metric in order',
          body: (): void => {
            const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1), zeroMetric(2)], {
              poolSize: 1,
              inspect: false,
            })
            expect(json.burndown.length).toBe(2)
            expect(json.burndown[0]!.round).toBe(1)
            expect(json.burndown[1]!.round).toBe(2)
          },
        },
        {
          label: 'sums inspector rejected across rounds',
          body: (): void => {
            const metric = busyMetric(1)
            metric.inspector = { runs: 4, rejected: 2 }
            const json = buildMetricsJson('max_rounds', 2, 1, [metric], { poolSize: 1, inspect: true })
            expect(json.totals.inspectorRejected).toBe(2)
          },
        },
      ],
      runBodyRow,
    ))
})

describe('exposure line', () => {
  test('exposure line matrix', () =>
    assertEach(
      [
        {
          label: 'reports the distribution and the divergence count',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [
                {
                  ...zeroMetric(1),
                  reviewerExposure: { caller: 4, none: 3, unknown: 1 },
                  fixerExposure: { caller: 3, none: 4, unknown: 1 },
                  exposureDivergent: 2,
                },
              ],
            })
            expect(summary).toContain(
              'Exposure: 4 cited, 3 none, 2 divergent (advisory — orders dispatch, gates nothing)',
            )
          },
        },
        {
          label: 'is omitted when no issue carried exposure, rather than printing zeros',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [{ ...zeroMetric(1), reviewerExposure: { caller: 0, none: 0, unknown: 5 } }],
            })
            expect(summary).not.toContain('Exposure:')
          },
        },
        {
          label: 'is still reported when cited and none happen to be equal',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [{ ...zeroMetric(1), reviewerExposure: { caller: 2, none: 2, unknown: 0 } }],
            })
            expect(summary).toContain('Exposure: 2 cited, 2 none,')
          },
        },
        {
          label: 'sums exposure across rounds',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [
                { ...zeroMetric(1), reviewerExposure: { caller: 1, none: 0, unknown: 0 }, exposureDivergent: 1 },
                { ...zeroMetric(2), reviewerExposure: { caller: 2, none: 0, unknown: 0 }, exposureDivergent: 2 },
              ],
            })
            expect(summary).toContain('Exposure: 3 cited, 0 none, 3 divergent')
          },
        },
      ],
      runBodyRow,
    ))
})

function makeNeedsHumanDecision(reasoning: string): VerifierDecision {
  return {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning,
    targetFiles: ['.github/workflows/ci.yml'],
  }
}

describe('buildSummary needs-human manual-change content', () => {
  test('renders the suggested fix and fixer reasoning indented under the issue line', () => {
    const record = makeRecord('needs_human', {
      suggestedFix: 'Reword the timeout comment to ~30s of lint/knip/format',
    })
    record.verifierDecision = makeNeedsHumanDecision(
      'The fix is a comment edit under .github/workflows/, which a pipeline push cannot carry.',
    )
    const summary = buildSummary(inputOf({ ledger: ledgerOf(record) }))
    expect(summary).toContain('      apply by hand: Reword the timeout comment to ~30s of lint/knip/format')
    expect(summary).toContain(
      '      fixer note: The fix is a comment edit under .github/workflows/, which a pipeline push cannot carry.',
    )
  })

  test('indents every line of a multi-line suggested fix', () => {
    const record = makeRecord('needs_human', { suggestedFix: 'line one\nline two' })
    const summary = buildSummary(inputOf({ ledger: ledgerOf(record) }))
    expect(summary).toContain('      apply by hand: line one')
    expect(summary).toContain('      line two')
  })

  test('cuts combined content at the bound with an explicit ledger marker', () => {
    const record = makeRecord('needs_human', { suggestedFix: 'f'.repeat(1000) })
    record.verifierDecision = makeNeedsHumanDecision('r'.repeat(1000))
    const summary = buildSummary(inputOf({ ledger: ledgerOf(record) }))
    expect(summary).toContain('… (truncated; full text in ledger.json)')
    expect(summary).not.toContain('f'.repeat(1000))
    expect(summary).not.toContain('r'.repeat(1000))
  })

  test('points at the ledger when a needs-human record has no manual-change content', () => {
    const record = makeRecord('needs_human', { suggestedFix: '   ' })
    record.verifierDecision = null
    const summary = buildSummary(inputOf({ ledger: ledgerOf(record) }))
    expect(summary).toContain('      (no manual-change content recorded — see ledger.json)')
    expect(summary).not.toContain('apply by hand:')
  })

  test('non needs-human records stay one-liners', () => {
    const record = makeRecord('closed', { suggestedFix: 'f'.repeat(1000) })
    record.verifierDecision = makeNeedsHumanDecision('r'.repeat(1000))
    const summary = buildSummary(inputOf({ ledger: ledgerOf(record) }))
    expect(summary).not.toContain('apply by hand:')
    expect(summary).not.toContain('fixer note:')
  })

  test('records beyond the group cap render no content', () => {
    const records = Array.from({ length: 21 }, (_, i) => {
      const record = makeRecord('needs_human', { suggestedFix: `unique-fix-${i}` })
      record.verifierDecision = makeNeedsHumanDecision(`unique-note-${i}`)
      return record
    })
    const summary = buildSummary(inputOf({ ledger: ledgerOf(...records) }))
    expect(summary).toContain('apply by hand: unique-fix-19')
    expect(summary).not.toContain('unique-fix-20')
    expect(summary).not.toContain('unique-note-20')
    expect(summary).toContain('    …and 1 more (see ledger.json)')
  })
})

function lineStartingWith(summary: string, prefix: string): string | undefined {
  return summary.split('\n').find((l) => l.startsWith(prefix))
}

describe('check-behind line', () => {
  test('check-behind matrix', () =>
    assertEach(
      [
        {
          label: 'reports how many accepted fixes left a check behind',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [
                {
                  ...zeroMetric(1),
                  checkBehind: {
                    defect: { withCheck: 2, withoutCheck: 1, unmeasured: 0 },
                    cleanup: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
                  },
                },
              ],
            })
            // Whole line, not a prefix: a prefix assertion passes even when the empty
            // no-unmeasured tail is replaced with arbitrary text.
            expect(lineStartingWith(summary, 'Checks left behind:')).toBe(
              'Checks left behind: 2 of 3 accepted defect fixes',
            )
          },
        },
        {
          label: 'calls out unmeasured fixes rather than folding them into either answer',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [
                {
                  ...zeroMetric(1),
                  checkBehind: {
                    defect: { withCheck: 1, withoutCheck: 0, unmeasured: 2 },
                    cleanup: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
                  },
                },
              ],
            })
            expect(summary).toContain('Checks left behind: 1 of 1 accepted defect fixes (2 unmeasured)')
          },
        },
        {
          label: 'is still reported when the measured and unmeasured counts happen to be equal',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [
                {
                  ...zeroMetric(1),
                  checkBehind: {
                    defect: { withCheck: 1, withoutCheck: 0, unmeasured: 1 },
                    cleanup: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
                  },
                },
              ],
            })
            expect(summary).toContain('Checks left behind: 1 of 1 accepted defect fixes (1 unmeasured)')
          },
        },
        {
          label: 'is omitted when no fix was accepted',
          body: (): void => {
            expect(buildSummary(inputOf({ metrics: [zeroMetric(1)] }))).not.toContain('Checks left behind')
          },
        },
      ],
      runBodyRow,
    ))
})

describe('per-kind reporting', () => {
  const zero = { withCheck: 0, withoutCheck: 0, unmeasured: 0 }

  test('per-kind matrix', () =>
    assertEach(
      [
        {
          label: 'reports the findings split once a cleanup is reported',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [{ ...zeroMetric(1), reviewerKind: { defect: 4, cleanup: 2 } }],
            })
            expect(lineStartingWith(summary, 'Findings:')).toBe('Findings: 4 defect, 2 cleanup')
          },
        },
        {
          label: 'omits the findings line entirely when no cleanup was reported',
          body: (): void => {
            // A run that admits no cleanups must read exactly as it did before they
            // were admitted — a "0 cleanup" line on every run is noise.
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [{ ...zeroMetric(1), reviewerKind: { defect: 4, cleanup: 0 } }],
            })
            expect(lineStartingWith(summary, 'Findings:')).toBeUndefined()
          },
        },
        {
          label: 'a cleanup fix that left no check does not depress the defect ratio',
          body: (): void => {
            const summary = buildSummary({
              ...inputOf({}),
              metrics: [
                {
                  ...zeroMetric(1),
                  checkBehind: {
                    defect: { withCheck: 2, withoutCheck: 0, unmeasured: 0 },
                    cleanup: { ...zero, withoutCheck: 3 },
                  },
                },
              ],
            })
            expect(lineStartingWith(summary, 'Checks left behind:')).toBe(
              'Checks left behind: 2 of 2 accepted defect fixes; 3 cleanup fixes not counted',
            )
          },
        },
      ],
      runBodyRow,
    ))
})
