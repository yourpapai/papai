// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  FixerResultSchema,
  IssueMatchesSchema,
  ReviewerIssueSchema,
  ReviewerIssuesSchema,
  VerifierDecisionSchema,
} from '../../review-loop/src/issue-schema.js'

const validIssue = {
  title: 'Race condition in queue flush path',
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

describe('issue-schema', () => {
  test('ReviewerIssueSchema accepts all severity levels', () => {
    for (const severity of ['critical', 'high', 'medium', 'low']) {
      expect(() => ReviewerIssueSchema.parse({ ...validIssue, severity })).not.toThrow()
    }
  })

  test('ReviewerIssuesSchema accepts issues array without round', () => {
    expect(() => ReviewerIssuesSchema.parse({ issues: [validIssue] })).not.toThrow()
  })

  test('VerifierDecisionSchema does not include needsPlanning', () => {
    const decision = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'The control flow is unsafe.',
      targetFiles: ['src/message-queue/queue.ts'],
    }
    expect(() => VerifierDecisionSchema.parse(decision)).not.toThrow()
    expect(VerifierDecisionSchema.parse(decision)).not.toHaveProperty('needsPlanning')
  })

  test('FixerResultSchema extends VerifierDecision with fixed and commitSha', () => {
    const result = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'Fixed.',
      targetFiles: ['src/message-queue/queue.ts'],
      fixed: true,
      commitSha: 'abc123',
    }
    expect(() => FixerResultSchema.parse(result)).not.toThrow()
  })

  test('FixerResultSchema accepts result without commitSha', () => {
    const result = {
      verdict: 'invalid',
      fixability: 'manual',
      reasoning: 'False positive.',
      targetFiles: [],
      fixed: false,
    }
    expect(() => FixerResultSchema.parse(result)).not.toThrow()
  })

  test('IssueMatchesSchema accepts array of matches', () => {
    const data = {
      matches: [
        { newIssueIndex: 0, existingId: 'issue-001' },
        { newIssueIndex: 1, existingId: null },
      ],
    }
    expect(() => IssueMatchesSchema.parse(data)).not.toThrow()
  })

  test('FixerResultSchema accepts optional commitMessage and severity', () => {
    const base = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'r',
      targetFiles: [],
      fixed: true,
    } as const
    expect(FixerResultSchema.safeParse(base).success).toBe(true)
    const parsed = FixerResultSchema.parse({
      ...base,
      commitMessage: 'fix(review-loop): tighten guard',
      severity: 'low',
    })
    expect(parsed.commitMessage).toBe('fix(review-loop): tighten guard')
    expect(parsed.severity).toBe('low')
  })

  test('VerifierDecisionSchema accepts plan_drift verdict (additive)', () => {
    expect(
      VerifierDecisionSchema.safeParse({
        verdict: 'plan_drift',
        fixability: 'manual',
        reasoning: 'code diverged from plan',
        targetFiles: [],
      }).success,
    ).toBe(true)
  })
})
