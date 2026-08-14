// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { commandSurface, feedbackTarget } from '../../opencode-agent/src/feedback-target.js'
import type { AgentState } from '../../opencode-agent/src/types.js'

const state = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'COMPLETE',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: 'add-retries',
  planRevision: 1,
  tokensSpent: 0,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

describe('feedbackTarget', () => {
  test('is the issue while there is no pull request', () => {
    expect(feedbackTarget(state())).toBe(42)
  })

  test('is the pull request once one exists', () => {
    expect(feedbackTarget(state({ prNumber: 7, prUrl: 'https://example.invalid/pull/7' }))).toBe(7)
  })
})

describe('commandSurface', () => {
  test('the issue is where commands are typed until the pull request exists', () => {
    expect(commandSurface(state(), 'issue')).toBe('accepted')
    expect(commandSurface(state(), 'pull-request')).toBe('accepted')
  })

  test('the pull request takes over once it exists', () => {
    const delivered = state({ prNumber: 7, prUrl: 'https://example.invalid/pull/7' })

    expect(commandSurface(delivered, 'pull-request')).toBe('accepted')
    expect(commandSurface(delivered, 'issue')).toBe('elsewhere')
  })
})
