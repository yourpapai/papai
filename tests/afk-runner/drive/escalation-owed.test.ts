// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  declaredFailureOf,
  escalationOwed,
  STAGE_FAILURE_BUDGET,
} from '../../../afk-runner/src/drive/failure-budget.js'
import type { ParkedReason, WorkFor } from '../../../afk-runner/src/drive/loop.js'
import { parkedReasonOf } from '../../../afk-runner/src/drive/resume.js'
import { AgentValidationError, SpawnError, StageHaltError } from '../../../afk-runner/src/errors.js'
import type { EventInput, FailureKind, StageId } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { AgentRunError } from '../../../review-loop/src/agent-runner.js'

const WALK: readonly EventInput[] = [
  { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
  { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'r', source: 'estimator' },
  { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
  { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
  { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
  { altitude: 'L2', type: 'stage_enter', stage: 'review' },
]

const failed = (stage: StageId, kind: FailureKind): EventInput => ({
  altitude: 'L2',
  type: 'stage_failed',
  stage,
  kind,
  reason: 'r',
})

/** Fold the walk plus the given event inputs into a kernel context. */
function contextOf(...inputs: readonly EventInput[]): KernelContext {
  const events = [...WALK, ...inputs].map((input, index) => stampEvent(input, index + 1, '2026-08-29T00:00:00.000Z'))
  return foldEvents(pipelineMachine, events).snapshot.context
}

describe('STAGE_FAILURE_BUDGET (C6 D3)', () => {
  it('is the compiled constant 1 — one free retry per stage', () => {
    expect(STAGE_FAILURE_BUDGET).toBe(1)
  })
})

describe('escalationOwed(context, stage) — the one pure check (C6 D3)', () => {
  it('zero failures owes nothing', () => {
    expect(escalationOwed(contextOf(), 'review')).toBe(false)
  })

  it('one exhausted failure is under budget — the free retry', () => {
    expect(escalationOwed(contextOf(failed('review', 'exhausted')), 'review')).toBe(false)
  })

  it('one infra failure is under budget — kinds share the counter', () => {
    expect(escalationOwed(contextOf(failed('review', 'infra')), 'review')).toBe(false)
  })

  it('failures past the budget owe escalation', () => {
    expect(escalationOwed(contextOf(failed('review', 'exhausted'), failed('review', 'infra')), 'review')).toBe(true)
  })

  it('precondition escalates immediately — the first failure owes', () => {
    expect(escalationOwed(contextOf(failed('review', 'precondition')), 'review')).toBe(true)
  })

  it('a different stage owes nothing', () => {
    expect(escalationOwed(contextOf(failed('review', 'exhausted')), 'draft')).toBe(false)
  })

  it('an unanswered gate blocks the escalation — the run is already parked gate-pending', () => {
    const context = contextOf(failed('review', 'exhausted'), failed('review', 'exhausted'), {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'escalation',
      version: 1,
    })
    expect(context.gate).toEqual({ mode: 'escalation', version: 1, answered: false })
    expect(escalationOwed(context, 'review')).toBe(false)
  })

  it('an answered gate does not block — the next over-budget failure re-owes', () => {
    const context = contextOf(
      failed('review', 'exhausted'),
      failed('review', 'exhausted'),
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 1 },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'escalation', version: 1, outcome: 'approve' },
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      failed('review', 'exhausted'),
    )
    expect(escalationOwed(context, 'review')).toBe(true)
  })
})

describe('declaredFailureOf — the typed-error classifier (C6 D1)', () => {
  it('maps StageHaltError to its declared kind with reason and resume hint', () => {
    expect(declaredFailureOf(new StageHaltError('m', 'resume the run', 'exhausted'))).toMatchObject({
      kind: 'exhausted',
      reason: 'm',
      resumeHint: 'resume the run',
    })
    expect(declaredFailureOf(new StageHaltError('m2', 'h', 'precondition'))).toMatchObject({
      kind: 'precondition',
      reason: 'm2',
    })
  })

  it('maps AgentValidationError to exhausted and SpawnError to infra', () => {
    expect(declaredFailureOf(new AgentValidationError('bad shape'))).toMatchObject({
      kind: 'exhausted',
      reason: 'bad shape',
    })
    expect(declaredFailureOf(new SpawnError('could not reach the agent: spawn opencode ENOENT'))).toMatchObject({
      kind: 'infra',
      reason: 'could not reach the agent: spawn opencode ENOENT',
    })
  })

  it('maps AgentRunError (agent exited non-zero after retries) to exhausted — the process-level agent failure', () => {
    expect(
      declaredFailureOf(
        new AgentRunError('estimator exited with code 1: ', {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0,
          wallMs: 0,
        }),
      ),
    ).toMatchObject({
      kind: 'exhausted',
      reason: 'estimator exited with code 1: ',
    })
  })

  it('returns null for untyped errors — crash-shaped, rethrown by the loop', () => {
    expect(declaredFailureOf(new Error('work-module bug'))).toBeNull()
    expect(declaredFailureOf('string error')).toBeNull()
  })
})

describe('parkedReasonOf consults the budget symmetrically (C6 D3)', () => {
  const workFor: WorkFor = (state) => {
    if (state === 'review') {
      return {
        work: { kind: 'stub', run: () => undefined },
        outcomeOf: (context) => (context.lastVerdict?.verdict === 'converged' ? 'converged' : 'incomplete'),
        successors: { converged: { park: 'final' }, incomplete: { enter: 'review' } },
      }
    }
    return null
  }

  it('an over-budget active stage reports gate-pending, not drivable', () => {
    const context = contextOf(failed('review', 'exhausted'), failed('review', 'exhausted'))
    const parked: ParkedReason | 'drivable' = parkedReasonOf(context, 'review', workFor)
    expect(parked).toBe('gate-pending')
  })

  it('an under-budget stage stays drivable — resume re-enters work', () => {
    const context = contextOf(failed('review', 'exhausted'))
    expect(parkedReasonOf(context, 'review', workFor)).toBe('drivable')
  })
})
