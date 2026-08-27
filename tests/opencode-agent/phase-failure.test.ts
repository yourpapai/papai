// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { dependencyDriftError } from '../../opencode-agent/src/errors.js'
import type { MachineInput } from '../../opencode-agent/src/phase-context.js'
import { failRun } from '../../opencode-agent/src/phase-failure.js'
import type { ReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import type { ReportSection } from '../../opencode-agent/src/reply-comment.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * What a run that broke is left looking like, for the one failure class whose
 * remedy `/retry` cannot reach: the dependency-drift refusal of issue #323,
 * where the footer invited a bare `/retry` the message above it had just said
 * could not work, and every blind reply spent one of five attempts on a
 * condition no retry can change.
 *
 * The workspace rule applies: assert the **persisted state**, not just the
 * returned status — `attempts` carried rather than spent is what keeps the
 * `/retry` the drift message eventually invites inside the budget.
 */

const TRIGGER: TriggerEvent = {
  kind: 'issue',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'OWNER',
  issueNumber: 42,
  issueTitle: 't',
  issueBody: 'b',
  isPullRequest: false,
  commentBody: '/retry',
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'master',
}

/** The state the drift refusal finds: mid-implementation, two attempts deep. */
const driftState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'REVIEW_AND_MUTATE',
  issueId: 42,
  resumeFrom: null,
  attempts: 2,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 4,
  changeName: 'localized-release-announcements',
  planRevision: 1,
  tokensSpent: 893_073,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

/** A reply buffer that records sections instead of posting them. */
const recordingReply = (): { reply: ReplyBuffer; sections: ReportSection[] } => {
  const sections: ReportSection[] = []
  return {
    reply: {
      begin: (): void => {},
      section: (_state, section): void => {
        sections.push(section)
      },
      flush: (): Promise<null> => Promise.resolve(null),
    },
    sections,
  }
}

const failureFixture = (state: AgentState): { input: MachineInput; sections: ReportSection[] } => {
  const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
  const reply = recordingReply()
  recording.deps.reply = reply.reply
  return {
    input: {
      state,
      issue: { number: 42, title: 't', body: 'b' },
      trigger: TRIGGER,
      command: { command: '/retry', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
      answer: false,
      posted: false,
      carriedTokens: state.tokensSpent,
    },
    sections: reply.sections,
  }
}

describe('failRun · a dependency-drift refusal', () => {
  const drift = dependencyDriftError('agent/issue-323', 'master', [
    { file: 'package.json', fields: ['devDependencies'] },
  ])

  test('parks in FAILED with the resume point but carries attempts instead of spending one', async () => {
    // The guard fires at the branch switch, before any work: the same doctrine
    // as the over-budget stop — running out of nothing is not a failed attempt,
    // and spending one would let the retry gate refuse the `/retry` the drift
    // remedy ends in.
    const { input } = failureFixture(driftState())

    const result = await failRun(input, drift)

    expect(result.state?.phase).toBe('FAILED')
    expect(result.state?.resumeFrom).toBe('REVIEW_AND_MUTATE')
    expect(result.state?.attempts).toBe(2)
  })

  test('does not invite a bare /retry the message above just said cannot work', async () => {
    const { input, sections } = failureFixture(driftState())

    await failRun(input, drift)

    const body = String(sections.at(-1)?.body)
    expect(body).toContain('A plain `/retry` will reproduce this failure')
    expect(body).not.toContain('Reply **`/retry`** to resume')
  })
})

describe('failRun · an ordinary failure', () => {
  test('spends an attempt and keeps the standard /retry invitation', async () => {
    const boom = new Error('the work broke')
    const { input, sections } = failureFixture(driftState())

    const result = await failRun(input, boom)

    expect(result.state?.attempts).toBe(3)
    const body = String(sections.at(-1)?.body)
    expect(body).toContain('Reply **`/retry`** to resume from `REVIEW_AND_MUTATE`')
  })
})
