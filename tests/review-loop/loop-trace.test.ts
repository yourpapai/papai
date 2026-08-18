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
  truncate,
} from '../../review-loop/src/loop-trace.js'
import { newCollector, tallyDecision, tallyFixerSeverity } from '../../review-loop/src/round-collector.js'
import { createCapturingTraceLogger, type TraceEvent } from '../../review-loop/src/trace-log.js'

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

function requireInspectComplete(evt: TraceEvent): Extract<TraceEvent, { event: 'inspect_complete' }> {
  if (evt.event !== 'inspect_complete') throw new Error(`expected inspect_complete, got ${evt.event}`)
  return evt
}

describe('loop-trace emitters', () => {
  test('emitRoundStart pushes a round_start event', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitRoundStart(logger, 1, 5, 2, 'bun check')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      phase: 'round',
      event: 'round_start',
      round: 1,
      maxRounds: 5,
      checkCommand: 'bun check',
    })
  })

  test('emitReviewComplete maps issue fields', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitReviewComplete(logger, 1, [issue])
    expect(events[0]).toMatchObject({
      phase: 'review',
      event: 'review_complete',
      issueCount: 1,
    })
    expect(events[0]).toMatchObject({
      issues: [{ title: 'T', severity: 'high', file: 'f.ts' }],
    })
  })

  test('emitMatchComplete, emitBuildComplete, emitFixComplete push expected shapes', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitMatchComplete(logger, 1, 2, 3)
    emitBuildComplete(logger, 1, 'id', true, 1, 42)
    emitFixComplete(logger, 1, 'id', true, 'deadbeef', 1)
    expect(events.map((e) => e.event)).toEqual(['match_complete', 'build_complete', 'fix_complete'])
    expect(events.map((e) => e.phase)).toEqual(['match', 'build', 'fix'])
    expect(events[1]).toMatchObject({
      passed: true,
      attempt: 1,
      durationMs: 42,
    })
    expect(events[2]).toMatchObject({
      fixed: true,
      commitSha: 'deadbeef',
      attempt: 1,
    })
  })

  test('emitVerifyComplete spreads targetFiles', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitVerifyComplete(
      logger,
      1,
      'id',
      'valid',
      'auto',
      {
        reviewerSeverity: 'high',
        fixerSeverity: null,
        reviewerExposure: 'caller',
        fixerExposure: 'none',
      },
      'r',
      ['a.ts', 'b.ts'],
    )
    expect(events[0]).toMatchObject({
      phase: 'verify',
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
    const metric = {
      round: 1,
      newIssues: 1,
      cumulativeOpen: 2,
      noProgressRounds: 0,
      ...collector,
    }
    emitRoundSummary(logger, metric)
    emitLoopEnd(logger, 1, 'clean', [metric])
    expect(events[0]).toMatchObject({
      phase: 'round',
      event: 'round_summary',
      round: 1,
    })
    expect(events[1]).toMatchObject({
      phase: 'loop',
      event: 'loop_end',
      doneReason: 'clean',
      rounds: 1,
      burndown: [{ round: 1, newIssues: 1 }],
    })
  })

  test('truncate shortens', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
  })

  test('truncate leaves text at or under the limit unchanged', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcde', 5)).toBe('abcde')
  })

  test('emitters stamp each event with an ISO timestamp', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitRoundStart(logger, 1, 5, 2, 'bun check')
    expect(events[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  })
})

describe('emitInspectComplete', () => {
  test('appends an inspect_complete event with truncated reasoning', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitInspectComplete(logger, 1, 'rec-1', false, 0.8, 'x'.repeat(300))
    expect(events).toHaveLength(1)
    const evt = requireInspectComplete(events[0]!)
    expect(evt.event).toBe('inspect_complete')
    expect(evt.phase).toBe('inspect')
    expect(evt.addresses).toBe(false)
    expect(evt.reasoning.length).toBeLessThanOrEqual(200)
  })
})
