// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { applySteeringIntent } from '../../opencode-agent/src/comment-intent.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * Design D6 — steering-drift.
 *
 * A plain maintainer comment that arrives while the agent is implementing
 * (`REVIEW_AND_MUTATE`) is classified: scope-affecting steering (`changes`)
 * routes back to `PLANNING` for an artifact-update turn (edit → validate →
 * commit) before implementation continues, so the folder cannot rot relative to
 * the conversation. Anything else skips — implementation is not interrupted for
 * ambiguity, and a maintainer who wants to ask uses `/ask`.
 */

const AGENT_LOGIN = 'agent-bot'

const implState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'REVIEW_AND_MUTATE',
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

const commentTrigger = (body: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'OWNER',
  issueNumber: 42,
  issueTitle: 'Add retries',
  issueBody: 'Please add a retry helper.',
  isPullRequest: false,
  commentBody: body,
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const steer = (replies: readonly string[], state: Partial<AgentState> = {}): { input: PhaseInput } => {
  const recording = stubPhaseDeps({ replies: [...replies], selfLogin: AGENT_LOGIN })
  return {
    input: {
      state: implState(state),
      issue: { number: 42, title: 'Add retries', body: 'Please add a retry helper.' },
      trigger: commentTrigger('Actually, also add structured logging to each retry.'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    },
  }
}

describe('applySteeringIntent · steering-drift in REVIEW_AND_MUTATE (D6)', () => {
  it('routes a scope-affecting comment to PLANNING for an artifact-update turn', async () => {
    const { input } = steer([JSON.stringify({ intent: 'changes' })])

    const outcome = await applySteeringIntent(input)

    expect(outcome.state.phase).toBe('PLANNING')
    expect(outcome.halt).toBeNull()
    expect(outcome.answer).toBe(false)
  })

  it('skips chatter so a mid-implementation 👍 does not re-plan', async () => {
    const { input } = steer([JSON.stringify({ intent: 'none' })])

    const outcome = await applySteeringIntent(input)

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.state.phase).toBe('REVIEW_AND_MUTATE')
  })

  it('skips a question rather than interrupting implementation (use /ask to ask)', async () => {
    const { input } = steer([JSON.stringify({ intent: 'question' })])

    const outcome = await applySteeringIntent(input)

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.state.phase).toBe('REVIEW_AND_MUTATE')
  })

  it('skips a blank body (the agent posted, not a person)', async () => {
    const recording = stubPhaseDeps({ replies: [], selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: implState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger(''),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applySteeringIntent(input)

    expect(outcome.halt?.status).toBe('skipped')
    // No model turn bought to classify an empty comment.
    expect(recording.io.prompts).toHaveLength(0)
  })

  it('does not pay to classify a comment the budget cannot act on', async () => {
    const { input } = steer([JSON.stringify({ intent: 'changes' })], { tokensSpent: 10_000_000 })

    const outcome = await applySteeringIntent(input)

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.state.phase).toBe('REVIEW_AND_MUTATE')
  })
})
