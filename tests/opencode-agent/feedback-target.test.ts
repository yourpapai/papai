// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, test } from 'bun:test'

import { commandSurface, feedbackTarget } from '../../opencode-agent/src/feedback-target.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import type { ReportSection } from '../../opencode-agent/src/reply-comment.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { applyTrigger } from '../../opencode-agent/src/triggers.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

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
  usdSpent: 0,
  usdUnpriced: false,
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

describe('/fix typed on the issue once the pull request exists', () => {
  /** The commandSurface refusal needs a reply buffer to land in; records sections. */
  const recordingReply = (): { sections: string[]; buffer: PhaseInput['deps']['reply'] } => {
    const sections: string[] = []
    return {
      sections,
      buffer: {
        begin: (): void => {},
        section: (_state, section: ReportSection): void => {
          sections.push(section.body)
        },
        flush: (): Promise<null> => Promise.resolve(null),
      },
    }
  }

  it('is refused naming the pull request, and nothing acts on it', async () => {
    // The spec's "Typed on the issue once the pull request exists" scenario: the
    // command applies perfectly and would have worked one page over, so the
    // answer says *where*, not "does not apply" — `commandSurface`'s one rule,
    // which every command including /fix rides without a change of its own.
    const delivered = state({ phase: 'COMPLETE', prNumber: 7, prUrl: 'https://example.invalid/pull/7' })
    const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
    const reply = recordingReply()
    recording.deps.reply = reply.buffer
    const trigger: TriggerEvent = {
      kind: 'issue',
      eventName: 'issue_comment',
      action: 'created',
      senderLogin: 'maintainer',
      senderType: 'User',
      authorAssociation: 'OWNER',
      issueNumber: 42,
      issueTitle: 'Add a retry helper',
      issueBody: 'Please add a retry helper.',
      isPullRequest: false,
      commentBody: '/fix',
      commentId: 99,
      repositoryOwner: 'acme',
      defaultBranch: 'main',
    }
    const input: PhaseInput = {
      state: delivered,
      issue: { number: 42, title: 't', body: 'b' },
      trigger,
      command: { command: '/fix', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyTrigger(input)

    expect(commandSurface(delivered, 'issue')).toBe('elsewhere')
    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.halt?.reason).toContain('/fix belongs on the pull request')
    // Nothing acted: the persisted state is byte-identical, no model turn ran
    // and no CI-fix attempt was spent.
    expect(outcome.state).toEqual(delivered)
    expect(recording.io.prompts).toHaveLength(0)
    expect(delivered.ciAttempts).toBe(0)
    // The refusal names where to type it.
    expect(reply.sections.join()).toContain('https://example.invalid/pull/7')
  })
})
