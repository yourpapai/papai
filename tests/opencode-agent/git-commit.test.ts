// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { handleTriage } from '../../opencode-agent/src/phases/triage.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * Design D2 — branch from first spec.
 *
 * The branch `agent/issue-<n>` is created the moment triage converges on a
 * capture, and the scaffolded `openspec/changes/<name>/` folder is commit #1 —
 * pushed immediately, so planning artefacts are durable across Actions jobs
 * without travelling in hidden blocks. These tests drive the triage handler
 * through `PhaseDeps` and assert the git calls happen in the right order with
 * the right branch, on a trusted auto-capture.
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

const issueTrigger = (association: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'someone',
  senderType: 'User',
  authorAssociation: association,
  issueNumber: 42,
  issueTitle: 'Add a retry helper',
  issueBody: 'Please add a retry helper.',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const captureReply = JSON.stringify({
  status: 'capture',
  changeName: 'add-retry-helper',
  spec: '# Goal\n\nAdd retries.',
})

describe('handleTriage · capture · branch-from-first-spec (D2)', () => {
  it('creates agent/issue-<n>, commits the scaffold as #1, and pushes — in that order', async () => {
    const recording = stubPhaseDeps({ replies: [captureReply], selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 'Add a retry helper', body: 'Please add a retry helper.' },
      trigger: issueTrigger('OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    // The scaffold is durable: branch → commit → push, in that order, on the
    // agent's own branch off the configured base.
    expect(recording.io.gitCalls).toEqual([
      'ensureBranch:agent/issue-42:main',
      'commit:chore(openspec): scaffold add-retry-helper',
      'push:agent/issue-42',
    ])
  })

  it('does not branch, commit or push when capture awaits consent (untrusted author)', async () => {
    const recording = stubPhaseDeps({ replies: [captureReply], selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: issueTrigger('NONE'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('NEEDS_CLARIFICATION')
    expect(recording.io.gitCalls).toEqual([])
  })
})
