// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseReviewerIssues, parseVerifierDecision } from '../../review-loop/src/issue-schema.js'

describe('issue schema parsing', () => {
  test('parseReviewerIssues accepts structured critical/high issues', () => {
    const parsed = parseReviewerIssues(
      JSON.stringify({
        round: 1,
        issues: [
          {
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
          },
        ],
      }),
    )

    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]?.severity).toBe('high')
  })

  test('parseReviewerIssues accepts fenced JSON with surrounding text', () => {
    const parsed = parseReviewerIssues(
      [
        'Here is the structured review output:',
        '',
        '```json',
        '{"round":2,"issues":[]}',
        '```',
        '',
        'That is the full result.',
      ].join('\n'),
    )

    expect(parsed.round).toBe(2)
    expect(parsed.issues).toHaveLength(0)
  })

  test('parseVerifierDecision accepts lightly wrapped JSON', () => {
    const parsed = parseVerifierDecision(
      `Verifier result follows.

{"verdict":"valid","fixability":"auto","reasoning":"Looks good.","targetFiles":["src/app.ts"],"needsPlanning":false}

End result.`,
    )

    expect(parsed.verdict).toBe('valid')
    expect(parsed.targetFiles).toEqual(['src/app.ts'])
    expect(parsed.needsPlanning).toBe(false)
  })

  test('parseReviewerIssues rejects ambiguous multi-json responses', () => {
    expect(() =>
      parseReviewerIssues(`{"round":1,"issues":[]}
{"round":2,"issues":[]}`),
    ).toThrow()
  })

  test('parseReviewerIssues accepts medium severity', () => {
    const parsed = parseReviewerIssues(
      JSON.stringify({
        round: 1,
        issues: [
          {
            title: 'Minor naming inconsistency',
            severity: 'medium',
            summary: 'Variable names do not follow convention.',
            whyItMatters: 'Reduces readability for new contributors.',
            evidence: 'src/utils.ts line 42',
            file: 'src/utils.ts',
            lineStart: 42,
            lineEnd: 44,
            suggestedFix: 'Rename to camelCase.',
            confidence: 0.7,
          },
        ],
      }),
    )

    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]?.severity).toBe('medium')
  })

  test('parseReviewerIssues accepts low severity', () => {
    const parsed = parseReviewerIssues(
      JSON.stringify({
        round: 1,
        issues: [
          {
            title: 'Extra blank line',
            severity: 'low',
            summary: 'Double blank line between functions.',
            whyItMatters: 'Minor style issue.',
            evidence: 'src/utils.ts line 50',
            file: 'src/utils.ts',
            lineStart: 50,
            lineEnd: 51,
            suggestedFix: 'Remove extra blank line.',
            confidence: 0.6,
          },
        ],
      }),
    )

    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]?.severity).toBe('low')
  })

  test('parseVerifierDecision accepts needsPlanning boolean', () => {
    const parsed = parseVerifierDecision(
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'Complex multi-file change needed.',
        targetFiles: ['src/a.ts', 'src/b.ts'],
        needsPlanning: true,
      }),
    )

    expect(parsed.needsPlanning).toBe(true)
  })

  test('parseVerifierDecision rejects freeform prose', () => {
    expect(() => parseVerifierDecision('looks valid to me')).toThrow(
      'Expected exactly one JSON object for verifier decision',
    )
  })
})
