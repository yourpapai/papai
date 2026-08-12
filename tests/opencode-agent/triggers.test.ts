// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { applyClarifyIntent } from '../../opencode-agent/src/comment-intent.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The consent half of D9.
 *
 * An untrusted author whose issue triage wanted to capture is parked behind a
 * consent comment. The capture completes when a maintainer replies
 * affirmatively — and that reply arrives as a plain comment in
 * `INIT_OR_CLARIFY`, which `applyClarifyIntent` reads. Anything the classifier
 * does not positively call chatter (`none`) re-runs triage; the re-run sees the
 * maintainer's trusted association and captures. So the contract this file
 * pins is that the consent reply is **not** skipped: it must reach triage.
 */

const AGENT_LOGIN = 'agent-bot'

const baseState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'INIT_OR_CLARIFY',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  changedLines: 0,
  stepsDone: 0,
  changeName: null,
  planRevision: 0,
  tokensSpent: 0,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

const commentTrigger = (body: string, association: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: association,
  issueNumber: 42,
  issueTitle: 'Add a retry helper',
  issueBody: 'Please add a retry helper.',
  isPullRequest: false,
  commentBody: body,
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

describe('applyClarifyIntent · consent completion (D9)', () => {
  it('re-runs triage for an affirmative maintainer reply — the channel that completes capture', async () => {
    // The maintainer confirmed the capture the agent asked consent for. The
    // classifier reads this as a real reply (not chatter), so the outcome must
    // hand control back to triage rather than skipping.
    const recording = stubPhaseDeps({
      replies: [JSON.stringify({ intent: 'approve' })],
      selfLogin: AGENT_LOGIN,
    })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('Yes, go ahead and capture this.', 'OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyClarifyIntent(input)

    // `halt: null` means "do not skip — run the phase handler", which is the
    // triage re-run that captures on a trusted association.
    expect(outcome.halt).toBeNull()
    expect(outcome.answer).toBe(false)
    expect(recording.io.prompts).toHaveLength(1)
    expect(String(recording.io.prompts[0]?.prompt)).toContain('Classify this comment')
  })

  it('skips chatter so a 👍 does not re-run triage', async () => {
    const recording = stubPhaseDeps({
      replies: [JSON.stringify({ intent: 'none' })],
      selfLogin: AGENT_LOGIN,
    })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('👍', 'OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyClarifyIntent(input)

    expect(outcome.halt).not.toBeNull()
    expect(outcome.halt?.status).toBe('skipped')
  })

  it('falls through to triage on a blank body (the issue-opened shape), never skipping', async () => {
    // The consent comment's sibling is the original `issues.opened` event that
    // starts every issue: a blank body must reach triage, not be classified.
    const recording = stubPhaseDeps({
      replies: [JSON.stringify({ intent: 'none' })],
      selfLogin: AGENT_LOGIN,
    })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('', 'OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyClarifyIntent(input)

    // halt: null → triage runs. No classifier prompt was spent.
    expect(outcome.halt).toBeNull()
    expect(recording.io.prompts).toHaveLength(0)
  })
})
