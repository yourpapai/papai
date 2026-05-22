// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'
import {
  buildFixPrompt,
  buildPlanningPrompt,
  buildReviewPrompt,
  buildRereviewPrompt,
  buildVerifyPrompt,
} from '../../review-loop/src/prompt-templates.js'

const reviewerIssue: ReviewerIssue = {
  title: 'Missing validation',
  severity: 'high',
  summary: 'Validation is skipped for permission requests.',
  whyItMatters: 'Unsafe permission decisions can escape the repo sandbox.',
  evidence: 'decidePermissionOptionId allows unsafe args',
  file: 'review-loop/src/permission-policy.ts',
  lineStart: 10,
  lineEnd: 20,
  suggestedFix: 'Validate commands and paths before auto-allowing them.',
  confidence: 0.9,
}

const verifierDecision: VerifierDecision = {
  verdict: 'valid',
  fixability: 'auto',
  reasoning: 'The policy is too permissive and can be tightened safely.',
  targetFiles: ['review-loop/src/permission-policy.ts'],
  needsPlanning: false,
}

const ledgerRecord: LedgerIssueRecord = {
  fingerprint: 'issue-1',
  issue: reviewerIssue,
  status: 'verified',
  firstSeenRound: 1,
  latestSeenRound: 1,
  fixAttempts: 0,
  verifierDecision,
}

describe('prompt templates', () => {
  test('buildReviewPrompt includes the plan path, expanded schema, and ledger summary', () => {
    const prompt = buildReviewPrompt('/repo/plan.md', [ledgerRecord])

    expect(prompt).toContain('Review the current implementation against the implementation plan at: /repo/plan.md.')
    expect(prompt).toContain('"severity": "critical" | "high" | "medium" | "low"')
    expect(prompt).toContain('Include all severity levels: critical, high, medium, low.')
    expect(prompt).toContain('- issue-1 [verified] Missing validation')
  })

  test('buildVerifyPrompt includes the verification schema with needsPlanning and issue payload', () => {
    const prompt = buildVerifyPrompt('/repo/plan.md', reviewerIssue)

    expect(prompt).toContain('Verify this issue against the implementation plan at: /repo/plan.md.')
    expect(prompt).toContain('"verdict": "valid" | "invalid" | "already_fixed" | "needs_human"')
    expect(prompt).toContain('"needsPlanning": boolean')
    expect(prompt).toContain('"title": "Missing validation"')
  })

  test('buildPlanningPrompt includes issue and decision', () => {
    const prompt = buildPlanningPrompt(reviewerIssue, verifierDecision)

    expect(prompt).toContain('Produce a step-by-step plan to fix')
    expect(prompt).toContain('"title": "Missing validation"')
    expect(prompt).toContain('"verdict": "valid"')
  })

  test('buildFixPrompt with plan includes the plan text and commit instructions', () => {
    const prompt = buildFixPrompt(reviewerIssue, verifierDecision, 'Step 1: Update queue.ts')

    expect(prompt).toContain('Fix Plan:')
    expect(prompt).toContain('Step 1: Update queue.ts')
    expect(prompt).toContain('Commit with message')
    expect(prompt).toContain('fix(review-loop):')
    expect(prompt).toContain('bun check:full')
  })

  test('buildFixPrompt without plan omits plan section but includes commit instructions', () => {
    const prompt = buildFixPrompt(reviewerIssue, verifierDecision)

    expect(prompt).not.toContain('Fix Plan:')
    expect(prompt).toContain('fix(review-loop):')
    expect(prompt).toContain('bun check:full')
  })

  test('buildFixPrompt includes issue and verifier decision payloads', () => {
    const prompt = buildFixPrompt(reviewerIssue, verifierDecision)

    expect(prompt).toContain('Fix exactly the verified issue below.')
    expect(prompt).toContain('"title": "Missing validation"')
    expect(prompt).toContain('"verdict": "valid"')
  })

  test('buildRereviewPrompt includes expanded severity and empty-ledger fallback', () => {
    const prompt = buildRereviewPrompt('/repo/plan.md', [])

    expect(prompt).toContain('Re-review the current implementation against the implementation plan at: /repo/plan.md.')
    expect(prompt).toContain('Use the same schema as the original review prompt.')
    expect(prompt).toContain('No prior issues recorded.')
    expect(prompt).toContain('critical/high/medium/low')
  })
})
