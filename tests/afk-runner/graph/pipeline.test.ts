// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { pipelineMachine, pipelineRootHandlers, pipelineStates } from '../../../afk-runner/src/graph/pipeline.js'
import { initialKernelContext, initialStep, step } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelSnapshot } from '../../../afk-runner/src/kernel/machine.js'

function keysOf(states?: Record<string, unknown>): string[] {
  return Object.keys(states ?? {})
}

describe('pipeline graph v0 shape', () => {
  it('declares the legacy stage map states plus finals', () => {
    expect(Object.keys(pipelineStates).sort()).toEqual(
      ['aborted', 'atomicity', 'completed', 'decompose', 'draft', 'gate', 'intake', 'review', 'start'].sort(),
    )
  })

  it('pins the root handler inventory: everything except enters is root-level bookkeeping', () => {
    expect(Object.keys(pipelineRootHandlers).sort()).toEqual(
      [
        'stage.exit',
        'depth',
        'round.open',
        'round.close',
        'finding',
        'convergence',
        'gate.presented',
        'gate.answered',
        'gate.rearmed',
        'auto.decision',
        'plan',
        'child.spawned',
        'child.done',
      ].sort(),
    )
  })

  it('start and the six stages carry guarded enter edges onward only', () => {
    expect(pipelineStates['start']).toBeDefined()
    expect(pipelineStates['review']).toBeDefined()
  })

  it('initial state derives all six stages pending with an empty full derived state', () => {
    const [snapshot] = initialStep(pipelineMachine)
    expect(snapshot.value).toBe('start')
    expect(snapshot.context).toEqual(
      initialKernelContext({
        intake: 'pending',
        draft: 'pending',
        review: 'pending',
        decompose: 'pending',
        atomicity: 'pending',
        gate: 'pending',
      }),
    )
  })
})

describe('pipeline gate compound — awaiting substate (C4)', () => {
  function toReview(): KernelSnapshot {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    return snapshot
  }

  function toAwaiting(): KernelSnapshot {
    return step(pipelineMachine, toReview(), {
      type: 'gate.presented',
      mode: 'early',
      version: 1,
    })[0]
  }

  it('gate is compound with awaiting as the initial child', () => {
    const gateState = pipelineStates['gate'] as {
      initial?: string
      states?: Record<string, unknown>
    }
    expect(gateState.initial).toBe('awaiting')
    expect(keysOf(gateState.states)).toEqual(['awaiting'])
    let snapshot = toReview()
    for (const stage of ['decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
  })

  it('gate.presented from review moves position into awaiting without stage-map writes', () => {
    const before = toReview()
    const after = step(pipelineMachine, before, {
      type: 'gate.presented',
      mode: 'early',
      version: 1,
    })[0]
    expect(after.value).toEqual({ gate: 'awaiting' })
    expect(after.context.gate).toEqual({
      mode: 'early',
      version: 1,
      answered: false,
    })
    expect(after.context.stages['review']).toBe('active')
    expect(after.context.stages['gate']).toBe('pending')
  })

  it('re-presentation re-enters awaiting at v+1 with the record updated', () => {
    let snapshot = toAwaiting()
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    snapshot = step(pipelineMachine, snapshot, {
      type: 'gate.presented',
      mode: 'early',
      version: 2,
    })[0]
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.context.gate).toEqual({
      mode: 'early',
      version: 2,
      answered: false,
    })
  })

  it('round.open from awaiting moves to review carrying the shadowed openRound assign', () => {
    const snapshot = step(pipelineMachine, toAwaiting(), {
      type: 'round.open',
      round: 5,
      cap: 5,
    })[0]
    expect(snapshot.value).toBe('review')
    expect(snapshot.context.round).toEqual({ current: 5, cap: 5 })
  })

  it('stage.enter(decompose) from awaiting moves to decompose (approve-early mover)', () => {
    const snapshot = step(pipelineMachine, toAwaiting(), {
      type: 'stage.enter',
      stage: 'decompose',
    })[0]
    expect(snapshot.value).toBe('decompose')
    expect(snapshot.context.stages['decompose']).toBe('active')
    expect(snapshot.context.stages['review']).toBe('done')
  })

  it('stage.enter(draft) from awaiting moves to draft (veto mover)', () => {
    const snapshot = step(pipelineMachine, toAwaiting(), {
      type: 'stage.enter',
      stage: 'draft',
    })[0]
    expect(snapshot.value).toBe('draft')
    expect(snapshot.context.stages['draft']).toBe('active')
    expect(snapshot.context.stages['review']).toBe('done')
  })

  it('gate.answered with outcome=abort from awaiting reaches aborted', () => {
    const snapshot = step(pipelineMachine, toAwaiting(), {
      type: 'gate.answered',
      outcome: 'abort',
    })[0]
    expect(snapshot.value).toBe('aborted')
    expect(snapshot.status).toBe('done')
    expect(snapshot.context.gate?.answered).toBe(true)
    expect(snapshot.context.gateOutcome).toBe('abort')
  })

  it('the existing answered+all-done completed edge stays intact from awaiting', () => {
    let snapshot = toAwaiting()
    for (const stage of ['decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    for (const stage of ['review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.exit',
        stage,
      })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('completed')
    expect(snapshot.status).toBe('done')
  })

  it('early answered with work remaining stays awaiting (root handler answers, no move)', () => {
    const snapshot = step(pipelineMachine, toAwaiting(), {
      type: 'gate.answered',
      outcome: 'extend',
    })[0]
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.context.gate).toEqual({
      mode: 'early',
      version: 1,
      answered: true,
    })
    expect(snapshot.context.gateOutcome).toBe('extend')
  })
})

describe('pipeline C5 kernel completions — decompose→gate edge and tail self-loops (D4)', () => {
  function toStage(stages: readonly string[]): KernelSnapshot {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of stages) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage })[0]
    }
    return snapshot
  }

  it('stage.enter(gate) from decompose is legal — the depth-S tail skips atomicity', () => {
    const snapshot = step(pipelineMachine, toStage(['intake', 'draft', 'review', 'decompose']), {
      type: 'stage.enter',
      stage: 'gate',
    })[0]
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.context.stages['gate']).toBe('active')
    expect(snapshot.context.stages['decompose']).toBe('done')
    expect(snapshot.context.stages['atomicity']).toBe('pending')
  })

  it('decompose re-entry self-loops (mid-decompose crash resume)', () => {
    const before = toStage(['intake', 'draft', 'review', 'decompose'])
    const [after, actions] = step(pipelineMachine, before, { type: 'stage.enter', stage: 'decompose' })
    expect(after).not.toBe(before)
    expect(actions).toHaveLength(0)
    expect(after.value).toBe('decompose')
    expect(after.context.stages['decompose']).toBe('active')
  })

  it('atomicity re-entry self-loops (mid-atomicity crash resume)', () => {
    const before = toStage(['intake', 'draft', 'review', 'decompose', 'atomicity'])
    const [after, actions] = step(pipelineMachine, before, { type: 'stage.enter', stage: 'atomicity' })
    expect(after).not.toBe(before)
    expect(actions).toHaveLength(0)
    expect(after.value).toBe('atomicity')
    expect(after.context.stages['atomicity']).toBe('active')
  })

  it('intake re-entry self-loops (mid-intake crash resume — the inherited gap)', () => {
    const before = toStage(['intake'])
    const [after, actions] = step(pipelineMachine, before, { type: 'stage.enter', stage: 'intake' })
    expect(after).not.toBe(before)
    expect(actions).toHaveLength(0)
    expect(after.value).toBe('intake')
    expect(after.context.stages['intake']).toBe('active')
  })
})

describe('pipeline graph v0 behavior', () => {
  it('walks the full happy path to completed on final gate answer', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
      expect(snapshot.value).toBe(stage)
    }
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.enter',
      stage: 'gate',
    })[0]
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.exit',
        stage,
      })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('completed')
    expect(snapshot.status).toBe('done')
  })

  it('gate.answered before gate occupancy and completion is a no-op', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.enter',
      stage: 'intake',
    })[0]
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.enter',
      stage: 'draft',
    })[0]
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('draft')
    expect(snapshot.status).toBe('active')
  })

  it('gate.answered from gate with pending stages stays in gate', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.status).toBe('active')
  })

  it('review re-entry self-loops and keeps review active', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.enter',
      stage: 'review',
    })[0]
    expect(snapshot.value).toBe('review')
    expect(snapshot.context.stages['review']).toBe('active')
    expect(snapshot.context.stages['draft']).toBe('done')
  })

  it('backwards enter (draft while in review) is rejected deterministically', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.enter',
      stage: 'draft',
    })[0]
    expect(snapshot.value).toBe('review')
    expect(snapshot.context.stages['draft']).toBe('done')
  })

  it('gate.presented is a mapped no-op that never moves position', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.enter',
      stage: 'intake',
    })[0]
    snapshot = step(pipelineMachine, snapshot, {
      type: 'gate.presented',
      mode: 'early',
      version: 1,
    })[0]
    expect(snapshot.value).toBe('intake')
  })

  it('stage.exit marks the map done from any position, including finals', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.enter',
        stage,
      })[0]
    }
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, {
        type: 'stage.exit',
        stage,
      })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('completed')
    snapshot = step(pipelineMachine, snapshot, {
      type: 'stage.exit',
      stage: 'gate',
    })[0]
    expect(snapshot.value).toBe('completed')
    expect(snapshot.context.stages['gate']).toBe('done')
  })
})
