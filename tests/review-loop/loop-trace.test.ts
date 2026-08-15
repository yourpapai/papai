// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import {
  emitBuildComplete,
  emitFixComplete,
  emitInspectComplete,
  emitLoopEnd,
  emitMatchComplete,
  emitReviewComplete,
  emitRoundStart,
  emitRoundSummary,
  emitVerifyComplete,
  newCollector,
  tallyCheckBehind,
  tallyDecision,
  exposureKind,
  tallyExposure,
  tallyFixerSeverity,
  tallyInspector,
  tallyPhaseMs,
  tallyReviewerIssues,
  tallyUsage,
  truncate,
} from '../../review-loop/src/loop-trace.js'
import { createCapturingTraceLogger, type TraceEvent } from '../../review-loop/src/trace-log.js'

function requireInspectComplete(evt: TraceEvent): Extract<TraceEvent, { event: 'inspect_complete' }> {
  if (evt.event !== 'inspect_complete') throw new Error(`expected inspect_complete, got ${evt.event}`)
  return evt
}

const issue: ReviewerIssue = {
  title: 'T',
  kind: 'defect',
  severity: 'high',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'e',
  file: 'f.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'fix',
  confidence: 0.5,
}

describe('loop-trace emitters', () => {
  test('emitRoundStart pushes a round_start event', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitRoundStart(logger, 1, 5, 2, 'bun check')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'round_start', round: 1, maxRounds: 5, checkCommand: 'bun check' })
  })

  test('emitReviewComplete maps issue fields', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitReviewComplete(logger, 1, [issue])
    expect(events[0]).toMatchObject({ event: 'review_complete', issueCount: 1 })
    expect(events[0]).toMatchObject({ issues: [{ title: 'T', severity: 'high', file: 'f.ts' }] })
  })

  test('emitMatchComplete, emitBuildComplete, emitFixComplete push expected shapes', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitMatchComplete(logger, 1, 2, 3)
    emitBuildComplete(logger, 1, 'id', true, 1, 42)
    emitFixComplete(logger, 1, 'id', true, 'deadbeef', 1)
    expect(events.map((e) => e.event)).toEqual(['match_complete', 'build_complete', 'fix_complete'])
    expect(events[1]).toMatchObject({ passed: true, attempt: 1, durationMs: 42 })
    expect(events[2]).toMatchObject({ fixed: true, commitSha: 'deadbeef', attempt: 1 })
  })

  test('emitVerifyComplete spreads targetFiles', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitVerifyComplete(
      logger,
      1,
      'id',
      'valid',
      'auto',
      { reviewerSeverity: 'high', fixerSeverity: null, reviewerExposure: 'caller', fixerExposure: 'none' },
      'r',
      ['a.ts', 'b.ts'],
    )
    expect(events[0]).toMatchObject({
      event: 'verify_complete',
      verdict: 'valid',
      reviewerSeverity: 'high',
      reviewerExposure: 'caller',
      fixerExposure: 'none',
      targetFiles: ['a.ts', 'b.ts'],
    })
  })

  test('emitRoundSummary and emitLoopEnd carry metrics', () => {
    const { logger, events } = createCapturingTraceLogger()
    const collector = newCollector()
    tallyDecision(collector, 'valid', true)
    tallyFixerSeverity(collector, 'medium')
    const metric = { round: 1, newIssues: 1, cumulativeOpen: 2, noProgressRounds: 0, ...collector }
    emitRoundSummary(logger, metric)
    emitLoopEnd(logger, 1, 'clean', [metric])
    expect(events[0]).toMatchObject({ event: 'round_summary', round: 1 })
    expect(events[1]).toMatchObject({
      event: 'loop_end',
      doneReason: 'clean',
      rounds: 1,
      burndown: [{ round: 1, newIssues: 1 }],
    })
  })

  test('tallyDecision buckets verdicts; tallyReviewerIssues counts severity; truncate shortens', () => {
    const c = newCollector()
    tallyDecision(c, 'valid', true)
    tallyDecision(c, 'valid', false)
    tallyDecision(c, 'invalid', false)
    tallyDecision(c, 'plan_drift', false)
    tallyDecision(c, 'needs_human', false)
    tallyDecision(c, 'already_fixed', false)
    expect(c.decisions.fixed).toBe(1)
    expect(c.decisions.needs_human).toBe(2)
    expect(c.decisions.invalid).toBe(1)
    expect(c.decisions.plan_drift).toBe(1)
    expect(c.decisions.already_fixed).toBe(1)
    tallyReviewerIssues(c, [issue, { ...issue, severity: 'low' }])
    expect(c.reviewerSeverity.high).toBe(1)
    expect(c.reviewerSeverity.low).toBe(1)
    expect(truncate('abcdefghij', 5).length).toBeLessThan(6)
  })
})

describe('tallyInspector', () => {
  test('increments runs on every call; rejected only when addresses=false', () => {
    const c = newCollector()
    tallyInspector(c, true)
    tallyInspector(c, false)
    expect(c.inspector.runs).toBe(2)
    expect(c.inspector.rejected).toBe(1)
  })
})

describe('tallyPhaseMs', () => {
  test('accumulates ms per phase bucket', () => {
    const c = newCollector()
    tallyPhaseMs(c, 'review', 100)
    tallyPhaseMs(c, 'review', 50)
    tallyPhaseMs(c, 'build', 200)
    expect(c.phaseMs.review).toBe(150)
    expect(c.phaseMs.build).toBe(200)
  })
})

describe('tallyUsage', () => {
  test('accumulates tokens and cost', () => {
    const c = newCollector()
    tallyUsage(c, { inputTokens: 100, outputTokens: 50, reasoningTokens: 10, costUsd: 0.01, wallMs: 1000 })
    tallyUsage(c, { inputTokens: 200, outputTokens: 25, reasoningTokens: 5, costUsd: 0.02, wallMs: 500 })
    expect(c.usage.inputTokens).toBe(300)
    expect(c.usage.outputTokens).toBe(75)
    expect(c.usage.reasoningTokens).toBe(15)
    expect(c.usage.costUsd).toBeCloseTo(0.03)
  })
})

describe('emitInspectComplete', () => {
  test('appends an inspect_complete event with truncated reasoning', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitInspectComplete(logger, 1, 'rec-1', false, 0.8, 'x'.repeat(300))
    expect(events).toHaveLength(1)
    const evt = requireInspectComplete(events[0]!)
    expect(evt.event).toBe('inspect_complete')
    expect(evt.addresses).toBe(false)
    expect(evt.reasoning.length).toBeLessThanOrEqual(200)
  })
})

describe('exposure tallies', () => {
  test('records both reporters distributions', () => {
    const collector = newCollector()
    tallyExposure(collector, 'caller', 'caller')
    tallyExposure(collector, 'none', 'none')
    tallyExposure(collector, 'caller', 'none')
    expect(collector.reviewerExposure).toEqual({ caller: 2, none: 1, unknown: 0 })
    expect(collector.fixerExposure).toEqual({ caller: 1, none: 2, unknown: 0 })
  })

  test('counts a divergence when both answered and disagreed', () => {
    const collector = newCollector()
    tallyExposure(collector, 'caller', 'none')
    tallyExposure(collector, 'none', 'caller')
    expect(collector.exposureDivergent).toBe(2)
  })

  test('agreement is not a divergence', () => {
    const collector = newCollector()
    tallyExposure(collector, 'caller', 'caller')
    tallyExposure(collector, 'none', 'none')
    expect(collector.exposureDivergent).toBe(0)
  })

  test('unknown on either side is not a divergence: silence is not disagreement', () => {
    const collector = newCollector()
    tallyExposure(collector, 'unknown', 'caller')
    tallyExposure(collector, 'caller', 'unknown')
    tallyExposure(collector, 'unknown', 'unknown')
    expect(collector.exposureDivergent).toBe(0)
    expect(collector.reviewerExposure.unknown).toBe(2)
    expect(collector.fixerExposure.unknown).toBe(2)
  })

  test('exposureKind reads an absent report as unknown, not as none', () => {
    expect(exposureKind(undefined)).toBe('unknown')
    expect(exposureKind({ kind: 'none' })).toBe('none')
    expect(exposureKind({ kind: 'caller', file: 'a.ts', line: 1, quote: 'q' })).toBe('caller')
  })
})

describe('check-behind tallies', () => {
  test('counts each outcome separately, keeping unmeasured out of both', () => {
    const collector = newCollector()
    tallyCheckBehind(collector, 'with-check', 'defect')
    tallyCheckBehind(collector, 'with-check', 'defect')
    tallyCheckBehind(collector, 'without-check', 'defect')
    tallyCheckBehind(collector, 'unmeasured', 'defect')
    expect(collector.checkBehind.defect).toEqual({ withCheck: 2, withoutCheck: 1, unmeasured: 1 })
  })
})

describe('per-kind counts', () => {
  const cleanup: ReviewerIssue = { ...issue, kind: 'cleanup' }

  test('tallyReviewerIssues counts defects and cleanups separately', () => {
    const collector = newCollector()
    tallyReviewerIssues(collector, [issue, cleanup, cleanup])
    expect(collector.reviewerKind).toEqual({ defect: 1, cleanup: 2 })
  })

  test('a round with no cleanups reports zero, not an absent field', () => {
    const collector = newCollector()
    tallyReviewerIssues(collector, [issue])
    expect(collector.reviewerKind).toEqual({ defect: 1, cleanup: 0 })
  })

  test('tallyCheckBehind books the outcome under the fixed issue kind', () => {
    // A cleanup that deletes code introduces no non-trivial logic, so it
    // legitimately leaves no check. Pooling the two would let cleanups depress
    // the ratio the defect rule is actually measured by.
    const collector = newCollector()
    tallyCheckBehind(collector, 'with-check', 'defect')
    tallyCheckBehind(collector, 'without-check', 'cleanup')
    tallyCheckBehind(collector, 'unmeasured', 'cleanup')
    expect(collector.checkBehind.defect).toEqual({ withCheck: 1, withoutCheck: 0, unmeasured: 0 })
    expect(collector.checkBehind.cleanup).toEqual({ withCheck: 0, withoutCheck: 1, unmeasured: 1 })
  })
})
