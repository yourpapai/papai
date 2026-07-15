// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { buildFixPrompt, buildReviewPrompt, buildRetryFixPrompt } from '../../review-loop/src/prompt-templates.js'

const issue: ReviewerIssue = {
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

describe('prompt-templates', () => {
  test('buildReviewPrompt includes plan path, output path, and schema', () => {
    const prompt = buildReviewPrompt('/path/to/plan.md', '/path/to/issues.json')
    expect(prompt).toContain('/path/to/plan.md')
    expect(prompt).toContain('/path/to/issues.json')
    expect(prompt).toContain('"issues"')
    expect(prompt).toContain('severity')
  })

  test('buildFixPrompt includes issue JSON, output path, commit instructions', () => {
    const prompt = buildFixPrompt(issue, '/path/to/result.json')
    expect(prompt).toContain('src/message-queue/queue.ts')
    expect(prompt).toContain('/path/to/result.json')
    expect(prompt).toContain('commit')
    expect(prompt).toContain('fix(review-loop)')
  })

  test('buildRetryFixPrompt includes error output', () => {
    const prompt = buildRetryFixPrompt(issue, '/path/to/result.json', 'TypeError: x is not a function')
    expect(prompt).toContain('TypeError: x is not a function')
    expect(prompt).toContain('/path/to/result.json')
  })
})
