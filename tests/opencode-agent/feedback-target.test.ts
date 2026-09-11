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
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
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
  tokenScale: TOKEN_SCALE,
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

describe('/follow-up typed on the issue (issue #441: the one surface exception)', () => {
  /** The surface refusal needs a reply buffer to land in; records sections. */
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

  const followUpInput = (
    agentState: AgentState,
    command: { command: '/follow-up' | '/sync'; argument: string },
  ): { input: PhaseInput; recording: ReturnType<typeof stubPhaseDeps>; sections: string[] } => {
    const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
    const reply = recordingReply()
    recording.deps.reply = reply.buffer
    return {
      recording,
      sections: reply.sections,
      input: {
        state: agentState,
        issue: { number: 42, title: 't', body: 'b' },
        trigger: {
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
          commentBody: command.argument.length === 0 ? command.command : `${command.command} ${command.argument}`,
          commentId: 99,
          repositoryOwner: 'acme',
          defaultBranch: 'main',
        },
        command,
        thread: recording.io.thread,
        deps: recording.deps,
      },
    }
  }

  it('is accepted while the pull request is open — the one command the issue still takes', async () => {
    // The exception D3 carves: after delivery the issue refuses every command
    // with a pointer to the pull request — except `/follow-up`, whose whole
    // point is reaching a delivered pull request from the thread a maintainer
    // may still be reading. The reply follows the surface the command was
    // typed on (pinned with the handler, task 4); this layer's contract is
    // the dispatch: accepted, flagged, and the state moved by nothing.
    const delivered = state({ phase: 'COMPLETE', prNumber: 7, prUrl: 'https://example.invalid/pull/7' })
    const { input, recording } = followUpInput(delivered, { command: '/follow-up', argument: 'tighten the backoff' })

    const outcome = await applyTrigger(input)

    expect(outcome.halt).toBeNull()
    expect(outcome.followUp).toBe(true)
    expect(outcome.answer).toBe(false)
    expect(outcome.state).toEqual(delivered)
    // The dispatch decides; it does not act — no turn, no git.
    expect(recording.io.prompts).toHaveLength(0)
    expect(recording.io.gitCalls).toHaveLength(0)
  })

  it('is the ordinary wrong command before any pull request exists, with no pointer to nothing', async () => {
    // Pre-delivery there is no pull request to point at: the wrong-command
    // refusal names what the command needs (a delivered pull request) and
    // carries no pointer, because a pointer to nothing is worse than none.
    const parked = state({ phase: 'FAILED', resumeFrom: 'REVIEW_AND_MUTATE', changeName: 'add-x' })
    const { input, sections } = followUpInput(parked, { command: '/follow-up', argument: 'tighten the backoff' })

    const outcome = await applyTrigger(input)

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.halt?.reason).toContain('delivered pull request')
    expect(outcome.halt?.reason).not.toContain('belongs on the pull request')
    expect(sections.join()).toContain('What works here')
    expect(sections.join()).not.toContain('belongs on the pull request')
    expect(outcome.state).toEqual(parked)
  })

  it('leaves every other command’s pointer refusal exactly as it was', async () => {
    // `/sync` applies to this very state, so the refusal is about the surface
    // and only the surface — which is what makes the exception `/follow-up`'s
    // alone, and what this pin holds the implementation to: the carve-out must
    // not widen into "the issue takes commands again".
    const delivered = state({ phase: 'COMPLETE', prNumber: 7, prUrl: 'https://example.invalid/pull/7' })
    const { input, sections } = followUpInput(delivered, { command: '/sync', argument: '' })

    const outcome = await applyTrigger(input)

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.halt?.reason).toContain('/sync belongs on the pull request')
    expect(sections.join()).toContain('https://example.invalid/pull/7')
    expect(sections.join()).toContain('Type `/sync` there instead')
    expect(outcome.state).toEqual(delivered)
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
