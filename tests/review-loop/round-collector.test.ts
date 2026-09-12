// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import {
  exposureKind,
  newCollector,
  tallyCheckBehind,
  tallyDecision,
  tallyExposure,
  tallyInspector,
  tallyPhaseMs,
  tallyReviewerIssues,
  tallyUsage,
} from '../../review-loop/src/round-collector.js'

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

describe('round-collector tallies', () => {
  test('tallyDecision buckets verdicts; tallyReviewerIssues counts severity', () => {
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
    tallyUsage(c, {
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0.01,
      wallMs: 1000,
    })
    tallyUsage(c, {
      inputTokens: 200,
      outputTokens: 25,
      reasoningTokens: 5,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0.02,
      wallMs: 500,
    })
    expect(c.usage.inputTokens).toBe(300)
    expect(c.usage.outputTokens).toBe(75)
    expect(c.usage.reasoningTokens).toBe(15)
    expect(c.usage.costUsd).toBeCloseTo(0.03)
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
