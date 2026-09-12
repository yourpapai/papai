// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { refuseIfUsageMissing, sideOperation } from '../../opencode-agent/src/side-operations.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The non-moving side operations, as a unit.
 *
 * `triggers.test.ts` proves the dispatch end to end through `applyTrigger`;
 * this file pins the module's own decisions — which commands are side
 * operations, that each returns its flag only on its predicate, and that the
 * `/follow-up` usage refusal is the one branch that posts, buying no turn.
 */

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
  changeName: null,
  planRevision: 0,
  tokenScale: TOKEN_SCALE,
  tokensSpent: 0,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

const delivered = (): AgentState => state({ prNumber: 7, prUrl: 'https://example.test/pull/7' })

const input = (agentState: AgentState, trigger: TriggerEvent): PhaseInput => {
  const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
  return {
    state: agentState,
    issue: { number: 42, title: 't', body: 'b' },
    trigger,
    command: null,
    thread: recording.io.thread,
    deps: recording.deps,
  }
}

const issueTrigger = (body: string): TriggerEvent => ({
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
  commentBody: body,
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

describe('sideOperation', () => {
  it('answers /ask everywhere — the one side operation with no predicate', () => {
    const outcome = sideOperation(input(state(), issueTrigger('/ask why?')), { command: '/ask', argument: 'why?' })

    expect(outcome).toMatchObject({ answer: true, halt: null })
    expect(outcome?.sync).toBeUndefined()
    expect(outcome?.followUp).toBeUndefined()
  })

  it('hands /sync the sync flag only where the agent branch exists', () => {
    const branchBearing = state({ phase: 'FAILED', resumeFrom: 'REVIEW_AND_MUTATE', changeName: 'add-x' })
    expect(sideOperation(input(branchBearing, issueTrigger('/sync')), { command: '/sync', argument: '' })?.sync).toBe(
      true,
    )
    // Pre-capture: no branch to merge base into, so the dispatch falls through.
    expect(
      sideOperation(input(state({ phase: 'INIT_OR_CLARIFY' }), issueTrigger('/sync')), {
        command: '/sync',
        argument: '',
      }),
    ).toBeNull()
  })

  it('hands /follow-up the followUp flag only on the delivered predicate', () => {
    const outcome = sideOperation(input(delivered(), issueTrigger('/follow-up tighten it')), {
      command: '/follow-up',
      argument: 'tighten it',
    })

    expect(outcome).toMatchObject({ followUp: true, halt: null, answer: false })
    expect(outcome?.sync).toBeUndefined()
    expect(outcome?.state).toEqual(delivered())
  })

  it('falls through to null off the predicate — the refusal layer owns the wording', () => {
    const undelivered = state({ phase: 'FAILED', resumeFrom: 'REVIEW_AND_MUTATE', changeName: 'add-x' })
    expect(
      sideOperation(input(undelivered, issueTrigger('/follow-up tighten it')), {
        command: '/follow-up',
        argument: 'tighten it',
      }),
    ).toBeNull()
  })

  it('returns null for every command with a signal — the transition table owns those', () => {
    expect(sideOperation(input(delivered(), issueTrigger('/review')), { command: '/review', argument: '' })).toBeNull()
  })
})

describe('refuseIfUsageMissing', () => {
  it('refuses an argument-less /follow-up with usage, posting but buying no turn', async () => {
    const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
    const sections: string[] = []
    recording.deps.reply = {
      begin: (): void => {},
      section: (_state, section): void => {
        sections.push(section.body)
      },
      flush: (): Promise<null> => Promise.resolve(null),
    }
    const driven: PhaseInput = {
      state: delivered(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: issueTrigger('/follow-up'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await refuseIfUsageMissing(driven, { command: '/follow-up', argument: '' })

    expect(outcome?.halt?.status).toBe('skipped')
    expect(outcome?.halt?.reported).toBe(true)
    expect(sections.join()).toContain('`/follow-up` needs an argument')
    expect(recording.io.prompts).toHaveLength(0)
    expect(recording.io.gitCalls).toHaveLength(0)
    expect(outcome?.state).toEqual(delivered())
  })

  it('returns null once there is an argument to assess', async () => {
    const driven = input(delivered(), issueTrigger('/follow-up tighten it'))

    expect(await refuseIfUsageMissing(driven, { command: '/follow-up', argument: 'tighten it' })).toBeNull()
  })

  it('returns null off the predicate — the wrong-command door owns that refusal', async () => {
    const undelivered = state({ phase: 'FAILED', resumeFrom: 'REVIEW_AND_MUTATE', changeName: 'add-x' })
    const driven = input(undelivered, issueTrigger('/follow-up'))

    expect(await refuseIfUsageMissing(driven, { command: '/follow-up', argument: '' })).toBeNull()
  })

  it('returns null for every other command', async () => {
    const driven = input(delivered(), issueTrigger('/ask'))

    expect(await refuseIfUsageMissing(driven, { command: '/ask', argument: '' })).toBeNull()
  })
})
