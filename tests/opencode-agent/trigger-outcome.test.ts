// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { moveOrSkip, skip } from '../../opencode-agent/src/trigger-outcome.js'
import type { TriggerOutcome } from '../../opencode-agent/src/trigger-outcome.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The shared outcome shape of the trigger layer, in its own right.
 *
 * `triggers.test.ts` exercises these helpers through the command paths that
 * call them; this file pins the module's own contract, because three modules
 * (`triggers.ts`, `ci-trigger.ts`, `comment-intent.ts`) build on it and the
 * side-operation flags (`sync`, `followUp`) ride the same shape. The flags are
 * the trigger layer's to set — nothing in `skip` or `moveOrSkip` touches them,
 * so a moved state and a silent skip both carry them unset.
 */

const state = (phase: AgentState['phase'], over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase,
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

describe('skip', () => {
  it('reports a skipped run carrying the state and reason, silent by default', () => {
    // Nearly every trigger-layer skip is deliberately silent — a red run on a
    // settled pull request, a classification of `none` — so `reported` defaults
    // to false and the caller that answered on the issue passes true.
    const parked = state('FAILED')

    const result = skip(parked, 'a red run in a phase with no branch to fix')

    expect(result).toEqual({
      status: 'skipped',
      reason: 'a red run in a phase with no branch to fix',
      state: parked,
      reported: false,
    })
  })

  it('carries the reported flag when the caller posted', () => {
    const parked = state('COMPLETE')

    const result = skip(parked, '/retry belongs on the pull request', true)

    expect(result.reported).toBe(true)
  })
})

describe('moveOrSkip', () => {
  it('applies a signal the table accepts and hands back the moved state', () => {
    const recording = stubPhaseDeps()

    const outcome = moveOrSkip(state('DESIGN_SPEC'), 'APPROVED', recording.deps, '/approve')

    expect(outcome.halt).toBeNull()
    expect(outcome.state.phase).toBe('PLANNING')
    expect(outcome.answer).toBe(false)
  })

  it('turns a signal the table refuses into a silent skip naming the source and phase', () => {
    // `CI_FAILED` has no `INIT_OR_CLARIFY` row, and the throw the table raises
    // must never escape the trigger layer: it becomes the skip the caller
    // reports on, with the state it arrived on untouched.
    const recording = stubPhaseDeps()
    const parked = state('INIT_OR_CLARIFY')

    const outcome = moveOrSkip(parked, 'CI_FAILED', recording.deps, 'a red check run')

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.halt?.reason).toContain('a red check run')
    expect(outcome.halt?.reason).toContain('INIT_OR_CLARIFY')
    expect(outcome.halt?.reported).toBe(false)
    expect(outcome.state).toEqual(parked)
  })
})

describe('the side-operation flags ride the same shape, unset by these helpers', () => {
  it('leaves sync and followUp unset on a moved state, and optional on the outcome itself', () => {
    // The flags are the command dispatch's to set (`triggers.ts`); this module
    // is what both a phase move and a refusal look like, and neither is a side
    // operation — while the outcome shape keeps both flags optional, so a
    // plain outcome typechecks without them and a flagged one stays
    // independent of `sync`.
    const recording = stubPhaseDeps()
    const moved: TriggerOutcome = moveOrSkip(state('DESIGN_SPEC'), 'APPROVED', recording.deps, '/approve')

    expect(moved.sync).toBeUndefined()
    expect(moved.followUp).toBeUndefined()

    const plain: TriggerOutcome = { state: state('FAILED'), halt: null, answer: false }
    expect(plain.sync).toBeUndefined()
    expect(plain.followUp).toBeUndefined()

    const flagged: TriggerOutcome = { state: state('COMPLETE'), halt: null, answer: false, followUp: true }
    expect(flagged.followUp).toBe(true)
    expect(flagged.sync).toBeUndefined()
  })
})
