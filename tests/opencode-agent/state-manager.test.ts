// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  canTransition,
  extractState,
  findLatestState,
  initialState,
  renderStateComment,
  serializeState,
  STATE_MARKER,
  transition,
} from '../../opencode-agent/src/state-manager.js'
import type { IssueComment } from '../../opencode-agent/src/state-manager.js'
import { InvalidTransitionError } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'

const comment = (authorLogin: string, body: string, id = 1): IssueComment => ({ id, body, authorLogin })

describe('serializeState / extractState', () => {
  test('round-trips a full state through the hidden comment block', () => {
    const state = transition(initialState(42), 'SPEC_POSTED')

    expect(extractState(serializeState(state))).toEqual(state)
  })

  test('renderStateComment keeps the human body above the state block', () => {
    const rendered = renderStateComment('### Design spec\n\nBody text.\n\n', initialState(7))

    expect(rendered.startsWith('### Design spec')).toBe(true)
    expect(rendered).toContain(`<!-- ${STATE_MARKER}:`)
    expect(extractState(rendered)?.issueId).toBe(7)
  })

  test('extracts state surrounded by prose', () => {
    const body = ['Some report text.', '', serializeState(initialState(11)), '', 'Trailing note.'].join('\n')

    expect(extractState(body)?.issueId).toBe(11)
  })

  test('tolerates whitespace variations in the marker', () => {
    const body = `<!--${STATE_MARKER}:{"phase":"DESIGN_SPEC","issueId":3}-->`

    expect(extractState(body)?.phase).toBe('DESIGN_SPEC')
  })

  test('applies schema defaults to a minimal state block', () => {
    const parsed = extractState(`<!-- ${STATE_MARKER}: {"phase":"INIT_OR_CLARIFY","issueId":5} -->`)

    expect(parsed).toEqual({
      phase: 'INIT_OR_CLARIFY',
      issueId: 5,
      branch: null,
      approved: false,
      resumeFrom: null,
      attempts: 0,
      lastError: null,
      prUrl: null,
      updatedAt: null,
    })
  })

  test('the last block in a body wins', () => {
    const body = [serializeState(initialState(1)), serializeState({ ...initialState(1), phase: 'DESIGN_SPEC' })].join(
      '\n',
    )

    expect(extractState(body)?.phase).toBe('DESIGN_SPEC')
  })

  test('returns null for a body without a state block', () => {
    expect(extractState('Just a normal comment.')).toBeNull()
  })

  test('returns null for malformed JSON instead of throwing', () => {
    expect(extractState(`<!-- ${STATE_MARKER}: {"phase": -->`)).toBeNull()
  })

  test('returns null when the payload fails schema validation', () => {
    expect(extractState(`<!-- ${STATE_MARKER}: {"phase":"NOT_A_PHASE","issueId":1} -->`)).toBeNull()
    expect(extractState(`<!-- ${STATE_MARKER}: {"phase":"COMPLETE","issueId":-2} -->`)).toBeNull()
  })
})

describe('findLatestState', () => {
  const agent = 'agent-bot'

  test('reads the newest agent comment carrying a state block', () => {
    const thread = [
      comment(agent, renderStateComment('one', initialState(9)), 1),
      comment('maintainer', 'looks good', 2),
      comment(agent, renderStateComment('two', { ...initialState(9), phase: 'EXECUTION_PLAN' }), 3),
    ]

    expect(findLatestState(thread, agent)?.phase).toBe('EXECUTION_PLAN')
  })

  test('ignores state blocks authored by anyone but the agent', () => {
    const thread = [comment('impostor', renderStateComment('spoofed', { ...initialState(9), phase: 'COMPLETE' }), 1)]

    expect(findLatestState(thread, agent)).toBeNull()
  })

  test('matches the agent login case-insensitively', () => {
    const thread = [comment('Agent-Bot', renderStateComment('one', initialState(9)), 1)]

    expect(findLatestState(thread, agent)?.issueId).toBe(9)
  })

  test('skips agent comments without a state block', () => {
    const thread = [
      comment(agent, renderStateComment('one', initialState(9)), 1),
      comment(agent, 'plain follow-up with no state', 2),
    ]

    expect(findLatestState(thread, agent)?.issueId).toBe(9)
  })

  test('skips a corrupt newer block and falls back to the last good one', () => {
    const thread = [
      comment(agent, renderStateComment('good', { ...initialState(9), phase: 'DESIGN_SPEC' }), 1),
      comment(agent, `broken\n\n<!-- ${STATE_MARKER}: {oops -->`, 2),
    ]

    expect(findLatestState(thread, agent)?.phase).toBe('DESIGN_SPEC')
  })

  test('returns null for an empty thread', () => {
    expect(findLatestState([], agent)).toBeNull()
  })
})

describe('transition', () => {
  const at = (phase: AgentState['phase']): AgentState => ({ ...initialState(42), phase })

  test('walks the happy path end to end', () => {
    let state = initialState(42)
    state = transition(state, 'SPEC_POSTED')
    expect(state.phase).toBe('DESIGN_SPEC')

    state = transition(state, 'APPROVED')
    expect(state.phase).toBe('EXECUTION_PLAN')
    expect(state.approved).toBe(true)

    state = transition(state, 'PLAN_POSTED', { branch: 'agent/issue-42' })
    expect(state.phase).toBe('REVIEW_AND_MUTATE')
    expect(state.branch).toBe('agent/issue-42')

    state = transition(state, 'CHANGES_COMMITTED')
    expect(state.phase).toBe('PR_DELIVERY')

    state = transition(state, 'PR_OPENED', { prUrl: 'https://github.com/o/r/pull/7' })
    expect(state.phase).toBe('COMPLETE')
    expect(state.prUrl).toBe('https://github.com/o/r/pull/7')
  })

  test('clarification keeps the machine in INIT_OR_CLARIFY', () => {
    expect(transition(initialState(1), 'NEEDS_CLARIFICATION').phase).toBe('INIT_OR_CLARIFY')
  })

  test('/replan from DESIGN_SPEC returns to triage', () => {
    expect(transition(at('DESIGN_SPEC'), 'NEEDS_CLARIFICATION').phase).toBe('INIT_OR_CLARIFY')
  })

  test('rejects a signal the current phase does not accept', () => {
    expect(() => transition(initialState(1), 'APPROVED')).toThrow(InvalidTransitionError)
    expect(() => transition(at('DESIGN_SPEC'), 'PR_OPENED')).toThrow(InvalidTransitionError)
  })

  test('does not leave the terminal COMPLETE phase', () => {
    expect(canTransition('COMPLETE', 'FAILED')).toBe(false)
    expect(canTransition('COMPLETE', 'RETRY')).toBe(false)
    expect(() => transition(at('COMPLETE'), 'FAILED')).toThrow(InvalidTransitionError)
  })

  test('FAILED records the resume phase, the error and an attempt', () => {
    const failed = transition(at('REVIEW_AND_MUTATE'), 'FAILED', { lastError: 'tests exploded' })

    expect(failed.phase).toBe('FAILED')
    expect(failed.resumeFrom).toBe('REVIEW_AND_MUTATE')
    expect(failed.attempts).toBe(1)
    expect(failed.lastError).toBe('tests exploded')
  })

  test('a second failure keeps the original resume phase and counts up', () => {
    const once = transition(at('EXECUTION_PLAN'), 'FAILED', { lastError: 'a' })
    const twice = transition(once, 'FAILED', { lastError: 'b' })

    expect(twice.resumeFrom).toBe('EXECUTION_PLAN')
    expect(twice.attempts).toBe(2)
  })

  test('RETRY resumes the failed phase and clears the error', () => {
    const failed = transition(at('PR_DELIVERY'), 'FAILED', { lastError: 'push rejected' })
    const retried = transition(failed, 'RETRY')

    expect(retried.phase).toBe('PR_DELIVERY')
    expect(retried.resumeFrom).toBeNull()
    expect(retried.lastError).toBeNull()
    expect(retried.attempts).toBe(1)
  })

  test('RETRY is only valid from FAILED', () => {
    expect(canTransition('DESIGN_SPEC', 'RETRY')).toBe(false)
    expect(() => transition(at('DESIGN_SPEC'), 'RETRY')).toThrow(InvalidTransitionError)
  })

  test('CANCELLED parks any live phase in COMPLETE', () => {
    const cancelled = transition(at('REVIEW_AND_MUTATE'), 'CANCELLED')

    expect(cancelled.phase).toBe('COMPLETE')
    expect(cancelled.resumeFrom).toBeNull()
  })

  test('returns a new object rather than mutating the input', () => {
    const before = initialState(42)
    const after = transition(before, 'SPEC_POSTED')

    expect(before.phase).toBe('INIT_OR_CLARIFY')
    expect(after).not.toBe(before)
  })
})
