// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { capCleanupSeverity } from '../../review-loop/src/review-round.js'

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  kind: 'defect',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

const severities = (issues: readonly ReviewerIssue[]): string[] => issues.map((i) => i.severity)

/**
 * The prompt states the cap; this is what enforces it. A rule a model has to
 * remember is a courtesy, and severity is the standing proof that self-assigned
 * ratings inflate — which is why `exposure` was built as a citation instead.
 */
describe('theme spans', () => {
  test('capCleanupSeverity preserves spans', () => {
    const themed: ReviewerIssue = {
      ...issue,
      kind: 'cleanup',
      severity: 'critical',
      spans: [
        { file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' },
        { file: 'src/b.ts', lineStart: 3, lineEnd: 4, evidence: 'e2' },
      ],
    }
    const out = capCleanupSeverity([themed])
    expect(out[0]?.spans).toHaveLength(2)
    expect(out[0]?.severity).toBe('medium')
  })
})

describe('capCleanupSeverity', () => {
  test('a cleanup above medium is recorded as medium', () => {
    const issues = capCleanupSeverity([
      { ...issue, kind: 'cleanup', severity: 'critical' },
      { ...issue, kind: 'cleanup', severity: 'high' },
    ])
    expect(severities(issues)).toEqual(['medium', 'medium'])
  })

  test('a cleanup at or below medium is left alone', () => {
    const issues = capCleanupSeverity([
      { ...issue, kind: 'cleanup', severity: 'medium' },
      { ...issue, kind: 'cleanup', severity: 'low' },
    ])
    expect(severities(issues)).toEqual(['medium', 'low'])
  })

  test('a defect keeps its severity at every level', () => {
    const issues = capCleanupSeverity([
      { ...issue, severity: 'critical' },
      { ...issue, severity: 'high' },
      { ...issue, severity: 'medium' },
      { ...issue, severity: 'low' },
    ])
    expect(severities(issues)).toEqual(['critical', 'high', 'medium', 'low'])
  })

  test('leaves every other field untouched and does not mutate its input', () => {
    const original: ReviewerIssue = { ...issue, kind: 'cleanup', severity: 'critical' }
    const out = capCleanupSeverity([original])
    expect(original.severity).toBe('critical')
    expect(out[0]).toEqual({ ...original, severity: 'medium' })
  })

  test('a round with no cleanups passes through unchanged', () => {
    const input = [issue]
    expect(capCleanupSeverity(input)).toEqual(input)
  })
})
