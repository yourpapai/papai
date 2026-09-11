// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { driveMachine } from '../../opencode-agent/src/cascade.js'
import type { MachineInput } from '../../opencode-agent/src/phase-context.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The cascade's side-operation doors, as a unit.
 *
 * `follow-up.test.ts` and `phases.test.ts` drive both handlers through their
 * own fixtures; this file pins the dispatch decisions `driveMachine` itself
 * makes — which flag opens which door, that both doors stand ahead of the
 * budget stops (a handler that owns its ceilings is never refused a turn by a
 * cascade that would park the issue in `FAILED` — a state move, the one thing
 * a side operation never makes), and that a machine input carrying neither
 * flag runs the phase cascade exactly as before.
 */

const DELIVERED = (): AgentState => ({
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
  tokensSpent: 5_000_000,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: 'https://example.test/pull/7',
  prNumber: 7,
})

const input = (flags: { sync?: boolean; followUp?: boolean; answer?: boolean }): MachineInput => {
  const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
  recording.deps.tokensUsed = (): Promise<number> => Promise.resolve(0)
  return {
    state: DELIVERED(),
    issue: { number: 42, title: 't', body: 'b' },
    trigger: {
      kind: 'pull-request',
      eventName: 'issue_comment',
      action: 'created',
      senderLogin: 'maintainer',
      senderType: 'User',
      authorAssociation: 'OWNER',
      prNumber: 7,
      commentBody: '/follow-up tighten the backoff',
      commentId: 99,
      defaultBranch: 'main',
      issueNumber: 42,
    },
    command: { command: '/follow-up', argument: 'tighten the backoff' },
    thread: recording.io.thread,
    deps: recording.deps,
    answer: flags.answer ?? false,
    posted: false,
    carriedTokens: 5_000_000,
    carriedUsd: 0,
    carriedUnpriced: false,
    ...flags,
  }
}

describe('driveMachine · the side-operation doors', () => {
  it('the follow-up door stands ahead of the budget stops — the handler owns its ceilings', async () => {
    // At the token ceiling the cascade would stop before any handler, parking
    // `FAILED`. Through the door, the handler answers with its own ceiling
    // notice and moves no phase.
    const result = await driveMachine(input({ followUp: true }))

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Token budget spent')
    expect(result.state?.phase).toBe('COMPLETE')
  })

  it('the sync door stands ahead of the budget stops too', async () => {
    // The same contract one door over, pinned so an edit that moves either
    // door behind the stops fails here: `/sync` at the ceiling reports the
    // clean path — up to date, nothing to merge, nothing pushed.
    const result = await driveMachine(input({ sync: true }))

    expect(result.status).toBe('completed')
    expect(result.state?.phase).toBe('COMPLETE')
  })

  it('no flag, no door — the cascade runs exactly as before', async () => {
    // `COMPLETE` has no handler, so the run settles with the closing comment
    // and no model turn: the flags are the doors' only keys.
    const result = await driveMachine(input({}))

    expect(result.status).toBe('completed')
    expect(result.reason).toBe('Pipeline finished')
  })
})
