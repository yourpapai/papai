// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { computeIssueFingerprint } from '../../review-loop/src/issue-fingerprint.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'

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

test('computeIssueFingerprint stays stable across small line shifts and formatting changes', () => {
  const shiftedIssue: ReviewerIssue = {
    ...issue,
    title: '  race condition in queue flush path  ',
    summary: 'two concurrent messages can bypass the intended lock. ',
    whyItMatters: 'This can produce stale assistant replies.',
    evidence: 'src/message-queue/queue.ts lines 92-115',
    lineStart: 92,
    lineEnd: 115,
  }

  expect(computeIssueFingerprint(shiftedIssue)).toBe(computeIssueFingerprint(issue))
})
