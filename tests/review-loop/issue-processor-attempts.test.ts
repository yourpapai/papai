// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import { buildAttemptPrompt, type AttemptPromptDeps } from '../../review-loop/src/issue-processor-attempts.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'

describe('buildAttemptPrompt', () => {
  test('builds inspector-rejection retry prompt', () => {
    const issue: ReviewerIssue = {
      title: 'x',
      severity: 'low',
      summary: 's',
      whyItMatters: 'w',
      evidence: 'e',
      file: 'src/q.ts',
      lineStart: 1,
      lineEnd: 2,
      suggestedFix: 'f',
      confidence: 0.9,
    }
    const deps: AttemptPromptDeps = {
      config: { checkCommand: 'bun check:full' },
      runState: { resultPath: '/tmp/result.json' },
    }
    const record: LedgerIssueRecord = {
      id: 'rec-1',
      issue,
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }

    const prompt = buildAttemptPrompt(deps, record, {
      kind: 'inspector_rejection',
      inspectorReasoning: 'does not address the bug',
    })

    expect(prompt).toContain('rejected by an inspector')
    expect(prompt).toContain('does not address the bug')
  })
})
