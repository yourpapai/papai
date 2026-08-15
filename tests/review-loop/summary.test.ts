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
    checkBehind: {
      defect: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
      cleanup: { withCheck: 0, withoutCheck: 0, unmeasured: 0 },
    },
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

  test('a stopped run says so before anything else, and keeps the counts', () => {
    const ledger = ledgerOf(makeRecord('closed'), makeRecord('discovered'))
    const summary = buildSummary(inputOf({ doneReason: 'stopped', rounds: 1, ledger }))
    // The whole sentence, because every part of it is load-bearing: a reader who
    // takes these counts for a final verdict draws the opposite conclusion from
    // the one the run supports.
    expect(summary.split('\n')[0]).toBe('Review loop stopped early: out of time after 1 round — 1 open (1 fixed).')
  })

  test('a stopped run that found nothing leaves the breakdown off rather than empty', () => {
    const summary = buildSummary(inputOf({ doneReason: 'stopped', rounds: 2, ledger: { issues: {} } }))
    expect(summary.split('\n')[0]).toBe('Review loop stopped early: out of time after 2 rounds — 0 open.')
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

describe('buildSummary stats line', () => {
  test('buildSummary appends a Stats line when stats are present', () => {
    const summary = buildSummary(
      inputOf({
        stats: {
          totals: {
            input: 228_800,
            output: 41_200,
            reasoning: 0,
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
  })

  test('buildSummary omits the Stats line when stats are absent', () => {
    expect(buildSummary(inputOf())).not.toContain('Stats:')
  })

  test('buildSummary omits the Stats line when all totals are zero', () => {
    const summary = buildSummary(
      inputOf({
        stats: {
          totals: { input: 0, output: 0, reasoning: 0, toolCalls: 0, added: 0, removed: 0, elapsedMs: 1000 },
          perLabel: {},
        },
      }),
    )
    expect(summary).not.toContain('Stats:')
  })

  test('buildSummary Stats line shows only non-zero segments', () => {
    const summary = buildSummary(
      inputOf({
        stats: {
          totals: { input: 0, output: 0, reasoning: 0, toolCalls: 0, added: 5, removed: 0, elapsedMs: 1000 },
          perLabel: {},
        },
      }),
    )
    expect(summary).toContain('Stats: +5/-0')
    expect(summary).not.toContain('tools 0')
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

  test('buildMetricsJson includes runStats when provided', () => {
    const runStats = {
      totals: { input: 1, output: 2, reasoning: 0, toolCalls: 3, added: 4, removed: 5, estimatedCostUsd: 0.01 },
      perLabel: {},
    }
    const metrics = buildMetricsJson('clean', 1, 0, [], { poolSize: 1, inspect: false }, runStats)
    expect(metrics.runStats).toEqual(runStats)
  })

  test('buildMetricsJson omits the runStats key when not provided', () => {
    const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1)], { poolSize: 1, inspect: false })
    expect('runStats' in json).toBe(false)
  })
})

describe('buildSummary verdict edges', () => {
  test('alreadyFixed issues appear in the done verdict breakdown', () => {
    const ledger = ledgerOf(makeRecord('already_fixed'))
    const summary = buildSummary(inputOf({ ledger }))
    expect(summary.split('\n')[0]).toBe('Review loop finished: done — 1 issue: 1 already fixed.')
  })

  test('zero fixed count is omitted from the done breakdown', () => {
    const ledger = ledgerOf(makeRecord('rejected'))
    const summary = buildSummary(inputOf({ ledger }))
    expect(summary.split('\n')[0]).toBe('Review loop finished: done — 1 issue: 1 rejected.')
  })

  test('open issues with no decided issues produce no breakdown suffix', () => {
    const ledger = ledgerOf(makeRecord('verified'))
    const summary = buildSummary(inputOf({ ledger }))
    expect(summary.split('\n')[0]).toBe('Review loop finished: issues remaining — 1 open.')
  })
})

const MINIMAL_SUMMARY = [
  'Review loop finished: clean — reviewer found no issues in 1 round.',
  'Duration: 3m20s wall · phases 0s (no phase timing recorded) · Tokens: in 0 / out 0 / reasoning 0',
  '',
  'Artifacts (/repo/.review-loop/runs/run-1):',
  '  summary.txt · metrics.json · ledger.json · trace.jsonl · agent-output.log · state.json',
].join('\n')

describe('buildSummary exact structure', () => {
  test('minimal summary with no optional sections has exact five-line structure', () => {
    expect(buildSummary(inputOf())).toBe(MINIMAL_SUMMARY)
  })

  test('inspector line is omitted when inspect is disabled even with runs', () => {
    const metric = zeroMetric(1)
    metric.inspector = { runs: 4, rejected: 2 }
    const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: false } }))
    expect(summary).toBe(MINIMAL_SUMMARY)
  })

  test('multiple nonzero phases join with comma separator', () => {
    const metric = busyMetric(1)
    metric.phaseMs = { review: 1000, match: 0, verify: 0, build: 0, inspect: 0, fix: 2000 }
    const summary = buildSummary(inputOf({ metrics: [metric] }))
    expect(summary.split('\n')[1]).toBe(
      'Duration: 3m20s wall · phases 3s (review 1.0s, fix 2.0s) · Cost: $1.234 (in 120,000 / out 8,000 / reasoning 3,000)',
    )
  })

  test('rounds line omits pool when poolSize is 1', () => {
    const summary = buildSummary(inputOf({ rounds: 3 }))
    expect(summary.split('\n')[2]).toBe('Rounds: 3')
  })
})

describe('buildSummary inspector line', () => {
  test('inspector line shows runs, rejected, and reject rate when inspect is enabled', () => {
    const metric = busyMetric(1)
    metric.inspector = { runs: 4, rejected: 2 }
    const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: true } }))
    expect(summary.split('\n')[2]).toBe('Inspector: 4 runs, 2 rejected (50.0% reject rate)')
  })

  test('inspector line is omitted when inspect is enabled but runs is zero', () => {
    const metric = zeroMetric(1)
    metric.inspector = { runs: 0, rejected: 0 }
    const summary = buildSummary(inputOf({ metrics: [metric], options: { poolSize: 1, inspect: true } }))
    expect(summary).toBe(MINIMAL_SUMMARY)
  })
})

describe('buildSummary stats and issues edges', () => {
  test('stats line shows diff with zero added and nonzero removed', () => {
    const summary = buildSummary(
      inputOf({
        stats: {
          totals: { input: 0, output: 0, reasoning: 0, toolCalls: 0, added: 0, removed: 7, elapsedMs: 1000 },
          perLabel: {},
        },
      }),
    )
    expect(summary.split('\n')[2]).toBe('Stats: +0/-7')
  })

  test('issues block has blank separator then Issues header', () => {
    const ledger = ledgerOf(makeRecord('closed'))
    const summary = buildSummary(inputOf({ ledger }))
    const lines = summary.split('\n')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('Issues:')
  })

  test('exactly 20 issues in a group produce no overflow note', () => {
    const records = Array.from({ length: 20 }, () => makeRecord('needs_human'))
    const summary = buildSummary(inputOf({ ledger: ledgerOf(...records) }))
    const lines = summary.split('\n')
    const bangLines = lines.filter((l) => l.startsWith('    ! #'))
    const overflowLines = lines.filter((l) => l.startsWith('    …and'))
    expect(bangLines.length).toBe(20)
    expect(overflowLines.length).toBe(0)
  })

  test('burndown block is preceded by exactly one blank separator', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    const lines = summary.split('\n')
    const burndownIdx = lines.findIndex((l) => l === 'Burndown:')
    expect(lines[burndownIdx - 1]).toBe('')
  })
})

describe('buildMetricsJson aggregation', () => {
  test('sums decision keys across rounds', () => {
    const m1 = busyMetric(1)
    const m2 = zeroMetric(2)
    m2.decisions.invalid = 2
    m2.decisions.already_fixed = 3
    m2.decisions.needs_human = 1
    const json = buildMetricsJson('max_rounds', 2, 5, [m1, m2], { poolSize: 1, inspect: false })
    expect(json.totals.rejected).toBe(3)
    expect(json.totals.alreadyFixed).toBe(3)
    expect(json.totals.needsHuman).toBe(1)
  })

  test('reads open from the last metric cumulativeOpen', () => {
    const m1 = busyMetric(1)
    const m2 = zeroMetric(2)
    m2.cumulativeOpen = 5
    const json = buildMetricsJson('max_rounds', 2, 3, [m1, m2], { poolSize: 1, inspect: false })
    expect(json.totals.open).toBe(5)
  })

  test('burndown copies every metric in order', () => {
    const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1), zeroMetric(2)], {
      poolSize: 1,
      inspect: false,
    })
    expect(json.burndown.length).toBe(2)
    expect(json.burndown[0]!.round).toBe(1)
    expect(json.burndown[1]!.round).toBe(2)
  })

  test('sums inspector rejected across rounds', () => {
    const metric = busyMetric(1)
    metric.inspector = { runs: 4, rejected: 2 }
    const json = buildMetricsJson('max_rounds', 2, 1, [metric], { poolSize: 1, inspect: true })
    expect(json.totals.inspectorRejected).toBe(2)
  })
})

describe('exposure line', () => {
  test('reports the distribution and the divergence count', () => {
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
    expect(summary).toContain('Exposure: 4 cited, 3 none, 2 divergent (advisory — orders dispatch, gates nothing)')
  })

  test('is omitted when no issue carried exposure, rather than printing zeros', () => {
    const summary = buildSummary({
      ...inputOf({}),
      metrics: [{ ...zeroMetric(1), reviewerExposure: { caller: 0, none: 0, unknown: 5 } }],
    })
    expect(summary).not.toContain('Exposure:')
  })

  test('is still reported when cited and none happen to be equal', () => {
    const summary = buildSummary({
      ...inputOf({}),
      metrics: [{ ...zeroMetric(1), reviewerExposure: { caller: 2, none: 2, unknown: 0 } }],
    })
    expect(summary).toContain('Exposure: 2 cited, 2 none,')
  })

  test('sums exposure across rounds', () => {
    const summary = buildSummary({
      ...inputOf({}),
      metrics: [
        { ...zeroMetric(1), reviewerExposure: { caller: 1, none: 0, unknown: 0 }, exposureDivergent: 1 },
        { ...zeroMetric(2), reviewerExposure: { caller: 2, none: 0, unknown: 0 }, exposureDivergent: 2 },
      ],
    })
    expect(summary).toContain('Exposure: 3 cited, 0 none, 3 divergent')
  })
})

function lineStartingWith(summary: string, prefix: string): string | undefined {
  return summary.split('\n').find((l) => l.startsWith(prefix))
}

describe('check-behind line', () => {
  test('reports how many accepted fixes left a check behind', () => {
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
    expect(lineStartingWith(summary, 'Checks left behind:')).toBe('Checks left behind: 2 of 3 accepted defect fixes')
  })

  test('calls out unmeasured fixes rather than folding them into either answer', () => {
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
  })

  test('is still reported when the measured and unmeasured counts happen to be equal', () => {
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
  })

  test('is omitted when no fix was accepted', () => {
    expect(buildSummary(inputOf({ metrics: [zeroMetric(1)] }))).not.toContain('Checks left behind')
  })
})

describe('per-kind reporting', () => {
  const zero = { withCheck: 0, withoutCheck: 0, unmeasured: 0 }

  test('reports the findings split once a cleanup is reported', () => {
    const summary = buildSummary({
      ...inputOf({}),
      metrics: [{ ...zeroMetric(1), reviewerKind: { defect: 4, cleanup: 2 } }],
    })
    expect(lineStartingWith(summary, 'Findings:')).toBe('Findings: 4 defect, 2 cleanup')
  })

  test('omits the findings line entirely when no cleanup was reported', () => {
    // A run that admits no cleanups must read exactly as it did before they
    // were admitted — a "0 cleanup" line on every run is noise.
    const summary = buildSummary({
      ...inputOf({}),
      metrics: [{ ...zeroMetric(1), reviewerKind: { defect: 4, cleanup: 0 } }],
    })
    expect(lineStartingWith(summary, 'Findings:')).toBeUndefined()
  })

  test('a cleanup fix that left no check does not depress the defect ratio', () => {
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
  })
})
