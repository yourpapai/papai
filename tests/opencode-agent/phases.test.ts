// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { SPEC_MARKER, findArtifact } from '../../opencode-agent/src/artifacts.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import type { ParsedCommand } from '../../opencode-agent/src/commands.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { handleTriage } from '../../opencode-agent/src/phases/triage.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'
import type { StubIo } from './test-helpers.js'

/**
 * Design D9 — the triage capture model.
 *
 * Triage ends with a structured `clarify | capture | answer` outcome parsed via
 * `promptForJson`. On `capture` the handler scaffolds a real
 * `openspec/changes/<name>/` folder via the driver and sets `state.changeName`;
 * the D9 association gate auto-captures for OWNER/MEMBER/COLLABORATOR and posts
 * a consent comment for everybody else. These tests drive the handler through
 * `PhaseDeps` directly (per the slice plan) rather than spinning the whole
 * orchestrator harness — that sweep is the final step, not the guiding signal.
 *
 * Bridge note (slice A): `capture` still carries `spec` text and posts the
 * `AGENT_SPEC` block, because PLANNING has not been reworked onto the folder
 * yet. Slice B retires the SPEC block and drops `spec` from the schema.
 */

const AGENT_LOGIN = 'agent-bot'

/** The blocks a handler returned, as a thread `findArtifact` can walk. Module-level so the `??` is not "in test". */
const blocksAsThread = (outcome: { blocks?: readonly string[] }): IssueComment[] =>
  (outcome.blocks ?? []).map((body, index) => ({ id: index + 1, body, authorLogin: AGENT_LOGIN }))

const baseState = (issueId = 42, over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'INIT_OR_CLARIFY',
  issueId,
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

const issueTrigger = (association: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'someone',
  senderType: 'User',
  authorAssociation: association,
  issueNumber: 42,
  issueTitle: 'Add a retry helper',
  issueBody: 'Please add a retry helper to the HTTP client.',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

interface FakeOptions {
  /** Model JSON replies, consumed in order by successive prompts. */
  replies: string[]
  /** Author association carried on the trigger event (the D9 gate input). */
  association?: string
  /** Pre-existing thread (oldest first). */
  thread?: IssueComment[]
  /** State to seed the input with. */
  state?: Partial<AgentState>
  command?: ParsedCommand | null
}

const makeInput = (options: FakeOptions): { input: PhaseInput; io: StubIo } => {
  const recording = stubPhaseDeps({ replies: options.replies, thread: options.thread, selfLogin: AGENT_LOGIN })
  const input: PhaseInput = {
    state: baseState(42, options.state),
    issue: { number: 42, title: 'Add a retry helper', body: 'Please add a retry helper to the HTTP client.' },
    trigger: issueTrigger(options.association ?? 'OWNER'),
    command: options.command ?? null,
    thread: recording.io.thread,
    deps: recording.deps,
  }
  return { input, io: recording.io }
}

describe('handleTriage · outcome: clarify', () => {
  it('returns NEEDS_CLARIFICATION with the rendered questions and posts nothing', async () => {
    const { input } = makeInput({
      replies: [JSON.stringify({ status: 'clarify', questions: ['Which client?', 'How many retries?'] })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('NEEDS_CLARIFICATION')
    expect(outcome.comment).toContain('Which client?')
    expect(outcome.comment).toContain('How many retries?')
    expect(outcome.blocks).toBeUndefined()
  })
})

describe('handleTriage · outcome: answer', () => {
  it('returns ANSWERED with the model reply and stays phase-neutral', async () => {
    const { input } = makeInput({
      replies: [JSON.stringify({ status: 'answer', reply: 'The HTTP client already retries once.' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('ANSWERED')
    expect(outcome.comment).toContain('The HTTP client already retries once.')
  })
})

describe('handleTriage · outcome: capture · D9 association gate', () => {
  it('auto-captures for OWNER: scaffolds the folder, sets changeName, emits CAPTURED', async () => {
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: '# Goal\n\nAdd retries.' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual(['newChange:add-retry-helper:spec-driven'])
    expect(outcome.patch?.changeName).toBe('add-retry-helper')
    // Bridge: the SPEC block still carries the spec text so PLANNING (not yet
    // reworked) can read it. Slice B retires this block.
    expect(findArtifact(blocksAsThread(outcome), AGENT_LOGIN, SPEC_MARKER)?.text).toContain('Add retries.')
  })

  it.each(['MEMBER', 'COLLABORATOR'])('auto-captures for %s', async (association) => {
    const { input, io } = makeInput({
      association,
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-thing', spec: 'spec' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([`newChange:add-thing:spec-driven`])
  })

  it('posts a consent comment and parks (NEEDS_CLARIFICATION) for an untrusted author', async () => {
    const { input, io } = makeInput({
      association: 'NONE',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('NEEDS_CLARIFICATION')
    // The untrusted path does not scaffold: consent has not been given yet.
    expect(io.openspecCalls).toEqual([])
    expect(outcome.patch?.changeName).toBeUndefined()
    expect(outcome.comment).toContain('add-retry-helper')
    expect(outcome.comment.toLowerCase()).toContain('confirm')
  })

  it('rejects a non-kebab changeName (the schema re-asks once, then captures on the repair)', async () => {
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [
        JSON.stringify({ status: 'capture', changeName: 'Add Retry Helper', spec: 'spec' }),
        JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec' }),
      ],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual(['newChange:add-retry-helper:spec-driven'])
    // Two prompts: the rejected reply, then the repaired one.
    expect(io.prompts).toHaveLength(2)
  })
})
