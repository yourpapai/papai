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

  test('buildFixPrompt includes issue JSON, output path, and check command', () => {
    const prompt = buildFixPrompt(issue, '/path/to/result.json', 'npm test')
    expect(prompt).toContain('src/message-queue/queue.ts')
    expect(prompt).toContain('/path/to/result.json')
    expect(prompt).toContain('`npm test`')
    expect(prompt).not.toContain('bun check:full')
    expect(prompt).not.toContain('fix(review-loop):')
  })

  test('buildRetryFixPrompt includes error output and check command', () => {
    const prompt = buildRetryFixPrompt(issue, '/path/to/result.json', 'TypeError: x is not a function', 'npm test')
    expect(prompt).toContain('TypeError: x is not a function')
    expect(prompt).toContain('/path/to/result.json')
    expect(prompt).toContain('`npm test`')
  })

  test('reviewer prompt keeps sentinel + gains evidence/scope/severity/convention clauses', () => {
    const p = buildReviewPrompt('/plan.md', '/issues.json')
    expect(p).toContain('Review the current implementation')
    expect(p).toContain('AGENTS.md')
    expect(p).toContain('evidence')
    expect(p).toContain('critical')
    expect(p).toContain('low')
  })

  test('review prompt forbids running test suites and build checks', () => {
    const p = buildReviewPrompt('/plan.md', '/issues.json')
    expect(p).toContain('do NOT run')
    expect(p).toContain('git diff')
    expect(p).toContain('fixer')
  })

  test('fixer prompt keeps sentinel, drops commit instruction, asks for commitMessage + severity', () => {
    const p = buildFixPrompt(issue, '/result.json', 'bun check:full')
    expect(p).toContain('Verify and fix')
    expect(p).toContain('commitMessage')
    expect(p).toContain('severity')
    expect(p).toContain('plan_drift')
    expect(p).not.toContain('commit with message')
  })

  test('retry prompt inlines schema (no "same schema as before") + final-attempt', () => {
    const p = buildRetryFixPrompt(issue, '/result.json', 'TypeError: x', 'bun check:full')
    expect(p).toContain('build error')
    expect(p).toContain('"verdict"')
    expect(p).not.toContain('same schema as before')
    expect(p).toContain('final attempt')
  })
})
