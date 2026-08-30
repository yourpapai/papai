// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { RunSpend } from '../../opencode-agent/src/agent-session.js'
import type { MachineInput } from '../../opencode-agent/src/phase-context.js'
import type { ReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import type { ReportSection } from '../../opencode-agent/src/reply-comment.js'
import type { RunResult } from '../../opencode-agent/src/run-result.js'
import { stopIfOverBudget } from '../../opencode-agent/src/token-budget.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The stop that refuses a phase the issue cannot pay for — and what it says
 * about money on the way out.
 *
 * It runs *before* the handler, so on a job whose first phase it refuses the
 * session has prompted nothing. Reading that session's spend as "could not be
 * priced" is what put `≥ $9.23 on this issue (some turns unpriced)` under issue
 * #385's stop, on an issue whose every turn the CLI had priced itself. The flag
 * is sticky by design, so one such stop degrades the figure for good.
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
  commentBody: '/approve',
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'master',
}

/** An issue that has already spent everything it is allowed. */
const spentState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'PLANNING',
  issueId: 42,
  resumeFrom: null,
  attempts: 1,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: 'token-ceiling-excludes-cache-reads',
  planRevision: 1,
  tokensSpent: 5_000_000,
  usdSpent: 9.23,
  usdUnpriced: false,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

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

/** A stop about to fire, with the session's own answers under the test's control. */
const stopFixture = (state: AgentState, spend: RunSpend, jobTokens = 0, answer = false): MachineInput => {
  const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
  recording.deps.reply = recordingReply().reply
  recording.deps.spend = (): Promise<RunSpend> => Promise.resolve(spend)
  recording.deps.tokensUsed = (): Promise<number> => Promise.resolve(jobTokens)
  return {
    state,
    issue: { number: 42, title: 't', body: 'b' },
    trigger: TRIGGER,
    command: { command: '/approve', argument: '' },
    thread: recording.io.thread,
    deps: recording.deps,
    answer,
    posted: false,
    carriedTokens: state.tokensSpent,
    carriedUsd: state.usdSpent,
    carriedUnpriced: state.usdUnpriced,
  }
}

const UNSPENT: RunSpend = { usd: 0, source: 'unspent', windows: [] }
const UNPRICED: RunSpend = { usd: null, source: 'none', windows: [] }

/**
 * The stop, with both its "not over budget" and "nothing ran" cases ruled out.
 *
 * Every case below is about a stop that fired and persisted a block, so a test
 * that silently skipped its assertions on a `null` would be the one shape of
 * failure this file must not have.
 */
const stopped = async (input: MachineInput): Promise<{ result: RunResult; state: AgentState }> => {
  const result = await stopIfOverBudget(input)
  if (result === null) throw new Error('expected the ceiling to stop this run')
  if (result.state === null) throw new Error('expected the stop to persist a state block')
  return { result, state: result.state }
}

describe('stopIfOverBudget · what the stop says about money', () => {
  test('a stop before anything prompted reports the carried cost exactly', async () => {
    const { result, state } = await stopped(stopFixture(spentState(), UNSPENT))

    expect(result.status).toBe('failed')
    expect(state.usdSpent).toBeCloseTo(9.23, 6)
    expect(state.usdUnpriced).toBe(false)
  })

  test('the same stop still parks the issue with its resume point', async () => {
    // The money fix must not move the guardrail: `FAILED` with `resumeFrom` is
    // what makes "raise AGENT_MAX_TOKENS, reply /retry" true.
    const { result, state } = await stopped(stopFixture(spentState(), UNSPENT))

    expect(state.phase).toBe('FAILED')
    expect(state.resumeFrom).toBe('PLANNING')
    expect(state.attempts).toBe(1)
    expect(result.reported).toBe(true)
  })

  test('a mid-cascade stop still adds what the job already spent', async () => {
    // The earlier phase in this job legitimately prompted and posted; the stop
    // refuses the next one. Its spend is the job's, and must land.
    const input = stopFixture(
      spentState({ tokensSpent: 4_990_000 }),
      { usd: 1.5, source: 'backend', windows: [] },
      20_000,
    )
    const { state } = await stopped(input)

    expect(state.tokensSpent).toBe(5_010_000)
    expect(state.usdSpent).toBeCloseTo(10.73, 6)
    expect(state.usdUnpriced).toBe(false)
  })

  test('a genuinely unpriced turn still marks the total a floor', async () => {
    const { state } = await stopped(stopFixture(spentState(), UNPRICED))

    expect(state.usdUnpriced).toBe(true)
    expect(state.usdSpent).toBeCloseTo(9.23, 6)
  })

  test('the floor marker stays sticky once an earlier job set it', async () => {
    // An unpriced turn cannot be un-spent by a later priced one.
    const { state } = await stopped(stopFixture(spentState({ usdUnpriced: true }), UNSPENT))

    expect(state.usdUnpriced).toBe(true)
  })

  test('an over-budget question reports the same figures without moving the phase', async () => {
    const { state } = await stopped(stopFixture(spentState(), UNSPENT, 0, true))

    expect(state.phase).toBe('PLANNING')
    expect(state.usdUnpriced).toBe(false)
    expect(state.usdSpent).toBeCloseTo(9.23, 6)
  })

  test('a run still inside its ceiling is not stopped at all', async () => {
    expect(await stopIfOverBudget(stopFixture(spentState({ tokensSpent: 10 }), UNSPENT))).toBeNull()
  })
})
