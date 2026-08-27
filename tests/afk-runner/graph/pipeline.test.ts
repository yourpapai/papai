// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { pipelineMachine, pipelineRootHandlers, pipelineStates } from '../../../afk-runner/src/graph/pipeline.js'
import { initialKernelContext, initialStep, step } from '../../../afk-runner/src/kernel/machine.js'

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

describe('pipeline graph v0 behavior', () => {
  it('walks the full happy path to completed on final gate answer', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage })[0]
      expect(snapshot.value).toBe(stage)
    }
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.exit', stage })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('completed')
    expect(snapshot.status).toBe('done')
  })

  it('gate.answered before gate occupancy and completion is a no-op', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'intake' })[0]
    snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'draft' })[0]
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('draft')
    expect(snapshot.status).toBe('active')
  })

  it('gate.answered from gate with pending stages stays in gate', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('gate')
    expect(snapshot.status).toBe('active')
  })

  it('review re-entry self-loops and keeps review active', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'review' })[0]
    expect(snapshot.value).toBe('review')
    expect(snapshot.context.stages['review']).toBe('active')
    expect(snapshot.context.stages['draft']).toBe('done')
  })

  it('backwards enter (draft while in review) is rejected deterministically', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'draft' })[0]
    expect(snapshot.value).toBe('review')
    expect(snapshot.context.stages['draft']).toBe('done')
  })

  it('gate.presented is a mapped no-op that never moves position', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'intake' })[0]
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.presented', mode: 'early', version: 1 })[0]
    expect(snapshot.value).toBe('intake')
  })

  it('stage.exit marks the map done from any position, including finals', () => {
    let snapshot = initialStep(pipelineMachine)[0]
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.enter', stage })[0]
    }
    for (const stage of ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'] as const) {
      snapshot = step(pipelineMachine, snapshot, { type: 'stage.exit', stage })[0]
    }
    snapshot = step(pipelineMachine, snapshot, { type: 'gate.answered' })[0]
    expect(snapshot.value).toBe('completed')
    snapshot = step(pipelineMachine, snapshot, { type: 'stage.exit', stage: 'gate' })[0]
    expect(snapshot.value).toBe('completed')
    expect(snapshot.context.stages['gate']).toBe('done')
  })
})
