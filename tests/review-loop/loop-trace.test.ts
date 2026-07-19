// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import {
  emitBuildComplete,
  emitFixComplete,
  emitLoopEnd,
  emitMatchComplete,
  emitReviewComplete,
  emitRoundStart,
  emitRoundSummary,
  emitVerifyComplete,
  newCollector,
  tallyDecision,
  tallyFixerSeverity,
  tallyReviewerIssues,
  truncate,
} from '../../review-loop/src/loop-trace.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'

const issue: ReviewerIssue = {
  title: 'T',
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
    emitVerifyComplete(logger, 1, 'id', 'valid', 'auto', 'high', null, 'r', ['a.ts', 'b.ts'])
    expect(events[0]).toMatchObject({
      event: 'verify_complete',
      verdict: 'valid',
      reviewerSeverity: 'high',
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
