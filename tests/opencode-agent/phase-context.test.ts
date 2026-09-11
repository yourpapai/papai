// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { MachineInput, PhaseInput } from '../../opencode-agent/src/phase-context.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The shapes the cascade carries, as a contract rather than an accident.
 *
 * `MachineInput` is the one value both budget stops and every dispatch branch
 * read, and the side-operation flags on it are how `/sync` — and now
 * `/follow-up` (issue #441) — reach `driveMachine` without being phases. The
 * contract worth pinning: the two flags are optional and independent, so a
 * follow-up run is not a sync run and neither is a phase run; and the carried
 * spend arrives captured once, the figure the token ceiling is asked against.
 */

const state = (): AgentState => ({
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
  changeName: 'add-x',
  planRevision: 1,
  tokenScale: TOKEN_SCALE,
  tokensSpent: 0,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: 'https://example.test/pull/7',
  prNumber: 7,
})

const trigger = (): TriggerEvent => ({
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
  commentBody: '/follow-up tighten the backoff',
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const machineInput = (flags: { sync?: boolean; followUp?: boolean }): MachineInput => ({
  state: state(),
  issue: { number: 42, title: 't', body: 'b' },
  trigger: trigger(),
  command: null,
  thread: [],
  deps: stubPhaseDeps().deps,
  answer: false,
  posted: false,
  carriedTokens: 0,
  carriedUsd: 0,
  carriedUnpriced: false,
  ...flags,
})

describe('MachineInput · the side-operation flags', () => {
  it('carries followUp alone for the follow-up dispatch — independent of sync', () => {
    const input = machineInput({ followUp: true })

    expect(input.followUp).toBe(true)
    expect(input.sync).toBeUndefined()
    expect(input.answer).toBe(false)
  })

  it('carries sync alone for the sync dispatch — the flags do not imply each other', () => {
    const input = machineInput({ sync: true })

    expect(input.sync).toBe(true)
    expect(input.followUp).toBeUndefined()
  })

  it('carries neither for an ordinary phase run', () => {
    const input = machineInput({})

    expect(input.sync).toBeUndefined()
    expect(input.followUp).toBeUndefined()
  })

  it('starts from the phase input it extends — state, issue, trigger, thread and deps intact', () => {
    // `MachineInput` is a `PhaseInput` plus the cascade's bookkeeping, so every
    // handler input field survives the widening unchanged.
    const base: PhaseInput = {
      state: state(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: trigger(),
      command: null,
      thread: [],
      deps: stubPhaseDeps().deps,
    }
    const input: MachineInput = {
      ...base,
      answer: false,
      posted: false,
      carriedTokens: 1200,
      carriedUsd: 0.5,
      carriedUnpriced: false,
    }

    expect(input.state).toBe(base.state)
    expect(input.trigger).toBe(base.trigger)
    expect(input.deps).toBe(base.deps)
    expect(input.carriedTokens).toBe(1200)
  })
})
