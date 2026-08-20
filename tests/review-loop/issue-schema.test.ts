// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  FixerResultSchema,
  InspectorResultSchema,
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

describe('InspectorResultSchema', () => {
  test('accepts a valid inspector result', () => {
    const parsed = InspectorResultSchema.parse({
      addresses: true,
      reasoning: 'The diff at line 12 fixes the race by adding the lock.',
      confidence: 0.9,
    })
    expect(parsed.addresses).toBe(true)
  })

  test('rejects missing reasoning', () => {
    expect(() => InspectorResultSchema.parse({ addresses: false, confidence: 0.5 })).toThrow()
  })

  test('rejects confidence out of range', () => {
    expect(() => InspectorResultSchema.parse({ addresses: true, reasoning: 'ok', confidence: 1.5 })).toThrow()
  })
})

describe('exposure', () => {
  const citation = { kind: 'caller', file: 'src/chat/router.ts', line: 42, quote: '  await flushQueue(ctx)' } as const

  test('ReviewerIssueSchema accepts a cited caller', () => {
    const parsed = ReviewerIssueSchema.parse({ ...validIssue, exposure: citation })
    expect(parsed.exposure).toEqual(citation)
  })

  test('ReviewerIssueSchema accepts an explicit "none found"', () => {
    const parsed = ReviewerIssueSchema.parse({ ...validIssue, exposure: { kind: 'none' } })
    expect(parsed.exposure?.kind).toBe('none')
  })

  test('ReviewerIssueSchema parses an issue written before exposure existed', () => {
    const parsed = ReviewerIssueSchema.parse(validIssue)
    expect(parsed.exposure).toBeUndefined()
  })

  test('ReviewerIssueSchema rejects a caller citation missing its quote', () => {
    expect(() =>
      ReviewerIssueSchema.parse({ ...validIssue, exposure: { kind: 'caller', file: 'a.ts', line: 1 } }),
    ).toThrow()
  })

  test('ReviewerIssueSchema rejects an unknown exposure kind', () => {
    expect(() => ReviewerIssueSchema.parse({ ...validIssue, exposure: { kind: 'probably' } })).toThrow()
  })

  test('FixerResultSchema carries the fixer own exposure', () => {
    const parsed = FixerResultSchema.parse({
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'Fixed.',
      targetFiles: ['a.ts'],
      fixed: true,
      exposure: citation,
    })
    expect(parsed.exposure).toEqual(citation)
  })

  test('VerifierDecisionSchema strips exposure: it drives ledger status and must not carry it', () => {
    const parsed = VerifierDecisionSchema.parse({
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'Fixed.',
      targetFiles: ['a.ts'],
      exposure: citation,
    })
    expect(parsed).not.toHaveProperty('exposure')
  })
})

describe('issue kind', () => {
  test('ReviewerIssueSchema accepts both kinds', () => {
    expect(ReviewerIssueSchema.parse({ ...validIssue, kind: 'defect' }).kind).toBe('defect')
    expect(ReviewerIssueSchema.parse({ ...validIssue, kind: 'cleanup' }).kind).toBe('cleanup')
  })

  test('an issue written before kind existed reads as a defect', () => {
    // Unlike `exposure`, absent is not a third state here: a ledger written
    // before cleanups were admitted holds only defects, so the default states
    // a truth rather than papering over a gap.
    expect(ReviewerIssueSchema.parse(validIssue).kind).toBe('defect')
  })

  test('ReviewerIssueSchema rejects a kind outside the two', () => {
    expect(() => ReviewerIssueSchema.parse({ ...validIssue, kind: 'refactor' })).toThrow()
  })
})
